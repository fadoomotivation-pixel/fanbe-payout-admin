// Working out what each person in a traditional chain earns, in one place.
//
// Admin: "commission hum Excel se dekh lenge nahi, ise bhi bnao taki staff ko easy ho
// ye or samjhne me."
//
// WHY THIS HAD TO BE BUILT. On an Affiliate sale the chain pays itself: every broker has
// a rank, the rank carries a %, and recompute_booking_payouts() climbs the sponsors
// paying each level the difference between its own % and the one below. Traditional has
// no ranks, so that climb finds nothing — and this is worth being precise about, because
// the booking form has a tick box called "Also pay upline differential" that looks like
// it does the job. It does not. It sets bp_bookings.traditional_pay_upline, the function
// enters the same cascade, and the cascade reads commission_ranks via brokers.rank. A
// traditional broker has no rank, so cur_pct comes back 0, diff comes out negative, and
// nothing is inserted. The tick box cannot pay a traditional upline a single rupee.
//
// That is the real reason the answer until now was "we will do the commission in Excel".
//
// WHAT DOES WORK is the other branch of the same function: when bp_booking_brokers has
// rows and the booking is traditional, it pays every row by its own commission_pct and
// skips the cascade entirely. So the job here is not a new commission engine — it is to
// fill those rows correctly. Commission is still written in exactly one place.
//
// THE ARITHMETIC. Each traditional broker is on a rate the office agreed with them,
// "kisi ko 100 rupaye gaj de rakha hai kisi ko 1000 kisi ko 1500 2000", now stored on
// brokers.traditional_rate_per_sqyd. A level earns the DIFFERENCE between their rate and
// the best rate below them:
//
//   Pragya  sold it, on 1,000/gaj  ->  earns 1,000/gaj
//   Shashi  on 1,200/gaj           ->  earns   200/gaj
//   Alok    on 1,500/gaj           ->  earns   300/gaj
//   Vaidehi on 2,000/gaj           ->  earns   500/gaj
//
// On a 100 gaj deal the company pays 2,000 x 100 in total, not the four rates added up.
// That is the whole point of a differential, and it is the same shape as the Affiliate
// cascade — only in rupees per gaj instead of a percentage.
//
// Two details are copied from the payout function deliberately, not by coincidence:
//
//   1. The rupees-per-gaj to percent conversion is its line for the direct broker,
//      round((rate * size / total) * 100, 4). Same formula, same rounding, so a filled
//      split and a hand-typed one come out identical.
//   2. The floor only ever rises: `below = max(below, rate)`, mirroring
//      `below_pct := GREATEST(below_pct, cur_pct)`. Without it a cheaper broker sitting
//      above a dearer one would lower the floor and the levels above would be overpaid.
//
// WHAT IT REFUSES TO GUESS. A broker with no rate stored earns nothing and is reported
// as "no rate set" rather than treated as zero — zero is a decision about somebody's
// money and the office has not made it. The walk also stops at a broker_type change, the
// same boundary the cascade enforces: an Affiliate upline never earns from a traditional
// deal.
import type { ChainBroker } from '@/components/UplineChain'

/** A broker as this calculator needs them: the chain fields plus the agreed rate. */
export type RatedBroker = ChainBroker & {
  traditional_rate_per_sqyd?: number | null
  /** A flat amount for each plot sold, whatever its size. The alternative basis. */
  traditional_rate_per_plot?: number | null
}

/** How a broker is paid: scaled by the plot, or a flat amount for it. */
export type RateBasis = 'per_sqyd' | 'per_plot'

/**
 * What a broker is on, and on which basis.
 *
 * Manisha: "Per plot par kardo ise bhi." Per-plot is read FIRST, so a row that somehow
 * carries both behaves one definite way rather than two. The form only ever writes one.
 */
