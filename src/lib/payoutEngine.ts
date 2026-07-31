// ─────────────────────────────────────────────────────────────────────────────
// Payout Distribution Engine
// Business Plan: differential rank-based commission system
//
// KEY RULES:
//   1. Payout is on DIFFERENTIAL basis:
//      Upline earns = their rank % − immediate downline's rank %
//   2. Equal rank or superseded (upline rank ≤ downline rank) → 0 payout
//   3. Payout calculated ONLY on deposited (approved payment) amount
//   4. Payout closing daily; distribution monthly
//   5. 90-day grace period on instalments; irregular deposit lapses payout
//   6. Sale counted only when booking amount or more is deposited
//
// Rank slabs (% = direct commission on deposited amount):
//   R1 Executive 5% | R2 Sr Executive 5.5% | R3 Sales Officer 6% ...
//   ... up to R15 President 12%  (0.5% increments per rank)
// ─────────────────────────────────────────────────────────────────────────────

import { supabase } from '@/lib/supabase'

// ── Types ────────────────────────────────────────────────────────────────────

export interface PayoutConfig {
  admin_charge_pct: number   // deducted from each payout row
  tds_pct: number            // deducted from each payout row
  min_withdrawal: number     // Rs minimum for withdrawal request
  max_levels: number         // max upline levels to walk
  lapsation_grace_days: number // days before instalment payout lapses
}

export const DEFAULT_PAYOUT_CONFIG: PayoutConfig = {
  admin_charge_pct: 10,
  tds_pct: 5,
  min_withdrawal: 1000,
  max_levels: 15,
  lapsation_grace_days: 90,
}

/** One rank slab as stored in commission_ranks table */
export interface RankSlab {
  id: string
  rank_name: string
  level: number                  // 1 = Executive … 15 = President
  min_sq_yards: number           // team sq yards to qualify
  max_sq_yards: number | null
  commission_pct: number         // direct commission % at this rank
  rank_qualification_type: 'sq_yards' | 'direct_sq_yards' | 'sub_ranks' // how rank is earned
  required_sub_rank_level: number | null  // for rank 6+ (needs N brokers of sub-rank)
  required_sub_rank_count: number | null
  active: boolean
}

