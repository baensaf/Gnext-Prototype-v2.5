import { Injectable, NotFoundException, BadRequestException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, IsNull, Repository } from 'typeorm';
import { Customer } from '../../entities/Customer.entity';
import { CustomerGroup } from '../../entities/CustomerGroup.entity';
import { CustomerGroupMember } from '../../entities/CustomerGroupMember.entity';
import { GroupDiscount } from '../../entities/GroupDiscount.entity';
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

export interface CustomerGroupInput {
  id?: string;
  name: string;
  branch_can_assign?: boolean;
}

export interface GroupDiscountInput {
  id?: string;
  name: string;
  percent: string;
  group_ids: string[];
  own_branch_only?: boolean;
  monthly_cap?: string | null;
  uses_per_month?: number | null;
  per_visit_cap?: string | null;
}

/** What a customer has used of one group discount this month. */
export interface DiscountUsage {
  /** Orders that carried it. */
  uses: number;
  /** How much of those orders it covered. */
  covered: string;
  /** The first day of the month counted, YYYY-MM-DD. */
  monthStart: string;
}

/** Why the till did not fill a group discount in. */
export type GroupDiscountRefusal = 'OTHER_BRANCH' | 'USES_SPENT' | 'MONTH_SPENT';

/** A group discount a customer is in for, and the branches their groups hold them to. */
export interface GroupDiscountOffer {
  discount: GroupDiscount;
  /** The branches the customer belongs to in the groups this discount covers. */
  branches: (string | null)[];
}

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

const moneyOrNull = (v?: string | null) =>
  v !== null && v !== undefined && String(v).trim() !== '' && MoneyUtil.greaterThan(v, '0') ? MoneyUtil.format(v) : null;

/**
 * Customer groups and group discounts. Head office keeps the groups and the discounts; a
 * branch manager adds and removes their own branch's people in the groups head office opens to
 * branches. A discount's monthly limits count per discount, per calendar month: unused allowance
 * does not carry over and next month's cannot be spent early.
 */
