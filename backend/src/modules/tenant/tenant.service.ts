import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, Repository } from 'typeorm';
import { Tenant } from '../../entities/Tenant.entity';
import { Branch, BranchType } from '../../entities/Branch.entity';
import { BranchOperatingHour } from '../../entities/BranchOperatingHour.entity';
import { Terminal } from '../../entities/Terminal.entity';
import { CashierShift } from '../../entities/CashierShift.entity';
import { PaymentDevice } from '../../entities/PaymentDevice.entity';
import { Printer } from '../../entities/Printer.entity';
import { AdminUser } from '../../entities/AdminUser.entity';
import { Agent } from '../../entities/Agent.entity';
import { AuditWriter } from '../audit/audit-writer.service';
import { PaginationQueryDto, createPagedResponse, PagedResponse } from '../../common/dto/pagination.dto';
import { trackBusinessDayChange } from '../../common/utils/business-clock';
import { isHhMm, isTimeZone } from '../../common/utils/business-day';
import { hoursProblem } from '../../common/utils/opening-hours';
import { OPEN_STATUSES } from '../order/order-list';

const BRANCH_TYPES: BranchType[] = ['RESTAURANT', 'COMMISSARY', 'OFFICE'];

/** What head office may set on a branch. Status, history and the timeline are not on this list. */
export interface BranchInput {
  name?: string;
  code?: string;
  branch_type?: BranchType;
  phone?: string | null;
  address?: string | null;
  time_zone?: string;
  latitude?: number | string | null;
  longitude?: number | string | null;
}

/** One shift of a day as the screens send it; a closed day is one row with is_closed. */
export interface OpeningHoursInput {
  day_of_week: number;
  open_time?: string;
  close_time?: string;
  is_closed?: boolean;
}

/** Kinds of unfinished work that stop a branch being archived, as the refusal lists them. */
export type ArchiveBlockerKind = 'SHIFT' | 'ORDER' | 'REFUND_DUE' | 'DELIVERY' | 'COURIER_CASH' | 'SETTLEMENT' | 'HELD_ORDER';

const ARCHIVE_BLOCKER_WORDS: Record<string, string> = {
  SHIFT: 'cash shift(s) open',
  ORDER: 'order(s) unpaid or in progress',
  REFUND_DUE: 'cancelled order(s) with money not given back',
  DELIVERY: 'delivery(ies) not finished',
  COURIER_CASH: 'finished delivery(ies) the courier is not settled for',
  SETTLEMENT: 'courier settlement(s) open',
  HELD_ORDER: 'held order(s)',
};

/**
 * A title as it is compared: Unicode-normalised, without surrounding spaces, Latin letters in
 * one case. Persian letters and inner spaces are compared as typed.
 */
const titleKey = (title: string) => title.normalize('NFC').trim().toLowerCase();

@Injectable()
export class TenantService {
  constructor(
    @InjectRepository(Tenant) private readonly tenantRepo: Repository<Tenant>,
    @InjectRepository(Branch) private readonly branchRepo: Repository<Branch>,
    @InjectRepository(BranchOperatingHour) private readonly hoursRepo: Repository<BranchOperatingHour>,
    @InjectRepository(Terminal) private readonly terminalRepo: Repository<Terminal>,
    private readonly auditWriter: AuditWriter,
  ) {}

  async getProfile(tenantId: string) {
    const tenant = await this.tenantRepo.findOne({ where: { id: tenantId } });
    if (!tenant) throw new NotFoundException('Tenant not found');
    return tenant;
  }

  async updateProfile(tenantId: string, data: { name?: string; default_locale?: string; time_zone?: string }, correlationId: string) {
    const tenant = await this.getProfile(tenantId);
    const before = { ...tenant };
    if (data.name) tenant.name = data.name;
    if (data.default_locale) tenant.default_locale = data.default_locale;
    if (data.time_zone) {
      if (!isTimeZone(data.time_zone)) throw new BadRequestException(`${data.time_zone} is not a time zone`);
      tenant.time_zone = data.time_zone;
    }
    // A branch with no zone of its own keeps the chain's clock, so its business day moves with it.
    const updated = await trackBusinessDayChange(this.tenantRepo.manager, tenantId, () => this.tenantRepo.save(tenant));

    await this.auditWriter.write({
      tenantId,
      actorType: 'ADMIN',
      action: 'TENANT_PROFILE_UPDATED',
      correlationId,
      beforeData: before,
      afterData: updated,
    });
    return updated;
  }

