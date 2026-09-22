import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';
import { Subject, Observable } from 'rxjs';
import { map } from 'rxjs/operators';

import { KitchenStation } from '../../entities/KitchenStation.entity';
import { KdsScreen } from '../../entities/KdsScreen.entity';
import { KdsRoutingRule } from '../../entities/KdsRoutingRule.entity';
import { KitchenTicket } from '../../entities/KitchenTicket.entity';
import { KitchenTicketItem } from '../../entities/KitchenTicketItem.entity';
import { KdsEvent } from '../../entities/KdsEvent.entity';
import { Printer } from '../../entities/Printer.entity';
import { OrderHeader } from '../../entities/OrderHeader.entity';
import { Product } from '../../entities/Product.entity';
import { AuditWriter } from '../audit/audit-writer.service';
import { OrderTransitionRecorder } from '../order-lifecycle/order-transition-recorder.service';

/**
 * Open orders that starting a ticket moves to PREPARING. KITCHEN_PREPARING is the legacy
 * status a Snappfood accept leaves beside a CONFIRMED state.
 */
const ORDER_STATES_KITCHEN_CAN_START: string[] = ['SUBMITTED', 'CONFIRMED', 'KITCHEN_PREPARING'];

/** Open orders that bumping the last ticket moves to READY. */
const ORDER_STATES_KITCHEN_CAN_READY: string[] = [...ORDER_STATES_KITCHEN_CAN_START, 'PREPARING'];

export interface MessageEvent {
  data: string | object;
  id?: string;
  type?: string;
  retry?: number;
}

@Injectable()
export class KdsService {
  private eventSubject = new Subject<{ type: string; payload: any }>();

  constructor(
    @InjectRepository(KitchenStation) private readonly stationRepo: Repository<KitchenStation>,
    @InjectRepository(KdsScreen) private readonly screenRepo: Repository<KdsScreen>,
    @InjectRepository(KdsRoutingRule) private readonly ruleRepo: Repository<KdsRoutingRule>,
    @InjectRepository(KitchenTicket) private readonly ticketRepo: Repository<KitchenTicket>,
    @InjectRepository(KitchenTicketItem) private readonly itemRepo: Repository<KitchenTicketItem>,
    @InjectRepository(KdsEvent) private readonly kdsEventRepo: Repository<KdsEvent>,
    @InjectRepository(Printer) private readonly printerRepo: Repository<Printer>,
    @InjectRepository(OrderHeader) private readonly orderRepo: Repository<OrderHeader>,
    @InjectRepository(Product) private readonly productRepo: Repository<Product>,
    private readonly auditWriter: AuditWriter,
    private readonly transitionRecorder: OrderTransitionRecorder,
  ) {}

  // SSE Stream
  getEventStream(): Observable<MessageEvent> {
    return this.eventSubject.asObservable().pipe(
      map((evt) => ({
        type: evt.type,
        data: evt.payload,
      })),
    );
  }

  // 1. Stations CRUD
  async getStations(tenantId: string, branchId?: string) {
    const where: any = { tenant_id: tenantId };
    if (branchId) where.branch_id = branchId;
    return await this.stationRepo.find({ where, order: { name: 'ASC' } });
  }

  async createStation(tenantId: string, data: { branch_id?: string; code: string; name: string; station_type?: string; target_minutes?: number }, correlationId?: string) {
    const station = this.stationRepo.create({
      tenant_id: tenantId,
      branch_id: data.branch_id || null,
      code: (data.code || 'ST-1').toUpperCase(),
      name: data.name,
      station_type: data.station_type || 'HOT_KITCHEN',
      target_minutes: data.target_minutes || 10,
      is_active: true,
    });
    const saved = await this.stationRepo.save(station);
    await this.auditWriter.write({
      tenantId,
      actorType: 'ADMIN',
      action: 'KITCHEN_STATION_CREATED',
      correlationId: correlationId || 'corr-st',
      afterData: saved,
    });
    return saved;
  }

  async updateStation(tenantId: string, id: string, data: any) {
    const station = await this.stationRepo.findOne({ where: { id, tenant_id: tenantId } });
    if (!station) throw new NotFoundException('Station not found');
    Object.assign(station, data);
    return await this.stationRepo.save(station);
  }

  async deleteStation(tenantId: string, id: string) {
    await this.stationRepo.softDelete({ id, tenant_id: tenantId });
    return { success: true };
  }

  // 2. Screens CRUD
  async getScreens(tenantId: string, branchId?: string) {
    const where: any = { tenant_id: tenantId };
    if (branchId) where.branch_id = branchId;
    return await this.screenRepo.find({ where, order: { name: 'ASC' } });
  }

