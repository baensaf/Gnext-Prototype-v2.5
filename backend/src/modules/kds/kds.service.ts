import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, In } from 'typeorm';

import { KitchenStation } from '../../entities/KitchenStation.entity';
import { KitchenTicket } from '../../entities/KitchenTicket.entity';
import { KitchenTicketItem } from '../../entities/KitchenTicketItem.entity';
import { PrinterDevice } from '../../entities/PrinterDevice.entity';
import { OrderHeader } from '../../entities/OrderHeader.entity';
import { AuditWriter } from '../audit/audit-writer.service';

@Injectable()
export class KdsService {
  constructor(
    @InjectRepository(KitchenStation) private readonly stationRepo: Repository<KitchenStation>,
    @InjectRepository(KitchenTicket) private readonly ticketRepo: Repository<KitchenTicket>,
    @InjectRepository(KitchenTicketItem) private readonly itemRepo: Repository<KitchenTicketItem>,
    @InjectRepository(PrinterDevice) private readonly printerRepo: Repository<PrinterDevice>,
    @InjectRepository(OrderHeader) private readonly orderRepo: Repository<OrderHeader>,
    private readonly auditWriter: AuditWriter,
  ) {}

  // Stations Management
  async getStations(tenantId: string, branchId?: string) {
    const where: any = { tenant_id: tenantId };
    if (branchId) where.branch_id = branchId;
    return await this.stationRepo.find({ where, order: { name: 'ASC' } });
  }

  async createStation(tenantId: string, data: { branch_id?: string; code: string; name: string; station_type?: string }, correlationId: string) {
    const station = this.stationRepo.create({
      tenant_id: tenantId,
      branch_id: data.branch_id || null,
      code: data.code.toUpperCase(),
      name: data.name,
      station_type: data.station_type || 'HOT_KITCHEN',
      is_active: true,
    });
    const saved = await this.stationRepo.save(station);
    await this.auditWriter.write({
      tenantId,
      actorType: 'ADMIN',
      action: 'KITCHEN_STATION_CREATED',
      correlationId,
      afterData: saved,
    });
    return saved;
  }

  // Printers Management
  async getPrinters(tenantId: string, branchId?: string) {
    const where: any = { tenant_id: tenantId };
    if (branchId) where.branch_id = branchId;
    return await this.printerRepo.find({ where, order: { name: 'ASC' } });
  }

  async createPrinter(
    tenantId: string,
    data: { branch_id?: string; code: string; name: string; ip_address?: string; printer_type?: string; paper_width_mm?: number },
    correlationId: string,
  ) {
    const printer = this.printerRepo.create({
      tenant_id: tenantId,
      branch_id: data.branch_id || null,
      code: data.code.toUpperCase(),
      name: data.name,
      ip_address: data.ip_address || null,
      printer_type: data.printer_type || 'THERMAL_RECEIPT',
      paper_width_mm: data.paper_width_mm || 80,
      is_active: true,
    });
    const saved = await this.printerRepo.save(printer);
    await this.auditWriter.write({
      tenantId,
      actorType: 'ADMIN',
      action: 'PRINTER_DEVICE_CREATED',
      correlationId,
      afterData: saved,
    });
    return saved;
  }

