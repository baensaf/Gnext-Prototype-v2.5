import { BadRequestException, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Agent } from '../../entities/Agent.entity';
import { AgentEnrolmentCode } from '../../entities/AgentEnrolmentCode.entity';
import { Branch } from '../../entities/Branch.entity';
import { AuditWriter } from '../audit/audit-writer.service';
import { generateDeviceKey, hashSecret, normaliseEnrolmentCode } from './agent-credentials';
import { enrolmentCodeState } from './agent-registry.service';
import { AGENT_CLOSE, AgentSessionsService } from './agent-sessions.service';

/** Protocol versions this backend speaks (protocol §4.2). */
export const SUPPORTED_PROTOCOL_VERSIONS = [1];

/** Failed codes allowed per client address in the window (protocol §3.3). */
const MAX_FAILED_ENROLMENTS = 5;
const FAILED_ENROLMENT_WINDOW_MS = 15 * 60 * 1000;

export interface EnrolRequest {
  code: string;
  agent_version?: string;
  protocol_version?: number;
  machine?: { hostname?: string; os?: string; machine_id?: string };
}

export interface EnrolResponse {
  agent_id: string;
  tenant_id: string;
  branch_id: string;
  branch_name: string;
  device_key: string;
  ws_url: string;
}

function enrolError(code: string, detail: string) {
  return new BadRequestException({ code, title: 'Enrolment Refused', detail });
}

/** Keeps what the agent sent to the length of the column, and nothing that is not a string. */
function text(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

/**
 * The body arrives as plain JSON rather than a validated DTO: the protocol lets an agent send
 * fields this version does not know, and the global pipe would refuse them.
 */
export function parseEnrolRequest(body: unknown): EnrolRequest {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw enrolError('INVALID_PAYLOAD', 'Expected a JSON object.');
  }
  const b = body as Record<string, any>;
  if (typeof b.code !== 'string' || !b.code.trim()) {
    throw enrolError('INVALID_PAYLOAD', 'code is required.');
  }
  if (b.protocol_version !== undefined && !Number.isInteger(b.protocol_version)) {
    throw enrolError('INVALID_PAYLOAD', 'protocol_version must be an integer.');
  }
  const machine = b.machine && typeof b.machine === 'object' && !Array.isArray(b.machine) ? b.machine : {};
  return {
    code: b.code,
    agent_version: text(b.agent_version, 32) ?? undefined,
    protocol_version: b.protocol_version,
    machine: {
      hostname: text(machine.hostname, 128) ?? undefined,
      os: text(machine.os, 128) ?? undefined,
      machine_id: text(machine.machine_id, 64) ?? undefined,
    },
  };
}

/**
 * Counts failed codes per client address, in memory. Enough to stop someone walking the
 * code space from one address; the codes themselves carry about 40 bits and live 24 hours.
 */
export class EnrolmentRateLimiter {
  private readonly failures = new Map<string, number[]>();

  constructor(
    private readonly max = MAX_FAILED_ENROLMENTS,
    private readonly windowMs = FAILED_ENROLMENT_WINDOW_MS,
  ) {}

  /** Seconds until the address may try again, or 0 when it may try now. */
  retryAfter(key: string, now = Date.now()): number {
    const recent = this.recent(key, now);
    if (recent.length < this.max) return 0;
    return Math.max(1, Math.ceil((recent[0] + this.windowMs - now) / 1000));
  }

  recordFailure(key: string, now = Date.now()): void {
    const recent = this.recent(key, now);
    recent.push(now);
    this.failures.set(key, recent);
  }

  private recent(key: string, now: number): number[] {
    const kept = (this.failures.get(key) || []).filter((t) => now - t < this.windowMs);
    if (kept.length) this.failures.set(key, kept);
    else this.failures.delete(key);
    return kept;
  }
}

@Injectable()
export class AgentEnrolmentService {
  private readonly limiter = new EnrolmentRateLimiter();

  constructor(
    private readonly dataSource: DataSource,
    private readonly sessions: AgentSessionsService,
    private readonly auditWriter: AuditWriter,
  ) {}

