import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { Courier } from '../../entities/Courier.entity';
import { DeliveryAssignment } from '../../entities/DeliveryAssignment.entity';
import { OrderHeader } from '../../entities/OrderHeader.entity';
import { CourierSettlement } from '../../entities/CourierSettlement.entity';
import { CourierSettlementLine } from '../../entities/CourierSettlementLine.entity';
import { Payment } from '../../entities/Payment.entity';
import { PaymentMethod } from '../../entities/PaymentMethod.entity';
import { ApprovalRequest } from '../../entities/ApprovalRequest.entity';
import { AuditWriter } from '../audit/audit-writer.service';

@Injectable()
export class DeliveryService {
  constructor(
    @InjectRepository(Courier) private readonly courierRepo: Repository<Courier>,
    @InjectRepository(DeliveryAssignment) private readonly assignmentRepo: Repository<DeliveryAssignment>,
    @InjectRepository(OrderHeader) private readonly orderRepo: Repository<OrderHeader>,
    @InjectRepository(CourierSettlement) private readonly settlementRepo: Repository<CourierSettlement>,
    @InjectRepository(CourierSettlementLine) private readonly settlementLineRepo: Repository<CourierSettlementLine>,
    @InjectRepository(Payment) private readonly paymentRepo: Repository<Payment>,
    @InjectRepository(PaymentMethod) private readonly paymentMethodRepo: Repository<PaymentMethod>,
    @InjectRepository(ApprovalRequest) private readonly approvalRepo: Repository<ApprovalRequest>,
    private readonly auditWriter: AuditWriter,
  ) {}

  async getCouriers(tenantId: string, branchId?: string) {
    const where: any = { tenant_id: tenantId, is_active: true };
    if (branchId) where.branch_id = branchId;
    return await this.courierRepo.find({ where, order: { name: 'ASC' } });
  }

  async createCourier(
    tenantId: string,
    data: { branch_id?: string; code: string; name: string; phone?: string; vehicle_type?: string },
    correlationId: string,
  ) {
    const courier = this.courierRepo.create({
      tenant_id: tenantId,
      branch_id: data.branch_id || null,
      code: data.code.toUpperCase(),
      name: data.name,
      phone: data.phone || null,
      vehicle_type: data.vehicle_type || 'MOTORCYCLE',
      status: 'AVAILABLE',
      is_active: true,
    });
    const saved = await this.courierRepo.save(courier);
    await this.auditWriter.write({
      tenantId,
      actorType: 'ADMIN',
      action: 'COURIER_CREATED',
      correlationId,
      afterData: saved,
    });
    return saved;
  }

  async updateCourierStatus(tenantId: string, courierId: string, status: 'AVAILABLE' | 'ON_DELIVERY' | 'INACTIVE', correlationId?: string) {
    const courier = await this.courierRepo.findOne({ where: { id: courierId, tenant_id: tenantId } });
    if (!courier) throw new NotFoundException('Courier not found');

    courier.status = status;
    const saved = await this.courierRepo.save(courier);
    await this.auditWriter.write({
      tenantId,
      actorType: 'ADMIN',
      action: 'COURIER_STATUS_UPDATED',
      correlationId: correlationId || 'corr-courier-status',
      afterData: saved,
    });
    return saved;
  }

  async assignOrder(
    tenantId: string,
    orderId: string,
    courierId: string,
    deliveryFee?: number,
    tipAmount?: number,
    correlationId?: string,
  ) {
    const order = await this.orderRepo.findOne({ where: { id: orderId, tenant_id: tenantId } });
    if (!order) throw new NotFoundException('Order not found');

    const courier = await this.courierRepo.findOne({ where: { id: courierId, tenant_id: tenantId } });
    if (!courier) throw new NotFoundException('Courier not found');
    if (courier.status === 'INACTIVE') throw new BadRequestException('Courier is inactive');

    const assignment = this.assignmentRepo.create({
      tenant_id: tenantId,
      order_id: orderId,
      courier_id: courierId,
      status: 'ASSIGNED',
      assigned_at: new Date(),
      delivery_fee: (deliveryFee || 0).toFixed(2),
      tip_amount: (tipAmount || 0).toFixed(2),
      is_settled: false,
    });
    const savedAssignment = await this.assignmentRepo.save(assignment);

    courier.status = 'ON_DELIVERY';
    await this.courierRepo.save(courier);

    order.fulfillment_status = 'OUT_FOR_DELIVERY';
    await this.orderRepo.save(order);

    await this.auditWriter.write({
      tenantId,
      actorType: 'ADMIN',
      action: 'DELIVERY_ORDER_ASSIGNED',
      correlationId: correlationId || 'corr-assign',
      afterData: savedAssignment,
    });

    return savedAssignment;
  }

