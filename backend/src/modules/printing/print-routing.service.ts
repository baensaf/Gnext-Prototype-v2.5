import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { PrintRoute } from '../../entities/PrintRoute.entity';
import { PrinterGroup } from '../../entities/PrinterGroup.entity';
import { PrinterGroupMember } from '../../entities/PrinterGroupMember.entity';
import { Printer } from '../../entities/Printer.entity';
import { Product } from '../../entities/Product.entity';
import { KdsRoutingRule } from '../../entities/KdsRoutingRule.entity';

export interface RouteMatchOptions {
  tenantId: string;
  branchId: string;
  documentType: string;
  productId?: string;
  categoryId?: string;
  stationId?: string;
}

/** What a single order line is known by when it is matched against the print routes. */
export interface LineRouteContext {
  productId?: string;
  categoryId?: string;
  stationId?: string;
}

/** A printer a job goes to, and how many copies that printer prints. */
export interface RoutedPrinter {
  printer: Printer;
  copies: number;
}

@Injectable()
export class PrintRoutingService {
  constructor(
    @InjectRepository(PrintRoute) private readonly routeRepo: Repository<PrintRoute>,
    @InjectRepository(PrinterGroup) private readonly groupRepo: Repository<PrinterGroup>,
    @InjectRepository(PrinterGroupMember) private readonly memberRepo: Repository<PrinterGroupMember>,
    @InjectRepository(Printer) private readonly printerRepo: Repository<Printer>,
    @InjectRepository(Product) private readonly productRepo: Repository<Product>,
    @InjectRepository(KdsRoutingRule) private readonly kdsRuleRepo: Repository<KdsRoutingRule>,
  ) {}

  async loadRoutes(tenantId: string, branchId: string, documentType: string): Promise<PrintRoute[]> {
    return this.routeRepo.find({
      where: { tenant_id: tenantId, branch_id: branchId, document_type: documentType },
      order: { priority: 'DESC' },
    });
  }

  /**
   * The most specific route for a line: product beats category, category beats station, and
   * any of them beats a route with no selector. Between equally specific routes the higher
   * priority wins, because the routes arrive sorted by priority.
   *
   * A whole-order document such as a receipt passes no line context, so only a route with no
   * selector can match it.
   */
  matchRoute(routes: PrintRoute[], line: LineRouteContext): PrintRoute | null {
    let bestMatch: PrintRoute | null = null;
    let highestScore = -1;

    for (const route of routes) {
      let score: number;
      if (route.product_id) {
        if (route.product_id !== line.productId) continue;
        score = 100;
      } else if (route.category_id) {
        if (route.category_id !== line.categoryId) continue;
        score = 50;
      } else if (route.station_id) {
        if (route.station_id !== line.stationId) continue;
        score = 25;
      } else {
        score = 10;
      }

      if (score > highestScore) {
        highestScore = score;
        bestMatch = route;
      }
    }
    return bestMatch;
  }

  /**
   * Category and kitchen station for each product, keyed by product id. The station comes from
   * the same KDS routing rules that put the line on a kitchen screen, so a "Grill" print route
   * and the Grill screen agree about where a burger goes.
   */
  async lineContexts(tenantId: string, branchId: string, productIds: string[]): Promise<Map<string, LineRouteContext>> {
    const ids = [...new Set(productIds.filter(Boolean))];
    const contexts = new Map<string, LineRouteContext>();
    if (ids.length === 0) return contexts;

    const [products, rules] = await Promise.all([
      this.productRepo.find({ where: { id: In(ids), tenant_id: tenantId } }),
      this.kdsRuleRepo.find({ where: { tenant_id: tenantId, branch_id: branchId }, order: { priority: 'DESC' } }),
    ]);
    const categoryOf = new Map(products.map((p) => [p.id, p.category_id]));

    for (const productId of ids) {
      const categoryId = categoryOf.get(productId) || undefined;
      const rule =
        rules.find((r) => r.product_id && r.product_id === productId) ||
        rules.find((r) => r.category_id && categoryId && r.category_id === categoryId);
      contexts.set(productId, { productId, categoryId, stationId: rule?.station_id });
    }
    return contexts;
  }

  /**
   * Every active printer in the route's group prints the job, in member priority order, each
   * printing the route's copies times its own.
   *
   * A route whose group has no working printer, or no route at all, falls back to one printer
   * of the kind the document belongs on, always the same one (by code): a kitchen chit to a
   * kitchen printer, anything else to a receipt printer, else any printer. A kitchen chit with
   * no kitchen printer comes back with none, so it fails and raises an alert rather than come
   * out at the counter, where nobody cooking would see it.
   */
  async printersForRoute(
    tenantId: string,
    branchId: string,
    route: PrintRoute | null,
    documentType?: string,
  ): Promise<RoutedPrinter[]> {
    const routeCopies = route?.copies || 1;

    if (route) {
      const members = await this.memberRepo.find({ where: { group_id: route.printer_group_id }, order: { priority: 'ASC' } });
      const printers = members.length
        ? await this.printerRepo.find({ where: { id: In(members.map((m) => m.printer_id)), tenant_id: tenantId, is_active: true } })
        : [];
      const byId = new Map(printers.map((p) => [p.id, p]));
      const routed = members
        .filter((m) => byId.has(m.printer_id))
        .map((m) => ({ printer: byId.get(m.printer_id)!, copies: routeCopies * (m.copies || 1) }));
      if (routed.length > 0) return routed;
    }

    const inBranch = await this.printerRepo.find({
      where: { tenant_id: tenantId, branch_id: branchId, is_active: true },
      order: { code: 'ASC' },
    });
    const isKitchen = (p: Printer) => String(p.printer_type || '').toUpperCase().startsWith('KITCHEN');
    const fallback =
      documentType === 'KITCHEN_TICKET'
        ? inBranch.find(isKitchen)
        : inBranch.find((p) => String(p.printer_type || '').toUpperCase().includes('RECEIPT')) ?? inBranch.find((p) => !isKitchen(p)) ?? inBranch[0];
    return fallback ? [{ printer: fallback, copies: routeCopies }] : [];
  }

  async groupName(tenantId: string, groupId: string): Promise<string | undefined> {
    return (await this.group(tenantId, groupId))?.name;
  }

  async group(tenantId: string, groupId?: string | null): Promise<PrinterGroup | null> {
    if (!groupId) return null;
    return await this.groupRepo.findOne({ where: { id: groupId, tenant_id: tenantId } });
  }

  /** The printers for a document with no lines to route by, or for a single line. */
  async resolvePrintersForRoute(opts: RouteMatchOptions): Promise<{ printers: Printer[]; copies: number }> {
    const routes = await this.loadRoutes(opts.tenantId, opts.branchId, opts.documentType);
    const route = this.matchRoute(routes, { productId: opts.productId, categoryId: opts.categoryId, stationId: opts.stationId });
    const routed = await this.printersForRoute(opts.tenantId, opts.branchId, route, opts.documentType);
    return { printers: routed.map((r) => r.printer), copies: routed[0]?.copies || route?.copies || 1 };
  }
}