  async createScreen(tenantId: string, data: { branch_id: string; terminal_id?: string; code: string; name: string; station_ids?: string[] }) {
    const screen = this.screenRepo.create({
      tenant_id: tenantId,
      branch_id: data.branch_id,
      terminal_id: data.terminal_id || null,
      code: data.code.toUpperCase(),
      name: data.name,
      station_ids: data.station_ids || [],
      is_active: true,
    });
    return await this.screenRepo.save(screen);
  }

  async updateScreen(tenantId: string, id: string, data: any) {
    const screen = await this.screenRepo.findOne({ where: { id, tenant_id: tenantId } });
    if (!screen) throw new NotFoundException('Screen not found');
    Object.assign(screen, data);
    return await this.screenRepo.save(screen);
  }

  async deleteScreen(tenantId: string, id: string) {
    await this.screenRepo.softDelete({ id, tenant_id: tenantId });
    return { success: true };
  }

  // 3. Routing Rules CRUD
  async getRoutingRules(tenantId: string, branchId?: string) {
    const where: any = { tenant_id: tenantId };
    if (branchId) where.branch_id = branchId;
    return await this.ruleRepo.find({ where, order: { priority: 'DESC' } });
  }

  async createRoutingRule(tenantId: string, data: { branch_id: string; station_id: string; product_id?: string; category_id?: string; priority?: number }) {
    if ((!data.product_id && !data.category_id) || (data.product_id && data.category_id)) {
      throw new BadRequestException('Routing rule must specify exactly one of product_id or category_id');
    }

    const rule = this.ruleRepo.create({
      tenant_id: tenantId,
      branch_id: data.branch_id,
      station_id: data.station_id,
      product_id: data.product_id || null,
      category_id: data.category_id || null,
      priority: data.priority || 0,
    });
    return await this.ruleRepo.save(rule);
  }

  async deleteRoutingRule(tenantId: string, id: string) {
    await this.ruleRepo.softDelete({ id, tenant_id: tenantId });
    return { success: true };
  }

  // 4. Ticket Generation with Product > Category > Station routing engine
  async generateTicketsForOrder(tenantId: string, orderId: string, correlationId?: string) {
    const order = await this.orderRepo.findOne({
      where: { id: orderId, tenant_id: tenantId },
      relations: ['items', 'items.options'],
    });
    if (!order) throw new NotFoundException('Order not found');

    const rules = await this.ruleRepo.find({
      where: { tenant_id: tenantId, branch_id: order.branch_id },
      order: { priority: 'DESC' },
    });

    let defaultStation = await this.stationRepo.findOne({ where: { tenant_id: tenantId, branch_id: order.branch_id, is_active: true } });
    if (!defaultStation) {
      defaultStation = await this.stationRepo.findOne({ where: { tenant_id: tenantId, is_active: true } });
    }
    if (!defaultStation) {
      defaultStation = await this.createStation(tenantId, { branch_id: order.branch_id, code: 'MAIN-KITCHEN', name: 'Main Kitchen' }, correlationId);
    }

    // Group items by routed station ID
    const itemsByStation = new Map<string, typeof order.items>();

    // Voided and superseded lines must never reach a station. This routine is
    // re-run after an edit to fire newly appended lines, so without the filter
    // a line struck off before it was ever fired would be sent to the kitchen.
    const routableItems = (order.items || []).filter((i) => (i.state || 'ACTIVE') === 'ACTIVE');

    for (const item of routableItems) {
      let targetStationId = defaultStation.id;

      // Check product rule match first
      const prodRule = rules.find((r) => r.product_id && r.product_id === item.product_id);
      if (prodRule) {
        targetStationId = prodRule.station_id;
      } else {
        // Check category rule match by looking up product category
        const categoryRules = rules.filter((r) => !!r.category_id);
        if (categoryRules.length > 0 && item.product_id) {
          const product = await this.productRepo.findOne({
            where: { id: item.product_id, tenant_id: tenantId },
          });
          if (product && product.category_id) {
            const catRule = categoryRules.find((r) => r.category_id === product.category_id);
            if (catRule) {
              targetStationId = catRule.station_id;
            }
          }
        }
      }

      if (!itemsByStation.has(targetStationId)) {
        itemsByStation.set(targetStationId, []);
      }
      itemsByStation.get(targetStationId)!.push(item);
    }

    const createdTickets = [];

    for (const [stationId, items] of itemsByStation.entries()) {
      // Idempotent ticket lookup
      let ticket = await this.ticketRepo.findOne({
        where: { tenant_id: tenantId, order_id: order.id, station_id: stationId },
      });

      if (!ticket) {
        const ticketCount = await this.ticketRepo.count({ where: { tenant_id: tenantId } });
        const ticketNumber = `K-${(ticketCount + 101).toString()}`;
        const isAggregator = order.channel === 'AGGREGATOR' || order.channel === 'SNAPPFOOD';

        ticket = this.ticketRepo.create({
          tenant_id: tenantId,
          branch_id: order.branch_id,
          order_id: order.id,
          station_id: stationId,
          ticket_number: ticketNumber,
          state: 'NEW',
          status: 'NEW',
          priority: 0,
          is_aggregator: isAggregator,
          prep_time_seconds: 0,
        });
        ticket = await this.ticketRepo.save(ticket);

        // Record event
        await this.recordKdsEvent(tenantId, ticket.id, null, 'NEW', 'CREATE', null);
      }

      for (const item of items) {
        let ticketItem = await this.itemRepo.findOne({
          where: { tenant_id: tenantId, ticket_id: ticket.id, order_item_id: item.id },
        });

        if (!ticketItem) {
          const optsSummary = item.options ? item.options.map((o) => o.option_item_name).join(', ') : '';
          ticketItem = this.itemRepo.create({
            tenant_id: tenantId,
            ticket_id: ticket.id,
            order_item_id: item.id,
            product_name: item.product_name,
            quantity: item.quantity,
            state: 'NEW',
            status: 'NEW',
            special_instructions: item.special_instructions || null,
            options_summary: optsSummary || null,
          });
          await this.itemRepo.save(ticketItem);
        }
      }

      createdTickets.push(ticket);
    }

    this.eventSubject.next({ type: 'TICKETS_CREATED', payload: { orderId: order.id } });
    return createdTickets;
  }

