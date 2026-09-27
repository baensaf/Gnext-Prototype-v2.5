/**
 * Which Phase 1 version ships each page and feature of the prototype.
 *
 * The product manager decides these page by page; the source of truth is the "Feature labels"
 * tab of the Phase 1 decision register. This file mirrors it so that anyone exploring the
 * prototype sees what belongs to which version. A page or feature missing here has not been
 * labelled yet, and shows nothing.
 *
 * A feature with no label of its own ships with its page. Only the features that ship later
 * than their page get an entry in FEATURE_LABELS.
 */

/** V1–V4 are the four Phase 1 versions; F is after Phase 1. */
export type PhaseLabel = 'V1' | 'V2' | 'V3' | 'V4' | 'F';

export const PHASE_LABELS: PhaseLabel[] = ['V1', 'V2', 'V3', 'V4', 'F'];

/** The version a page first ships in, by path prefix. The longest matching prefix wins. */
const PAGE_LABELS: Record<string, PhaseLabel> = {
  '/app/pos': 'V1',
  '/app/moadian': 'F',
};

/** Features that ship later than the page they sit on. */
export const FEATURE_LABELS = {
  // POS register
  'pos.stop.reason': 'F',
  'pos.stop.duration': 'F',
  'pos.stop.approverPin': 'F',
  'pos.tableAssignment': 'V2',
  'pos.coupon': 'V3',
  'pos.customerCredit': 'V3',
  'pos.offlineTill': 'F',
  // Moadian e-invoices on an order
  moadian: 'F',
} satisfies Record<string, PhaseLabel>;

export type LabelledFeature = keyof typeof FEATURE_LABELS;

export function pageLabel(pathname: string): PhaseLabel | undefined {
  let best: string | undefined;
  for (const prefix of Object.keys(PAGE_LABELS)) {
    const matches = pathname === prefix || pathname.startsWith(`${prefix}/`);
    if (matches && (!best || prefix.length > best.length)) best = prefix;
  }
  return best ? PAGE_LABELS[best] : undefined;
}
