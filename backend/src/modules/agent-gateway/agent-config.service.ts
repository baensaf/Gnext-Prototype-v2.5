import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Printer } from '../../entities/Printer.entity';
import { PaymentDevice } from '../../entities/PaymentDevice.entity';
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
export class AgentConfigService {
  constructor(
    @InjectRepository(Printer) private readonly printerRepo: Repository<Printer>,
    @InjectRepository(PaymentDevice) private readonly deviceRepo: Repository<PaymentDevice>,
    private readonly sessions: AgentSessionsService,
    private readonly commands: AgentCommandsService,
  ) {}

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
      this.deviceRepo.find({ where: { tenant_id: tenantId, branch_id: branchId, kind: 'POS' }, order: { code: 'ASC' } }),
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
        driver: null,
        connection: null,
        charge_timeout_s: DEFAULT_CHARGE_TIMEOUT_S,
      })),
    };
  }
}
