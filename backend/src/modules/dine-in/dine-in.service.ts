import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { DiningArea } from '../../entities/DiningArea.entity';
import { DiningTable } from '../../entities/DiningTable.entity';
import { TableSession } from '../../entities/TableSession.entity';
import { TableEvent } from '../../entities/TableEvent.entity';
import { OrderHeader } from '../../entities/OrderHeader.entity';
import { AuditWriter } from '../audit/audit-writer.service';

@Injectable()
export class DineInService {
  constructor(
    @InjectRepository(DiningArea) private readonly areaRepo: Repository<DiningArea>,
    @InjectRepository(DiningTable) private readonly tableRepo: Repository<DiningTable>,
    @InjectRepository(TableSession) private readonly sessionRepo: Repository<TableSession>,
    @InjectRepository(TableEvent) private readonly eventRepo: Repository<TableEvent>,
    @InjectRepository(OrderHeader) private readonly orderRepo: Repository<OrderHeader>,
    private readonly auditWriter: AuditWriter,
  ) {}

  async getAreas(tenantId: string, branchId?: string) {
    const where: any = { tenant_id: tenantId };
    if (branchId) where.branch_id = branchId;
    return await this.areaRepo.find({ where, order: { sort_order: 'ASC', name: 'ASC' } });
  }

  async createArea(tenantId: string, data: { branch_id?: string; code: string; name: string; sort_order?: number }, correlationId: string) {
    const area = this.areaRepo.create({
      tenant_id: tenantId,
      branch_id: data.branch_id || null,
      code: data.code.toUpperCase(),
      name: data.name,
      sort_order: data.sort_order || 1,
      is_active: true,
    });
    const saved = await this.areaRepo.save(area);
    await this.auditWriter.write({
      tenantId,
      actorType: 'ADMIN',
      action: 'DINING_AREA_CREATED',
      correlationId,
      afterData: saved,
    });
    return saved;
  }

  async getTables(tenantId: string, diningAreaId?: string) {
    const where: any = { tenant_id: tenantId };
    if (diningAreaId) where.dining_area_id = diningAreaId;
    return await this.tableRepo.find({ where, order: { table_number: 'ASC' } });
  }

  async createTable(
    tenantId: string,
    data: { dining_area_id: string; code: string; table_number: string; seating_capacity?: number; shape?: string; pos_x?: number; pos_y?: number },
    correlationId: string,
  ) {
    const table = this.tableRepo.create({
      tenant_id: tenantId,
      dining_area_id: data.dining_area_id,
      code: data.code.toUpperCase(),
      table_number: data.table_number,
      seating_capacity: data.seating_capacity || 4,
      shape: data.shape || 'RECTANGLE',
      pos_x: data.pos_x || 0,
      pos_y: data.pos_y || 0,
      is_active: true,
    });
    const saved = await this.tableRepo.save(table);
    await this.auditWriter.write({
      tenantId,
      actorType: 'ADMIN',
      action: 'DINING_TABLE_CREATED',
      correlationId,
      afterData: saved,
    });
    return saved;
  }

  async getFloorPlan(tenantId: string, branchId?: string) {
    const areas = await this.getAreas(tenantId, branchId);
    const tables = await this.tableRepo.find({ where: { tenant_id: tenantId, is_active: true } });
    const activeSessions = await this.sessionRepo.find({ where: { tenant_id: tenantId, closed_at: null as any } });

    const sessionMap = new Map(activeSessions.map((s) => [s.table_id, s]));
    const now = new Date();

    const formattedTables = tables.map((t) => {
      const sess = sessionMap.get(t.id);
      let status = 'AVAILABLE';
      let guestCount = 0;
      let elapsedTimeMinutes = 0;
      let orderId = null;

      if (sess) {
        status = sess.status;
        guestCount = sess.guest_count;
        orderId = sess.active_order_id;
        const diffMs = now.getTime() - new Date(sess.seated_at).getTime();
        elapsedTimeMinutes = Math.floor(diffMs / 60000);
      }

      return {
        ...t,
        status,
        guest_count: guestCount,
        elapsed_minutes: elapsedTimeMinutes,
        active_order_id: orderId,
        active_session_id: sess ? sess.id : null,
      };
    });

    return { areas, tables: formattedTables };
  }

