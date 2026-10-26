import { Injectable, NotFoundException, BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, MoreThanOrEqual } from 'typeorm';
import { Courier } from '../../entities/Courier.entity';
import { AdminUser } from '../../entities/AdminUser.entity';
import { COURIER_ROLE, courierUsername } from '../../common/utils/user-scope.util';
import { DeliveryAssignment } from '../../entities/DeliveryAssignment.entity';
import { OrderHeader } from '../../entities/OrderHeader.entity';
import { CourierSettlement } from '../../entities/CourierSettlement.entity';
import { CourierSettlementLine } from '../../entities/CourierSettlementLine.entity';
import { Payment } from '../../entities/Payment.entity';
import { PaymentMethod } from '../../entities/PaymentMethod.entity';
import { ApprovalRequest } from '../../entities/ApprovalRequest.entity';
import { DeliveryZone } from '../../entities/DeliveryZone.entity';
import { Delivery, DeliveryState } from '../../entities/Delivery.entity';
import { DeliveryEvent } from '../../entities/DeliveryEvent.entity';
import { Terminal } from '../../entities/Terminal.entity';
import { CustomerAddress } from '../../entities/CustomerAddress.entity';
import { Customer } from '../../entities/Customer.entity';
import { Branch } from '../../entities/Branch.entity';
import { PaymentAllocation } from '../../entities/PaymentAllocation.entity';
import { CashMovement } from '../../entities/CashMovement.entity';
import { AuditWriter } from '../audit/audit-writer.service';
import { ShiftService } from '../cashier/shift.service';
import { OrderTransitionRecorder } from '../order-lifecycle/order-transition-recorder.service';
import { MoneyUtil } from '../../common/utils/money.util';
import { loadBusinessClock } from '../../common/utils/business-clock';
import { normalizePhone } from '../customer/customer.service';
import { TenantSetting } from '../../entities/TenantSetting.entity';
import { pickSettingValue } from '../../common/utils/setting-scope.util';
import { courierDeliveryFee } from './delivery-fee';
import { normalizeZonePolygon } from './zone-shape';
import { nextCode, typedCode } from '../../common/utils/next-code.util';

const ACTIVE_DELIVERY_STATES: DeliveryState[] = ['ASSIGNED', 'PICKED_UP', 'EN_ROUTE'];

/** Deliveries the board shows whatever their age: waiting for a courier, or with one. */
const OPEN_DELIVERY_STATES: DeliveryState[] = ['UNASSIGNED', ...ACTIVE_DELIVERY_STATES];

/** How far back the board's history column reaches. */
const BOARD_HISTORY_HOURS = 12;

