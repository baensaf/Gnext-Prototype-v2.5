import { nextCode, typedCode } from '../src/common/utils/next-code.util';

// Nobody types a code for a category, printer, payment method, reason, courier, zone, card
// terminal or bank account: the system makes PREFIX-n, never reusing one an archived row held.
describe('nextCode', () => {
  const repo = (codes: string[]) => ({ find: jest.fn().mockResolvedValue(codes.map((code) => ({ code }))) }) as any;

  it('starts at 1', async () => {
    expect(await nextCode(repo([]), { tenant_id: 't' }, 'CAT')).toBe('CAT-1');
  });

  it('skips numbers already taken, archived rows included', async () => {
    const r = repo(['CAT-1', 'cat-3', 'FOOD']);
    expect(await nextCode(r, { tenant_id: 't' }, 'CAT')).toBe('CAT-4');
    expect(r.find).toHaveBeenCalledWith(expect.objectContaining({ withDeleted: true }));
  });

  it('keeps a code someone did type, tidied', () => {
    expect(typedCode(' esp-1 ')).toBe('ESP-1');
    expect(typedCode('  ')).toBeNull();
    expect(typedCode(undefined)).toBeNull();
  });
});
