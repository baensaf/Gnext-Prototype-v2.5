import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { IS_PUBLIC_KEY } from '../src/common/decorators/public.decorator';
import { AgentAuthGuard } from '../src/modules/agent-gateway/agent-auth.guard';
import { AgentAuthService, deviceKeyFromHeader } from '../src/modules/agent-gateway/agent-auth.service';
import { AgentController, agentWsUrl, clientAddress } from '../src/modules/agent-gateway/agent.controller';
import { generateDeviceKey, hashSecret } from '../src/modules/agent-gateway/agent-credentials';
import {
  AgentEnrolmentService,
  EnrolmentRateLimiter,
  parseEnrolRequest,
} from '../src/modules/agent-gateway/agent-enrolment.service';
import { AgentSessionsService } from '../src/modules/agent-gateway/agent-sessions.service';
import { Agent } from '../src/entities/Agent.entity';
import { AgentEnrolmentCode } from '../src/entities/AgentEnrolmentCode.entity';
import { Branch } from '../src/entities/Branch.entity';

const tenantId = '11111111-1111-1111-1111-111111111111';
const branchId = '22222222-2222-2222-2222-222222222222';
const codeId = '33333333-3333-3333-3333-333333333333';
const oldAgentId = '44444444-4444-4444-4444-444444444444';
const hqUserId = '55555555-5555-5555-5555-555555555555';
const WS = 'wss://app.example.ir/api/v1/agent/ws';

function codeRow(overrides: Partial<AgentEnrolmentCode> = {}): AgentEnrolmentCode {
  return {
    id: codeId,
    tenant_id: tenantId,
    branch_id: branchId,
    code_hash: hashSecret('K7QM4XPD'),
    expires_at: new Date(Date.now() + 3600_000),
    used_at: null,
    agent_id: null,
    cancelled_at: null,
    created_by: hqUserId,
    created_at: new Date(),
    ...overrides,
  };
}

/** A transaction manager over in-memory rows, enough for one enrolment. */
function fakeDb(state: { code?: AgentEnrolmentCode | null; branch?: Partial<Branch> | null; active?: Partial<Agent> | null }) {
  const saved: Array<{ entity: any; row: any }> = [];
  const audit: any[] = [];
  const em = {
    findOne: jest.fn(async (entity: any, opts: any) => {
      if (entity === AgentEnrolmentCode) return opts.where.code_hash === state.code?.code_hash ? state.code : null;
      if (entity === Branch) return state.branch ?? null;
      if (entity === Agent) return state.active ?? null;
      return null;
    }),
    create: jest.fn((_entity: any, row: any) => ({ ...row })),
    save: jest.fn(async (entity: any, row: any) => {
      const withId = { id: row.id ?? 'new-agent-id', ...row };
      saved.push({ entity, row: withId });
      return withId;
    }),
  };
  const dataSource = { transaction: jest.fn(async (fn: any) => fn(em)) };
  const auditWriter = { writeInTransaction: jest.fn(async (_em: any, o: any) => audit.push(o)) };
  return { em, dataSource, auditWriter, saved, audit };
}

const activeBranch = { id: branchId, tenant_id: tenantId, name: 'Vanak', is_active: true };
const body = {
  code: 'k7qm-4xpd',
  agent_version: '1.0.0',
  protocol_version: 1,
  machine: { hostname: 'BRANCH-01-PC', os: 'Windows 11 Pro', machine_id: 'abc' },
  some_future_field: true,
};

