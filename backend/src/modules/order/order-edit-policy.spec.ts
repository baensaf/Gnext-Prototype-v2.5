import {
  ORDER_ACTION_DEFAULTS,
  OrderEditContext,
  minutesSinceSubmission,
  resolveOrderActionConfig,
  resolveOrderEditDecision,
} from './order-edit-policy';
import { OrderState } from '../../entities/OrderHeader.entity';

const NOW = new Date('2026-09-09T12:00:00.000Z');
const minutesAgo = (n: number) => new Date(NOW.getTime() - n * 60000);

const ctx = (over: Partial<OrderEditContext> = {}): OrderEditContext => ({
  state: 'SUBMITTED',
  submittedAt: minutesAgo(1),
  paidTotal: '0.0000',
  ...over,
});

const decide = (
  action: Parameters<typeof resolveOrderEditDecision>[0],
  over: Partial<OrderEditContext> = {},
  line?: { state: string },
) => resolveOrderEditDecision(action, ctx(over), ORDER_ACTION_DEFAULTS, NOW, line).decision;

describe('resolveOrderActionConfig', () => {
  it('defaults to the spec seed of a 10 minute edit and cancel window', () => {
    expect(resolveOrderActionConfig(null)).toEqual({ editWindowMinutes: 10, cancelWindowMinutes: 10 });
    expect(resolveOrderActionConfig({})).toEqual(ORDER_ACTION_DEFAULTS);
  });

  it('takes valid tenant overrides', () => {
    expect(resolveOrderActionConfig({ editWindowMinutes: 0, cancelWindowMinutes: 45 })).toEqual({
      editWindowMinutes: 0,
      cancelWindowMinutes: 45,
    });
  });

  it('falls back per key rather than throwing on a malformed row', () => {
    expect(resolveOrderActionConfig({ editWindowMinutes: -5, cancelWindowMinutes: 20 })).toEqual({
      editWindowMinutes: 10,
      cancelWindowMinutes: 20,
    });
    expect(resolveOrderActionConfig({ editWindowMinutes: 'soon', cancelWindowMinutes: 2.5 })).toEqual(
      ORDER_ACTION_DEFAULTS,
    );
  });
});

describe('minutesSinceSubmission', () => {
  it('returns null when the order was never submitted', () => {
    expect(minutesSinceSubmission(null, NOW)).toBeNull();
  });

  it('floors to whole elapsed minutes', () => {
    expect(minutesSinceSubmission(minutesAgo(0), NOW)).toBe(0);
    expect(minutesSinceSubmission(new Date(NOW.getTime() - 599_999), NOW)).toBe(9);
  });

  it('clamps clock skew that puts submission in the future', () => {
    expect(minutesSinceSubmission(new Date(NOW.getTime() + 60_000), NOW)).toBe(0);
  });
});

describe('order edit policy: cashier window', () => {
  it('allows a cashier edit inside the window', () => {
    expect(decide('VOID_ITEM', { submittedAt: minutesAgo(9) })).toBe('ALLOW');
  });

  it('treats the exact boundary as outside the window, per spec 7.9', () => {
    expect(decide('VOID_ITEM', { submittedAt: minutesAgo(10) })).toBe('REQUIRE_APPROVAL');
  });

  it('escalates past the window', () => {
    expect(decide('VOID_ITEM', { submittedAt: minutesAgo(11) })).toBe('REQUIRE_APPROVAL');
    expect(decide('REPLACE_ITEM', { submittedAt: minutesAgo(60) })).toBe('REQUIRE_APPROVAL');
  });

  it('applies the cancel window to cancellation independently', () => {
    const config = { editWindowMinutes: 5, cancelWindowMinutes: 30 };
    const at20 = ctx({ submittedAt: minutesAgo(20) });
    expect(resolveOrderEditDecision('VOID_ITEM', at20, config, NOW).decision).toBe('REQUIRE_APPROVAL');
    expect(resolveOrderEditDecision('CANCEL_ORDER', at20, config, NOW).decision).toBe('ALLOW');
  });

  it('fails closed when a submitted order has no submitted_at', () => {
    expect(decide('VOID_ITEM', { submittedAt: null })).toBe('REQUIRE_APPROVAL');
  });

  it('honours a zero-minute window as "always escalate"', () => {
    const zero = { editWindowMinutes: 0, cancelWindowMinutes: 0 };
    expect(resolveOrderEditDecision('VOID_ITEM', ctx({ submittedAt: minutesAgo(0) }), zero, NOW).decision).toBe(
      'REQUIRE_APPROVAL',
    );
  });
});

