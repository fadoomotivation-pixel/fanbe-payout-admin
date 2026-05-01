// Payout distribution engine: when a booking payment is approved, distribute commissions
// across the broker's upline (multi-level) using rank-based slabs, then apply TDS + admin charge.
//
// Income types map to competitor's "Income 1 / 2 / 3":
//   income1 = direct sponsor (level 1) -> sales commission
//   income2 = level-2 upline -> reward / team income
//   income3 = level-3+ upline -> royalty / TM income

import { supabase } from '@/lib/supabase'

export interface PayoutConfig {
  admin_charge_pct: number
  tds_pct: number
  min_withdrawal: number
  income1_pct: number
  income2_pct: number
  income3_pct: number
  max_levels: number
}

export const DEFAULT_PAYOUT_CONFIG: PayoutConfig = {
  admin_charge_pct: 10,
  tds_pct: 5,
  min_withdrawal: 1000,
  income1_pct: 5,
  income2_pct: 2,
  income3_pct: 1,
  max_levels: 5,
}

export interface DistributionRow {
  beneficiary_broker_id: string
  level: number
  income_type: 'income1' | 'income2' | 'income3'
  base_amount: number
  rate_pct: number
  gross_payout: number
  tds_amount: number
  admin_charge: number
  net_payout: number
}

function round2(n: number) { return Math.round(n * 100) / 100 }

function rateForLevel(level: number, cfg: PayoutConfig): { pct: number; type: DistributionRow['income_type'] } {
  if (level === 1) return { pct: cfg.income1_pct, type: 'income1' }
  if (level === 2) return { pct: cfg.income2_pct, type: 'income2' }
  return { pct: cfg.income3_pct, type: 'income3' }
}

// Walks the sponsor tree up to maxLevels and returns the upline chain.
export async function getUplineChain(brokerId: string, maxLevels: number): Promise<string[]> {
  const chain: string[] = []
  let current: string | null = brokerId
  const seen = new Set<string>()
  while (current && chain.length < maxLevels) {
    const { data } = await supabase
      .from('sponsor_tree')
      .select('sponsor_id')
      .eq('broker_id', current)
      .maybeSingle()
    const sponsor = data?.sponsor_id as string | null
    if (!sponsor || seen.has(sponsor)) break
    seen.add(sponsor)
    chain.push(sponsor)
    current = sponsor
  }
  return chain
}

export function computeDistribution(
  baseAmount: number,
  uplineBrokers: string[],
  cfg: PayoutConfig = DEFAULT_PAYOUT_CONFIG,
): DistributionRow[] {
  const rows: DistributionRow[] = []
  uplineBrokers.slice(0, cfg.max_levels).forEach((brokerId, idx) => {
    const level = idx + 1
    const { pct, type } = rateForLevel(level, cfg)
    if (pct <= 0) return
    const gross = round2((baseAmount * pct) / 100)
    if (gross <= 0) return
    const tds = round2((gross * cfg.tds_pct) / 100)
    const admin = round2((gross * cfg.admin_charge_pct) / 100)
    const net = round2(gross - tds - admin)
    rows.push({
      beneficiary_broker_id: brokerId,
      level,
      income_type: type,
      base_amount: baseAmount,
      rate_pct: pct,
      gross_payout: gross,
      tds_amount: tds,
      admin_charge: admin,
      net_payout: net,
    })
  })
  return rows
}

// Persists distributions for a payment and returns the rows written.
export async function distributePayment(opts: {
  bookingId: string
  paymentId: string
  bookingBrokerId: string
  approvedAmount: number
  cfg?: PayoutConfig
}): Promise<DistributionRow[]> {
  const cfg = opts.cfg ?? (await loadPayoutConfig())
  const upline = await getUplineChain(opts.bookingBrokerId, cfg.max_levels)
  // Direct broker is included as level-1 income.
  const chain = [opts.bookingBrokerId, ...upline].slice(0, cfg.max_levels)
  const rows = computeDistribution(opts.approvedAmount, chain, cfg)
  if (rows.length === 0) return []
  const insertRows = rows.map(r => ({
    booking_id: opts.bookingId,
    payment_id: opts.paymentId,
    ...r,
  }))
  const { error } = await supabase.from('payout_distributions').insert(insertRows)
  if (error) throw error
  return rows
}

export async function loadPayoutConfig(): Promise<PayoutConfig> {
  const { data } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', 'payout_config')
    .maybeSingle()
  return { ...DEFAULT_PAYOUT_CONFIG, ...(data?.value as Partial<PayoutConfig> ?? {}) }
}

// Rank lookup: given a broker's lifetime business, return the matching rank slab.
export interface RankSlab {
  rank_name: string
  level: number
  min_business: number
  max_business: number | null
  income_amount: number
  income_pct: number
}

export async function getRankForBusiness(business: number): Promise<RankSlab | null> {
  const { data } = await supabase
    .from('commission_ranks')
    .select('*')
    .eq('active', true)
    .order('level', { ascending: true })
  if (!data) return null
  for (const slab of data as RankSlab[]) {
    if (business >= slab.min_business && (slab.max_business == null || business < slab.max_business)) {
      return slab
    }
  }
  return (data[data.length - 1] as RankSlab) ?? null
}

export function computeWithdrawal(amount: number, cfg: PayoutConfig) {
  const admin = round2((amount * cfg.admin_charge_pct) / 100)
  const tds = round2((amount * cfg.tds_pct) / 100)
  const net = round2(amount - admin - tds)
  return { gross: amount, admin, tds, net, eligible: amount >= cfg.min_withdrawal }
}
