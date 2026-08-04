import { Injectable, NotFoundException, ConflictException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, MoreThan } from 'typeorm';
import * as argon2 from 'argon2';
import { ApprovalRule } from '../../entities/ApprovalRule.entity';
import { ApprovalRequest } from '../../entities/ApprovalRequest.entity';
import { ApprovalDecision } from '../../entities/ApprovalDecision.entity';
import { PinAttemptLog } from '../../entities/PinAttemptLog.entity';
import { AdminUser } from '../../entities/AdminUser.entity';
import { AuditWriter } from '../audit/audit-writer.service';

@Injectable()
export class ApprovalService {
  constructor(
    @InjectRepository(ApprovalRule) private readonly ruleRepo: Repository<ApprovalRule>,
    @InjectRepository(ApprovalRequest) private readonly requestRepo: Repository<ApprovalRequest>,
    @InjectRepository(ApprovalDecision) private readonly decisionRepo: Repository<ApprovalDecision>,
    @InjectRepository(PinAttemptLog) private readonly pinLogRepo: Repository<PinAttemptLog>,
    @InjectRepository(AdminUser) private readonly userRepo: Repository<AdminUser>,
    private readonly auditWriter: AuditWriter,
  ) {}

  async getRules(tenantId: string) {
    return await this.ruleRepo.find({ where: { tenant_id: tenantId }, order: { action: 'ASC' } });
  }

  async createOrUpdateRule(
    tenantId: string,
    data: { action: string; threshold_type?: string; threshold_value: string; required_steps?: number; approver_role?: string },
    correlationId: string,
  ) {
    let rule = await this.ruleRepo.findOne({ where: { tenant_id: tenantId, action: data.action } });
    if (!rule) {
      rule = this.ruleRepo.create({
        tenant_id: tenantId,
        action: data.action,
        threshold_type: data.threshold_type || 'PERCENTAGE',
        threshold_value: data.threshold_value,
        required_steps: data.required_steps || 1,
        approver_role: data.approver_role || 'SUPERVISOR',
        is_active: true,
      });
    } else {
      rule.threshold_type = data.threshold_type || rule.threshold_type;
      rule.threshold_value = data.threshold_value;
      rule.required_steps = data.required_steps || rule.required_steps;
      rule.approver_role = data.approver_role || rule.approver_role;
    }

    const saved = await this.ruleRepo.save(rule);

    await this.auditWriter.write({
      tenantId,
      actorType: 'ADMIN',
      action: 'APPROVAL_RULE_SAVED',
      correlationId,
      afterData: saved,
    });

    return saved;
  }

  async verifyManagerPin(tenantId: string, userId: string, pin: string, actionName?: string) {
    const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);
    const recentFailedCount = await this.pinLogRepo.count({
      where: {
        tenant_id: tenantId,
        user_id: userId,
        is_success: false,
        attempted_at: MoreThan(fifteenMinutesAgo),
      },
    });

    if (recentFailedCount >= 3) {
      throw new ForbiddenException('PIN rate limit exceeded. 3 failed attempts in last 15 minutes. Account locked for 15 minutes.');
    }

    const user = await this.userRepo.findOne({ where: { id: userId, tenant_id: tenantId } });
    if (!user) throw new NotFoundException('User not found');

    let isPinValid = false;

    if (user.pin_hash) {
      try {
        isPinValid = await argon2.verify(user.pin_hash, pin);
      } catch (err) {
        isPinValid = false;
      }
    } else {
      // Fallback prototype default manager PIN ('1234' or '9999')
      isPinValid = pin === '1234' || pin === '9999';
    }

    // Log attempt
    const log = this.pinLogRepo.create({
      tenant_id: tenantId,
      user_id: userId,
      action: actionName || 'VERIFY_PIN',
      is_success: isPinValid,
    });
    await this.pinLogRepo.save(log);

    if (!isPinValid) {
      await this.auditWriter.write({
        tenantId,
        actorType: 'ADMIN',
        action: 'PIN_FAILED_ATTEMPT',
        correlationId: actionName || 'VERIFY_PIN',
        details: { userId, recentFailedCount: recentFailedCount + 1 },
      });
      throw new UnauthorizedException(`Invalid Manager PIN. Remaining attempts: ${2 - recentFailedCount}`);
    }

