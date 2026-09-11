/**
 * How a branch treats orders that arrive from outside its tills: which channels wait for
 * staff to accept them, how long they may wait, and what happens when nobody answers.
 * Stored as `incomingOrders` inside the branch-overridable ORDER_WORKFLOW setting.
 */
export type IncomingChannel = 'AGGREGATOR' | 'ONLINE' | 'KIOSK';
export type AcceptanceMode = 'MANUAL' | 'AUTO';
export type TimeoutAction = 'REJECT' | 'ACCEPT';

export interface IncomingOrderPolicy {
  acceptance: Record<IncomingChannel, AcceptanceMode>;
  timeoutMinutes: number;
  timeoutAction: TimeoutAction;
  /** Where the prep time on an accept starts; an automatic accept uses it as it is. */
  defaultPrepMinutes: number;
}

/**
 * Agreed with the product owner on 2026-09-11: Snappfood and the website wait for staff,
 * the kiosk goes straight through (the customer is standing there and has usually paid),
 * and an order nobody answers within 5 minutes is rejected, because Snappfood penalises a
 * store that stays silent.
 */
export const INCOMING_ORDER_POLICY_DEFAULTS: IncomingOrderPolicy = {
  acceptance: { AGGREGATOR: 'MANUAL', ONLINE: 'MANUAL', KIOSK: 'AUTO' },
  timeoutMinutes: 5,
  timeoutAction: 'REJECT',
  defaultPrepMinutes: 20,
};

const CHANNELS: IncomingChannel[] = ['AGGREGATOR', 'ONLINE', 'KIOSK'];
const MAX_TIMEOUT_MINUTES = 60;
/** Snappfood refuses a promised time above 70 minutes. */
const MAX_PREP_MINUTES = 70;

const wholeNumberIn = (value: unknown, min: number, max: number): number | undefined => {
  const n = Number(value);
  return Number.isInteger(n) && n >= min && n <= max ? n : undefined;
};

/** A value that is missing or unusable falls back to the default rather than being acted on. */
export function resolveIncomingOrderPolicy(workflow?: unknown): IncomingOrderPolicy {
  const stored = workflow && typeof workflow === 'object' ? (workflow as any).incomingOrders : undefined;
  const set: Record<string, any> = stored && typeof stored === 'object' ? stored : {};
  const defaults = INCOMING_ORDER_POLICY_DEFAULTS;

  const acceptance = { ...defaults.acceptance };
  for (const channel of CHANNELS) {
    const mode = set.acceptance?.[channel];
    if (mode === 'MANUAL' || mode === 'AUTO') acceptance[channel] = mode;
  }

  return {
    acceptance,
    timeoutMinutes: wholeNumberIn(set.timeoutMinutes, 1, MAX_TIMEOUT_MINUTES) ?? defaults.timeoutMinutes,
    timeoutAction: set.timeoutAction === 'ACCEPT' || set.timeoutAction === 'REJECT' ? set.timeoutAction : defaults.timeoutAction,
    defaultPrepMinutes: wholeNumberIn(set.defaultPrepMinutes, 1, MAX_PREP_MINUTES) ?? defaults.defaultPrepMinutes,
  };
}

/**
 * Whether an order on this channel waits for staff. A channel the policy does not name is
 * treated as waiting: something already decided the order should be answered by a person.
 */
export function acceptanceFor(policy: IncomingOrderPolicy, channel?: string | null): AcceptanceMode {
  const named = channel === 'SNAPPFOOD' ? 'AGGREGATOR' : channel;
  return CHANNELS.includes(named as IncomingChannel) ? policy.acceptance[named as IncomingChannel] : 'MANUAL';
}
