import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource, In, IsNull } from 'typeorm';
import { DiningArea } from '../../entities/DiningArea.entity';
import { DiningTable } from '../../entities/DiningTable.entity';
import { TableSession } from '../../entities/TableSession.entity';
import { TableOccupancyEvent } from '../../entities/TableOccupancyEvent.entity';
import { OrderHeader } from '../../entities/OrderHeader.entity';
import { OrderItem } from '../../entities/OrderItem.entity';
import { OrderLink } from '../../entities/OrderLink.entity';
import { OrderStateEvent } from '../../entities/OrderStateEvent.entity';
import { Payment } from '../../entities/Payment.entity';
import { PaymentAllocation } from '../../entities/PaymentAllocation.entity';
import { Product } from '../../entities/Product.entity';
import { AuditWriter } from '../audit/audit-writer.service';
import { OrderTransitionRecorder } from '../order-lifecycle/order-transition-recorder.service';
import { MoneyUtil } from '../../common/utils/money.util';
import { CreateSectionDto, UpdateSectionDto, CreateTableDto, UpdateTableDto, MergeOrdersDto } from './dtos/dine-in.dto';

@Injectable()
export class DineInService {
  constructor(
    @InjectRepository(DiningArea) private readonly areaRepo: Repository<DiningArea>,
    @InjectRepository(DiningTable) private readonly tableRepo: Repository<DiningTable>,
    @InjectRepository(TableSession) private readonly sessionRepo: Repository<TableSession>,
    @InjectRepository(TableOccupancyEvent) private readonly occupancyRepo: Repository<TableOccupancyEvent>,
    @InjectRepository(OrderHeader) private readonly orderRepo: Repository<OrderHeader>,
    private readonly auditWriter: AuditWriter,
    private readonly dataSource: DataSource,
    private readonly transitionRecorder: OrderTransitionRecorder,
  ) {}

  async getSections(tenantId: string, branchId?: string) {
    const where: any = { tenant_id: tenantId, is_active: true };
    if (branchId) where.branch_id = branchId;
    return await this.areaRepo.find({ where, order: { sort_order: 'ASC', name: 'ASC' } });
  }

  async createSection(tenantId: string, dto: CreateSectionDto, correlationId?: string) {
    const area = this.areaRepo.create({
      tenant_id: tenantId,
      branch_id: dto.branchId || null,
      code: dto.code.toUpperCase(),
      name: dto.name,
      sort_order: dto.sortOrder || 1,
      is_active: true,
    });
    const saved = await this.areaRepo.save(area);
    await this.auditWriter.write({
      tenantId,
      actorType: 'ADMIN',
      action: 'DINING_SECTION_CREATED',
      correlationId: correlationId || 'corr-section',
      afterData: saved,
    });
    return saved;
  }

  async updateSection(tenantId: string, id: string, dto: UpdateSectionDto, correlationId?: string) {
    const section = await this.areaRepo.findOne({ where: { id, tenant_id: tenantId } });
    if (!section) throw new NotFoundException(`Section ${id} not found`);

    if (dto.code !== undefined) section.code = dto.code.toUpperCase();
    if (dto.name !== undefined) section.name = dto.name;
    if (dto.sortOrder !== undefined) section.sort_order = dto.sortOrder;
    if (dto.isActive !== undefined) section.is_active = dto.isActive;

    const saved = await this.areaRepo.save(section);
    await this.auditWriter.write({
      tenantId,
      actorType: 'ADMIN',
      action: 'DINING_SECTION_UPDATED',
      correlationId: correlationId || 'corr-section-upd',
      afterData: saved,
    });
    return saved;
  }

  async archiveSection(tenantId: string, id: string, correlationId?: string) {
    const section = await this.areaRepo.findOne({ where: { id, tenant_id: tenantId } });
    if (!section) throw new NotFoundException(`Section ${id} not found`);

    const activeTables = await this.tableRepo.find({ where: { tenant_id: tenantId, dining_area_id: id, is_active: true } });
    if (activeTables.length > 0) {
      throw new BadRequestException('Cannot archive section that contains active tables');
    }

    section.is_active = false;
    const saved = await this.areaRepo.save(section);
    await this.auditWriter.write({
      tenantId,
      actorType: 'ADMIN',
      action: 'DINING_SECTION_ARCHIVED',
      correlationId: correlationId || 'corr-section-arch',
      afterData: saved,
    });
    return saved;
  }

