import { supabase } from '@/lib/supabase'
import { fetchAllRows, inChunks, todayLocalISO } from '@/lib/fetchAll'

// One answer to "where has this booking's EMI reached".
//
// Customer Pipeline, the EMI panel and Analytics each used to work this out their own way,
// and they disagreed: one went by the status flag, one by the money, and one compared the
// due date against a UTC clock — so an instalment due today turned "overdue" at 05:30 IST
// on one screen and not on another.  Every screen now reads the same rule from here.
//
// Shape of the data: emi_schedules is one row per booking; emi_installments hangs off it by
// schedule_id (there is no booking_id on the instalment).

// ── The rule for one instalment ─────────────────────────────────────
//
// Decided by the MONEY, not the status flag: a row stays 'pending' until somebody clicks
// it, and treating a paid-but-unticked instalment as unpaid would put a paying customer on
// the defaulter list.  "Overdue" means the due date is strictly before today in the local
// calendar — an instalment due today is due, not late.
export type InstalmentState = 'paid' | 'overdue' | 'partial' | 'upcoming'

export function instalmentDue(i: { amount?: any; paid_amount?: any }): number {
  return Math.max(0, Number(i.amount || 0) - Number(i.paid_amount || 0))
}

export function instalmentState(
  i: { amount?: any; paid_amount?: any; status?: string | null; due_date?: string | null },
  today: string = todayLocalISO(),
): InstalmentState {
  if (i.status === 'paid' || instalmentDue(i) <= 0) return 'paid'
  // Part-paid AND past due is overdue: the shortfall is late, whatever was paid towards it.
  if (i.due_date && i.due_date < today) return 'overdue'
  if (Number(i.paid_amount || 0) > 0) return 'partial'
  return 'upcoming'
}

export type EmiStatus = {
  schedule_id: string
  /** instalments in the plan */
  total: number
  paid: number
  /** part-paid (whether or not also overdue) */
  partial: number
  /** past due and not fully paid */
  overdue: number
  /** not fully paid yet, whether due or not */
  left: number
  next_due: string | null
  per_inst: number
  amount_total: number
  amount_paid: number
  /** what the customer still owes on the EMI plan */
  amount_left: number
  /** the part of that which is already past its due date */
  amount_overdue: number
  /** oldest unpaid due date, for "how long has this been running" */
  oldest_overdue: string | null
  frequency: string | null
}

function emptyStatus(schedule_id: string, total: number, frequency: string | null): EmiStatus {
  return {
    schedule_id, total, paid: 0, partial: 0, overdue: 0, left: 0,
    next_due: null, per_inst: 0,
    amount_total: 0, amount_paid: 0, amount_left: 0, amount_overdue: 0,
    oldest_overdue: null, frequency,
  }
}

function aggregate(schedList: any[], insts: any[]): Record<string, EmiStatus> {
  const schedToBooking: Record<string, string> = {}
  const out: Record<string, EmiStatus> = {}
  for (const s of schedList) {
    if (!s.booking_id) continue
    schedToBooking[s.id] = s.booking_id
    out[s.booking_id] = emptyStatus(s.id, Number(s.num_installments || 0), s.frequency || null)
  }

  const today = todayLocalISO()
  for (const i of insts) {
    const bid = schedToBooking[i.schedule_id]
    if (!bid) continue
    const row = out[bid]
    const amount = Number(i.amount || 0)
    const paid   = Number(i.paid_amount || 0)
    const due    = instalmentDue(i)
    const state  = instalmentState(i, today)

    if (!row.per_inst && amount) row.per_inst = amount
    row.amount_total += amount

    // A row ticked 'paid' by hand carries status='paid' with paid_amount still 0, so a
    // settled instalment counts its full amount as paid.  Anything over the instalment is
    // not instalment money and is not counted here.
    if (state === 'paid') { row.paid++; row.amount_paid += amount; continue }

    row.amount_paid += paid
    if (paid > 0) row.partial++
    row.left++
    row.amount_left += due
    if (state === 'overdue') {
      row.overdue++
      row.amount_overdue += due
      if (!row.oldest_overdue || i.due_date < row.oldest_overdue) row.oldest_overdue = i.due_date
    }
    if (i.due_date && (!row.next_due || i.due_date < row.next_due)) row.next_due = i.due_date
  }
  return out
}

const SCHED_COLS = 'id, booking_id, customer_id, num_installments, frequency, principal, total_payable, start_date, interest_rate_pct, interest_method, status'
const INST_COLS  = 'id, schedule_id, seq, due_date, amount, paid_amount, paid_at, status, late_fee'

/** Per-booking EMI position, keyed by booking_id.  Bookings with no plan are absent. */
export async function fetchEmiStatus(bookingIds: string[]): Promise<Record<string, EmiStatus>> {
  const ids = (bookingIds || []).filter(Boolean)
  if (ids.length === 0) return {}
  const schedList = await inChunks(ids, chunk =>
    supabase.from('emi_schedules').select(SCHED_COLS).in('booking_id', chunk))
  if (schedList.length === 0) return {}
  const insts = await inChunks(schedList.map((s: any) => s.id), chunk =>
    supabase.from('emi_installments').select(INST_COLS).in('schedule_id', chunk))
  return aggregate(schedList, insts)
}

