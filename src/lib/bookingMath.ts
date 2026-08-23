// One place for "what is this booking worth, what came in, what's left".
//
// Before this, the same three lines were written out separately in Bookings, Customer
// Pipeline, Registry, Dashboard and Analytics.  That is how a booking ends up reading
// "fully paid" on one screen and "balance due" on another: each page was free to drift on
// what counts as the agreed value, or on which payments count as money received.
//
// The rules, in one place:
//   value    = total_amount, falling back to plot_total_price for older rows
//   received = VERIFIED payments only — pending ones are not money yet, and a PDC cheque
//              sitting in the drawer is not a payment at all until it clears
//   balance  = never negative; an overpayment is not a debt owed back through this figure

export function bookingValue(b: any): number {
  return Number(b?.total_amount || b?.plot_total_price || 0)
}

/** Sum of verified payments in a list of bp_payments rows. */
export function sumVerified(payments: any[] | null | undefined): number {
  return (payments || [])
    .filter(p => p?.verification_status === 'verified')
    .reduce((s, p) => s + Number(p?.amount || 0), 0)
}

/**
 * booking_id -> verified total, from a flat list of bp_payments rows.
 * Pass rows already filtered to verified and it still behaves, because the filter is
 * applied again here rather than assumed.
 */
export function paidByBooking(payments: any[] | null | undefined): Record<string, number> {
  const out: Record<string, number> = {}
  for (const p of payments || []) {
    if (!p?.booking_id) continue
    if (p.verification_status && p.verification_status !== 'verified') continue
    out[p.booking_id] = (out[p.booking_id] || 0) + Number(p.amount || 0)
  }
  return out
}

export function balanceOf(value: number, paid: number): number {
  return Math.max(0, value - paid)
}

/** Nothing left to collect.  A booking with no value set is never "fully paid". */
export function isFullyPaid(value: number, paid: number): boolean {
  return value > 0 && paid >= value
}

/**
 * The deed can go: the sale is confirmed and there is nothing left to collect.
 * Registry, Customer Pipeline and the Today's-work queue all ask this same question, so
 * they must all ask it here — a booking that is "ready" on one page and not on another is
 * the bug this prevents.
 */
export function isRegistryReady(b: any, paid: number): boolean {
  const done = !!(b?.registry_completed_at || b?.registry_date)
  if (done) return false
  if (b?.stage !== 'booking_done') return false
  return isFullyPaid(bookingValue(b), paid)
}

export function isRegistryDone(b: any): boolean {
  return !!(b?.registry_completed_at || b?.registry_date)
}

/** Collected as a percentage of the agreed value, rounded, capped at 100. */
export function collectionPct(value: number, paid: number): number {
  if (value <= 0) return 0
  return Math.min(100, Math.round((paid / value) * 100))
}