/** Whether `reconcileDeliveryWithOrder` would change this delivery. */
function deliveryDisagreesWithOrder(delivery: Delivery, order: OrderHeader): boolean {
  const orderState = String(order.state || order.status || '').toUpperCase();
  if (orderState === 'COMPLETED') return delivery.state !== 'DELIVERED';
  if (orderState === 'CANCELLED') return delivery.state !== 'CANCELLED';
  if (orderState === 'OUT_FOR_DELIVERY') return !['EN_ROUTE', 'DELIVERED', 'CANCELLED'].includes(delivery.state);
  return false;
}

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
    @InjectRepository(Delivery) private readonly deliveryRepo: Repository<Delivery>,
    @InjectRepository(DeliveryEvent) private readonly deliveryEventRepo: Repository<DeliveryEvent>,
    @InjectRepository(Terminal) private readonly terminalRepo: Repository<Terminal>,
    @InjectRepository(CustomerAddress) private readonly customerAddressRepo: Repository<CustomerAddress>,
    @InjectRepository(Customer) private readonly customerRepo: Repository<Customer>,
    @InjectRepository(Branch) private readonly branchRepo: Repository<Branch>,
    @InjectRepository(TenantSetting) private readonly settingRepo: Repository<TenantSetting>,
    @InjectRepository(AdminUser) private readonly userRepo: Repository<AdminUser>,
    private readonly transitionRecorder: OrderTransitionRecorder,
    private readonly auditWriter: AuditWriter,
    private readonly shiftService: ShiftService,
  ) {}

  // --- 1. DELIVERY ZONES ---
  async getZones(tenantId: string, branchId?: string) {
    const where: any = { tenant_id: tenantId, is_active: true };
    if (branchId) where.branch_id = branchId;
    return await this.zoneRepo.find({ where, order: { name: 'ASC' } });
  }

  async createZone(tenantId: string, data: { branch_id: string; code?: string; name: string; fee?: string | number; estimated_minutes?: number; polygon?: any; postal_prefixes?: string[] }) {
    let code = typedCode(data.code);
    if (code) {
      const existing = await this.zoneRepo.findOne({ where: { tenant_id: tenantId, branch_id: data.branch_id, code } });
      if (existing) throw new ConflictException(`Delivery zone code ${code} already exists for this branch`);
    } else {
      code = await nextCode(this.zoneRepo, { tenant_id: tenantId, branch_id: data.branch_id }, 'ZN');
    }

    const zone = this.zoneRepo.create({
      tenant_id: tenantId,
      branch_id: data.branch_id,
      code,
      name: data.name,
      fee: MoneyUtil.format(data.fee || '0', 4),
      estimated_minutes: data.estimated_minutes || 30,
      polygon: normalizeZonePolygon(data.polygon),
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

  async updateZone(
    tenantId: string,
    id: string,
    data: { name?: string; fee?: string; estimated_minutes?: number; polygon?: unknown },
    actorId?: string,
  ) {
    const zone = await this.zoneRepo.findOne({ where: { id, tenant_id: tenantId } });
    if (!zone) throw new NotFoundException('Delivery zone not found');

    const before = { name: zone.name, fee: zone.fee, estimated_minutes: zone.estimated_minutes, polygon: zone.polygon };
    if (data.name !== undefined) zone.name = data.name;
    if (data.fee !== undefined) zone.fee = MoneyUtil.format(data.fee || '0', 4);
    if (data.estimated_minutes !== undefined) zone.estimated_minutes = data.estimated_minutes;
    // Drawn on the map; null rubs it out.
    if (data.polygon !== undefined) zone.polygon = normalizeZonePolygon(data.polygon);

    const saved = await this.zoneRepo.save(zone);
    await this.auditWriter.write({
      tenantId,
      actorType: 'ADMIN',
      actorId,
      action: 'DELIVERY_ZONE_UPDATED',
      entityType: 'DeliveryZone',
      entityId: saved.id,
      branchId: saved.branch_id,
      correlationId: 'corr-zone-update',
      beforeData: before,
      afterData: { name: saved.name, fee: saved.fee, estimated_minutes: saved.estimated_minutes, polygon: saved.polygon },
    });
    return saved;
  }

  /** A blank amount means "not set", which is different from zero. */
  /** Today's business day at a branch (or the chain's, when there is none). */
  private async businessToday(tenantId: string, branchId?: string | null): Promise<string> {
    return (await loadBusinessClock(this.orderRepo?.manager, tenantId, branchId)).today();
  }

  private static optionalAmount(value?: string | number | null): string | null {
    if (value === null || value === undefined || String(value).trim() === '') return null;
    return MoneyUtil.format(value, 4);
  }

  // --- 2. COURIERS ---
  async getCouriers(tenantId: string, branchId?: string) {
    const where: any = { tenant_id: tenantId, is_active: true };
    if (branchId) where.branch_id = branchId;
    const couriers = await this.courierRepo.find({ where, order: { name: 'ASC' } });

    const enriched = [];
    for (const c of couriers) {
      const activeDeliveryCount = await this.deliveryRepo.count({
        where: { tenant_id: tenantId, courier_id: c.id, state: In(ACTIVE_DELIVERY_STATES) },
      });
      enriched.push({ ...c, active_delivery_count: activeDeliveryCount });
    }

    return enriched;
  }

  async createCourier(
    tenantId: string,
    data: { branch_id?: string; code?: string; name: string; phone?: string; vehicle_type?: string },
    correlationId: string = 'corr-courier-create',
    actorId?: string,
  ) {
    // A courier is known by their mobile number; the code is made here unless an import gives one.
    const code = typedCode(data.code) || (await nextCode(this.courierRepo, { tenant_id: tenantId }, 'CR'));
    const onFile = await this.findCourierOnFile(tenantId, code, data.phone);
    if (onFile) {
      const branch = onFile.branch_id ? await this.branchRepo.findOne({ where: { id: onFile.branch_id, tenant_id: tenantId } }) : null;
      throw new ConflictException({
        code: 'COURIER_EXISTS',
        title: 'Courier Already On File',
        detail: `${onFile.name} is already on file${branch ? ` at ${branch.name}` : ''}.`,
      });
    }

    // A courier is a user with the Courier role, signed in by their mobile number once the
    // tracking app exists. So the number is required, and no other account may hold it.
    if (!data.phone?.trim()) {
      throw new BadRequestException({
        code: 'COURIER_PHONE_REQUIRED',
        title: 'Mobile Number Required',
        detail: "A courier's mobile number is their username, so it is required.",
      });
    }
    const username = courierUsername(data.phone, code);
    const taken = await this.userRepo.findOne({ where: { tenant_id: tenantId, username } });
    if (taken) {
      throw new ConflictException({
        code: 'COURIER_PHONE_IN_USE',
        title: 'Mobile Number In Use',
        detail: `Another account (${taken.display_name}) already uses ${data.phone}.`,
      });
    }

    const account = await this.userRepo.save(
      this.userRepo.create({
        tenant_id: tenantId,
        username,
        display_name: data.name,
        // Nothing to verify against: a courier cannot sign in until the tracking app exists.
        password_hash: '!courier-no-sign-in',
        role: COURIER_ROLE,
        branch_id: data.branch_id || null,
        is_active: true,
        preferred_locale: 'fa',
        created_by: actorId,
      }),
    );

    const courier = this.courierRepo.create({
      tenant_id: tenantId,
      user_id: account.id,
      branch_id: data.branch_id || null,
      code,
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
      actorId,
      action: 'COURIER_CREATED',
      entityType: 'Courier',
      entityId: saved.id,
      branchId: saved.branch_id ?? undefined,
      correlationId,
      afterData: saved,
    });
    return saved;
  }

  /**
   * A courier is one person to the chain, and is never added twice. The
   * code or the mobile number finds them — the number normalised, since the same phone gets
   * typed as 0912…, 912… and +98912… by different counters.
   */
  private async findCourierOnFile(tenantId: string, code: string, phone?: string | null): Promise<Courier | null> {
    const phoneKey = phone ? normalizePhone(phone) : '';
    const couriers = (await this.courierRepo.find({ where: { tenant_id: tenantId } })) || [];
    return (
      couriers.find((c) => c.code?.toUpperCase() === code) ||
      (phoneKey ? couriers.find((c) => c.phone && normalizePhone(c.phone) === phoneKey) : undefined) ||
      null
    );
  }

  async updateCourierStatus(tenantId: string, courierId: string, status: 'AVAILABLE' | 'ON_DELIVERY' | 'INACTIVE', correlationId?: string, actorId?: string) {
    const courier = await this.courierRepo.findOne({ where: { id: courierId, tenant_id: tenantId } });
    if (!courier) throw new NotFoundException('Courier not found');

    const previousStatus = courier.status;
    courier.status = status;
    const saved = await this.courierRepo.save(courier);
    await this.auditWriter.write({
      tenantId,
      actorType: 'ADMIN',
      actorId,
      action: 'COURIER_STATUS_UPDATED',
      entityType: 'Courier',
      entityId: saved.id,
      branchId: saved.branch_id ?? undefined,
      correlationId: correlationId || 'corr-courier-status',
      beforeData: { status: previousStatus },
      afterData: saved,
    });
    return saved;
  }

  // --- 3. DELIVERY EXECUTION & STATE MACHINE ---
  private async reconcileDeliveryWithOrder(tenantId: string, delivery: Delivery, order: OrderHeader): Promise<Delivery> {
    const orderState = String(order.state || order.status || '').toUpperCase();
    let expectedState: DeliveryState | null = null;

    if (orderState === 'COMPLETED') expectedState = 'DELIVERED';
    if (orderState === 'CANCELLED') expectedState = 'CANCELLED';
    if (orderState === 'OUT_FOR_DELIVERY' && !['DELIVERED', 'CANCELLED'].includes(delivery.state)) {
      expectedState = 'EN_ROUTE';
    }

    if (!expectedState) return delivery;

    // The attempt that matches the delivery as it stands.
    const assignment = await this.assignmentRepo.findOne({
      where: {
        tenant_id: tenantId,
        order_id: delivery.order_id,
        ...(delivery.courier_id ? { courier_id: delivery.courier_id } : {}),
      },
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
    // Outside every zone the cashier typed the fee (O-35).
    const typedFee = order.delivery_fee_manual !== null && order.delivery_fee_manual !== undefined;
    if (!order.delivery_zone_id && !typedFee) throw new BadRequestException('DELIVERY_FEE_REQUIRED');
    if (zoneId && zoneId !== order.delivery_zone_id) throw new BadRequestException('DELIVERY_ZONE_MISMATCH');

    const address = await this.customerAddressRepo.findOne({
      where: { id: order.customer_address_id, tenant_id: tenantId },
    });
    if (!address) throw new BadRequestException('DELIVERY_ADDRESS_NOT_FOUND');
    if (address.customer_id !== order.customer_id) throw new BadRequestException('DELIVERY_ADDRESS_CUSTOMER_MISMATCH');
    const zone = order.delivery_zone_id
      ? await this.zoneRepo.findOne({
          where: { id: order.delivery_zone_id, tenant_id: tenantId, branch_id: order.branch_id, is_active: true },
        })
      : null;
    if (order.delivery_zone_id && !zone) throw new BadRequestException('DELIVERY_ZONE_INVALID_OR_INACTIVE');

    const delivery = this.deliveryRepo.create({
      tenant_id: tenantId,
      order_id: orderId,
      zone_id: zone?.id ?? null,
      state: 'UNASSIGNED',
      fee: courierDeliveryFee(zone?.fee, order.delivery_fee_manual),
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

  /**
   * Any active courier of the order's branch can take it: no check-in, no available/busy
   * switch, and no cap on how many deliveries one courier carries. The dispatcher at the
   * counter decides.
   */
  private async courierWhoCanTake(tenantId: string, courierId: string, order: OrderHeader) {
    const courier = await this.courierRepo.findOne({ where: { id: courierId, tenant_id: tenantId } });
    if (!courier) throw new NotFoundException('Courier not found');
    if (!courier.is_active) throw new BadRequestException('Courier profile is inactive');
    if (courier.branch_id && order.branch_id && courier.branch_id !== order.branch_id) {
      throw new BadRequestException({
        code: 'COURIER_OTHER_BRANCH',
        title: 'Courier Works At Another Branch',
        detail: `${courier.name} works at another branch and cannot take this branch's orders.`,
      });
    }
    return courier;
  }

  /**
   * The dispatch board's one step (PM, 2026-10-05): at the counter the rider is standing there
   * when the cashier picks them, so naming the courier sends the order out.
   */
  async dispatchCourier(tenantId: string, deliveryId: string, courierId: string, userId?: string) {
    await this.assignCourier(tenantId, deliveryId, courierId, userId);
    return await this.departDelivery(tenantId, deliveryId, userId);
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
    // Once the courier has left, the food is on their bike: another rider cannot be named.
    if (delivery.state === 'PICKED_UP' || delivery.state === 'EN_ROUTE') {
      throw new ConflictException({
        code: 'DELIVERY_ALREADY_LEFT',
        message: `Order ${order.order_number} is already on its way with a courier`,
      });
    }

    const courier = await this.courierWhoCanTake(tenantId, courierId, order);

    const fromState = delivery.state;
    const previousCourierId = delivery.courier_id;
    delivery.courier_id = courierId;
    delivery.state = 'ASSIGNED';
    delivery.assigned_at = new Date();

    const saved = await this.deliveryRepo.save(delivery);
    await this.logDeliveryEvent(tenantId, saved.id, fromState, 'ASSIGNED', `Assigned to ${courier.name}`, userId);

    // A courier taken off an order before leaving did no ride: their attempt is closed, with no
    // pay and nothing to settle, instead of reading "assigned" in their history for good.
    if (previousCourierId && previousCourierId !== courierId) {
      const previous = await this.assignmentRepo.findOne({
        where: { tenant_id: tenantId, order_id: delivery.order_id, courier_id: previousCourierId, status: 'ASSIGNED' },
      });
      if (previous) {
        previous.status = 'REASSIGNED';
        await this.assignmentRepo.save(previous);
      }
    }

    let assignment = await this.assignmentRepo.findOne({
      where: { tenant_id: tenantId, order_id: delivery.order_id, courier_id: courierId },
    });
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
      const assignment = await this.assignmentRepo.findOne({
        where: { tenant_id: tenantId, order_id: delivery.order_id, courier_id: delivery.courier_id },
      });
      if (assignment) {
        assignment.status = 'OUT_FOR_DELIVERY';
        assignment.picked_up_at = new Date();
        await this.assignmentRepo.save(assignment);
      }
    }

    const fromOrderState = order.state;
    order.state = 'OUT_FOR_DELIVERY';
    order.status = 'OUT_FOR_DELIVERY';
    order.fulfillment_status = 'OUT_FOR_DELIVERY';
    await this.saveOrderTransition(tenantId, order, fromOrderState, 'DISPATCH', userId);

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

    // What the courier owes back is the balance the customer had left to pay, split by what
    // they say went on the mobile card reader. The cash they report is not taken as the
    // expectation — it used to overwrite it, so a short courier was never short. What they
    // actually hand over is counted at settlement.
    const { cash: cashExpStr, pos: posExpStr } = this.splitCollection(order.outstanding_total, data?.posAmount);
    delivery.cash_expected = cashExpStr;
    delivery.mobile_pos_expected = posExpStr;

    let assignment = delivery.courier_id
      ? await this.assignmentRepo.findOne({
          where: { tenant_id: tenantId, order_id: delivery.order_id, courier_id: delivery.courier_id },
        })
      : null;

    const saved = await this.deliveryRepo.save(delivery);
    await this.logDeliveryEvent(tenantId, saved.id, fromState, 'DELIVERED', 'Delivery successfully completed', userId);

    if (delivery.courier_id) {
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

    const fromOrderState = order.state;
    order.fulfillment_status = 'DELIVERED';
    // An order the customer paid for before it left is done. One still owing is not: the money
    // is in the courier's pocket until they hand it over, so the order stays open until the
    // settlement records the payment. Completing it here closed orders with nothing paid.
    if (!MoneyUtil.greaterThan(order.outstanding_total || '0', '0')) {
      order.state = 'COMPLETED';
      order.status = 'COMPLETED';
      order.completed_at = new Date();
    }
    await this.saveOrderTransition(tenantId, order, fromOrderState, 'COMPLETE', userId, 'Delivered');

    return saved;
  }

  /**
   * Saves the parent order's new state with the history row, outbox event, audit entry and
   * loyalty cashback that a transition through the order service would leave.
   */
  private async saveOrderTransition(
    tenantId: string,
    order: OrderHeader,
    fromState: string,
    action: string,
    userId?: string,
    reasonText?: string,
  ) {
    await this.orderRepo.manager.transaction(async (em) => {
      await em.save(OrderHeader, order);
      if (fromState === order.state) return;
      await this.transitionRecorder.record(em, { tenantId, order, fromState, action, userId, reasonText });
    });
  }

  /**
   * The dispatch board: every delivery still in play, and those finished in the last twelve
   * hours for the history column.
   *
   * It used to read every delivery the chain ever had and look up the order, courier and zone
   * one row at a time, on every refresh of every open board. The rows now come in one query
   * and their names in one batched lookup per table. Twelve hours rather than "since midnight"
   * so a late shift keeps its evening's history past 00:00.
   */
  async getDeliveries(tenantId: string, branchId?: string, state?: string) {
    const finishedSince = new Date(Date.now() - BOARD_HISTORY_HOURS * 3600_000);
    const deliveries = await this.deliveryRepo.find({
      where: [
        { tenant_id: tenantId, state: In(OPEN_DELIVERY_STATES) },
        { tenant_id: tenantId, updated_at: MoreThanOrEqual(finishedSince) },
      ],
      order: { created_at: 'DESC' },
    });
    if (deliveries.length === 0) return [];

    const idsOf = (values: Array<string | null | undefined>) => [...new Set(values.filter(Boolean))] as string[];
    const orders = await this.orderRepo.find({ where: { tenant_id: tenantId, id: In(idsOf(deliveries.map((d) => d.order_id))) } });
    const orderById = new Map(orders.map((o) => [o.id, o]));
    const [couriers, zones, customers] = await Promise.all([
      this.lookup(this.courierRepo, tenantId, idsOf(deliveries.map((d) => d.courier_id))),
      this.lookup(this.zoneRepo, tenantId, idsOf(deliveries.map((d) => d.zone_id))),
      this.lookup(this.customerRepo, tenantId, idsOf(orders.map((o) => o.customer_id))),
    ]);

    const result = [];
    for (const d of deliveries) {
      const order = orderById.get(d.order_id);
      if (!order || (branchId && order.branch_id !== branchId)) continue;

      // A cancelled or completed order still marks its delivery here, since nothing else does.
      // Only a row that disagrees costs a write.
      const reconciled = deliveryDisagreesWithOrder(d, order) ? await this.reconcileDeliveryWithOrder(tenantId, d, order) : d;
      if (state && reconciled.state !== state) continue;

      const courier = reconciled.courier_id ? couriers.get(reconciled.courier_id) : null;
      const zone = reconciled.zone_id ? zones.get(reconciled.zone_id) : null;
      const customer = order.customer_id ? customers.get(order.customer_id) : null;

      result.push({
        ...reconciled,
        order_number: order.order_number,
        call_number: order.call_number ?? null,
        order_state: order.state,
        submitted_at: order.submitted_at || order.placed_at || null,
        grand_total: order.grand_total,
        outstanding_total: order.outstanding_total,
        customer_name: customer ? [customer.first_name, customer.last_name].filter(Boolean).join(' ') || null : null,
        customer_phone: customer?.mobile || null,
        courier_name: courier ? courier.name : 'Unassigned',
        courier_phone: courier ? courier.phone : '',
        zone_name: zone ? zone.name : null,
        // Our own delivery to an address no zone covers, its fee typed at the till (O-35).
        outside_zones: order.order_type === 'DELIVERY' && !zone,
        zone_estimated_minutes: zone?.estimated_minutes ?? null,
      });
    }

    return result;
  }

  /** Rows of one table by id, keyed by id, in a single query. */
  private async lookup<T extends { id: string }>(repo: Repository<T>, tenantId: string, ids: string[]): Promise<Map<string, T>> {
    if (ids.length === 0) return new Map();
    const rows = await repo.find({ where: { tenant_id: tenantId, id: In(ids) } as any });
    return new Map(rows.map((row) => [row.id, row]));
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

  async updateAssignmentStatus(tenantId: string, assignmentId: string, status: string) {
    if (status === 'EN_ROUTE' || status === 'PICKED_UP' || status === 'OUT_FOR_DELIVERY') {
      return await this.departDelivery(tenantId, assignmentId);
    }
    if (status === 'DELIVERED') {
      return await this.completeDelivery(tenantId, assignmentId);
    }
    // Any other status used to be written straight onto the delivery, past every rule above.
    throw new BadRequestException(`Status ${status} is not a delivery step; use assign, depart or complete`);
  }

  private async activeMethod(tenantId: string, kinds: string[]): Promise<PaymentMethod> {
    const methods = await this.paymentMethodRepo.find({ where: { tenant_id: tenantId, kind: In(kinds), is_active: true } });
    const method = kinds.map((k) => methods.find((m) => m.kind === k)).find(Boolean);
    if (!method) {
      throw new BadRequestException(`No active ${kinds.join(' or ')} payment method is set up to record the courier's collection`);
    }
    return method;
  }

  /**
   * What the courier collects on a delivered order: whatever the customer still owed when it
   * left the shop — cash, less any part the courier declared on the mobile card reader. It
   * used to count the order's payments, so a card prepaid at the counter was "expected" back
   * from the courier, and an unpaid order was expected only by accident of the fallback.
   */
  private splitCollection(owed: string, declaredPos?: string | number | null) {
    const owedStr = MoneyUtil.greaterThan(owed || '0', '0') ? MoneyUtil.format(owed, 4) : '0.0000';
    let posStr = MoneyUtil.format(declaredPos || 0, 4);
    if (MoneyUtil.lessThan(posStr, '0')) posStr = '0.0000';
    if (MoneyUtil.greaterThan(posStr, owedStr)) posStr = owedStr;
    return { cash: MoneyUtil.subtract(owedStr, posStr, 4), pos: posStr };
  }

  /**
   * Who still owes a branch money for its deliveries, one card per courier.
   *
   * Read from the deliveries rather than from the branch's roster: a courier who has since
   * moved to another shop is off this branch's list, but the cash they collected here is
   * still settled here. The figures are the settlement preview's own, so the card and the
   * batch it starts cannot disagree.
   */
  /** The money a courier's attempt should bring back: the unpaid balance if delivered, nothing otherwise. */
  private async expectedFromAttempt(assignment: DeliveryAssignment, order?: OrderHeader | null) {
    if (assignment.status !== 'DELIVERED' || !order) {
      return { expCashStr: '0.00', expPosStr: '0.00', primaryMethod: 'CASH', expCash: '0.00', expPos: '0.00' };
    }
    const delivery = await this.deliveryRepo.findOne({ where: { order_id: order.id, tenant_id: order.tenant_id } });
    const { cash, pos } = this.splitCollection(order.outstanding_total, delivery?.mobile_pos_expected);
    const expCashStr = MoneyUtil.format(cash, 2);
    const expPosStr = MoneyUtil.format(pos, 2);
    const primaryMethod = MoneyUtil.greaterThan(expPosStr, expCashStr) ? 'MOBILE_POS' : 'CASH';
    return { expCashStr, expPosStr, primaryMethod, expCash: expCashStr, expPos: expPosStr };
  }

  async getUnsettledSummary(tenantId: string, branchId?: string) {
    const pending = await this.assignmentRepo.find({
      where: { tenant_id: tenantId, is_settled: false, status: In(['DELIVERED', 'RETURNED']) },
    });
    const courierIds = Array.from(new Set(pending.map((a) => a.courier_id)));
    const summary = [];

    for (const courierId of courierIds) {
      const preview = await this.previewSettlement(tenantId, courierId, undefined, branchId).catch(() => null);
      if (!preview || preview.line_count === 0) continue;

      summary.push({
        courier_id: courierId,
        courier_name: preview.courier_name,
        courier_code: preview.courier_code,
        unsettled_count: preview.line_count,
        expected_cash: preview.expected_cash_amount,
        expected_pos: preview.expected_pos_amount,
        total_delivery_fees: preview.total_delivery_fees,
        net_due_amount: preview.net_settlement_amount,
      });
    }

    return summary.sort((a, z) => a.courier_name.localeCompare(z.courier_name));
  }

  /**
   * The deliveries a settlement batch would take. Named lines are checked and refused when
   * already settled or reserved; with none named, those are simply left out — otherwise one
   * closed batch would make every later preview for the same courier fail. `branchId` keeps
   * to the deliveries that branch sold, since cash is handed back at the shop it came from.
   */
  async previewSettlement(tenantId: string, courierId: string, assignmentIds?: string[], branchId?: string, dateFrom?: string, dateTo?: string, currency?: string) {
    const courier = await this.courierRepo.findOne({ where: { id: courierId, tenant_id: tenantId } });
    if (!courier) throw new NotFoundException('Courier not found');

    // Find active or closed non-reversed settlements to exclude already reserved lines
    const existingSettlements = (await this.settlementRepo.find({
      where: { tenant_id: tenantId, status: In(['DRAFT', 'CLOSED']) },
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

    const named = Boolean(assignmentIds && assignmentIds.length > 0);
    const where: any = {
      tenant_id: tenantId,
      courier_id: courierId,
      status: In(['DELIVERED', 'RETURNED']),
    };
    if (named) {
      where.id = In(assignmentIds);
    } else {
      where.is_settled = false;
    }

    const assignments = await this.assignmentRepo.find({ where });
    if (named) {
      for (const a of assignments) {
        if (a.is_settled) {
          throw new ConflictException(`Assignment ${a.id} is already settled`);
        }
        if (reservedLineAssignmentIds.has(a.id)) {
          throw new ConflictException(`Assignment ${a.id} is already reserved in an active or closed settlement`);
        }
      }
    }
    const candidates = named ? assignments : assignments.filter((a) => !a.is_settled && !reservedLineAssignmentIds.has(a.id));

    let expCashStr = '0.00';
    let expPosStr = '0.00';
    let totalFeeStr = '0.00';
    const eligibleAssignments: DeliveryAssignment[] = [];
    const lines = [];

    for (const a of candidates) {
      const order = await this.orderRepo.findOne({ where: { id: a.order_id } });
      if (branchId && order?.branch_id && order.branch_id !== branchId) continue;

      const breakdown = await this.expectedFromAttempt(a, order);
      eligibleAssignments.push(a);
      totalFeeStr = MoneyUtil.add(totalFeeStr, a.delivery_fee || '0', 2);
      expCashStr = MoneyUtil.add(expCashStr, breakdown.expCashStr, 2);
      expPosStr = MoneyUtil.add(expPosStr, breakdown.expPosStr, 2);
      lines.push({
        assignment_id: a.id,
        order_number: order?.order_number || 'ORD-00',
        call_number: order?.call_number ?? null,
        delivery_status: a.status,
        payment_method_code: breakdown.primaryMethod,
        expected_cash: MoneyUtil.format(breakdown.expCashStr, 2),
        expected_pos: MoneyUtil.format(breakdown.expPosStr, 2),
      });
    }

    return {
      courier_id: courierId,
      courier_name: courier.name,
      courier_code: courier.code,
      line_count: eligibleAssignments.length,
      expected_cash_amount: expCashStr,
      expected_pos_amount: expPosStr,
      total_delivery_fees: totalFeeStr,
      // What they owe back: the same sum updateSettlement makes.
      net_settlement_amount: MoneyUtil.add(expCashStr, expPosStr, 2),
      assignment_ids: eligibleAssignments.map((a) => a.id),
      lines,
    };
  }

  async createSettlement(
    tenantId: string,
    userId: string,
    data: { courier_id: string; branch_id?: string; dateFrom?: string; dateTo?: string; currency?: string; assignment_ids?: string[]; notes?: string },
    correlationId?: string,
  ) {
    const preview = await this.previewSettlement(tenantId, data.courier_id, data.assignment_ids, data.branch_id, data.dateFrom, data.dateTo, data.currency);
    if (preview.line_count === 0) {
      throw new BadRequestException('This courier has no unsettled deliveries to put in a batch');
    }
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
      const breakdown = await this.expectedFromAttempt(asgn, order);

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

  /**
   * Settles a courier in one step, as the cashier does it at the counter: for each delivered
   * ride the card slip's amount (the rest of what the order owed is cash), and the cash the
   * courier hands over. The batch is created and closed together, so the orders are paid and
   * completed and the cash is in the drawer the moment the cashier confirms.
   *
   * A gap between the cash handed over and the cash expected, or a card slip larger than what
   * an order owed, needs a manager. That is checked before anything is written, so asking for
   * the PIN leaves no half-made batch behind; with the approval the same call goes through.
   */
  async settleCourier(
    tenantId: string,
    userId: string,
    data: {
      courier_id: string;
      branch_id?: string;
      /** Card slip amount per ride, by assignment id. Missing means paid in cash. */
      card?: Record<string, string | number>;
      /** Cash the courier handed over. Missing means exactly what was expected. */
      actual_cash_amount?: string | number;
      approvalRequestId?: string;
    },
    correlationId?: string,
  ) {
    const preview = await this.previewSettlement(tenantId, data.courier_id, undefined, data.branch_id);
    if (preview.line_count === 0) {
      throw new BadRequestException('This courier has no unsettled deliveries to settle');
    }

    // The split each ride ends up with, worked out the way updateSettlement will store it.
    const card = data.card || {};
    let expectedCash = '0.00';
    let expectedPos = '0.00';
    let actualPos = '0.00';
    for (const line of preview.lines) {
      if (line.delivery_status !== 'DELIVERED') continue;
      const owed = MoneyUtil.add(line.expected_cash || '0', line.expected_pos || '0', 2);
      const slip = card[line.assignment_id] ?? line.expected_pos ?? '0';
      const { cash, pos } = this.splitCollection(owed, slip);
      expectedCash = MoneyUtil.add(expectedCash, cash, 2);
      expectedPos = MoneyUtil.add(expectedPos, pos, 2);
      actualPos = MoneyUtil.add(actualPos, MoneyUtil.format(slip || 0, 2), 2);
    }
    const actualCash =
      data.actual_cash_amount === undefined || data.actual_cash_amount === null || data.actual_cash_amount === ''
        ? expectedCash
        : MoneyUtil.format(data.actual_cash_amount, 2);
    const cashGap = MoneyUtil.subtract(actualCash, expectedCash, 2);
    const posGap = MoneyUtil.subtract(actualPos, expectedPos, 2);

    if (!MoneyUtil.isZero(cashGap) || !MoneyUtil.isZero(posGap)) {
      const approval = data.approvalRequestId
        ? await this.approvalRepo.findOne({ where: { id: data.approvalRequestId, tenant_id: tenantId, status: 'APPROVED' } })
        : null;
      const valid =
        approval &&
        approval.action === 'SETTLEMENT_DISCREPANCY' &&
        approval.entity_id === data.courier_id &&
        new Date(approval.expires_at) > new Date();
      if (!valid) {
        throw new ForbiddenException({
          statusCode: 403,
          code: 'APPROVAL_REQUIRED',
          message: 'The money handed over does not match what the courier collected; a manager has to approve it.',
          expected_cash: expectedCash,
          actual_cash: actualCash,
          cash_gap: cashGap,
          pos_gap: posGap,
        });
      }
    }

    const created = await this.createSettlement(
      tenantId,
      userId,
      { courier_id: data.courier_id, branch_id: data.branch_id, assignment_ids: preview.assignment_ids },
      correlationId,
    );
    try {
      await this.updateSettlement(
        tenantId,
        created.id,
        {
          lines: created.lines.map((l: CourierSettlementLine) => {
            if (l.delivery_status !== 'DELIVERED') return { id: l.id };
            const owed = MoneyUtil.add(l.expected_cash || '0', l.expected_pos || '0', 2);
            const slip = card[l.delivery_assignment_id || ''] ?? l.expected_pos ?? '0';
            const { cash } = this.splitCollection(owed, slip);
            return { id: l.id, actual_pos: slip, actual_cash: cash };
          }),
          actual_cash_amount: actualCash,
          actual_pos_amount: actualPos,
        },
        correlationId,
      );
      return await this.closeSettlement(tenantId, created.id, userId, data.approvalRequestId, correlationId);
    } catch (err) {
      // Closing posts nothing unless it all goes through, so a batch that failed to close
      // (no open drawer, say) is only a draft; take it away rather than leave it reserved.
      await this.settlementLineRepo.delete({ settlement_id: created.id });
      await this.settlementRepo.delete({ id: created.id, tenant_id: tenantId, status: 'DRAFT' });
      throw err;
    }
  }

  async updateSettlement(tenantId: string, id: string, data: any, correlationId?: string) {
    const settlement = await this.settlementRepo.findOne({ where: { id, tenant_id: tenantId } });
    if (!settlement) throw new NotFoundException('Settlement not found');

    if (settlement.status === 'CLOSED' || settlement.status === 'REVERSED') {
      throw new BadRequestException(`Settlement is ${settlement.status} and cannot be modified. Closed/reversed batches are immutable.`);
    }

    let allLines: CourierSettlementLine[] | null = null;
    if (data.lines && Array.isArray(data.lines)) {
      for (const lineData of data.lines) {
        if (!lineData.id) continue;
        const line = await this.settlementLineRepo.findOne({ where: { id: lineData.id, settlement_id: id } });
        if (line) {
          if (lineData.actual_cash !== undefined) line.actual_cash = MoneyUtil.format(lineData.actual_cash, 2);
          if (lineData.actual_pos !== undefined) {
            line.actual_pos = MoneyUtil.format(lineData.actual_pos, 2);
            // The cashier learns how the customer paid only when the courier is back: the card
            // slip is the card part, and the rest of what the order owed is cash. So the slip
            // sets the line's expected split — a card payment is not a cash shortage — and only
            // a card amount beyond what was owed is left as a card discrepancy.
            const owed = MoneyUtil.add(line.expected_cash || '0', line.expected_pos || '0', 2);
            const { cash, pos } = this.splitCollection(owed, line.actual_pos);
            line.expected_cash = MoneyUtil.format(cash, 2);
            line.expected_pos = MoneyUtil.format(pos, 2);
            line.payment_method_code = MoneyUtil.greaterThan(line.expected_pos, line.expected_cash) ? 'MOBILE_POS' : 'CASH';
          }
          if (lineData.receipt_verified !== undefined) line.receipt_verified = Boolean(lineData.receipt_verified);
          await this.settlementLineRepo.save(line);
        }
      }
      allLines = (await this.settlementLineRepo.find({ where: { settlement_id: id } })) || [];
      settlement.expected_cash_amount = MoneyUtil.sum(allLines.map((l) => l.expected_cash || '0'), 2);
      settlement.expected_pos_amount = MoneyUtil.sum(allLines.map((l) => l.expected_pos || '0'), 2);
      if (data.actual_cash_amount === undefined) settlement.actual_cash_amount = MoneyUtil.sum(allLines.map((l) => l.actual_cash || '0'), 2);
      if (data.actual_pos_amount === undefined) settlement.actual_pos_amount = MoneyUtil.sum(allLines.map((l) => l.actual_pos || '0'), 2);
    }

    if (data.actual_cash_amount !== undefined) {
      settlement.actual_cash_amount = MoneyUtil.format(data.actual_cash_amount, 2);
    }
    if (data.actual_pos_amount !== undefined) {
      settlement.actual_pos_amount = MoneyUtil.format(data.actual_pos_amount, 2);
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
    const adj = settlement.total_adjustment_amount || '0.00';

    settlement.cash_discrepancy_amount = MoneyUtil.subtract(actCash, expCash, 2);
    settlement.pos_discrepancy_amount = MoneyUtil.subtract(actPos, expPos, 2);

    const grossCollected = MoneyUtil.add(actCash, actPos, 2);
    settlement.net_settlement_amount = MoneyUtil.add(grossCollected, adj, 2);

    const saved = await this.settlementRepo.save(settlement);
    await this.auditWriter.write({
      tenantId,
      actorType: 'ADMIN',
      action: 'COURIER_SETTLEMENT_UPDATED',
      correlationId: correlationId || 'corr-settle-update',
      afterData: saved,
    });

    // The screen keeps editing the lines it sent, so hand back their new expected split.
    return allLines ? { ...saved, lines: allLines } : saved;
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

    const lines = await this.settlementLineRepo.find({ where: { settlement_id: id } });

    // The handover is when cash-on-delivery money is actually received, so this is where it
    // becomes a payment. Until now closing a batch recorded nothing: the order stayed owing
    // its full amount forever and the cash never reached a drawer.
    const collections: Array<{ orderId: string; cash: string; pos: string }> = [];
    for (const l of lines) {
      if (l.delivery_status !== 'DELIVERED' || !l.order_id) continue;
      const order = await this.orderRepo.findOne({ where: { id: l.order_id, tenant_id: tenantId } });
      if (!order || order.state === 'CANCELLED') continue;
      const { cash, pos } = this.splitCollection(order.outstanding_total, l.expected_pos);
      if (MoneyUtil.greaterThan(cash, '0') || MoneyUtil.greaterThan(pos, '0')) {
        collections.push({ orderId: order.id, cash, pos });
      }
    }

    const expectedCash = MoneyUtil.sum(collections.map((c) => c.cash));
    const cashShortOver = MoneyUtil.format(settlement.cash_discrepancy_amount || '0', 4);
    const handsOverCash = MoneyUtil.greaterThan(expectedCash, '0') || MoneyUtil.greaterThan(settlement.actual_cash_amount || '0', '0');
    // The courier's cash goes into the drawer of the register the batch is closed at.
    const drawer = handsOverCash ? await this.shiftService.requireDrawer(tenantId, settlement.branch_id, null) : null;
    const cashMethod = collections.some((c) => MoneyUtil.greaterThan(c.cash, '0')) ? await this.activeMethod(tenantId, ['CASH']) : null;
    const posMethod = collections.some((c) => MoneyUtil.greaterThan(c.pos, '0')) ? await this.activeMethod(tenantId, ['MOBILE_POS', 'CARD_POS', 'NETWORK_POS', 'CARD']) : null;
    const courier = await this.courierRepo.findOne({ where: { id: settlement.courier_id, tenant_id: tenantId } });

    const settledOn = await this.businessToday(tenantId, settlement.branch_id);
    const saved = await this.orderRepo.manager.transaction(async (em) => {
      let seq = 0;
      for (const c of collections) {
        const order = await em.findOne(OrderHeader, { where: { id: c.orderId, tenant_id: tenantId }, lock: { mode: 'pessimistic_write' } });
        if (!order) continue;
        for (const [method, amount] of [[cashMethod, c.cash], [posMethod, c.pos]] as Array<[PaymentMethod | null, string]>) {
          if (!method || !MoneyUtil.greaterThan(amount, '0')) continue;
          const payment = await em.save(
            Payment,
            em.create(Payment, {
              tenant_id: tenantId,
              order_id: order.id,
              payment_number: `PAY-${settlement.settlement_number}-${++seq}`,
              method_id: method.id,
              method_kind: method.kind,
              status: 'SUCCEEDED',
              amount,
              currency_code: order.currency_code || 'IRR',
              reference: settlement.settlement_number,
              shift_id: drawer?.id ?? null,
              // The day the courier handed the money over, by the branch's cutoff.
              business_date: settledOn,
              idempotency_key: `cod:${settlement.id}:${order.id}:${method.kind}`,
              posted_at: new Date(),
            }),
          );
          await em.save(PaymentAllocation, em.create(PaymentAllocation, { tenant_id: tenantId, payment_id: payment.id, order_id: order.id, amount, currency_code: payment.currency_code }));
          if (method.kind === 'CASH' && drawer) {
            await this.shiftService.recordCashPaymentMovement(tenantId, drawer.id, payment.id, amount, userId, em);
          }
          order.paid_total = MoneyUtil.add(order.paid_total || '0', amount);
        }

        const owed = MoneyUtil.subtract(order.grand_total || '0', order.paid_total || '0');
        order.outstanding_total = MoneyUtil.greaterThan(owed, '0') ? owed : '0.0000';
        order.paid_amount = order.paid_total;
        order.due_amount = order.outstanding_total;
        const fromState = order.state;
        if (MoneyUtil.isZero(order.outstanding_total) && order.state !== 'COMPLETED') {
          order.state = 'COMPLETED';
          order.status = 'COMPLETED';
          order.completed_at = new Date();
        }
        await em.save(OrderHeader, order);
        if (fromState !== order.state) {
          await this.transitionRecorder.record(em, { tenantId, order, fromState, action: 'COMPLETE', userId, reasonText: `Settled in ${settlement.settlement_number}` });
        }
      }

      // The customer paid in full; a gap between that and what the courier handed over is
      // the courier's, recorded on the batch. The drawer is moved by the gap so its count
      // matches the cash really in it, and the cashier is not left carrying the shortage.
      if (drawer && !MoneyUtil.isZero(cashShortOver)) {
        const short = MoneyUtil.lessThan(cashShortOver, '0');
        await em.save(
          CashMovement,
          em.create(CashMovement, {
            tenant_id: tenantId,
            shift_id: drawer.id,
            type: short ? 'PAID_OUT' : 'PAID_IN',
            amount: cashShortOver,
            reason_text: `Courier ${courier?.name || settlement.courier_id} ${short ? 'short' : 'over'} on ${settlement.settlement_number}`,
            reference: settlement.settlement_number,
            posted_by: userId || null,
          }),
        );
      }

      settlement.status = 'CLOSED';
      settlement.closed_at = new Date();
      settlement.closed_by_user_id = userId;
      if (approvalRequestId) settlement.approval_request_id = approvalRequestId;
      const closed = await em.save(CourierSettlement, settlement);

      for (const l of lines) {
        if (!l.delivery_assignment_id) continue;
        const asgn = await em.findOne(DeliveryAssignment, { where: { id: l.delivery_assignment_id } });
        if (asgn) {
          asgn.is_settled = true;
          asgn.settlement_id = id;
          await em.save(DeliveryAssignment, asgn);
        }
      }
      return closed;
    });

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

    // Closing a batch now takes the customers' payments and puts the cash in a drawer.
    // Reopening the batch would leave those in place and let them be taken a second time, so
    // a batch that posted money is corrected through the orders, not by reversing it.
    const posted = await this.paymentRepo.count({ where: { tenant_id: tenantId, reference: settlement.settlement_number, status: 'SUCCEEDED' } });
    if (posted > 0) {
      throw new ConflictException(
        `Settlement ${settlement.settlement_number} already recorded ${posted} customer payment(s). Refund or correct those orders instead of reversing the batch.`,
      );
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
        total_adjustment_amount: detail.total_adjustment_amount,
        net_settlement_amount: detail.net_settlement_amount,
      },
      lines: detail.lines,
      generated_at: new Date().toISOString(),
    };
  }
}
