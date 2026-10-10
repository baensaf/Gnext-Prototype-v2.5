import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, Repository } from 'typeorm';
import { Printer } from '../../entities/Printer.entity';
import { Product } from '../../entities/Product.entity';
import { PrintRoute } from '../../entities/PrintRoute.entity';
import { Terminal } from '../../entities/Terminal.entity';
import { TicketTemplate } from './print-render.service';

/** A printer a job goes to, and how many copies that printer prints. */
export interface RoutedPrinter {
  printer: Printer;
  copies: number;
}

/** What a branch sends to one printer. */
export interface PrinterRoutes {
  printer_id: string;
  category_ids: string[];
  product_ids: string[];
}

const isKitchenPrinter = (p: Printer) => String(p.printer_type || '').toUpperCase().startsWith('KITCHEN');

/**
 * The branch printer a document prints on when nothing more specific is set up. A kitchen chit
 * goes to the printer the branch marked as its default kitchen printer, else its first kitchen
 * printer; with neither it gets none, so it fails and raises an alert rather than come out at the
 * counter, where nobody cooking would see it. Anything else prints on a receipt printer, else on
 * any printer that is not the kitchen's, else on any at all.
 */
export function branchFallback(branchPrinters: Printer[], kitchen: boolean): Printer | undefined {
  if (kitchen) return branchPrinters.find((p) => p.kitchen_default) ?? branchPrinters.find(isKitchenPrinter);
  return (
    branchPrinters.find((p) => String(p.printer_type || '').toUpperCase().includes('RECEIPT')) ??
    branchPrinters.find((p) => !isKitchenPrinter(p)) ??
    branchPrinters[0]
  );
}

/** A retired printer leaves its routes and tills, so they no longer name a device that is gone. */
export async function detachPrinter(em: EntityManager, tenantId: string, printerId: string): Promise<void> {
  await em.delete(PrintRoute, { tenant_id: tenantId, printer_id: printerId });
  await em.update(Terminal, { tenant_id: tenantId, receipt_printer_id: printerId }, { receipt_printer_id: null });
}

/**
 * Where paper prints.
 *
 * A kitchen chit line prints on every printer its product is sent to, else every printer its
 * category is sent to, else the branch's default kitchen printer. A receipt, guest bill or
 * courier slip prints at the till the order was taken on. Anything without its own printer
 * falls back to the branch's printer of that kind.
 */
@Injectable()
export class PrintRoutingService {
  constructor(
    @InjectRepository(Printer) private readonly printerRepo: Repository<Printer>,
    @InjectRepository(Product) private readonly productRepo: Repository<Product>,
    @InjectRepository(PrintRoute) private readonly routeRepo: Repository<PrintRoute>,
    @InjectRepository(Terminal) private readonly terminalRepo: Repository<Terminal>,
  ) {}

  /** The branch's printers in service, in the order the fallback picks from. */
  private async branchPrinters(tenantId: string, branchId: string): Promise<Printer[]> {
    return this.printerRepo.find({
      where: { tenant_id: tenantId, branch_id: branchId, is_active: true },
      order: { code: 'ASC', id: 'ASC' },
    });
  }

  /** The branch's default kitchen printer, or none. */
  async kitchenDefault(tenantId: string, branchId: string): Promise<Printer | undefined> {
    return branchFallback(await this.branchPrinters(tenantId, branchId), true);
  }

  /**
   * The printers each product's kitchen lines print on at the branch, keyed by product id, in the
   * branch's printer order. A product nothing is routed to gets the default kitchen printer, or
   * an empty list when the branch has none.
   */
  async printersFor(tenantId: string, branchId: string, productIds: string[]): Promise<Map<string, Printer[]>> {
    const ids = [...new Set(productIds.filter(Boolean))];
    const result = new Map<string, Printer[]>();
    if (ids.length === 0) return result;

    const [products, routes, printers] = await Promise.all([
      this.productRepo.find({ where: { id: In(ids), tenant_id: tenantId } }),
      this.routeRepo.find({ where: { tenant_id: tenantId, branch_id: branchId } }),
      this.branchPrinters(tenantId, branchId),
    ]);
    const categoryOf = new Map(products.map((p) => [p.id, p.category_id]));
    const fallback = branchFallback(printers, true);

    for (const productId of ids) {
      const own = routes.filter((r) => r.product_id === productId);
      const category = categoryOf.get(productId);
      const chosen = own.length ? own : routes.filter((r) => !r.product_id && category && r.category_id === category);
      const routed = printers.filter((p) => chosen.some((r) => r.printer_id === p.id));
      result.set(productId, routed.length ? routed : fallback ? [fallback] : []);
    }
    return result;
  }