  async getAssignments(tenantId: string, branchId?: string, statusFilter?: string) {
    const where: any = { tenant_id: tenantId };
    if (statusFilter) where.status = statusFilter;

    const assignments = await this.assignmentRepo.find({ where, order: { created_at: 'DESC' } });
    const result = [];

    for (const a of assignments) {
      const courier = await this.courierRepo.findOne({ where: { id: a.courier_id } });
      const order = await this.orderRepo.findOne({ where: { id: a.order_id } });

      result.push({
        ...a,
        courier_name: courier ? courier.name : 'Unknown Courier',
        courier_phone: courier ? courier.phone : '',
        courier_vehicle: courier ? courier.vehicle_type : 'MOTORCYCLE',
        order_number: order ? order.order_number : 'ORD-00',
        customer_name: order ? (order as any).customer_name || 'Guest Customer' : 'Guest Customer',
        customer_phone: order ? (order as any).customer_phone || '' : '',
        delivery_address: order ? (order as any).delivery_address || 'Standard Address' : 'Standard Address',
        order_total: order ? order.total_amount : '0.00',
      });
    }

    return result;
  }

  async updateAssignmentStatus(
    tenantId: string,
    assignmentId: string,
    status: 'ASSIGNED' | 'PICKED_UP' | 'OUT_FOR_DELIVERY' | 'DELIVERED' | 'FAILED' | 'RETURNED',
    failureReason?: string,
    correlationId?: string,
  ) {
    const assignment = await this.assignmentRepo.findOne({ where: { id: assignmentId, tenant_id: tenantId } });
    if (!assignment) throw new NotFoundException('Delivery assignment not found');

    assignment.status = status;
    if (status === 'PICKED_UP') assignment.picked_up_at = new Date();
    if (status === 'DELIVERED') assignment.delivered_at = new Date();
    if (status === 'FAILED' || status === 'RETURNED') assignment.failure_reason = failureReason || 'Undelivered';

    const saved = await this.assignmentRepo.save(assignment);

    if (['DELIVERED', 'FAILED', 'RETURNED'].includes(status)) {
      const courier = await this.courierRepo.findOne({ where: { id: assignment.courier_id } });
      if (courier) {
        courier.status = 'AVAILABLE';
        await this.courierRepo.save(courier);
      }
    }

    const order = await this.orderRepo.findOne({ where: { id: assignment.order_id } });
    if (order) {
      if (status === 'DELIVERED') order.fulfillment_status = 'DELIVERED';
      if (status === 'FAILED') order.fulfillment_status = 'CANCELLED';
      await this.orderRepo.save(order);
    }

    await this.auditWriter.write({
      tenantId,
      actorType: 'ADMIN',
      action: 'DELIVERY_STATUS_UPDATED',
      correlationId: correlationId || 'corr-delivery-status',
      afterData: saved,
    });

    return saved;
  }

  // --- SLICE 17: COURIER SETTLEMENT LOGIC ---

  private async calculatePaymentBreakdown(orderId: string, defaultTotal: number) {
    const payments = await this.paymentRepo.find({ where: { order_id: orderId, status: In(['SUCCEEDED', 'COMPLETED']) as any } });
    let expCash = 0;
    let expPos = 0;
    let primaryMethod = 'CASH';

    if (payments && payments.length > 0) {
      for (const p of payments) {
        let isCash = false;
        if ((p as any).payment_method_code) {
          isCash = (p as any).payment_method_code === 'CASH';
        } else if (p.method_id || (p as any).payment_method_id) {
          const pm = await this.paymentMethodRepo.findOne({ where: { id: p.method_id || (p as any).payment_method_id } });
          if (pm && (pm.kind === 'CASH' || pm.code === 'CASH')) {
            isCash = true;
          }
        }
        if (isCash) {
          expCash += parseFloat(p.amount || '0');
        } else {
          expPos += parseFloat(p.amount || '0');
        }
      }
      primaryMethod = expCash >= expPos ? 'CASH' : 'CARD';
    } else {
      expCash = defaultTotal;
      primaryMethod = 'CASH';
    }

    return { expCash, expPos, primaryMethod };
  }

