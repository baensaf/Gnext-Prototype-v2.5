import { printableOrderNote } from '../src/modules/order/order-notes';

describe('printableOrderNote', () => {
  it("prints only the customer's note from a platform order's details", () => {
    const notes = ['Snappfood order SF-1', 'Customer: Sara', 'Phone: 0912', 'Address: Tehran', 'Note: no pickles'].join('\n');
    expect(printableOrderNote({ channel: 'AGGREGATOR', notes })).toBe('no pickles');
  });

  it('prints nothing for a platform order whose customer wrote no note', () => {
    expect(printableOrderNote({ channel: 'AGGREGATOR', notes: 'Snappfood order SF-2\nPhone: 0912' })).toBeUndefined();
  });

  it("prints a till or kiosk order's note as written", () => {
    expect(printableOrderNote({ channel: 'POS', notes: ' ring on arrival ' })).toBe('ring on arrival');
    expect(printableOrderNote({ channel: 'KIOSK', notes: null })).toBeUndefined();
  });
});
