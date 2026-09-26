import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThan, Repository } from 'typeorm';
import * as argon2 from 'argon2';
import { Agent } from '../../entities/Agent.entity';
import { AdminUser } from '../../entities/AdminUser.entity';
import { PaymentDevice } from '../../entities/PaymentDevice.entity';
import { PinAttemptLog } from '../../entities/PinAttemptLog.entity';
import { Printer } from '../../entities/Printer.entity';
import { MANAGER_AND_ABOVE } from '../../common/decorators/roles.decorator';
import { parseDeviceConnection } from '../../common/utils/device-connection.util';
import { isHeadOfficeUser, isValidPin } from '../../common/utils/user-scope.util';
import { AuthService } from '../auth/auth.service';
import { SessionService } from '../auth/session.service';
import { AuditWriter } from '../audit/audit-writer.service';
import { AgentConfigService } from '../agent-gateway/agent-config.service';
import { AgentSessionsService } from '../agent-gateway/agent-sessions.service';
import { OFFLINE_TILL_ROLES } from '../agent-data/agent-data.service';
import { AGENT_TERMINAL_DRIVERS } from '../payment/agent-payments.service';
import { detachPrinter } from '../printing/print-routing.service';

/** The PIN log's action for a till sign-in (agent-protocol.md §16.3). */
export const TILL_SIGN_IN = 'TILL_SIGN_IN';
const PIN_WINDOW_MS = 15 * 60 * 1000;
/** Wrong PINs for one user, any kind, before that user is locked for the window. */
const USER_PIN_LIMIT = 5;
/** Wrong till sign-in PINs across a branch before every user of it is locked for the window. */
const BRANCH_PIN_LIMIT = 20;

/** Who is signed in to an agent's local settings page. */
export type LocalActor = { agent: Agent; user: AdminUser; correlationId?: string };

const PRINTER_TYPES = ['THERMAL_RECEIPT', 'KITCHEN_IMPACT', 'LABEL'];
const CODE = /^[A-Za-z0-9_-]{1,32}$/;

function bad(detail: string): BadRequestException {
  return new BadRequestException({ code: 'INVALID_PAYLOAD', title: 'Invalid Device', detail });
}

function text(value: unknown, field: string, max: number): string {
  const s = String(value ?? '').trim();
  if (!s || s.length > max) throw bad(`Enter ${field} (at most ${max} characters).`);
  return s;
}

/**
 * The agent's local settings page (agent/internal/localui) changes its own branch's printers
 * and terminals through here. Two credentials meet: the device key names the branch, and a
 * signed-in manager's session says who is making the change. The branch never comes from the
 * request body.
 */
@Injectable()
export class AgentLocalService {
  constructor(
    @InjectRepository(AdminUser) private readonly userRepo: Repository<AdminUser>,
    @InjectRepository(Printer) private readonly printerRepo: Repository<Printer>,
    @InjectRepository(PaymentDevice) private readonly deviceRepo: Repository<PaymentDevice>,
    @InjectRepository(PinAttemptLog) private readonly pinLogRepo: Repository<PinAttemptLog>,
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
    private readonly audit: AuditWriter,
    private readonly agentConfig: AgentConfigService,
    private readonly agentSessions: AgentSessionsService,
  ) {}

