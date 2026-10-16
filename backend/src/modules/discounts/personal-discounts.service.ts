import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, Repository } from 'typeorm';
import { CustomerDiscount } from '../../entities/CustomerDiscount.entity';
import { Customer } from '../../entities/Customer.entity';
import { PersonalDiscountGroup } from '../../entities/PersonalDiscountGroup.entity';
import { TenantSetting } from '../../entities/TenantSetting.entity';
import { MoneyUtil } from '../../common/utils/money.util';
import {
  BUSINESS_TIME_ZONE,
  BusinessDateUtil,
  NON_REVENUE_ORDER_STATES,
  ORDER_BUSINESS_DATE_EXPR,
} from '../../common/utils/business-date.util';
import { CALENDAR_SETTING_KEY, CalendarSystem, readCalendar } from '../../common/utils/calendar.util';
import { AuditWriter } from '../audit/audit-writer.service';

export interface PersonalDiscountGroupInput {
  id?: string;
  name: string;
  percent: string;
  monthly_cap?: string | null;
  uses_per_month?: number | null;
  per_visit_cap?: string | null;
  any_branch?: boolean;
}

/** What a person has used of their group this month. */
export interface PersonalUsage {
  /** Orders that carried it. */
  uses: number;
  /** How much of those orders it covered. */
  covered: string;
  /** The first day of the month counted, YYYY-MM-DD. */
  monthStart: string;
}

/** Why the till did not fill a person's discount in. */
export type PersonalRefusal = 'OTHER_BRANCH' | 'USES_SPENT' | 'MONTH_SPENT';

/** The first day of today's month in the chain's calendar, as YYYY-MM-DD. */
export function monthStartOf(calendar: CalendarSystem, now: Date = new Date()): string {
  const today = BusinessDateUtil.today(now);
  const day =
    calendar === 'JALALI'
      ? Number(new Intl.DateTimeFormat('en-US-u-ca-persian-nu-latn', { timeZone: BUSINESS_TIME_ZONE, day: 'numeric' }).format(now))
      : Number(today.slice(8, 10));
  const [y, m, d] = today.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d - (day - 1))).toISOString().slice(0, 10);
}

/**
 * Personal discounts: head office's groups, the one group each person is in, and what they
 * have used of it this calendar month. Unused allowance does not carry over, and next month's
 * cannot be spent early: each month starts again from nothing.
 */
@Injectable()
export class PersonalDiscountsService {
  constructor(
    @InjectRepository(PersonalDiscountGroup) private readonly groupRepo: Repository<PersonalDiscountGroup>,
    @InjectRepository(CustomerDiscount) private readonly assignmentRepo: Repository<CustomerDiscount>,
    @InjectRepository(Customer) private readonly customerRepo: Repository<Customer>,
    @InjectRepository(TenantSetting) private readonly settingRepo: Repository<TenantSetting>,
    private readonly dataSource: DataSource,
    private readonly auditWriter: AuditWriter,
  ) {}

  // ---- Groups -----------------------------------------------------------------------------

  async listGroups(tenantId: string) {
    const groups = await this.groupRepo.find({
      where: { tenant_id: tenantId, is_active: true },
      order: { sort_order: 'ASC', created_at: 'ASC' },
    });
    const counts: { group_id: string; members: number }[] = await this.dataSource.query(
      `SELECT group_id, COUNT(*)::int AS members FROM customer_discount
        WHERE tenant_id = $1 AND is_active AND deleted_at IS NULL AND group_id IS NOT NULL GROUP BY group_id`,
      [tenantId],
    );
    const byGroup = new Map(counts.map((c) => [c.group_id, c.members]));
    return groups.map((g) => ({ ...g, members: byGroup.get(g.id) || 0 }));
  }

