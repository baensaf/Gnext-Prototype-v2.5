import { Injectable, NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, Not } from 'typeorm';
import { Courier } from '../../entities/Courier.entity';
import { DeliveryAssignment } from '../../entities/DeliveryAssignment.entity';
import { OrderHeader } from '../../entities/OrderHeader.entity';
import { CourierSettlement } from '../../entities/CourierSettlement.entity';
import { CourierSettlementLine } from '../../entities/CourierSettlementLine.entity';
import { Payment } from '../../entities/Payment.entity';
import { PaymentMethod } from '../../entities/PaymentMethod.entity';
import { ApprovalRequest } from '../../entities/ApprovalRequest.entity';
import { DeliveryZone } from '../../entities/DeliveryZone.entity';
import { CourierAttendance } from '../../entities/CourierAttendance.entity';
import { CourierTerminalAssignment } from '../../entities/CourierTerminalAssignment.entity';
import { Delivery, DeliveryState } from '../../entities/Delivery.entity';
import { DeliveryEvent } from '../../entities/DeliveryEvent.entity';
import { Terminal } from '../../entities/Terminal.entity';
import { CustomerAddress } from '../../entities/CustomerAddress.entity';
import { AuditWriter } from '../audit/audit-writer.service';
import { MoneyUtil } from '../../common/utils/money.util';

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
    @InjectRepository(DeliveryZone) private readonly zoneRepo: Repository<DeliveryZone>,
    @InjectRepository(CourierAttendance) private readonly attendanceRepo: Repository<CourierAttendance>,
    @InjectRepository(CourierTerminalAssignment) private readonly terminalAssignRepo: Repository<CourierTerminalAssignment>,
    @InjectRepository(Delivery) private readonly deliveryRepo: Repository<Delivery>,
    @InjectRepository(DeliveryEvent) private readonly deliveryEventRepo: Repository<DeliveryEvent>,
    @InjectRepository(Terminal) private readonly terminalRepo: Repository<Terminal>,
    @InjectRepository(CustomerAddress) private readonly customerAddressRepo: Repository<CustomerAddress>,
    private readonly auditWriter: AuditWriter,
  ) {}

  // --- 1. DELIVERY ZONES ---
  async getZones(tenantId: string, branchId?: string) {
    const where: any = { tenant_id: tenantId, is_active: true };
    if (branchId) where.branch_id = branchId;
    return await this.zoneRepo.find({ where, order: { name: 'ASC' } });
  }

  async createZone(tenantId: string, data: { branch_id: string; code: string; name: string; fee?: string | number; estimated_minutes?: number; polygon?: any; postal_prefixes?: string[] }) {
    const existing = await this.zoneRepo.findOne({ where: { tenant_id: tenantId, branch_id: data.branch_id, code: data.code.toUpperCase() } });
    if (existing) throw new ConflictException(`Delivery zone code ${data.code} already exists for this branch`);

    const zone = this.zoneRepo.create({
      tenant_id: tenantId,
      branch_id: data.branch_id,
      code: data.code.toUpperCase(),
      name: data.name,
      fee: MoneyUtil.format(data.fee || '0', 4),
      estimated_minutes: data.estimated_minutes || 30,
      polygon: data.polygon || null,
      postal_prefixes: data.postal_prefixes || null,
      is_active: true,
    });
    const saved = await this.zoneRepo.save(zone);
    await this.auditWriter.write({
      tenantId,
      actorType: 'ADMIN',
      action: 'DELIVERY_ZONE_CREATED',
      correlationId: 'corr-zone-create',
      afterData: saved,
    });
    return saved;
  }

  async deleteZone(tenantId: string, id: string) {
    const zone = await this.zoneRepo.findOne({ where: { id, tenant_id: tenantId } });
    if (!zone) throw new NotFoundException('Delivery zone not found');

    await this.zoneRepo.softDelete(id);
    return { success: true };
  }

  // --- 2. COURIERS & ATTENDANCE ---
  async getCouriers(tenantId: string, branchId?: string) {
    const where: any = { tenant_id: tenantId, is_active: true };
    if (branchId) where.branch_id = branchId;
    const couriers = await this.courierRepo.find({ where, order: { name: 'ASC' } });

    const todayStr = new Date().toISOString().slice(0, 10);
    const enriched = [];

    for (const c of couriers) {
      const attendance = await this.attendanceRepo.findOne({
        where: { tenant_id: tenantId, courier_id: c.id, date: todayStr },
        order: { created_at: 'DESC' },
      });
      const terminalAssign = await this.terminalAssignRepo.findOne({
        where: { tenant_id: tenantId, courier_id: c.id, is_active: true },
      });
      const activeDeliveryCount = await this.deliveryRepo.count({
        where: { tenant_id: tenantId, courier_id: c.id, state: In(['ASSIGNED', 'PICKED_UP', 'EN_ROUTE']) },
      });

      let terminalName = null;
      if (terminalAssign) {
        const term = await this.terminalRepo.findOne({ where: { id: terminalAssign.terminal_id } });
        if (term) terminalName = term.name || term.code;
      }

      enriched.push({
        ...c,
        attendance: attendance || { status: 'CHECKED_OUT', availability_status: 'OFF_LINE' },
        active_terminal: terminalAssign ? { ...terminalAssign, terminal_name: terminalName } : null,
        active_delivery_count: activeDeliveryCount,
      });
    }

    return enriched;
  }

  async getCourierById(tenantId: string, id: string) {
    const c = await this.courierRepo.findOne({ where: { tenant_id: tenantId, id } });
    if (!c) throw new NotFoundException(`Courier ${id} not found`);

    const todayStr = new Date().toISOString().slice(0, 10);
    const attendance = await this.attendanceRepo.findOne({
      where: { tenant_id: tenantId, courier_id: c.id, date: todayStr },
      order: { created_at: 'DESC' },
    });
    const terminalAssign = await this.terminalAssignRepo.findOne({
      where: { tenant_id: tenantId, courier_id: c.id, is_active: true },
    });
    const activeDeliveryCount = await this.deliveryRepo.count({
      where: { tenant_id: tenantId, courier_id: c.id, state: In(['ASSIGNED', 'PICKED_UP', 'EN_ROUTE']) },
    });

    let terminalName = null;
    if (terminalAssign) {
      const term = await this.terminalRepo.findOne({ where: { id: terminalAssign.terminal_id } });
      if (term) terminalName = term.name || term.code;
    }

    return {
      ...c,
      attendance: attendance || { status: 'CHECKED_OUT', availability_status: 'OFF_LINE' },
      active_terminal: terminalAssign ? { ...terminalAssign, terminal_name: terminalName } : null,
      active_delivery_count: activeDeliveryCount,
    };
  }

  async createCourier(
    tenantId: string,
    data: { branch_id?: string; code: string; name: string; phone?: string; vehicle_type?: string; compensation_per_delivery?: string | number },
    correlationId: string = 'corr-courier-create',
  ) {
    const courier = this.courierRepo.create({
      tenant_id: tenantId,
      branch_id: data.branch_id || null,
      code: data.code.toUpperCase(),
      name: data.name,
      phone: data.phone || null,
      vehicle_type: data.vehicle_type || 'MOTORCYCLE',
      compensation_per_delivery: MoneyUtil.format(data.compensation_per_delivery || '0', 4),
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

  async recordAttendance(
    tenantId: string,
    data: { courier_id: string; branch_id: string; status: 'CHECKED_IN' | 'CHECKED_OUT' | 'PAUSED'; availability_status?: 'AVAILABLE' | 'BUSY' | 'OFF_LINE' },
  ) {
    const courier = await this.courierRepo.findOne({ where: { id: data.courier_id, tenant_id: tenantId } });
    if (!courier) throw new NotFoundException('Courier not found');

    const todayStr = new Date().toISOString().slice(0, 10);
    let attendance = await this.attendanceRepo.findOne({
      where: { tenant_id: tenantId, courier_id: data.courier_id, date: todayStr },
    });

    if (!attendance) {
      let targetBranchId = data.branch_id || courier.branch_id;
      if (!targetBranchId) {
        const defaultTerm = await this.terminalRepo.findOne({ where: { tenant_id: tenantId } });
        targetBranchId = defaultTerm?.branch_id || null;
      }
      if (!targetBranchId) {
        throw new BadRequestException('Branch ID is required for courier attendance');
      }
      attendance = this.attendanceRepo.create({
        tenant_id: tenantId,
        courier_id: data.courier_id,
        branch_id: targetBranchId,
        date: todayStr,
        status: data.status,
        availability_status: data.availability_status || (data.status === 'CHECKED_IN' ? 'AVAILABLE' : 'OFF_LINE'),
        checked_in_at: new Date(),
      });
    } else {
      attendance.status = data.status;
      if (data.availability_status) {
        attendance.availability_status = data.availability_status;
      } else if (data.status === 'CHECKED_IN') {
        attendance.availability_status = 'AVAILABLE';
      } else if (data.status === 'CHECKED_OUT') {
        attendance.availability_status = 'OFF_LINE';
        attendance.checked_out_at = new Date();
      }
    }

    const saved = await this.attendanceRepo.save(attendance);

    courier.status = data.status === 'CHECKED_IN' ? 'AVAILABLE' : 'INACTIVE';
    await this.courierRepo.save(courier);

    await this.auditWriter.write({
      tenantId,
      actorType: 'ADMIN',
      action: 'COURIER_ATTENDANCE_UPDATED',
      correlationId: 'corr-courier-attendance',
      afterData: saved,
    });

    return saved;
  }

  async setCourierAvailability(tenantId: string, courierId: string, availabilityStatus: 'AVAILABLE' | 'BUSY' | 'OFF_LINE') {
    const todayStr = new Date().toISOString().slice(0, 10);
    let attendance = await this.attendanceRepo.findOne({
      where: { tenant_id: tenantId, courier_id: courierId, date: todayStr },
    });

    if (!attendance) {
      throw new BadRequestException('Courier is not checked in today. Please check in first.');
    }

    attendance.availability_status = availabilityStatus;
    const saved = await this.attendanceRepo.save(attendance);
    return saved;
  }

  // --- 3. MOBILE TERMINAL ASSIGNMENT ---
  async assignMobileTerminal(tenantId: string, courierId: string, terminalId: string) {
    const courier = await this.courierRepo.findOne({ where: { id: courierId, tenant_id: tenantId } });
    if (!courier) throw new NotFoundException('Courier not found');

    const terminal = await this.terminalRepo.findOne({ where: { id: terminalId, tenant_id: tenantId } });
    if (!terminal) throw new NotFoundException('Terminal not found');

    const existingTerminalAssign = await this.terminalAssignRepo.findOne({
      where: { tenant_id: tenantId, terminal_id: terminalId, is_active: true, courier_id: Not(courierId) },
    });
    if (existingTerminalAssign) {
      throw new BadRequestException(`Mobile POS terminal ${terminal.name || terminal.code} is already assigned to another active courier`);
    }

    const activeAssigns = await this.terminalAssignRepo.find({
      where: { tenant_id: tenantId, courier_id: courierId, is_active: true },
    });
    for (const a of activeAssigns) {
      a.is_active = false;
      a.unassigned_at = new Date();
      await this.terminalAssignRepo.save(a);
    }

    const newAssign = this.terminalAssignRepo.create({
      tenant_id: tenantId,
      courier_id: courierId,
      terminal_id: terminalId,
      assigned_at: new Date(),
      is_active: true,
    });
    const saved = await this.terminalAssignRepo.save(newAssign);

    await this.auditWriter.write({
      tenantId,
      actorType: 'ADMIN',
      action: 'COURIER_TERMINAL_ASSIGNED',
      correlationId: 'corr-terminal-assign',
      afterData: saved,
    });

    return saved;
  }

  async unassignMobileTerminal(tenantId: string, courierId: string) {
    const activeAssigns = await this.terminalAssignRepo.find({
      where: { tenant_id: tenantId, courier_id: courierId, is_active: true },
    });
    for (const a of activeAssigns) {
      a.is_active = false;
      a.unassigned_at = new Date();
      await this.terminalAssignRepo.save(a);
    }
    return { success: true };
  }

  // --- 4. DELIVERY EXECUTION & STATE MACHINE ---
  private async reconcileDeliveryWithOrder(tenantId: string, delivery: Delivery, order: OrderHeader): Promise<Delivery> {
    const orderState = String(order.state || order.status || '').toUpperCase();
    let expectedState: DeliveryState | null = null;

    if (orderState === 'COMPLETED') expectedState = 'DELIVERED';
    if (orderState === 'CANCELLED') expectedState = 'CANCELLED';
    if (orderState === 'OUT_FOR_DELIVERY' && !['DELIVERED', 'CANCELLED'].includes(delivery.state)) {
      expectedState = 'EN_ROUTE';
    }

    if (!expectedState) return delivery;

    const assignment = await this.assignmentRepo.findOne({
      where: { tenant_id: tenantId, order_id: delivery.order_id },
    });
    if (assignment && assignment.status !== expectedState) {
      assignment.status = expectedState;
      if (expectedState === 'DELIVERED' && !assignment.delivered_at) {
        assignment.delivered_at = order.completed_at || new Date();
      }
      await this.assignmentRepo.save(assignment);
    }

    if (delivery.state === expectedState) return delivery;

    const fromState = delivery.state;
    delivery.state = expectedState;
    if (expectedState === 'DELIVERED' && !delivery.delivered_at) {
      delivery.delivered_at = order.completed_at || new Date();
    }
    const saved = await this.deliveryRepo.save(delivery);
    await this.logDeliveryEvent(
      tenantId,
      saved.id,
      fromState,
      expectedState,
      `Reconciled from parent order state ${orderState}`,
    );
    return saved;
  }

  async createDeliveryForOrder(tenantId: string, orderId: string, zoneId?: string, _addressSnapshot?: any) {
    const order = await this.orderRepo.findOne({ where: { id: orderId, tenant_id: tenantId } });
    if (!order) throw new NotFoundException(`Order ${orderId} not found`);

    const existing = await this.deliveryRepo.findOne({ where: { tenant_id: tenantId, order_id: orderId } });
    if (existing) return await this.reconcileDeliveryWithOrder(tenantId, existing, order);

    if (['COMPLETED', 'CANCELLED'].includes(String(order.state || order.status).toUpperCase())) {
      throw new BadRequestException(`Cannot create a delivery for a ${String(order.state || order.status).toLowerCase()} order`);
    }

    if (order.order_type !== 'DELIVERY') throw new BadRequestException('DELIVERY_ORDER_TYPE_REQUIRED');
    if (!order.customer_id) throw new BadRequestException('DELIVERY_CUSTOMER_REQUIRED');
    if (!order.customer_address_id) throw new BadRequestException('DELIVERY_ADDRESS_REQUIRED');
    if (!order.delivery_zone_id) throw new BadRequestException('DELIVERY_ZONE_REQUIRED');
    if (zoneId && zoneId !== order.delivery_zone_id) throw new BadRequestException('DELIVERY_ZONE_MISMATCH');

    const address = await this.customerAddressRepo.findOne({
      where: { id: order.customer_address_id, tenant_id: tenantId },
    });
    if (!address) throw new BadRequestException('DELIVERY_ADDRESS_NOT_FOUND');
    if (address.customer_id !== order.customer_id) throw new BadRequestException('DELIVERY_ADDRESS_CUSTOMER_MISMATCH');
    const zone = await this.zoneRepo.findOne({
      where: { id: order.delivery_zone_id, tenant_id: tenantId, branch_id: order.branch_id, is_active: true },
    });
    if (!zone) throw new BadRequestException('DELIVERY_ZONE_INVALID_OR_INACTIVE');

    const delivery = this.deliveryRepo.create({
      tenant_id: tenantId,
      order_id: orderId,
      zone_id: zone.id,
      state: 'UNASSIGNED',
      fee: zone.fee,
      currency_code: order.currency_code || 'IRR',
      address_snapshot: {
        address_id: address.id,
        title: address.title,
        address_text: address.address_text,
        postal_code: address.postal_code || null,
        customer_id: order.customer_id,
      },
    });
    const saved = await this.deliveryRepo.save(delivery);

    await this.logDeliveryEvent(tenantId, saved.id, 'NONE', 'UNASSIGNED', 'Delivery order submitted');
    return saved;
  }

  async assignCourier(tenantId: string, deliveryId: string, courierId: string, userId?: string) {
    const delivery = await this.deliveryRepo.findOne({ where: { id: deliveryId, tenant_id: tenantId } });
    if (!delivery) throw new NotFoundException('Delivery not found');

    const order = await this.orderRepo.findOne({ where: { id: delivery.order_id, tenant_id: tenantId } });
    if (!order) throw new NotFoundException('Parent order not found');
    const orderState = String(order.state || order.status).toUpperCase();
    if (['COMPLETED', 'CANCELLED'].includes(orderState)) {
      await this.reconcileDeliveryWithOrder(tenantId, delivery, order);
      throw new BadRequestException(`Cannot assign a courier to a ${orderState.toLowerCase()} order`);
    }
    if (['DELIVERED', 'CANCELLED'].includes(delivery.state)) {
      throw new BadRequestException(`Cannot assign a courier to a ${delivery.state.toLowerCase()} delivery`);
    }

    const courier = await this.courierRepo.findOne({ where: { id: courierId, tenant_id: tenantId } });
    if (!courier) throw new NotFoundException('Courier not found');
    if (!courier.is_active) throw new BadRequestException('Courier profile is inactive');

    const todayStr = new Date().toISOString().slice(0, 10);
    const attendance = await this.attendanceRepo.findOne({
      where: { tenant_id: tenantId, courier_id: courierId, date: todayStr },
    });
    if (!attendance || attendance.status !== 'CHECKED_IN') {
      throw new BadRequestException(`Courier ${courier.name} is not checked in today`);
    }

    if (attendance.availability_status !== 'AVAILABLE') {
      throw new BadRequestException(`Courier ${courier.name} is currently ${attendance.availability_status}`);
    }

    const activeCount = await this.deliveryRepo.count({
      where: { tenant_id: tenantId, courier_id: courierId, state: In(['ASSIGNED', 'PICKED_UP', 'EN_ROUTE']) },
    });
    if (activeCount >= 5) {
      throw new BadRequestException(`Courier ${courier.name} has reached maximum active delivery capacity (5)`);
    }

    const fromState = delivery.state;
    delivery.courier_id = courierId;
    delivery.state = 'ASSIGNED';
    delivery.assigned_at = new Date();

    const saved = await this.deliveryRepo.save(delivery);
    await this.logDeliveryEvent(tenantId, saved.id, fromState, 'ASSIGNED', `Assigned to ${courier.name}`, userId);

    let assignment = await this.assignmentRepo.findOne({ where: { tenant_id: tenantId, order_id: delivery.order_id, courier_id: courierId } });
    if (!assignment) {
      assignment = this.assignmentRepo.create({
        tenant_id: tenantId,
        order_id: delivery.order_id,
        courier_id: courierId,
        status: 'ASSIGNED',
        assigned_at: new Date(),
        delivery_fee: delivery.fee || '0.00',
        tip_amount: '0.00',
      });
    } else {
      assignment.status = 'ASSIGNED';
      assignment.assigned_at = new Date();
    }
    await this.assignmentRepo.save(assignment);

    await this.auditWriter.write({
      tenantId,
      actorType: userId ? 'ADMIN' : 'SYSTEM',
      actorId: userId,
      action: 'DELIVERY_COURIER_ASSIGNED',
      correlationId: 'corr-assign-courier',
      details: { deliveryId, courierId, courierName: courier.name },
    });

    return saved;
  }

  async departDelivery(tenantId: string, deliveryId: string, userId?: string) {
    const delivery = await this.deliveryRepo.findOne({ where: { id: deliveryId, tenant_id: tenantId } });
    if (!delivery) throw new NotFoundException('Delivery not found');

    const order = await this.orderRepo.findOne({ where: { id: delivery.order_id, tenant_id: tenantId } });
    if (!order) throw new NotFoundException('Parent order not found');
    const orderState = String(order.state || order.status).toUpperCase();
    if (['COMPLETED', 'CANCELLED'].includes(orderState)) {
      await this.reconcileDeliveryWithOrder(tenantId, delivery, order);
      throw new BadRequestException(`Cannot depart a ${orderState.toLowerCase()} order`);
    }
    if (!['ASSIGNED', 'PICKED_UP'].includes(delivery.state)) {
      throw new BadRequestException(`Delivery must be assigned before departure (current state: ${delivery.state})`);
    }

    const fromState = delivery.state;
    delivery.state = 'EN_ROUTE';
    delivery.picked_up_at = new Date();

    const saved = await this.deliveryRepo.save(delivery);
    await this.logDeliveryEvent(tenantId, saved.id, fromState, 'EN_ROUTE', 'Courier departed with delivery package', userId);

    if (delivery.courier_id) {
      const assignment = await this.assignmentRepo.findOne({ where: { tenant_id: tenantId, order_id: delivery.order_id, courier_id: delivery.courier_id } });
      if (assignment) {
        assignment.status = 'OUT_FOR_DELIVERY';
        assignment.picked_up_at = new Date();
        await this.assignmentRepo.save(assignment);
      }
    }

    order.state = 'OUT_FOR_DELIVERY';
    order.status = 'OUT_FOR_DELIVERY';
    order.fulfillment_status = 'OUT_FOR_DELIVERY';
    await this.orderRepo.save(order);

    return saved;
  }

  async completeDelivery(tenantId: string, deliveryId: string, data?: { cashCollected?: number; posAmount?: number }, userId?: string) {
    const delivery = await this.deliveryRepo.findOne({ where: { id: deliveryId, tenant_id: tenantId } });
    if (!delivery) throw new NotFoundException('Delivery not found');

    const order = await this.orderRepo.findOne({ where: { id: delivery.order_id, tenant_id: tenantId } });
    if (!order) throw new NotFoundException('Parent order not found');
    const orderState = String(order.state || order.status).toUpperCase();
    if (orderState === 'COMPLETED') {
      return await this.reconcileDeliveryWithOrder(tenantId, delivery, order);
    }
    if (orderState === 'CANCELLED') {
      await this.reconcileDeliveryWithOrder(tenantId, delivery, order);
      throw new BadRequestException('Cannot complete a cancelled order');
    }
    if (!['EN_ROUTE', 'PICKED_UP'].includes(delivery.state)) {
      throw new BadRequestException(`Delivery must be en route before completion (current state: ${delivery.state})`);
    }

    const fromState = delivery.state;
    delivery.state = 'DELIVERED';
    delivery.delivered_at = new Date();

    const payments = await this.paymentRepo.find({ where: { order_id: delivery.order_id, tenant_id: tenantId } });
    let cashExpStr = '0.0000';
    let posExpStr = '0.0000';

    for (const p of payments) {
      const pAmtStr = MoneyUtil.format(p.amount || '0', 4);
      if (p.method_kind === 'CASH' || (p as any).payment_method_code === 'CASH') {
        cashExpStr = MoneyUtil.add(cashExpStr, pAmtStr, 4);
      } else {
        posExpStr = MoneyUtil.add(posExpStr, pAmtStr, 4);
      }
    }

    if (data?.cashCollected !== undefined) cashExpStr = MoneyUtil.format(data.cashCollected, 4);
    if (data?.posAmount !== undefined) posExpStr = MoneyUtil.format(data.posAmount, 4);

    delivery.cash_expected = cashExpStr;
    delivery.mobile_pos_expected = posExpStr;

    if (delivery.courier_id) {
      const courier = await this.courierRepo.findOne({ where: { id: delivery.courier_id } });
      if (courier) {
        delivery.compensation_amount = courier.compensation_per_delivery || '0.0000';
      }
    }

    const saved = await this.deliveryRepo.save(delivery);
    await this.logDeliveryEvent(tenantId, saved.id, fromState, 'DELIVERED', 'Delivery successfully completed', userId);

    if (delivery.courier_id) {
      let assignment = await this.assignmentRepo.findOne({ where: { tenant_id: tenantId, order_id: delivery.order_id, courier_id: delivery.courier_id } });
      if (!assignment) {
        assignment = this.assignmentRepo.create({
          tenant_id: tenantId,
          order_id: delivery.order_id,
          courier_id: delivery.courier_id,
          status: 'DELIVERED',
          assigned_at: delivery.assigned_at || new Date(),
          delivered_at: new Date(),
          delivery_fee: delivery.fee || '0.00',
          tip_amount: '0.00',
        });
      } else {
        assignment.status = 'DELIVERED';
        assignment.delivered_at = new Date();
      }
      await this.assignmentRepo.save(assignment);
    }

    order.state = 'COMPLETED';
    order.status = 'COMPLETED';
    order.fulfillment_status = 'DELIVERED';
    order.completed_at = new Date();
    await this.orderRepo.save(order);

    return saved;
  }

  async failDelivery(tenantId: string, deliveryId: string, reason: string, userId?: string) {
    const delivery = await this.deliveryRepo.findOne({ where: { id: deliveryId, tenant_id: tenantId } });
    if (!delivery) throw new NotFoundException('Delivery not found');

    const fromState = delivery.state;
    delivery.state = 'FAILED';
    delivery.failure_reason = reason || 'Delivery attempt failed';

    const saved = await this.deliveryRepo.save(delivery);
    await this.logDeliveryEvent(tenantId, saved.id, fromState, 'FAILED', `Delivery failed: ${reason}`, userId);

    const order = await this.orderRepo.findOne({ where: { id: delivery.order_id, tenant_id: tenantId } });
    if (order) {
      order.state = 'READY';
      order.status = 'READY';
      await this.orderRepo.save(order);
    }

    return saved;
  }

  async requeueDelivery(tenantId: string, deliveryId: string, userId?: string) {
    const delivery = await this.deliveryRepo.findOne({ where: { id: deliveryId, tenant_id: tenantId } });
    if (!delivery) throw new NotFoundException('Delivery not found');

    const fromState = delivery.state;
    delivery.state = 'UNASSIGNED';
    delivery.courier_id = null;
    delivery.failure_reason = null;

    const saved = await this.deliveryRepo.save(delivery);
    await this.logDeliveryEvent(tenantId, saved.id, fromState, 'UNASSIGNED', 'Delivery requeued for dispatch', userId);
    return saved;
  }

  async getDeliveries(tenantId: string, branchId?: string, state?: string) {
    const where: any = { tenant_id: tenantId };
    const deliveries = await this.deliveryRepo.find({ where, order: { created_at: 'DESC' } });
    const result = [];

    for (const d of deliveries) {
      const order = await this.orderRepo.findOne({ where: { id: d.order_id, tenant_id: tenantId } });
      if (!order || (branchId && order.branch_id !== branchId)) continue;

      const reconciled = await this.reconcileDeliveryWithOrder(tenantId, d, order);
      if (state && reconciled.state !== state) continue;

      const courier = reconciled.courier_id ? await this.courierRepo.findOne({ where: { id: reconciled.courier_id, tenant_id: tenantId } }) : null;
      const zone = reconciled.zone_id ? await this.zoneRepo.findOne({ where: { id: reconciled.zone_id, tenant_id: tenantId } }) : null;

      result.push({
        ...reconciled,
        order_number: order ? order.order_number : 'ORD-00',
        grand_total: order ? order.grand_total : '0.0000',
        customer_name: order ? (order as any).customer_name || 'Customer' : 'Customer',
        courier_name: courier ? courier.name : 'Unassigned',
        courier_phone: courier ? courier.phone : '',
        zone_name: zone ? zone.name : 'Default Zone',
      });
    }

    return result;
  }

  async getDeliveryEvents(tenantId: string, deliveryId: string) {
    return await this.deliveryEventRepo.find({
      where: { tenant_id: tenantId, delivery_id: deliveryId },
      order: { occurred_at: 'ASC' },
    });
  }

  private async logDeliveryEvent(tenantId: string, deliveryId: string, fromState: string, toState: string, reason?: string, userId?: string) {
    const event = this.deliveryEventRepo.create({
      tenant_id: tenantId,
      delivery_id: deliveryId,
      from_state: fromState,
      to_state: toState,
      reason: reason || null,
      occurred_by: userId || null,
    });
    await this.deliveryEventRepo.save(event);
  }

  // --- LEGACY ASSIGNMENT BACKWARDS COMPATIBILITY & COURIER SETTLEMENTS ---
  async assignOrder(tenantId: string, orderId: string, courierId: string, deliveryFee?: number, tipAmount?: number, correlationId?: string) {
    let delivery = await this.deliveryRepo.findOne({ where: { tenant_id: tenantId, order_id: orderId } });
    if (!delivery) {
      delivery = await this.createDeliveryForOrder(tenantId, orderId);
    }
    return await this.assignCourier(tenantId, delivery.id, courierId);
  }

  async getAssignments(tenantId: string, branchId?: string, statusFilter?: string) {
    return await this.getDeliveries(tenantId, branchId, statusFilter);
  }

  async updateAssignmentStatus(tenantId: string, assignmentId: string, status: string, failureReason?: string, correlationId?: string) {
    if (status === 'EN_ROUTE' || status === 'PICKED_UP') {
      return await this.departDelivery(tenantId, assignmentId);
    }
    if (status === 'DELIVERED') {
      return await this.completeDelivery(tenantId, assignmentId);
    }
    if (status === 'FAILED') {
      return await this.failDelivery(tenantId, assignmentId, failureReason || 'Failed');
    }
    const delivery = await this.deliveryRepo.findOne({ where: { id: assignmentId, tenant_id: tenantId } });
    if (delivery) {
      delivery.state = status as any;
      return await this.deliveryRepo.save(delivery);
    }
    throw new NotFoundException('Delivery not found');
  }

  private async calculatePaymentBreakdown(orderId: string, defaultTotal: string | number = '0.0000') {
    const payments = await this.paymentRepo.find({ where: { order_id: orderId, status: In(['SUCCEEDED', 'COMPLETED']) as any } });
    let expCashStr = '0.0000';
    let expPosStr = '0.0000';
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
        const pAmtStr = MoneyUtil.format(p.amount || '0', 4);
        if (isCash) {
          expCashStr = MoneyUtil.add(expCashStr, pAmtStr, 4);
        } else {
          expPosStr = MoneyUtil.add(expPosStr, pAmtStr, 4);
        }
      }
      primaryMethod = MoneyUtil.greaterThanOrEqual(expCashStr, expPosStr) ? 'CASH' : 'CARD';
    } else {
      expCashStr = MoneyUtil.format(defaultTotal || 0, 4);
      primaryMethod = 'CASH';
    }

    return { expCashStr, expPosStr, primaryMethod, expCash: expCashStr, expPos: expPosStr };
  }

  async getUnsettledSummary(tenantId: string, branchId?: string) {
    const couriers = await this.getCouriers(tenantId, branchId);
    const summary = [];

    for (const courier of couriers) {
      const unsettledDeliveries = await this.deliveryRepo.find({
        where: {
          tenant_id: tenantId,
          courier_id: courier.id,
          state: 'DELIVERED',
        },
      });

      let totalExpectedCash = '0.0000';
      let totalExpectedPos = '0.0000';
      let totalDeliveryFees = '0.0000';
      let totalCompensation = '0.0000';

      for (const d of unsettledDeliveries) {
        totalDeliveryFees = MoneyUtil.add(totalDeliveryFees, d.fee || '0', 4);
        totalExpectedCash = MoneyUtil.add(totalExpectedCash, d.cash_expected || '0', 4);
        totalExpectedPos = MoneyUtil.add(totalExpectedPos, d.mobile_pos_expected || '0', 4);
        totalCompensation = MoneyUtil.add(totalCompensation, d.compensation_amount || '0', 4);
      }

      const totalExpected = MoneyUtil.add(totalExpectedCash, totalExpectedPos, 4);
      const netDue = MoneyUtil.subtract(totalExpected, totalCompensation, 4);

      summary.push({
        courier_id: courier.id,
        courier_name: courier.name,
        unsettled_orders_count: unsettledDeliveries.length,
        total_delivery_fees: totalDeliveryFees,
        total_expected_cash: totalExpectedCash,
        total_expected_pos: totalExpectedPos,
        total_compensation: totalCompensation,
        net_due_amount: netDue,
      });
    }

    return summary;
  }

  async previewSettlement(tenantId: string, courierId: string, assignmentIds?: string[], branchId?: string, dateFrom?: string, dateTo?: string, currency?: string) {
    const courier = await this.courierRepo.findOne({ where: { id: courierId, tenant_id: tenantId } });
    if (!courier) throw new NotFoundException('Courier not found');

    // Find active or closed non-reversed settlements to exclude already reserved lines
    const existingSettlements = (await this.settlementRepo.find({
      where: { tenant_id: tenantId, status: In(['DRAFT', 'UNDER_REVIEW', 'CLOSED']) },
    })) || [];
    const reservedLineAssignmentIds = new Set<string>();
    if (existingSettlements && existingSettlements.length > 0) {
      const activeSettlementIds = existingSettlements.map((s) => s.id);
      const existingLines = (await this.settlementLineRepo.find({
        where: { settlement_id: In(activeSettlementIds) },
      })) || [];
      if (existingLines && existingLines.length > 0) {
        for (const line of existingLines) {
          if (line.delivery_assignment_id) {
            reservedLineAssignmentIds.add(line.delivery_assignment_id);
          }
        }
      }
    }

    const where: any = {
      tenant_id: tenantId,
      courier_id: courierId,
      status: In(['DELIVERED', 'FAILED', 'RETURNED']),
    };
    if (assignmentIds && assignmentIds.length > 0) {
      where.id = In(assignmentIds);
    }

    const assignments = await this.assignmentRepo.find({ where });
    for (const a of assignments) {
      if (a.is_settled) {
        throw new ConflictException(`Assignment ${a.id} is already settled`);
      }
      if (reservedLineAssignmentIds.has(a.id)) {
        throw new ConflictException(`Assignment ${a.id} is already reserved in an active or closed settlement`);
      }
    }
    const eligibleAssignments = assignments;

    let expCashStr = '0.00';
    let expPosStr = '0.00';
    let totalFeeStr = '0.00';

    for (const a of eligibleAssignments) {
      totalFeeStr = MoneyUtil.add(totalFeeStr, a.delivery_fee || '0', 2);
      const order = await this.orderRepo.findOne({ where: { id: a.order_id } });
      const breakdown = await this.calculatePaymentBreakdown(a.order_id, order?.total_amount || '0');
      expCashStr = MoneyUtil.add(expCashStr, breakdown.expCashStr, 2);
      expPosStr = MoneyUtil.add(expPosStr, breakdown.expPosStr, 2);
    }

    return {
      courier_id: courierId,
      courier_name: courier.name,
      courier_code: courier.code,
      line_count: eligibleAssignments.length,
      expected_cash_amount: expCashStr,
      expected_pos_amount: expPosStr,
      total_delivery_fees: totalFeeStr,
      net_settlement_amount: MoneyUtil.add(expCashStr, expPosStr, 2),
      assignment_ids: eligibleAssignments.map((a) => a.id),
    };
  }

  async createSettlement(
    tenantId: string,
    userId: string,
    data: { courier_id: string; branch_id?: string; dateFrom?: string; dateTo?: string; currency?: string; assignment_ids?: string[]; notes?: string },
    correlationId?: string,
  ) {
    const preview = await this.previewSettlement(tenantId, data.courier_id, data.assignment_ids, data.branch_id, data.dateFrom, data.dateTo, data.currency);
    const courier = await this.courierRepo.findOne({ where: { id: data.courier_id } });

    const settlementNumber = `SET-${Date.now().toString().slice(-6)}`;

    let targetBranchId = data.branch_id || courier?.branch_id;
    if (!targetBranchId) {
      const defaultTerm = await this.terminalRepo.findOne({ where: { tenant_id: tenantId } });
      targetBranchId = defaultTerm?.branch_id || null;
    }
    if (!targetBranchId) {
      throw new BadRequestException('Branch ID is required for settlement creation');
    }

    const settlement = this.settlementRepo.create({
      tenant_id: tenantId,
      branch_id: targetBranchId,
      courier_id: data.courier_id,
      settlement_number: settlementNumber,
      settlement_date: new Date(),
      status: 'DRAFT',
      expected_cash_amount: preview.expected_cash_amount,
      actual_cash_amount: preview.expected_cash_amount,
      expected_pos_amount: preview.expected_pos_amount,
      actual_pos_amount: preview.expected_pos_amount,
      cash_discrepancy_amount: '0.00',
      pos_discrepancy_amount: '0.00',
      total_compensation_amount: '0.00',
      total_adjustment_amount: '0.00',
      net_settlement_amount: preview.net_settlement_amount,
      created_by_user_id: userId,
      notes: data.notes || null,
    });

    const savedSettlement = await this.settlementRepo.save(settlement);
    const lines = [];

    for (const asgnId of preview.assignment_ids) {
      const asgn = await this.assignmentRepo.findOne({ where: { id: asgnId } });
      if (!asgn) continue;

      const order = await this.orderRepo.findOne({ where: { id: asgn.order_id } });
      const breakdown = await this.calculatePaymentBreakdown(asgn.order_id, order?.total_amount || '0');

      const line = this.settlementLineRepo.create({
        settlement_id: savedSettlement.id,
        delivery_assignment_id: asgn.id,
        order_id: asgn.order_id,
        order_number: order?.order_number || 'ORD-00',
        delivery_status: asgn.status || 'DELIVERED',
        payment_method_code: breakdown.primaryMethod,
        expected_cash: MoneyUtil.format(breakdown.expCashStr, 2),
        actual_cash: MoneyUtil.format(breakdown.expCashStr, 2),
        expected_pos: MoneyUtil.format(breakdown.expPosStr, 2),
        actual_pos: MoneyUtil.format(breakdown.expPosStr, 2),
        delivery_fee_amount: MoneyUtil.format(asgn.delivery_fee || '0.00', 2),
        receipt_verified: true,
      });
      const savedLine = await this.settlementLineRepo.save(line);
      lines.push(savedLine);
    }

    await this.auditWriter.write({
      tenantId,
      actorType: 'ADMIN',
      action: 'COURIER_SETTLEMENT_CREATED',
      correlationId: correlationId || 'corr-settle-create',
      afterData: savedSettlement,
    });

    return { ...savedSettlement, lines };
  }

  async updateSettlement(tenantId: string, id: string, data: any, correlationId?: string) {
    const settlement = await this.settlementRepo.findOne({ where: { id, tenant_id: tenantId } });
    if (!settlement) throw new NotFoundException('Settlement not found');

    if (settlement.status === 'CLOSED' || settlement.status === 'REVERSED') {
      throw new BadRequestException(`Settlement is ${settlement.status} and cannot be modified. Closed/reversed batches are immutable.`);
    }

    if (data.lines && Array.isArray(data.lines)) {
      let linesActCash = '0.00';
      let linesActPos = '0.00';
      for (const lineData of data.lines) {
        if (!lineData.id) continue;
        const line = await this.settlementLineRepo.findOne({ where: { id: lineData.id, settlement_id: id } });
        if (line) {
          if (lineData.actual_cash !== undefined) line.actual_cash = MoneyUtil.format(lineData.actual_cash, 2);
          if (lineData.actual_pos !== undefined) line.actual_pos = MoneyUtil.format(lineData.actual_pos, 2);
          if (lineData.receipt_verified !== undefined) line.receipt_verified = Boolean(lineData.receipt_verified);
          await this.settlementLineRepo.save(line);
          linesActCash = MoneyUtil.add(linesActCash, line.actual_cash || '0.00', 2);
          linesActPos = MoneyUtil.add(linesActPos, line.actual_pos || '0.00', 2);
        }
      }
      if (data.actual_cash_amount === undefined) settlement.actual_cash_amount = linesActCash;
      if (data.actual_pos_amount === undefined) settlement.actual_pos_amount = linesActPos;
    }

    if (data.actual_cash_amount !== undefined) {
      settlement.actual_cash_amount = MoneyUtil.format(data.actual_cash_amount, 2);
    }
    if (data.actual_pos_amount !== undefined) {
      settlement.actual_pos_amount = MoneyUtil.format(data.actual_pos_amount, 2);
    }
    if (data.total_compensation_amount !== undefined) {
      settlement.total_compensation_amount = MoneyUtil.format(data.total_compensation_amount, 2);
    }
    if (data.total_adjustment_amount !== undefined) {
      settlement.total_adjustment_amount = MoneyUtil.format(data.total_adjustment_amount, 2);
    }
    if (data.notes !== undefined) {
      settlement.notes = data.notes;
    }

    const expCash = settlement.expected_cash_amount || '0.00';
    const actCash = settlement.actual_cash_amount || '0.00';
    const expPos = settlement.expected_pos_amount || '0.00';
    const actPos = settlement.actual_pos_amount || '0.00';
    const comp = settlement.total_compensation_amount || '0.00';
    const adj = settlement.total_adjustment_amount || '0.00';

    settlement.cash_discrepancy_amount = MoneyUtil.subtract(actCash, expCash, 2);
    settlement.pos_discrepancy_amount = MoneyUtil.subtract(actPos, expPos, 2);

    const grossCollected = MoneyUtil.add(actCash, actPos, 2);
    const afterComp = MoneyUtil.subtract(grossCollected, comp, 2);
    settlement.net_settlement_amount = MoneyUtil.add(afterComp, adj, 2);

    const saved = await this.settlementRepo.save(settlement);
    await this.auditWriter.write({
      tenantId,
      actorType: 'ADMIN',
      action: 'COURIER_SETTLEMENT_UPDATED',
      correlationId: correlationId || 'corr-settle-update',
      afterData: saved,
    });

    return saved;
  }

  async reviewSettlement(tenantId: string, id: string, userId: string, correlationId?: string) {
    const settlement = await this.settlementRepo.findOne({ where: { id, tenant_id: tenantId } });
    if (!settlement) throw new NotFoundException('Settlement not found');

    if (settlement.status !== 'DRAFT') {
      throw new BadRequestException(`Only DRAFT settlements can be moved to UNDER_REVIEW (current status: ${settlement.status})`);
    }

    settlement.status = 'UNDER_REVIEW';
    settlement.reviewed_by_user_id = userId;
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

  async returnSettlement(tenantId: string, id: string, userId: string, reason?: string, correlationId?: string) {
    const settlement = await this.settlementRepo.findOne({ where: { id, tenant_id: tenantId } });
    if (!settlement) throw new NotFoundException('Settlement not found');

    if (settlement.status !== 'UNDER_REVIEW') {
      throw new BadRequestException(`Only UNDER_REVIEW settlements can be returned to DRAFT (current status: ${settlement.status})`);
    }

    settlement.status = 'DRAFT';
    settlement.notes = reason ? `[Returned]: ${reason} | ${settlement.notes || ''}` : settlement.notes;
    const saved = await this.settlementRepo.save(settlement);

    await this.auditWriter.write({
      tenantId,
      actorType: 'ADMIN',
      action: 'COURIER_SETTLEMENT_RETURNED',
      correlationId: correlationId || 'corr-settle-return',
      afterData: saved,
    });

    return saved;
  }

  async closeSettlement(tenantId: string, id: string, userId: string, approvalRequestId?: string, correlationId?: string) {
    const settlement = await this.settlementRepo.findOne({ where: { id, tenant_id: tenantId } });
    if (!settlement) throw new NotFoundException('Settlement not found');

    if (settlement.status === 'CLOSED' || settlement.status === 'REVERSED') {
      throw new BadRequestException(`Settlement is already ${settlement.status}`);
    }

    const hasCashDisc = !MoneyUtil.isZero(settlement.cash_discrepancy_amount || '0');
    const hasPosDisc = !MoneyUtil.isZero(settlement.pos_discrepancy_amount || '0');

    if (hasCashDisc || hasPosDisc) {
      let approval = null;
      if (approvalRequestId) {
        approval = await this.approvalRepo.findOne({ where: { id: approvalRequestId, tenant_id: tenantId, status: 'APPROVED' } });
      } else {
        approval = await this.approvalRepo.findOne({
          where: { tenant_id: tenantId, entity_type: 'CourierSettlement', entity_id: id, status: 'APPROVED' },
        });
      }
      if (!approval) {
        throw new BadRequestException('Settlement has discrepancy and requires explicit approval before closing');
      }
    }

    settlement.status = 'CLOSED';
    settlement.closed_at = new Date();
    settlement.closed_by_user_id = userId;
    if (approvalRequestId) settlement.approval_request_id = approvalRequestId;

    const saved = await this.settlementRepo.save(settlement);
    const lines = await this.settlementLineRepo.find({ where: { settlement_id: id } });

    for (const l of lines) {
      if (l.delivery_assignment_id) {
        const asgn = await this.assignmentRepo.findOne({ where: { id: l.delivery_assignment_id } });
        if (asgn) {
          asgn.is_settled = true;
          asgn.settlement_id = id;
          await this.assignmentRepo.save(asgn);
        }
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

  async reverseSettlement(tenantId: string, id: string, userId: string, reason?: string, correlationId?: string) {
    const settlement = await this.settlementRepo.findOne({ where: { id, tenant_id: tenantId } });
    if (!settlement) throw new NotFoundException('Settlement not found');

    if (settlement.status !== 'CLOSED') {
      throw new BadRequestException(`Only CLOSED settlements can be reversed (current status: ${settlement.status})`);
    }

    settlement.status = 'REVERSED';
    settlement.notes = reason ? `[Reversed]: ${reason} | ${settlement.notes || ''}` : settlement.notes;

    const saved = await this.settlementRepo.save(settlement);
    const lines = await this.settlementLineRepo.find({ where: { settlement_id: id } });

    for (const l of lines) {
      if (l.delivery_assignment_id) {
        const asgn = await this.assignmentRepo.findOne({ where: { id: l.delivery_assignment_id } });
        if (asgn) {
          asgn.is_settled = false;
          asgn.settlement_id = null;
          await this.assignmentRepo.save(asgn);
        }
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
        courier_code: courier ? courier.code : '',
        line_count: lineCount,
      });
    }
    return result;
  }

  async getSettlementDetail(tenantId: string, id: string) {
    const settlement = await this.settlementRepo.findOne({ where: { id, tenant_id: tenantId } });
    if (!settlement) throw new NotFoundException('Settlement not found');

    const lines = await this.settlementLineRepo.find({ where: { settlement_id: id } });
    const courier = await this.courierRepo.findOne({ where: { id: settlement.courier_id } });

    return {
      ...settlement,
      courier_name: courier ? courier.name : 'Unknown Courier',
      courier_code: courier ? courier.code : '',
      lines,
    };
  }

  async getSettlementStatement(tenantId: string, id: string) {
    const detail = await this.getSettlementDetail(tenantId, id);
    return {
      settlement_number: detail.settlement_number,
      settlement_date: detail.settlement_date,
      status: detail.status,
      tenant_id: tenantId,
      courier: {
        id: detail.courier_id,
        name: detail.courier_name,
        code: detail.courier_code,
      },
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
      generated_at: new Date().toISOString(),
    };
  }
}
