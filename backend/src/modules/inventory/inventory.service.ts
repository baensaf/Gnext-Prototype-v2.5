import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InventoryItem } from '../../entities/InventoryItem.entity';
import { InventoryTransaction } from '../../entities/InventoryTransaction.entity';
import { Product } from '../../entities/Product.entity';
import { MoneyUtil } from '../../common/utils/money.util';
import { AuditWriter } from '../audit/audit-writer.service';

@Injectable()
export class InventoryService {
  constructor(
    @InjectRepository(InventoryItem) private readonly itemRepo: Repository<InventoryItem>,
    @InjectRepository(InventoryTransaction) private readonly txRepo: Repository<InventoryTransaction>,
    @InjectRepository(Product) private readonly productRepo: Repository<Product>,
    private readonly auditWriter: AuditWriter,
  ) {}

  async getInventoryItems(tenantId: string, branchId?: string) {
    const qb = this.itemRepo.createQueryBuilder('i')
      .where('i.tenant_id = :tenantId', { tenantId });

    if (branchId) {
      qb.andWhere('i.branch_id = :branchId', { branchId });
    }

    const items = await qb.getMany();
    const products = await this.productRepo.find({ where: { tenant_id: tenantId } });
    const productMap = new Map(products.map((p) => [p.id, p]));

    return items.map((item) => {
      const prod = productMap.get(item.product_id);
      const isLowStock = !MoneyUtil.greaterThan(item.quantity_on_hand, item.reorder_level);
      return {
        ...item,
        product_name: prod ? prod.name : 'Unknown Product',
        product_code: prod ? prod.code : 'UNKNOWN',
        is_low_stock: isLowStock,
      };
    });
  }

  async getLowStockAlerts(tenantId: string, branchId?: string) {
    const all = await this.getInventoryItems(tenantId, branchId);
    return all.filter((i) => i.is_low_stock);
  }

  async postTransaction(
    tenantId: string,
    data: {
      inventory_item_id: string;
      transaction_type: string;
      quantity_delta: string;
      reason_code_id?: string;
      note?: string;
    },
    correlationId: string,
  ) {
    const item = await this.itemRepo.findOne({
      where: { id: data.inventory_item_id, tenant_id: tenantId },
    });
    if (!item) throw new NotFoundException('Inventory item not found');

    if (
      (data.transaction_type === 'WASTE' || data.transaction_type === 'ADJUSTMENT') &&
      !data.reason_code_id
    ) {
      throw new BadRequestException(`Reason code is required for ${data.transaction_type} operations`);
    }

    const deltaFormatted = MoneyUtil.format(data.quantity_delta);
    const newQty = MoneyUtil.add(item.quantity_on_hand, deltaFormatted);

    item.quantity_on_hand = newQty;
    await this.itemRepo.save(item);

    const tx = this.txRepo.create({
      tenant_id: tenantId,
      inventory_item_id: item.id,
      transaction_type: data.transaction_type,
      quantity_delta: deltaFormatted,
      reason_code_id: data.reason_code_id || null,
      note: data.note || null,
    });

    const savedTx = await this.txRepo.save(tx);

    await this.auditWriter.write({
      tenantId,
      actorType: 'ADMIN',
      action: 'INVENTORY_TRANSACTION_RECORDED',
      entityType: 'InventoryTransaction',
      entityId: savedTx.id,
      correlationId,
      afterData: { tx: savedTx, newQty },
    });

    return { transaction: savedTx, item };
  }

  async getTransactions(tenantId: string, inventoryItemId: string) {
    return await this.txRepo.find({
      where: { tenant_id: tenantId, inventory_item_id: inventoryItemId },
      order: { recorded_at: 'DESC' },
    });
  }
}