  async getUnsettledSummary(tenantId: string, branchId?: string) {
    const couriers = await this.getCouriers(tenantId, branchId);
    const summary = [];

    for (const courier of couriers) {
      const unsettledAssignments = await this.assignmentRepo.find({
        where: {
          tenant_id: tenantId,
          courier_id: courier.id,
          is_settled: false,
          status: In(['DELIVERED', 'FAILED', 'RETURNED']),
        },
      });

      let totalExpectedCash = 0;
      let totalExpectedPos = 0;
      let totalDeliveryFees = 0;

      for (const a of unsettledAssignments) {
        totalDeliveryFees += parseFloat(a.delivery_fee || '0');
        const order = await this.orderRepo.findOne({ where: { id: a.order_id } });
        const defaultTotal = parseFloat(order?.total_amount || '0');
        const breakdown = await this.calculatePaymentBreakdown(a.order_id, defaultTotal);

        totalExpectedCash += breakdown.expCash;
        totalExpectedPos += breakdown.expPos;
      }

      summary.push({
        courier_id: courier.id,
        courier_name: courier.name,
        courier_code: courier.code,
        unsettled_count: unsettledAssignments.length,
        expected_cash: totalExpectedCash.toFixed(2),
        expected_pos: totalExpectedPos.toFixed(2),
        total_delivery_fees: totalDeliveryFees.toFixed(2),
      });
    }

    return summary;
  }

  async previewSettlement(tenantId: string, courierId: string, assignmentIds?: string[]) {
    const courier = await this.courierRepo.findOne({ where: { id: courierId, tenant_id: tenantId } });
    if (!courier) throw new NotFoundException('Courier not found');

    let assignments: DeliveryAssignment[];
    if (assignmentIds && assignmentIds.length > 0) {
      assignments = await this.assignmentRepo.find({
        where: { tenant_id: tenantId, courier_id: courierId, id: In(assignmentIds) },
      });
    } else {
      assignments = await this.assignmentRepo.find({
        where: {
          tenant_id: tenantId,
          courier_id: courierId,
          is_settled: false,
          status: In(['DELIVERED', 'FAILED', 'RETURNED']),
        },
      });
    }

    for (const a of assignments) {
      if (a.is_settled) {
        throw new ConflictException(`Assignment ${a.id} is already settled`);
      }
      const existingLine = await this.settlementLineRepo.findOne({
        where: { delivery_assignment_id: a.id },
      });
      if (existingLine) {
        const batch = await this.settlementRepo.findOne({ where: { id: existingLine.settlement_id } });
        if (batch && batch.status !== 'REVERSED') {
          throw new ConflictException(`Assignment ${a.id} is already linked to non-reversed settlement ${batch.settlement_number}`);
        }
      }
    }

    const lines = [];
    let expectedCashSum = 0;
    let expectedPosSum = 0;
    let deliveryFeesSum = 0;

    for (const a of assignments) {
      const order = await this.orderRepo.findOne({ where: { id: a.order_id } });
      const defaultTotal = parseFloat(order?.total_amount || '0');
      const breakdown = await this.calculatePaymentBreakdown(a.order_id, defaultTotal);

      expectedCashSum += breakdown.expCash;
      expectedPosSum += breakdown.expPos;
      deliveryFeesSum += parseFloat(a.delivery_fee || '0');

      lines.push({
        delivery_assignment_id: a.id,
        order_id: a.order_id,
        order_number: order?.order_number || 'ORD-UNKNOWN',
        delivery_status: a.status,
        payment_method_code: breakdown.primaryMethod,
        expected_cash: breakdown.expCash.toFixed(2),
        actual_cash: breakdown.expCash.toFixed(2),
        expected_pos: breakdown.expPos.toFixed(2),
        actual_pos: breakdown.expPos.toFixed(2),
        receipt_verified: true,
        delivery_fee_amount: parseFloat(a.delivery_fee || '0').toFixed(2),
        commission_amount: '0.00',
        notes: null,
      });
    }

    return {
      courier_id: courier.id,
      courier_name: courier.name,
      courier_code: courier.code,
      line_count: lines.length,
      expected_cash_amount: expectedCashSum.toFixed(2),
      actual_cash_amount: expectedCashSum.toFixed(2),
      cash_discrepancy_amount: '0.00',
      expected_pos_amount: expectedPosSum.toFixed(2),
      actual_pos_amount: expectedPosSum.toFixed(2),
      pos_discrepancy_amount: '0.00',
      total_compensation_amount: '0.00',
      total_adjustment_amount: '0.00',
      net_settlement_amount: (expectedCashSum + expectedPosSum).toFixed(2),
      lines,
    };
  }

