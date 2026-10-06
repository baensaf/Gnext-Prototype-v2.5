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
} from '../src/utils/cloud-link.ts';

let failures = 0;
function check(ok, message) {
  if (!ok) {
    failures += 1;
    console.error(`FAIL ${message}`);
  }
}
const eq = (got, want, message) => check(got === want, `${message}: got ${got}, want ${want}`);

const none = {
  requestsFailingSince: null,
  probeDownSince: null,
  agentDownSince: null,
  lastAnsweredAt: null,
};

// 1. Which signal counts, and since when.
eq(unreachableSince(none), null, 'nothing wrong');
eq(unreachableSince({ ...none, requestsFailingSince: 1000 }), 1000, 'requests with no answer');
eq(
  unreachableSince({ ...none, agentDownSince: 2000 }),
  2000,
  'the agent says its cloud connection is down'
);
eq(unreachableSince({ ...none, probeDownSince: 700 }), 700, 'the own check is not answered');
eq(
  unreachableSince({
    ...none,
    probeDownSince: 700,
    requestsFailingSince: 900,
    agentDownSince: 800,
  }),
  700,
  'all three: the earliest'
);
eq(
  unreachableSince({ ...none, probeDownSince: 700, agentDownSince: 500, lastAnsweredAt: 600 }),
  700,
  'the check still counts when a request was answered after the agent said down'
);
eq(
  unreachableSince({
    ...none,
    requestsFailingSince: 3000,
    agentDownSince: 2000,
    lastAnsweredAt: 1000,
  }),
  2000,
  'both: the earlier one'
);
eq(
  unreachableSince({
    ...none,
    requestsFailingSince: 1500,
    agentDownSince: 2000,
    lastAnsweredAt: 1000,
  }),
  1500,
  'both: the earlier one, the other way round'
);

// 2. A request answered after the agent said "down" shows the cloud is there: the agent's word no
//    longer counts, the requests' still do.
eq(
  unreachableSince({
    ...none,
    requestsFailingSince: null,
    agentDownSince: 2000,
    lastAnsweredAt: 2500,
  }),
  null,
  'answered since the agent said down'
);
eq(
  unreachableSince({
    ...none,
    requestsFailingSince: null,
    agentDownSince: 2000,
    lastAnsweredAt: 2000,
  }),
  null,
  'answered at the very moment'
);
eq(
  unreachableSince({
    ...none,
    requestsFailingSince: null,
    agentDownSince: 2000,
    lastAnsweredAt: 1999,
  }),
  2000,
  'answered before the agent said down'
);
eq(
  unreachableSince({
    ...none,
    requestsFailingSince: 4000,
    agentDownSince: 2000,
    lastAnsweredAt: 3000,
  }),
  4000,
  'answered since the agent said down, then the requests failed'
);

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