  /**
   * A cloud session for the cashier signing in at the agent's till, by their PIN (§16.3). The
   * user must be one the staff list carries (§13.3), so nobody gets a session here who could
   * not sign in offline. There is no default PIN. Wrong PINs lock the user, and enough of them
   * across the branch lock the whole branch, so a device key alone cannot walk the staff list.
   */
  async pinLogin(agent: Agent, body: any, ip?: string, correlationId?: string) {
    if (!this.agentSessions.get(agent.id)?.capabilities.includes('pos.till')) {
      throw new ForbiddenException({
        code: 'CAPABILITY_REQUIRED',
        title: 'Online till not advertised',
        detail: 'Only an agent connected with the pos.till capability may sign cashiers in.',
      });
    }
    const userId = String(body?.user_id ?? '');
    const pin = String(body?.pin ?? '');
    if (!/^[0-9a-f-]{36}$/i.test(userId) || !isValidPin(pin)) throw bad('Choose a user and enter their PIN (4 to 8 digits).');

    const user = await this.userRepo.findOneBy({ id: userId });
    const role = (user?.role || '').toUpperCase();
    if (
      !user ||
      !user.is_active ||
      user.tenant_id !== agent.tenant_id ||
      user.branch_id !== agent.branch_id ||
      !OFFLINE_TILL_ROLES.includes(role) ||
      !user.pin_hash
    ) {
      throw new ForbiddenException({
        code: 'FORBIDDEN_ROLE',
        title: 'Not Permitted',
        detail: "Only this branch's staff with a PIN can sign in at its till.",
      });
    }

    const windowStart = new Date(Date.now() - PIN_WINDOW_MS);
    const branchFailures = await this.pinLogRepo
      .createQueryBuilder('l')
      .where('l.tenant_id = :tenant AND l.action = :action AND l.is_success = false AND l.attempted_at > :since', {
        tenant: agent.tenant_id,
        action: TILL_SIGN_IN,
        since: windowStart,
      })
      .andWhere('l.user_id IN (SELECT u.id FROM admin_user u WHERE u.tenant_id = :tenant AND u.branch_id = :branch)', {
        branch: agent.branch_id,
      })
      .getCount();
    if (branchFailures >= BRANCH_PIN_LIMIT) {
      throw new HttpException(
        { code: 'TILL_SIGN_IN_LOCKED', title: 'Too Many Wrong PINs', detail: 'Too many wrong PINs at this branch. Try again in 15 minutes.' },
        423, // Locked
      );
    }
    const userFailures = await this.pinLogRepo.count({
      where: { tenant_id: agent.tenant_id, user_id: user.id, is_success: false, attempted_at: MoreThan(windowStart) },
    });
    if (userFailures >= USER_PIN_LIMIT) {
      throw new HttpException(
        { code: 'PIN_LOCKED', title: 'Too Many Wrong PINs', detail: 'Five wrong PINs. This user is locked for 15 minutes.' },
        423, // Locked
      );
    }

    let ok = false;
    try {
      ok = await argon2.verify(user.pin_hash, pin);
    } catch {
      ok = false;
    }
    await this.pinLogRepo.save(this.pinLogRepo.create({ tenant_id: agent.tenant_id, user_id: user.id, action: TILL_SIGN_IN, is_success: ok }));
    if (!ok) {
      await this.audit.write({
        tenantId: agent.tenant_id,
        actorType: 'ADMIN',
        actorId: user.id,
        action: 'AUTH_LOGIN_FAILED',
        correlationId: correlationId || '00000000-0000-0000-0000-000000000000',
        ip,
        details: { method: 'TILL_PIN', agent_id: agent.id, reason: 'PIN_WRONG' },
      });
      throw new UnauthorizedException({ code: 'PIN_WRONG', title: 'Wrong PIN', detail: 'The PIN is wrong.' });
    }

    const result = await this.auth.openSession(user, {
      ip,
      userAgent: `gnext-till/${agent.id}`,
      correlationId,
      details: { method: 'TILL_PIN', agent_id: agent.id },
    });
    return { session_token: result.sessionToken, csrf_token: result.csrfToken, user: result.user, tenant: result.tenant };
  }

  /** Signs a user in for the agent's page. Only someone who may manage this branch gets a session. */
  async login(agent: Agent, body: any, ip?: string, correlationId?: string) {
    const username = String(body?.username ?? '');
    const password = String(body?.password ?? '');
    if (!username || !password) throw bad('Enter the username and password.');
    const result = await this.auth.login(username, password, ip, 'gnext-agent-local-ui', correlationId);
    const user = await this.userRepo.findOneByOrFail({ id: result.user.id });
    try {
      this.assertMayManage(agent, user);
    } catch (err) {
      await this.sessions.revokeSession(result.sessionToken);
      throw err;
    }
    return {
      session_token: result.sessionToken,
      user: { id: user.id, username: user.username, display_name: user.display_name, role: user.role },
    };
  }

