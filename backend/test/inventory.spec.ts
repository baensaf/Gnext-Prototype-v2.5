import { Test, TestingModule } from '@nestjs/testing';
import { InventoryService } from '../src/modules/inventory/inventory.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { InventoryItem } from '../src/entities/InventoryItem.entity';
import { InventoryTransaction } from '../src/entities/InventoryTransaction.entity';
import { Product } from '../src/entities/Product.entity';
import { AuditWriter } from '../src/modules/audit/audit-writer.service';
import { BadRequestException, NotFoundException } from '@nestjs/common';

describe('InventoryService (Unit)', () => {
  let service: InventoryService;
  let itemRepo: any;
  let txRepo: any;
  let productRepo: any;
  let auditWriter: any;

  beforeEach(async () => {
    itemRepo = { findOne: jest.fn(), save: jest.fn(), createQueryBuilder: jest.fn() };
    txRepo = { find: jest.fn(), create: jest.fn(), save: jest.fn() };
    productRepo = { find: jest.fn() };
    auditWriter = { write: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InventoryService,
        { provide: getRepositoryToken(InventoryItem), useValue: itemRepo },
        { provide: getRepositoryToken(InventoryTransaction), useValue: txRepo },
        { provide: getRepositoryToken(Product), useValue: productRepo },
        { provide: AuditWriter, useValue: auditWriter },
      ],
    }).compile();

    service = module.get<InventoryService>(InventoryService);
  });

  it('should calculate low stock status correctly when qty <= reorder level', async () => {
    const qb = {
      where: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([
        { id: 'item-1', product_id: 'p-1', quantity_on_hand: '5.0000', reorder_level: '10.0000' },
        { id: 'item-2', product_id: 'p-2', quantity_on_hand: '50.0000', reorder_level: '10.0000' },
      ]),
    };
    itemRepo.createQueryBuilder.mockReturnValue(qb);
    productRepo.find.mockResolvedValue([
      { id: 'p-1', name: 'Cola', code: 'PROD-COLA' },
      { id: 'p-2', name: 'Burger', code: 'PROD-BURGER' },
    ]);

    const alerts = await service.getLowStockAlerts('t-1');
    expect(alerts.length).toBe(1);
    expect(alerts[0].product_code).toBe('PROD-COLA');
    expect(alerts[0].is_low_stock).toBe(true);
  });

  it('should throw BadRequestException when WASTE lacks reason code', async () => {
    itemRepo.findOne.mockResolvedValue({ id: 'item-1', quantity_on_hand: '10.0000' });

    await expect(
      service.postTransaction('t-1', {
        inventory_item_id: 'item-1',
        transaction_type: 'WASTE',
        quantity_delta: '-2.0000',
      }, 'corr-1'),
    ).rejects.toThrow(BadRequestException);
  });
});
