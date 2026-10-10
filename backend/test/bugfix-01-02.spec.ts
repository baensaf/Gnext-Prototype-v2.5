import { Test, TestingModule } from '@nestjs/testing';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { OrdersController } from '../src/modules/order/order.controller';
import { OrderService } from '../src/modules/order/order.service';
import { IncomingOrderPolicyService } from '../src/modules/order/incoming-order-policy.service';
import { OnlineOrdersService } from '../src/modules/order/online-orders.service';
import { OrderUpdateDto } from '../src/modules/order/dtos/order.dto';

describe('BUG-01 Verification Suite', () => {
  describe('BUG-01: POS Held Order Updates (PATCH /api/v1/orders/:id)', () => {
    let ordersController: OrdersController;
    let orderService: any;

    beforeEach(async () => {
      orderService = {
        updateDraft: jest.fn().mockImplementation((tenantId, id, dto) =>
          Promise.resolve({
            id,
            tenant_id: tenantId,
            branch_id: dto.branch_id,
            order_type: dto.order_type,
            state: 'DRAFT',
            items: dto.items,
          }),
        ),
      };

      const module: TestingModule = await Test.createTestingModule({
        controllers: [OrdersController],
        providers: [
          { provide: OrderService, useValue: orderService },
          // The controller also serves the branch's incoming-order policy; unused here.
          { provide: IncomingOrderPolicyService, useValue: {} },
          { provide: OnlineOrdersService, useValue: {} },
        ],
      }).compile();

      ordersController = module.get<OrdersController>(OrdersController);
    });

    it('should validate OrderUpdateDto with branch_id, order_type and variant_name without whitelist/forbidNonWhitelisted errors', async () => {
      const rawPayload = {
        branch_id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
        order_type: 'DINE_IN',
        customer_id: 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22',
        notes: 'Held draft order from POS',
        items: [
          {
            product_id: 'c0eebc99-9c0b-4ef8-bb6d-6bb9bd380a33',
            variant_id: 'd0eebc99-9c0b-4ef8-bb6d-6bb9bd380a44',
            variant_name: 'Large',
            quantity: '2',
            options: [
              {
                option_item_id: 'e0eebc99-9c0b-4ef8-bb6d-6bb9bd380a55',
              },
            ],
          },
        ],
      };

      const dtoInstance = plainToInstance(OrderUpdateDto, rawPayload);
      const errors = await validate(dtoInstance, {
        whitelist: true,
        forbidNonWhitelisted: true,
      });

      expect(errors.length).toBe(0);
    });

    it('should allow OrdersController.updateDraft to process branch_id and order_type', async () => {
      const mockReq: any = { tenantId: 't-test', user: { id: 'u-1' }, correlationId: 'c-1' };
      const payload: OrderUpdateDto = {
        branch_id: '11111111-1111-1111-1111-111111111111',
        order_type: 'TAKEAWAY',
      };

      const result = await ordersController.updateDraft('ord-123', payload, mockReq);
      expect(orderService.updateDraft).toHaveBeenCalledWith(
        't-test',
        'ord-123',
        payload,
        'u-1',
        'c-1',
      );
      expect(result.branch_id).toBe('11111111-1111-1111-1111-111111111111');
      expect(result.order_type).toBe('TAKEAWAY');
    });
  });
});
