import { ConflictException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { IncomingOrderPolicyService } from '../src/modules/order/incoming-order-policy.service';
import { OrderService } from '../src/modules/order/order.service';
import { OrderHeader } from '../src/entities/OrderHeader.entity';
import { TenantSetting } from '../src/entities/TenantSetting.entity';
import { OperationalAlert } from '../src/entities/OperationalAlert.entity';
import {
  INCOMING_ORDER_POLICY_DEFAULTS,
  resolveIncomingOrderPolicy,
} from '../src/common/utils/incoming-order-policy.util';

// Slice 4 of incoming orders: which channels wait for staff, and what happens to an order
// nobody answers. Agreed defaults: Snappfood and website wait for staff, the kiosk goes
// straight through, and an order left 5 minutes is rejected with an alert.
describe('incoming order policy', () => {
  describe('reading the ORDER_WORKFLOW setting', () => {
    it('starts from the agreed defaults when nothing is set', () => {
      expect(resolveIncomingOrderPolicy(undefined)).toEqual({
        acceptance: { AGGREGATOR: 'MANUAL', ONLINE: 'MANUAL', KIOSK: 'AUTO' },
        timeoutMinutes: 5,
        timeoutAction: 'REJECT',
        defaultPrepMinutes: 20,
      });
      expect(resolveIncomingOrderPolicy({ autoRouteToKds: true })).toEqual(INCOMING_ORDER_POLICY_DEFAULTS);
    });

    it('takes what a branch sets and keeps the defaults for the rest', () => {
      const policy = resolveIncomingOrderPolicy({
        incomingOrders: { acceptance: { AGGREGATOR: 'AUTO' }, timeoutMinutes: 8 },
      });

      expect(policy.acceptance).toEqual({ AGGREGATOR: 'AUTO', ONLINE: 'MANUAL', KIOSK: 'AUTO' });
      expect(policy.timeoutMinutes).toBe(8);
      expect(policy.timeoutAction).toBe('REJECT');
    });

    it('ignores values it cannot use rather than acting on them', () => {
      const policy = resolveIncomingOrderPolicy({
        incomingOrders: {
          acceptance: { KIOSK: 'SOMETIMES' },
          timeoutMinutes: -3,
          timeoutAction: 'EXPLODE',
          defaultPrepMinutes: 500,
        },
      });

      expect(policy).toEqual(INCOMING_ORDER_POLICY_DEFAULTS);
    });
  });

  describe('applying it', () => {
    let service: IncomingOrderPolicyService;
    let orderRepo: any;
    let alertRepo: any;
    let orderService: any;
    let settingRows: any[];

    const NOW = new Date('2026-09-11T12:00:00Z');
    const minutesAgo = (minutes: number) => new Date(NOW.getTime() - minutes * 60000);
    const pending = (overrides: Record<string, any> = {}) => ({
      id: 'o-1',
      tenant_id: 't-1',
      branch_id: 'b-1',
      order_number: 'SNP-SF-1',
      channel: 'AGGREGATOR',
      state: 'PENDING_ACCEPTANCE',
      placed_at: minutesAgo(1),
      ...overrides,
    });
    const branchSetting = (incomingOrders: Record<string, any>) => ({
      tenant_id: 't-1',
      branch_id: 'b-1',
      key: 'ORDER_WORKFLOW',
      value: { incomingOrders },
    });

    beforeEach(async () => {
      settingRows = [];
      orderRepo = { findOne: jest.fn(), find: jest.fn().mockResolvedValue([]) };
      alertRepo = { create: jest.fn((dto: any) => dto), save: jest.fn((dto: any) => Promise.resolve(dto)) };
      orderService = {
        acceptIncomingOrder: jest.fn((_t: string, id: string) => Promise.resolve({ id, state: 'CONFIRMED' })),
        rejectUnanswered: jest.fn((_t: string, id: string) => Promise.resolve({ id, state: 'REJECTED' })),
      };

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          IncomingOrderPolicyService,
          { provide: getRepositoryToken(OrderHeader), useValue: orderRepo },
          { provide: getRepositoryToken(TenantSetting), useValue: { find: jest.fn(() => Promise.resolve(settingRows)) } },
          { provide: getRepositoryToken(OperationalAlert), useValue: alertRepo },
          { provide: OrderService, useValue: orderService },
        ],
      }).compile();

      service = module.get<IncomingOrderPolicyService>(IncomingOrderPolicyService);
    });

    it('leaves a Snappfood order waiting for staff by default', async () => {
      orderRepo.findOne.mockResolvedValue(pending());

      const accepted = await service.applyOnArrival('t-1', 'o-1');

      expect(accepted).toBeNull();
      expect(orderService.acceptIncomingOrder).not.toHaveBeenCalled();
    });

    it('accepts on arrival, through the normal accept, when the branch lets that channel straight through', async () => {
      orderRepo.findOne.mockResolvedValue(pending());
      settingRows = [branchSetting({ acceptance: { AGGREGATOR: 'AUTO' }, defaultPrepMinutes: 25 })];

      const accepted = await service.applyOnArrival('t-1', 'o-1');

      expect(accepted).toEqual(expect.objectContaining({ state: 'CONFIRMED' }));
      expect(orderService.acceptIncomingOrder).toHaveBeenCalledWith('t-1', 'o-1', { prepMinutes: 25 }, undefined, undefined);
    });

    it('rejects an order left past the time limit, alerts its branch, and leaves a younger one alone', async () => {
      orderRepo.find.mockResolvedValue([
        pending({ placed_at: minutesAgo(6) }),
        pending({ id: 'o-2', order_number: 'SNP-SF-2', placed_at: minutesAgo(2) }),
      ]);

      const handled = await service.expireOverdue(NOW);

      expect(handled).toBe(1);
      expect(orderService.rejectUnanswered).toHaveBeenCalledTimes(1);
      expect(orderService.rejectUnanswered).toHaveBeenCalledWith('t-1', 'o-1', 5);
      expect(alertRepo.save).toHaveBeenCalledTimes(1);
      const [alert] = alertRepo.save.mock.calls[0];
      expect(alert).toEqual(
        expect.objectContaining({ tenant_id: 't-1', branch_id: 'b-1', type: 'INCOMING_ORDER_EXPIRED', severity: 'WARNING' }),
      );
      expect(alert.title).toContain('SNP-SF-1');
    });

    it('accepts instead when the branch chose that for an unanswered order', async () => {
      orderRepo.find.mockResolvedValue([pending({ placed_at: minutesAgo(6) })]);
      settingRows = [branchSetting({ timeoutAction: 'ACCEPT' })];

      await service.expireOverdue(NOW);

      expect(orderService.acceptIncomingOrder).toHaveBeenCalledWith('t-1', 'o-1', { prepMinutes: 20 });
      expect(orderService.rejectUnanswered).not.toHaveBeenCalled();
    });

    it('skips an order a cashier answered while the sweep was running, without an alert', async () => {
      orderRepo.find.mockResolvedValue([pending({ placed_at: minutesAgo(6) })]);
      orderService.rejectUnanswered.mockRejectedValue(new ConflictException('already answered'));

      const handled = await service.expireOverdue(NOW);

      expect(handled).toBe(0);
      expect(alertRepo.save).not.toHaveBeenCalled();
    });
  });
});
