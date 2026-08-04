import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Courier } from '../../entities/Courier.entity';
import { DeliveryAssignment } from '../../entities/DeliveryAssignment.entity';
import { OrderHeader } from '../../entities/OrderHeader.entity';
import { AuditWriter } from '../audit/audit-writer.service';

@Injectable()
export class DeliveryService {
  constructor(
    @InjectRepository(Courier) private readonly courierRepo: Repository<Courier>,
    @InjectRepository(DeliveryAssignment) private readonly assignmentRepo: Repository<DeliveryAssignment>,
    @InjectRepository(OrderHeader) private readonly orderRepo: Repository<OrderHeader>,
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
    });
    const savedAssignment = await this.assignmentRepo.save(assignment);

    // Update Courier Status to ON_DELIVERY
    courier.status = 'ON_DELIVERY';
    await this.courierRepo.save(courier);

    // Update Order Header status
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

    // Release Courier to AVAILABLE if terminal status
    if (['DELIVERED', 'FAILED', 'RETURNED'].includes(status)) {
      const courier = await this.courierRepo.findOne({ where: { id: assignment.courier_id } });
      if (courier) {
        courier.status = 'AVAILABLE';
        await this.courierRepo.save(courier);
      }
    }

    // Update parent order status
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
}
