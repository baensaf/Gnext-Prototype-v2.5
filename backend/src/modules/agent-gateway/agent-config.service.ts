import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Printer } from '../../entities/Printer.entity';
import { PaymentDevice } from '../../entities/PaymentDevice.entity';
import { Agent } from '../../entities/Agent.entity';
import { AgentCommandsService } from './agent-commands.service';
import { AgentSessionsService } from './agent-sessions.service';

export interface AgentDeviceConnection {
  kind: 'windows' | 'tcp' | 'serial';
  [key: string]: unknown;
}

export interface AgentPrinterConfig {
  id: string;
  code: string;
  name: string;
  type: string;
  paper_width_mm: number;
  active: boolean;
  connection: AgentDeviceConnection | null;
}

export interface AgentTerminalConfig {
  id: string;
  code: string;
  name: string;
  active: boolean;
  driver: string | null;
  connection: AgentDeviceConnection | null;
  charge_timeout_s: number;
}

export interface AgentConfig {
  config_version: number;
  printers: AgentPrinterConfig[];
  terminals: AgentTerminalConfig[];
}

const DEFAULT_CHARGE_TIMEOUT_S = 90;

/**
 * The branch hardware an agent drives (protocol §6.1), read from the printer and payment
 * device registers. A device with no `connection` is not the agent's: it stays on the
 * simulator, and the agent reports it as not configured.
 */
@Injectable()
export class AgentConfigService implements OnApplicationBootstrap {
  constructor(
    @InjectRepository(Printer) private readonly printerRepo: Repository<Printer>,
    @InjectRepository(PaymentDevice) private readonly deviceRepo: Repository<PaymentDevice>,
    @InjectRepository(Agent) private readonly agentRepo: Repository<Agent>,
    private readonly sessions: AgentSessionsService,
    private readonly commands: AgentCommandsService,
  ) {}

  onApplicationBootstrap() {
    // The agent acked a new hardware list: its printers are ready from that version on.
    this.commands.onSettled(async (command) => {
      if (command.type !== 'config.updated' || command.status !== 'DONE') return;
      await this.markApplied(command.tenant_id, command.branch_id, Number(command.payload?.config_version) || 0);
    });
  }

  /** Records that the branch's agent has taken the hardware list up to `version`. */
  async markApplied(tenantId: string, branchId: string, version: number): Promise<void> {
    await this.agentRepo
      .createQueryBuilder()
      .update(Agent)
      .set({ config_version_applied: String(version) })
      .where('tenant_id = :tenantId AND branch_id = :branchId AND (config_version_applied IS NULL OR config_version_applied < :version)', {
        tenantId,
        branchId,
        version,
      })
      .execute();
  }

  /**
   * The branch's printers, each saying whether the branch agent has taken its current settings
   * (`agent_ready`; null for a printer the agent does not drive). A printer changed since the
   * agent last took its list is waiting for the agent, or for its error.
   */
  async printersWithAgentState(tenantId: string, branchId?: string) {
    const printers = await this.printerRepo.find({ where: { tenant_id: tenantId, ...(branchId ? { branch_id: branchId } : {}) }, order: { name: 'ASC' } });
    const branchIds = [...new Set(printers.map((p) => p.branch_id))];
    const agents = branchIds.length
      ? await this.agentRepo.find({ where: { tenant_id: tenantId, branch_id: In(branchIds), status: 'ACTIVE' } })
      : [];
    const applied = new Map(agents.map((a) => [a.branch_id, Number(a.config_version_applied || 0)]));
    return printers.map((p) => ({
      ...p,
      agent_ready: p.agent_connection
        ? Math.floor((new Date(p.updated_at).getTime() || 0) / 1000) <= (applied.get(p.branch_id) ?? -1)
        : null,
    }));
  }

  /**
   * Sends the branch's agent its current hardware list (`config.updated`, §7.7) after head
   * office changes a printer or terminal. An agent that is offline gets it in `welcome`.
   */
  async pushToBranch(tenantId: string, branchId: string): Promise<void> {
    if (!this.sessions.forBranch(tenantId, branchId)) return;
    const config = await this.forBranch(tenantId, branchId);
    await this.commands.enqueue(tenantId, branchId, 'config.updated', config, { replacePending: true });
  }

  async forBranch(tenantId: string, branchId: string): Promise<AgentConfig> {
    const [printers, devices] = await Promise.all([
      this.printerRepo.find({ where: { tenant_id: tenantId, branch_id: branchId }, order: { code: 'ASC' } }),
      this.deviceRepo.find({ where: { tenant_id: tenantId, branch_id: branchId, kind: In(['POS', 'NETWORK']) }, order: { code: 'ASC' } }),
    ]);

    const stamps = [...printers, ...devices].map((row) => new Date(row.updated_at).getTime() || 0);
    return {
      // Seconds since the epoch of the latest change: grows whenever the list changes shape.
      config_version: Math.floor(Math.max(0, ...stamps) / 1000),
      printers: printers.map((p) => ({
        id: p.id,
        code: p.code,
        name: p.name,
        type: p.printer_type,
        paper_width_mm: p.paper_width_mm,
        active: p.is_active,
        connection: p.agent_connection ?? null,
      })),
      terminals: devices.map((d) => ({
        id: d.id,
        code: d.code,
        name: d.name,
        active: d.is_active,
        // A terminal is the agent's only with both: where it is, and how to talk to it.
        driver: d.agent_connection ? d.agent_driver ?? null : null,
        connection: d.agent_driver ? d.agent_connection ?? null : null,
        charge_timeout_s: DEFAULT_CHARGE_TIMEOUT_S,
      })),
    };
  }
}