export function basisOf(b: RatedBroker | null | undefined): { basis: RateBasis; rate: number } | null {
  const perPlot = Number(b?.traditional_rate_per_plot)
  if (Number.isFinite(perPlot) && perPlot > 0) return { basis: 'per_plot', rate: perPlot }
  const perSqyd = Number(b?.traditional_rate_per_sqyd)
  if (Number.isFinite(perSqyd) && perSqyd > 0) return { basis: 'per_sqyd', rate: perSqyd }
  return null
}

/** What that arrangement comes to in rupees on a plot of this size. */
export function amountOnDeal(x: { basis: RateBasis; rate: number }, sizeSqyd: number): number {
  return x.basis === 'per_plot' ? x.rate : Math.round(x.rate * sizeSqyd)
}

export type SplitLevel = {
  broker: RatedBroker
  /** 0 for the broker who sold it, 1.. up the sponsor chain. */
  level: number
  /** Which way this broker is paid, and the figure agreed. Null when nothing is set. */
  basis: RateBasis | null
  rate: number | null
  /**
   * What this broker's own arrangement comes to on THIS plot, in rupees.
   *
   * The whole calculation runs in rupees-on-this-deal rather than rupees per gaj,
   * because a chain can mix the two bases — one broker on 1,000 a gaj, the next on a
   * flat 50,000 a plot — and only a common unit can tell which of them is on more.
   */
  ownAmount: number | null
  /** The best amount below them — what their differential is measured against. */
  belowAmount: number
  /** ownAmount - belowAmount, never negative. The rupees this level takes on the deal. */
  rupees: number
  /** The % of every verified payment, in the engine's own units. */
  pct: number
  /** Why this level earns nothing, when it earns nothing. Empty otherwise. */
  blocked: '' | 'no_rate' | 'not_above_below'
}

export type SplitPlan = {
  levels: SplitLevel[]
  /** Levels that actually earn something — the ones worth writing. */
  paid: SplitLevel[]
  /** Levels carrying no agreed rate. The office has to fill these in. */
  missingRate: SplitLevel[]
  /** Total rupees across the deal, and the total % of each payment. */
  totalRupees: number
  totalPct: number
  /** The biggest single arrangement in the chain — what the whole deal costs. */
  topAmount: number
  /** Set when the plan could not be worked out at all. */
  problem: '' | 'no_size' | 'no_total' | 'no_seller'
}

const r2 = (n: number) => Math.round(n * 100) / 100
/** The payout function rounds the derived pct to 4 decimals. Match it exactly. */
const r4 = (n: number) => Math.round(n * 10000) / 10000

/**
 * Rupees per gaj -> the % of each payment, exactly as recompute_booking_payouts()
 * derives it for the direct broker:
 *
 *     direct_pct := round((bk_trad_psy * bk_size_sqyd / bk_total) * 100, 4)
 */
export function pctFromRatePerSqyd(rate: number, sizeSqyd: number, total: number): number {
  if (!(rate > 0) || !(sizeSqyd > 0) || !(total > 0)) return 0
  return r4((rate * sizeSqyd / total) * 100)
}

/** The other direction, for showing the office what a typed % works out to per gaj. */
export function ratePerSqydFromPct(pct: number, sizeSqyd: number, total: number): number {
  if (!(pct > 0) || !(sizeSqyd > 0) || !(total > 0)) return 0
  return r2((pct / 100) * total / sizeSqyd)
}

/** A percentage of each payment, from a plain rupee figure for the whole deal. */
export function pctFromAmount(rupees: number, total: number): number {
  if (!(rupees > 0) || !(total > 0)) return 0
  return r4((rupees / total) * 100)
}

/**
 * The chain to pay for a traditional sale: the seller, then their sponsors upward.
 *
 * Stops at a broker_type change, the same boundary recompute_booking_payouts() enforces
 * on its cascade — the two trees are kept strictly separate, so an Affiliate sponsor
 * sitting above a traditional broker is not part of this deal.
 */
