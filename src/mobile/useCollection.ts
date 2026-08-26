import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { bookingValue, balanceOf, paidByBooking } from '@/lib/bookingMath'

// The caller's queue, built once and shared by every screen in the app.
//
// "Who do I ring today" is three groups, and they must not be confused with each other:
//   overdue  — an instalment is past its due date and unpaid
//   promised — the customer said they would pay today (or a promise has slipped)
//   today    — a follow-up the caller themselves booked for today
//
// Sorted by how late the money is, so the worst account is the first call of the day
// rather than whatever happens to sort first alphabetically.

export const todayISO = () => new Date().toISOString().slice(0, 10)

export type CallTarget = {
  bookingId: string
  customerId: string | null
  name: string
  phone: string | null
  bookingNo: string
  projectName: string | null
  plotNo: string | null
  totalValue: number
  paid: number
  balance: number
  overdueAmount: number
  overdueCount: number
  oldestDueDate: string | null
  daysLate: number
  lastCall: any | null
  followUpDate: string | null
  promisedAmount: number | null
  reason: 'overdue' | 'followup'
}

export function useCallQueue() {
  return useQuery<CallTarget[]>({
    queryKey: ['m_call_queue'],
    queryFn: async () => {
      const t = todayISO()

      const [instRes, schedRes, callRes] = await Promise.all([
        supabase.from('emi_installments')
          .select('schedule_id, seq, due_date, amount, paid_amount, status')
          .neq('status', 'paid').lte('due_date', t),
        supabase.from('emi_schedules').select('id, booking_id'),
        // Latest call per booking is derived below; one ordered fetch is cheaper than a
        // query per row and keeps the list rendering in a single pass.
        supabase.from('calls')
          .select('id, booking_id, customer_id, created_at, status, notes, feedback, major_objection, next_followup_date, promised_amount, promised_date, employee_name')
          .not('booking_id', 'is', null)
          .order('created_at', { ascending: false })
          .limit(2000),
      ])

      const schedToBooking: Record<string, string> = {}
      for (const s of (schedRes.data || []) as any[]) schedToBooking[s.id] = s.booking_id

      // Overdue money per booking.
      const overdue: Record<string, { amount: number; count: number; oldest: string | null }> = {}
      for (const i of (instRes.data || []) as any[]) {
        const bid = schedToBooking[i.schedule_id]
        if (!bid) continue
        const due = Math.max(0, Number(i.amount || 0) - Number(i.paid_amount || 0))
        if (due <= 0) continue
        const row = (overdue[bid] ||= { amount: 0, count: 0, oldest: null })
        row.amount += due
        row.count += 1
        if (!row.oldest || (i.due_date && i.due_date < row.oldest)) row.oldest = i.due_date
      }

      // Most recent call per booking.
      const lastCall: Record<string, any> = {}
      for (const c of (callRes.data || []) as any[]) {
        if (c.booking_id && !lastCall[c.booking_id]) lastCall[c.booking_id] = c
      }

      // Anyone with a follow-up booked for today or earlier still needs ringing, even if
      // no instalment has come due since.
      const followUpIds = new Set<string>()
      for (const [bid, c] of Object.entries(lastCall)) {
        const d = (c as any).next_followup_date
        if (d && d <= t && (c as any).followup_status !== 'done') followUpIds.add(bid)
      }

      const ids = Array.from(new Set([...Object.keys(overdue), ...followUpIds]))
      if (ids.length === 0) return []

      const [bkRes, payRes] = await Promise.all([
        supabase.from('bp_bookings')
          .select('id, booking_no, total_amount, plot_total_price, customer_id, stage, bp_customers(id, name, phone), bp_projects(name), bp_plots(plot_no)')
          .in('id', ids.slice(0, 500))
          .neq('stage', 'cancelled'),
        supabase.from('bp_payments').select('booking_id, amount, verification_status').in('booking_id', ids.slice(0, 500)),
      ])

      const paid = paidByBooking(payRes.data as any[])

      const out: CallTarget[] = ((bkRes.data || []) as any[]).map(b => {
        const od = overdue[b.id] || { amount: 0, count: 0, oldest: null }
        const value = bookingValue(b)
        const got = paid[b.id] || 0
        const daysLate = od.oldest
          ? Math.max(0, Math.floor((Date.now() - new Date(od.oldest).getTime()) / 86400000))
          : 0
        const lc = lastCall[b.id] || null
        return {
          bookingId: b.id,
          customerId: b.bp_customers?.id ?? b.customer_id ?? null,
          name: b.bp_customers?.name || '(no name)',
          phone: b.bp_customers?.phone || null,
          bookingNo: b.booking_no || '',
          projectName: b.bp_projects?.name || null,
          plotNo: b.bp_plots?.plot_no || null,
          totalValue: value,
          paid: got,
          balance: balanceOf(value, got),
          overdueAmount: od.amount,
          overdueCount: od.count,
          oldestDueDate: od.oldest,
          daysLate,
          lastCall: lc,
          followUpDate: lc?.next_followup_date || null,
          promisedAmount: lc?.promised_amount ?? null,
          reason: od.count > 0 ? 'overdue' : 'followup',
        }
      })

      // Longest overdue first — the account most at risk is the first call made.
      out.sort((a, b) => (b.daysLate - a.daysLate) || (b.overdueAmount - a.overdueAmount))
      return out
    },
  })
}

/** Every call ever logged against a booking, newest first. */
export function useCallHistory(bookingId: string | null | undefined) {
  return useQuery({
    queryKey: ['m_call_history', bookingId],
    enabled: !!bookingId,
    queryFn: async () => {
      const { data, error } = await supabase.from('calls')
        .select('*').eq('booking_id', bookingId!).order('created_at', { ascending: false })
      if (error) throw error
      return data || []
    },
  })
}