  // 5. KDS Board Query
  async getKdsBoard(tenantId: string, branchId: string, stationIds?: string[], state?: string) {
    const where: any = { tenant_id: tenantId };
    if (branchId) where.branch_id = branchId;
    if (stationIds && stationIds.length > 0) where.station_id = In(stationIds);
    if (state) {
      where.state = state;
    } else {
      where.state = In(['NEW', 'IN_PROGRESS', 'READY', 'RECALLED']);
    }

    const tickets = await this.ticketRepo.find({ where, order: { priority: 'DESC', created_at: 'ASC' }, take: 500 });
    const now = new Date();

    const result = [];
    for (const t of tickets) {
      const items = await this.itemRepo.find({ where: { tenant_id: tenantId, ticket_id: t.id } });
      const order = await this.orderRepo.findOne({ where: { id: t.order_id } });
      const station = await this.stationRepo.findOne({ where: { id: t.station_id } });
      const elapsedSeconds = Math.floor((now.getTime() - new Date(t.created_at).getTime()) / 1000);

      result.push({
        ...t,
        station_name: station ? station.name : 'Kitchen Station',
        target_minutes: station ? station.target_minutes : 10,
        order_number: order ? order.order_number : 'ORD-00',
        call_number: order?.call_number ?? null,
        order_type: order ? order.order_type : 'DINE_IN',
        table_number: order ? order.table_number : null,
        customer_name: order ? order.customer_id : null,
        prep_time_seconds: elapsedSeconds,
        items,
      });
    }

    return result;
  }

  async getKdsTickets(tenantId: string, stationId?: string, isBumped?: boolean, branchId?: string) {
    // Auto-generate tickets for active orders without kitchen tickets
    const activeOrders = await this.orderRepo.find({
      where: { tenant_id: tenantId, status: In(['SUBMITTED', 'CONFIRMED', 'KITCHEN_PREPARING']) },
    });
    for (const order of activeOrders) {
      const existing = await this.ticketRepo.findOne({ where: { tenant_id: tenantId, order_id: order.id } });
      if (!existing) {
        await this.generateTicketsForOrder(tenantId, order.id, 'auto-kds-sync');
      }
    }

    const where: any = { tenant_id: tenantId };
    // Without this a kitchen display showed every kitchen in the chain.
    if (branchId) where.branch_id = branchId;
    if (stationId && stationId !== 'ALL') where.station_id = stationId;

    if (isBumped) {
      where.state = In(['READY', 'BUMPED']);
    } else {
      where.state = In(['NEW', 'IN_PROGRESS', 'RECALLED']);
    }

    const tickets = await this.ticketRepo.find({ where, order: { created_at: 'ASC' } });
    const now = new Date();

    const ticketsWithItems = [];
    for (const t of tickets) {
      const items = await this.itemRepo.find({ where: { tenant_id: tenantId, ticket_id: t.id } });
      const order = await this.orderRepo.findOne({ where: { id: t.order_id } });
      const station = await this.stationRepo.findOne({ where: { id: t.station_id } });
      const elapsedSeconds = Math.floor((now.getTime() - new Date(t.created_at).getTime()) / 1000);

      ticketsWithItems.push({
        ...t,
        station_name: station ? station.name : 'Kitchen Station',
        target_minutes: station ? station.target_minutes : 10,
        order_number: order ? order.order_number : 'ORD-00',
        call_number: order?.call_number ?? null,
        order_type: order ? order.order_type : 'DINE_IN',
        table_number: order ? order.table_number : null,
        prep_time_seconds: elapsedSeconds,
        items,
      });
    }

    return ticketsWithItems;
  }

