// The Customer Pipeline's view of every booking at once.
//
// The pipeline used to fetch 25 bookings at a time from the server and then work out the
// tabs and tiles from those 25.  So "EMI Collection: 0" meant "none of the 25 on this
// screen", not "none in the business", and clicking a tab filtered the same 25 — anyone on
// page 2 onwards could never be found by status.  On the live data that read 0 / 0 / 0
// next to "877 customers".
//
// This builds one light row per booking — money, EMI position, which bucket it is in — so
// every tab, tile, filter, sort and search runs across the whole book.  The heavy detail
// (receipts, commission, cheques, upline) is still fetched only for the page on screen.
//
// Nothing here invents a rule.  Value, paid, balance and "fully paid" come from
// lib/bookingMath; the EMI position comes from lib/emiStatus — the same functions the
// Registry page, the Agent Report and the EMI Overdue list read, so the buckets here cannot
// disagree with those screens.
import { supabase } from '@/lib/supabase'
import { fetchAllRows, todayLocalISO } from '@/lib/fetchAll'
import { bookingValue, balanceOf, paidByBooking, isRegistryReady, isRegistryDone, collectionPct, isImported, isPaidUnknown } from '@/lib/bookingMath'
import { fetchEmiStatusAll, type EmiStatus } from '@/lib/emiStatus'

// Exclusive and in priority order: every booking is in exactly one bucket, so the tiles
// add up to the total instead of double-counting.
export type Bucket =
  | 'price_missing'     // value is 0 — plot / price never entered
  | 'settled'           // value > 0 and nothing left to collect
  | 'emi_overdue'       // on an EMI plan and at least one instalment is late
  | 'emi_running'       // on an EMI plan, nothing late
  | 'old_unrecorded'    // imported from the old register, and what was paid before is not entered
  | 'not_started'       // has a value, nothing paid yet
  | 'token_only'        // token paid, booking deposit not
  | 'balance_no_plan'   // paid something, balance left, no EMI plan to collect it

export type IndexRow = {
  id: string
  booking_no: string
  legacy_booking_no: string | null
  stage: string
  created_at: string
  application_date: string | null
  customer_id: string | null
  broker_id: string | null
  project_id: string | null
  plot_id: string | null
  commission_mode: string
  customer_name: string
  customer_phone: string
  customer_code: string
  previous_customer_code: string
  broker_name: string
  broker_code: string
  plot_no: string
  /** came from the old records sheet, not booked in this system */
  imported: boolean
  value: number
  paid: number
  balance: number
  /** collected as a % of value (0 when no value is set) */
  paidPct: number
  /** date of the latest verified payment, if any */
  last_paid: string | null
  token: number
  booking: number
  full: number
  emi: EmiStatus | undefined
  registryDone: boolean
  /** fully paid, deal done, deed not yet registered */
  readyForRegistry: boolean
  bucket: Bucket
}

function bucketOf(value: number, balance: number, paid: number, token: number, booking: number, full: number, emi: EmiStatus | undefined, paidUnknown: boolean): Bucket {
  if (!(value > 0)) return 'price_missing'
  if (balance <= 0) return 'settled'
  if (emi && emi.overdue > 0) return 'emi_overdue'
  if (emi && emi.left > 0) return 'emi_running'
  // An old-register booking with nothing recorded (lib/bookingMath isPaidUnknown) is not
  // "no payment yet" — what was paid before the switch is simply not entered.
  if (paidUnknown) return 'old_unrecorded'
  if (!(paid > 0)) return 'not_started'
  if (token > 0 && booking <= 0 && full <= 0) return 'token_only'
  return 'balance_no_plan'
}

export async function fetchPipelineIndex(): Promise<IndexRow[]> {
  const [bookings, payments, emiByBooking] = await Promise.all([
    fetchAllRows((from, to) =>
      supabase.from('bp_bookings')
        .select(`id, booking_no, legacy_booking_no, notes, stage, created_at, application_date,
                 total_amount, plot_total_price, customer_id, broker_id, project_id, plot_id,
                 commission_mode, registry_date, registry_completed_at,
                 bp_customers(name, phone, customer_code, previous_customer_code),
                 bp_plots(plot_no), brokers(name, broker_id)`)
        .not('stage', 'eq', 'cancelled')
        .order('created_at', { ascending: false })
        .order('id')
        .range(from, to)),
    fetchAllRows((from, to) =>
      supabase.from('bp_payments')
        .select('booking_id, amount, payment_type, payment_date, verification_status')
        .eq('verification_status', 'verified')
        .order('id')
        .range(from, to)),
    fetchEmiStatusAll(),
  ])

  const paidTotal = paidByBooking(payments as any[])
  const byType: Record<string, { token: number; booking: number; full: number }> = {}
  const lastPaid: Record<string, string> = {}
  for (const p of payments as any[]) {
    if (!p.booking_id) continue
    if (p.payment_date && (!lastPaid[p.booking_id] || p.payment_date > lastPaid[p.booking_id])) lastPaid[p.booking_id] = p.payment_date
    const t = (byType[p.booking_id] ??= { token: 0, booking: 0, full: 0 })
    const amt = Number(p.amount || 0)
    if (p.payment_type === 'token')   t.token   += amt
    if (p.payment_type === 'booking') t.booking += amt
    // The table accepts both spellings for a one-time full payment.
    if (p.payment_type === 'full' || p.payment_type === 'full_payment') t.full += amt
  }

  return (bookings as any[]).map(b => {
    const value   = bookingValue(b)
    const paid    = paidTotal[b.id] || 0
    const balance = balanceOf(value, paid)
    const t       = byType[b.id] || { token: 0, booking: 0, full: 0 }
    const emi     = emiByBooking[b.id]
    const registryDone = isRegistryDone(b)
    const imported = isImported(b)
    return {
      id: b.id,
      booking_no: b.booking_no || '',
      legacy_booking_no: b.legacy_booking_no || null,
      stage: b.stage || '',
      created_at: b.created_at || '',
      application_date: b.application_date || null,
      customer_id: b.customer_id || null,
      broker_id: b.broker_id || null,
      project_id: b.project_id || null,
      plot_id: b.plot_id || null,
      commission_mode: b.commission_mode || 'mlm',
      customer_name: b.bp_customers?.name || '',
      customer_phone: b.bp_customers?.phone || '',
      customer_code: b.bp_customers?.customer_code || '',
      previous_customer_code: b.bp_customers?.previous_customer_code || '',
      broker_name: b.brokers?.name || '',
      broker_code: b.brokers?.broker_id || '',
      plot_no: b.bp_plots?.plot_no || '',
      imported,
      value, paid, balance,
      paidPct: collectionPct(value, paid),
      last_paid: lastPaid[b.id] || null,
      token: t.token, booking: t.booking, full: t.full,
      emi,
      registryDone,
      // The Registry page's own test, so a booking is "ready" on both or on neither.
      readyForRegistry: isRegistryReady(b, paid),
      bucket: bucketOf(value, balance, paid, t.token, t.booking, t.full, emi, isPaidUnknown(b, paid)),
    }
  })
}

/** EMI due today or already late — the collection half of "today's work". */
export function emiDueByToday(r: IndexRow, today: string = todayLocalISO()): boolean {
  return !!r.emi && !!r.emi.next_due && r.emi.next_due <= today
}
