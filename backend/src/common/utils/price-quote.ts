import { createHmac, timingSafeEqual } from 'crypto';

/**
 * A price quote fixes what one cart line costs at the moment the item is added: its own price
 * (the size's, or the product's), each add-on's price, the tax rate and the item discount. The
 * server signs it, the till keeps it on the line, and the order uses it when it is sent, so a
 * price changed in between never changes a line already in a cart. The till cannot make or
 * alter one: the signature covers every field.
 */
export interface PriceQuote {
  tenant_id: string;
  branch_id: string;
  product_id: string;
  variant_id: string | null;
  /** Each add-on's price, by add-on id. */
  options: Record<string, string>;
  /** One of the item, before add-ons, in Rial. */
  unit_price: string;
  tax_rate: string;
  item_discount_percent: string;
  item_discount_id: string | null;
  quoted_at: string;
}

/** How long a quote is honoured: a cart is rung up within the day it was started. */
export const PRICE_QUOTE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

const secret = () => process.env.PRICE_QUOTE_SECRET || process.env.JWT_SECRET || 'gnext-prototype-price-quote';

const canonical = (q: PriceQuote) =>
  JSON.stringify([
    q.tenant_id,
    q.branch_id,
    q.product_id,
    q.variant_id,
    Object.keys(q.options)
      .sort()
      .map((id) => [id, q.options[id]]),
    q.unit_price,
    q.tax_rate,
    q.item_discount_percent,
    q.item_discount_id,
    q.quoted_at,
  ]);

const sign = (q: PriceQuote) => createHmac('sha256', secret()).update(canonical(q)).digest('base64url');

/** The quote as a token: the quote itself and its signature. */
export function signPriceQuote(q: PriceQuote): string {
  return `${Buffer.from(JSON.stringify(q)).toString('base64url')}.${sign(q)}`;
}

/** The quote in a token, or null when the token is malformed, altered or too old. */
export function readPriceQuote(token: string | null | undefined, now = new Date()): PriceQuote | null {
  if (!token || typeof token !== 'string') return null;
  const [body, signature] = token.split('.');
  if (!body || !signature) return null;
  let q: PriceQuote;
  try {
    q = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!q || typeof q !== 'object' || typeof q.options !== 'object' || !q.options) return null;
  const expected = Buffer.from(sign(q));
  const given = Buffer.from(signature);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  const age = now.getTime() - new Date(q.quoted_at).getTime();
  if (!(age >= 0 && age <= PRICE_QUOTE_MAX_AGE_MS)) return null;
  return q;
}
