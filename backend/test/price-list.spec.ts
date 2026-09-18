import { inStorePrice, isLiveAt, listPricesAt, priceKey } from '../src/common/utils/price-list.util';

describe('Branch price list resolution', () => {
  const at = new Date('2026-09-20T12:00:00Z');
  const burger = { id: 'p-burger', base_price: '150000.0000' };
  const small = { id: 'v-small', base_price: '120000.0000' };
  const entry = (over: Partial<{ product_id: string; variant_id: string | null; amount: string; effective_from: string; effective_to: string | null }>) => ({
    product_id: burger.id,
    variant_id: null,
    amount: '170000',
    effective_from: '2026-09-01T00:00:00Z',
    effective_to: null,
    ...over,
  });

  it("uses the list's price, else the size's base price, else the product's", () => {
    const listed = listPricesAt([entry({})], at);
    expect(inStorePrice(listed, burger, null)).toBe('170000.0000');
    expect(inStorePrice(new Map(), burger, null)).toBe('150000.0000');
    expect(inStorePrice(new Map(), burger, small)).toBe('120000.0000');
  });

  it("prices a size by its own entry only, not the product's", () => {
    const listed = listPricesAt([entry({}), entry({ variant_id: small.id, amount: '130000' })], at);
    expect(inStorePrice(listed, burger, small)).toBe('130000.0000');

    const productOnly = listPricesAt([entry({})], at);
    expect(inStorePrice(productOnly, burger, small)).toBe('120000.0000');
  });

  it('ignores prices that have ended or not started yet', () => {
    const ended = entry({ effective_to: '2026-09-10T00:00:00Z' });
    const future = entry({ effective_from: '2026-10-01T00:00:00Z', amount: '999000' });
    expect(listPricesAt([ended, future], at).size).toBe(0);
    // An entry ends at its effective_to: the replacement starting then is the one in force.
    expect(isLiveAt(entry({ effective_to: at.toISOString() }), at)).toBe(false);
    expect(isLiveAt(entry({ effective_from: at.toISOString() }), at)).toBe(true);
  });

  it('takes the later start when two entries overlap', () => {
    const listed = listPricesAt(
      [entry({ amount: '160000', effective_from: '2026-09-01T00:00:00Z' }), entry({ amount: '175000', effective_from: '2026-09-15T00:00:00Z' })],
      at,
    );
    expect(listed.get(priceKey(burger.id))).toBe('175000.0000');
  });
});