describe('Agent enrolment and auth', () => {
  describe('POST /agent/enrol', () => {
    let sessions: AgentSessionsService;
    beforeEach(() => {
      sessions = new AgentSessionsService();
    });

    it('trades a pending code for a device key and keeps only its hash', async () => {
      const db = fakeDb({ code: codeRow(), branch: activeBranch });
      const service = new AgentEnrolmentService(db.dataSource as any, sessions, db.auditWriter as any);

      const res = await service.enrol(body, { clientKey: '5.6.7.8', wsUrl: WS });

      expect(res).toMatchObject({ tenant_id: tenantId, branch_id: branchId, branch_name: 'Vanak', ws_url: WS });
      expect(res.device_key).toMatch(/^gak_[A-Za-z0-9_-]{43}$/);

      const agent = db.saved.find((s) => s.entity === Agent)!.row;
      expect(agent).toMatchObject({
        status: 'ACTIVE',
        key_hash: hashSecret(res.device_key),
        hostname: 'BRANCH-01-PC',
        agent_version: '1.0.0',
        protocol_version: 1,
        enrolment_code_id: codeId,
      });
      expect(JSON.stringify(db.saved)).not.toContain(res.device_key);
      expect(JSON.stringify(db.audit)).not.toContain(res.device_key);

      const code = db.saved.find((s) => s.entity === AgentEnrolmentCode)!.row;
      expect(code.used_at).toBeInstanceOf(Date);
      expect(code.agent_id).toBe(res.agent_id);
      expect(db.em.findOne.mock.calls[0][1].lock).toEqual({ mode: 'pessimistic_write' });
      expect(db.audit.map((a) => a.action)).toEqual(['AGENT_ENROLLED']);
    });

    it("revokes the branch's old agent and closes its socket once the new one is on record", async () => {
      const db = fakeDb({
        code: codeRow(),
        branch: activeBranch,
        active: { id: oldAgentId, tenant_id: tenantId, branch_id: branchId, status: 'ACTIVE', hostname: 'OLD-PC' },
      });
      const close = jest.fn();
      sessions.register(oldAgentId, close);
      db.dataSource.transaction.mockImplementation(async (fn: any) => {
        const out = await fn(db.em);
        // Nothing may be closed before the transaction has committed.
        expect(close).not.toHaveBeenCalled();
        return out;
      });
      const service = new AgentEnrolmentService(db.dataSource as any, sessions, db.auditWriter as any);

      const res = await service.enrol(body, { clientKey: '5.6.7.8', wsUrl: WS });

      const old = db.saved.find((s) => s.entity === Agent && s.row.id === oldAgentId)!.row;
      expect(old).toMatchObject({ status: 'REVOKED', revoked_by: hqUserId });
      expect(old.revoked_at).toBeInstanceOf(Date);
      expect(close).toHaveBeenCalledWith(4003, 'AGENT_REVOKED');
      expect(db.audit.map((a) => a.action)).toEqual(['AGENT_REVOKED', 'AGENT_ENROLLED']);
      expect(db.audit[1].details.replacedAgentId).toBe(oldAgentId);
      expect(res.agent_id).not.toBe(oldAgentId);
    });

    it.each([
      ['an unknown code', null, 'ENROLMENT_CODE_INVALID'],
      ['a used code', codeRow({ used_at: new Date() }), 'ENROLMENT_CODE_USED'],
      ['an expired code', codeRow({ expires_at: new Date(Date.now() - 1000) }), 'ENROLMENT_CODE_EXPIRED'],
      ['a cancelled code', codeRow({ cancelled_at: new Date() }), 'ENROLMENT_CODE_EXPIRED'],
    ])('refuses %s', async (_label, code, expected) => {
      const db = fakeDb({ code, branch: activeBranch });
      const service = new AgentEnrolmentService(db.dataSource as any, sessions, db.auditWriter as any);

      await expect(service.enrol(body, { clientKey: '5.6.7.8', wsUrl: WS })).rejects.toMatchObject({
        response: expect.objectContaining({ code: expected }),
        status: 400,
      });
      expect(db.saved).toHaveLength(0);
    });

    it('refuses a code whose branch has closed', async () => {
      const db = fakeDb({ code: codeRow(), branch: { ...activeBranch, is_active: false } });
      const service = new AgentEnrolmentService(db.dataSource as any, sessions, db.auditWriter as any);
      await expect(service.enrol(body, { clientKey: 'x', wsUrl: WS })).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'ENROLMENT_CODE_INVALID' }),
      });
    });

    it('refuses a protocol version it does not speak, before touching the database', async () => {
      const db = fakeDb({ code: codeRow(), branch: activeBranch });
      const service = new AgentEnrolmentService(db.dataSource as any, sessions, db.auditWriter as any);
      await expect(service.enrol({ ...body, protocol_version: 2 }, { clientKey: 'x', wsUrl: WS })).rejects.toMatchObject({
        response: expect.objectContaining({ code: 'PROTOCOL_UNSUPPORTED' }),
      });
      expect(db.dataSource.transaction).not.toHaveBeenCalled();
    });

    it('stops an address after five bad codes, and only that address', async () => {
      const db = fakeDb({ code: null, branch: activeBranch });
      const service = new AgentEnrolmentService(db.dataSource as any, sessions, db.auditWriter as any);
      for (let i = 0; i < 5; i++) {
        await expect(service.enrol(body, { clientKey: '9.9.9.9', wsUrl: WS })).rejects.toMatchObject({ status: 400 });
      }
      await expect(service.enrol(body, { clientKey: '9.9.9.9', wsUrl: WS })).rejects.toMatchObject({
        status: 429,
        response: expect.objectContaining({ code: 'RATE_LIMITED' }),
      });
      await expect(service.enrol(body, { clientKey: '1.1.1.1', wsUrl: WS })).rejects.toMatchObject({ status: 400 });
    });

    it('lets the rate limit lapse after its window', () => {
      const limiter = new EnrolmentRateLimiter(2, 1000);
      limiter.recordFailure('a', 0);
      limiter.recordFailure('a', 100);
      expect(limiter.retryAfter('a', 500)).toBe(1);
      expect(limiter.retryAfter('a', 1000)).toBe(0);
    });

    it('reads the body leniently but insists on a code', () => {
      expect(parseEnrolRequest(body).machine).toEqual({ hostname: 'BRANCH-01-PC', os: 'Windows 11 Pro', machine_id: 'abc' });
      expect(parseEnrolRequest({ code: 'X', machine: 'nope', agent_version: 7 })).toMatchObject({
        agent_version: undefined,
        machine: {},
      });
      expect(parseEnrolRequest({ code: 'X', machine: { hostname: 'h'.repeat(300) } }).machine!.hostname).toHaveLength(128);
      for (const bad of [null, [], 'code', {}, { code: '  ' }, { code: 'X', protocol_version: '1' }]) {
        expect(() => parseEnrolRequest(bad)).toThrow();
      }
    });

    it('is public, and takes the body without the global DTO rules', () => {
      expect(Reflect.getMetadata(IS_PUBLIC_KEY, AgentController.prototype.enrol)).toBe(true);
      const [bodyType] = Reflect.getMetadata('design:paramtypes', AgentController.prototype, 'enrol');
      // `unknown` compiles to Object, which the validation pipe leaves alone.
      expect(bodyType).toBe(Object);
    });
  });

  describe('where the agent is told to connect', () => {
    const req = (headers: Record<string, string>) => ({ headers, socket: { remoteAddress: '10.0.0.1' } }) as any;

    it('prefers the configured public URL', () => {
      expect(agentWsUrl(req({ host: 'backend:3100' }), 'https://app.example.ir/some/path?x=1')).toBe(WS);
      expect(agentWsUrl(req({ host: 'x' }), 'http://localhost:8081')).toBe('ws://localhost:8081/api/v1/agent/ws');
    });

    it('uses wss for a public host even though TLS ended before nginx', () => {
      expect(agentWsUrl(req({ host: 'app.example.ir', 'x-forwarded-proto': 'http' }), '')).toBe(WS);
      expect(agentWsUrl(req({ host: 'localhost:3100' }), '')).toBe('ws://localhost:3100/api/v1/agent/ws');
      expect(agentWsUrl(req({ host: '192.168.1.5:8081' }), '')).toBe('ws://192.168.1.5:8081/api/v1/agent/ws');
    });

    it('rate-limits by the first forwarded address', () => {
      expect(clientAddress(req({ 'x-forwarded-for': '5.6.7.8, 172.18.0.1' }))).toBe('5.6.7.8');
      expect(clientAddress(req({}))).toBe('10.0.0.1');
    });
  });

  describe('device key auth', () => {
    const deviceKey = generateDeviceKey();
    let agentRepo: { findOne: jest.Mock; update: jest.Mock };
    let auth: AgentAuthService;

    beforeEach(() => {
      agentRepo = { findOne: jest.fn().mockResolvedValue(null), update: jest.fn() };
      auth = new AgentAuthService(agentRepo as any);
    });

    it('reads only a bearer device key', () => {
      expect(deviceKeyFromHeader(`Bearer ${deviceKey}`)).toBe(deviceKey);
      expect(deviceKeyFromHeader(`Bearer   ${deviceKey}  `)).toBe(deviceKey);
      expect(deviceKeyFromHeader('Bearer some-session-token')).toBeNull();
      expect(deviceKeyFromHeader(deviceKey)).toBeNull();
      expect(deviceKeyFromHeader(undefined)).toBeNull();
    });

    it('finds the agent by the hash of its key', async () => {
      agentRepo.findOne.mockResolvedValue({ id: 'a1', status: 'ACTIVE', last_seen_at: null });
      await auth.authenticate(deviceKey);
      expect(agentRepo.findOne).toHaveBeenCalledWith({ where: { key_hash: hashSecret(deviceKey) } });
    });

    it('answers 401 for no key or an unknown one, and 403 for a revoked one', async () => {
      await expect(auth.authenticate(null)).rejects.toBeInstanceOf(UnauthorizedException);
      await expect(auth.authenticate(deviceKey)).rejects.toMatchObject({
        status: 401,
        response: expect.objectContaining({ code: 'AGENT_KEY_INVALID' }),
      });
      agentRepo.findOne.mockResolvedValue({ id: 'a1', status: 'REVOKED' });
      const err = await auth.authenticate(deviceKey).catch((e) => e);
      expect(err).toBeInstanceOf(ForbiddenException);
      expect(err.getResponse().code).toBe('AGENT_REVOKED');
    });

    it('records last seen at most once a minute, touching only that column', async () => {
      const agent: any = { id: 'a1', status: 'ACTIVE', last_seen_at: null };
      const t0 = new Date('2026-09-17T10:00:00Z');
      await auth.touch(agent, t0);
      await auth.touch(agent, new Date(t0.getTime() + 30_000));
      await auth.touch(agent, new Date(t0.getTime() + 61_000));
      expect(agentRepo.update).toHaveBeenCalledTimes(2);
      expect(agentRepo.update.mock.calls[0]).toEqual([{ id: 'a1' }, { last_seen_at: t0 }]);
    });

    it('puts the agent and its tenant on the request, and no user', async () => {
      const agent = { id: 'a1', tenant_id: tenantId, branch_id: branchId, status: 'ACTIVE', last_seen_at: new Date() };
      agentRepo.findOne.mockResolvedValue(agent);
      const request: any = { headers: { authorization: `Bearer ${deviceKey}` } };
      const ctx: any = { switchToHttp: () => ({ getRequest: () => request }) };

      await expect(new AgentAuthGuard(auth).canActivate(ctx)).resolves.toBe(true);
      expect(request).toMatchObject({ agentId: 'a1', agentBranchId: branchId, tenantId });
      expect(request.userId).toBeUndefined();
      expect(request.userBranchId).toBeUndefined();
    });

    it('protects /agent/me with the device key instead of a session', () => {
      const guards = Reflect.getMetadata('__guards__', AgentController.prototype.me);
      expect(guards).toContain(AgentAuthGuard);
      expect(Reflect.getMetadata(IS_PUBLIC_KEY, AgentController.prototype.me)).toBe(true);
    });
  });
});
