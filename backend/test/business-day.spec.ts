import { BusinessClock, businessDaySettingProblem, readBusinessDayConfig } from '../src/common/utils/business-day';

// The overnight business day: a restaurant open 08:00–04:00 turns its day over at 04:00, not at
// midnight, on its own branch's clock. (The default cutoff is 05:00; these spell out 04:00.)
const at4 = { cutoff: '04:00' };
const tehran = BusinessClock.fromConfig(at4, 'Asia/Tehran'); // UTC+03:30 all year
const dubai = BusinessClock.fromConfig(at4, 'Asia/Dubai'); // UTC+04:00
const london = BusinessClock.fromConfig(at4, 'Europe/London'); // BST/GMT

/** A wall-clock time in Tehran, as an instant. */
const tehranAt = (local: string) => new Date(`${local}+03:30`);

describe('the business day at a 04:00 cutoff', () => {
  it('keeps a sale at 01:30 on the day before', () => {
    expect(tehran.dateAt(tehranAt('2026-09-25T01:30:00'))).toBe('2026-09-24');
  });

  it('starts the new day at exactly 04:00', () => {
    expect(tehran.dateAt(tehranAt('2026-09-25T03:59:59.999'))).toBe('2026-09-24');
    expect(tehran.dateAt(tehranAt('2026-09-25T04:00:00'))).toBe('2026-09-25');
  });

  it('does not turn over at midnight', () => {
    expect(tehran.dateAt(tehranAt('2026-09-24T23:59:59'))).toBe('2026-09-24');
    expect(tehran.dateAt(tehranAt('2026-09-25T00:00:00'))).toBe('2026-09-24');
    expect(tehran.dateAt(tehranAt('2026-09-25T00:00:01'))).toBe('2026-09-24');
  });

  it('dates the whole of an 08:00–04:00 night to the day it opened', () => {
    for (const t of ['2026-09-24T08:00:00', '2026-09-24T13:00:00', '2026-09-24T22:00:00', '2026-09-25T02:00:00', '2026-09-25T03:30:00']) {
      expect(tehran.dateAt(tehranAt(t))).toBe('2026-09-24');
    }
  });

  it('bounds a business day from one cutoff to the next', () => {
    expect(tehran.startOf('2026-09-24').toISOString()).toBe('2026-09-24T00:30:00.000Z'); // 04:00 Tehran
    expect(tehran.endOf('2026-09-24').toISOString()).toBe('2026-09-25T00:29:59.999Z'); // 03:59:59.999 next day
  });

  it('honours the cutoff head office sets', () => {
    const late = BusinessClock.fromConfig({ cutoff: '05:30' }, 'Asia/Tehran');
    expect(late.dateAt(tehranAt('2026-09-25T05:00:00'))).toBe('2026-09-24');
    expect(late.dateAt(tehranAt('2026-09-25T05:30:00'))).toBe('2026-09-25');
  });
});

describe('branches in different time zones', () => {
  it('turns each branch over at its own 04:00', () => {
    const at = new Date('2026-09-25T00:15:00Z'); // 03:45 in Tehran, 04:15 in Dubai
    expect(tehran.dateAt(at)).toBe('2026-09-24');
    expect(dubai.dateAt(at)).toBe('2026-09-25');
  });

  it('reads the cutoff on the local clock through a daylight-saving change', () => {
    // Clocks in London go back at 02:00 BST on 25 October 2026, so that business day is 25 hours.
    expect(london.startOf('2026-10-24').toISOString()).toBe('2026-10-24T03:00:00.000Z'); // 04:00 BST
    expect(london.startOf('2026-10-25').toISOString()).toBe('2026-10-25T04:00:00.000Z'); // 04:00 GMT
    expect(london.dateAt(new Date('2026-10-25T03:30:00Z'))).toBe('2026-10-24'); // 03:30 GMT
    expect(london.dateAt(new Date('2026-10-25T04:00:00Z'))).toBe('2026-10-25');
  });

  it('copes with a cutoff that does not exist on the day the clocks go forward', () => {
    // New York skips 02:00–03:00 on 8 March 2026; a 02:30 cutoff starts that day at 03:00 EDT.
    const ny = BusinessClock.fromConfig({ cutoff: '02:30' }, 'America/New_York');
    expect(ny.startOf('2026-03-08').toISOString()).toBe('2026-03-08T07:00:00.000Z');
    expect(ny.dateAt(new Date('2026-03-08T06:59:00Z'))).toBe('2026-03-07'); // 01:59 EST
  });
});

describe('the BUSINESS_DAY setting', () => {
  it('accepts the default overnight day', () => {
    expect(businessDaySettingProblem({ cutoff: '05:00' })).toBeNull();
  });

  it('refuses a cutoff in the afternoon, which would name the day after the next morning', () => {
    expect(businessDaySettingProblem({ cutoff: '13:00' })).toMatch(/before 12:00/);
  });

  it('refuses a time that is not HH:MM', () => {
    expect(businessDaySettingProblem({ cutoff: '4am' })).toMatch(/HH:MM/);
  });

  it('keeps only the cutoff, and takes the default for anything missing or unreadable', () => {
    expect(readBusinessDayConfig({ opensAt: '09:00', autoClose: false })).toEqual({ cutoff: '05:00' });
    expect(readBusinessDayConfig({ cutoff: '13:00' })).toEqual({ cutoff: '05:00' });
    expect(readBusinessDayConfig({ cutoff: '03:30' })).toEqual({ cutoff: '03:30' });
  });
});
