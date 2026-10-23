// When a traditional broker's commission becomes payable.
//
// Admin, on the call: "jaise maan lo customer ki 25% payment aagayi, toh hum 50%
// commission release karenge... aur agar 50% payment aagayi hai toh 100% commission
// release karenge. Isme monthly basis pe nahi hoyega. Person by person hoyega."
//
// Manisha, in writing:
//   25% collected  -> release 50% of the commission
//   below 25%      -> nothing
//   the %          -> of the plot's FULL price, before any discount
//   counted money  -> everything the customer has paid, token and booking included
//   the team above -> released at the same moment as the person who sold it
//   the arithmetic -> per booking, never pooled across a broker's bookings
//   overpaid?      -> recovered from that broker's next commission
//
// WHAT THIS IS NOT. It does not decide how much anybody earns — recompute_booking_payouts()
// does that, and nothing here writes a commission row. This only answers "how much of what
// they will eventually earn can be handed over today", which until now was a number nobody
// could see.
//
// THE PART THAT SURPRISES PEOPLE. Commission is credited in step with collection: when a
// quarter of the money is in, a quarter of the commission exists. The rule above pays HALF
// at that point. So a release is routinely larger than what has been earned so far, and
// the difference is an advance.
//
// That advance recovers itself, and it does so through machinery that already exists:
// loadBrokerWallets() computes available = earned - paid - pending - advance. Paying 50
// against 25 earned drives available to zero and keeps it there until later instalments
// credit enough to catch up. Nobody has to remember to deduct anything. What the office
// could not see is the size of that hole, so outstanding() below reports it as a plain
// negative number instead of the clamped zero the wallet shows.
//
// TWO DIFFERENT DENOMINATORS, deliberately:
//   * the collected % is measured against the price BEFORE discount — Manisha ticked
//     "plot ki poori keemat", not the discounted figure.
//   * the commission itself is a percentage of each PAYMENT, and payments add up to the
//     discounted total, so that is what a broker's full commission is worked out from.
// Mixing the two would quietly move every figure on the screen, so both are returned and
// both are shown.

/** One step of the agreed table: at this much collected, release this much commission. */
export type ReleaseSlab = { collectedPct: number; releasePct: number }

/**
 * The agreed table. Editable in Payout Settings — written down here only as the starting
 * point, because a rate the office changes must never need a developer.
 *
 * Both rows are now settled: Manisha confirmed 25 -> 50 in writing and said anything
 * below 25 pays nothing, and admin confirmed 50 -> 100 ("Or ha 50% pr 100% release").
 */
export const DEFAULT_RELEASE_SLABS: ReleaseSlab[] = [
  { collectedPct: 25, releasePct: 50 },
  { collectedPct: 50, releasePct: 100 },
]

const r2 = (n: number) => Math.round(n * 100) / 100

/** Slabs in a state this can be trusted with: sorted, cleaned, no nonsense values. */
export function normaliseSlabs(slabs: ReleaseSlab[] | null | undefined): ReleaseSlab[] {
  return (slabs || [])
    // These arrive from editable settings stored as JSON, so a null or a stray value in
    // the array is an ordinary thing to meet, not a bug upstream. Dropping it here keeps
    // a half-typed slab table from taking the whole payout screen down.
    .filter((s): s is ReleaseSlab => !!s && typeof s === 'object')
    .map(s => ({ collectedPct: Number(s.collectedPct), releasePct: Number(s.releasePct) }))
    .filter(s => Number.isFinite(s.collectedPct) && Number.isFinite(s.releasePct))
    .filter(s => s.collectedPct >= 0 && s.releasePct >= 0)
    .sort((a, b) => a.collectedPct - b.collectedPct)
}

/**
 * How much of the commission the agreed table unlocks at this much collected.
 *
 * The HIGHEST slab that has been reached wins, and nothing below the first one pays
 * anything — "25% se kam paisa aaya ho to kuch nahi milega".
 */
export function entitledPctFor(collectedPct: number, slabs: ReleaseSlab[]): number {
  let out = 0
  for (const s of normaliseSlabs(slabs)) {
    if (collectedPct + 1e-9 >= s.collectedPct) out = s.releasePct
    else break
  }
  return out
}

export type BookingMoney = {
  /** total_amount — what the customer actually owes, after any discount. */
  total: number
  /** discount_amount, added back to reach the price the rule is measured against. */
  discount?: number
  /** Everything the customer has paid and the office has VERIFIED. */
  collected: number
}