  async logout(sessionToken: string) {
    if (sessionToken) await this.sessions.revokeSession(sessionToken);
    return { ok: true };
  }

  /** Resolves the session the agent forwarded, and checks it may manage the agent's branch. */
  async actor(agent: Agent, sessionToken: string | undefined, correlationId?: string): Promise<LocalActor> {
    const session = sessionToken ? await this.sessions.findValidSession(sessionToken) : null;
    if (!session) {
      throw new UnauthorizedException({ code: 'UNAUTHENTICATED', title: 'Not Signed In', detail: 'Sign in on the agent page to change devices.' });
    }
    const user = await this.userRepo.findOneBy({ id: session.user_id });
    if (!user || !user.is_active) {
      throw new UnauthorizedException({ code: 'USER_INACTIVE', title: 'User Disabled', detail: 'This account is disabled.' });
    }
    this.assertMayManage(agent, user);
    return { agent, user, correlationId };
  }

  private assertMayManage(agent: Agent, user: AdminUser) {
    const role = (user.role || '').toUpperCase();
    const sameTenant = user.tenant_id === agent.tenant_id;
    const inScope = isHeadOfficeUser({ role, branchId: user.branch_id ?? null }) || user.branch_id === agent.branch_id;
    if (!sameTenant || !inScope || !MANAGER_AND_ABOVE.includes(role)) {
      throw new ForbiddenException({
        code: 'FORBIDDEN_ROLE',
        title: 'Not Permitted',
        detail: "Only this branch's manager or head office can change the agent's devices.",
      });
    }
  }

  async createPrinter(a: LocalActor, body: any) {
    const printer = this.printerRepo.create({
      tenant_id: a.agent.tenant_id,
      branch_id: a.agent.branch_id,
      ...this.printerFields(body, true),
    } as Partial<Printer>);
    const saved = await this.printerRepo.save(printer);
    await this.changed(a, 'PRINTER_CREATED', 'Printer', saved.id, null, saved);
    return saved;
  }

  async updatePrinter(a: LocalActor, id: string, body: any) {
    const printer = await this.ownPrinter(a, id);
    const before = { ...printer };
    Object.assign(printer, this.printerFields(body, false));
    const saved = await this.printerRepo.save(printer);
    await this.changed(a, 'PRINTER_UPDATED', 'Printer', saved.id, before, saved);
    return saved;
  }

  async deletePrinter(a: LocalActor, id: string) {
    const printer = await this.ownPrinter(a, id);
    await this.printerRepo.softDelete({ id: printer.id });
    await detachPrinter(this.printerRepo.manager, printer.tenant_id, printer.id);
    await this.changed(a, 'PRINTER_DELETED', 'Printer', printer.id, printer, null);
    return { ok: true };
  }

  async createTerminal(a: LocalActor, body: any) {
    const fields = this.terminalFields(body, true);
    const device = this.deviceRepo.create({
      tenant_id: a.agent.tenant_id,
      branch_id: a.agent.branch_id,
      kind: 'POS',
      ownership: 'COMPANY',
      is_active: true,
      ...fields,
    } as Partial<PaymentDevice>);
    const saved = await this.deviceRepo.save(device);
    await this.changed(a, 'PAYMENT_DEVICE_CREATED', 'PaymentDevice', saved.id, null, saved);
    return saved;
  }

  async updateTerminal(a: LocalActor, id: string, body: any) {
    const device = await this.ownTerminal(a, id);
    const before = { ...device };
    Object.assign(device, this.terminalFields(body, false));
    const saved = await this.deviceRepo.save(device);
    await this.changed(a, 'PAYMENT_DEVICE_UPDATED', 'PaymentDevice', saved.id, before, saved);
    return saved;
  }

  /** Terminals keep their payment history, so removing one retires it rather than deleting it. */
  async removeTerminal(a: LocalActor, id: string) {
    const device = await this.ownTerminal(a, id);
    const before = { ...device };
    device.is_active = false;
    device.agent_connection = null;
    device.agent_driver = null;
    await this.deviceRepo.save(device);
    await this.changed(a, 'PAYMENT_DEVICE_RETIRED', 'PaymentDevice', device.id, before, device);
    return { ok: true };
  }

