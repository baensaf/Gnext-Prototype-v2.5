import { Test, TestingModule } from '@nestjs/testing';
import { OrderService } from '../src/modules/order/order.service';
import { getRepositoryToken } from '@nestjs/typeorm';
import { OrderHeader } from '../src/entities/OrderHeader.entity';
import { OrderItem } from '../src/entities/OrderItem.entity';
import { OrderItemOption } from '../src/entities/OrderItemOption.entity';
import { Product } from '../src/entities/Product.entity';
import { OptionItem } from '../src/entities/OptionItem.entity';
import { OptionGroup } from '../src/entities/OptionGroup.entity';
import { CatalogService } from '../src/modules/catalog/catalog.service';
import { DiscountsService } from '../src/modules/discounts/discounts.service';
import { AuditWriter } from '../src/modules/audit/audit-writer.service';
import { BadRequestException } from '@nestjs/common';

describe('OrderService (Unit)', () => {
  let service: OrderService;
  let headerRepo: any;
  let productRepo: any;
  let catalogService: any;
  let discountsService: any;
  let auditWriter: any;

  beforeEach(async () => {
    headerRepo = { findOne: jest.fn(), create: jest.fn(), save: jest.fn() };
    productRepo = { findOne: jest.fn() };
    catalogService = { getEffectivePrice: jest.fn() };
    discountsService = { validateCoupon: jest.fn() };
    auditWriter = { write: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrderService,
        { provide: getRepositoryToken(OrderHeader), useValue: headerRepo },
        { provide: getRepositoryToken(OrderItem), useValue: { create: jest.fn() } },
        { provide: getRepositoryToken(OrderItemOption), useValue: { create: jest.fn() } },
        { provide: getRepositoryToken(Product), useValue: productRepo },
        { provide: getRepositoryToken(OptionItem), useValue: { findOne: jest.fn() } },
        { provide: getRepositoryToken(OptionGroup), useValue: { findOne: jest.fn() } },
        { provide: CatalogService, useValue: catalogService },
        { provide: DiscountsService, useValue: discountsService },
        { provide: AuditWriter, useValue: auditWriter },
      ],
    }).compile();

    service = module.get<OrderService>(OrderService);
  });

  it('should throw BadRequestException if order status cancellation lacks reason code', async () => {
    headerRepo.findOne.mockResolvedValue({ id: 'ord-1', status: 'SUBMITTED' });

    await expect(service.updateOrderStatus('t-1', 'ord-1', 'CANCELLED')).rejects.toThrow(BadRequestException);
  });

  it('should update status to KITCHEN_PREPARING successfully', async () => {
    headerRepo.findOne.mockResolvedValue({ id: 'ord-1', status: 'SUBMITTED' });
    headerRepo.save.mockImplementation((o) => Promise.resolve(o));

    const result = await service.updateOrderStatus('t-1', 'ord-1', 'KITCHEN_PREPARING');
    expect(result.status).toBe('KITCHEN_PREPARING');
  });
});