  async getTables(tenantId: string, query: { branchId?: string; areaId?: string; status?: string; q?: string }) {
    const qb = this.tableRepo.createQueryBuilder('t').where('t.tenant_id = :tenantId', { tenantId });

    if (query.areaId) qb.andWhere('t.dining_area_id = :areaId', { areaId: query.areaId });
    // A table carries no branch of its own; it belongs to one through its area. The
    // parameter was on this signature and never used, so a branch manager asking for
    // tables without naming an area was handed the whole chain's floor.
    if (query.branchId) {
      qb.andWhere(
        't.dining_area_id IN (SELECT a.id FROM dining_area a WHERE a.tenant_id = :tenantId AND a.branch_id = :branchId)',
        { tenantId, branchId: query.branchId },
      );
    }
    if (query.status) qb.andWhere('t.status = :status', { status: query.status });
    if (query.q) {
      qb.andWhere('(t.code ILIKE :q OR t.table_number ILIKE :q)', { q: `%${query.q}%` });
    }

    qb.andWhere('t.is_active = true');
    qb.orderBy('t.table_number', 'ASC');
    return await qb.getMany();
  }

  async createTable(tenantId: string, dto: CreateTableDto, correlationId?: string) {
    const table = this.tableRepo.create({
      tenant_id: tenantId,
      dining_area_id: dto.dining_area_id,
      code: dto.code.toUpperCase(),
      table_number: dto.table_number,
      seating_capacity: dto.seating_capacity || 4,
      shape: dto.shape || 'RECTANGLE',
      pos_x: dto.pos_x || 0,
      pos_y: dto.pos_y || 0,
      is_active: true,
    });
    const saved = await this.tableRepo.save(table);
    await this.auditWriter.write({
      tenantId,
      actorType: 'ADMIN',
      action: 'DINING_TABLE_CREATED',
      correlationId: correlationId || 'corr-table',
      afterData: saved,
    });
    return saved;
  }

  async updateTable(tenantId: string, id: string, dto: UpdateTableDto, correlationId?: string) {
    const table = await this.tableRepo.findOne({ where: { id, tenant_id: tenantId } });
    if (!table) throw new NotFoundException(`Table ${id} not found`);

    if (dto.dining_area_id !== undefined) table.dining_area_id = dto.dining_area_id;
    if (dto.code !== undefined) table.code = dto.code.toUpperCase();
    if (dto.table_number !== undefined) table.table_number = dto.table_number;
    if (dto.seating_capacity !== undefined) table.seating_capacity = dto.seating_capacity;
    if (dto.shape !== undefined) table.shape = dto.shape;
    if (dto.pos_x !== undefined) table.pos_x = dto.pos_x;
    if (dto.pos_y !== undefined) table.pos_y = dto.pos_y;
    if (dto.is_active !== undefined) table.is_active = dto.is_active;

    const saved = await this.tableRepo.save(table);
    await this.auditWriter.write({
      tenantId,
      actorType: 'ADMIN',
      action: 'DINING_TABLE_UPDATED',
      correlationId: correlationId || 'corr-table-upd',
      afterData: saved,
    });
    return saved;
  }

  async archiveTable(tenantId: string, id: string, correlationId?: string) {
    const table = await this.tableRepo.findOne({ where: { id, tenant_id: tenantId } });
    if (!table) throw new NotFoundException(`Table ${id} not found`);

    const activeSession = await this.sessionRepo.findOne({ where: { tenant_id: tenantId, table_id: id, closed_at: IsNull() } });
    if (activeSession) {
      throw new BadRequestException('Cannot archive table that is currently occupied');
    }

    table.is_active = false;
    const saved = await this.tableRepo.save(table);
    await this.auditWriter.write({
      tenantId,
      actorType: 'ADMIN',
      action: 'DINING_TABLE_ARCHIVED',
      correlationId: correlationId || 'corr-table-arch',
      afterData: saved,
    });
    return saved;
  }