export function teamForSale(brokers: RatedBroker[], sellerId?: string | null): RatedBroker[] {
  if (!sellerId) return []
  const byId = new Map(brokers.map(b => [b.id, b]))
  const seller = byId.get(sellerId)
  if (!seller) return []

  const sellerType = seller.broker_type || null
  const out: RatedBroker[] = [seller]
  const seen = new Set<string>([seller.id])
  let cur = seller.sponsor_id

  // 15 levels, the safety cap the payout function uses on its own walk.
  for (let i = 0; i < 15 && cur; i++) {
    if (seen.has(cur)) break
    seen.add(cur)
    const b = byId.get(cur)
    if (!b) break
    const t = b.broker_type || null
    if (sellerType && t && t !== sellerType) break
    out.push(b)
    cur = b.sponsor_id
  }
  return out
}

/**
 * Turn a chain of agreed rates into the rows the payout function will pay.
 *
 * `sellerRateOverride` is the rupees-per-gaj typed on this one booking. It wins over the
 * seller's stored rate because a traditional rate is agreed per deal — "rate is whatever
 * was agreed for that deal" — and the office is looking at that deal when they type it.
 * Uplines always use their stored rate: nobody is negotiating four rates on one form.
 */
export function buildSplitPlan(opts: {
  team: RatedBroker[]
  sizeSqyd: number
  total: number
  /** Rupees per gaj typed on this one booking, for the seller only. */
  sellerRateOverride?: number | null
  /** Or a flat rupee amount typed on this one booking, again for the seller only. */
  sellerAmountOverride?: number | null
}): SplitPlan {
  const { team, sizeSqyd, total } = opts
  const empty: SplitPlan = {
    levels: [], paid: [], missingRate: [],
    totalRupees: 0, totalPct: 0, topAmount: 0, problem: '',
  }
  if (team.length === 0)  return { ...empty, problem: 'no_seller' }
  if (!(sizeSqyd > 0))    return { ...empty, problem: 'no_size' }
  if (!(total > 0))       return { ...empty, problem: 'no_total' }

  // What was typed on this booking wins for the seller, in whichever unit it was typed.
  const perGaj = Number(opts.sellerRateOverride)
  const flat   = Number(opts.sellerAmountOverride)
  const sellerTyped: { basis: RateBasis; rate: number } | null =
      Number.isFinite(flat)   && flat   > 0 ? { basis: 'per_plot', rate: flat }
    : Number.isFinite(perGaj) && perGaj > 0 ? { basis: 'per_sqyd', rate: perGaj }
    : null

  const levels: SplitLevel[] = []
  let below = 0

  team.forEach((broker, i) => {
    const own = i === 0 ? (sellerTyped || basisOf(broker)) : basisOf(broker)

    if (own == null) {
      // Not treated as zero: zero would be a decision about this person's money that
      // nobody has made. They earn nothing here and get named in the preview instead.
      levels.push({
        broker, level: i, basis: null, rate: null, ownAmount: null,
        belowAmount: below, rupees: 0, pct: 0, blocked: 'no_rate',
      })
      return
    }

    // Everything is compared in rupees on THIS plot, because a chain can mix a per-gaj
    // broker with a per-plot one and only a common unit can say which is on more.
    const ownAmount = amountOnDeal(own, sizeSqyd)
    const rupees = Math.round(ownAmount - below)
    const earns = rupees > 0
    levels.push({
      broker, level: i, basis: own.basis, rate: own.rate, ownAmount,
      belowAmount: below,
      rupees: earns ? rupees : 0,
      pct: earns ? pctFromAmount(rupees, total) : 0,
      blocked: earns ? '' : 'not_above_below',
    })

    // Only ever rises, mirroring GREATEST(below_pct, cur_pct) in the payout function.
    below = Math.max(below, ownAmount)
  })

  const paid = levels.filter(l => l.pct > 0)
  return {
    levels,
    paid,
    missingRate: levels.filter(l => l.blocked === 'no_rate'),
    totalRupees: paid.reduce((s, l) => s + l.rupees, 0),
    totalPct: r4(paid.reduce((s, l) => s + l.pct, 0)),
    topAmount: below,
    problem: '',
  }
}
