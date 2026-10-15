import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, EntityManager } from 'typeorm';
import { Branch } from '../../entities/Branch.entity';
import { Category } from '../../entities/Category.entity';
import { OrderHeader } from '../../entities/OrderHeader.entity';
import { PaymentMethod } from '../../entities/PaymentMethod.entity';
import { Terminal } from '../../entities/Terminal.entity';
import { TaraBranch, TaraConnection, TaraTerminal } from '../../entities/Tara.entity';
import { AuditWriter } from '../audit/audit-writer.service';
import { currentTillTerminalId } from '../../common/utils/till-context';
import { TaraClientService } from './tara-client.service';
import { TARA_DEMO_CUSTOMERS } from './tara-simulator.service';

/** The payment method a Tara sale is recorded under. */
export const TARA_KIND = 'TARA';

/** Why the till cannot take Tara right now. */
export type TaraTillBlock = 'NOT_CONNECTED' | 'NO_BRANCH_CODE' | 'NO_TERMINAL';

const taraError = (code: string, detail: string) => new BadRequestException({ code, title: 'Tara', detail });

/**
 * Setting Tara up, at head office: the chain's Tara login, each branch's Tara code and the
 * terminals Tara gives it (one per till), and which Tara product group each menu category is
 * sent under.
 */
@Injectable()
export class TaraService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly client: TaraClientService,
    private readonly auditWriter: AuditWriter,
  ) {}

  /** Everything the Tara settings page shows. */
  async getSetup(tenantId: string) {
    const em = this.dataSource.manager;
    const connection = await em.findOne(TaraConnection, { where: { tenant_id: tenantId } });
    const [branches, codes, terminals, registers, categories, method] = await Promise.all([
      em.find(Branch, { where: { tenant_id: tenantId, is_active: true }, order: { name: 'ASC' } }),
      em.find(TaraBranch, { where: { tenant_id: tenantId } }),
      em.find(TaraTerminal, { where: { tenant_id: tenantId }, order: { terminal_code: 'ASC' } }),
      em.find(Terminal, { where: { tenant_id: tenantId, is_active: true, terminal_type: 'CASHIER' }, order: { code: 'ASC' } }),
      em.find(Category, { where: { tenant_id: tenantId, is_active: true }, order: { sort_order: 'ASC', name: 'ASC' } }),
      em.findOne(PaymentMethod, { where: { tenant_id: tenantId, kind: TARA_KIND } }),
    ]);
    return {
      connection: connection
        ? {
            username: connection.username,
            connected: !!connection.access_code,
            connected_at: connection.connected_at,
            groups: connection.groups,
            default_group_id: connection.default_group_id ? Number(connection.default_group_id) : null,
            category_groups: connection.category_groups,
          }
        : null,
      method: method ? { id: method.id, is_active: method.is_active } : null,
      branches: branches.map((b) => {
        const code = codes.find((c) => c.branch_id === b.id);
        return {
          branch_id: b.id,
          name: b.name,
          branch_code: code?.branch_code ?? null,
          terminals_fetched_at: code?.terminals_fetched_at ?? null,
          terminals: terminals
            .filter((t) => t.branch_id === b.id)
            .map((t) => ({ id: t.id, terminal_code: t.terminal_code, terminal_title: t.terminal_title, register_id: t.register_id })),
          registers: registers.filter((r) => r.branch_id === b.id).map((r) => ({ id: r.id, name: r.name, code: r.code })),
        };
      }),
      categories: categories.map((c) => ({ id: c.id, name: c.name })),
    };
  }

  /** Logs in to Tara, fetches its product groups and turns the Tara payment method on. */
  async connect(tenantId: string, dto: { username: string; password?: string }, userId?: string) {
    const username = String(dto.username || '').trim();
    const existing = await this.dataSource.manager.findOne(TaraConnection, { where: { tenant_id: tenantId } });
    // Left empty when only the username changes: the saved password is used again.
    const password = String(dto.password || '') || existing?.password || '';
    if (!username || !password) throw taraError('TARA_LOGIN_REQUIRED', 'Enter the Tara username and password.');

    const login = await this.client.login(tenantId, username, password);
    if (!login.ok) throw taraError('TARA_LOGIN_FAILED', login.message);
    const groups = await this.client.merchandiseGroups(tenantId, login.body.accessCode);
    if (!groups.ok) throw taraError('TARA_GROUPS_FAILED', groups.message);

    await this.dataSource.transaction(async (em) => {
      const row = existing ?? em.create(TaraConnection, { tenant_id: tenantId, category_groups: {} });
      row.username = username;
      row.password = password;
      row.access_code = login.body.accessCode;
      row.connected_at = new Date();
      row.groups = groups.body;
      if (!row.default_group_id || !groups.body.some((g) => String(g.id) === String(row.default_group_id))) {
        row.default_group_id = String(groups.body[0]?.id ?? '') || null;
      }
      await em.save(TaraConnection, row);
      await this.setMethodActive(em, tenantId, true);
    });
    await this.auditWriter.write({
      tenantId,
      actorType: 'ADMIN',
      actorId: userId,
      action: 'TARA_CONNECTED',
      entityType: 'TaraConnection',
      entityId: tenantId,
      afterData: { username },
    });
    return await this.getSetup(tenantId);
  }

  /** Stops offering Tara at the tills. The branch codes and terminals stay for next time. */
  async disconnect(tenantId: string, userId?: string) {
    await this.dataSource.transaction(async (em) => {
      await em.update(TaraConnection, { tenant_id: tenantId }, { access_code: null, connected_at: null });
      await this.setMethodActive(em, tenantId, false);
    });
    await this.auditWriter.write({
      tenantId,
      actorType: 'ADMIN',
      actorId: userId,
      action: 'TARA_DISCONNECTED',
      entityType: 'TaraConnection',
      entityId: tenantId,
    });
    return await this.getSetup(tenantId);
  }

  /**
   * Saves a branch's Tara code and fetches its terminals from Tara, each with its own token.
   * They go to the branch's tills in order; a till left over has no Tara terminal.
   */
  async setBranchCode(tenantId: string, branchId: string, branchCode: string, userId?: string) {
    const code = String(branchCode || '').trim();
    const connection = await this.requireConnection(tenantId);
    const branch = await this.dataSource.manager.findOne(Branch, { where: { id: branchId, tenant_id: tenantId } });
    if (!branch) throw new NotFoundException(`Branch ${branchId} not found`);

    if (!code) {
      await this.dataSource.transaction(async (em) => {
        await em.delete(TaraTerminal, { tenant_id: tenantId, branch_id: branchId });
        await em.delete(TaraBranch, { tenant_id: tenantId, branch_id: branchId });
      });
      return await this.getSetup(tenantId);
    }

    const answer = await this.client.merchantAccessCode(tenantId, connection.access_code!, code);
    if (!answer.ok) throw taraError('TARA_BRANCH_CODE_FAILED', answer.message);

    await this.dataSource.transaction(async (em) => {
      await em.save(TaraBranch, em.create(TaraBranch, { branch_id: branchId, tenant_id: tenantId, branch_code: code, terminals_fetched_at: new Date() }));
      // A terminal Tara still lists keeps the till it was given; the rest are handed out afresh.
      const before = await em.find(TaraTerminal, { where: { tenant_id: tenantId, branch_id: branchId } });
      await em.delete(TaraTerminal, { tenant_id: tenantId, branch_id: branchId });
      const registers = await em.find(Terminal, {
        where: { tenant_id: tenantId, branch_id: branchId, is_active: true, terminal_type: 'CASHIER' },
        order: { code: 'ASC' },
      });
      const kept = new Map(before.filter((t) => t.register_id).map((t) => [t.terminal_code, t.register_id!]));
      const taken = new Set([...kept.values()].filter((id) => registers.some((r) => r.id === id)));
      const free = registers.filter((r) => !taken.has(r.id));
      for (const t of answer.body) {
        const keep = kept.get(t.terminalCode);
        const registerId = keep && taken.has(keep) ? keep : (free.shift()?.id ?? null);
        await em.save(
          TaraTerminal,
          em.create(TaraTerminal, {
            tenant_id: tenantId,
            branch_id: branchId,
            terminal_code: t.terminalCode,
            terminal_title: t.terminalTitle,
            merchant_code: t.merchantCode,
            access_code: t.accessCode,
            register_id: registerId,
          }),
        );
      }
    });
    await this.auditWriter.write({
      tenantId,
      actorType: 'ADMIN',
      actorId: userId,
      action: 'TARA_BRANCH_CODE_SET',
      entityType: 'Branch',
      entityId: branchId,
      branchId,
      afterData: { branch_code: code, terminals: answer.body.map((t) => t.terminalCode) },
    });
    return await this.getSetup(tenantId);
  }

  /** Gives a Tara terminal to a till (or takes it away). A till has one Tara terminal at most. */
  async assignTerminal(tenantId: string, terminalId: string, registerId: string | null) {
    await this.dataSource.transaction(async (em) => {
      const terminal = await em.findOne(TaraTerminal, { where: { id: terminalId, tenant_id: tenantId } });
      if (!terminal) throw new NotFoundException(`Tara terminal ${terminalId} not found`);
      if (registerId) {
        const register = await em.findOne(Terminal, { where: { id: registerId, tenant_id: tenantId } });
        if (!register || register.branch_id !== terminal.branch_id) {
          throw taraError('TARA_REGISTER_OTHER_BRANCH', 'Pick a till at the same branch as the Tara terminal.');
        }
        await em.update(TaraTerminal, { tenant_id: tenantId, register_id: registerId }, { register_id: null });
      }
      await em.update(TaraTerminal, { id: terminalId }, { register_id: registerId });
    });
    return await this.getSetup(tenantId);
  }

  /** Which Tara group each category is sent under, and the group for the rest. */
  async saveGroups(tenantId: string, dto: { defaultGroupId?: number | null; categoryGroups?: Record<string, number | null> }) {
    const connection = await this.requireConnection(tenantId);
    const known = new Set(connection.groups.map((g) => Number(g.id)));
    const map: Record<string, number> = {};
    for (const [categoryId, groupId] of Object.entries(dto.categoryGroups || {})) {
      if (groupId === null || groupId === undefined || (groupId as any) === '') continue;
      if (!known.has(Number(groupId))) throw taraError('TARA_GROUP_UNKNOWN', `Tara has no product group ${groupId}.`);
      map[categoryId] = Number(groupId);
    }
    const fallback = dto.defaultGroupId ?? null;
    if (fallback !== null && !known.has(Number(fallback))) throw taraError('TARA_GROUP_UNKNOWN', `Tara has no product group ${fallback}.`);
    if (fallback === null) throw taraError('TARA_DEFAULT_GROUP_REQUIRED', 'Pick the group unmapped categories are sent under.');
    connection.category_groups = map;
    connection.default_group_id = String(fallback);
    await this.dataSource.manager.save(TaraConnection, connection);
    return await this.getSetup(tenantId);
  }

  /** Fetches Tara's product groups again; mappings to a group Tara dropped fall back to the default. */
  async refreshGroups(tenantId: string) {
    const connection = await this.requireConnection(tenantId);
    const groups = await this.client.merchandiseGroups(tenantId, connection.access_code!);
    if (!groups.ok) throw taraError('TARA_GROUPS_FAILED', groups.message);
    const known = new Set(groups.body.map((g) => Number(g.id)));
    connection.groups = groups.body;
    connection.category_groups = Object.fromEntries(Object.entries(connection.category_groups || {}).filter(([, g]) => known.has(Number(g))));
    if (!connection.default_group_id || !known.has(Number(connection.default_group_id))) {
      connection.default_group_id = String(groups.body[0]?.id ?? '') || null;
    }
    await this.dataSource.manager.save(TaraConnection, connection);
    return await this.getSetup(tenantId);
  }

  /** The till's question for an order: the order's branch, and only within the asker's own branch. */
  async tillStatusFor(tenantId: string, orderId: string | null, branchId: string | null | undefined, userBranchId?: string) {
    const order = orderId ? await this.dataSource.manager.findOne(OrderHeader, { where: { id: orderId, tenant_id: tenantId } }) : null;
    if (order && userBranchId && order.branch_id !== userBranchId) throw new NotFoundException(`Order ${orderId} not found`);
    return await this.tillStatus(tenantId, order?.branch_id || branchId, order?.terminal_id);
  }

  /** Whether the till the request comes from can take Tara, and through which terminal. */
  async tillStatus(tenantId: string, branchId: string | null | undefined, registerId?: string | null) {
    const found = await this.terminalFor(this.dataSource.manager, tenantId, branchId, registerId);
    return 'block' in found
      ? { available: false, reason: found.block }
      : { available: true, terminal_title: found.terminal.terminal_title, terminal_code: found.terminal.terminal_code };
  }

  /**
   * The Tara terminal a sale at this till goes through: the till's own, or, on a device that is
   * not set up as a till, the branch's first.
   */
  async terminalFor(
    em: EntityManager,
    tenantId: string,
    branchId: string | null | undefined,
    registerId?: string | null,
  ): Promise<{ terminal: TaraTerminal } | { block: TaraTillBlock }> {
    const connection = await em.findOne(TaraConnection, { where: { tenant_id: tenantId } });
    const method = await em.findOne(PaymentMethod, { where: { tenant_id: tenantId, kind: TARA_KIND, is_active: true } });
    if (!connection?.access_code || !method) return { block: 'NOT_CONNECTED' };
    if (!branchId) return { block: 'NO_BRANCH_CODE' };
    const code = await em.findOne(TaraBranch, { where: { tenant_id: tenantId, branch_id: branchId } });
    if (!code) return { block: 'NO_BRANCH_CODE' };
    const register = currentTillTerminalId() || registerId || null;
    const terminals = await em.find(TaraTerminal, { where: { tenant_id: tenantId, branch_id: branchId }, order: { terminal_code: 'ASC' } });
    const own = register ? terminals.find((t) => t.register_id === register) : undefined;
    if (own) return { terminal: own };
    // A device set up as a till that got no Tara terminal: that till does not take Tara.
    if (register && (await em.count(Terminal, { where: { id: register, tenant_id: tenantId } }))) return { block: 'NO_TERMINAL' };
    return terminals[0] ? { terminal: terminals[0] } : { block: 'NO_TERMINAL' };
  }

  /** The barcodes the simulated Tara knows, with what each one does. */
  demoCustomers() {
    return TARA_DEMO_CUSTOMERS.map(({ barcode, outcome, limit }) => ({ barcode, outcome, limit: String(limit) }));
  }

  async requireConnection(tenantId: string, em: EntityManager = this.dataSource.manager): Promise<TaraConnection> {
    const connection = await em.findOne(TaraConnection, { where: { tenant_id: tenantId } });
    if (!connection?.access_code) throw taraError('TARA_NOT_CONNECTED', 'Connect Tara first: Settings → Tara.');
    return connection;
  }

  private async setMethodActive(em: EntityManager, tenantId: string, active: boolean) {
    const method = await em.findOne(PaymentMethod, { where: [{ tenant_id: tenantId, kind: TARA_KIND }, { tenant_id: tenantId, code: TARA_KIND }] });
    if (method) {
      method.kind = TARA_KIND;
      method.is_active = active;
      await em.save(PaymentMethod, method);
    } else if (active) {
      await em.save(PaymentMethod, em.create(PaymentMethod, { tenant_id: tenantId, code: TARA_KIND, name: 'تارا', kind: TARA_KIND, is_active: true }));
    }
  }

  /** Category ids of the products given, for the invoice's product groups. */
  async categoriesOf(em: EntityManager, tenantId: string, productIds: string[]) {
    if (!productIds.length) return new Map<string, string>();
    const rows: Array<{ id: string; category_id: string }> = await em.query(
      `SELECT id, category_id FROM product WHERE tenant_id = $1 AND id = ANY($2)`,
      [tenantId, productIds],
    );
    return new Map(rows.map((r) => [r.id, r.category_id]));
  }
}

