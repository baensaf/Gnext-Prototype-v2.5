import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as argon2 from 'argon2';
import { AdminUser } from '../../entities/AdminUser.entity';
import { Branch } from '../../entities/Branch.entity';
import { ASSIGNABLE_ROLES, APPROVER_ROLES } from '../../common/utils/user-scope.util';
import { AuditWriter } from '../audit/audit-writer.service';

/**
 * A prototype affordance, not a product decision: an account created from the users screen
 * starts on the same demo password the seed uses, so the demo never has to invent or hand
 * around a credential. Supplying `password` overrides it.
 */
const DEMO_PASSWORD = process.env.ADMIN_PASSWORD || 'GnextDemo!2026';
const DEMO_APPROVER_PIN = process.env.APPROVER_PIN || '2468';

export interface UserWriteDto {
  username?: string;
  display_name?: string;
  role?: string;
  branch_id?: string | null;
  is_active?: boolean;
  preferred_locale?: string;
  password?: string;
  pin?: string;
}

@Injectable()
export class UsersService {
  constructor(
    @InjectRepository(AdminUser) private readonly userRepo: Repository<AdminUser>,
    @InjectRepository(Branch) private readonly branchRepo: Repository<Branch>,
    private readonly auditWriter: AuditWriter,
  ) {}

  /** Never let a hash out of the service, whatever the caller asks for. */
  private present(user: AdminUser, branchName: string | null) {
    return {
      id: user.id,
      username: user.username,
      display_name: user.display_name,
      role: user.role,
      branch_id: user.branch_id ?? null,
      branch_name: branchName,
      is_active: user.is_active,
      preferred_locale: user.preferred_locale,
      last_login_at: user.last_login_at ?? null,
      /** Whether this account can approve with a pin, without revealing the pin. */
      has_pin: !!user.pin_hash,
    };
  }

  /** What an audit event records of an account: its standing, never its credentials. */
  private auditable(user: AdminUser) {
    return {
      display_name: user.display_name,
      role: user.role,
      branch_id: user.branch_id ?? null,
      is_active: user.is_active,
      preferred_locale: user.preferred_locale,
    };
  }

  async list(tenantId: string) {
    const [users, branches] = await Promise.all([
      this.userRepo.find({ where: { tenant_id: tenantId }, order: { username: 'ASC' } }),
      this.branchRepo.find({ where: { tenant_id: tenantId } }),
    ]);
    const nameById = new Map(branches.map((b) => [b.id, b.name]));
    return users.map((u) => this.present(u, u.branch_id ? nameById.get(u.branch_id) || null : null));
  }

  private async validate(tenantId: string, data: UserWriteDto) {
    if (data.role && !ASSIGNABLE_ROLES.includes(data.role.toUpperCase())) {
      throw new BadRequestException(`Unknown role: ${data.role}`);
    }
    if (data.branch_id) {
      const branch = await this.branchRepo.findOne({
        where: { id: data.branch_id, tenant_id: tenantId },
      });
      if (!branch) throw new NotFoundException('Branch not found');
    }
  }

  async create(tenantId: string, data: UserWriteDto, actorId: string, correlationId: string) {
    if (!data.username || !data.display_name || !data.role) {
      throw new BadRequestException('username, display_name and role are required');
    }
    await this.validate(tenantId, data);

    const existing = await this.userRepo.findOne({
      where: { tenant_id: tenantId, username: data.username },
    });
    if (existing) throw new ConflictException(`Username ${data.username} already exists`);

    const role = data.role.toUpperCase();
    const user = this.userRepo.create({
      tenant_id: tenantId,
      username: data.username,
      display_name: data.display_name,
      password_hash: await argon2.hash(data.password || DEMO_PASSWORD),
      // An account that may approve needs something to approve with. A register account
      // deliberately gets none: a cashier is who the pin is asked of.
      pin_hash: data.pin
        ? await argon2.hash(data.pin)
        : APPROVER_ROLES.includes(role)
          ? await argon2.hash(DEMO_APPROVER_PIN)
          : null,
      role,
      branch_id: data.branch_id || null,
      is_active: data.is_active ?? true,
      preferred_locale: data.preferred_locale || 'fa',
      created_by: actorId,
    });

    const saved = await this.userRepo.save(user);
    await this.auditWriter.write({
      tenantId,
      actorType: 'ADMIN',
      actorId,
      action: 'USER_CREATED',
      entityType: 'AdminUser',
      entityId: saved.id,
      branchId: saved.branch_id ?? undefined,
      correlationId,
      afterData: this.auditable(saved),
      details: { userId: saved.id, username: saved.username, role: saved.role, branchId: saved.branch_id },
    });

    const branch = saved.branch_id
      ? await this.branchRepo.findOne({ where: { id: saved.branch_id } })
      : null;
    return this.present(saved, branch?.name ?? null);
  }

  async update(tenantId: string, id: string, data: UserWriteDto, actorId: string, correlationId: string) {
    const user = await this.userRepo.findOne({ where: { id, tenant_id: tenantId } });
    if (!user) throw new NotFoundException('User not found');
    await this.validate(tenantId, data);

    // The demo disaster this prevents: an administrator demoting or disabling the account
    // they are signed in as, and losing the only way back into the application.
    if (id === actorId) {
      if (data.is_active === false) {
        throw new ForbiddenException({
          code: 'SELF_EDIT_BLOCKED',
          title: 'Not Permitted',
          detail: 'You cannot deactivate the account you are signed in as.',
        });
      }
      if (data.role && data.role.toUpperCase() !== user.role) {
        throw new ForbiddenException({
          code: 'SELF_EDIT_BLOCKED',
          title: 'Not Permitted',
          detail: 'You cannot change your own role.',
        });
      }
      if (data.branch_id !== undefined && (data.branch_id || null) !== (user.branch_id ?? null)) {
        throw new ForbiddenException({
          code: 'SELF_EDIT_BLOCKED',
          title: 'Not Permitted',
          detail: 'You cannot move your own account to a branch.',
        });
      }
    }

    const before = this.auditable(user);

    if (data.display_name !== undefined) user.display_name = data.display_name;
    if (data.role !== undefined) user.role = data.role.toUpperCase();
    if (data.branch_id !== undefined) user.branch_id = data.branch_id || null;
    if (data.is_active !== undefined) user.is_active = data.is_active;
    if (data.preferred_locale !== undefined) user.preferred_locale = data.preferred_locale;
    if (data.pin) user.pin_hash = await argon2.hash(data.pin);
    user.updated_by = actorId;

    const saved = await this.userRepo.save(user);
    const after = this.auditable(saved);
    const changed = (Object.keys(after) as (keyof typeof after)[]).filter((key) => before[key] !== after[key]);
    await this.auditWriter.write({
      tenantId,
      actorType: 'ADMIN',
      actorId,
      // Switching an account off or back on is the change anyone reading the trail looks for.
      action:
        changed.includes('is_active') ? (saved.is_active ? 'USER_REACTIVATED' : 'USER_DEACTIVATED') : 'USER_UPDATED',
      entityType: 'AdminUser',
      entityId: saved.id,
      branchId: saved.branch_id ?? undefined,
      correlationId,
      beforeData: before,
      afterData: after,
      details: { userId: saved.id, changed: data.pin ? [...changed, 'pin'] : changed },
    });

    const branch = saved.branch_id
      ? await this.branchRepo.findOne({ where: { id: saved.branch_id } })
      : null;
    return this.present(saved, branch?.name ?? null);
  }
}
