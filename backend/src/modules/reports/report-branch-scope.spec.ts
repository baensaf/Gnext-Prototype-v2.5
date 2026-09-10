import * as fs from 'fs';
import * as path from 'path';

/**
 * Every report answers about one branch, or says why it cannot.
 *
 * `queryReport` settles the branch before the switch — a branch account's own branch is
 * forced into `filters` whatever it asked for. Twenty-two of the twenty-five cases then
 * never read it, so a Downtown cashier ran `cashier-shifts` and got Central Plaza's cash
 * variances. The filter was prepared and ignored.
 *
 * Reading the cases back out of the source is what keeps working when somebody adds a
 * report: a hand-written list of the twenty-five would still pass while the twenty-sixth
 * shipped unscoped. Each case has to do one of three things, and this fails until it does.
 */
const SOURCE = fs.readFileSync(path.join(__dirname, 'reports.service.ts'), 'utf8');

/** How a case may be confined to the caller's branch. */
const CONFINED = [
  /applyBranchViaOrder/, //        rows that hang off an order
  /branchWhere\(branchId\)/, //    tables carrying their own branch_id
  /branchOrderIds/, //             the same order hop, resolved to ids for `find`
  /andWhere\([^)]*branch_id/, //   a hand-written clause
  /scopedSettlements/, //          settlement lines, via the settlement that owns them
];

/** Cases that hold no data at all, so there is nothing to attribute. */
const EMPTY_STUBS = ['v5-preview-inventory'];

function reportCases(): Array<{ code: string; body: string }> {
  const parts = SOURCE.split(/case '([a-z0-9-]+)': \{/);
  const out: Array<{ code: string; body: string }> = [];
  for (let i = 1; i < parts.length; i += 2) {
    out.push({ code: parts[i], body: parts[i + 1].split(/\n      case '/)[0] });
  }
  return out;
}

function chainOnlyCodes(): string[] {
  const match = SOURCE.match(/CHAIN_ONLY_REPORTS = \[([^\]]*)\]/);
  if (!match) return [];
  return match[1].split(',').map((entry) => entry.trim().replace(/'/g, '')).filter(Boolean);
}

describe('what a branch may read out of a report', () => {
  it('finds the report cases at all', () => {
    // Guards the test: if the switch is ever restructured, an empty list would make every
    // assertion below pass while proving nothing.
    expect(reportCases().length).toBeGreaterThan(20);
  });

  it('forces a branch account onto its own branch before the switch runs', () => {
    expect(SOURCE).toContain('filters = { ...filters, branchId: actor.branchId }');
  });

  it('leaves no report reading the whole chain by accident', () => {
    const chainOnly = chainOnlyCodes();

    const unaccounted = reportCases()
      .filter(({ code }) => !chainOnly.includes(code))
      .filter(({ code }) => !EMPTY_STUBS.includes(code))
      // A case may opt out, but it has to say so in its own words rather than by omission.
      .filter(({ body }) => !body.includes('Deliberately chain-wide'))
      .filter(({ body }) => !CONFINED.some((pattern) => pattern.test(body)))
      .map(({ code }) => code);

    expect(unaccounted).toEqual([]);
  });

  it('keeps the reports that have no branch to give behind the chain-only gate', () => {
    // An integration log carries no branch and cannot be attributed to one, so a branch
    // account is refused rather than shown the chain's traffic.
    expect(chainOnlyCodes()).toEqual(
      expect.arrayContaining(['branch-comparison', 'snappfood-reconciliation', 'integration-operations']),
    );
  });

  it('does not read settlement lines across the tenant boundary', () => {
    // These lines carry neither a tenant nor a branch; they hang off a settlement that has
    // both. `find()` with no argument read every tenant's.
    expect(SOURCE).not.toContain('this.settlementLineRepo.find();');
  });
});