  /**
   * Head office saves the whole list at once, in the order given. A group left out is
   * removed, unless people are still in it.
   */
  async saveGroups(tenantId: string, rows: PersonalDiscountGroupInput[], userId?: string, correlationId?: string) {
    const current = await this.listGroups(tenantId);
    const kept = new Set(rows.map((r) => r.id).filter(Boolean));
    for (const gone of current.filter((g) => !kept.has(g.id))) {
      if (gone.members > 0) {
        throw new BadRequestException({
          code: 'GROUP_HAS_MEMBERS',
          message: `${gone.name} still has ${gone.members} people; move them to another group first`,
        });
      }
    }
    const clean = rows.map((r, i) => {
      const name = (r.name || '').trim();
      if (!name) throw new BadRequestException('Every group needs a name');
      const percent = MoneyUtil.format(r.percent || '0', 2);
      if (MoneyUtil.lessThanOrEqual(percent, '0') || MoneyUtil.greaterThan(percent, '100')) {
        throw new BadRequestException(`${name}: the percent must be above 0 and at most 100`);
      }
      const money = (v?: string | null) => (v !== null && v !== undefined && String(v).trim() !== '' && MoneyUtil.greaterThan(v, '0') ? MoneyUtil.format(v) : null);
      const uses = r.uses_per_month !== null && r.uses_per_month !== undefined && Number(r.uses_per_month) > 0 ? Math.floor(Number(r.uses_per_month)) : null;
      return {
        id: r.id,
        name,
        percent,
        monthly_cap: money(r.monthly_cap),
        uses_per_month: uses,
        per_visit_cap: money(r.per_visit_cap),
        any_branch: !!r.any_branch,
        sort_order: i + 1,
      };
    });

    await this.dataSource.transaction(async (em) => {
      for (const gone of current.filter((g) => !kept.has(g.id))) {
        await em.update(PersonalDiscountGroup, { id: gone.id, tenant_id: tenantId }, { is_active: false });
      }
      for (const row of clean) {
        if (row.id && current.some((g) => g.id === row.id)) {
          const { id, ...fields } = row;
          await em.update(PersonalDiscountGroup, { id, tenant_id: tenantId }, fields);
        } else {
          const { id: _ignored, ...fields } = row;
          await em.save(PersonalDiscountGroup, em.create(PersonalDiscountGroup, { ...fields, tenant_id: tenantId }));
        }
      }
    });

    await this.auditWriter.write({
      tenantId,
      actorType: 'ADMIN',
      action: 'PERSONAL_DISCOUNT_GROUPS_SAVED',
      entityType: 'PersonalDiscountGroup',
      entityId: tenantId,
      correlationId: correlationId || 'system',
      beforeData: current,
      afterData: clean,
      details: { updatedBy: userId },
    });
    return await this.listGroups(tenantId);
  }

  // ---- Who is in which group --------------------------------------------------------------

  /** The person's active group and the branch they work at, or null. */
  async forCustomer(tenantId: string, customerId: string): Promise<{ assignment: CustomerDiscount; group: PersonalDiscountGroup } | null> {
    const assignment = await this.assignmentRepo.findOne({
      where: { tenant_id: tenantId, customer_id: customerId, is_active: true, deleted_at: IsNull() },
      relations: { group: true },
      order: { created_at: 'DESC' },
    });
    if (!assignment?.group || !assignment.group.is_active) return null;
    const now = new Date();
    if (assignment.effective_from && new Date(assignment.effective_from) > now) return null;
    if (assignment.effective_to && new Date(assignment.effective_to) < now) return null;
    return { assignment, group: assignment.group };
  }

  /**
   * Puts a person in a group, at the branch they work at, or takes them out (no group). A
   * branch account sets its own branch's people, and only into a group for one branch: the
   * groups that work everywhere are head office's to give.
   */
  async assign(
    tenantId: string,
    dto: { customer_id: string; group_id?: string | null; branch_id?: string | null; note?: string | null },
    ownBranchId: string | null,
    userId?: string,
    correlationId?: string,
  ) {
    const customer = await this.customerRepo.findOne({ where: { id: dto.customer_id, tenant_id: tenantId } });
    if (!customer) throw new NotFoundException(`Customer ${dto.customer_id} not found`);
    const current = await this.assignmentRepo.findOne({
      where: { tenant_id: tenantId, customer_id: dto.customer_id, is_active: true, deleted_at: IsNull() },
    });
    if (current && ownBranchId && current.branch_id !== ownBranchId) {
      throw new ForbiddenException('This personal discount belongs to another branch');
    }

    if (!dto.group_id) {
      if (current) {
        await this.assignmentRepo.update({ id: current.id }, { is_active: false, updated_by: userId || null });
        await this.audit(tenantId, 'CUSTOMER_DISCOUNT_REVOKED', current.id, correlationId, { customerId: dto.customer_id });
      }
      return null;
    }

    const group = await this.groupRepo.findOne({ where: { id: dto.group_id, tenant_id: tenantId, is_active: true } });
    if (!group) throw new NotFoundException('That discount group is gone');
    if (ownBranchId && group.any_branch) {
      throw new ForbiddenException('Only head office puts people in a group that works at every branch');
    }
    const branchId = ownBranchId || dto.branch_id || null;
    if (!branchId) throw new BadRequestException('Pick the branch this person works at');

    if (current) {
      current.group_id = group.id;
      current.branch_id = branchId;
      current.discount_percentage = group.percent;
      current.note = dto.note ?? current.note;
      current.updated_by = userId || null;
      const saved = await this.assignmentRepo.save(current);
      await this.audit(tenantId, 'CUSTOMER_DISCOUNT_UPDATED', saved.id, correlationId, { customerId: dto.customer_id, groupId: group.id, branchId });
      return saved;
    }
    const saved = await this.assignmentRepo.save(
      this.assignmentRepo.create({
        tenant_id: tenantId,
        customer_id: dto.customer_id,
        group_id: group.id,
        branch_id: branchId,
        discount_percentage: group.percent,
        note: dto.note || null,
        is_active: true,
        created_by: userId || null,
        updated_by: userId || null,
      }),
    );
    await this.audit(tenantId, 'CUSTOMER_DISCOUNT_ASSIGNED', saved.id, correlationId, { customerId: dto.customer_id, groupId: group.id, branchId });
    return saved;
  }