  async getFloorPlan(tenantId: string, branchId?: string, sectionId?: string, status?: string) {
    const areas = await this.getSections(tenantId, branchId);
    let tableQuery = this.tableRepo.createQueryBuilder('t').where('t.tenant_id = :tenantId AND t.is_active = true', { tenantId });

    if (sectionId && sectionId !== 'ALL') {
      tableQuery = tableQuery.andWhere('t.dining_area_id = :sectionId', { sectionId });
    }
    // A table belongs to its branch through its section. Without this a branch's floor
    // listed every other branch's tables too, their open checks included.
    if (branchId) {
      const areaIds = areas.map((a: any) => a.id);
      tableQuery = areaIds.length
        ? tableQuery.andWhere('t.dining_area_id IN (:...areaIds)', { areaIds })
        : tableQuery.andWhere('1 = 0');
    }
    const tables = await tableQuery.orderBy('t.table_number', 'ASC').getMany();

    const activeSessions = await this.sessionRepo.find({ where: { tenant_id: tenantId, closed_at: IsNull() } });
    const sessionMap = new Map(activeSessions.map((s) => [s.table_id, s]));

    // Fetch active open dine-in orders to map live totals & numbers
    const activeOrders = await this.orderRepo.createQueryBuilder('o')
      .where('o.tenant_id = :tenantId', { tenantId })
      .andWhere('o.order_type = :type', { type: 'DINE_IN' })
      .andWhere('o.state IN (:...states)', { states: ['DRAFT', 'SUBMITTED', 'CONFIRMED', 'PREPARING', 'READY'] })
      .getMany();

    // A table can hold more than one open check (a second party, a split). Keying one order per
    // table showed whichever came last, and releasing the table then failed on a check the
    // floor never showed; every open check on the table is counted instead.
    const ordersByTable = new Map<string, OrderHeader[]>();
    for (const o of activeOrders.filter((ord) => ord.table_id)) {
      ordersByTable.set(o.table_id!, [...(ordersByTable.get(o.table_id!) || []), o]);
    }

    const now = new Date();
    const formattedTables = tables.map((t) => {
      const sess = sessionMap.get(t.id);
      const tableOrders = (ordersByTable.get(t.id) || []).sort(
        (a, b) => new Date(a.placed_at || 0).getTime() - new Date(b.placed_at || 0).getTime(),
      );
      const activeOrd = tableOrders[0];

      let tableStatus = 'AVAILABLE';
      let guestCount = 0;
      let elapsedTimeMinutes = 0;
      let orderId: string | null = null;
      let orderNumber: string | null = null;
      let grandTotal: string | null = null;

      if (activeOrd) {
        tableStatus = 'OCCUPIED';
        orderId = activeOrd.id;
        orderNumber = activeOrd.order_number;
        grandTotal = tableOrders.reduce((sum, o) => MoneyUtil.add(sum, o.grand_total || '0'), '0.0000');
        guestCount = activeOrd.guest_count || (sess ? sess.guest_count : 2);
      } else if (sess) {
        tableStatus = sess.status;
        guestCount = sess.guest_count;
        orderId = sess.active_order_id;
      }

      // A table session is written when guests are seated or a check is moved. An order rung
      // straight onto a table at the till makes no session at all, yet the table is shown
      // OCCUPIED because of that order — so timing it only off the session left exactly the
      // busiest tables reading 0 minutes all service. The order's own clock is the fallback.
      const startedAt = sess?.seated_at || activeOrd?.placed_at;
      if (startedAt) {
        const diffMs = now.getTime() - new Date(startedAt).getTime();
        elapsedTimeMinutes = Math.max(0, Math.floor(diffMs / 60000));
      }

      return {
        ...t,
        status: tableStatus,
        guest_count: guestCount,
        elapsed_minutes: elapsedTimeMinutes,
        active_order_id: orderId,
        order_number: orderNumber,
        grand_total: grandTotal,
        open_check_count: tableOrders.length,
        active_session_id: sess ? sess.id : null,
      };
    });

    const filtered = status ? formattedTables.filter((t) => t.status === status) : formattedTables;
    return { areas, tables: filtered };
  }