  /**
   * `onlyBranchId` confines the answer to one site, for an account that works at one.
   * `includeArchived` adds archived branches, for head office's branch list.
   */
  async getBranches(
    tenantId: string,
    query?: PaginationQueryDto & { search?: string },
    onlyBranchId?: string | null,
    includeArchived = false,
  ): Promise<PagedResponse<Branch> | Branch[]> {
    if (!query || (!query.page && !query.limit && !query.search)) {
      return await this.branchRepo.find({
        where: onlyBranchId
          ? { tenant_id: tenantId, id: onlyBranchId }
          : { tenant_id: tenantId },
        withDeleted: includeArchived && !onlyBranchId,
        order: { name: 'ASC' },
      });
    }

    const page = query.page || 1;
    const limit = query.limit || 20;
    const qb = this.branchRepo.createQueryBuilder('b')
      .where('b.tenant_id = :tenantId', { tenantId });

    if (onlyBranchId) qb.andWhere('b.id = :onlyBranchId', { onlyBranchId });

    if (query.search) {
      qb.andWhere('(LOWER(b.name) LIKE :search OR LOWER(b.code) LIKE :search)', { search: `%${query.search.toLowerCase()}%` });
    }

    qb.orderBy('b.name', 'ASC')
      .skip((page - 1) * limit)
      .take(limit);

    const [items, total] = await qb.getManyAndCount();
    return createPagedResponse(items, total, page, limit);
  }

  /** An archived branch is found too when `withArchived`: head office still opens its page. */
  async getBranchById(tenantId: string, branchId: string, withArchived = false) {
    const branch = await this.branchRepo.findOne({ where: { id: branchId, tenant_id: tenantId }, withDeleted: withArchived });
    if (!branch) throw new NotFoundException('Branch not found');
    return branch;
  }

  /**
   * Head office adds a branch with everything it needs to run: details, time zone, the pin
   * and the weekly hours, saved together or not at all. The pin is required. There is no
   * branch code to type; one is made for the places that still key on it.
   */
  async createBranch(tenantId: string, data: BranchInput & { hours?: OpeningHoursInput[] }, correlationId: string) {
    const name = String(data.name || '').normalize('NFC').trim();
    if (!name) throw new BadRequestException({ code: 'BRANCH_TITLE_REQUIRED', message: 'A branch needs a title' });
    if (data.branch_type && !BRANCH_TYPES.includes(data.branch_type)) {
      throw new BadRequestException(`branch_type is one of ${BRANCH_TYPES.join(', ')}`);
    }
    if (data.time_zone && !isTimeZone(data.time_zone)) throw new BadRequestException(`${data.time_zone} is not a time zone`);
    const pin = this.readPin(data);
    if (!pin) throw new BadRequestException({ code: 'BRANCH_PIN_REQUIRED', message: 'Place the branch on the map before saving it' });
    await this.assertTitleFree(tenantId, name);

    // The week is set explicitly: every day either has shifts or is marked closed. A branch
    // with no hours would otherwise look closed every day, or (as it once did) always open.
    const days = new Set((data.hours || []).map((h) => h.day_of_week));
    if (days.size < 7) {
      throw new BadRequestException({ code: 'BRANCH_HOURS_REQUIRED', message: 'Set the opening hours for all seven days' });
    }
    const hours = this.normaliseHours(data.hours || []);
    const problem = hoursProblem(hours);
    if (problem) throw new BadRequestException({ code: 'BRANCH_HOURS_INVALID', message: problem });

    const saved = await this.branchRepo.manager.transaction(async (em) => {
      const branch = em.create(Branch, {
        tenant_id: tenantId,
        code: await this.nextBranchCode(em, tenantId, data.code),
        name,
        // Defaults to a storefront, which is what a branch created without a stated
        // type has always meant here.
        branch_type: data.branch_type || 'RESTAURANT',
        phone: data.phone?.trim() || null,
        address: data.address?.trim() || null,
        time_zone: data.time_zone || 'Asia/Tehran',
        latitude: pin.latitude,
        longitude: pin.longitude,
        is_active: true,
      });
      const created = await em.save(Branch, branch);
      for (const h of hours) {
        await em.save(BranchOperatingHour, em.create(BranchOperatingHour, { tenant_id: tenantId, branch_id: created.id, ...h }));
      }
      return created;
    });

    await this.auditWriter.write({
      tenantId,
      actorType: 'ADMIN',
      action: 'BRANCH_CREATED',
      entityType: 'Branch',
      entityId: saved.id,
      correlationId,
      afterData: saved,
    });

    return saved;
  }