  // Ticket Generation & KDS Screen Operations
  async generateTicketsForOrder(tenantId: string, orderId: string, correlationId: string) {
    const order = await this.orderRepo.findOne({
      where: { id: orderId, tenant_id: tenantId },
      relations: ['items', 'items.options'],
    });
    if (!order) throw new NotFoundException('Order not found');

    let defaultStation = await this.stationRepo.findOne({ where: { tenant_id: tenantId, is_active: true } });
    if (!defaultStation) {
      defaultStation = await this.createStation(tenantId, { code: 'HOT-KITCHEN', name: 'Main Kitchen' }, correlationId);
    }

    const ticketCount = await this.ticketRepo.count({ where: { tenant_id: tenantId } });
    const ticketNumber = `K-${(ticketCount + 101).toString()}`;

    const ticket = this.ticketRepo.create({
      tenant_id: tenantId,
      order_id: order.id,
      station_id: defaultStation.id,
      ticket_number: ticketNumber,
      status: 'IN_PREPARATION',
      prep_time_seconds: 0,
    });
    const savedTicket = await this.ticketRepo.save(ticket);

    for (const item of order.items) {
      const optsSummary = item.options ? item.options.map((o) => o.option_item_name).join(', ') : '';
      const ticketItem = this.itemRepo.create({
        tenant_id: tenantId,
        ticket_id: savedTicket.id,
        order_item_id: item.id,
        product_name: item.product_name,
        quantity: item.quantity,
        status: 'PENDING',
        special_instructions: item.special_instructions || null,
        options_summary: optsSummary || null,
      });
      await this.itemRepo.save(ticketItem);
    }

    await this.auditWriter.write({
      tenantId,
      actorType: 'ADMIN',
      action: 'KITCHEN_TICKET_GENERATED',
      correlationId,
      afterData: savedTicket,
    });

    return savedTicket;
  }

  async getKdsTickets(tenantId: string, stationId?: string, isBumped?: boolean) {
    // Auto-generate tickets for active orders without kitchen tickets
    const activeOrders = await this.orderRepo.find({
      where: { tenant_id: tenantId, status: In(['SUBMITTED', 'KITCHEN_PREPARING']) },
    });
    for (const order of activeOrders) {
      const existing = await this.ticketRepo.findOne({ where: { tenant_id: tenantId, order_id: order.id } });
      if (!existing) {
        await this.generateTicketsForOrder(tenantId, order.id, 'auto-kds-sync');
      }
    }

    const where: any = { tenant_id: tenantId };
    if (stationId) where.station_id = stationId;

    if (isBumped) {
      where.status = 'BUMPED';
    } else {
      where.status = 'IN_PREPARATION';
    }

    const tickets = await this.ticketRepo.find({ where, order: { created_at: 'ASC' } });
    const now = new Date();

    const ticketsWithItems = [];
    for (const t of tickets) {
      const items = await this.itemRepo.find({ where: { tenant_id: tenantId, ticket_id: t.id } });
      const order = await this.orderRepo.findOne({ where: { id: t.order_id } });
      const elapsedSeconds = Math.floor((now.getTime() - new Date(t.created_at).getTime()) / 1000);

      ticketsWithItems.push({
        ...t,
        order_number: order ? order.order_number : 'ORD-00',
        order_type: order ? order.order_type : 'DINE_IN',
        table_number: order ? order.table_number : null,
        prep_time_seconds: elapsedSeconds,
        items,
      });
    }

    return ticketsWithItems;
  }

  async bumpTicket(tenantId: string, ticketId: string, correlationId?: string) {
    const ticket = await this.ticketRepo.findOne({ where: { id: ticketId, tenant_id: tenantId } });
    if (!ticket) throw new NotFoundException('Kitchen ticket not found');

    ticket.status = 'BUMPED';
    ticket.bumped_at = new Date();
    const saved = await this.ticketRepo.save(ticket);

    // Update items to DONE
    const items = await this.itemRepo.find({ where: { tenant_id: tenantId, ticket_id: ticketId } });
    for (const it of items) {
      it.status = 'DONE';
      await this.itemRepo.save(it);
    }

    await this.auditWriter.write({
      tenantId,
      actorType: 'ADMIN',
      action: 'KITCHEN_TICKET_BUMPED',
      correlationId: correlationId || 'corr-bump',
      afterData: saved,
    });

    return saved;
  }

