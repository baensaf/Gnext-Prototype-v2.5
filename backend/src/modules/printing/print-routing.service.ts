import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { PrintRoute } from '../../entities/PrintRoute.entity';
import { PrinterGroup } from '../../entities/PrinterGroup.entity';
import { PrinterGroupMember } from '../../entities/PrinterGroupMember.entity';
import { Printer } from '../../entities/Printer.entity';

export interface RouteMatchOptions {
  tenantId: string;
  branchId: string;
  documentType: string;
  productId?: string;
  categoryId?: string;
  stationId?: string;
}

@Injectable()
export class PrintRoutingService {
  constructor(
    @InjectRepository(PrintRoute) private readonly routeRepo: Repository<PrintRoute>,
    @InjectRepository(PrinterGroup) private readonly groupRepo: Repository<PrinterGroup>,
    @InjectRepository(PrinterGroupMember) private readonly memberRepo: Repository<PrinterGroupMember>,
    @InjectRepository(Printer) private readonly printerRepo: Repository<Printer>,
  ) {}

  async resolvePrintersForRoute(opts: RouteMatchOptions): Promise<{ printers: Printer[]; copies: number }> {
    const routes = await this.routeRepo.find({
      where: { tenant_id: opts.tenantId, branch_id: opts.branchId, document_type: opts.documentType },
      order: { priority: 'DESC' },
    });

    let bestMatch: PrintRoute | null = null;
    let highestScore = -1;

    for (const route of routes) {
      let score = 0;
      if (route.product_id) {
        if (route.product_id === opts.productId) score = 100;
        else continue;
      } else if (route.category_id) {
        if (route.category_id === opts.categoryId) score = 50;
        else continue;
      } else if (route.station_id) {
        if (route.station_id === opts.stationId) score = 25;
        else continue;
      } else {
        // Default route match
        score = 10;
      }

      if (score > highestScore) {
        highestScore = score;
        bestMatch = route;
      }
    }

    if (!bestMatch) {
      // Fallback: find any active printer in branch
      const activePrinters = await this.printerRepo.find({
        where: { tenant_id: opts.tenantId, branch_id: opts.branchId, is_active: true },
        take: 1,
      });
      return { printers: activePrinters, copies: 1 };
    }

    // Find printers in the matched group
    const members = await this.memberRepo.find({
      where: { group_id: bestMatch.printer_group_id },
      order: { priority: 'ASC' },
    });

    const printers: Printer[] = [];
    for (const member of members) {
      const printer = await this.printerRepo.findOne({
        where: { id: member.printer_id, tenant_id: opts.tenantId, is_active: true },
      });
      if (printer) {
        printers.push(printer);
      }
    }

    if (printers.length === 0) {
      const fallbackPrinters = await this.printerRepo.find({
        where: { tenant_id: opts.tenantId, branch_id: opts.branchId, is_active: true },
        take: 1,
      });
      return { printers: fallbackPrinters, copies: bestMatch.copies || 1 };
    }

    return { printers, copies: bestMatch.copies || 1 };
  }
}
