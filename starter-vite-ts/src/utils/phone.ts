/**
 * A mobile number as people in Iran write it: 0912 123 4567, not +98 912 123 4567. Numbers are
 * stored both ways (typed at the till, or sent by Snappfood); this only changes how one reads.
 */
export function localMobile(mobile: string | null | undefined): string {
  const value = (mobile || '').trim();
  if (value.startsWith('+98')) return `0${value.slice(3)}`;
  if (/^98\d{10}$/.test(value)) return `0${value.slice(2)}`;
  return value;
}