  async seatGuests(tenantId: string, tableId: string, guestCount: number, orderId?: string, correlationId?: string) {
    const table = await this.tableRepo.findOne({ where: { id: tableId, tenant_id: tenantId } });
    if (!table) throw new NotFoundException('Table not found');

    const existingSession = await this.sessionRepo.findOne({ where: { tenant_id: tenantId, table_id: tableId, closed_at: IsNull() } });
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

    const occ = this.occupancyRepo.create({
      tenant_id: tenantId,
      table_id: tableId,
      order_id: orderId || undefined,
      event_type: 'SEAT',
      guest_count: guestCount || 2,
    });
    await this.occupancyRepo.save(occ);

    await this.auditWriter.write({
      tenantId,
      actorType: 'ADMIN',
      action: 'TABLE_SEATED',
      correlationId: correlationId || 'corr-seat',
      afterData: savedSession,
    });

    return savedSession;
  }

  async moveTable(
    tenantId: string,
    orderId: string,
    targetTableId: string,
    guestCount?: number,
    userId?: string,
    correlationId?: string,
  ) {
    return await this.dataSource.transaction(async (em) => {
      // Fetch order to determine source table
      const order = await em.findOne(OrderHeader, { where: { id: orderId, tenant_id: tenantId } });
      if (!order) throw new NotFoundException(`Order ${orderId} not found`);

      if (['COMPLETED', 'CANCELLED'].includes(order.state)) {
        throw new BadRequestException(`Cannot move table for order in state ${order.state}`);
      }

      const sourceTableId = order.table_id;

      // Lock source table, target table, and order in sorted UUID order
      const lockIds = Array.from(new Set([sourceTableId, targetTableId, orderId].filter(Boolean) as string[])).sort();
      for (const id of lockIds) {
        if (id === orderId) {
          await em.findOne(OrderHeader, { where: { id, tenant_id: tenantId }, lock: { mode: 'pessimistic_write' } });
        } else {
          await em.findOne(DiningTable, { where: { id, tenant_id: tenantId }, lock: { mode: 'pessimistic_write' } });
        }
      }

      const targetTable = await em.findOne(DiningTable, { where: { id: targetTableId, tenant_id: tenantId } });
      if (!targetTable || !targetTable.is_active) {
        throw new NotFoundException(`Target table ${targetTableId} not found or inactive`);
      }

      // Reassign order table
      order.table_id = targetTableId;
      order.table_number = targetTable.table_number;
      if (guestCount) order.guest_count = guestCount;
      const updatedOrder = await em.save(OrderHeader, order);

      // Manage sessions. The party moves with the check: its head count and the time it sat
      // down go to the new table, instead of resetting to two guests seated just now.
      let sourceSession: TableSession | null = null;
      if (sourceTableId && sourceTableId !== targetTableId) {
        sourceSession = await em.findOne(TableSession, { where: { tenant_id: tenantId, table_id: sourceTableId, closed_at: IsNull() } });
        if (sourceSession) {
          sourceSession.closed_at = new Date();
          sourceSession.status = 'AVAILABLE';
          await em.save(TableSession, sourceSession);
        }
      }

      let targetSession = await em.findOne(TableSession, { where: { tenant_id: tenantId, table_id: targetTableId, closed_at: IsNull() } });
      if (!targetSession) {
        targetSession = em.create(TableSession, {
          tenant_id: tenantId,
          table_id: targetTableId,
          active_order_id: order.id,
          status: 'OCCUPIED',
          guest_count: order.guest_count || sourceSession?.guest_count || 2,
          seated_at: sourceSession?.seated_at || new Date(),
        });
      } else {
        targetSession.active_order_id = order.id;
        targetSession.status = 'OCCUPIED';
      }
      await em.save(TableSession, targetSession);

      // Record Occupancy Event
      const occ = em.create(TableOccupancyEvent, {
        tenant_id: tenantId,
        table_id: targetTableId,
        from_table_id: sourceTableId || undefined,
        order_id: order.id,
        event_type: 'MOVE',
        guest_count: targetSession.guest_count,
        occurred_by: userId || null,
      });
      await em.save(TableOccupancyEvent, occ);

      await this.auditWriter.write({
        tenantId,
        actorType: userId ? 'ADMIN' : 'SYSTEM',
        actorId: userId,
        action: 'DINING_TABLE_MOVED',
        entityType: 'Order',
        entityId: orderId,
        correlationId: correlationId || 'corr-move-tbl',
        details: { sourceTableId, targetTableId },
      });

      return updatedOrder;
    });
  }