  // ---- This month's use ---------------------------------------------------------------------

  async monthStart(tenantId: string, now: Date = new Date()): Promise<string> {
    const row = await this.settingRepo.findOne({ where: { tenant_id: tenantId, key: CALENDAR_SETTING_KEY, branch_id: IsNull() } });
    return monthStartOf(readCalendar(row?.value), now);
  }

  /**
   * The orders this month that carried the person's discount, and how much of them it covered
   * (what it took off over its percent, so an order changed later counts as it is now).
   * Cancelled, rejected and refunded orders give theirs back.
   */
  async usage(tenantId: string, customerId: string, exceptOrderId?: string | null): Promise<PersonalUsage> {
    const monthStart = await this.monthStart(tenantId);
    const [row] = await this.dataSource.query(
      `SELECT COUNT(DISTINCT oa.order_id)::int AS uses,
              COALESCE(SUM(CASE WHEN COALESCE((oa.calculation_snapshot->>'percent')::numeric, 0) > 0
                                THEN oa.amount * 100 / (oa.calculation_snapshot->>'percent')::numeric ELSE 0 END), 0) AS covered
         FROM order_adjustment oa
         JOIN order_header o ON o.id = oa.order_id AND o.tenant_id = oa.tenant_id
        WHERE oa.tenant_id = $1 AND o.customer_id = $2
          AND oa.type = 'DISCOUNT' AND oa.source_type = 'CUSTOMER'
          AND ${ORDER_BUSINESS_DATE_EXPR('o')} >= $3
          AND NOT (o.state = ANY($4) AND o.status = ANY($4))
          AND COALESCE(o.status, '') <> 'REFUNDED' AND COALESCE(o.refunded_total, 0) = 0
          AND ($5::uuid IS NULL OR o.id <> $5::uuid)`,
      [tenantId, customerId, monthStart, NON_REVENUE_ORDER_STATES, exceptOrderId || null],
    );
    return { uses: Number(row?.uses || 0), covered: MoneyUtil.format(row?.covered || '0'), monthStart };
  }

  /** The person's group with what is left of it this month, for the customer drawer. */
  async summary(tenantId: string, customerId: string) {
    const found = await this.forCustomer(tenantId, customerId);
    if (!found) return null;
    const used = await this.usage(tenantId, customerId);
    return { assignment: found.assignment, group: found.group, usage: used, ...this.left(found.group, used) };
  }

  /** Uses and allowance left this month; null where the group has no limit. */
  left(group: PersonalDiscountGroup, used: PersonalUsage) {
    const usesLeft = group.uses_per_month === null || group.uses_per_month === undefined ? null : Math.max(0, group.uses_per_month - used.uses);
    let monthLeft: string | null = null;
    if (group.monthly_cap) {
      const rest = MoneyUtil.subtract(group.monthly_cap, used.covered);
      monthLeft = MoneyUtil.greaterThan(rest, '0') ? rest : '0.0000';
    }
    return { usesLeft, monthLeft };
  }

  private async audit(tenantId: string, action: string, id: string, correlationId: string | undefined, details: Record<string, unknown>) {
    await this.auditWriter.write({
      tenantId,
      actorType: 'ADMIN',
      action,
      entityType: 'CustomerDiscount',
      entityId: id,
      correlationId: correlationId || 'system',
      details,
    });
  }
}
