import { OrderTransitionRecorder } from '../src/modules/order-lifecycle/order-transition-recorder.service';
import { readCustomerClub } from '../src/common/utils/customer-club';

// HamiClub's earning rule, kept for branches leaving HAMI (2026-11-10): 10% back on bills of
// 5,000,000 Rial or more before discounts, and a switch that stops all earning.
describe('Customer club earning', () => {
  const run = async (order: Record<string, any>, club?: Record<string, any>) => {
    const creditService = { awardLoyaltyCashback: jest.fn() };
    const recorder = new OrderTransitionRecorder({ write: jest.fn() } as any, { enqueueInTransaction: jest.fn() } as any, creditService as any);
    const em: any = {
      create: jest.fn((_: any, data: any) => data),
      save: jest.fn(),
      getRepository: () => ({ find: jest.fn().mockResolvedValue(club ? [{ key: 'CUSTOMER_CLUB', branch_id: null, value: club }] : []) }),
    };
    await recorder.record(em, {
      tenantId: 't-1',
      order: { id: 'o-1', customer_id: 'c-1', state: 'COMPLETED', currency_code: 'IRR', discount_total: '0.0000', ...order } as any,
      fromState: 'READY',
      action: 'COMPLETE',
    });
    return creditService.awardLoyaltyCashback;
  };

  it('defaults to HamiClub\'s rules', () => {
    expect(readCustomerClub(undefined)).toEqual({
      enabled: true,
      cashbackPercentage: '10.00',
      minBillToEarn: '5000000.0000',
      creditStartsAfterDays: 1,
      creditValidDays: 14,
    });
  });

  it('earns 10% of what was paid on a bill of 5,000,000 Rial or more before discounts', async () => {
    const award = await run({ subtotal: '5000000.0000', discount_total: '1000000.0000' });
    expect(award).toHaveBeenCalledWith('t-1', 'c-1', 'o-1', '4000000.0000', '10.00', 'IRR', expect.anything(), expect.objectContaining({ creditValidDays: 14 }));
  });

  it('earns nothing on a smaller bill', async () => {
    expect(await run({ subtotal: '4999999.0000' })).not.toHaveBeenCalled();
  });

  it('earns nothing while the club is switched off', async () => {
    expect(await run({ subtotal: '9000000.0000' }, { enabled: false, cashback_percentage: '10.00' })).not.toHaveBeenCalled();
  });

  it('follows head office\'s own minimum and rate', async () => {
    const award = await run({ subtotal: '1000000.0000' }, { cashback_percentage: '5.00', min_bill_to_earn: '0' });
    expect(award).toHaveBeenCalledWith('t-1', 'c-1', 'o-1', '1000000.0000', '5.00', 'IRR', expect.anything(), expect.anything());
  });
});