  async mergeOrders(tenantId: string, dto: MergeOrdersDto, userId?: string, correlationId?: string) {
    return await this.dataSource.transaction(async (em) => {
      if (!dto.sourceOrderIds || dto.sourceOrderIds.length === 0) {
        throw new BadRequestException('At least one source order ID must be provided to merge');
      }

      if (dto.sourceOrderIds.includes(dto.targetOrderId)) {
        throw new BadRequestException('Source order IDs cannot contain the target order ID');
      }

      const allOrderIds = Array.from(new Set([...dto.sourceOrderIds, dto.targetOrderId]));

      // Lock all orders and tables in sorted UUID order
      const sortedOrderIds = [...allOrderIds].sort();
      for (const id of sortedOrderIds) {
        await em.findOne(OrderHeader, { where: { id, tenant_id: tenantId }, lock: { mode: 'pessimistic_write' } });
      }

      const targetOrder = await em.findOne(OrderHeader, {
        where: { id: dto.targetOrderId, tenant_id: tenantId },
        relations: ['items', 'items.options'],
      });
      if (!targetOrder) throw new NotFoundException(`Target order ${dto.targetOrderId} not found`);

      if (['COMPLETED', 'CANCELLED'].includes(targetOrder.state)) {
        throw new BadRequestException(`Target order is in unmergeable state ${targetOrder.state}`);
      }

      const sourceOrders: OrderHeader[] = [];
      for (const sId of dto.sourceOrderIds) {
        const sOrd = await em.findOne(OrderHeader, {
          where: { id: sId, tenant_id: tenantId },
          relations: ['items', 'items.options'],
        });
        if (!sOrd) throw new NotFoundException(`Source order ${sId} not found`);
        if (sOrd.branch_id !== targetOrder.branch_id || sOrd.currency_code !== targetOrder.currency_code) {
          throw new BadRequestException(`Source order ${sId} branch/currency does not match target order`);
        }
        if (['COMPLETED', 'CANCELLED'].includes(sOrd.state)) {
          throw new BadRequestException(`Source order ${sId} is in unmergeable state ${sOrd.state}`);
        }
        sourceOrders.push(sOrd);
      }

      let lineNo = (targetOrder.items || []).length + 1;
      for (const sOrd of sourceOrders) {
        // Move the lines with a plain UPDATE and drop the loaded relation. Saving the source
        // header while `items` still held these lines let TypeORM's cascade write each one
        // straight back onto the order being cancelled, so the merged table's food left
        // every bill.
        for (const item of sOrd.items || []) {
          await em.update(OrderItem, { id: item.id, tenant_id: tenantId }, { order_id: targetOrder.id, line_number: lineNo++ });
        }
        delete (sOrd as Partial<OrderHeader>).items;

        // Create OrderLink 'MERGE'
        const link = em.create(OrderLink, {
          tenant_id: tenantId,
          from_order_id: sOrd.id,
          to_order_id: targetOrder.id,
          link_type: 'MERGE',
          details: { reason: dto.reason || 'Merged orders' },
        });
        await em.save(OrderLink, link);

        // Cancel source order
        const fromState = sOrd.state;
        sOrd.state = 'CANCELLED';
        sOrd.status = 'CANCELLED';
        sOrd.subtotal = '0.0000';
        sOrd.subtotal_amount = '0.0000';
        sOrd.tax_total = '0.0000';
        sOrd.tax_amount = '0.0000';
        sOrd.grand_total = '0.0000';
        sOrd.total_amount = '0.0000';
        sOrd.outstanding_total = '0.0000';
        sOrd.due_amount = '0.0000';
        await em.save(OrderHeader, sOrd);

        const stateEvt = em.create(OrderStateEvent, {
          tenant_id: tenantId,
          order_id: sOrd.id,
          from_state: fromState,
          to_state: 'CANCELLED',
          action: 'MERGE_CANCEL',
          reason_text: `Merged into order #${targetOrder.order_number}`,
          occurred_by: userId || null,
        });
        await em.save(OrderStateEvent, stateEvt);

        // Release source table if present
        if (sOrd.table_id) {
          const sess = await em.findOne(TableSession, { where: { tenant_id: tenantId, table_id: sOrd.table_id, closed_at: IsNull() } });
          if (sess) {
            sess.closed_at = new Date();
            sess.status = 'AVAILABLE';
            await em.save(TableSession, sess);
          }
        }
      }

      // Re-parent source order payments and allocations to target order
      const sourcePayments = await em.find(Payment, { where: { order_id: In(dto.sourceOrderIds), tenant_id: tenantId } });
      for (const p of sourcePayments) {
        p.order_id = targetOrder.id;
        await em.save(Payment, p);
      }
      const sourceAllocations = await em.find(PaymentAllocation, { where: { order_id: In(dto.sourceOrderIds), tenant_id: tenantId } });
      for (const a of sourceAllocations) {
        a.order_id = targetOrder.id;
        await em.save(PaymentAllocation, a);
      }

      // Requote & recalculate target order totals
      // Voided and replaced lines stay on the order for the record but never reach the money,
      // and the tax has to be worked out again over everything the table now owes — carrying
      // the target's old tax_total forward left the merged-in food untaxed.
      delete (targetOrder as Partial<OrderHeader>).items;
      const freshTargetItems = await em.find(OrderItem, { where: { order_id: targetOrder.id, tenant_id: tenantId, state: 'ACTIVE' } });
      const productIds = [...new Set(freshTargetItems.map((i) => i.product_id).filter(Boolean))];
      const taxRateById = new Map<string, string>();
      if (productIds.length > 0) {
        const products = await em.find(Product, { where: { id: In(productIds) } });
        products.forEach((p) => taxRateById.set(p.id, p.tax_rate || '0.0000'));
      }

      let subtotal = '0.0000';
      let modifierTotal = '0.0000';
      let taxTotal = '0.0000';

      for (const item of freshTargetItems) {
        const lineBase = MoneyUtil.multiply(item.unit_price, item.quantity);
        item.base_total = lineBase;
        item.line_total = MoneyUtil.add(lineBase, item.modifier_total || '0.0000');
        subtotal = MoneyUtil.add(subtotal, item.line_total);
        modifierTotal = MoneyUtil.add(modifierTotal, item.modifier_total || '0.0000');
        taxTotal = MoneyUtil.add(taxTotal, MoneyUtil.multiply(item.line_total, taxRateById.get(item.product_id) || '0.0000'));
        await em.save(OrderItem, item);
      }

      targetOrder.subtotal = subtotal;
      targetOrder.subtotal_amount = subtotal;
      targetOrder.modifier_total = modifierTotal;
      targetOrder.tax_total = taxTotal;
      targetOrder.tax_amount = taxTotal;

      const netBeforeTax = MoneyUtil.subtract(
        MoneyUtil.add(MoneyUtil.add(targetOrder.subtotal, targetOrder.packaging_total || '0.0000'), targetOrder.delivery_fee || '0.0000'),
        targetOrder.discount_total || '0.0000',
      );
      const grandTotal = MoneyUtil.add(netBeforeTax, taxTotal);
      targetOrder.grand_total = MoneyUtil.greaterThan(grandTotal, '0.0000') ? grandTotal : '0.0000';
      targetOrder.total_amount = targetOrder.grand_total;

      // Compute total paid from all succeeded payments linked to target order
      const allTargetPayments = await em.find(Payment, {
        where: [
          { order_id: targetOrder.id, tenant_id: tenantId, status: 'SUCCEEDED' },
          { order_id: targetOrder.id, tenant_id: tenantId, status: 'COMPLETED' as any },
        ],
      });
      let targetPaid = '0.0000';
      for (const p of allTargetPayments) {
        targetPaid = MoneyUtil.add(targetPaid, p.amount || '0.0000');
      }
      targetOrder.paid_total = targetPaid;
      targetOrder.paid_amount = targetPaid;

      const outstanding = MoneyUtil.subtract(targetOrder.grand_total, targetOrder.paid_total);
      targetOrder.outstanding_total = MoneyUtil.greaterThan(outstanding, '0.0000') ? outstanding : '0.0000';
      targetOrder.due_amount = targetOrder.outstanding_total;
      targetOrder.quote_version = String(Date.now());

      const savedTarget = await em.save(OrderHeader, targetOrder);

      // Record Occupancy Event
      if (targetOrder.table_id) {
        const occ = em.create(TableOccupancyEvent, {
          tenant_id: tenantId,
          table_id: targetOrder.table_id,
          order_id: targetOrder.id,
          event_type: 'MERGE',
          guest_count: targetOrder.guest_count || 2,
          occurred_by: userId || null,
          details: { sourceOrderIds: dto.sourceOrderIds, reason: dto.reason },
        });
        await em.save(TableOccupancyEvent, occ);
      }

      await this.auditWriter.write({
        tenantId,
        actorType: userId ? 'ADMIN' : 'SYSTEM',
        actorId: userId,
        action: 'DINING_ORDERS_MERGED',
        entityType: 'Order',
        entityId: targetOrder.id,
        correlationId: correlationId || 'corr-merge-orders',
        details: { sourceOrderIds: dto.sourceOrderIds, reason: dto.reason },
      });

      return savedTarget;
    });
  }