/** The price the collected % is measured against: the plot's full price, before discount. */
export function fullPriceOf(b: BookingMoney): number {
  return r2(Number(b.total || 0) + Number(b.discount || 0))
}

export type BrokerShare = {
  broker_id: string
  /** Their percentage of every payment, exactly as bp_booking_brokers stores it. */
  commission_pct: number
  /** net_payout already credited to them on THIS booking. */
  credited: number
  /** What has already been handed over for THIS booking — paid or awaiting payment. */
  released: number
}

export type ReleaseLine = BrokerShare & {
  /** Everything they will earn on this booking once it is paid in full, after TDS and admin. */
  fullCommission: number
  /** What the slab unlocks today. */
  entitled: number
  /** entitled minus what has already gone out. Never negative — see outstanding(). */
  releasable: number
  /**
   * Released minus credited. Positive means the broker is holding money they have not
   * earned yet, which later instalments will cover. The wallet clamps this to zero; the
   * office needs to see it.
   */
  advanceOutstanding: number
}

export type ReleasePlan = {
  fullPrice: number
  collected: number
  collectedPct: number
  entitledPct: number
  /** The slab that will unlock next, and what still has to come in to reach it. */
  nextSlab: { collectedPct: number; releasePct: number; shortfall: number } | null
  lines: ReleaseLine[]
  totalReleasable: number
  totalAdvance: number
}

/**
 * What can be handed over on one booking today.
 *
 * `tdsPct` and `adminPct` are the same deductions recompute_booking_payouts() applies once
 * at credit, so a broker's full commission is worked out net — the figure that actually
 * reaches them, and the one that compares with what has already been credited and paid.
 */
export function buildReleasePlan(opts: {
  money: BookingMoney
  shares: BrokerShare[]
  slabs?: ReleaseSlab[]
  tdsPct?: number
  adminPct?: number
}): ReleasePlan {
  const slabs = normaliseSlabs(opts.slabs?.length ? opts.slabs : DEFAULT_RELEASE_SLABS)
  const tds = Number.isFinite(opts.tdsPct as number) ? Number(opts.tdsPct) : 5
  const admin = Number.isFinite(opts.adminPct as number) ? Number(opts.adminPct) : 10
  const netRate = Math.max(0, (100 - tds - admin) / 100)

  const fullPrice = fullPriceOf(opts.money)
  const collected = r2(Number(opts.money.collected || 0))
  const collectedPct = fullPrice > 0 ? r2((collected / fullPrice) * 100) : 0
  const entitledPct = entitledPctFor(collectedPct, slabs)

  const next = slabs.find(s => s.collectedPct > collectedPct + 1e-9) || null
  const nextSlab = next
    ? { collectedPct: next.collectedPct, releasePct: next.releasePct,
        shortfall: r2(Math.max(0, fullPrice * next.collectedPct / 100 - collected)) }
    : null

  const lines: ReleaseLine[] = (opts.shares || []).map(s => {
    // A broker earns their percentage of every payment, and the payments add up to the
    // discounted total — NOT the full price the slab is measured against.
    const fullCommission = r2(Number(opts.money.total || 0) * Number(s.commission_pct || 0) / 100 * netRate)
    const entitled = r2(fullCommission * entitledPct / 100)
    const released = r2(Number(s.released || 0))
    const credited = r2(Number(s.credited || 0))
    return {
      ...s,
      credited,
      released,
      fullCommission,
      entitled,
      releasable: r2(Math.max(0, entitled - released)),
      advanceOutstanding: r2(Math.max(0, released - credited)),
    }
  })

  return {
    fullPrice,
    collected,
    collectedPct,
    entitledPct,
    nextSlab,
    lines,
    totalReleasable: r2(lines.reduce((a, l) => a + l.releasable, 0)),
    totalAdvance: r2(lines.reduce((a, l) => a + l.advanceOutstanding, 0)),
  }
}

/**
 * What a broker is holding beyond what they have earned, across everything.
 *
 * loadBrokerWallets() reports available as max(0, earned - paid - pending - advance),
 * and that clamp is right for "can they withdraw" and wrong for "do they owe us". This
 * returns the unclamped figure so the office can see the hole and watch it close.
 */
export function outstanding(w: { earned: number; paid: number; pending: number; advance: number }): number {
  return r2(w.earned - w.paid - w.pending - w.advance)
}
