import { supabase } from '@/lib/supabase'

// One answer to "where has this booking's EMI reached".
//
// Customer Pipeline worked this out inline, the EMI panel worked it out again its own way,
// and the Analytics tile counted straight off emi_installments without going through either.
// Three sums of the same money is how two screens end up disagreeing about who is overdue —
// so the sum lives here now and every screen reads it from one place.
//
// Shape of the data: emi_schedules is one row per booking, emi_installments hangs off it by
// schedule_id.  An instalment is "overdue" when its due date has passed and it is not fully
// paid — status alone is not enough, because a row stays 'pending' until somebody marks it.

export type EmiStatus = {
  schedule_id: string
  /** instalments in the plan */
  total: number
  paid: number
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
}

function todayISO() { return new Date().toISOString().slice(0, 10) }

function emptyStatus(schedule_id: string, total: number): EmiStatus {
  return {
    schedule_id, total, paid: 0, partial: 0, overdue: 0, left: 0,
    next_due: null, per_inst: 0,
    amount_total: 0, amount_paid: 0, amount_left: 0, amount_overdue: 0,
    oldest_overdue: null,
  }
}

/** Per-booking EMI position, keyed by booking_id.  Bookings with no plan are absent. */
export async function fetchEmiStatus(bookingIds: string[]): Promise<Record<string, EmiStatus>> {
  const ids = (bookingIds || []).filter(Boolean)
  if (ids.length === 0) return {}

  const { data: scheds } = await supabase
    .from('emi_schedules')
    .select('id, booking_id, num_installments')
    .in('booking_id', ids)

  const schedList = (scheds || []) as any[]
  if (schedList.length === 0) return {}

  const { data: insts } = await supabase
    .from('emi_installments')
    .select('schedule_id, seq, due_date, amount, paid_amount, status')
    .in('schedule_id', schedList.map(s => s.id))

  const schedToBooking: Record<string, string> = {}
  const out: Record<string, EmiStatus> = {}
  for (const s of schedList) {
    schedToBooking[s.id] = s.booking_id
    out[s.booking_id] = emptyStatus(s.id, Number(s.num_installments || 0))
  }

  const today = todayISO()
  for (const i of ((insts || []) as any[])) {
    const bid = schedToBooking[i.schedule_id]
    if (!bid) continue
    const row = out[bid]
    const amount = Number(i.amount || 0)
    const paid   = Number(i.paid_amount || 0)
    const due    = Math.max(0, amount - paid)

    if (!row.per_inst && amount) row.per_inst = amount
    row.amount_total += amount
    row.amount_paid  += paid

    // "Settled" is decided by the money, not by the status flag: a row can sit at 'pending'
    // simply because nobody has clicked it yet, and treating that as unpaid when the cash
    // has arrived would put a paying customer on the defaulter list.
    const settled = i.status === 'paid' || due <= 0
    if (settled) { row.paid++; continue }

    if (paid > 0) row.partial++
    row.left++
    row.amount_left += due

    if (i.due_date && i.due_date < today) {
      row.overdue++
      row.amount_overdue += due
      if (!row.oldest_overdue || i.due_date < row.oldest_overdue) row.oldest_overdue = i.due_date
    }
    if (i.due_date && (!row.next_due || i.due_date < row.next_due)) row.next_due = i.due_date
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
 * This is what the "EMI Overdue" tile on Analytics was missing: the tile knew the number
 * but there was nowhere to go and see WHO, so the figure could not be acted on.
 */
export async function fetchOverdueEmi(): Promise<OverdueEmiRow[]> {
  const today = todayISO()

  const { data: insts } = await supabase
    .from('emi_installments')
    .select('schedule_id, due_date, amount, paid_amount, status')
    .lt('due_date', today)

  const rows = (insts || []) as any[]
  if (rows.length === 0) return []

  // Keep only what is genuinely unpaid, then collapse to one line per schedule.
  type Agg = { count: number; amount: number; oldest: string }
  const bySchedule: Record<string, Agg> = {}
  for (const i of rows) {
    const due = Math.max(0, Number(i.amount || 0) - Number(i.paid_amount || 0))
    if (i.status === 'paid' || due <= 0) continue
    const a = bySchedule[i.schedule_id] ??= { count: 0, amount: 0, oldest: i.due_date }
    a.count++
    a.amount += due
    if (i.due_date < a.oldest) a.oldest = i.due_date
  }
  const schedIds = Object.keys(bySchedule)
  if (schedIds.length === 0) return []

  const { data: scheds } = await supabase
    .from('emi_schedules')
    .select('id, booking_id, customer_id')
    .in('id', schedIds)

  const schedList = (scheds || []) as any[]
  const bookingIds = schedList.map(s => s.booking_id).filter(Boolean)
  if (bookingIds.length === 0) return []

  const { data: bookings } = await supabase
    .from('bp_bookings')
    .select('id, booking_no, commission_mode, broker_id, customer_id, bp_customers(name, customer_code, phone), bp_projects(name), bp_plots(plot_no)')
    .in('id', bookingIds)

  const bookingById: Record<string, any> = {}
  for (const b of ((bookings || []) as any[])) bookingById[b.id] = b

  // Brokers are fetched separately rather than embedded: the FK embed for broker_id is not
  // declared on this table, and a missing embed silently returns null instead of failing.
  const brokerIds = Array.from(new Set(((bookings || []) as any[]).map(b => b.broker_id).filter(Boolean)))
  const brokerById: Record<string, any> = {}
  if (brokerIds.length > 0) {
    const { data: brks } = await supabase.from('brokers').select('id, name, broker_id').in('id', brokerIds)
    for (const b of ((brks || []) as any[])) brokerById[b.id] = b
  }

  const out: OverdueEmiRow[] = []
  for (const s of schedList) {
    const agg = bySchedule[s.id]
    const b = bookingById[s.booking_id]
    if (!agg || !b) continue
    const brk = b.broker_id ? brokerById[b.broker_id] : null
    const days = Math.floor((Date.now() - new Date(agg.oldest).getTime()) / 86400000)
    out.push({
      booking_id: b.id,
      customer_id: b.customer_id || s.customer_id || null,
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
      instalments_overdue: agg.count,
      amount_overdue: agg.amount,
      oldest_due: agg.oldest,
      days_late: days,
    })
  }

  // Worst first: the longest-running default is the one to chase this morning.
  out.sort((a, b) => b.days_late - a.days_late || b.amount_overdue - a.amount_overdue)
  return out
}
