import { Test, TestingModule } from '@nestjs/testing';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { OrdersController } from '../src/modules/order/order.controller';
import { OrderService } from '../src/modules/order/order.service';
import { OrderUpdateDto } from '../src/modules/order/dtos/order.dto';
import { CustomerController } from '../src/modules/customer/customer.controller';
import { CreditController } from '../src/modules/customer/credit.controller';
import { CustomerService } from '../src/modules/customer/customer.service';
import { CreditService } from '../src/modules/customer/credit.service';

describe('BUG-01 & BUG-02 Verification Suite', () => {
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
            coupon_code: dto.coupon_code,
            items: dto.items,
          }),
        ),
      };

      const module: TestingModule = await Test.createTestingModule({
        controllers: [OrdersController],
        providers: [{ provide: OrderService, useValue: orderService }],
      }).compile();

      ordersController = module.get<OrdersController>(OrdersController);
    });

    it('should validate OrderUpdateDto with branch_id, order_type, coupon_code and variant_name without whitelist/forbidNonWhitelisted errors', async () => {
      const rawPayload = {
        branch_id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
        order_type: 'DINE_IN',
        customer_id: 'b0eebc99-9c0b-4ef8-bb6d-6bb9bd380a22',
        coupon_code: 'DISCOUNT10',
        table_number: 'Table-5',
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
        table_number: 'T-1',
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

  describe('BUG-02: Customer Credit Ledger Popup (POST transactions endpoints)', () => {
    let customerController: CustomerController;
    let creditController: CreditController;
    let creditService: any;
    let customerService: any;

    beforeEach(async () => {
      creditService = {
        postCreditTransaction: jest.fn().mockImplementation((tenantId, customerId, body, userId) =>
          Promise.resolve({
            account: { id: 'acc-1', customer_id: customerId, current_balance: '50000.0000' },
            transaction: {
              id: 'tx-1',
              transaction_type: body.transaction_type || 'CHARGE',
              amount: String(body.amount),
              recorded_at: new Date().toISOString(),
              note: body.note,
            },
            entry: {
              id: 'tx-1',
              entry_type: 'ADJUSTMENT',
              amount: String(body.amount),
            },
            newBalance: '50000.0000',
            availableCredit: '150000.0000',
          }),
        ),
        getAccountByCustomer: jest.fn().mockResolvedValue({
          id: 'acc-1',
          customer_id: 'cust-1',
          current_balance: '50000.0000',
        }),
        getAccountStatement: jest.fn().mockResolvedValue({
          entries: [
            {
              id: 'tx-1',
              entry_type: 'ADJUSTMENT',
              amount: '50000.0000',
              posted_at: new Date(),
              reason_text: 'Top up',
            },
          ],
        }),
      };

      customerService = {};

      const module: TestingModule = await Test.createTestingModule({
        controllers: [CustomerController, CreditController],
        providers: [
          { provide: CreditService, useValue: creditService },
          { provide: CustomerService, useValue: customerService },
        ],
      }).compile();

      customerController = module.get<CustomerController>(CustomerController);
      creditController = module.get<CreditController>(CreditController);
    });

    it('CustomerController: should handle postCustomerCreditTransaction and return account & transaction', async () => {
      const mockReq: any = { tenantId: 't-test', user: { id: 'u-1' }, correlationId: 'c-1' };
      const body = { transaction_type: 'CHARGE', amount: '50000', note: 'Top-up deposit' };

      const res = await customerController.postCustomerCreditTransaction('cust-1', body, mockReq);
      expect(creditService.postCreditTransaction).toHaveBeenCalledWith(
        't-test',
        'cust-1',
        body,
        'u-1',
        'c-1',
      );
      expect(res.account).toBeDefined();
      expect(res.transaction).toBeDefined();
      expect(res.transaction.transaction_type).toBe('CHARGE');
      expect(res.transaction.amount).toBe('50000');
    });

    it('CustomerController.getCustomerCreditAccount: should return mapped transactions with transaction_type, recorded_at, note', async () => {
      const mockReq: any = { tenantId: 't-test' };
      const res = await customerController.getCustomerCreditAccount('cust-1', mockReq);
      expect(res.account).toBeDefined();
      expect(res.transactions).toBeDefined();
      expect(res.transactions.length).toBe(1);
      expect(res.transactions[0].transaction_type).toBe('ADJUSTMENT');
      expect(res.transactions[0].recorded_at).toBeDefined();
      expect(res.transactions[0].note).toBe('Top up');
    });
  });
});
