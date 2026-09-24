import {
  BusinessClock,
  BusinessDayRule,
  businessDaySettingProblem,
  policyFor,
  readBusinessDayConfig,
  timelineAfterChange,
} from '../src/common/utils/business-day';

// The overnight business day: a restaurant open 08:00–04:00 turns its day over at 04:00, not at
// midnight, on its own branch's clock.
const tehran = BusinessClock.fromConfig({}, 'Asia/Tehran'); // UTC+03:30 all year
const dubai = BusinessClock.fromConfig({}, 'Asia/Dubai'); // UTC+04:00
const london = BusinessClock.fromConfig({}, 'Europe/London'); // BST/GMT

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

  it("gives the day's operating hours, 08:00 to 04:00 the next morning", () => {
    const { opensAt, closesAt } = tehran.hoursOf('2026-09-24');
    expect(opensAt.toISOString()).toBe('2026-09-24T04:30:00.000Z');
    expect(closesAt.toISOString()).toBe('2026-09-25T00:30:00.000Z');
    expect(tehran.isOpen(tehranAt('2026-09-25T01:30:00'))).toBe(true);
    expect(tehran.isOpen(tehranAt('2026-09-25T05:00:00'))).toBe(false);
  });

  it('honours a cutoff set for the chain or a branch', () => {
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

describe('changing the rule never re-dates the past or runs the clock backwards', () => {
  const legacy: BusinessDayRule = { cutoff: '00:00', time_zone: 'Asia/Tehran', at: null, from: null };
  const clockWith = (rules: BusinessDayRule[]) => new BusinessClock({ ...readBusinessDayConfig({}), timeZone: 'Asia/Tehran', rules, since: null });

  it('keeps midnight dating for everything before the switch to 04:00', () => {
    // Deployed at 14:00 on the 24th: the night before was dated the old way and stays so.
    const switchAt = tehranAt('2026-09-24T14:00:00');
    const clock = clockWith([legacy, { cutoff: '04:00', time_zone: 'Asia/Tehran', at: switchAt.toISOString(), from: '2026-09-24' }]);
    expect(clock.dateAt(tehranAt('2026-09-24T01:30:00'))).toBe('2026-09-24'); // before: midnight rule
    expect(clock.dateAt(tehranAt('2026-09-25T01:30:00'))).toBe('2026-09-24'); // after: cutoff rule
    expect(clock.dateAt(tehranAt('2026-09-25T04:00:00'))).toBe('2026-09-25');
  });

  it('does not send a till back to yesterday when the switch happens after midnight', () => {
    // Deployed at 02:00 on the 25th, when midnight dating already said the 25th.
    const switchAt = tehranAt('2026-09-25T02:00:00');
    const clock = clockWith([legacy, { cutoff: '04:00', time_zone: 'Asia/Tehran', at: switchAt.toISOString(), from: '2026-09-25' }]);
    expect(clock.dateAt(tehranAt('2026-09-25T03:00:00'))).toBe('2026-09-25');
    expect(clock.dateAt(tehranAt('2026-09-25T04:00:00'))).toBe('2026-09-25');
    expect(clock.dateAt(tehranAt('2026-09-26T01:30:00'))).toBe('2026-09-25');
    expect(clock.dateAt(tehranAt('2026-09-26T04:00:00'))).toBe('2026-09-26');
    // The 25th ran from midnight (old rule) to 04:00 on the 26th (new rule).
    expect(clock.startOf('2026-09-25').toISOString()).toBe('2026-09-24T20:30:00.000Z');
    expect(clock.endOf('2026-09-25').toISOString()).toBe('2026-09-26T00:29:59.999Z');
  });

  it('holds the date when a cutoff moves later during the night', () => {
    const before = tehran;
    const changedAt = tehranAt('2026-09-25T04:30:00'); // already the 25th under 04:00
    const timeline = timelineAfterChange(before, { cutoff: '05:00', time_zone: 'Asia/Tehran' }, changedAt, null);
    const after = clockWith(timeline.rules);
    expect(after.dateAt(tehranAt('2026-09-25T04:45:00'))).toBe('2026-09-25'); // not back to the 24th
    expect(after.dateAt(tehranAt('2026-09-26T04:30:00'))).toBe('2026-09-25'); // the new cutoff from here on
    expect(after.dateAt(tehranAt('2026-09-26T05:00:00'))).toBe('2026-09-26');
    expect(after.dateAt(tehranAt('2026-09-24T02:00:00'))).toBe('2026-09-23'); // the past is as it was
  });

  it('records nothing when nothing changed', () => {
    const timeline = timelineAfterChange(tehran, { cutoff: '04:00', time_zone: 'Asia/Tehran' }, new Date(), '2026-09-01');
    expect(timeline.rules).toBe(tehran.policy.rules);
  });

  it('never gives an earlier date to a later instant, across rule changes', () => {
    const clock = clockWith([
      legacy,
      { cutoff: '04:00', time_zone: 'Asia/Tehran', at: tehranAt('2026-09-25T02:00:00').toISOString(), from: '2026-09-25' },
      { cutoff: '05:00', time_zone: 'Asia/Dubai', at: tehranAt('2026-09-27T04:40:00').toISOString(), from: '2026-09-27' },
      { cutoff: '03:00', time_zone: 'Asia/Tehran', at: tehranAt('2026-09-29T03:30:00').toISOString(), from: '2026-09-28' },
    ]);
    let last = '';
    for (let t = tehranAt('2026-09-23T00:00:00').getTime(); t < tehranAt('2026-10-02T00:00:00').getTime(); t += 7 * 60_000) {
      const date = clock.dateAt(t);
      expect(date >= last).toBe(true);
      last = date;
    }
  });

  it('applies a rule written straight to the settings as it stands', () => {
    const policy = policyFor(readBusinessDayConfig({ cutoff: '05:00' }), 'Asia/Tehran', {
      since: '2026-09-01',
      rules: [{ cutoff: '04:00', time_zone: 'Asia/Tehran', at: null, from: null }],
    });
    expect(new BusinessClock(policy).dateAt(tehranAt('2026-09-25T04:30:00'))).toBe('2026-09-24');
  });
});

describe('the BUSINESS_DAY setting', () => {
  it('accepts the default overnight day', () => {
    expect(businessDaySettingProblem({ cutoff: '04:00', opensAt: '08:00', closesAt: '04:00', autoClose: true })).toBeNull();
  });

  it('refuses a cutoff in the afternoon, which would name the day after the next morning', () => {
    expect(businessDaySettingProblem({ cutoff: '13:00' })).toMatch(/before 12:00/);
  });

  it('refuses hours that run past the cutoff', () => {
    expect(businessDaySettingProblem({ cutoff: '04:00', opensAt: '08:00', closesAt: '05:00' })).toMatch(/inside one business day/);
  });

  it('refuses a time that is not HH:MM', () => {
    expect(businessDaySettingProblem({ cutoff: '4am' })).toMatch(/HH:MM/);
    expect(businessDaySettingProblem({ autoClose: 'yes' })).toMatch(/boolean/);
  });

  it('fills what is missing from the defaults', () => {
    expect(readBusinessDayConfig({ opensAt: '09:00' })).toEqual({ cutoff: '04:00', opensAt: '09:00', closesAt: '04:00', autoClose: true });
  });
});