  private printerFields(body: any, creating: boolean): Partial<Printer> {
    const out: Partial<Printer> = {};
    if (creating || body?.code !== undefined) {
      const code = text(body?.code, 'a printer code', 32);
      if (!CODE.test(code)) throw bad('Printer code may use letters, digits, - and _ only.');
      out.code = code.toUpperCase();
    }
    if (creating || body?.name !== undefined) out.name = text(body?.name, 'a printer name', 160);
    if (creating || body?.printer_type !== undefined) {
      const type = String(body?.printer_type ?? 'THERMAL_RECEIPT').toUpperCase();
      if (!PRINTER_TYPES.includes(type)) throw bad(`Printer type must be one of: ${PRINTER_TYPES.join(', ')}.`);
      out.printer_type = type;
    }
    if (creating || body?.paper_width_mm !== undefined) {
      const width = Number(body?.paper_width_mm ?? 80);
      if (![58, 80].includes(width)) throw bad('Paper width must be 58 or 80 mm.');
      out.paper_width_mm = width;
    }
    if (body?.active !== undefined) out.is_active = body.active !== false;
    if (creating || body?.connection !== undefined) {
      out.agent_connection = parseDeviceConnection(body?.connection, ['tcp', 'windows', 'serial']);
    }
    return out;
  }

  private terminalFields(body: any, creating: boolean): Partial<PaymentDevice> {
    const out: Partial<PaymentDevice> = {};
    if (creating || body?.code !== undefined) {
      const code = text(body?.code, 'a terminal code', 40);
      if (!CODE.test(code)) throw bad('Terminal code may use letters, digits, - and _ only.');
      out.code = code.toUpperCase();
    }
    if (creating || body?.name !== undefined) out.name = text(body?.name, 'a terminal name', 120);
    if (body?.active !== undefined) out.is_active = body.active !== false;
    if (creating || body?.connection !== undefined || body?.driver !== undefined) {
      const connection = parseDeviceConnection(body?.connection, ['tcp', 'serial']);
      if (!connection) throw bad('Enter how the agent reaches the terminal.');
      const driver = String(body?.driver ?? '').trim().toLowerCase();
      if (!AGENT_TERMINAL_DRIVERS.includes(driver)) throw bad(`Terminal driver must be one of: ${AGENT_TERMINAL_DRIVERS.join(', ')}.`);
      out.agent_connection = connection;
      out.agent_driver = driver;
    }
    return out;
  }

  private async ownPrinter(a: LocalActor, id: string) {
    const printer = await this.printerRepo.findOneBy({ id, tenant_id: a.agent.tenant_id, branch_id: a.agent.branch_id });
    if (!printer) throw new NotFoundException({ code: 'NOT_FOUND', title: 'Not Found', detail: 'No such printer in this branch.' });
    return printer;
  }

  private async ownTerminal(a: LocalActor, id: string) {
    const device = await this.deviceRepo.findOneBy({ id, tenant_id: a.agent.tenant_id, branch_id: a.agent.branch_id });
    if (!device || !device.is_active) {
      throw new NotFoundException({ code: 'NOT_FOUND', title: 'Not Found', detail: 'No such terminal in this branch.' });
    }
    return device;
  }

  /** Audits the change under the signed-in user and sends the agent its new device list. */
  private async changed(a: LocalActor, action: string, entityType: string, entityId: string, before: unknown, after: unknown) {
    await this.audit.write({
      tenantId: a.agent.tenant_id,
      actorType: 'ADMIN',
      actorId: a.user.id,
      action,
      entityType,
      entityId,
      branchId: a.agent.branch_id,
      correlationId: a.correlationId,
      beforeData: before ?? undefined,
      afterData: after ?? undefined,
      details: { via: 'agent-local-ui', agent_id: a.agent.id },
    } as any);
    await this.agentConfig.pushToBranch(a.agent.tenant_id, a.agent.branch_id).catch(() => undefined);
  }
}
