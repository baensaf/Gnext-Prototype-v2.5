import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, IsNull, Not, Repository } from 'typeorm';
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

/** What a branch sends to one printer. A null printer is the branch's "not printed" list. */
export interface PrinterRoutes {
  printer_id: string | null;
  category_ids: string[];
  product_ids: string[];
}

/**
 * Why a product prints where it does: a route of its own, its category's, the default kitchen
 * printer, a "not printed" route (no kitchen chit at all), or nowhere because the branch has no
 * kitchen printer to fall back on.
 */
export type RouteSource = 'PRODUCT' | 'CATEGORY' | 'DEFAULT' | 'NOT_PRINTED' | 'NOWHERE';

/** Where one product's kitchen lines print, and why. */
export interface ProductRouting {
  printers: Printer[];
  source: RouteSource;
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
 * category is sent to, else the branch's default kitchen printer; a product or category on the
 * branch's "not printed" list prints in no kitchen. A receipt, guest bill or courier slip prints
 * at the till the order was taken on. Anything without its own printer falls back to the
 * branch's printer of that kind.
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
   * Where each product's kitchen lines print at the branch, keyed by product id, with the
   * printers in the branch's printer order. A product's own routes beat its category's; a route
   * with no printer means no kitchen chit; a route whose printers are all out of service, or no
   * route at all, falls to the default kitchen printer, and with none of those the product has
   * nowhere to print.
   */
  async routeProducts(tenantId: string, branchId: string, productIds: string[]): Promise<Map<string, ProductRouting>> {
    const ids = [...new Set(productIds.filter(Boolean))];
    const result = new Map<string, ProductRouting>();
    if (ids.length === 0) return result;

    const [products, routes, printers] = await Promise.all([
      this.productRepo.find({ where: { id: In(ids), tenant_id: tenantId } }),
      this.routeRepo.find({ where: { tenant_id: tenantId, branch_id: branchId } }),
      this.branchPrinters(tenantId, branchId),
    ]);
    const categoryOf = new Map(products.map((p) => [p.id, p.category_id]));
    const fallback = branchFallback(printers, true);
    const fallbackRouting = (): ProductRouting =>
      fallback ? { printers: [fallback], source: 'DEFAULT' } : { printers: [], source: 'NOWHERE' };

    for (const productId of ids) {
      const own = routes.filter((r) => r.product_id === productId);
      const category = categoryOf.get(productId);
      const chosen = own.length ? own : routes.filter((r) => !r.product_id && category && r.category_id === category);
      if (chosen.length === 0) {
        result.set(productId, fallbackRouting());
        continue;
      }
      if (chosen.every((r) => !r.printer_id)) {
        result.set(productId, { printers: [], source: 'NOT_PRINTED' });
        continue;
      }
      const routed = printers.filter((p) => chosen.some((r) => r.printer_id === p.id));
      result.set(productId, routed.length ? { printers: routed, source: own.length ? 'PRODUCT' : 'CATEGORY' } : fallbackRouting());
    }
    return result;
  }

  /** Where every product on the menu prints at the branch, and why: the routing read item by item. */
  async menuRouting(tenantId: string, branchId: string): Promise<Array<{ product_id: string; source: RouteSource; printer_ids: string[] }>> {
    const products = await this.productRepo.find({ where: { tenant_id: tenantId, is_active: true }, select: ['id'] });
    const routing = await this.routeProducts(tenantId, branchId, products.map((p) => p.id));
    return [...routing.entries()].map(([product_id, r]) => ({ product_id, source: r.source, printer_ids: r.printers.map((p) => p.id) }));
  }

  /** The branch's printers in service that print every order whole, for the pass. */
  async wholeOrderPrinters(tenantId: string, branchId: string): Promise<Printer[]> {
    return (await this.branchPrinters(tenantId, branchId)).filter((p) => p.prints_whole_order);
  }

  /** Every printer's routes at the branch, and its "not printed" list under a null printer. */
  async routes(tenantId: string, branchId: string): Promise<PrinterRoutes[]> {
    const routes = await this.routeRepo.find({ where: { tenant_id: tenantId, branch_id: branchId } });
    const byPrinter = new Map<string | null, PrinterRoutes>();
    for (const r of routes) {
      const key = r.printer_id ?? null;
      const entry = byPrinter.get(key) ?? { printer_id: key, category_ids: [], product_ids: [] };
      if (r.category_id) entry.category_ids.push(r.category_id);
      if (r.product_id) entry.product_ids.push(r.product_id);
      byPrinter.set(key, entry);
    }
    return [...byPrinter.values()];
  }

  /**
   * Replace what one printer prints. A category or product given to a printer comes off the
   * branch's "not printed" list: it cannot be both.
   */
  async setRoutes(tenantId: string, printerId: string, categoryIds: string[], productIds: string[]): Promise<PrinterRoutes> {
    const printer = await this.printerRepo.findOne({ where: { id: printerId, tenant_id: tenantId } });
    if (!printer) throw new NotFoundException(`Printer ${printerId} not found`);
    return this.replaceRoutes(tenantId, printer.branch_id, printerId, categoryIds, productIds);
  }

  /**
   * Replace what prints in no kitchen at the branch. A category or product put on the list
   * leaves every printer it was sent to.
   */
  async setNotPrinted(tenantId: string, branchId: string, categoryIds: string[], productIds: string[]): Promise<PrinterRoutes> {
    return this.replaceRoutes(tenantId, branchId, null, categoryIds, productIds);
  }

  private async replaceRoutes(
    tenantId: string,
    branchId: string,
    printerId: string | null,
    categoryIds: string[],
    productIds: string[],
  ): Promise<PrinterRoutes> {
    const categories = [...new Set((categoryIds || []).filter(Boolean))];
    const products = [...new Set((productIds || []).filter(Boolean))];
    if (products.length) {
      const found = await this.productRepo.count({ where: { id: In(products), tenant_id: tenantId } });
      if (found !== products.length) throw new BadRequestException('One of the products is not on the menu');
    }

    await this.routeRepo.manager.transaction(async (em) => {
      await em.delete(PrintRoute, { tenant_id: tenantId, branch_id: branchId, printer_id: printerId ?? IsNull() });
      // A printer's items leave "not printed"; "not printed" items leave every printer.
      const others = { tenant_id: tenantId, branch_id: branchId, printer_id: printerId ? IsNull() : Not(IsNull()) };
      if (categories.length) await em.delete(PrintRoute, { ...others, category_id: In(categories) });
      if (products.length) await em.delete(PrintRoute, { ...others, product_id: In(products) });
      const rows = [
        ...categories.map((category_id) => ({ category_id, product_id: null })),
        ...products.map((product_id) => ({ category_id: null, product_id })),
      ].map((target) => em.create(PrintRoute, { tenant_id: tenantId, branch_id: branchId, printer_id: printerId, ...target }));
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
