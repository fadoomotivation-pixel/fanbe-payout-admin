import { supabase } from '@/lib/supabase'
import { fetchAllRows, todayLocalISO } from '@/lib/fetchAll'
import { instalmentState, instalmentDue } from '@/lib/emiStatus'

// The one EMI number a CEO asks for first: "is mahine kitna aana chahiye, kitna aaya".
//
// This reads every instalment once and turns it into a cash-flow view — what is scheduled
// to come in each month, what actually came, and what is overdue and still owed.  It uses
// the same per-instalment rule as the rest of the app (lib/emiStatus), so "overdue" and
// "paid" here mean exactly what they mean on the pipeline and the chase list.
//
// "Collected in month X" is keyed on the date the instalment was paid (paid_at), not its due
// date, because that is when the money actually reached the business — which is what a
// cash-flow line is about.  An instalment settled late lands in the month it was paid.

export type MonthPoint = {
  ym: string            // '2026-10'
  label: string         // 'Oct 26'
  isFuture: boolean
  isCurrent: boolean
  expected: number      // scheduled to fall due this month
  expectedKist: number
  collected: number     // actually received this month (by paid date)
  collectedKist: number
}

export type EmiForecast = {
  months: MonthPoint[]
  thisMonth: {
    expected: number
    collected: number
    stillDue: number      // due this month and not yet paid
    pct: number
  }
  overdueCarried: number  // owed on instalments whose due date is before this month
  overdueCarriedKist: number
  dueTodayOrEarlier: number   // the collector's "to chase now" money
  activePlans: number
  totalBilled: number     // whole book: every instalment ever scheduled
  totalCollected: number
  lifetimePct: number
}

function monthLabel(ym: string): string {
  const [y, m] = ym.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString('en-IN', { month: 'short', year: '2-digit' })
}
function ymOf(dateStr: string): string { return (dateStr || '').slice(0, 7) }
function addMonths(d: Date, n: number): Date { return new Date(d.getFullYear(), d.getMonth() + n, 1) }

/**
 * @param back   months of history to show (default 3)
 * @param ahead  months of forecast to show (default 6)
 */
export async function fetchEmiForecast(back = 3, ahead = 6): Promise<EmiForecast> {
  const insts = await fetchAllRows((from, to) =>
    supabase.from('emi_installments')
      .select('schedule_id, due_date, amount, paid_amount, paid_at, status')
      .order('id').range(from, to))

  const today = todayLocalISO()
  const curYm = today.slice(0, 7)

  // Build the window of months we will show.
  const start = addMonths(new Date(), -back)
  const monthKeys: string[] = []
  for (let i = 0; i <= back + ahead; i++) monthKeys.push(ymOf(todayLocalISO(addMonths(start, i))))
  const byMonth: Record<string, MonthPoint> = {}
  for (const ym of monthKeys) {
    byMonth[ym] = { ym, label: monthLabel(ym), isFuture: ym > curYm, isCurrent: ym === curYm, expected: 0, expectedKist: 0, collected: 0, collectedKist: 0 }
  }

  let thisExpected = 0, thisCollected = 0, thisStillDue = 0
  let overdueCarried = 0, overdueCarriedKist = 0
  let dueTodayOrEarlier = 0
  let totalBilled = 0, totalCollected = 0
  const activeSchedules = new Set<string>()

  for (const i of insts as any[]) {
    const amount = Number(i.amount || 0)
    const dueYm = ymOf(i.due_date)
    const state = instalmentState(i, today)
    const paidAmt = state === 'paid'
      ? (Number(i.paid_amount || 0) || amount)   // a hand-ticked row has paid_amount 0 but is settled
      : Number(i.paid_amount || 0)

    totalBilled += amount
    totalCollected += paidAmt
    if (state !== 'paid') activeSchedules.add(i.schedule_id)

    // Expected falls in the due month.
    if (byMonth[dueYm]) { byMonth[dueYm].expected += amount; byMonth[dueYm].expectedKist += 1 }

    // Collected falls in the month the money arrived.
    if (paidAmt > 0) {
      const paidYm = ymOf(i.paid_at || i.due_date)
      if (byMonth[paidYm]) { byMonth[paidYm].collected += paidAmt; byMonth[paidYm].collectedKist += 1 }
    }

    // This month's numbers.
    if (dueYm === curYm) {
      thisExpected += amount
      if (state !== 'paid') thisStillDue += instalmentDue(i)
    }
    if (paidAmt > 0 && ymOf(i.paid_at || '') === curYm) thisCollected += paidAmt

    // Overdue carried = unpaid instalments whose due month is before this month.
    if (state === 'overdue' && dueYm < curYm) {
      overdueCarried += instalmentDue(i)
      overdueCarriedKist += 1
    }
    // What a collector should be chasing right now (due today or earlier, unpaid).
    if (state === 'overdue' || (state !== 'paid' && i.due_date && i.due_date <= today)) {
      dueTodayOrEarlier += instalmentDue(i)
    }
  }

  return {
    months: monthKeys.map(k => byMonth[k]),
    thisMonth: {
      expected: thisExpected,
      collected: thisCollected,
      stillDue: thisStillDue,
      pct: thisExpected > 0 ? Math.round((thisCollected / thisExpected) * 100) : 0,
    },
    overdueCarried,
    overdueCarriedKist,
    dueTodayOrEarlier,
    activePlans: activeSchedules.size,
    totalBilled,
    totalCollected,
    lifetimePct: totalBilled > 0 ? Math.round((totalCollected / totalBilled) * 100) : 0,
  }
}