  async recallTicket(tenantId: string, ticketId: string, correlationId?: string) {
    const ticket = await this.ticketRepo.findOne({ where: { id: ticketId, tenant_id: tenantId } });
    if (!ticket) throw new NotFoundException('Kitchen ticket not found');

    ticket.status = 'IN_PREPARATION';
    ticket.bumped_at = null as any;
    const saved = await this.ticketRepo.save(ticket);

    await this.auditWriter.write({
      tenantId,
      actorType: 'ADMIN',
      action: 'KITCHEN_TICKET_RECALLED',
      correlationId: correlationId || 'corr-recall',
      afterData: saved,
    });

    return saved;
  }

  async updateItemStatus(tenantId: string, itemId: string, status: 'PENDING' | 'COOKING' | 'DONE') {
    const item = await this.itemRepo.findOne({ where: { id: itemId, tenant_id: tenantId } });
    if (!item) throw new NotFoundException('Ticket item not found');

    item.status = status;
    return await this.itemRepo.save(item);
  }

  // Simulated Thermal Printing Engine
  async simulatePrint(tenantId: string, data: { ticket_id?: string; order_id?: string; paper_width_mm?: number }) {
    let ticket = null;
    let order = null;

    if (data.ticket_id) {
      ticket = await this.ticketRepo.findOne({ where: { id: data.ticket_id, tenant_id: tenantId } });
      if (ticket) order = await this.orderRepo.findOne({ where: { id: ticket.order_id, tenant_id: tenantId }, relations: ['items', 'items.options'] });
    } else if (data.order_id) {
      order = await this.orderRepo.findOne({ where: { id: data.order_id, tenant_id: tenantId }, relations: ['items', 'items.options'] });
    }

    const width = data.paper_width_mm === 58 ? 32 : 48; // characters per line
    const divider = '='.repeat(width);
    const subDivider = '-'.repeat(width);

    const lines: string[] = [];
    lines.push(divider);
    lines.push(this.centerText('*** KITCHEN PREPARATION CHIT ***', width));
    lines.push(divider);

    if (order) {
      lines.push(`ORDER #: ${order.order_number}`);
      lines.push(`TYPE   : ${order.order_type} ${order.table_number ? `(Table ${order.table_number})` : ''}`);
      lines.push(`DATE   : ${new Date(order.placed_at).toLocaleString()}`);
    }
    if (ticket) {
      lines.push(`TICKET : ${ticket.ticket_number}`);
    }
    lines.push(subDivider);
    lines.push(this.formatLine('QTY  ITEM NAME', 'STATUS', width));
    lines.push(subDivider);

    if (order && order.items) {
      for (const item of order.items) {
        lines.push(this.formatLine(`${parseFloat(item.quantity).toFixed(0)}x  ${item.product_name}`, '[ ]', width));
        if (item.options && item.options.length > 0) {
          for (const opt of item.options) {
            lines.push(`     + ${opt.option_item_name}`);
          }
        }
        if (item.special_instructions) {
          lines.push(`     * NOTE: ${item.special_instructions}`);
        }
      }
    }

    lines.push(divider);
    lines.push(this.centerText('Gnext POS Kitchen Dispatcher', width));
    lines.push(divider);

    const asciiChit = lines.join('\n');

    await this.auditWriter.write({
      tenantId,
      actorType: 'SIMULATOR',
      action: 'THERMAL_PRINT_SIMULATED',
      correlationId: 'corr-print-sim',
      details: { paperWidth: data.paper_width_mm || 80, linesCount: lines.length },
    });

    return {
      paper_width_mm: data.paper_width_mm || 80,
      printed_at: new Date().toISOString(),
      raw_ascii_chit: asciiChit,
    };
  }

  private centerText(text: string, width: number): string {
    if (text.length >= width) return text;
    const leftPadding = Math.floor((width - text.length) / 2);
    return ' '.repeat(leftPadding) + text;
  }

  private formatLine(left: string, right: string, width: number): string {
    const spaceCount = width - left.length - right.length;
    if (spaceCount <= 0) return `${left} ${right}`;
    return left + ' '.repeat(spaceCount) + right;
  }
}