  async createSettlement(
    tenantId: string,
    userId: string,
    data: { courier_id: string; branch_id?: string; assignment_ids?: string[]; notes?: string },
    correlationId?: string,
  ) {
    const preview = await this.previewSettlement(tenantId, data.courier_id, data.assignment_ids);
    if (preview.lines.length === 0) {
      throw new BadRequestException('No eligible unsettled delivery assignments for this courier');
    }

    const settleNum = `SETTLE-${Date.now().toString().slice(-6)}`;

    const settlement = this.settlementRepo.create({
      tenant_id: tenantId,
      branch_id: data.branch_id || null,
      courier_id: data.courier_id,
      settlement_number: settleNum,
      status: 'DRAFT',
      settlement_date: new Date(),
      expected_cash_amount: preview.expected_cash_amount,
      actual_cash_amount: preview.actual_cash_amount,
      cash_discrepancy_amount: '0.00',
      expected_pos_amount: preview.expected_pos_amount,
      actual_pos_amount: preview.actual_pos_amount,
      pos_discrepancy_amount: '0.00',
      total_compensation_amount: '0.00',
      total_adjustment_amount: '0.00',
      net_settlement_amount: preview.net_settlement_amount,
      notes: data.notes || null,
      created_by_user_id: userId || null,
    });

    const savedSettlement = await this.settlementRepo.save(settlement);

    const createdLines = [];
    for (const l of preview.lines) {
      const line = this.settlementLineRepo.create({
        settlement_id: savedSettlement.id,
        delivery_assignment_id: l.delivery_assignment_id,
        order_id: l.order_id,
        order_number: l.order_number,
        delivery_status: l.delivery_status,
        payment_method_code: l.payment_method_code,
        expected_cash: l.expected_cash,
        actual_cash: l.actual_cash,
        expected_pos: l.expected_pos,
        actual_pos: l.actual_pos,
        receipt_verified: true,
        delivery_fee_amount: l.delivery_fee_amount,
        commission_amount: '0.00',
        notes: null,
      });
      createdLines.push(await this.settlementLineRepo.save(line));
    }

    await this.auditWriter.write({
      tenantId,
      actorType: 'ADMIN',
      action: 'COURIER_SETTLEMENT_CREATED',
      correlationId: correlationId || 'corr-settle-create',
      afterData: { settlement: savedSettlement, lineCount: createdLines.length },
    });

    return { ...savedSettlement, lines: createdLines };
  }

  async getSettlements(tenantId: string, courierId?: string, status?: string, branchId?: string) {
    const where: any = { tenant_id: tenantId };
    if (courierId) where.courier_id = courierId;
    if (status) where.status = status;
    if (branchId) where.branch_id = branchId;

    const settlements = await this.settlementRepo.find({ where, order: { created_at: 'DESC' } });
    const result = [];

    for (const s of settlements) {
      const courier = await this.courierRepo.findOne({ where: { id: s.courier_id } });
      const lineCount = await this.settlementLineRepo.count({ where: { settlement_id: s.id } });
      result.push({
        ...s,
        courier_name: courier ? courier.name : 'Unknown Courier',
        courier_code: courier ? courier.code : 'COURIER',
        line_count: lineCount,
      });
    }

    return result;
  }

  async getSettlementDetail(tenantId: string, settlementId: string) {
    const settlement = await this.settlementRepo.findOne({ where: { id: settlementId, tenant_id: tenantId } });
    if (!settlement) throw new NotFoundException('Settlement not found');

    const courier = await this.courierRepo.findOne({ where: { id: settlement.courier_id } });
    const lines = await this.settlementLineRepo.find({ where: { settlement_id: settlement.id }, order: { created_at: 'ASC' } });

    return {
      ...settlement,
      courier_name: courier ? courier.name : 'Unknown Courier',
      courier_code: courier ? courier.code : 'COURIER',
      lines,
    };
  }

