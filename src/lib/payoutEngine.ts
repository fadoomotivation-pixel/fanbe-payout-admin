// ─────────────────────────────────────────────────────────────────────────────
// Fanbe Group — Payout Distribution Engine
// Business Plan: differential rank-based commission system
//
// KEY RULES (from Fanbe Group Business Plan):
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
  rank_qualification_type: 'sq_yards' | 'sub_ranks' // how rank is earned
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
 * Implements Fanbe Group's differential commission rule:
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

  // Full chain: [direct_broker, L1_sponsor, L2_sponsor, …]
  const fullChain = [directBrokerId, ...uplineChain].slice(0, cfg.max_levels + 1)

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
  // "downline" for each upline member = the person one level below them in fullChain.
  for (let i = 0; i < uplineChain.length; i++) {
    const uplineBrokerId = uplineChain[i]
    const downlineBrokerId = fullChain[i] // person directly below this upline

    const uplineRank = rankMap.get(uplineBrokerId)
    const downlineRank = rankMap.get(downlineBrokerId)

    if (!uplineRank || !downlineRank) continue

    // Business Plan Rule #4: equal rank or superseded → no payout
    const differential = round2(uplineRank.commission_pct - downlineRank.commission_pct)
    if (differential <= 0) continue

    const gross = round2((baseAmount * differential) / 100)
    if (gross <= 0) continue

    const tds = round2((gross * cfg.tds_pct) / 100)
    const admin = round2((gross * cfg.admin_charge_pct) / 100)

    rows.push({
      beneficiary_broker_id: uplineBrokerId,
      level: i + 1,
      base_amount: baseAmount,
      upline_rank_pct: uplineRank.commission_pct,
      downline_rank_pct: downlineRank.commission_pct,
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
 * Per-payment MLM distribution. Called whenever a verified payment is recorded against
 * a booking (token, booking deposit, full payment, or an EMI installment). Idempotent
 * keyed on payment_id — won't double-distribute for the same payment.
 *
 * This is the primary MLM trigger in the deferred-commission model: commission is paid
 * to the broker chain only as the customer's money is actually received.
 */
export async function distributePaymentCommission(opts: {
  bookingId: string
  paymentId: string
  amount: number
  instalmentDueDate?: Date
  instalmentPaidDate?: Date
}): Promise<DistributionRow[]> {
  if (!opts.amount || opts.amount <= 0) return []

  // Idempotency: skip if already distributed for this payment
  const { data: existing } = await supabase
    .from('payout_distributions')
    .select('id')
    .eq('payment_id', opts.paymentId)
    .limit(1)
  if (existing && existing.length > 0) return []

  // Need broker for this booking
  const { data: booking } = await supabase
    .from('bp_bookings')
    .select('broker_id')
    .eq('id', opts.bookingId)
    .single()
  if (!booking || !booking.broker_id) return []

  return await distributePayment({
    bookingId: opts.bookingId,
    paymentId: opts.paymentId,
    bookingBrokerId: booking.broker_id,
    approvedAmount: opts.amount,
    instalmentDueDate: opts.instalmentDueDate,
    instalmentPaidDate: opts.instalmentPaidDate,
  })
}

/**
 * Reverse a single payment's commissions. Used when a payment is refunded / deleted.
 */
export async function reversePaymentCommission(paymentId: string): Promise<void> {
  await supabase.from('payout_distributions').delete().eq('payment_id', paymentId)
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