/** Every booking's EMI position — for screens that work across the whole book. */
export async function fetchEmiStatusAll(): Promise<Record<string, EmiStatus>> {
  const schedList = await fetchAllRows((from, to) =>
    supabase.from('emi_schedules').select(SCHED_COLS).order('id').range(from, to))
  if (schedList.length === 0) return {}
  const insts = await fetchAllRows((from, to) =>
    supabase.from('emi_installments').select(INST_COLS).order('id').range(from, to))
  return aggregate(schedList, insts)
}

// ── Full schedules, for printing a kist card ────────────────────────
export type EmiScheduleRow = {
  seq: number
  due_date: string
  amount: number
  paid_amount: number
  paid_at: string | null
  due: number
  state: InstalmentState
}
export type EmiScheduleDetail = {
  booking_id: string
  schedule: any
  rows: EmiScheduleRow[]
  status: EmiStatus
}

/** The plan and every instalment for each booking, with the same per-row rule as above. */
export async function fetchEmiSchedules(bookingIds: string[]): Promise<Record<string, EmiScheduleDetail>> {
  const ids = (bookingIds || []).filter(Boolean)
  if (ids.length === 0) return {}
  const schedList = await inChunks(ids, chunk =>
    supabase.from('emi_schedules').select(SCHED_COLS).in('booking_id', chunk))
  if (schedList.length === 0) return {}
  const insts = await inChunks(schedList.map((s: any) => s.id), chunk =>
    supabase.from('emi_installments').select(INST_COLS).in('schedule_id', chunk))

  const statusByBooking = aggregate(schedList, insts)
  const today = todayLocalISO()
  const out: Record<string, EmiScheduleDetail> = {}
  for (const s of schedList as any[]) {
    if (!s.booking_id) continue
    const rows = (insts as any[])
      .filter(i => i.schedule_id === s.id)
      .sort((a, b) => Number(a.seq || 0) - Number(b.seq || 0))
      .map(i => ({
        seq: Number(i.seq || 0),
        due_date: i.due_date,
        amount: Number(i.amount || 0),
        paid_amount: Number(i.paid_amount || 0),
        paid_at: i.paid_at || null,
        due: instalmentDue(i),
        state: instalmentState(i, today),
      }))
    out[s.booking_id] = { booking_id: s.booking_id, schedule: s, rows, status: statusByBooking[s.booking_id] }
  }
  return out
}

export type OverdueEmiRow = {
  booking_id: string
  customer_id: string | null
  customer_name: string
  customer_code: string
  phone: string | null
  booking_no: string
  project_name: string
  plot_no: string
  broker_id: string | null
  broker_name: string
  broker_code: string
  commission_mode: string
  instalments_overdue: number
  amount_overdue: number
  oldest_due: string
  days_late: number
}

/**
 * Every booking with at least one instalment past its due date, worst first.
 *
 * Built on fetchEmiStatusAll so "overdue" here is exactly what every other screen calls
 * overdue.
 */
export async function fetchOverdueEmi(): Promise<OverdueEmiRow[]> {
  const all = await fetchEmiStatusAll()
  const late = Object.entries(all).filter(([, s]) => s.overdue > 0)
  if (late.length === 0) return []
  const bookingIds = late.map(([bid]) => bid)

  const bookings = await inChunks(bookingIds, chunk =>
    supabase.from('bp_bookings')
      .select('id, booking_no, commission_mode, broker_id, customer_id, bp_customers(name, customer_code, phone), bp_projects(name), bp_plots(plot_no)')
      .in('id', chunk))
  const bookingById: Record<string, any> = {}
  for (const b of bookings as any[]) bookingById[b.id] = b

  // Brokers are fetched separately rather than embedded: an embed that does not resolve
  // returns null quietly instead of failing, and the name would just go missing.
  const brokerIds = (bookings as any[]).map(b => b.broker_id).filter(Boolean)
  const brks = brokerIds.length
    ? await inChunks(brokerIds, chunk => supabase.from('brokers').select('id, name, broker_id').in('id', chunk))
    : []
  const brokerById: Record<string, any> = {}
  for (const b of brks as any[]) brokerById[b.id] = b

  const out: OverdueEmiRow[] = []
  for (const [bid, s] of late) {
    const b = bookingById[bid]
    if (!b || !s.oldest_overdue) continue
    const brk = b.broker_id ? brokerById[b.broker_id] : null
    const days = Math.floor((Date.parse(todayLocalISO()) - Date.parse(s.oldest_overdue)) / 86400000)
    out.push({
      booking_id: b.id,
      customer_id: b.customer_id || null,
      customer_name: b.bp_customers?.name || '—',
      customer_code: b.bp_customers?.customer_code || '',
      phone: b.bp_customers?.phone || null,
      booking_no: b.booking_no || '—',
      project_name: b.bp_projects?.name || '—',
      plot_no: b.bp_plots?.plot_no || '—',
      broker_id: b.broker_id || null,
      broker_name: brk?.name || '—',
      broker_code: brk?.broker_id || '',
      commission_mode: b.commission_mode || 'mlm',
      instalments_overdue: s.overdue,
      amount_overdue: s.amount_overdue,
      oldest_due: s.oldest_overdue,
      days_late: days,
    })
  }

  // Worst first: the longest-running default is the one to chase this morning.
  out.sort((a, b) => b.days_late - a.days_late || b.amount_overdue - a.amount_overdue)
  return out
}
