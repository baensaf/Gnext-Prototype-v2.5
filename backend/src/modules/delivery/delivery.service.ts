import { Injectable, NotFoundException, BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In, Not, MoreThanOrEqual } from 'typeorm';
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
import { Customer } from '../../entities/Customer.entity';
import { Branch, SELLING_BRANCH_TYPES } from '../../entities/Branch.entity';
import { PaymentAllocation } from '../../entities/PaymentAllocation.entity';
import { CashMovement } from '../../entities/CashMovement.entity';
import { AuditWriter } from '../audit/audit-writer.service';
import { ShiftService } from '../cashier/shift.service';
import { OrderTransitionRecorder } from '../order-lifecycle/order-transition-recorder.service';
import { MoneyUtil } from '../../common/utils/money.util';
import { BusinessDateUtil } from '../../common/utils/business-date.util';
import { normalizePhone } from '../customer/customer.service';
import { TenantSetting } from '../../entities/TenantSetting.entity';
import { pickSettingValue } from '../../common/utils/setting-scope.util';
import { CourierPayMode, computeCourierPay, isCourierPayMode, resolveCourierPayPolicy } from './courier-pay';

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
    @InjectRepository(CourierAttendance) private readonly attendanceRepo: Repository<CourierAttendance>,
    @InjectRepository(CourierTerminalAssignment) private readonly terminalAssignRepo: Repository<CourierTerminalAssignment>,
    @InjectRepository(Delivery) private readonly deliveryRepo: Repository<Delivery>,
    @InjectRepository(DeliveryEvent) private readonly deliveryEventRepo: Repository<DeliveryEvent>,
    @InjectRepository(Terminal) private readonly terminalRepo: Repository<Terminal>,
    @InjectRepository(CustomerAddress) private readonly customerAddressRepo: Repository<CustomerAddress>,
    @InjectRepository(Customer) private readonly customerRepo: Repository<Customer>,
    @InjectRepository(Branch) private readonly branchRepo: Repository<Branch>,
    @InjectRepository(TenantSetting) private readonly settingRepo: Repository<TenantSetting>,
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

  async createZone(tenantId: string, data: { branch_id: string; code: string; name: string; fee?: string | number; estimated_minutes?: number; courier_pay?: string | null; polygon?: any; postal_prefixes?: string[] }) {
    const existing = await this.zoneRepo.findOne({ where: { tenant_id: tenantId, branch_id: data.branch_id, code: data.code.toUpperCase() } });
    if (existing) throw new ConflictException(`Delivery zone code ${data.code} already exists for this branch`);

    const zone = this.zoneRepo.create({
      tenant_id: tenantId,
      branch_id: data.branch_id,
      code: data.code.toUpperCase(),
      name: data.name,
      fee: MoneyUtil.format(data.fee || '0', 4),
      estimated_minutes: data.estimated_minutes || 30,
      courier_pay: DeliveryService.optionalAmount(data.courier_pay),
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

  async updateZone(
    tenantId: string,
    id: string,
    data: { name?: string; fee?: string; estimated_minutes?: number; courier_pay?: string | null },
    actorId?: string,
  ) {
    const zone = await this.zoneRepo.findOne({ where: { id, tenant_id: tenantId } });
    if (!zone) throw new NotFoundException('Delivery zone not found');

    const before = { name: zone.name, fee: zone.fee, estimated_minutes: zone.estimated_minutes, courier_pay: zone.courier_pay };
    if (data.name !== undefined) zone.name = data.name;
    if (data.fee !== undefined) zone.fee = MoneyUtil.format(data.fee || '0', 4);
    if (data.estimated_minutes !== undefined) zone.estimated_minutes = data.estimated_minutes;
    if (data.courier_pay !== undefined) zone.courier_pay = DeliveryService.optionalAmount(data.courier_pay);

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
      afterData: { name: saved.name, fee: saved.fee, estimated_minutes: saved.estimated_minutes, courier_pay: saved.courier_pay },
    });
    return saved;
  }

  /** A blank amount means "not set", which is different from zero. */
  private static optionalAmount(value?: string | number | null): string | null {
    if (value === null || value === undefined || String(value).trim() === '') return null;
    return MoneyUtil.format(value, 4);
  }

  // --- 2. COURIERS & ATTENDANCE ---
  async getCouriers(tenantId: string, branchId?: string) {
    const where: any = { tenant_id: tenantId, is_active: true };
    if (branchId) where.branch_id = branchId;
    const couriers = await this.courierRepo.find({ where, order: { name: 'ASC' } });

    const todayStr = BusinessDateUtil.today();
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

    const todayStr = BusinessDateUtil.today();
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
    data: { branch_id?: string; code: string; name: string; phone?: string; vehicle_type?: string; compensation_per_delivery?: string | number; pay_mode?: string },
    correlationId: string = 'corr-courier-create',
    actorId?: string,
  ) {
    const code = data.code.trim().toUpperCase();
    const onFile = await this.findCourierOnFile(tenantId, code, data.phone);
    if (onFile) {
      const branch = onFile.branch_id ? await this.branchRepo.findOne({ where: { id: onFile.branch_id, tenant_id: tenantId } }) : null;
      throw new ConflictException({
        code: 'COURIER_EXISTS',
        title: 'Courier Already On File',
        detail: `${onFile.name} is already on file${branch ? ` at ${branch.name}` : ''}. Move them to this branch instead of adding them twice.`,
        context: {
          courier: {
            id: onFile.id,
            code: onFile.code,
            name: onFile.name,
            phone: onFile.phone,
            branch_id: onFile.branch_id,
            branch_name: branch?.name ?? null,
            is_active: onFile.is_active,
          },
        },
      });
    }

    const payMode = isCourierPayMode(data.pay_mode)
      ? data.pay_mode
      : (await this.payPolicyFor(tenantId, data.branch_id)).defaultPayMode;

    const courier = this.courierRepo.create({
      tenant_id: tenantId,
      branch_id: data.branch_id || null,
      code,
      name: data.name,
      phone: data.phone || null,
      vehicle_type: data.vehicle_type || 'MOTORCYCLE',
      pay_mode: payMode,
      compensation_per_delivery: MoneyUtil.format(data.compensation_per_delivery || '0', 4),
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
   * A courier is one person to the chain, however many shops they ride for over time. The
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

  /**
   * Moves a courier's record to another branch, so a rider who changes shops keeps one
   * profile and one history instead of turning up twice.
   *
   * What they did before stays where it happened: a delivery belongs to the branch of its
   * order, attendance and settlements carry their own branch. So cash still owed from the
   * old shop is settled there, and nothing is copied or re-pointed. A courier is only moved
   * between shifts — not while carrying orders, checked in, or holding the old shop's
   * mobile POS, each of which the old branch has to close out first.
   */
  async moveCourier(tenantId: string, courierId: string, targetBranchId: string | undefined, actorId?: string) {
    if (!targetBranchId) throw new BadRequestException('Name the branch the courier is moving to');

    const courier = await this.courierRepo.findOne({ where: { id: courierId, tenant_id: tenantId } });
    if (!courier) throw new NotFoundException('Courier not found');

    const target = await this.branchRepo.findOne({ where: { id: targetBranchId, tenant_id: tenantId } });
    if (!target) throw new NotFoundException('Branch not found');

    // Same branch and still active: nothing to move. An archived courier on this branch's
    // own books is brought back the same way.
    if (courier.branch_id !== targetBranchId || !courier.is_active) {
      const refuse = (code: string, detail: string) => new ConflictException({ code, title: 'Courier Cannot Move Yet', detail });

      const activeCount = await this.deliveryRepo.count({
        where: { tenant_id: tenantId, courier_id: courierId, state: In(ACTIVE_DELIVERY_STATES) },
      });
      if (activeCount > 0) {
        throw refuse('COURIER_ON_THE_ROAD', `${courier.name} still has ${activeCount} delivery(s) under way at their current branch.`);
      }

      const attendance = await this.attendanceRepo.findOne({
        where: { tenant_id: tenantId, courier_id: courierId, date: BusinessDateUtil.today() },
      });
      if (attendance && attendance.status !== 'CHECKED_OUT') {
        throw refuse('COURIER_ON_SHIFT', `${courier.name} is still checked in at their current branch. Check them out there first.`);
      }

      const terminal = await this.terminalAssignRepo.findOne({
        where: { tenant_id: tenantId, courier_id: courierId, is_active: true },
      });
      if (terminal) {
        throw refuse('COURIER_HOLDS_TERMINAL', `${courier.name} still holds a mobile POS from their current branch. Release it there first.`);
      }

      const fromBranchId = courier.branch_id ?? null;
      courier.branch_id = targetBranchId;
      courier.is_active = true;
      await this.courierRepo.save(courier);

      await this.auditWriter.write({
        tenantId,
        actorType: 'ADMIN',
        actorId,
        action: 'COURIER_MOVED',
        entityType: 'Courier',
        entityId: courier.id,
        branchId: targetBranchId,
        correlationId: 'corr-courier-move',
        beforeData: { branch_id: fromBranchId },
        afterData: { branch_id: targetBranchId },
        details: { courierId: courier.id, fromBranchId, toBranchId: targetBranchId },
      });
    }

    return await this.getCourierById(tenantId, courierId);
  }

  async updateCourierPay(
    tenantId: string,
    courierId: string,
    data: { pay_mode: string; compensation_per_delivery?: string },
    actorId?: string,
  ) {
    if (!isCourierPayMode(data.pay_mode)) throw new BadRequestException('Unknown courier pay rule');

    const courier = await this.courierRepo.findOne({ where: { id: courierId, tenant_id: tenantId } });
    if (!courier) throw new NotFoundException('Courier not found');

    const before = { pay_mode: courier.pay_mode, compensation_per_delivery: courier.compensation_per_delivery };
    courier.pay_mode = data.pay_mode;
    if (data.compensation_per_delivery !== undefined) {
      courier.compensation_per_delivery = MoneyUtil.format(data.compensation_per_delivery || '0', 4);
    }
    const saved = await this.courierRepo.save(courier);

    await this.auditWriter.write({
      tenantId,
      actorType: 'ADMIN',
      actorId,
      action: 'COURIER_PAY_UPDATED',
      entityType: 'Courier',
      entityId: saved.id,
      branchId: saved.branch_id ?? undefined,
      correlationId: 'corr-courier-pay',
      beforeData: before,
      afterData: { pay_mode: saved.pay_mode, compensation_per_delivery: saved.compensation_per_delivery },
    });
    return saved;
  }

  /** The COURIER_PAY policy in force at a branch: its own override, else head office's. */
  async payPolicyFor(tenantId: string, branchId?: string | null) {
    const rows = (await this.settingRepo.find({ where: { tenant_id: tenantId, key: 'COURIER_PAY' } })) || [];
    return resolveCourierPayPolicy(pickSettingValue(rows, branchId));
  }

  /**
   * What the delivery's courier earns for this trip under their own pay rule. Changing a
   * rule or a rate later does not reprice trips already paid: callers store the result.
   */
  private async payForTrip(tenantId: string, delivery: Delivery, tip?: string | null): Promise<{ amount: string; basis: CourierPayMode } | null> {
    if (!delivery.courier_id) return null;
    const courier = await this.courierRepo.findOne({ where: { id: delivery.courier_id } });
    if (!courier) return null;

    const zone =
      courier.pay_mode === 'ZONE_RATE' && delivery.zone_id
        ? await this.zoneRepo.findOne({ where: { id: delivery.zone_id, tenant_id: tenantId } })
        : null;

    return computeCourierPay({
      mode: courier.pay_mode,
      courierRate: courier.compensation_per_delivery,
      // Snapshotted from the zone when the delivery was created: the listed fee, before any
      // discount the customer got.
      listedFee: delivery.fee,
      zoneRate: zone?.courier_pay ?? null,
      tip,
    });
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

  async recordAttendance(
    tenantId: string,
    data: { courier_id: string; branch_id: string; status: 'CHECKED_IN' | 'CHECKED_OUT' | 'PAUSED'; availability_status?: 'AVAILABLE' | 'BUSY' | 'OFF_LINE' },
    actorId?: string,
    userBranchId?: string | null,
  ) {
    const courier = await this.courierRepo.findOne({ where: { id: data.courier_id, tenant_id: tenantId } });
    if (!courier) throw new NotFoundException('Courier not found');

    // The courier is named in the body, which the ownership guard cannot see.
    if (userBranchId && courier.branch_id !== userBranchId) {
      throw new ForbiddenException({
        code: 'OTHER_BRANCH',
        title: 'Belongs To Another Branch',
        detail: 'This record belongs to a branch other than your own.',
      });
    }
    // A courier signs in where they work. Riding for another shop is a move, not a check-in
    // somewhere else, or the same person ends up on two branches' rosters at once.
    if (courier.branch_id && data.branch_id && data.branch_id !== courier.branch_id) {
      throw new BadRequestException({
        code: 'COURIER_OTHER_BRANCH',
        title: 'Courier Works At Another Branch',
        detail: `${courier.name} works at another branch. Move them to this branch before checking them in.`,
      });
    }

    const todayStr = BusinessDateUtil.today();
    let attendance = await this.attendanceRepo.findOne({
      where: { tenant_id: tenantId, courier_id: data.courier_id, date: todayStr },
    });

    // Checked out at the old shop this morning, moved, and checking in at the new one.
    if (attendance && courier.branch_id && attendance.branch_id !== courier.branch_id && data.status === 'CHECKED_IN') {
      attendance.branch_id = courier.branch_id;
      attendance.checked_in_at = new Date();
      attendance.checked_out_at = null;
    }

    if (!attendance) {
      let targetBranchId = courier.branch_id || data.branch_id;
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
      actorId,
      action: 'COURIER_ATTENDANCE_UPDATED',
      entityType: 'Courier',
      entityId: courier.id,
      branchId: saved.branch_id ?? undefined,
      correlationId: 'corr-courier-attendance',
      afterData: saved,
    });

    return saved;
  }

  async setCourierAvailability(tenantId: string, courierId: string, availabilityStatus: 'AVAILABLE' | 'BUSY' | 'OFF_LINE', actorId?: string) {
    const todayStr = BusinessDateUtil.today();
    let attendance = await this.attendanceRepo.findOne({
      where: { tenant_id: tenantId, courier_id: courierId, date: todayStr },
    });

    if (!attendance) {
      throw new BadRequestException('Courier is not checked in today. Please check in first.');
    }

    const previousAvailability = attendance.availability_status;
    attendance.availability_status = availabilityStatus;
    const saved = await this.attendanceRepo.save(attendance);
    await this.auditWriter.write({
      tenantId,
      actorType: 'ADMIN',
      actorId,
      action: 'COURIER_AVAILABILITY_UPDATED',
      entityType: 'Courier',
      entityId: courierId,
      branchId: saved.branch_id ?? undefined,
      beforeData: { availability_status: previousAvailability },
      afterData: saved,
    });
    return saved;
  }

  // --- 3. MOBILE TERMINAL ASSIGNMENT ---
  async assignMobileTerminal(tenantId: string, courierId: string, terminalId: string, actorId?: string) {
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
      actorId,
      action: 'COURIER_TERMINAL_ASSIGNED',
      entityType: 'Courier',
      entityId: courier.id,
      branchId: courier.branch_id ?? undefined,
      correlationId: 'corr-terminal-assign',
      afterData: { ...saved, terminal_name: terminal.name || terminal.code },
    });

    return saved;
  }

  async unassignMobileTerminal(tenantId: string, courierId: string, actorId?: string) {
    const activeAssigns = await this.terminalAssignRepo.find({
      where: { tenant_id: tenantId, courier_id: courierId, is_active: true },
    });
    for (const a of activeAssigns) {
      a.is_active = false;
      a.unassigned_at = new Date();
      await this.terminalAssignRepo.save(a);
    }
    if (activeAssigns.length) {
      await this.auditWriter.write({
        tenantId,
        actorType: 'ADMIN',
        actorId,
        action: 'COURIER_TERMINAL_UNASSIGNED',
        entityType: 'Courier',
        entityId: courierId,
        beforeData: { terminal_ids: activeAssigns.map((a) => a.terminal_id) },
      });
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

    // The attempt that matches the delivery as it stands. A failed earlier ride by another
    // courier keeps its own status, or a later completion would hand them the order's cash.
    const assignment = await this.assignmentRepo.findOne({
      where: {
        tenant_id: tenantId,
        order_id: delivery.order_id,
        ...(delivery.courier_id ? { courier_id: delivery.courier_id } : {}),
        status: Not('FAILED'),
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
    // Once the courier has left, the food is on their bike. Naming another rider put the board
    // back to "assigned" while the first still carried it. The ride is failed back first, then
    // requeued, so the first courier's attempt is closed with whatever it is owed.
    if (delivery.state === 'PICKED_UP' || delivery.state === 'EN_ROUTE') {
      throw new ConflictException({
        code: 'DELIVERY_ALREADY_LEFT',
        message: `Order ${order.order_number} is already on its way; mark the ride failed and requeue it to send another courier`,
      });
    }

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

    const todayStr = BusinessDateUtil.today();
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

    // A failed ride stays a record of its own, so a retry by the same courier is a new attempt.
    let assignment = await this.assignmentRepo.findOne({
      where: { tenant_id: tenantId, order_id: delivery.order_id, courier_id: courierId, status: Not('FAILED') },
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
        where: { tenant_id: tenantId, order_id: delivery.order_id, courier_id: delivery.courier_id, status: Not('FAILED') },
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
          where: { tenant_id: tenantId, order_id: delivery.order_id, courier_id: delivery.courier_id, status: Not('FAILED') },
        })
      : null;

    const pay = await this.payForTrip(tenantId, delivery, assignment?.tip_amount);
    if (pay) {
      delivery.compensation_amount = pay.amount;
      delivery.compensation_basis = pay.basis;
    }

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
      assignment.compensation_amount = MoneyUtil.format(pay?.amount || '0', 2);
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

  async failDelivery(tenantId: string, deliveryId: string, reason: string, userId?: string) {
    const delivery = await this.deliveryRepo.findOne({ where: { id: deliveryId, tenant_id: tenantId } });
    if (!delivery) throw new NotFoundException('Delivery not found');

    const order = await this.orderRepo.findOne({ where: { id: delivery.order_id, tenant_id: tenantId } });
    const orderState = String(order?.state || order?.status || '').toUpperCase();
    if (order && ['COMPLETED', 'CANCELLED'].includes(orderState)) {
      await this.reconcileDeliveryWithOrder(tenantId, delivery, order);
      throw new ConflictException({
        code: 'DELIVERY_NOT_ACTIVE',
        message: `Order ${order.order_number} is already ${orderState.toLowerCase()}; its delivery cannot fail`,
      });
    }
    // Only a ride that is still out can come back. A board that had not refreshed could fail a
    // delivery already completed, which reopened a paid order and cleared the cash its courier
    // owed.
    if (!ACTIVE_DELIVERY_STATES.includes(delivery.state)) {
      throw new ConflictException({
        code: 'DELIVERY_NOT_ACTIVE',
        message: `This delivery is ${delivery.state.toLowerCase()}; only one that is assigned or on its way can fail`,
      });
    }

    const fromState = delivery.state;
    delivery.state = 'FAILED';
    delivery.failure_reason = reason || 'Delivery attempt failed';

    const saved = await this.deliveryRepo.save(delivery);
    await this.logDeliveryEvent(tenantId, saved.id, fromState, 'FAILED', `Delivery failed: ${reason}`, userId);

    // The courier's attempt is closed as failed, carrying its pay: a courier who rode out and
    // came back is paid for the trip when the branch's COURIER_PAY policy says so. A courier
    // who never left is not. No cash is expected from a failed attempt.
    if (delivery.courier_id) {
      const assignment = await this.assignmentRepo.findOne({
        where: { tenant_id: tenantId, order_id: delivery.order_id, courier_id: delivery.courier_id, status: Not('FAILED') },
      });
      if (assignment) {
        const rodeOut = ['PICKED_UP', 'EN_ROUTE'].includes(fromState);
        const policy = rodeOut ? await this.payPolicyFor(tenantId, order?.branch_id) : null;
        const pay = policy?.payFailedDeliveries ? await this.payForTrip(tenantId, delivery) : null;
        assignment.status = 'FAILED';
        assignment.failure_reason = delivery.failure_reason;
        assignment.compensation_amount = MoneyUtil.format(pay?.amount || '0', 2);
        await this.assignmentRepo.save(assignment);
      }
    }

    // The food is back at the counter. An order that never left is where the kitchen has it,
    // and moving it to READY would skip the kitchen.
    if (order && orderState === 'OUT_FOR_DELIVERY') {
      order.state = 'READY';
      order.status = 'READY';
      order.fulfillment_status = 'PENDING';
      await this.saveOrderTransition(tenantId, order, 'OUT_FOR_DELIVERY', 'DELIVERY_FAILED', userId, delivery.failure_reason);
    }

    return saved;
  }

  async requeueDelivery(tenantId: string, deliveryId: string, userId?: string) {
    const delivery = await this.deliveryRepo.findOne({ where: { id: deliveryId, tenant_id: tenantId } });
    if (!delivery) throw new NotFoundException('Delivery not found');
    // Requeue is the step after a failed ride. On any other delivery it took the courier off an
    // order still on their bike, or put a finished one back on the board.
    if (delivery.state !== 'FAILED') {
      throw new ConflictException({
        code: 'DELIVERY_NOT_FAILED',
        message: `This delivery is ${delivery.state.toLowerCase()}; only a failed delivery can be requeued`,
      });
    }

    const fromState = delivery.state;
    delivery.state = 'UNASSIGNED';
    delivery.courier_id = null;
    delivery.failure_reason = null;

    const saved = await this.deliveryRepo.save(delivery);
    await this.logDeliveryEvent(tenantId, saved.id, fromState, 'UNASSIGNED', 'Delivery requeued for dispatch', userId);
    return saved;
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
        zone_name: zone ? zone.name : 'Default Zone',
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

  async updateAssignmentStatus(tenantId: string, assignmentId: string, status: string, failureReason?: string, correlationId?: string) {
    if (status === 'EN_ROUTE' || status === 'PICKED_UP' || status === 'OUT_FOR_DELIVERY') {
      return await this.departDelivery(tenantId, assignmentId);
    }
    if (status === 'DELIVERED') {
      return await this.completeDelivery(tenantId, assignmentId);
    }
    if (status === 'FAILED') {
      return await this.failDelivery(tenantId, assignmentId, failureReason || 'Failed');
    }
    // Any other status used to be written straight onto the delivery, past every rule above.
    throw new BadRequestException(`Status ${status} is not a delivery step; use assign, depart, complete, fail or requeue`);
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
  /** The money a courier's attempt should bring back: the unpaid balance if delivered, nothing if it failed. */
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
      where: { tenant_id: tenantId, is_settled: false, status: In(['DELIVERED', 'FAILED', 'RETURNED']) },
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
        total_compensation: preview.total_compensation_amount,
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

    const named = Boolean(assignmentIds && assignmentIds.length > 0);
    const where: any = {
      tenant_id: tenantId,
      courier_id: courierId,
      status: In(['DELIVERED', 'FAILED', 'RETURNED']),
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
    let compensationStr = '0.00';
    const eligibleAssignments: DeliveryAssignment[] = [];
    const lines = [];

    for (const a of candidates) {
      const order = await this.orderRepo.findOne({ where: { id: a.order_id } });
      if (branchId && order?.branch_id && order.branch_id !== branchId) continue;

      const breakdown = await this.expectedFromAttempt(a, order);
      eligibleAssignments.push(a);
      totalFeeStr = MoneyUtil.add(totalFeeStr, a.delivery_fee || '0', 2);
      compensationStr = MoneyUtil.add(compensationStr, a.compensation_amount || '0', 2);
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
      // The couriers' pay for these attempts, already priced when each was closed. The net
      // is what they owe back once their pay is kept — the same sum updateSettlement makes.
      total_compensation_amount: compensationStr,
      net_settlement_amount: MoneyUtil.subtract(MoneyUtil.add(expCashStr, expPosStr, 2), compensationStr, 2),
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
      total_compensation_amount: preview.total_compensation_amount,
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

    // The screen keeps editing the lines it sent, so hand back their new expected split.
    return allLines ? { ...saved, lines: allLines } : saved;
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
              business_date: order.business_date || BusinessDateUtil.today(),
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
            currency_code: drawer.currency_code,
            reason_text: `Courier ${courier?.name || settlement.courier_id} ${short ? 'short' : 'over'} on ${settlement.settlement_number}`,
            reference: settlement.settlement_number,
            posted_by: userId || null,
          }),
        );
      }

      // The courier keeps their pay out of the cash they collected (or is paid it from the
      // till), so the drawer receives the collection less that pay. Without this the drawer
      // expected the full collection and every shift with deliveries closed short by the pay.
      const courierPay = MoneyUtil.format(settlement.total_compensation_amount || '0', 4);
      if (drawer && MoneyUtil.greaterThan(courierPay, '0')) {
        await em.save(
          CashMovement,
          em.create(CashMovement, {
            tenant_id: tenantId,
            shift_id: drawer.id,
            type: 'PAID_OUT',
            amount: MoneyUtil.multiply(courierPay, '-1'),
            currency_code: drawer.currency_code,
            reason_text: `Courier pay for ${courier?.name || settlement.courier_id} on ${settlement.settlement_number}`,
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
        total_compensation_amount: detail.total_compensation_amount,
        total_adjustment_amount: detail.total_adjustment_amount,
        net_settlement_amount: detail.net_settlement_amount,
      },
      lines: detail.lines,
      generated_at: new Date().toISOString(),
    };
  }

  // --- 8. CHAIN ROLL-UP (READ ONLY) ---

  /**
   * A delivery is late once it has been with a courier this long without arriving. There is
   * no promised-time column on a delivery, so elapsed time since assignment is the only
   * honest signal available; the number is a demo threshold, not a contractual SLA.
   */
  private static readonly LATE_AFTER_MINUTES = 25;


  /**
   * What head office can see of the fleet without standing in any one shop: one row per
   * branch, and nothing to click.
   *
   * Deliberately read-only, and deliberately not calling reconcileDeliveryWithOrder — that
   * method writes, and a chain-wide overview that quietly rewrote every branch's delivery
   * states as a side effect of being looked at would be a much worse thing than a row that
   * is a few seconds stale. The order state is folded in below the same way reconcile folds
   * it, so the numbers agree with the branch screen without persisting anything.
   */
  async getFleetRollup(tenantId: string) {
    const branches = await this.branchRepo.find({ where: { tenant_id: tenantId } });
    const sellingBranches = branches
      .filter((b) => SELLING_BRANCH_TYPES.includes(b.branch_type))
      .filter((b) => b.is_active);

    const today = BusinessDateUtil.today();
    const lateBefore = new Date(Date.now() - DeliveryService.LATE_AFTER_MINUTES * 60_000);

    // One join instead of a query per delivery: getDeliveries() reads the order row by row
    // because it returns a board, and a chain of a dozen branches would make that hundreds
    // of round trips for a page that only ever shows counts.
    const rows: Array<{
      branch_id: string;
      state: DeliveryState;
      order_state: string;
      order_status: string;
      cash_expected: string;
      assigned_at: Date | null;
      delivered_at: Date | null;
    }> = await this.deliveryRepo
      .createQueryBuilder('d')
      .innerJoin(OrderHeader, 'o', 'o.id = d.order_id AND o.tenant_id = d.tenant_id')
      .where('d.tenant_id = :tenantId', { tenantId })
      .select([
        'o.branch_id AS branch_id',
        'd.state AS state',
        'o.state AS order_state',
        'o.status AS order_status',
        'd.cash_expected AS cash_expected',
        'd.assigned_at AS assigned_at',
        'd.delivered_at AS delivered_at',
      ])
      .getRawMany();

    const couriers = await this.courierRepo.find({ where: { tenant_id: tenantId, is_active: true } });
    const attendance = await this.attendanceRepo.find({
      where: { tenant_id: tenantId, date: today, status: 'CHECKED_IN' },
    });

    type Bucket = {
      in_flight: number;
      unassigned: number;
      late: number;
      delivered_today: number;
      failed_today: number;
      couriers_active: number;
      couriers_on_shift: number;
      cash_with_couriers: string;
    };
    const emptyBucket = (): Bucket => ({
      in_flight: 0,
      unassigned: 0,
      late: 0,
      delivered_today: 0,
      failed_today: 0,
      couriers_active: 0,
      couriers_on_shift: 0,
      cash_with_couriers: '0.00',
    });

    // Seeded from the branch list, so a branch running no deliveries tonight still appears
    // as a row of zeroes rather than vanishing. An absent branch reads as "nothing to see";
    // a zero reads as "nothing is moving", and those are different things at head office.
    const buckets = new Map<string, Bucket>();
    for (const b of sellingBranches) buckets.set(b.id, emptyBucket());

    for (const row of rows) {
      if (!buckets.has(row.branch_id)) buckets.set(row.branch_id, emptyBucket());
      const bucket = buckets.get(row.branch_id)!;
      const state = DeliveryService.effectiveDeliveryState(row.state, row.order_state, row.order_status);

      if (state === 'DELIVERED') {
        if (BusinessDateUtil.fromDate(row.delivered_at) === today) bucket.delivered_today += 1;
        continue;
      }
      if (state === 'FAILED') {
        bucket.failed_today += 1;
        continue;
      }
      if (state === 'CANCELLED') continue;

      bucket.in_flight += 1;
      if (state === 'UNASSIGNED') bucket.unassigned += 1;
      if (row.assigned_at && new Date(row.assigned_at) < lateBefore) bucket.late += 1;
      bucket.cash_with_couriers = MoneyUtil.add(
        bucket.cash_with_couriers,
        MoneyUtil.format(row.cash_expected || '0', 2),
        2,
      );
    }

    for (const c of couriers) {
      if (!c.branch_id || !buckets.has(c.branch_id)) continue;
      buckets.get(c.branch_id)!.couriers_active += 1;
    }
    for (const a of attendance) {
      if (!buckets.has(a.branch_id)) continue;
      buckets.get(a.branch_id)!.couriers_on_shift += 1;
    }

    const byId = new Map(branches.map((b) => [b.id, b]));
    const branchRows = Array.from(buckets.entries())
      .map(([id, b]) => {
        const branch = byId.get(id);
        return {
          branch_id: id,
          branch: branch ? branch.name : id,
          branch_code: branch ? branch.code : '—',
          ...b,
        };
      })
      // Worst first: a chain operator opens this to find where to phone, not to read an
      // alphabetical list. Late orders outrank everything, then sheer volume in flight.
      .sort((a, z) => z.late - a.late || z.in_flight - a.in_flight || a.branch.localeCompare(z.branch));

    return {
      business_date: today,
      late_after_minutes: DeliveryService.LATE_AFTER_MINUTES,
      generated_at: new Date().toISOString(),
      rows: branchRows,
      totals: {
        branch_count: branchRows.length,
        branches_with_late: branchRows.filter((r) => r.late > 0).length,
        in_flight: branchRows.reduce((sum, r) => sum + r.in_flight, 0),
        unassigned: branchRows.reduce((sum, r) => sum + r.unassigned, 0),
        late: branchRows.reduce((sum, r) => sum + r.late, 0),
        delivered_today: branchRows.reduce((sum, r) => sum + r.delivered_today, 0),
        failed_today: branchRows.reduce((sum, r) => sum + r.failed_today, 0),
        couriers_active: branchRows.reduce((sum, r) => sum + r.couriers_active, 0),
        couriers_on_shift: branchRows.reduce((sum, r) => sum + r.couriers_on_shift, 0),
        cash_with_couriers: MoneyUtil.sum(branchRows.map((r) => r.cash_with_couriers), 2),
      },
    };
  }

  /**
   * The state reconcileDeliveryWithOrder would settle on, worked out without writing it.
   * Kept beside the rollup so the two readings of "what state is this in" cannot drift.
   */
  private static effectiveDeliveryState(
    state: DeliveryState,
    orderState: string,
    orderStatus: string,
  ): DeliveryState {
    const order = String(orderState || orderStatus || '').toUpperCase();
    if (order === 'COMPLETED') return 'DELIVERED';
    if (order === 'CANCELLED') return 'CANCELLED';
    if (order === 'OUT_FOR_DELIVERY' && !['DELIVERED', 'CANCELLED'].includes(state)) return 'EN_ROUTE';
    return state;
  }
}
