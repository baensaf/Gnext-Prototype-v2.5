import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Tenant } from '../../entities/Tenant.entity';
import { Branch, BranchType } from '../../entities/Branch.entity';
import { BranchOperatingHour } from '../../entities/BranchOperatingHour.entity';
import { Terminal } from '../../entities/Terminal.entity';
import { BranchStatusSnapshot } from '../../entities/BranchStatusSnapshot.entity';
import { AuditWriter } from '../audit/audit-writer.service';
import { PaginationQueryDto, createPagedResponse, PagedResponse } from '../../common/dto/pagination.dto';

@Injectable()
export class TenantService {
  constructor(
    @InjectRepository(Tenant) private readonly tenantRepo: Repository<Tenant>,
    @InjectRepository(Branch) private readonly branchRepo: Repository<Branch>,
    @InjectRepository(BranchOperatingHour) private readonly hoursRepo: Repository<BranchOperatingHour>,
    @InjectRepository(Terminal) private readonly terminalRepo: Repository<Terminal>,
    @InjectRepository(BranchStatusSnapshot) private readonly statusRepo: Repository<BranchStatusSnapshot>,
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
    if (data.time_zone) tenant.time_zone = data.time_zone;
    const updated = await this.tenantRepo.save(tenant);

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

  /** `onlyBranchId` confines the answer to one site, for an account that works at one. */
  async getBranches(
    tenantId: string,
    query?: PaginationQueryDto & { search?: string },
    onlyBranchId?: string | null,
  ): Promise<PagedResponse<Branch> | Branch[]> {
    if (!query || (!query.page && !query.limit && !query.search)) {
      return await this.branchRepo.find({
        where: onlyBranchId
          ? { tenant_id: tenantId, id: onlyBranchId }
          : { tenant_id: tenantId },
        order: { code: 'ASC' },
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

    qb.orderBy('b.code', 'ASC')
      .skip((page - 1) * limit)
      .take(limit);

    const [items, total] = await qb.getManyAndCount();
    return createPagedResponse(items, total, page, limit);
  }

  async getBranchById(tenantId: string, branchId: string) {
    const branch = await this.branchRepo.findOne({ where: { id: branchId, tenant_id: tenantId } });
    if (!branch) throw new NotFoundException('Branch not found');
    return branch;
  }

  async createBranch(tenantId: string, data: { code: string; name: string; branch_type?: BranchType; phone?: string; address?: string; time_zone?: string }, correlationId: string) {
    const existing = await this.branchRepo.findOne({ where: { tenant_id: tenantId, code: data.code } });
    if (existing) throw new ConflictException(`Branch code ${data.code} already exists`);

    const branch = this.branchRepo.create({
      tenant_id: tenantId,
      code: data.code.toUpperCase(),
      name: data.name,
      // Defaults to a storefront, which is what a branch created without a stated
      // type has always meant here.
      branch_type: data.branch_type || 'RESTAURANT',
      phone: data.phone || null,
      address: data.address || null,
      time_zone: data.time_zone || 'Asia/Tehran',
      is_active: true,
    });

    const saved = await this.branchRepo.save(branch);

    // Initialize 7-day operating hours default
    for (let day = 0; day < 7; day++) {
      const hour = this.hoursRepo.create({
        tenant_id: tenantId,
        branch_id: saved.id,
        day_of_week: day,
        open_time: '08:00:00',
        close_time: '23:00:00',
        is_closed: false,
        spans_midnight: false,
      });
      await this.hoursRepo.save(hour);
    }

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

  async updateBranch(tenantId: string, branchId: string, data: Partial<Branch>, correlationId: string) {
    const branch = await this.getBranchById(tenantId, branchId);
    const before = { ...branch };
    Object.assign(branch, data);
    const updated = await this.branchRepo.save(branch);

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

  async archiveBranch(tenantId: string, branchId: string, correlationId: string) {
    const branch = await this.getBranchById(tenantId, branchId);
    branch.is_active = false;
    await this.branchRepo.softRemove(branch);

    await this.auditWriter.write({
      tenantId,
      actorType: 'ADMIN',
      action: 'BRANCH_ARCHIVED',
      entityType: 'Branch',
      entityId: branchId,
      correlationId,
    });
    return { success: true };
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
   * closed. Days the list leaves out keep what they had.
   */
  async updateBranchHours(tenantId: string, branchId: string, hours: Array<{ day_of_week: number; open_time?: string; close_time?: string; is_closed?: boolean; spans_midnight?: boolean }>, correlationId: string) {
    await this.getBranchById(tenantId, branchId);

    const byDay = new Map<number, typeof hours>();
    for (const h of hours) {
      if (h.day_of_week < 0 || h.day_of_week > 6) {
        throw new BadRequestException(`Invalid day_of_week ${h.day_of_week}. Must be 0-6.`);
      }

      if (!h.is_closed && h.open_time && h.close_time && !h.spans_midnight) {
        if (h.open_time >= h.close_time) {
          throw new BadRequestException(`Operating open_time (${h.open_time}) must be earlier than close_time (${h.close_time}) unless spans_midnight is true.`);
        }
      }
      byDay.set(h.day_of_week, [...(byDay.get(h.day_of_week) || []), h]);
    }

    for (const [day, rows] of byDay) {
      const open = rows.filter((r) => !r.is_closed);
      const shifts = open
        .map((r) => ({ open: (r.open_time || '08:00:00').slice(0, 5), close: (r.close_time || '23:00:00').slice(0, 5), spans: !!r.spans_midnight }))
        .sort((a, b) => a.open.localeCompare(b.open));
      for (let i = 1; i < shifts.length; i++) {
        if (shifts[i - 1].spans || shifts[i].open < shifts[i - 1].close) {
          throw new BadRequestException(`Shifts on day ${day} overlap (${shifts[i - 1].open}–${shifts[i - 1].close} and ${shifts[i].open}–${shifts[i].close}).`);
        }
      }

      await this.hoursRepo.delete({ tenant_id: tenantId, branch_id: branchId, day_of_week: day });
      const toSave = open.length ? open : [{ day_of_week: day, is_closed: true }];
      for (const h of toSave) {
        await this.hoursRepo.save(
          this.hoursRepo.create({
            tenant_id: tenantId,
            branch_id: branchId,
            day_of_week: day,
            open_time: h.open_time || '08:00:00',
            close_time: h.close_time || '23:00:00',
            is_closed: h.is_closed ?? false,
            spans_midnight: h.spans_midnight ?? false,
          }),
        );
      }
    }

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

  async getBranchStatus(tenantId: string, branchId: string) {
    const snapshot = await this.statusRepo.findOne({
      where: { tenant_id: tenantId, branch_id: branchId },
      order: { recorded_at: 'DESC' },
    });
    if (!snapshot) {
      return {
        is_online: true,
        agent_version: 'v2.0.0-simulated',
        agent_health: 'HEALTHY',
        last_heartbeat_at: new Date(),
        last_sync_at: new Date(),
        simulated: true,
      };
    }
    return snapshot;
  }
}
