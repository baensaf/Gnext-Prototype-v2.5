import { BadRequestException, ForbiddenException, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Agent } from '../../entities/Agent.entity';
import { AdminUser } from '../../entities/AdminUser.entity';
import { PaymentDevice } from '../../entities/PaymentDevice.entity';
import { Printer } from '../../entities/Printer.entity';
import { MANAGER_AND_ABOVE } from '../../common/decorators/roles.decorator';
import { parseDeviceConnection } from '../../common/utils/device-connection.util';
import { isHeadOfficeUser } from '../../common/utils/user-scope.util';
import { AuthService } from '../auth/auth.service';
import { SessionService } from '../auth/session.service';
import { AuditWriter } from '../audit/audit-writer.service';
import { AgentConfigService } from '../agent-gateway/agent-config.service';
import { AGENT_TERMINAL_DRIVERS } from '../payment/agent-payments.service';

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
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
    private readonly audit: AuditWriter,
    private readonly agentConfig: AgentConfigService,
  ) {}

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
