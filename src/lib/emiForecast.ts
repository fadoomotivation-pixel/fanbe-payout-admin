import { supabase } from '@/lib/supabase'
import { todayLocalISO } from '@/lib/fetchAll'
import { instalmentState, instalmentDue, fetchLiveSchedules } from '@/lib/emiStatus'
import { inChunks } from '@/lib/fetchAll'

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
// paid_at is a UTC timestamp.  Slicing it as text put a payment taken at 1 a.m. IST on the
// 1st into the previous month; read it as a local date first.
function localYm(ts: string | null | undefined): string {
  if (!ts) return ''
  const d = new Date(ts)
  return isNaN(d.getTime()) ? ymOf(ts) : todayLocalISO(d).slice(0, 7)
}
function addMonths(d: Date, n: number): Date { return new Date(d.getFullYear(), d.getMonth() + n, 1) }

/**
 * @param back   months of history to show (default 3)
 * @param ahead  months of forecast to show (default 6)
 */
export async function fetchEmiForecast(back = 3, ahead = 6): Promise<EmiForecast> {
  // Only live plans: a closed plan or a cancelled booking's plan is not money coming in.
  const plans = await fetchLiveSchedules()
  const insts = plans.length
    ? await inChunks(plans.map((p: any) => p.id), chunk =>
        supabase.from('emi_installments')
          .select('schedule_id, due_date, amount, paid_amount, paid_at, status')
          .in('schedule_id', chunk))
    : []

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
    // Same money rule as lib/emiStatus: a settled instalment counts its full amount (a
    // hand-ticked row has paid_amount 0), anything over the instalment is not counted, and an
    // open one counts what has actually been paid towards it.
    const paidAmt = state === 'paid' ? amount : Math.min(amount, Number(i.paid_amount || 0))
    // One key for "the month this money came in", used by the bar AND the tile so the two
    // can never disagree.  No paid_at (an old hand-ticked row) falls back to the due month.
    const paidYm = localYm(i.paid_at) || dueYm

    totalBilled += amount
    totalCollected += paidAmt
    if (state !== 'paid') activeSchedules.add(i.schedule_id)

    // Expected falls in the due month.
    if (byMonth[dueYm]) { byMonth[dueYm].expected += amount; byMonth[dueYm].expectedKist += 1 }

    // Collected falls in the month the money arrived.
    if (paidAmt > 0) {
      if (byMonth[paidYm]) { byMonth[paidYm].collected += paidAmt; byMonth[paidYm].collectedKist += 1 }
    }

    // This month's numbers.
    if (dueYm === curYm) {
      thisExpected += amount
      if (state !== 'paid') thisStillDue += instalmentDue(i)
    }
    if (paidAmt > 0 && paidYm === curYm) thisCollected += paidAmt

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
      // Share of THIS month's instalments already settled.  Dividing collected by expected
      // mixed in late money for earlier months and could read over 100%.
      pct: thisExpected > 0 ? Math.round(((thisExpected - thisStillDue) / thisExpected) * 100) : 0,
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