  async updateSettlement(
    tenantId: string,
    settlementId: string,
    data: {
      actual_cash_amount?: number;
      actual_pos_amount?: number;
      total_compensation_amount?: number;
      total_adjustment_amount?: number;
      notes?: string;
      lines?: Array<{ id: string; actual_cash?: number; actual_pos?: number; receipt_verified?: boolean; notes?: string }>;
    },
    correlationId?: string,
  ) {
    const settlement = await this.settlementRepo.findOne({ where: { id: settlementId, tenant_id: tenantId } });
    if (!settlement) throw new NotFoundException('Settlement not found');
    if (['CLOSED', 'REVERSED'].includes(settlement.status)) {
      throw new BadRequestException(`Cannot update settlement in ${settlement.status} state`);
    }

    if (data.notes !== undefined) settlement.notes = data.notes;

    if (data.lines && data.lines.length > 0) {
      for (const lineUpdate of data.lines) {
        const line = await this.settlementLineRepo.findOne({ where: { id: lineUpdate.id, settlement_id: settlement.id } });
        if (line) {
          if (lineUpdate.actual_cash !== undefined) line.actual_cash = lineUpdate.actual_cash.toFixed(2);
          if (lineUpdate.actual_pos !== undefined) line.actual_pos = lineUpdate.actual_pos.toFixed(2);
          if (lineUpdate.receipt_verified !== undefined) line.receipt_verified = lineUpdate.receipt_verified;
          if (lineUpdate.notes !== undefined) line.notes = lineUpdate.notes;
          await this.settlementLineRepo.save(line);
        }
      }
    }

    const lines = await this.settlementLineRepo.find({ where: { settlement_id: settlement.id } });
    let sumActualCash = 0;
    let sumActualPos = 0;
    for (const l of lines) {
      sumActualCash += parseFloat(l.actual_cash || '0');
      sumActualPos += parseFloat(l.actual_pos || '0');
    }

    if (data.actual_cash_amount !== undefined) {
      settlement.actual_cash_amount = data.actual_cash_amount.toFixed(2);
    } else {
      settlement.actual_cash_amount = sumActualCash.toFixed(2);
    }

    if (data.actual_pos_amount !== undefined) {
      settlement.actual_pos_amount = data.actual_pos_amount.toFixed(2);
    } else {
      settlement.actual_pos_amount = sumActualPos.toFixed(2);
    }

    if (data.total_compensation_amount !== undefined) {
      settlement.total_compensation_amount = data.total_compensation_amount.toFixed(2);
    }
    if (data.total_adjustment_amount !== undefined) {
      settlement.total_adjustment_amount = data.total_adjustment_amount.toFixed(2);
    }

    const expCash = parseFloat(settlement.expected_cash_amount || '0');
    const actCash = parseFloat(settlement.actual_cash_amount || '0');
    const expPos = parseFloat(settlement.expected_pos_amount || '0');
    const actPos = parseFloat(settlement.actual_pos_amount || '0');
    const comp = parseFloat(settlement.total_compensation_amount || '0');
    const adj = parseFloat(settlement.total_adjustment_amount || '0');

    settlement.cash_discrepancy_amount = (actCash - expCash).toFixed(2);
    settlement.pos_discrepancy_amount = (actPos - expPos).toFixed(2);
    settlement.net_settlement_amount = (actCash + actPos + comp - adj).toFixed(2);

    const saved = await this.settlementRepo.save(settlement);

    await this.auditWriter.write({
      tenantId,
      actorType: 'ADMIN',
      action: 'COURIER_SETTLEMENT_UPDATED',
      correlationId: correlationId || 'corr-settle-update',
      afterData: saved,
    });

    return { ...saved, lines };
  }

  async reviewSettlement(tenantId: string, settlementId: string, userId: string, correlationId?: string) {
    const settlement = await this.settlementRepo.findOne({ where: { id: settlementId, tenant_id: tenantId } });
    if (!settlement) throw new NotFoundException('Settlement not found');
    if (settlement.status !== 'DRAFT') {
      throw new BadRequestException('Only DRAFT settlements can be moved to UNDER_REVIEW');
    }

    settlement.status = 'UNDER_REVIEW';
    settlement.reviewed_by_user_id = userId || null;
    const saved = await this.settlementRepo.save(settlement);

    await this.auditWriter.write({
      tenantId,
      actorType: 'ADMIN',
      action: 'COURIER_SETTLEMENT_REVIEWED',
      correlationId: correlationId || 'corr-settle-review',
      afterData: saved,
    });

    return saved;
  }

