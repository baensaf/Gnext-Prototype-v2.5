import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Agent } from '../../entities/Agent.entity';
import { AgentEnrolmentCode } from '../../entities/AgentEnrolmentCode.entity';
import { Branch } from '../../entities/Branch.entity';
import { AuditWriter } from '../audit/audit-writer.service';
import {
  ENROLMENT_CODE_TTL_MS,
  formatEnrolmentCode,
  generateEnrolmentCode,
  hashSecret,
} from './agent-credentials';
import { AGENT_CLOSE } from './agent-protocol';
import { AgentSessionsService } from './agent-sessions.service';

export interface AgentActor {
  userId?: string;
  correlationId?: string;
}

/** Fields head office may see. The key hash stays in the database. */
export type AgentView = Omit<Agent, 'key_hash'> & { branch_name?: string; branch_code?: string; connected: boolean };

export type EnrolmentCodeState = 'PENDING' | 'USED' | 'EXPIRED' | 'CANCELLED';

/**
 * Head office's side of the agent registry: hand out enrolment codes, see which branch runs
 * which agent, and revoke one. Enrolment itself (code → device key) is the agent's side.
 */
@Injectable()
export class AgentRegistryService {
  constructor(
    @InjectRepository(Agent) private readonly agentRepo: Repository<Agent>,
    @InjectRepository(AgentEnrolmentCode) private readonly codeRepo: Repository<AgentEnrolmentCode>,
    @InjectRepository(Branch) private readonly branchRepo: Repository<Branch>,
    private readonly auditWriter: AuditWriter,
    private readonly sessions: AgentSessionsService,
  ) {}

  async listAgents(tenantId: string, filter: { branchId?: string; includeRevoked?: boolean } = {}): Promise<AgentView[]> {
    const where: Record<string, any> = { tenant_id: tenantId };
    if (filter.branchId) where.branch_id = filter.branchId;
    if (!filter.includeRevoked) where.status = 'ACTIVE';
    const agents = await this.agentRepo.find({ where, order: { enrolled_at: 'DESC' } });
    const branches = await this.branchNames(tenantId);
    return agents.map((a) => this.toView(a, branches));
  }

  async getAgent(tenantId: string, id: string): Promise<AgentView> {
    const agent = await this.agentRepo.findOne({ where: { id, tenant_id: tenantId } });
    if (!agent) throw new NotFoundException('Agent not found');
    return this.toView(agent, await this.branchNames(tenantId));
  }