describe('order edit policy: money on the order', () => {
  it('escalates any removal once payment has landed, even inside the window', () => {
    expect(decide('VOID_ITEM', { submittedAt: minutesAgo(1), paidTotal: '50000.0000' })).toBe(
      'REQUIRE_APPROVAL',
    );
    expect(decide('REPLACE_ITEM', { submittedAt: minutesAgo(1), paidTotal: '50000.0000' })).toBe(
      'REQUIRE_APPROVAL',
    );
  });

  it('escalates cancelling a paid order, even inside the cancel window', () => {
    expect(decide('CANCEL_ORDER', { submittedAt: minutesAgo(1), paidTotal: '50000.0000' })).toBe(
      'REQUIRE_APPROVAL',
    );
    expect(
      resolveOrderEditDecision(
        'CANCEL_ORDER',
        ctx({ submittedAt: minutesAgo(1), paidTotal: '50000.0000' }),
        ORDER_ACTION_DEFAULTS,
        NOW,
      ).reason,
    ).toBe('CANCEL_AGAINST_PAID_ORDER');
  });

  it('leaves an unpaid cancel inside the window to the cashier', () => {
    expect(decide('CANCEL_ORDER', { submittedAt: minutesAgo(1), paidTotal: '0.0000' })).toBe('ALLOW');
  });

  it('still allows appending to a paid order, which only raises the outstanding balance', () => {
    expect(decide('ADD_ITEM', { paidTotal: '50000.0000' })).toBe('ALLOW');
  });
});

describe('order edit policy: open-check appending', () => {
  it.each<OrderState>(['DRAFT', 'SUBMITTED', 'CONFIRMED', 'PREPARING', 'READY'])(
    'allows adding an item while the check is open in %s',
    (state) => {
      expect(decide('ADD_ITEM', { state, submittedAt: minutesAgo(120) })).toBe('ALLOW');
    },
  );

  it('refuses to append once the food has left with a courier', () => {
    expect(decide('ADD_ITEM', { state: 'OUT_FOR_DELIVERY' })).toBe('FORBID');
  });
});

describe('order edit policy: fulfillment stages', () => {
  it('escalates every removal once preparation starts, regardless of window', () => {
    expect(decide('VOID_ITEM', { state: 'PREPARING', submittedAt: minutesAgo(0) })).toBe(
      'REQUIRE_APPROVAL',
    );
    expect(decide('REPLACE_ITEM', { state: 'READY', submittedAt: minutesAgo(0) })).toBe(
      'REQUIRE_APPROVAL',
    );
    expect(decide('CANCEL_ORDER', { state: 'PREPARING', submittedAt: minutesAgo(0) })).toBe(
      'REQUIRE_APPROVAL',
    );
  });

  it('locks item edits out for delivery but keeps an approved cancellation path', () => {
    expect(decide('VOID_ITEM', { state: 'OUT_FOR_DELIVERY' })).toBe('FORBID');
    expect(decide('REPLACE_ITEM', { state: 'OUT_FOR_DELIVERY' })).toBe('FORBID');
    expect(decide('CANCEL_ORDER', { state: 'OUT_FOR_DELIVERY' })).toBe('REQUIRE_APPROVAL');
  });

  it('forbids everything on a terminal order', () => {
    for (const action of ['ADD_ITEM', 'VOID_ITEM', 'REPLACE_ITEM', 'CANCEL_ORDER'] as const) {
      expect(decide(action, { state: 'COMPLETED' })).toBe('FORBID');
      expect(decide(action, { state: 'CANCELLED' })).toBe('FORBID');
    }
  });
});

describe('order edit policy: line guards', () => {
  it('refuses to act twice on the same line', () => {
    expect(decide('VOID_ITEM', {}, { state: 'VOID' })).toBe('FORBID');
    expect(decide('REPLACE_ITEM', {}, { state: 'REPLACED' })).toBe('FORBID');
  });

  it('acts normally on an active line', () => {
    expect(decide('VOID_ITEM', {}, { state: 'ACTIVE' })).toBe('ALLOW');
  });

  it('reports why a line was refused', () => {
    const res = resolveOrderEditDecision('VOID_ITEM', ctx(), ORDER_ACTION_DEFAULTS, NOW, { state: 'VOID' });
    expect(res.reason).toBe('LINE_NOT_ACTIVE:VOID');
  });
});