  async closeSettlement(tenantId: string, settlementId: string, userId: string, approvalRequestId?: string, correlationId?: string) {
    const settlement = await this.settlementRepo.findOne({ where: { id: settlementId, tenant_id: tenantId } });
    if (!settlement) throw new NotFoundException('Settlement not found');
    if (['CLOSED', 'REVERSED'].includes(settlement.status)) {
      throw new BadRequestException(`Settlement is already ${settlement.status}`);
    }

    const cashDisc = parseFloat(settlement.cash_discrepancy_amount || '0');
    const posDisc = parseFloat(settlement.pos_discrepancy_amount || '0');
    const hasDiscrepancy = Math.abs(cashDisc) > 0.01 || Math.abs(posDisc) > 0.01;

    if (hasDiscrepancy && !approvalRequestId && !settlement.approval_request_id) {
      const req = await this.approvalRepo.findOne({
        where: { tenant_id: tenantId, entity_type: 'COURIER_SETTLEMENT', entity_id: settlement.id, status: 'APPROVED' },
      });
      if (!req) {
        throw new BadRequestException('Settlement has cash/POS discrepancy and requires manager approval');
      }
      settlement.approval_request_id = req.id;
    } else if (approvalRequestId) {
      settlement.approval_request_id = approvalRequestId;
    }

    settlement.status = 'CLOSED';
    settlement.closed_at = new Date();
    settlement.closed_by_user_id = userId || null;
    const saved = await this.settlementRepo.save(settlement);

    const lines = await this.settlementLineRepo.find({ where: { settlement_id: settlement.id } });
    for (const l of lines) {
      const assignment = await this.assignmentRepo.findOne({ where: { id: l.delivery_assignment_id } });
      if (assignment) {
        assignment.is_settled = true;
        assignment.settlement_id = settlement.id;
        await this.assignmentRepo.save(assignment);
      }
    }

    await this.auditWriter.write({
      tenantId,
      actorType: 'ADMIN',
      action: 'COURIER_SETTLEMENT_CLOSED',
      correlationId: correlationId || 'corr-settle-close',
      afterData: saved,
    });

    return saved;
  }

  async reverseSettlement(tenantId: string, settlementId: string, userId: string, reason?: string, correlationId?: string) {
    const settlement = await this.settlementRepo.findOne({ where: { id: settlementId, tenant_id: tenantId } });
    if (!settlement) throw new NotFoundException('Settlement not found');
    if (settlement.status !== 'CLOSED') {
      throw new BadRequestException('Only CLOSED settlements can be reversed');
    }

    settlement.status = 'REVERSED';
    if (reason) settlement.notes = (settlement.notes ? settlement.notes + ` | ` : '') + `Reversed: ${reason}`;
    const saved = await this.settlementRepo.save(settlement);

    const lines = await this.settlementLineRepo.find({ where: { settlement_id: settlement.id } });
    for (const l of lines) {
      const assignment = await this.assignmentRepo.findOne({ where: { id: l.delivery_assignment_id } });
      if (assignment) {
        assignment.is_settled = false;
        assignment.settlement_id = null;
        await this.assignmentRepo.save(assignment);
      }
    }

    await this.auditWriter.write({
      tenantId,
      actorType: 'ADMIN',
      action: 'COURIER_SETTLEMENT_REVERSED',
      correlationId: correlationId || 'corr-settle-reverse',
      afterData: saved,
    });

    return saved;
  }

  async getStatement(tenantId: string, settlementId: string) {
    const detail = await this.getSettlementDetail(tenantId, settlementId);
    return {
      statement_title: `Courier Settlement Statement - ${detail.settlement_number}`,
      settlement_number: detail.settlement_number,
      settlement_date: detail.settlement_date,
      courier_name: detail.courier_name,
      courier_code: detail.courier_code,
      status: detail.status,
      summary: {
        expected_cash_amount: detail.expected_cash_amount,
        actual_cash_amount: detail.actual_cash_amount,
        cash_discrepancy_amount: detail.cash_discrepancy_amount,
        expected_pos_amount: detail.expected_pos_amount,
        actual_pos_amount: detail.actual_pos_amount,
        pos_discrepancy_amount: detail.pos_discrepancy_amount,
        total_compensation_amount: detail.total_compensation_amount,
        total_adjustment_amount: detail.total_adjustment_amount,
        net_settlement_amount: detail.net_settlement_amount,
      },
      lines: detail.lines,
    };
  }
}
