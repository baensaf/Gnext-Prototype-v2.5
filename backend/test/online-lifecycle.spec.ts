import { ConflictException } from '@nestjs/common';
import { OnlineOrdersService } from '../src/modules/order/online-orders.service';
import { channelFor, channelForPlatform } from '../src/modules/order/channels';

// After accepting: the cashier marks a platform order ready and hands it over, or the
// platform's rider picks it up. Audit A4, A6 and A9 (2026-10-08).
describe('a platform order after the store accepts it', () => {
  let saved: any;
  let transitions: string[];
  let service: OnlineOrdersService;

  const snappfood = (overrides: Record<string, any> = {}): any => ({
    id: 'order-1',
    tenant_id: 't-1',
    branch_id: 'b-1',
    channel: 'AGGREGATOR',
    order_number: 'SNP-SF-1',
    state: 'CONFIRMED',
    accepted_at: new Date(),
    aggregator_expedition: 'ZF_EXPRESS',
    outstanding_total: '0.0000',
    ...overrides,
  });

  beforeEach(() => {
    saved = snappfood();
    transitions = [];
    const orderRepo = {
      findOne: jest.fn(() => Promise.resolve(saved)),
      save: jest.fn((o: any) => Promise.resolve(o)),
    };
    const orderService: any = {
      channelOf: (o: any) => channelFor(o, {}),
      platformChannel: (p: any) => channelForPlatform(p, {}),
      transitionState: jest.fn((_t: string, _id: string, action: string) => {
        transitions.push(action);
        const to: Record<string, string> = { CONFIRM: 'CONFIRMED', START_PREPARATION: 'PREPARING', MARK_READY: 'READY', COMPLETE: 'COMPLETED' };
        saved = { ...saved, state: to[action] };
        return Promise.resolve(saved);
      }),
    };
    service = new OnlineOrdersService(orderRepo as any, {} as any, {} as any, {} as any, orderService, {} as any);
  });

  describe('Ready', () => {
    it('moves an accepted order through preparing to ready', async () => {
      const result = await service.markReady('t-1', 'order-1');

      expect(transitions).toEqual(['START_PREPARATION', 'MARK_READY']);
      expect(result.state).toBe('READY');
    });

    it('leaves an order that is already ready alone', async () => {
      saved = snappfood({ state: 'READY' });

      await service.markReady('t-1', 'order-1');

      expect(transitions).toEqual([]);
    });

    it('refuses an order the kitchen no longer has', async () => {
      saved = snappfood({ state: 'CANCELLED' });

      await expect(service.markReady('t-1', 'order-1')).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('Handed over', () => {
    it("completes an order a platform rider took", async () => {
      saved = snappfood({ state: 'READY' });

      const result = await service.handOver('t-1', 'order-1');

      expect(transitions).toEqual(['COMPLETE']);
      expect(result.state).toBe('COMPLETED');
    });

    it('sends an order our own courier takes to Dispatch instead', async () => {
      saved = snappfood({ state: 'READY', aggregator_expedition: 'DELIVERY' });

      const refused = await service.handOver('t-1', 'order-1').catch((e) => e);

      expect(refused.getResponse()).toEqual(expect.objectContaining({ code: 'SEND_OUT_FROM_DISPATCH' }));
      expect(transitions).toEqual([]);
    });

    it('asks for the money first on a cash order the customer collects', async () => {
      saved = snappfood({ state: 'READY', aggregator_expedition: 'PICKUP', outstanding_total: '4200000.0000' });

      const refused = await service.handOver('t-1', 'order-1').catch((e) => e);

      expect(refused.getResponse()).toEqual(expect.objectContaining({ code: 'PAYMENT_DUE' }));
      expect(transitions).toEqual([]);
    });
  });

  describe("the platform's rider", () => {
    it('keeps who is coming and where they are', async () => {
      const result = await service.riderUpdate('t-1', saved, 'Ali Tehrani', 'AT_RESTAURANT');

      expect(result.aggregator_rider_name).toBe('Ali Tehrani');
      expect(result.aggregator_rider_status).toBe('AT_RESTAURANT');
      expect(transitions).toEqual([]);
    });

    it('closes the order once the rider has picked it up', async () => {
      await service.riderUpdate('t-1', snappfood({ state: 'READY' }), 'Ali Tehrani', 'PICKED');

      expect(transitions).toEqual(['COMPLETE']);
    });

    it('is ignored on an order our own courier takes', async () => {
      const own = snappfood({ aggregator_expedition: 'DELIVERY' });

      const result = await service.riderUpdate('t-1', own, 'Ali Tehrani', 'PICKED');

      expect(result.aggregator_rider_status).toBeUndefined();
      expect(transitions).toEqual([]);
    });
  });
});