@Injectable()
export class CustomerGroupsService {
  constructor(
    @InjectRepository(CustomerGroup) private readonly groupRepo: Repository<CustomerGroup>,
    @InjectRepository(CustomerGroupMember) private readonly memberRepo: Repository<CustomerGroupMember>,
    @InjectRepository(GroupDiscount) private readonly discountRepo: Repository<GroupDiscount>,
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
      `SELECT group_id, COUNT(*)::int AS members FROM customer_group_member WHERE tenant_id = $1 GROUP BY group_id`,
      [tenantId],
    );
    const byGroup = new Map(counts.map((c) => [c.group_id, c.members]));
    return groups.map((g) => ({ ...g, members: byGroup.get(g.id) || 0 }));
  }

  /**
   * Head office saves the whole list at once, in the order given. A group left out is
   * removed with its memberships, and the discounts that picked it stop covering it.
   */
  async saveGroups(tenantId: string, rows: CustomerGroupInput[], userId?: string, correlationId?: string) {
    const current = await this.listGroups(tenantId);
    const kept = new Set(rows.map((r) => r.id).filter(Boolean));
    const gone = current.filter((g) => !kept.has(g.id));
    const clean = rows.map((r, i) => {
      const name = (r.name || '').trim();
      if (!name) throw new BadRequestException('Every group needs a name');
      return { id: r.id, name, branch_can_assign: !!r.branch_can_assign, sort_order: i + 1 };
    });

    await this.dataSource.transaction(async (em) => {
      if (gone.length) {
        const goneIds = gone.map((g) => g.id);
        await em.update(CustomerGroup, { tenant_id: tenantId, id: In(goneIds) }, { is_active: false });
        await em.delete(CustomerGroupMember, { tenant_id: tenantId, group_id: In(goneIds) });
        await em.query(
          `UPDATE group_discount SET group_ids = ARRAY(SELECT x FROM unnest(group_ids) x WHERE x <> ALL($2::uuid[]))
            WHERE tenant_id = $1 AND group_ids && $2::uuid[]`,
          [tenantId, goneIds],
        );
      }
      for (const row of clean) {
        const { id, ...fields } = row;
        if (id && current.some((g) => g.id === id)) {
          await em.update(CustomerGroup, { id, tenant_id: tenantId }, fields);
        } else {
          await em.save(CustomerGroup, em.create(CustomerGroup, { ...fields, tenant_id: tenantId }));
        }
      }
    });

    await this.audit(tenantId, 'CUSTOMER_GROUPS_SAVED', 'CustomerGroup', tenantId, correlationId, { before: current, after: clean, userId });
    return await this.listGroups(tenantId);
  }

  // ---- Members ------------------------------------------------------------------------------

  /**
   * Adds customers to a group, at a branch. A branch account adds only to a group open to
   * branches, and always at its own branch. Someone already in the group stays as they were.
   */
  async addMembers(
    tenantId: string,
    groupId: string,
    dto: { customer_ids: string[]; branch_id?: string | null; note?: string | null },
    ownBranchId: string | null,
    userId?: string,
    correlationId?: string,
  ) {
    const group = await this.groupRepo.findOne({ where: { id: groupId, tenant_id: tenantId, is_active: true } });
    if (!group) throw new NotFoundException('That group is gone');
    if (ownBranchId && !group.branch_can_assign) {
      throw new ForbiddenException('Only head office adds people to this group');
    }
    const ids = [...new Set(dto.customer_ids || [])];
    if (!ids.length) throw new BadRequestException('Pick at least one customer');
    const found = await this.customerRepo.find({ where: { tenant_id: tenantId, id: In(ids) }, select: { id: true } });
    if (found.length !== ids.length) throw new NotFoundException('A customer was not found');

    const branchId = ownBranchId || dto.branch_id || null;
    const already = new Set(
      (await this.memberRepo.find({ where: { tenant_id: tenantId, group_id: groupId, customer_id: In(ids) } })).map((m) => m.customer_id),
    );
    const fresh = ids.filter((id) => !already.has(id));
    if (fresh.length) {
      await this.memberRepo.save(
        fresh.map((customerId) =>
          this.memberRepo.create({
            tenant_id: tenantId,
            group_id: groupId,
            customer_id: customerId,
            branch_id: branchId,
            note: dto.note?.trim() || null,
            created_by: userId || null,
          }),
        ),
      );
      await this.audit(tenantId, 'CUSTOMER_GROUP_MEMBERS_ADDED', 'CustomerGroup', groupId, correlationId, { customerIds: fresh, branchId, userId });
    }
    return { added: fresh.length, already: ids.length - fresh.length };
  }

  /** Takes a customer out of a group. A branch account takes out only its own branch's people. */
  async removeMember(tenantId: string, groupId: string, customerId: string, ownBranchId: string | null, correlationId?: string) {
    const member = await this.memberRepo.findOne({ where: { tenant_id: tenantId, group_id: groupId, customer_id: customerId } });
    if (!member) return { removed: 0 };
    if (ownBranchId) {
      const group = await this.groupRepo.findOne({ where: { id: groupId, tenant_id: tenantId } });
      if (!group?.branch_can_assign || member.branch_id !== ownBranchId) {
        throw new ForbiddenException('This person belongs to head office or another branch in this group');
      }
    }
    await this.memberRepo.delete({ id: member.id });
    await this.audit(tenantId, 'CUSTOMER_GROUP_MEMBER_REMOVED', 'CustomerGroup', groupId, correlationId, { customerId });
    return { removed: 1 };
  }

  /** Each customer's groups, for the customer list. */
  async groupsOf(tenantId: string, customerIds: string[]): Promise<Map<string, { id: string; name: string; branch_id: string | null }[]>> {
    const out = new Map<string, { id: string; name: string; branch_id: string | null }[]>();
    if (!customerIds.length) return out;
    const rows: { customer_id: string; id: string; name: string; branch_id: string | null }[] = await this.dataSource.query(
      `SELECT m.customer_id, g.id, g.name, m.branch_id
         FROM customer_group_member m JOIN customer_group g ON g.id = m.group_id AND g.is_active
        WHERE m.tenant_id = $1 AND m.customer_id = ANY($2::uuid[])
        ORDER BY g.sort_order, g.created_at`,
      [tenantId, customerIds],
    );
    for (const r of rows) {
      const list = out.get(r.customer_id) || [];
      list.push({ id: r.id, name: r.name, branch_id: r.branch_id });
      out.set(r.customer_id, list);
    }
    return out;
  }

  // ---- Group discounts --------------------------------------------------------------------

  async listDiscounts(tenantId: string) {
    return await this.discountRepo.find({
      where: { tenant_id: tenantId, is_active: true },
      order: { sort_order: 'ASC', created_at: 'ASC' },
    });
  }

  /** Head office saves the whole list at once, in the order given; one left out is removed. */
  async saveDiscounts(tenantId: string, rows: GroupDiscountInput[], userId?: string, correlationId?: string) {
    const current = await this.listDiscounts(tenantId);
    const groups = new Set((await this.groupRepo.find({ where: { tenant_id: tenantId, is_active: true }, select: { id: true } })).map((g) => g.id));
    const kept = new Set(rows.map((r) => r.id).filter(Boolean));
    const clean = rows.map((r, i) => {
      const name = (r.name || '').trim();
      if (!name) throw new BadRequestException('Every discount needs a name');
      const percent = MoneyUtil.format(r.percent || '0', 2);
      if (MoneyUtil.lessThanOrEqual(percent, '0') || MoneyUtil.greaterThan(percent, '100')) {
        throw new BadRequestException(`${name}: the percent must be above 0 and at most 100`);
      }
      const groupIds = [...new Set((r.group_ids || []).filter((id) => groups.has(id)))];
      if (!groupIds.length) throw new BadRequestException(`${name}: pick at least one group`);
      const uses = r.uses_per_month !== null && r.uses_per_month !== undefined && Number(r.uses_per_month) > 0 ? Math.floor(Number(r.uses_per_month)) : null;
      return {
        id: r.id,
        name,
        percent,
        group_ids: groupIds,
        own_branch_only: !!r.own_branch_only,
        monthly_cap: moneyOrNull(r.monthly_cap),
        uses_per_month: uses,
        per_visit_cap: moneyOrNull(r.per_visit_cap),
        sort_order: i + 1,
      };
    });

    await this.dataSource.transaction(async (em) => {
      for (const gone of current.filter((d) => !kept.has(d.id))) {
        await em.update(GroupDiscount, { id: gone.id, tenant_id: tenantId }, { is_active: false });
      }
      for (const row of clean) {
        const { id, ...fields } = row;
        if (id && current.some((d) => d.id === id)) {
          await em.update(GroupDiscount, { id, tenant_id: tenantId }, fields);
        } else {
          await em.save(GroupDiscount, em.create(GroupDiscount, { ...fields, tenant_id: tenantId }));
        }
      }
    });

    await this.audit(tenantId, 'GROUP_DISCOUNTS_SAVED', 'GroupDiscount', tenantId, correlationId, { before: current, after: clean, userId });
    return await this.listDiscounts(tenantId);
  }

  /** The group discounts a customer is in for, biggest percent first. */
  async offersFor(tenantId: string, customerId: string): Promise<GroupDiscountOffer[]> {
    const members = await this.memberRepo.find({ where: { tenant_id: tenantId, customer_id: customerId } });
    if (!members.length) return [];
    const groupIds = members.map((m) => m.group_id);
    const discounts: GroupDiscount[] = await this.discountRepo
      .createQueryBuilder('d')
      .where('d.tenant_id = :tenantId AND d.is_active AND d.group_ids && CAST(:groupIds AS uuid[])', { tenantId, groupIds })
      .orderBy('d.percent', 'DESC')
      .addOrderBy('d.sort_order', 'ASC')
      .getMany();
    return discounts.map((discount) => ({
      discount,
      branches: members.filter((m) => discount.group_ids.includes(m.group_id)).map((m) => m.branch_id),
    }));
  }

  // ---- This month's use ---------------------------------------------------------------------

  async monthStart(tenantId: string, now: Date = new Date()): Promise<string> {
    const row = await this.settingRepo.findOne({ where: { tenant_id: tenantId, key: CALENDAR_SETTING_KEY, branch_id: IsNull() } });
    return monthStartOf(readCalendar(row?.value), now);
  }

  /**
   * The orders this month that carried one group discount for the customer, and how much of
   * them it covered (what it took off over its percent, so an order changed later counts as it
   * is now). Cancelled, rejected and refunded orders give theirs back.
   */
  async usage(tenantId: string, customerId: string, discountId: string, exceptOrderId?: string | null): Promise<DiscountUsage> {
    const monthStart = await this.monthStart(tenantId);
    const [row] = await this.dataSource.query(
      `SELECT COUNT(DISTINCT oa.order_id)::int AS uses,
              COALESCE(SUM(CASE WHEN COALESCE((oa.calculation_snapshot->>'percent')::numeric, 0) > 0
                                THEN oa.amount * 100 / (oa.calculation_snapshot->>'percent')::numeric ELSE 0 END), 0) AS covered
         FROM order_adjustment oa
         JOIN order_header o ON o.id = oa.order_id AND o.tenant_id = oa.tenant_id
        WHERE oa.tenant_id = $1 AND o.customer_id = $2 AND oa.source_id = $3
          AND oa.type = 'DISCOUNT' AND oa.source_type = 'CUSTOMER'
          AND ${ORDER_BUSINESS_DATE_EXPR('o')} >= $4
          AND NOT (o.state = ANY($5) AND o.status = ANY($5))
          AND COALESCE(o.status, '') <> 'REFUNDED' AND COALESCE(o.refunded_total, 0) = 0
          AND ($6::uuid IS NULL OR o.id <> $6::uuid)`,
      [tenantId, customerId, discountId, monthStart, NON_REVENUE_ORDER_STATES, exceptOrderId || null],
    );
    return { uses: Number(row?.uses || 0), covered: MoneyUtil.format(row?.covered || '0'), monthStart };
  }

  /** Uses and allowance left this month; null where the discount has no limit. */
  left(discount: Pick<GroupDiscount, 'uses_per_month' | 'monthly_cap'>, used: DiscountUsage) {
    const usesLeft =
      discount.uses_per_month === null || discount.uses_per_month === undefined ? null : Math.max(0, discount.uses_per_month - used.uses);
    let monthLeft: string | null = null;
    if (discount.monthly_cap) {
      const rest = MoneyUtil.subtract(discount.monthly_cap, used.covered);
      monthLeft = MoneyUtil.greaterThan(rest, '0') ? rest : '0.0000';
    }
    return { usesLeft, monthLeft };
  }

  /** One customer's groups and the group discounts they get, with this month's use, for the drawer. */
  async summary(tenantId: string, customerId: string) {
    const memberships: any[] = await this.dataSource.query(
      `SELECT g.id AS group_id, g.name, g.branch_can_assign, m.branch_id, m.note, m.created_at
         FROM customer_group_member m JOIN customer_group g ON g.id = m.group_id AND g.is_active
        WHERE m.tenant_id = $1 AND m.customer_id = $2
        ORDER BY g.sort_order, g.created_at`,
      [tenantId, customerId],
    );
    const offers = await this.offersFor(tenantId, customerId);
    const discounts = [];
    for (const { discount, branches } of offers) {
      const used = await this.usage(tenantId, customerId, discount.id);
      discounts.push({ ...discount, branches, usage: used, ...this.left(discount, used) });
    }
    return { memberships, discounts };
  }

  private async audit(
    tenantId: string,
    action: string,
    entityType: string,
    id: string,
    correlationId: string | undefined,
    details: Record<string, unknown>,
  ) {
    await this.auditWriter.write({
      tenantId,
      actorType: 'ADMIN',
      action,
      entityType,
      entityId: id,
      correlationId: correlationId || 'system',
      details,
    });
  }
}