  /** Head office changes a branch's details, time zone or pin. The pin can move, not go. */
  async updateBranch(tenantId: string, branchId: string, data: BranchInput, correlationId: string) {
    const branch = await this.getBranchById(tenantId, branchId);
    const before = { ...branch };
    if (data.time_zone && !isTimeZone(data.time_zone)) throw new BadRequestException(`${data.time_zone} is not a time zone`);
    if (data.branch_type && !BRANCH_TYPES.includes(data.branch_type)) {
      throw new BadRequestException(`branch_type is one of ${BRANCH_TYPES.join(', ')}`);
    }
    if (data.name !== undefined) {
      const name = String(data.name).normalize('NFC').trim();
      if (!name) throw new BadRequestException({ code: 'BRANCH_TITLE_REQUIRED', message: 'A branch needs a title' });
      if (titleKey(name) !== titleKey(branch.name)) await this.assertTitleFree(tenantId, name, branchId);
      branch.name = name;
    }
    const zoneChanges = !!data.time_zone && data.time_zone !== branch.time_zone;
    if (data.latitude !== undefined || data.longitude !== undefined) {
      const pin = this.readPin(data);
      if (!pin) throw new BadRequestException({ code: 'BRANCH_PIN_REQUIRED', message: 'The pin can be moved but not removed' });
      branch.latitude = pin.latitude;
      branch.longitude = pin.longitude;
    }
    if (data.phone !== undefined) branch.phone = data.phone?.trim() || null;
    if (data.address !== undefined) branch.address = data.address?.trim() || null;
    if (data.time_zone) branch.time_zone = data.time_zone;
    if (data.branch_type) branch.branch_type = data.branch_type;
    // A new time zone moves when the branch's day turns over, from now on. Moving the clock under
    // an open drawer would put its sales in a day it never opened in, so the change takes the
    // branch row exclusively: opening a shift takes it shared, so one waits for the other, and
    // the count of open shifts cannot go stale before the save.
    const updated = zoneChanges
      ? await this.branchRepo.manager.transaction(async (em) => {
          await em.findOne(Branch, { where: { id: branchId, tenant_id: tenantId }, lock: { mode: 'pessimistic_write' } });
          const openShifts = await em.count(CashierShift, {
            where: { tenant_id: tenantId, branch_id: branchId, state: In(['OPEN', 'CLOSING_REVIEW']) },
          });
          if (openShifts > 0) {
            throw new ConflictException({
              code: 'BRANCH_HAS_OPEN_SHIFT',
              message: `Close the ${openShifts} open cash shift(s) at ${branch.name} before changing its time zone`,
            });
          }
          return await trackBusinessDayChange(em, tenantId, () => em.save(branch));
        })
      : await trackBusinessDayChange(this.branchRepo.manager, tenantId, () => this.branchRepo.save(branch));

    await this.auditWriter.write({
      tenantId,
      actorType: 'ADMIN',
      action: 'BRANCH_UPDATED',
      entityType: 'Branch',
      entityId: branchId,
      correlationId,
      beforeData: before,
      afterData: updated,
    });
    return updated;
  }

