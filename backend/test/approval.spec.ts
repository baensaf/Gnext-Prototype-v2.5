import { Test, TestingModule } from '@nestjs/testing';
import { ApprovalService } from '../src/modules/approval/approval.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ApprovalRule } from '../src/entities/ApprovalRule.entity';
import { ApprovalRequest } from '../src/entities/ApprovalRequest.entity';
import { ApprovalDecision } from '../src/entities/ApprovalDecision.entity';
import { PinAttemptLog } from '../src/entities/PinAttemptLog.entity';
import { AdminUser } from '../src/entities/AdminUser.entity';
import { AuditWriter } from '../src/modules/audit/audit-writer.service';
import { DataSource } from 'typeorm';
import { ForbiddenException, UnauthorizedException, ConflictException } from '@nestjs/common';

describe('ApprovalService (Unit)', () => {
  let service: ApprovalService;
  let ruleRepo: any;
  let requestRepo: any;
  let decisionRepo: any;
  let pinLogRepo: any;
  let userRepo: any;
  let auditWriter: any;

  beforeEach(async () => {
    ruleRepo = { findOne: jest.fn(), find: jest.fn(), create: jest.fn(), save: jest.fn() };
    requestRepo = { findOne: jest.fn(), find: jest.fn(), count: jest.fn().mockResolvedValue(0), create: jest.fn(), save: jest.fn() };
    decisionRepo = { find: jest.fn().mockResolvedValue([]), create: jest.fn(), save: jest.fn() };
    pinLogRepo = { count: jest.fn().mockResolvedValue(0), create: jest.fn(), save: jest.fn() };
    userRepo = { findOne: jest.fn() };
    auditWriter = { write: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ApprovalService,
        { provide: getRepositoryToken(ApprovalRule), useValue: ruleRepo },
        { provide: getRepositoryToken(ApprovalRequest), useValue: requestRepo },
        { provide: getRepositoryToken(ApprovalDecision), useValue: decisionRepo },
        { provide: getRepositoryToken(PinAttemptLog), useValue: pinLogRepo },
        { provide: getRepositoryToken(AdminUser), useValue: userRepo },
        { provide: AuditWriter, useValue: auditWriter },
        { provide: DataSource, useValue: {} },
      ],
    }).compile();

    service = module.get<ApprovalService>(ApprovalService);
  });

  it('should evaluate action threshold correctly (below limit passes, above limit requires approval)', async () => {
    ruleRepo.findOne.mockResolvedValue({ id: 'r-1', action: 'DISCOUNT', threshold_value: '10.0000', required_steps: 1, approver_role: 'SUPERVISOR', is_active: true });

    const passRes = await service.evaluateAction('t-1', 'DISCOUNT', 5);
    expect(passRes.requires_approval).toBe(false);

    const failRes = await service.evaluateAction('t-1', 'DISCOUNT', 15);
    expect(failRes.requires_approval).toBe(true);
    expect(failRes.required_steps).toBe(1);
  });

  it('should verify manager PIN successfully when PIN matches default 1234', async () => {
    userRepo.findOne.mockResolvedValue({ id: 'u-mgr', role: 'SUPERVISOR', pin_hash: null });
    const result = await service.verifyManagerPin('t-1', 'u-mgr', '1234');
    expect(result.success).toBe(true);
    expect(result.role).toBe('SUPERVISOR');
  });

  it('should lock out user and throw ForbiddenException after 5 failed PIN attempts in 15 mins', async () => {
    pinLogRepo.count.mockResolvedValue(5);

    await expect(service.verifyManagerPin('t-1', 'u-locked', '1234')).rejects.toThrow(ForbiddenException);
  });

  it('should throw UnauthorizedException on wrong PIN', async () => {
    pinLogRepo.count.mockResolvedValue(0);
    userRepo.findOne.mockResolvedValue({ id: 'u-mgr', role: 'SUPERVISOR', pin_hash: null });

    await expect(service.verifyManagerPin('t-1', 'u-mgr', '0000')).rejects.toThrow(UnauthorizedException);
  });

  it('should validate command hash binding and throw ConflictException on payload mismatch', async () => {
    requestRepo.findOne.mockResolvedValue({
      id: 'req-1',
      tenant_id: 't-1',
      action: 'REFUND',
      status: 'APPROVED',
      command_hash: 'hash-abc',
      expires_at: new Date(Date.now() + 600000),
    });

    await expect(
      service.validateApprovedRequest('t-1', 'req-1', 'REFUND', 'hash-different'),
    ).rejects.toThrow(ConflictException);
  });
});