  /**
   * Trades a one-time code for a device key (protocol §3.3). Redeeming a code for a branch
   * that already has an agent revokes that agent: the branch has had its PC replaced.
   */
  async enrol(body: unknown, context: { clientKey: string; wsUrl: string }): Promise<EnrolResponse> {
    const retryAfter = this.limiter.retryAfter(context.clientKey);
    if (retryAfter > 0) {
      throw new HttpException(
        {
          code: 'RATE_LIMITED',
          title: 'Too Many Attempts',
          detail: `Too many failed enrolment codes. Try again in ${retryAfter} seconds.`,
          context: { retryAfter },
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const request = parseEnrolRequest(body);
    const protocolVersion = request.protocol_version ?? 1;
    if (!SUPPORTED_PROTOCOL_VERSIONS.includes(protocolVersion)) {
      throw enrolError(
        'PROTOCOL_UNSUPPORTED',
        `Protocol version ${protocolVersion} is not supported. Supported: ${SUPPORTED_PROTOCOL_VERSIONS.join(', ')}.`,
      );
    }

    const codeHash = hashSecret(normaliseEnrolmentCode(request.code));
    const deviceKey = generateDeviceKey();

    let result: { agent: Agent; replaced: Agent | null; branch: Branch };
    try {
      result = await this.dataSource.transaction(async (em) => {
        const code = await em.findOne(AgentEnrolmentCode, {
          where: { code_hash: codeHash },
          lock: { mode: 'pessimistic_write' },
        });
        if (!code) throw enrolError('ENROLMENT_CODE_INVALID', 'The enrolment code is not valid.');

        const state = enrolmentCodeState(code, new Date());
        if (state === 'USED') throw enrolError('ENROLMENT_CODE_USED', 'The enrolment code has already been used.');
        if (state !== 'PENDING') {
          // A cancelled code reads as expired to the installer: either way, ask for a new one.
          throw enrolError('ENROLMENT_CODE_EXPIRED', 'The enrolment code has expired. Ask head office for a new one.');
        }

        const branch = await em.findOne(Branch, { where: { id: code.branch_id, tenant_id: code.tenant_id } });
        if (!branch || branch.is_active === false) {
          throw enrolError('ENROLMENT_CODE_INVALID', 'The branch for this code is no longer active.');
        }

        const now = new Date();
        const replaced = await em.findOne(Agent, {
          where: { tenant_id: code.tenant_id, branch_id: code.branch_id, status: 'ACTIVE' },
          lock: { mode: 'pessimistic_write' },
        });
        if (replaced) {
          replaced.status = 'REVOKED';
          replaced.revoked_at = now;
          replaced.revoked_by = code.created_by ?? null;
          replaced.revoke_reason = 'Replaced by a newly enrolled agent';
          await em.save(Agent, replaced);
        }

        const agent = await em.save(
          Agent,
          em.create(Agent, {
            tenant_id: code.tenant_id,
            branch_id: code.branch_id,
            status: 'ACTIVE',
            key_hash: hashSecret(deviceKey),
            agent_version: request.agent_version ?? null,
            protocol_version: protocolVersion,
            hostname: request.machine?.hostname ?? null,
            os: request.machine?.os ?? null,
            machine_id: request.machine?.machine_id ?? null,
            enrolment_code_id: code.id,
            enrolled_at: now,
            last_seen_at: now,
          }),
        );

        code.used_at = now;
        code.agent_id = agent.id;
        await em.save(AgentEnrolmentCode, code);

        if (replaced) {
          await this.auditWriter.writeInTransaction(em, {
            tenantId: code.tenant_id,
            actorType: 'SYSTEM',
            action: 'AGENT_REVOKED',
            entityType: 'Agent',
            entityId: replaced.id,
            branchId: code.branch_id,
            details: { reason: replaced.revoke_reason, replacedBy: agent.id, hostname: replaced.hostname },
          });
        }
        await this.auditWriter.writeInTransaction(em, {
          tenantId: code.tenant_id,
          actorType: 'SYSTEM',
          action: 'AGENT_ENROLLED',
          entityType: 'Agent',
          entityId: agent.id,
          branchId: code.branch_id,
          ip: context.clientKey,
          details: {
            enrolmentCodeId: code.id,
            hostname: agent.hostname,
            agentVersion: agent.agent_version,
            replacedAgentId: replaced?.id ?? null,
          },
        });

        return { agent, replaced, branch };
      });
    } catch (err: any) {
      const code = err?.getResponse?.()?.code;
      if (code === 'ENROLMENT_CODE_INVALID' || code === 'ENROLMENT_CODE_EXPIRED' || code === 'ENROLMENT_CODE_USED') {
        this.limiter.recordFailure(context.clientKey);
      }
      throw err;
    }

    // After the commit: the old PC's socket closes only once its revocation is on record.
    if (result.replaced) {
      this.sessions.closeAgent(result.replaced.id, AGENT_CLOSE.REVOKED, 'AGENT_REVOKED');
    }

    return {
      agent_id: result.agent.id,
      tenant_id: result.agent.tenant_id,
      branch_id: result.agent.branch_id,
      branch_name: result.branch.name,
      device_key: deviceKey,
      ws_url: context.wsUrl,
    };
  }
}
