import { BadRequestException, NotFoundException } from '@nestjs/common';
import { HEAD_OFFICE_ONLY_KEY, ROLES_KEY } from '../src/common/decorators/roles.decorator';
import { AgentRegistryController } from '../src/modules/agent-gateway/agent-registry.controller';
import { AgentRegistryService, enrolmentCodeState } from '../src/modules/agent-gateway/agent-registry.service';
import {
  ENROLMENT_CODE_ALPHABET,
  formatEnrolmentCode,
  generateDeviceKey,
  generateEnrolmentCode,
  hashSecret,
  normaliseEnrolmentCode,
} from '../src/modules/agent-gateway/agent-credentials';

const tenantId = '11111111-1111-1111-1111-111111111111';
const branchId = '22222222-2222-2222-2222-222222222222';
const userId = '33333333-3333-3333-3333-333333333333';
const agentId = '44444444-4444-4444-4444-444444444444';

function repo() {
  return {
    find: jest.fn().mockResolvedValue([]),
    findOne: jest.fn().mockResolvedValue(null),
    create: jest.fn((x) => x),
    save: jest.fn(async (x) => ({ id: x.id ?? 'saved-id', ...x })),
  };
}

describe('Agent registry', () => {
  describe('credentials', () => {
    it('makes 8-character codes with no look-alike characters', () => {
      for (let i = 0; i < 200; i++) {
        const code = generateEnrolmentCode();
        expect(code).toHaveLength(8);
        for (const ch of code) expect(ENROLMENT_CODE_ALPHABET).toContain(ch);
      }
    });

    it('reads a code the way a person types it', () => {
      expect(normaliseEnrolmentCode(' k7qm-4xpd ')).toBe('K7QM4XPD');
      expect(formatEnrolmentCode('K7QM4XPD')).toBe('K7QM-4XPD');
      expect(hashSecret(normaliseEnrolmentCode('k7qm-4xpd'))).toBe(hashSecret('K7QM4XPD'));
    });

    it('makes device keys of the shape the protocol promises', () => {
      const key = generateDeviceKey();
      expect(key).toMatch(/^gak_[A-Za-z0-9_-]{43}$/);
      expect(generateDeviceKey()).not.toBe(key);
      expect(hashSecret(key)).toMatch(/^[0-9a-f]{64}$/);
    });
  });

  describe('who may manage agents', () => {
    it('is head office, manager and above, for every route', () => {
      expect(Reflect.getMetadata(HEAD_OFFICE_ONLY_KEY, AgentRegistryController)).toBe(true);
      expect(Reflect.getMetadata(ROLES_KEY, AgentRegistryController)).toEqual(
        expect.arrayContaining(['SUPER_ADMIN', 'ADMIN', 'OWNER', 'MANAGER']),
      );
      expect(Reflect.getMetadata(ROLES_KEY, AgentRegistryController)).not.toContain('CASHIER');
    });
  });

  describe('enrolment code state', () => {
    const now = new Date('2026-09-17T10:00:00Z');
    const later = new Date('2026-09-18T10:00:00Z');
    it.each([
      ['PENDING', { used_at: null, cancelled_at: null, expires_at: later }],
      ['USED', { used_at: now, cancelled_at: null, expires_at: later }],
      ['CANCELLED', { used_at: null, cancelled_at: now, expires_at: later }],
      ['EXPIRED', { used_at: null, cancelled_at: null, expires_at: now }],
    ])('%s', (state, code) => {
      expect(enrolmentCodeState(code as any, now)).toBe(state);
    });
  });

  describe('AgentRegistryService', () => {
    let agentRepo: ReturnType<typeof repo>;
    let codeRepo: ReturnType<typeof repo>;
    let branchRepo: ReturnType<typeof repo>;
    let audit: { write: jest.Mock };
    let service: AgentRegistryService;

    beforeEach(() => {
      agentRepo = repo();
      codeRepo = repo();
      branchRepo = repo();
      audit = { write: jest.fn() };
      service = new AgentRegistryService(agentRepo as any, codeRepo as any, branchRepo as any, audit as any);
    });

    it('hands out a code once and keeps only its hash', async () => {
      branchRepo.findOne.mockResolvedValue({ id: branchId, tenant_id: tenantId, is_active: true });

      const before = Date.now();
      const result = await service.createEnrolmentCode(tenantId, branchId, { userId });

      expect(result.code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
      const saved = codeRepo.save.mock.calls[0][0];
      expect(saved.code_hash).toBe(hashSecret(normaliseEnrolmentCode(result.code)));
      expect(JSON.stringify(saved)).not.toContain(normaliseEnrolmentCode(result.code));
      const ttl = new Date(saved.expires_at).getTime() - before;
      expect(ttl).toBeGreaterThan(23.9 * 3600 * 1000);
      expect(ttl).toBeLessThanOrEqual(24 * 3600 * 1000 + 1000);
      expect(audit.write).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'AGENT_ENROLMENT_CODE_CREATED', branchId, actorId: userId }),
      );
      // The audit trail must not carry the code either.
      expect(JSON.stringify(audit.write.mock.calls)).not.toContain(normaliseEnrolmentCode(result.code));
    });

    it("refuses a branch outside the tenant or one that is closed", async () => {
      await expect(service.createEnrolmentCode(tenantId, branchId, {})).rejects.toBeInstanceOf(NotFoundException);
      expect(branchRepo.findOne.mock.calls[0][0].where).toEqual({ id: branchId, tenant_id: tenantId });

      branchRepo.findOne.mockResolvedValue({ id: branchId, tenant_id: tenantId, is_active: false });
      await expect(service.createEnrolmentCode(tenantId, branchId, {})).rejects.toBeInstanceOf(BadRequestException);
      expect(codeRepo.save).not.toHaveBeenCalled();
    });

    it('never lists code hashes or key hashes', async () => {
      codeRepo.find.mockResolvedValue([
        { id: 'c1', code_hash: 'secret-hash', used_at: null, cancelled_at: null, expires_at: new Date(Date.now() + 1000) },
      ]);
      agentRepo.find.mockResolvedValue([{ id: agentId, branch_id: branchId, key_hash: 'secret-hash', status: 'ACTIVE' }]);
      branchRepo.find.mockResolvedValue([{ id: branchId, name: 'Vanak', code: 'VNK' }]);

      const codes = await service.listEnrolmentCodes(tenantId);
      const agents = await service.listAgents(tenantId);

      expect(codes[0].state).toBe('PENDING');
      expect(JSON.stringify(codes)).not.toContain('secret-hash');
      expect(JSON.stringify(agents)).not.toContain('secret-hash');
      expect(agents[0]).toMatchObject({ branch_name: 'Vanak', branch_code: 'VNK' });
    });

    it('lists active agents unless asked for revoked ones too', async () => {
      await service.listAgents(tenantId, { branchId });
      expect(agentRepo.find.mock.calls[0][0].where).toEqual({ tenant_id: tenantId, branch_id: branchId, status: 'ACTIVE' });

      await service.listAgents(tenantId, { includeRevoked: true });
      expect(agentRepo.find.mock.calls[1][0].where).toEqual({ tenant_id: tenantId });
    });

    it('cancels only a pending code', async () => {
      codeRepo.findOne.mockResolvedValue({ id: 'c1', tenant_id: tenantId, used_at: new Date(), expires_at: new Date() });
      await expect(service.cancelEnrolmentCode(tenantId, 'c1', {})).rejects.toBeInstanceOf(BadRequestException);

      codeRepo.findOne.mockResolvedValue({
        id: 'c1', tenant_id: tenantId, branch_id: branchId, code_hash: 'h', used_at: null, cancelled_at: null,
        expires_at: new Date(Date.now() + 60_000),
      });
      const cancelled = await service.cancelEnrolmentCode(tenantId, 'c1', { userId });
      expect(cancelled.state).toBe('CANCELLED');
      expect(cancelled).not.toHaveProperty('code_hash');
      expect(codeRepo.save.mock.calls[0][0].cancelled_at).toBeInstanceOf(Date);
    });

    it('revokes an agent once, with who and why', async () => {
      agentRepo.findOne.mockResolvedValue({ id: agentId, tenant_id: tenantId, branch_id: branchId, status: 'ACTIVE', key_hash: 'h' });

      const revoked = await service.revokeAgent(tenantId, agentId, '  PC replaced ', { userId });

      expect(agentRepo.findOne.mock.calls[0][0].where).toEqual({ id: agentId, tenant_id: tenantId });
      expect(revoked).toMatchObject({ status: 'REVOKED', revoked_by: userId, revoke_reason: 'PC replaced' });
      expect(revoked).not.toHaveProperty('key_hash');
      expect(audit.write).toHaveBeenCalledWith(expect.objectContaining({ action: 'AGENT_REVOKED', entityId: agentId }));

      agentRepo.findOne.mockResolvedValue({ id: agentId, tenant_id: tenantId, status: 'REVOKED' });
      await expect(service.revokeAgent(tenantId, agentId, undefined, {})).rejects.toBeInstanceOf(BadRequestException);
    });

    it("cannot reach another tenant's agent", async () => {
      await expect(service.revokeAgent(tenantId, agentId, undefined, {})).rejects.toBeInstanceOf(NotFoundException);
      await expect(service.getAgent(tenantId, agentId)).rejects.toBeInstanceOf(NotFoundException);
    });
  });
});
