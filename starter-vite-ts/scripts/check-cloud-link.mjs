/**
 * Checks the rules of the Reconnecting bar (src/utils/cloud-link.ts, agent-protocol.md §19.10): when
 * the cloud counts as out of reach, when the bar shows, and when it says there is no internet. The
 * frontend has no unit-test runner, so this is a plain script:
 *
 *   node scripts/check-cloud-link.mjs
 *
 * It loads the TypeScript file as it is, which needs Node 22.18 or newer.
 */
import {
  barPhase,
  BAR_AFTER_MS,
  OFFLINE_AFTER_MS,
  unreachableSince,
  agentShowsRecovery,
} from '../src/utils/cloud-link.ts';

let failures = 0;
function check(ok, message) {
  if (!ok) {
    failures += 1;
    console.error(`FAIL ${message}`);
  }
}
const eq = (got, want, message) => check(got === want, `${message}: got ${got}, want ${want}`);

const none = { requestsFailingSince: null, agentUnreachableSince: null };

// 1. Which signal counts, and since when.
eq(unreachableSince(none), null, 'nothing wrong');
eq(unreachableSince({ ...none, requestsFailingSince: 1000 }), 1000, 'requests with no answer');
eq(unreachableSince({ ...none, agentUnreachableSince: 2000 }), 2000, 'the agent says unreachable');
eq(
  unreachableSince({ requestsFailingSince: 3000, agentUnreachableSince: 2000 }),
  2000,
  'both: the earlier one'
);
eq(
  unreachableSince({ requestsFailingSince: 1500, agentUnreachableSince: 2000 }),
  1500,
  'both: the earlier one, the other way round'
);

// 2. The agent saying "reachable" clears requests that failed before the poll began, and only
//    those: not one that failed during it, not when the agent says unreachable, not when none failed.
eq(
  agentShowsRecovery(true, 1000, 2000),
  true,
  'a failure before the poll, the agent says reachable'
);
eq(agentShowsRecovery(true, 2500, 2000), false, 'a failure after the poll began');
eq(agentShowsRecovery(false, 1000, 2000), false, 'the agent says unreachable');
eq(agentShowsRecovery(true, null, 2000), false, 'no request is failing');

// 3. The bar: hidden for 2 s, Reconnecting from 2 s, No internet from 2 minutes.
eq(BAR_AFTER_MS, 2000, 'the bar waits 2 s');
eq(OFFLINE_AFTER_MS, 120000, 'the second message comes after 2 minutes');
eq(barPhase(null, 5000), 'hidden', 'reachable');
eq(barPhase(10000, 10000), 'hidden', 'just failed');
eq(barPhase(10000, 11999), 'hidden', 'not yet 2 s');
eq(barPhase(10000, 12000), 'reconnecting', '2 s');
eq(barPhase(10000, 10000 + 119999), 'reconnecting', 'not yet 2 minutes');
eq(barPhase(10000, 10000 + 120000), 'offline', '2 minutes');
eq(barPhase(10000, 10000 + 600000), 'offline', '10 minutes');
eq(barPhase(10000, 9000), 'hidden', 'a clock that went back');

if (failures > 0) {
  console.error(`${failures} check(s) failed.`);
  process.exit(1);
}
console.log('OK: the cloud-link rules hold.');