  /** Every printer's routes at the branch. */
  async routes(tenantId: string, branchId: string): Promise<PrinterRoutes[]> {
    const routes = await this.routeRepo.find({ where: { tenant_id: tenantId, branch_id: branchId } });
    const byPrinter = new Map<string, PrinterRoutes>();
    for (const r of routes) {
      const entry = byPrinter.get(r.printer_id) ?? { printer_id: r.printer_id, category_ids: [], product_ids: [] };
      if (r.category_id) entry.category_ids.push(r.category_id);
      if (r.product_id) entry.product_ids.push(r.product_id);
      byPrinter.set(r.printer_id, entry);
    }
    return [...byPrinter.values()];
  }

  /** Replace what one printer prints. */
  async setRoutes(tenantId: string, printerId: string, categoryIds: string[], productIds: string[]): Promise<PrinterRoutes> {
    const printer = await this.printerRepo.findOne({ where: { id: printerId, tenant_id: tenantId } });
    if (!printer) throw new NotFoundException(`Printer ${printerId} not found`);
    const categories = [...new Set((categoryIds || []).filter(Boolean))];
    const products = [...new Set((productIds || []).filter(Boolean))];
    if (products.length) {
      const found = await this.productRepo.count({ where: { id: In(products), tenant_id: tenantId } });
      if (found !== products.length) throw new BadRequestException('One of the products is not on the menu');
    }

    await this.routeRepo.manager.transaction(async (em) => {
      await em.delete(PrintRoute, { tenant_id: tenantId, printer_id: printerId });
      const rows = [
        ...categories.map((category_id) => ({ category_id, product_id: null })),
        ...products.map((product_id) => ({ category_id: null, product_id })),
      ].map((target) => em.create(PrintRoute, { tenant_id: tenantId, branch_id: printer.branch_id, printer_id: printerId, ...target }));
      if (rows.length) await em.save(rows);
    });
    return { printer_id: printerId, category_ids: categories, product_ids: products };
  }

  /** Make one printer the branch's default kitchen printer. */
  async setKitchenDefault(tenantId: string, printerId: string): Promise<Printer> {
    const printer = await this.printerRepo.findOne({ where: { id: printerId, tenant_id: tenantId } });
    if (!printer) throw new NotFoundException(`Printer ${printerId} not found`);
    await this.printerRepo.manager.transaction(async (em) => {
      await em.update(Printer, { tenant_id: tenantId, branch_id: printer.branch_id, kitchen_default: true }, { kitchen_default: false });
      await em.update(Printer, { id: printer.id, tenant_id: tenantId }, { kitchen_default: true });
    });
    printer.kitchen_default = true;
    return printer;
  }

  /**
   * Where a whole-order document prints: the till's receipt printer, with the till's copies and
   * paper. An order from no till (online, an aggregator, a kiosk), or from a till with no printer
   * of its own in service, prints on the branch's receipt printer.
   */
  async printersForDocument(
    tenantId: string,
    branchId: string,
    terminalId?: string | null,
  ): Promise<{ printers: RoutedPrinter[]; template: TicketTemplate | null }> {
    const till = terminalId ? await this.terminalRepo.findOne({ where: { id: terminalId, tenant_id: tenantId } }) : null;
    const copies = till?.receipt_copies || 1;
    const template = till?.receipt_template ?? null;

    if (till?.receipt_printer_id) {
      const own = await this.printerRepo.findOne({ where: { id: till.receipt_printer_id, tenant_id: tenantId, is_active: true } });
      if (own) return { printers: [{ printer: own, copies }], template };
    }
    const fallback = branchFallback(await this.branchPrinters(tenantId, branchId), false);
    return { printers: fallback ? [{ printer: fallback, copies }] : [], template };
  }
}