  // 6. Ticket Actions: Start, Bump, Recall, Priority
  async startTicket(tenantId: string, ticketId: string, userId?: string) {
    const ticket = await this.ticketRepo.findOne({ where: { id: ticketId, tenant_id: tenantId } });
    if (!ticket) throw new NotFoundException('Kitchen ticket not found');

    const fromState = ticket.state;
    ticket.state = 'IN_PROGRESS';
    ticket.status = 'IN_PROGRESS';
    ticket.started_at = new Date();
    const saved = await this.ticketRepo.save(ticket);

    // Update items to IN_PROGRESS
    const items = await this.itemRepo.find({ where: { tenant_id: tenantId, ticket_id: ticketId } });
    for (const it of items) {
      it.state = 'IN_PROGRESS';
      it.status = 'IN_PROGRESS';
      await this.itemRepo.save(it);
    }

    await this.recordKdsEvent(tenantId, ticketId, fromState, 'IN_PROGRESS', 'START', userId);

    // The cook has the order now, so removing items from it needs a manager PIN from here on.
    const order = await this.orderRepo.findOne({ where: { id: ticket.order_id, tenant_id: tenantId } });
    if (order && ORDER_STATES_KITCHEN_CAN_START.includes(order.state || order.status)) {
      await this.moveOrder(tenantId, order, 'PREPARING', 'START_PREPARATION', userId);
    }

    this.eventSubject.next({ type: 'TICKET_UPDATED', payload: { ticketId } });
    return saved;
  }

  async bumpTicket(tenantId: string, ticketId: string, correlationId?: string, userId?: string) {
    const ticket = await this.ticketRepo.findOne({ where: { id: ticketId, tenant_id: tenantId } });
    if (!ticket) throw new NotFoundException('Kitchen ticket not found');

    const fromState = ticket.state;
    ticket.state = 'READY';
    ticket.status = 'READY';
    ticket.bumped_at = new Date();
    ticket.ready_at = new Date();
    const saved = await this.ticketRepo.save(ticket);

    // Update items to READY. A voided item stays CANCELLED: bumping must not turn food
    // that was struck off into food the pass should hand out.
    const items = await this.itemRepo.find({ where: { tenant_id: tenantId, ticket_id: ticketId } });
    for (const it of items) {
      if (it.state === 'CANCELLED') continue;
      it.state = 'READY';
      it.status = 'DONE';
      await this.itemRepo.save(it);
    }

    await this.recordKdsEvent(tenantId, ticketId, fromState, 'READY', 'BUMP', userId);

    // Order readiness roll-up check
    await this.checkOrderReadinessRollup(tenantId, ticket.order_id, userId);

    this.eventSubject.next({ type: 'TICKET_UPDATED', payload: { ticketId } });
    return saved;
  }

  async recallTicket(tenantId: string, ticketId: string, correlationId?: string, userId?: string) {
    const ticket = await this.ticketRepo.findOne({ where: { id: ticketId, tenant_id: tenantId } });
    if (!ticket) throw new NotFoundException('Kitchen ticket not found');

    const fromState = ticket.state;
    ticket.state = 'IN_PROGRESS';
    ticket.status = 'IN_PROGRESS';
    ticket.bumped_at = null as any;
    ticket.ready_at = null as any;
    const saved = await this.ticketRepo.save(ticket);

    await this.recordKdsEvent(tenantId, ticketId, fromState, 'IN_PROGRESS', 'RECALL', userId);
    this.eventSubject.next({ type: 'TICKET_UPDATED', payload: { ticketId } });
    return saved;
  }

