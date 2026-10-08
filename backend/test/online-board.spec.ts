import { OnlineOrdersService } from '../src/modules/order/online-orders.service';
import { CashierShift } from '../src/entities/CashierShift.entity';
import { channelFor, channelForPlatform } from '../src/modules/order/channels';

// The till's Online panel: every platform order the branch still has to deal with, in lanes,
// with what the platform lets the cashier do. The lanes are decided on the server so the POS
// panel and the full-page board always agree.
describe('the Online board', () => {
  const now = new Date('2026-10-08T12:00:00Z');
  const minutesAgo = (m: number) => new Date(now.getTime() - m * 60000);
  const notes = [
    'Snappfood order SF-1',
    'Customer: Maryam Ahmadi',
    'Phone: +989121234567',
    'Address: Niyayesh, No. 12',
    'Delivery: ZF_EXPRESS',
    'Payment: ONLINE',
    'Note: Ring twice',
  ].join('\n');

  const order = (overrides: Record<string, any>) => ({
    id: overrides.id,
    tenant_id: 't-1',
    branch_id: 'b-1',
    channel: 'AGGREGATOR',
    order_number: `SNP-${overrides.id}`,
    state: 'CONFIRMED',
    placed_at: minutesAgo(10),
    accepted_at: null,
    promised_minutes: null,
    aggregator_expedition: 'ZF_EXPRESS',
    aggregator_prep_minutes: 15,
    aggregator_max_extra_minutes: 10,
    outstanding_total: '0.0000',
    grand_total: '4200000.0000',
    currency_code: 'IRR',
    notes,
    ...overrides,
  });

  let openOrders: any[];
  let alertOrders: any[];
  let shifts: any[];
  let service: OnlineOrdersService;

  beforeEach(() => {
    shifts = [{ id: 's-1', state: 'OPEN', business_date: null }];
    alertOrders = [];
    openOrders = [];
    const orderRepo = {
      // The board asks for open orders first, then for unseen alerts.
      find: jest.fn((options: any) => Promise.resolve(options.where.online_alert ? alertOrders : openOrders)),
      count: jest.fn().mockResolvedValue(7),
    };
    const itemRepo = {
      find: jest.fn().mockResolvedValue([
        { order_id: 'NEW1', product_name: 'Cheeseburger', quantity: '2.0000', line_number: 1 },
        { order_id: 'NEW1', product_name: 'Fries', quantity: '1.0000', line_number: 2 },
      ]),
    };
    const settingRepo = { find: jest.fn().mockResolvedValue([]) };
    const dataSource: any = {
      query: jest.fn().mockResolvedValue([]),
      manager: {
        find: jest.fn((entity: any) => Promise.resolve(entity === CashierShift ? shifts : [])),
        findOne: jest.fn().mockResolvedValue(null),
      },
    };
    const orderService: any = {
      channelOf: (o: any) => channelFor(o, {}),
      platformChannel: (p: any) => channelForPlatform(p, {}),
    };
    const incomingPolicy: any = {
      policyFor: jest.fn().mockResolvedValue({ timeoutMinutes: 5, timeoutAction: 'REJECT', defaultPrepMinutes: 20, acceptance: {} }),
    };
    service = new OnlineOrdersService(orderRepo as any, itemRepo as any, settingRepo as any, dataSource, orderService, incomingPolicy);
  });

  it('puts each order in its lane, from its state', async () => {
    openOrders = [
      order({ id: 'NEW1', state: 'PENDING_ACCEPTANCE', placed_at: minutesAgo(2) }),
      order({ id: 'COOK1', state: 'CONFIRMED', accepted_at: minutesAgo(5), promised_minutes: 20 }),
      order({ id: 'READY1', state: 'READY', accepted_at: minutesAgo(5), promised_minutes: 20 }),
    ];

    const board = await service.board('t-1', 'b-1', now);

    expect(board.cards.map((c) => [c.displayCode, c.lane])).toEqual([
      ['NEW1', 'NEW'],
      ['COOK1', 'PREPARING'],
      ['READY1', 'READY'],
    ]);
    expect(board.doneToday).toBe(7);
    expect(board.shiftOpen).toBe(true);
  });

  it('gives a new order the time the limit answers it, and what the platform allows', async () => {
    openOrders = [order({ id: 'NEW1', state: 'PENDING_ACCEPTANCE', placed_at: minutesAgo(2) })];

    const [card] = (await service.board('t-1', 'b-1', now)).cards;

    expect(card.answerBy).toBe(new Date(minutesAgo(2).getTime() + 5 * 60000).toISOString());
    expect(card.fulfilment).toBe('PLATFORM_RIDER');
    // A Snapp Express rider: Snappfood's prep time plus what this vendor may add.
    expect(card.maxPromiseMinutes).toBe(25);
    expect(card.rejectReasons).toEqual(['TOO_BUSY', 'ITEM_UNAVAILABLE', 'NO_COURIER', 'DELIVERY_FEE']);
    expect(card.items).toEqual([
      { name: 'Cheeseburger', quantity: 2 },
      { name: 'Fries', quantity: 1 },
    ]);
    expect(card.customerName).toBe('Maryam Ahmadi');
    expect(card.note).toBe('Ring twice');
    // Only our own courier needs the address.
    expect(card.address).toBeNull();
  });

  it('flags an accepted order past its promised time as late', async () => {
    openOrders = [order({ id: 'LATE1', accepted_at: minutesAgo(30), promised_minutes: 20 })];

    const [card] = (await service.board('t-1', 'b-1', now)).cards;

    expect(card.late).toBe(true);
    expect(card.promisedAt).toBe(minutesAgo(10).toISOString());
  });

  it('offers a report only within Snappfood\'s hour after accepting', async () => {
    openOrders = [
      order({ id: 'FRESH', accepted_at: minutesAgo(10), promised_minutes: 20 }),
      order({ id: 'OLD', accepted_at: minutesAgo(61), promised_minutes: 70 }),
    ];

    const [fresh, old] = (await service.board('t-1', 'b-1', now)).cards;

    expect(fresh.reportReasons).toContain('MORE_TIME');
    expect(fresh.reportUntil).toBe(new Date(minutesAgo(10).getTime() + 60 * 60000).toISOString());
    expect(old.reportReasons).toEqual([]);
    expect(old.reportUntil).toBeNull();
  });

  it('puts an order with platform support, or an unseen alert, in Issues', async () => {
    openOrders = [order({ id: 'SUP1', accepted_at: minutesAgo(10), aggregator_issue_at: minutesAgo(3), aggregator_issue: '153: Needs 10 more minutes' })];
    alertOrders = [order({ id: 'LOST1', state: 'REJECTED', online_alert: 'TIMED_OUT', online_alert_at: minutesAgo(1), online_alert_seen_at: null })];

    const cards = (await service.board('t-1', 'b-1', now)).cards;

    expect(cards.map((c) => [c.displayCode, c.lane, c.issue])).toEqual([
      ['LOST1', 'ISSUE', 'TIMED_OUT'],
      ['SUP1', 'ISSUE', 'WITH_SUPPORT'],
    ]);
    expect(cards[1].issueText).toContain('Needs 10 more minutes');
  });

  it('shows what a cash order still owes, to be taken when it is collected', async () => {
    openOrders = [order({ id: 'CASH1', aggregator_expedition: 'PICKUP', outstanding_total: '4200000.0000' })];

    const [card] = (await service.board('t-1', 'b-1', now)).cards;

    expect(card.fulfilment).toBe('PICKUP');
    expect(card.collectAmount).toBe('4200000.0000');
  });

  it('says when no shift is open, since accepting needs one', async () => {
    shifts = [];

    const board = await service.board('t-1', 'b-1', now);

    expect(board.shiftOpen).toBe(false);
  });
});
