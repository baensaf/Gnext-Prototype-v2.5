import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, Repository } from 'typeorm';
import { Printer } from '../../entities/Printer.entity';
import { Product } from '../../entities/Product.entity';
import { KdsRoutingRule } from '../../entities/KdsRoutingRule.entity';
import { KitchenStation } from '../../entities/KitchenStation.entity';
import { Terminal } from '../../entities/Terminal.entity';
import { stationIdFor } from '../kds/prep-station';
import { TicketTemplate } from './print-render.service';

/** A printer a job goes to, and how many copies that printer prints. */
export interface RoutedPrinter {
  printer: Printer;
  copies: number;
}

const isKitchenPrinter = (p: Printer) => String(p.printer_type || '').toUpperCase().startsWith('KITCHEN');

/**
 * The branch printer a document prints on when nothing more specific is set up, always the same
 * one (the branch's printers come ordered by code): a kitchen chit on a kitchen printer, anything
 * else on a receipt printer, else on any printer that is not the kitchen's, else on any at all.
 * A kitchen chit with no kitchen printer gets none, so it fails and raises an alert rather than
 * come out at the counter, where nobody cooking would see it.
 */
export function branchFallback(branchPrinters: Printer[], kitchen: boolean): Printer | undefined {
  if (kitchen) return branchPrinters.find(isKitchenPrinter);
  return (
    branchPrinters.find((p) => String(p.printer_type || '').toUpperCase().includes('RECEIPT')) ??
    branchPrinters.find((p) => !isKitchenPrinter(p)) ??
    branchPrinters[0]
  );
}

/** A retired printer leaves its stations and tills, so they no longer name a device that is gone. */
export async function detachPrinter(em: EntityManager, tenantId: string, printerId: string): Promise<void> {
  await em
    .createQueryBuilder()
    .update(KitchenStation)
    .set({ printer_ids: () => `array_remove("printer_ids", :printerId)` })
    .where(`"tenant_id" = :tenantId AND :printerId = ANY("printer_ids")`, { tenantId, printerId })
    .execute();
  await em.update(Terminal, { tenant_id: tenantId, receipt_printer_id: printerId }, { receipt_printer_id: null });
}

/**
 * Where paper prints.
 *
 * A kitchen chit goes to the prep station that makes its lines (a product's KDS rule, else its
 * category's) and prints on every printer of that station. A receipt, guest bill or courier
 * slip prints at the till the order was taken on. Anything without its own printer falls back
 * to the branch's printer of that kind.
 */
@Injectable()
export class PrintRoutingService {
  constructor(
    @InjectRepository(Printer) private readonly printerRepo: Repository<Printer>,
    @InjectRepository(Product) private readonly productRepo: Repository<Product>,
    @InjectRepository(KdsRoutingRule) private readonly ruleRepo: Repository<KdsRoutingRule>,
    @InjectRepository(KitchenStation) private readonly stationRepo: Repository<KitchenStation>,
    @InjectRepository(Terminal) private readonly terminalRepo: Repository<Terminal>,
  ) {}

  /** The branch's printers in service, in the order the fallback picks from. */
  private async branchPrinters(tenantId: string, branchId: string): Promise<Printer[]> {
    return this.printerRepo.find({
      where: { tenant_id: tenantId, branch_id: branchId, is_active: true },
      order: { code: 'ASC', id: 'ASC' },
    });
  }

  /**
   * The prep station of each product at the branch, keyed by product id. A product no rule
   * claims, or whose station is out of service, is left out.
   */
  async stationsFor(tenantId: string, branchId: string, productIds: string[]): Promise<Map<string, KitchenStation>> {
    const ids = [...new Set(productIds.filter(Boolean))];
    const result = new Map<string, KitchenStation>();
    if (ids.length === 0) return result;

    const [products, rules, stations] = await Promise.all([
      this.productRepo.find({ where: { id: In(ids), tenant_id: tenantId } }),
      this.ruleRepo.find({ where: { tenant_id: tenantId, branch_id: branchId } }),
      this.stationRepo.find({ where: { tenant_id: tenantId, branch_id: branchId, is_active: true } }),
    ]);
    const categoryOf = new Map(products.map((p) => [p.id, p.category_id]));
    const stationById = new Map(stations.map((s) => [s.id, s]));

    for (const productId of ids) {
      const station = stationById.get(stationIdFor(rules, productId, categoryOf.get(productId)) ?? '');
      if (station) result.set(productId, station);
    }
    return result;
  }

  async station(tenantId: string, stationId?: string | null): Promise<KitchenStation | null> {
    if (!stationId) return null;
    return this.stationRepo.findOne({ where: { id: stationId, tenant_id: tenantId } });
  }

  /**
   * Every printer of the station that is in service prints the chit, in the station's order,
   * each the station's copies. A station with none, or no station, prints on the branch's
   * kitchen printer.
   */
  async printersForStation(tenantId: string, branchId: string, station: KitchenStation | null): Promise<RoutedPrinter[]> {
    const copies = station?.copies || 1;
    const ids = station?.printer_ids || [];
    if (ids.length) {
      const printers = await this.printerRepo.find({ where: { id: In(ids), tenant_id: tenantId, is_active: true } });
      const byId = new Map(printers.map((p) => [p.id, p]));
      const routed = ids.filter((id) => byId.has(id)).map((id) => ({ printer: byId.get(id)!, copies }));
      if (routed.length) return routed;
    }
    const fallback = branchFallback(await this.branchPrinters(tenantId, branchId), true);
    return fallback ? [{ printer: fallback, copies }] : [];
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