    return { success: true, user_id: userId, role: user.role };
  }

  async evaluateAction(tenantId: string, action: string, requestedValue: number) {
    const rule = await this.ruleRepo.findOne({ where: { tenant_id: tenantId, action, is_active: true } });
    if (!rule) return { requires_approval: false };

    const threshold = parseFloat(rule.threshold_value);
    if (requestedValue > threshold) {
      return {
        requires_approval: true,
        rule_id: rule.id,
        action,
        threshold_value: rule.threshold_value,
        required_steps: rule.required_steps,
        approver_role: rule.approver_role,
      };
    }

    return { requires_approval: false };
  }

  async createRequest(
    tenantId: string,
    requesterUserId: string,
    data: { action: string; entity_type: string; entity_id?: string; reason?: string; details?: any; total_steps?: number },
    correlationId: string,
  ) {
    const count = await this.requestRepo.count({ where: { tenant_id: tenantId } });
    const code = `APR-${(count + 1001).toString()}`;
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minute binding expiry

    const req = this.requestRepo.create({
      tenant_id: tenantId,
      code,
      action: data.action,
      entity_type: data.entity_type,
      entity_id: data.entity_id || null,
      requester_user_id: requesterUserId,
      status: 'PENDING',
      current_step: 1,
      total_steps: data.total_steps || 1,
      reason: data.reason || null,
      details: data.details || {},
      expires_at: expiresAt,
    });

    const saved = await this.requestRepo.save(req);

    await this.auditWriter.write({
      tenantId,
      actorType: 'ADMIN',
      action: 'APPROVAL_REQUEST_CREATED',
      entityType: 'ApprovalRequest',
      entityId: saved.id,
      correlationId,
      afterData: saved,
    });

    return saved;
  }

  async getPendingRequests(tenantId: string) {
    const now = new Date();
    // Auto-expire requests older than 10 mins
    const requests = await this.requestRepo.find({ where: { tenant_id: tenantId }, order: { created_at: 'DESC' } });
    for (const r of requests) {
      if (r.status === 'PENDING' && new Date(r.expires_at) < now) {
        r.status = 'EXPIRED';
        await this.requestRepo.save(r);
      }
    }
    return requests;
  }

  async getRequestById(tenantId: string, id: string) {
    const req = await this.requestRepo.findOne({ where: { id, tenant_id: tenantId } });
    if (!req) throw new NotFoundException('Approval request not found');
    const decisions = await this.decisionRepo.find({ where: { tenant_id: tenantId, request_id: id }, order: { step_number: 'ASC' } });
    return { ...req, decisions };
  }

  async approveRequest(tenantId: string, requestId: string, approverUserId: string, pin: string, note?: string, correlationId?: string) {
    const req = await this.requestRepo.findOne({ where: { id: requestId, tenant_id: tenantId } });
    if (!req) throw new NotFoundException('Approval request not found');

    if (req.status !== 'PENDING') {
      throw new ConflictException(`Cannot approve request in status ${req.status}`);
    }

    if (new Date(req.expires_at) < new Date()) {
      req.status = 'EXPIRED';
      await this.requestRepo.save(req);
      throw new ConflictException('Approval request has expired (10-minute validity exceeded).');
    }

    // Verify Manager PIN
    await this.verifyManagerPin(tenantId, approverUserId, pin, `APPROVE_${req.action}`);

    // Log decision
    const decision = this.decisionRepo.create({
      tenant_id: tenantId,
      request_id: requestId,
      step_number: req.current_step,
      approver_user_id: approverUserId,
      decision: 'APPROVED',
      note: note || null,
    });
    await this.decisionRepo.save(decision);

    if (req.current_step < req.total_steps) {
      req.current_step += 1;
    } else {
      req.status = 'APPROVED';
    }

    const saved = await this.requestRepo.save(req);

    await this.auditWriter.write({
      tenantId,
      actorType: 'ADMIN',
      action: 'APPROVAL_REQUEST_APPROVED',
      entityType: 'ApprovalRequest',
      entityId: requestId,
      correlationId,
      details: { step: req.current_step, status: req.status, approverUserId },
    });

    return saved;
  }

  async rejectRequest(tenantId: string, requestId: string, approverUserId: string, pin: string, note?: string, correlationId?: string) {
    const req = await this.requestRepo.findOne({ where: { id: requestId, tenant_id: tenantId } });
    if (!req) throw new NotFoundException('Approval request not found');

    await this.verifyManagerPin(tenantId, approverUserId, pin, `REJECT_${req.action}`);

    const decision = this.decisionRepo.create({
      tenant_id: tenantId,
      request_id: requestId,
      step_number: req.current_step,
      approver_user_id: approverUserId,
      decision: 'REJECTED',
      note: note || null,
    });
    await this.decisionRepo.save(decision);

    req.status = 'REJECTED';
    const saved = await this.requestRepo.save(req);

    await this.auditWriter.write({
      tenantId,
      actorType: 'ADMIN',
      action: 'APPROVAL_REQUEST_REJECTED',
      entityType: 'ApprovalRequest',
      entityId: requestId,
      correlationId,
      details: { approverUserId, note },
    });

    return saved;
  }
}
