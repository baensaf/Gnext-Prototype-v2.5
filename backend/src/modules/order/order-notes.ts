/** Lines Snappfood's webhook writes into the order's notes ("Customer: ..."). */
export function noteField(notes: string | null | undefined, label: string): string | null {
  const line = (notes || '').split('\n').find((l) => l.startsWith(`${label}: `));
  return line ? line.slice(label.length + 2).trim() || null : null;
}

/**
 * The note that goes on paper. A platform order's notes hold everything the platform sent
 * (who, where, how it is paid) for the cashier's screen; the kitchen and the customer get only
 * what the customer wrote. Name, phone and address print from the customer record instead.
 */
export function printableOrderNote(order: { channel?: string | null; notes?: string | null }): string | undefined {
  const notes = order.channel === 'AGGREGATOR' ? noteField(order.notes, 'Note') : order.notes;
  return notes?.trim() || undefined;
}