  async seatGuests(tenantId: string, tableId: string, guestCount: number, orderId?: string, correlationId?: string) {
    const table = await this.tableRepo.findOne({ where: { id: tableId, tenant_id: tenantId } });
    if (!table) throw new NotFoundException('Table not found');

    const existingSession = await this.sessionRepo.findOne({ where: { tenant_id: tenantId, table_id: tableId, closed_at: null as any } });
    if (existingSession) throw new BadRequestException('Table is already occupied');

    const session = this.sessionRepo.create({
      tenant_id: tenantId,
      table_id: tableId,
      active_order_id: orderId || null,
      status: 'OCCUPIED',
      guest_count: guestCount || 2,
      seated_at: new Date(),
    });
    const savedSession = await this.sessionRepo.save(session);

    const event = this.eventRepo.create({
      tenant_id: tenantId,
      table_session_id: savedSession.id,
      event_type: 'SEATED',
      payload: { guestCount, orderId },
    });
    await this.eventRepo.save(event);

    await this.auditWriter.write({
      tenantId,
      actorType: 'ADMIN',
      action: 'TABLE_SEATED',
      correlationId: correlationId || 'corr-seat',
      afterData: savedSession,
    });

    return savedSession;
  }

  async transferTable(tenantId: string, sourceTableId: string, targetTableId: string, correlationId?: string) {
    const sourceSession = await this.sessionRepo.findOne({ where: { tenant_id: tenantId, table_id: sourceTableId, closed_at: null as any } });
    if (!sourceSession) throw new NotFoundException('No active session found on source table');

    const targetSession = await this.sessionRepo.findOne({ where: { tenant_id: tenantId, table_id: targetTableId, closed_at: null as any } });
    if (targetSession) throw new BadRequestException('Target table is already occupied');

    // Transfer session
    sourceSession.table_id = targetTableId;
    const savedSession = await this.sessionRepo.save(sourceSession);

    // Update order table number if order exists
    if (sourceSession.active_order_id) {
      const order = await this.orderRepo.findOne({ where: { id: sourceSession.active_order_id, tenant_id: tenantId } });
      const targetTable = await this.tableRepo.findOne({ where: { id: targetTableId } });
      if (order && targetTable) {
        order.table_number = targetTable.table_number;
        await this.orderRepo.save(order);
      }
    }

    await this.auditWriter.write({
      tenantId,
      actorType: 'ADMIN',
      action: 'TABLE_TRANSFERRED',
      correlationId: correlationId || 'corr-transfer',
      details: { sourceTableId, targetTableId },
    });

    return savedSession;
  }

  async mergeTables(tenantId: string, sourceTableId: string, targetTableId: string, correlationId?: string) {
    const sourceSession = await this.sessionRepo.findOne({ where: { tenant_id: tenantId, table_id: sourceTableId, closed_at: null as any } });
    const targetSession = await this.sessionRepo.findOne({ where: { tenant_id: tenantId, table_id: targetTableId, closed_at: null as any } });

    if (!sourceSession || !targetSession) throw new BadRequestException('Both tables must have active sessions to merge');

    targetSession.guest_count += sourceSession.guest_count;
    await this.sessionRepo.save(targetSession);

    sourceSession.closed_at = new Date();
    sourceSession.status = 'AVAILABLE';
    await this.sessionRepo.save(sourceSession);

    await this.auditWriter.write({
      tenantId,
      actorType: 'ADMIN',
      action: 'TABLES_MERGED',
      correlationId: correlationId || 'corr-merge',
      details: { sourceTableId, targetTableId },
    });

    return targetSession;
  }

  async releaseTable(tenantId: string, tableId: string, nextStatus?: 'AVAILABLE' | 'CLEANING', correlationId?: string) {
    const session = await this.sessionRepo.findOne({ where: { tenant_id: tenantId, table_id: tableId, closed_at: null as any } });
    if (session) {
      session.closed_at = new Date();
      session.status = nextStatus || 'AVAILABLE';
      await this.sessionRepo.save(session);
    }

    await this.auditWriter.write({
      tenantId,
      actorType: 'ADMIN',
      action: 'TABLE_RELEASED',
      correlationId: correlationId || 'corr-release',
      details: { tableId, nextStatus: nextStatus || 'AVAILABLE' },
    });

    return { success: true, tableId };
  }
}