  async releaseTable(tenantId: string, tableId: string, nextStatus?: 'AVAILABLE' | 'CLEANING', correlationId?: string, userId?: string) {
    const result = await this.dataSource.transaction(async (em) => {
      const table = await em.findOne(DiningTable, { where: { id: tableId, tenant_id: tenantId } });
      if (!table) throw new NotFoundException('Table not found');

      // getFloorPlan() treats a table as OCCUPIED whenever an order in one of these
      // states is linked to it, regardless of the table_session row below. Releasing
      // the table must therefore resolve that order, not just close the session.
      const activeOrder = await em
        .createQueryBuilder(OrderHeader, 'o')
        .setLock('pessimistic_write')
        .where('o.tenant_id = :tenantId', { tenantId })
        .andWhere('o.table_id = :tableId', { tableId })
        .andWhere('o.state IN (:...states)', { states: ['DRAFT', 'SUBMITTED', 'CONFIRMED', 'PREPARING', 'READY'] })
        .getOne();

      if (activeOrder) {
        const outstanding = activeOrder.outstanding_total || '0.0000';
        if (MoneyUtil.greaterThan(outstanding, '0.0000')) {
          throw new BadRequestException(
            `Cannot release table: order ${activeOrder.order_number} still has an outstanding balance of ${outstanding}`,
          );
        }
        const fromState = activeOrder.state;
        activeOrder.state = 'COMPLETED';
        activeOrder.status = 'COMPLETED';
        activeOrder.completed_at = new Date();
        await em.save(OrderHeader, activeOrder);
        // A check closed by freeing its table gets the same history, sync event and loyalty
        // cashback as one completed at the till.
        await this.transitionRecorder.record(em, {
          tenantId,
          order: activeOrder,
          fromState,
          action: 'COMPLETE',
          userId,
          correlationId,
          reasonText: 'Table released',
        });
      }

      const session = await em.findOne(TableSession, { where: { tenant_id: tenantId, table_id: tableId, closed_at: IsNull() } });
      if (session) {
        session.closed_at = new Date();
        session.status = nextStatus || 'AVAILABLE';
        await em.save(TableSession, session);
      }

      const occ = em.create(TableOccupancyEvent, {
        tenant_id: tenantId,
        table_id: tableId,
        event_type: 'RELEASE',
        details: { nextStatus: nextStatus || 'AVAILABLE', releasedOrderId: activeOrder?.id || null },
      });
      await em.save(TableOccupancyEvent, occ);

      return { releasedOrderId: activeOrder?.id || null };
    });

    await this.auditWriter.write({
      tenantId,
      actorType: userId ? 'ADMIN' : 'SYSTEM',
      actorId: userId,
      action: 'TABLE_RELEASED',
      correlationId: correlationId || 'corr-release',
      details: { tableId, nextStatus: nextStatus || 'AVAILABLE', completedOrderId: result.releasedOrderId },
    });

    return { success: true, tableId, ...result };
  }
}