/** A single row written to payout_distributions */
export interface DistributionRow {
  beneficiary_broker_id: string
  level: number                  // 1 = direct sponsor, 2 = L2 upline …
  base_amount: number            // approved deposited amount
  upline_rank_pct: number        // upline broker's commission %
  downline_rank_pct: number      // immediate downline's commission %
  differential_pct: number       // = upline_rank_pct − downline_rank_pct
  gross_payout: number           // base_amount × differential_pct / 100
  tds_amount: number
  admin_charge: number
  net_payout: number
  lapsed: boolean                // true if instalment overdue > grace period
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

/**
 * Checks if an instalment payment is within the 90-day grace window.
 * Lapsed payments do NOT generate payout (business plan rule #7).
 */
export function isPaymentLapsed(
  dueDate: Date,
  paidDate: Date,
  graceDays: number = 90,
): boolean {
  const diffMs = paidDate.getTime() - dueDate.getTime()
  const diffDays = diffMs / (1000 * 60 * 60 * 24)
  return diffDays > graceDays
}

// ── Rank Lookup ───────────────────────────────────────────────────────────────

/**
 * Loads all active rank slabs ordered by level ascending.
 * Cached per call site — caller should cache if calling in a loop.
 */
export async function loadRankSlabs(): Promise<RankSlab[]> {
  const { data, error } = await supabase
    .from('commission_ranks')
    .select('*')
    .eq('active', true)
    .order('level', { ascending: true })
  if (error) throw error
  return (data ?? []) as RankSlab[]
}

/**
 * Returns the rank slab for a specific broker.
 * PRIMARY source is brokers.rank (the rank name the admin assigns on the broker record),
 * matched to commission_ranks.rank_name. This is what actually drives commission %.
 * Falls back to broker_rank_stats.current_rank_level (auto-rank engine, if in use),
 * then to the lowest slab as a last resort.
 */
export async function getBrokerRank(
  brokerId: string,
  slabs: RankSlab[],
): Promise<RankSlab> {
  // 1) brokers.rank (text) → match by rank_name
  const { data: broker } = await supabase
    .from('brokers')
    .select('rank')
    .eq('id', brokerId)
    .maybeSingle()
  const rankName = (broker as { rank: string | null } | null)?.rank
  if (rankName) {
    const byName = slabs.find(s => s.rank_name === rankName)
    if (byName) return byName
  }

  // 2) broker_rank_stats.current_rank_level → match by level
  const { data: stats } = await supabase
    .from('broker_rank_stats')
    .select('current_rank_level')
    .eq('broker_id', brokerId)
    .maybeSingle()
  const level = (stats as { current_rank_level: number } | null)?.current_rank_level
  if (level) {
    const byLevel = slabs.find(s => s.level === level)
    if (byLevel) return byLevel
  }

  // 3) lowest slab
  return slabs[0]
}

// ── Upline Chain ──────────────────────────────────────────────────────────────

/**
 * Walks sponsor_tree upward from brokerId and returns the upline chain
 * as an ordered array [direct_sponsor, L2, L3, …] up to maxLevels.
 * Cycles are detected via a seen-set.
 */
export async function getUplineChain(
  brokerId: string,
  maxLevels: number,
): Promise<string[]> {
  const chain: string[] = []
  let current: string | null = brokerId
  const seen = new Set<string>([brokerId])

  while (current && chain.length < maxLevels) {
    const { data } = await supabase
      .from('sponsor_tree')
      .select('sponsor_id')
      .eq('broker_id', current)
      .maybeSingle()

    const sponsor = (data as { sponsor_id: string } | null)?.sponsor_id ?? null
    if (!sponsor || seen.has(sponsor)) break
    seen.add(sponsor)
    chain.push(sponsor)
    current = sponsor
  }

  return chain
}

// ── Core Differential Engine ──────────────────────────────────────────────────

/**
 * computeDifferentialDistribution
 *
 * Implements differential commission rule:
 *   - The direct broker (level 0) earns their own rank % on the deposited amount.
 *   - Each upline broker earns only the DIFFERENCE between their rank % and the
 *     rank % of the person immediately below them in the chain.
 *   - If the upline's rank % ≤ downline's rank % → they earn NOTHING (rule #4).
 *
 * @param baseAmount      Approved / deposited amount (NOT total plot cost)
 * @param directBrokerId  The broker who made the sale
 * @param uplineChain     [L1_sponsor, L2_sponsor, …] from getUplineChain()
 * @param rankMap         Map<brokerId, RankSlab> pre-fetched for all brokers
 * @param cfg             PayoutConfig
 * @param lapsed          Whether this payment is past the 90-day grace window
 */
export function computeDifferentialDistribution(
  baseAmount: number,
  directBrokerId: string,
  uplineChain: string[],
  rankMap: Map<string, RankSlab>,
  cfg: PayoutConfig = DEFAULT_PAYOUT_CONFIG,
  lapsed = false,
): DistributionRow[] {
  if (lapsed) return [] // No payout on lapsed instalments

  const rows: DistributionRow[] = []

  // Cap upline walk to max_levels (direct broker is level 0, separate from chain).
  const cappedUpline = uplineChain.slice(0, cfg.max_levels)

  // ── Direct broker commission (level 0) ───────────────────────────────────
  // The selling broker earns their own rank % directly on the deposited amount.
  const directRank = rankMap.get(directBrokerId)
  if (directRank && directRank.commission_pct > 0) {
    const gross = round2((baseAmount * directRank.commission_pct) / 100)
    if (gross > 0) {
      const tds = round2((gross * cfg.tds_pct) / 100)
      const admin = round2((gross * cfg.admin_charge_pct) / 100)
      rows.push({
        beneficiary_broker_id: directBrokerId,
        level: 0,
        base_amount: baseAmount,
        upline_rank_pct: directRank.commission_pct,
        downline_rank_pct: 0,
        differential_pct: directRank.commission_pct,
        gross_payout: gross,
        tds_amount: tds,
        admin_charge: admin,
        net_payout: round2(gross - tds - admin),
        lapsed: false,
      })
    }
  }

  // ── Upline differential commission (level 1, 2, …) ───────────────────────
  // uplineChain[0] is L1 (direct sponsor), uplineChain[1] is L2, etc.
  // belowPct tracks the highest commission % already paid downstream — it only ever
  // rises.  A lower-rank intermediate upline (rank reversal) cannot reset the floor
  // and let a higher upline over-claim the differential.
  let belowPct = rankMap.get(directBrokerId)?.commission_pct ?? 0
  for (let i = 0; i < cappedUpline.length; i++) {
    const uplineBrokerId = cappedUpline[i]
    const uplineRank = rankMap.get(uplineBrokerId)
    if (!uplineRank) continue

    const uplinePct = uplineRank.commission_pct
    const differential = round2(uplinePct - belowPct)
    belowPct = Math.max(belowPct, uplinePct)
    if (differential <= 0) continue

    const gross = round2((baseAmount * differential) / 100)
    if (gross <= 0) continue

    const tds = round2((gross * cfg.tds_pct) / 100)
    const admin = round2((gross * cfg.admin_charge_pct) / 100)

    rows.push({
      beneficiary_broker_id: uplineBrokerId,
      level: i + 1,
      base_amount: baseAmount,
      upline_rank_pct: uplinePct,
      downline_rank_pct: differential > 0 ? uplinePct - differential : belowPct,
      differential_pct: differential,
      gross_payout: gross,
      tds_amount: tds,
      admin_charge: admin,
      net_payout: round2(gross - tds - admin),
      lapsed: false,
    })
  }

  return rows
}

// ── Persist & Orchestrate ─────────────────────────────────────────────────────

/**
 * Main entry point: called after a payment is approved.
 * Fetches rank data, builds the chain, computes differential distributions,
 * and inserts rows into payout_distributions.
 *
 * @param opts.instalmentDueDate  If provided, lapsation check is applied.
 * @param opts.instalmentPaidDate If provided alongside dueDate, lapsation checked.
 */
export async function distributePayment(opts: {
  bookingId: string
  paymentId: string
  bookingBrokerId: string
  approvedAmount: number           // deposited amount only — NOT total plot cost
  instalmentDueDate?: Date         // optional: for lapsation check
  instalmentPaidDate?: Date        // optional: for lapsation check
  cfg?: PayoutConfig
}): Promise<DistributionRow[]> {
  const cfg = opts.cfg ?? (await loadPayoutConfig())

  // Lapsation check (business plan rule #7)
  let lapsed = false
  if (opts.instalmentDueDate && opts.instalmentPaidDate) {
    lapsed = isPaymentLapsed(
      opts.instalmentDueDate,
      opts.instalmentPaidDate,
      cfg.lapsation_grace_days,
    )
  }

  if (lapsed) {
    console.warn(
      `[payoutEngine] Payment ${opts.paymentId} is lapsed — no payout distributed.`,
    )
    return []
  }

  // Load all rank slabs once
  const slabs = await loadRankSlabs()

  // Get upline chain
  const uplineChain = await getUplineChain(opts.bookingBrokerId, cfg.max_levels)

  // Build full chain to pre-fetch all ranks
  const fullChain = [opts.bookingBrokerId, ...uplineChain]
  const rankMap = new Map<string, RankSlab>()
  await Promise.all(
    fullChain.map(async brokerId => {
      const rank = await getBrokerRank(brokerId, slabs)
      rankMap.set(brokerId, rank)
    }),
  )

  // Compute differential distribution
  const rows = computeDifferentialDistribution(
    opts.approvedAmount,
    opts.bookingBrokerId,
    uplineChain,
    rankMap,
    cfg,
    lapsed,
  )

  if (rows.length === 0) return []

  // Persist to DB
  const insertRows = rows.map(r => ({
    booking_id: opts.bookingId,
    payment_id: opts.paymentId,
    beneficiary_broker_id: r.beneficiary_broker_id,
    level: r.level,
    income_type: r.level === 0 ? 'direct' : 'differential',
    base_amount: r.base_amount,
    rate_pct: r.differential_pct,
    gross_payout: r.gross_payout,
    tds_amount: r.tds_amount,
    admin_charge: r.admin_charge,
    net_payout: r.net_payout,
  }))

  const { error } = await supabase.from('payout_distributions').insert(insertRows)
  if (error) throw error

  return rows
}

/**
 * Idempotent: distribute commission for a booking that's just been confirmed.
 * Skips if rows already exist for this booking_id. Reads broker + total from the booking row.
 * Returns the rows that were inserted (empty array if skipped or no eligible distribution).
 */
export async function distributeBookingCommission(bookingId: string): Promise<DistributionRow[]> {
  // Idempotency: don't double-distribute
  const { data: existing } = await supabase
    .from('payout_distributions')
    .select('id')
    .eq('booking_id', bookingId)
    .limit(1)
  if (existing && existing.length > 0) return []

  const { data: booking } = await supabase
    .from('bp_bookings')
    .select('id, broker_id, total_amount, plot_total_price, stage')
    .eq('id', bookingId)
    .single()
  if (!booking || !booking.broker_id) return []

  const base = Number(booking.total_amount || booking.plot_total_price || 0)
  if (base <= 0) return []

  return await distributePayment({
    bookingId: booking.id,
    paymentId: null as any, // null payment_id is allowed for booking-level commission
    bookingBrokerId: booking.broker_id,
    approvedAmount: base,
  })
}

/**
 * Reverse: remove any payout_distributions for this booking. Used when a booking is
 * cancelled or reopened so the MLM chain doesn't keep stale commissions.
 */
export async function reverseBookingCommission(bookingId: string): Promise<void> {
  await supabase.from('payout_distributions').delete().eq('booking_id', bookingId)
}

/**
 * Per-payment MLM distribution.
 *
 * Distribution is now performed by a DATABASE TRIGGER (payment_recompute_payouts on bp_payments)
 * that auto-recomputes the whole booking's commissions whenever any payment is inserted, has its
 * amount/verification_status changed, or is deleted — using brokers.rank + the sponsor chain.
 * That makes commissions ALWAYS correct, for EVERY payment path, with zero manual recompute.
 *
 * This function therefore no longer inserts anything — it simply reads back how many distribution
 * rows the trigger created for the given payment so callers can show a "MLM × N" toast.
 */
export async function distributePaymentCommission(opts: {
  bookingId: string
  paymentId: string
  amount: number
  instalmentDueDate?: Date
  instalmentPaidDate?: Date
}): Promise<DistributionRow[]> {
  if (!opts.paymentId) return []
  const { data } = await supabase
    .from('payout_distributions')
    .select('*')
    .eq('payment_id', opts.paymentId)
  return (data || []) as unknown as DistributionRow[]
}

/**
 * Reverse a single payment's commissions.  Refuses if any of the payment's distributions
 * are already part of a closed cycle — admin must reopen that cycle first.  Otherwise
 * silently deletes unbatched rows (the DB trigger has the same logic for the auto path).
 */
export async function reversePaymentCommission(paymentId: string): Promise<void> {
  const { data: cycled } = await supabase
    .from('payout_distributions')
    .select('id, cycle_id')
    .eq('payment_id', paymentId)
    .not('cycle_id', 'is', null)
    .limit(1)
  if (cycled && cycled.length > 0) {
    throw new Error('This payment is already part of a closed payout cycle. Reopen the cycle on /payout-cycles first.')
  }
  await supabase
    .from('payout_distributions')
    .delete()
    .eq('payment_id', paymentId)
    .is('cycle_id', null)
}

// ── Config Loader ─────────────────────────────────────────────────────────────

export async function loadPayoutConfig(): Promise<PayoutConfig> {
  const { data } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', 'payout_config')
    .maybeSingle()
  return { ...DEFAULT_PAYOUT_CONFIG, ...((data?.value as Partial<PayoutConfig>) ?? {}) }
}

// ── Withdrawal Computation ────────────────────────────────────────────────────

/**
 * Computes net withdrawal after admin charge + TDS deductions.
 * Admin charge and TDS are applied to the gross withdrawal amount.
 */
export function computeWithdrawal(
  amount: number,
  cfg: PayoutConfig,
): {
  gross: number
  admin: number
  tds: number
  net: number
  eligible: boolean
} {
  const admin = round2((amount * cfg.admin_charge_pct) / 100)
  const tds = round2((amount * cfg.tds_pct) / 100)
  const net = round2(amount - admin - tds)
  return {
    gross: amount,
    admin,
    tds,
    net,
    eligible: amount >= cfg.min_withdrawal,
  }
}

// ── Achievers Club ────────────────────────────────────────────────────────────

/**
 * Computes the Achievers Club pool allocation for a month.
 * Target: 3,000 sq yards team business for 3 consecutive months.
 * Allocation: Rs. 100 per sq yard of fresh sales in the calendar month.
 * Distribution: Total pool ÷ number of qualifying achievers (equal share).
 * Paid in 3 equal monthly instalments.
 *
 * @param totalFreshSqYards  Total sq yards sold fresh in the calendar month
 * @param qualifyingCount    Number of achievers who met the 3,000 sq yd / 3-month target
 */
export function computeAchieversClub(
  totalFreshSqYards: number,
  qualifyingCount: number,
): {
  totalPool: number
  perAchiever: number
  monthlyInstalment: number
} {
  if (qualifyingCount <= 0) {
    return { totalPool: 0, perAchiever: 0, monthlyInstalment: 0 }
  }
  const totalPool = round2(totalFreshSqYards * 100)          // Rs.100/sq yard
  const perAchiever = round2(totalPool / qualifyingCount)     // equal split
  const monthlyInstalment = round2(perAchiever / 3)           // paid over 3 months
  return { totalPool, perAchiever, monthlyInstalment }
}

// ── Broker wallet ────────────────────────────────────────────────────────────
// Single source-of-truth for every page that needs to know what a broker has earned,
// what's been paid, what's queued, and what's still available to withdraw.
//
// We sum across BOTH payout channels:
//   - withdrawal_requests        (broker self-initiated)
//   - bp_payout_transactions     (admin-initiated via Payout Cycle close)
// Without this, /payouts and /withdrawals showed different 'available' numbers and
// a broker paid via a cycle batch could still request a withdrawal for the same money.
export type BrokerWallet = {
  earned: number          // sum of payout_distributions.net_payout
  paid: number            // withdrawal_requests in paid|closed + bp_payout_transactions in paid
  pending: number         // withdrawal_requests in pending|approved + bp_payout_transactions in pending|approved
  available: number       // max(0, earned - paid - pending)
}

export async function loadBrokerWallets(): Promise<Record<string, BrokerWallet>> {
  const [{ data: dist }, { data: wds }, { data: txns }] = await Promise.all([
    supabase.from('payout_distributions').select('beneficiary_broker_id, net_payout'),
    supabase.from('withdrawal_requests').select('broker_id, amount, net_amount, status'),
    supabase.from('bp_payout_transactions').select('broker_id, amount, net_amount, status'),
  ])
  const out: Record<string, BrokerWallet> = {}
  const ensure = (id: string) => (out[id] ??= { earned: 0, paid: 0, pending: 0, available: 0 })
  for (const d of (dist || []) as any[]) {
    if (!d.beneficiary_broker_id) continue
    ensure(d.beneficiary_broker_id).earned += Number(d.net_payout || 0)
  }
  for (const w of (wds || []) as any[]) {
    if (!w.broker_id) continue
    const w_ = ensure(w.broker_id)
    if (w.status === 'paid' || w.status === 'closed')    w_.paid    += Number(w.net_amount || w.amount || 0)
    // Use net_amount for pending too — paid uses net, cycle txns use net (line below); using
    // gross here would temporarily inflate "pending" by the TDS portion and make Available
    // drop too far while the withdrawal sits in approval limbo, then jump up by the TDS when
    // it flips to paid (because the same row now counts as net instead of gross).
    if (w.status === 'pending' || w.status === 'approved') w_.pending += Number(w.net_amount || w.amount || 0)
  }
  for (const t of (txns || []) as any[]) {
    if (!t.broker_id) continue
    const w_ = ensure(t.broker_id)
    if (t.status === 'paid')                                 w_.paid    += Number(t.net_amount || t.amount || 0)
    if (t.status === 'pending' || t.status === 'approved')   w_.pending += Number(t.net_amount || t.amount || 0)
  }
  for (const id in out) out[id].available = Math.max(0, out[id].earned - out[id].paid - out[id].pending)
  return out
}