  /**
   * The plain code is returned here and nowhere else. Creating a code does not touch the
   * branch's current agent: that one is replaced only when the code is actually redeemed.
   */
  async createEnrolmentCode(tenantId: string, branchId: string, actor: AgentActor) {
    const branch = await this.branchRepo.findOne({ where: { id: branchId, tenant_id: tenantId } });
    if (!branch) throw new NotFoundException('Branch not found');
    if (branch.is_active === false) throw new BadRequestException('Branch is not active');

    // A collision on 31^8 is unlikely but the unique index would turn it into a 500.
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = generateEnrolmentCode();
      const codeHash = hashSecret(code);
      if (await this.codeRepo.findOne({ where: { code_hash: codeHash } })) continue;

      const saved = await this.codeRepo.save(
        this.codeRepo.create({
          tenant_id: tenantId,
          branch_id: branchId,
          code_hash: codeHash,
          expires_at: new Date(Date.now() + ENROLMENT_CODE_TTL_MS),
          created_by: actor.userId ?? null,
        }),
      );

      await this.auditWriter.write({
        tenantId,
        actorType: 'ADMIN',
        actorId: actor.userId,
        action: 'AGENT_ENROLMENT_CODE_CREATED',
        entityType: 'AgentEnrolmentCode',
        entityId: saved.id,
        branchId,
        correlationId: actor.correlationId,
        details: { expiresAt: saved.expires_at },
      });

      return {
        id: saved.id,
        branch_id: branchId,
        code: formatEnrolmentCode(code),
        expires_at: saved.expires_at,
      };
    }
    throw new ConflictException('Could not generate a unique enrolment code; try again');
  }

  async listEnrolmentCodes(tenantId: string, branchId?: string) {
    const where: Record<string, any> = { tenant_id: tenantId };
    if (branchId) where.branch_id = branchId;
    const codes = await this.codeRepo.find({ where, order: { created_at: 'DESC' }, take: 50 });
    const now = new Date();
    return codes.map(({ code_hash, ...rest }) => ({ ...rest, state: enrolmentCodeState(rest, now) }));
  }

  async cancelEnrolmentCode(tenantId: string, id: string, actor: AgentActor) {
    const code = await this.codeRepo.findOne({ where: { id, tenant_id: tenantId } });
    if (!code) throw new NotFoundException('Enrolment code not found');
    const state = enrolmentCodeState(code, new Date());
    if (state !== 'PENDING') throw new BadRequestException(`Enrolment code is already ${state.toLowerCase()}`);

    code.cancelled_at = new Date();
    await this.codeRepo.save(code);
    await this.auditWriter.write({
      tenantId,
      actorType: 'ADMIN',
      actorId: actor.userId,
      action: 'AGENT_ENROLMENT_CODE_CANCELLED',
      entityType: 'AgentEnrolmentCode',
      entityId: code.id,
      branchId: code.branch_id,
      correlationId: actor.correlationId,
    });
    const { code_hash, ...rest } = code;
    return { ...rest, state: 'CANCELLED' as EnrolmentCodeState };
  }

  async revokeAgent(tenantId: string, id: string, reason: string | undefined, actor: AgentActor): Promise<AgentView> {
    const agent = await this.agentRepo.findOne({ where: { id, tenant_id: tenantId } });
    if (!agent) throw new NotFoundException('Agent not found');
    if (agent.status === 'REVOKED') throw new BadRequestException('Agent is already revoked');

    agent.status = 'REVOKED';
    agent.revoked_at = new Date();
    agent.revoked_by = actor.userId ?? null;
    agent.revoke_reason = reason?.trim() || null;
    const saved = await this.agentRepo.save(agent);
    // Cut the PC off now, not at its next heartbeat (protocol §3.4).
    this.sessions.closeAgent(saved.id, AGENT_CLOSE.REVOKED, 'AGENT_REVOKED');

    await this.auditWriter.write({
      tenantId,
      actorType: 'ADMIN',
      actorId: actor.userId,
      action: 'AGENT_REVOKED',
      entityType: 'Agent',
      entityId: saved.id,
      branchId: saved.branch_id,
      correlationId: actor.correlationId,
      details: { reason: saved.revoke_reason, hostname: saved.hostname },
    });
    return this.toView(saved, await this.branchNames(tenantId));
  }

  private async branchNames(tenantId: string) {
    // Archived branches too: a revoked agent may belong to one.
    const branches = await this.branchRepo.find({ where: { tenant_id: tenantId }, withDeleted: true });
    return new Map(branches.map((b) => [b.id, b]));
  }

  private toView(agent: Agent, branches: Map<string, Branch>): AgentView {
    const { key_hash, ...rest } = agent;
    const branch = branches.get(agent.branch_id);
    return {
      ...rest,
      branch_name: branch?.name,
      branch_code: branch?.code,
      connected: agent.status === 'ACTIVE' && this.sessions.isConnected(agent.id),
    };
  }
}

export function enrolmentCodeState(
  code: Pick<AgentEnrolmentCode, 'used_at' | 'cancelled_at' | 'expires_at'>,
  now: Date,
): EnrolmentCodeState {
  if (code.used_at) return 'USED';
  if (code.cancelled_at) return 'CANCELLED';
  if (new Date(code.expires_at).getTime() <= now.getTime()) return 'EXPIRED';
  return 'PENDING';
}