  /**
   * Head office archives a branch that has closed for good. Refused while anything there is
   * unfinished (archiveBlockers). The branch row stays locked from the check to the archive, so
   * a shift or order starting meanwhile waits and then finds the branch archived. Its agent is
   * revoked, so it must be enrolled again on restore. The branch is taken away from its staff:
   * their accounts stay active, with no branch, until head office gives them one.
   */
  async archiveBranch(tenantId: string, branchId: string, correlationId: string, actorId?: string | null) {
    const result = await this.branchRepo.manager.transaction(async (em) => {
      const branch = await em.findOne(Branch, {
        where: { id: branchId, tenant_id: tenantId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!branch) throw new NotFoundException('Branch not found');

      const blockers = await this.archiveBlockers(em, tenantId, branchId);
      if (blockers.length > 0) {
        const counts = new Map<string, number>();
        for (const b of blockers) counts.set(b.kind, (counts.get(b.kind) || 0) + 1);
        const summary = [...counts].map(([kind, n]) => `${n} ${ARCHIVE_BLOCKER_WORDS[kind]}`).join(', ');
        throw new ConflictException({
          code: 'BRANCH_HAS_UNFINISHED_WORK',
          message: `${branch.name} has ${summary}. Finish them before archiving the branch.`,
          context: { items: blockers },
        });
      }

      const agents = await em.update(
        Agent,
        { tenant_id: tenantId, branch_id: branchId, status: 'ACTIVE' },
        { status: 'REVOKED', revoked_at: new Date(), revoked_by: actorId ?? null },
      );
      const staff = await em
        .createQueryBuilder()
        .update(AdminUser)
        .set({ branch_removed_at: () => 'now()' })
        .where('tenant_id = :tenantId AND branch_id = :branchId AND branch_removed_at IS NULL', { tenantId, branchId })
        .execute();
      branch.is_active = false;
      branch.archived_by = actorId ?? null;
      await em.save(Branch, branch);
      await em.softRemove(Branch, branch);
      return { agentsRevoked: agents.affected ?? 0, staffWithoutBranch: staff.affected ?? 0 };
    });

    await this.auditWriter.write({
      tenantId,
      actorType: 'ADMIN',
      action: 'BRANCH_ARCHIVED',
      entityType: 'Branch',
      entityId: branchId,
      correlationId,
      details: result,
    });
    return { success: true, ...result };
  }

  /**
   * What stops a branch being archived (Branch Management spec, B4): a cash shift not yet
   * counted and closed; a sent order with money owed or still in progress; a cancelled order
   * whose money has not gone back; a delivery not delivered or failed, prepaid or not; a finished
   * delivery the courier has not been settled for, with or without a settlement started; a
   * courier settlement still open; and a held order, which is discarded first. At most 50 are
   * listed.
   */
  private async archiveBlockers(em: EntityManager, tenantId: string, branchId: string) {
    const rows: Array<{ kind: ArchiveBlockerKind; label: string }> = await em.query(
      `SELECT * FROM (
         SELECT 'SHIFT' AS kind, COALESCE(s.shift_number, s.id::text) AS label, 1 AS ord
           FROM cashier_shift s
          WHERE s.tenant_id = $1 AND s.branch_id = $2 AND s.state IN ('OPEN', 'CLOSING_REVIEW')
         UNION ALL
         SELECT 'ORDER', o.order_number, 2 FROM order_header o
          WHERE o.tenant_id = $1 AND o.branch_id = $2
            AND (o.status IN ('PENDING_ACCEPTANCE', ${OPEN_STATUSES.map((s) => `'${s}'`).join(', ')})
                 OR (o.status NOT IN ('DRAFT', 'CANCELLED', 'REJECTED', 'REFUNDED') AND o.outstanding_total > 0))
         UNION ALL
         SELECT 'REFUND_DUE', o.order_number, 3 FROM order_header o
          WHERE o.tenant_id = $1 AND o.branch_id = $2 AND o.status IN ('CANCELLED', 'REJECTED')
            AND COALESCE(o.paid_total, 0) > COALESCE(o.refunded_total, 0)
         UNION ALL
         SELECT 'DELIVERY', o.order_number, 4 FROM delivery d
           JOIN order_header o ON o.id = d.order_id AND o.tenant_id = d.tenant_id
          WHERE d.tenant_id = $1 AND o.branch_id = $2 AND d.state NOT IN ('DELIVERED', 'FAILED', 'CANCELLED')
         UNION ALL
         SELECT 'COURIER_CASH', o.order_number, 5 FROM delivery_assignment a
           JOIN order_header o ON o.id = a.order_id AND o.tenant_id = a.tenant_id
          WHERE a.tenant_id = $1 AND o.branch_id = $2 AND a.is_settled = false
            AND a.status IN ('DELIVERED', 'FAILED', 'RETURNED')
         UNION ALL
         SELECT 'SETTLEMENT', cs.settlement_number, 5 FROM courier_settlement cs
          WHERE cs.tenant_id = $1 AND cs.branch_id = $2 AND cs.status IN ('DRAFT', 'UNDER_REVIEW')
         UNION ALL
         SELECT 'HELD_ORDER', o.order_number, 6 FROM order_header o
          WHERE o.tenant_id = $1 AND o.branch_id = $2 AND o.status = 'DRAFT'
       ) blockers ORDER BY ord, label LIMIT 50`,
      [tenantId, branchId],
    );
    return rows.map(({ kind, label }) => ({ kind, label }));
  }

  /** Brings an archived branch back as it was: data, tills, printers, hours. Its agent enrols again. */
  async restoreBranch(tenantId: string, branchId: string, correlationId: string) {
    const branch = await this.getBranchById(tenantId, branchId, true);
    if (!branch.deleted_at) throw new BadRequestException({ code: 'BRANCH_NOT_ARCHIVED', message: `${branch.name} is not archived` });
    await this.assertTitleFree(tenantId, branch.name, branchId);
    await this.branchRepo.recover(branch);
    branch.is_active = true;
    branch.archived_by = null;
    const restored = await this.branchRepo.save(branch);

    await this.auditWriter.write({
      tenantId,
      actorType: 'ADMIN',
      action: 'BRANCH_RESTORED',
      entityType: 'Branch',
      entityId: branchId,
      correlationId,
    });
    return restored;
  }

  async getBranchHours(tenantId: string, branchId: string) {
    return await this.hoursRepo.find({
      where: { tenant_id: tenantId, branch_id: branchId },
      order: { day_of_week: 'ASC', open_time: 'ASC' },
    });
  }

  /**
   * Replace the hours of every day the list mentions. A day can have several shifts
   * (lunch 12–16, dinner 19–23): each is its own row. A closed day is one row marked
   * closed. Days the list leaves out keep what they had. A shift that closes at or before
   * it opens runs past midnight.
   */
  async updateBranchHours(tenantId: string, branchId: string, hours: OpeningHoursInput[], correlationId: string) {
    await this.getBranchById(tenantId, branchId);
    for (const h of hours) {
      if (!Number.isInteger(h.day_of_week) || h.day_of_week < 0 || h.day_of_week > 6) {
        throw new BadRequestException(`Invalid day_of_week ${h.day_of_week}. Must be 0-6.`);
      }
    }
    const incoming = this.normaliseHours(hours);
    const days = new Set(incoming.map((h) => h.day_of_week));
    const kept = (await this.getBranchHours(tenantId, branchId)).filter((h) => !days.has(h.day_of_week));
    const problem = hoursProblem([...kept, ...incoming]);
    if (problem) throw new BadRequestException({ code: 'BRANCH_HOURS_INVALID', message: problem });

    await this.hoursRepo.manager.transaction(async (em) => {
      for (const day of days) {
        await em.delete(BranchOperatingHour, { tenant_id: tenantId, branch_id: branchId, day_of_week: day });
      }
      for (const h of incoming) {
        await em.save(BranchOperatingHour, em.create(BranchOperatingHour, { tenant_id: tenantId, branch_id: branchId, ...h }));
      }
    });

    await this.auditWriter.write({
      tenantId,
      actorType: 'ADMIN',
      action: 'BRANCH_OPERATING_HOURS_UPDATED',
      entityType: 'Branch',
      entityId: branchId,
      correlationId,
      details: { hoursCount: hours.length },
    });

    return await this.getBranchHours(tenantId, branchId);
  }

  /** Rows as stored: one per shift, or one closed row for a day with none. */
  private normaliseHours(hours: OpeningHoursInput[]) {
    // Every row names a real weekday, and an open day says both times: nothing is guessed or
    // dropped on the way to the database.
    for (const h of hours) {
      if (!Number.isInteger(h.day_of_week) || h.day_of_week < 0 || h.day_of_week > 6) {
        throw new BadRequestException({ code: 'BRANCH_HOURS_INVALID', message: `${h.day_of_week} is not a day of the week (0-6)` });
      }
    }
    const time = (value: string | undefined) => {
      const text = String(value ?? '').slice(0, 5);
      if (!isHhMm(text)) {
        throw new BadRequestException({ code: 'BRANCH_HOURS_INVALID', message: `${value ?? 'A missing time'} is not a time (HH:MM)` });
      }
      return `${text}:00`;
    };
    const rows: Array<{ day_of_week: number; open_time: string; close_time: string; is_closed: boolean; spans_midnight: boolean }> = [];
    for (let day = 0; day < 7; day++) {
      const ofDay = hours.filter((h) => h.day_of_week === day);
      if (!ofDay.length) continue;
      const open = ofDay.filter((h) => !h.is_closed);
      if (!open.length) {
        rows.push({ day_of_week: day, open_time: '00:00:00', close_time: '00:00:00', is_closed: true, spans_midnight: false });
        continue;
      }
      for (const h of open) {
        const open_time = time(h.open_time);
        const close_time = time(h.close_time);
        rows.push({ day_of_week: day, open_time, close_time, is_closed: false, spans_midnight: close_time <= open_time });
      }
    }
    return rows;
  }

  /** Both coordinates, in range; null when either is missing. */
  private readPin(data: { latitude?: number | string | null; longitude?: number | string | null }) {
    if (data.latitude === null || data.latitude === undefined || data.latitude === '') return null;
    if (data.longitude === null || data.longitude === undefined || data.longitude === '') return null;
    const latitude = Number(data.latitude);
    const longitude = Number(data.longitude);
    if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180) {
      throw new BadRequestException({ code: 'BRANCH_PIN_INVALID', message: 'The pin is not a place on the map' });
    }
    return { latitude: Math.round(latitude * 1e6) / 1e6, longitude: Math.round(longitude * 1e6) / 1e6 };
  }

  /**
   * No two branches of one chain share a title, archived ones included: an archived branch
   * keeps its title reserved, so it can always be restored. Compared as titleKey does.
   */
  private async assertTitleFree(tenantId: string, name: string, exceptId?: string) {
    const branches = await this.branchRepo.find({
      where: { tenant_id: tenantId },
      withDeleted: true,
      select: ['id', 'name', 'deleted_at'],
    });
    const key = titleKey(name);
    const clash = branches.find((b) => b.id !== exceptId && titleKey(b.name) === key);
    if (clash) {
      throw new ConflictException({
        code: 'BRANCH_TITLE_TAKEN',
        message: clash.deleted_at
          ? `An archived branch is already called ${name}; its title stays reserved`
          : `Another branch is already called ${name}`,
      });
    }
  }

  /** The code other screens still key on: the one given, or B01, B02… whichever is free. */
  private async nextBranchCode(em: EntityManager, tenantId: string, wanted?: string) {
    const taken = new Set(
      (await em.find(Branch, { where: { tenant_id: tenantId }, withDeleted: true, select: ['code'] })).map((b) => b.code.toUpperCase()),
    );
    const given = wanted?.trim().toUpperCase();
    if (given) {
      if (taken.has(given)) throw new ConflictException(`Branch code ${given} already exists`);
      return given;
    }
    for (let n = taken.size + 1; ; n++) {
      const code = `B${String(n).padStart(2, '0')}`;
      if (!taken.has(code)) return code;
    }
  }

  async getTerminals(tenantId: string, branchId?: string) {
    const where: any = { tenant_id: tenantId };
    if (branchId) where.branch_id = branchId;
    return await this.terminalRepo.find({
      where,
      order: { code: 'ASC' },
    });
  }

  async createTerminal(tenantId: string, data: { branch_id: string; code: string; name: string; terminal_type?: string }, correlationId: string) {
    await this.getBranchById(tenantId, data.branch_id);
    const existing = await this.terminalRepo.findOne({ where: { tenant_id: tenantId, branch_id: data.branch_id, code: data.code } });
    if (existing) throw new ConflictException(`Terminal code ${data.code} already exists for this branch`);

    const allowedTypes = ['CASHIER', 'KITCHEN_DISPLAY', 'SELF_KIOSK', 'MOBILE_POS'];
    const terminalType = (data.terminal_type || 'CASHIER').toUpperCase();
    if (!allowedTypes.includes(terminalType)) {
      throw new BadRequestException(`Terminal type ${data.terminal_type} is invalid. Allowed: ${allowedTypes.join(', ')}`);
    }

    const terminal = this.terminalRepo.create({
      tenant_id: tenantId,
      branch_id: data.branch_id,
      code: data.code.toUpperCase(),
      name: data.name,
      terminal_type: terminalType,
      is_active: true,
    });

    const saved = await this.terminalRepo.save(terminal);

    await this.auditWriter.write({
      tenantId,
      actorType: 'ADMIN',
      action: 'TERMINAL_CREATED',
      entityType: 'Terminal',
      entityId: saved.id,
      correlationId,
      afterData: saved,
    });

    return saved;
  }

  async updateTerminal(tenantId: string, terminalId: string, data: Partial<Terminal>, correlationId: string) {
    const terminal = await this.terminalRepo.findOne({ where: { id: terminalId, tenant_id: tenantId } });
    if (!terminal) throw new NotFoundException('Terminal not found');
    const before = { ...terminal };
    if (data.payment_device_id) {
      // A kiosk charges on a terminal in its own shop, which its branch's agent can reach.
      const device = await this.terminalRepo.manager.findOne(PaymentDevice, {
        where: { id: data.payment_device_id, tenant_id: tenantId },
      });
      if (!device) throw new NotFoundException('Payment terminal not found');
      if (device.branch_id && device.branch_id !== (data.branch_id || terminal.branch_id)) {
        throw new BadRequestException('The card terminal belongs to another branch');
      }
    }
    if (data.receipt_printer_id) {
      // A till's receipts come out at its own counter, not another branch's.
      const printer = await this.terminalRepo.manager.findOne(Printer, {
        where: { id: data.receipt_printer_id, tenant_id: tenantId },
      });
      if (!printer) throw new NotFoundException('Printer not found');
      if (printer.branch_id !== (data.branch_id || terminal.branch_id)) {
        throw new BadRequestException('The receipt printer belongs to another branch');
      }
    }
    Object.assign(terminal, data);
    const updated = await this.terminalRepo.save(terminal);

    await this.auditWriter.write({
      tenantId,
      actorType: 'ADMIN',
      action: 'TERMINAL_UPDATED',
      entityType: 'Terminal',
      entityId: terminalId,
      correlationId,
      beforeData: before,
      afterData: updated,
    });

    return updated;
  }

  async archiveTerminal(tenantId: string, terminalId: string, correlationId: string) {
    const terminal = await this.terminalRepo.findOne({ where: { id: terminalId, tenant_id: tenantId } });
    if (!terminal) throw new NotFoundException('Terminal not found');
    // Archiving a register mid-shift stranded its drawer: the shift could no longer be
    // found by terminal, so it could be neither traded on nor counted down.
    const openShifts = await this.terminalRepo.manager.count(CashierShift, {
      where: { tenant_id: tenantId, terminal_id: terminalId, state: In(['OPEN', 'CLOSING_REVIEW']) },
    });
    if (openShifts > 0) {
      throw new ConflictException({
        code: 'TERMINAL_HAS_OPEN_SHIFT',
        message: `${terminal.name} has a shift open. Close the shift before retiring the register.`,
      });
    }
    terminal.is_active = false;
    await this.terminalRepo.softRemove(terminal);

    await this.auditWriter.write({
      tenantId,
      actorType: 'ADMIN',
      action: 'TERMINAL_ARCHIVED',
      entityType: 'Terminal',
      entityId: terminalId,
      correlationId,
    });

    return { success: true };
  }
}