  async setTicketPriority(tenantId: string, ticketId: string, priority: number, userId?: string) {
    const ticket = await this.ticketRepo.findOne({ where: { id: ticketId, tenant_id: tenantId } });
    if (!ticket) throw new NotFoundException('Kitchen ticket not found');

    ticket.priority = Math.min(9, Math.max(0, priority));
    const saved = await this.ticketRepo.save(ticket);

    await this.recordKdsEvent(tenantId, ticketId, ticket.state, ticket.state, 'PRIORITY_CHANGE', userId, { priority });
    this.eventSubject.next({ type: 'TICKET_UPDATED', payload: { ticketId } });
    return saved;
  }

  async updateItemStatus(tenantId: string, itemId: string, status: string, userId?: string) {
    const item = await this.itemRepo.findOne({ where: { id: itemId, tenant_id: tenantId } });
    if (!item) throw new NotFoundException('Ticket item not found');

    item.state = status;
    item.status = status === 'READY' ? 'DONE' : status;
    const saved = await this.itemRepo.save(item);

    // Check if all items in ticket are ready
    const allItems = await this.itemRepo.find({ where: { tenant_id: tenantId, ticket_id: item.ticket_id } });
    const allReady = allItems.every((i) => i.state === 'READY' || i.state === 'CANCELLED');
    if (allReady) {
      await this.bumpTicket(tenantId, item.ticket_id, 'auto-item-bump', userId);
    }

    return saved;
  }

  /**
   * Retract a line the cashier voided. Without this the kitchen keeps cooking
   * food that is no longer on the order and no longer being paid for.
   *
   * The ticket item is cancelled rather than deleted so the station still shows
   * what was pulled and the ticket history stays intact. Cancelling the last
   * outstanding item on a ticket bumps it, which the existing readiness rollup
   * already treats as done.
   */
  async cancelTicketItemsForOrderItem(tenantId: string, orderItemId: string, userId?: string) {
    const ticketItems = await this.itemRepo.find({
      where: { tenant_id: tenantId, order_item_id: orderItemId },
    });

    for (const ticketItem of ticketItems) {
      if (ticketItem.state === 'CANCELLED') continue;

      const fromState = ticketItem.state;
      ticketItem.state = 'CANCELLED';
      ticketItem.status = 'CANCELLED';
      await this.itemRepo.save(ticketItem);

      await this.recordKdsEvent(
        tenantId,
        ticketItem.ticket_id,
        fromState,
        'CANCELLED',
        'ITEM_VOIDED',
        userId,
        { orderItemId },
      );

      const siblings = await this.itemRepo.find({
        where: { tenant_id: tenantId, ticket_id: ticketItem.ticket_id },
      });
      const nothingLeftToCook = siblings.every(
        (i) => i.state === 'READY' || i.state === 'CANCELLED',
      );
      if (nothingLeftToCook) {
        await this.bumpTicket(tenantId, ticketItem.ticket_id, 'auto-void-bump', userId);
      }

      this.eventSubject.next({ type: 'TICKET_UPDATED', payload: { ticketId: ticketItem.ticket_id } });
    }

    return { cancelled: ticketItems.length };
  }

  private async recordKdsEvent(tenantId: string, ticketId: string, fromState: string | null, toState: string, action: string, userId?: string, details?: any) {
    const evt = this.kdsEventRepo.create({
      tenant_id: tenantId,
      ticket_id: ticketId,
      from_state: fromState || null,
      to_state: toState,
      action,
      occurred_by: userId || null,
      details: details || null,
    });
    await this.kdsEventRepo.save(evt);
  }

  private async checkOrderReadinessRollup(tenantId: string, orderId: string, userId?: string) {
    const tickets = await this.ticketRepo.find({ where: { tenant_id: tenantId, order_id: orderId } });
    const allReady = tickets.length > 0 && tickets.every((t) => t.state === 'READY' || t.state === 'CANCELLED');

    if (allReady) {
      const order = await this.orderRepo.findOne({ where: { id: orderId, tenant_id: tenantId } });
      if (order && ORDER_STATES_KITCHEN_CAN_READY.includes(order.state || order.status)) {
        await this.moveOrder(tenantId, order, 'READY', 'MARK_READY', userId);
      }
    }
  }

  /**
   * Moves the order the kitchen is working on, with the history row, outbox event and audit
   * entry a transition through the order service would leave.
   */
  private async moveOrder(tenantId: string, order: OrderHeader, toState: 'PREPARING' | 'READY', action: string, userId?: string) {
    const fromState = order.state || order.status;
    order.state = toState;
    order.status = toState;
    await this.orderRepo.manager.transaction(async (em) => {
      await em.save(OrderHeader, order);
      await this.transitionRecorder.record(em, { tenantId, order, fromState, action, userId });
    });
  }
}
