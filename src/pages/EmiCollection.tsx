// EMI Collection — the management team's cash-flow cockpit for instalments.
//
// The business sells on EMI, so "kitna paisa is mahine aana chahiye, kitna aaya, kitna
// phasa hua hai" is the question that runs the month.  It was answerable only by adding up
// instalments by hand.  This puts it on one screen: what is due this month against what has
// come in, the money overdue and carried from earlier months, and a month-by-month line of
// expected vs collected — three months back and six ahead, so the office can see the inflow
// coming before it arrives and staff a collection drive for the heavy months.
//
// Every figure is the shared EMI rule (lib/emiForecast → lib/emiStatus), so it agrees with
// the EMI Overdue chase list, the Customer Pipeline and the Dashboard tile.
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { formatINR } from '@/lib/utils'
import { fetchEmiForecast, type EmiForecast } from '@/lib/emiForecast'
import {
  Calculator, TrendingUp, AlertTriangle, Wallet, CalendarRange, ArrowRight, Download, CheckCircle2,
} from 'lucide-react'

export default function EmiCollection() {
  const { data, isLoading } = useQuery<EmiForecast>({
    queryKey: ['emi_forecast'],
    queryFn: () => fetchEmiForecast(3, 6),
    staleTime: 60_000,
  })

  const maxBar = data ? Math.max(1, ...data.months.map(m => Math.max(m.expected, m.collected))) : 1

  const exportCsv = () => {
    if (!data) return
    const header = ['Month', 'Expected', 'Expected kist', 'Collected', 'Collected kist', 'Type']
    const body = data.months.map(m => [m.label, m.expected, m.expectedKist, m.collected, m.collectedKist,
      m.isCurrent ? 'current' : m.isFuture ? 'forecast' : 'past'])
    const csv = [header, ...body].map(l => l.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }))
    const a = document.createElement('a'); a.href = url; a.download = `emi-forecast-${new Date().toISOString().slice(0, 10)}.csv`; a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="p-4 md:p-8 space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2"><Calculator size={18} className="text-blue-600"/>EMI Collection</h1>
          <p className="text-sm text-gray-500 mt-0.5">What is due, what has come in, and the inflow coming month by month.</p>
        </div>
        <div className="flex gap-2">
          <Link to="/emi-overdue" className="inline-flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg bg-rose-600 text-white hover:bg-rose-700">
            <AlertTriangle size={14}/>Chase overdue
          </Link>
          <button onClick={exportCsv} disabled={!data}
            className="inline-flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg bg-white border border-gray-200 text-gray-700 hover:border-gray-400 disabled:opacity-40">
            <Download size={14}/>CSV
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="py-16 text-center text-sm text-gray-400">Working out the schedule…</div>
      ) : !data ? (
        <div className="py-16 text-center text-sm text-gray-400">Could not load the EMI schedule.</div>
      ) : (
        <>
          {/* This month */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Tile icon={<CalendarRange size={14}/>} tone="blue"  label="Due this month"
              value={formatINR(data.thisMonth.expected)} sub={`${data.thisMonth.pct}% collected so far`}/>
            <Tile icon={<Wallet size={14}/>}        tone="emerald" label="Collected this month"
              value={formatINR(data.thisMonth.collected)} sub="received in this month"/>
            <Tile icon={<TrendingUp size={14}/>}    tone={data.thisMonth.stillDue > 0 ? 'amber' : 'gray'} label="Still to come (this month)"
              value={formatINR(data.thisMonth.stillDue)} sub="due this month, unpaid"/>
            <Tile icon={<AlertTriangle size={14}/>} tone={data.overdueCarried > 0 ? 'rose' : 'gray'} label="Overdue carried"
              value={formatINR(data.overdueCarried)} sub={`${data.overdueCarriedKist} kist from earlier months`}/>
          </div>

          {/* Month-by-month expected vs collected */}
          <div className="bg-white border border-gray-200 rounded-xl p-4">
            <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
              <h2 className="text-sm font-semibold text-gray-900">Expected vs collected</h2>
              <div className="flex items-center gap-3 text-[11px] text-gray-500">
                <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-blue-300"/>Expected</span>
                <span className="inline-flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-emerald-500"/>Collected</span>
              </div>
            </div>
            <div className="space-y-2.5">
              {data.months.map(m => (
                <div key={m.ym} className={`flex items-center gap-3 ${m.isCurrent ? 'bg-blue-50/50 -mx-2 px-2 py-1 rounded-lg' : ''}`}>
                  <div className="w-14 shrink-0 text-[12px] text-gray-600 tabular-nums">
                    {m.label}{m.isCurrent && <span className="block text-[9px] text-blue-600 font-semibold">NOW</span>}
                  </div>
                  <div className="flex-1 min-w-0 space-y-1">
                    {/* Expected bar */}
                    <div className="h-3.5 rounded bg-gray-100 overflow-hidden relative">
                      <div className="h-full bg-blue-300" style={{ width: `${(m.expected / maxBar) * 100}%` }}/>
                    </div>
                    {/* Collected bar — not drawn for future months, there's nothing yet */}
                    {!m.isFuture && (
                      <div className="h-3.5 rounded bg-gray-100 overflow-hidden">
                        <div className="h-full bg-emerald-500" style={{ width: `${(m.collected / maxBar) * 100}%` }}/>
                      </div>
                    )}
                  </div>
                  <div className="w-40 shrink-0 text-right text-[11px] tabular-nums">
                    <div className="text-blue-700">{formatINR(m.expected)}<span className="text-gray-400"> · {m.expectedKist}</span></div>
                    {m.isFuture
                      ? <div className="text-gray-300">forecast</div>
                      : <div className="text-emerald-700">{formatINR(m.collected)}<span className="text-gray-400"> · {m.collectedKist}</span></div>}
                  </div>
                </div>
              ))}
            </div>
            <p className="text-[11px] text-gray-400 mt-3">
              Expected is what falls due in the month. Collected is money received in that month, by payment date — a late payment shows in the month it actually came.
            </p>
          </div>

          {/* Lifetime */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Tile icon={<CheckCircle2 size={14}/>} tone="gray" label="Active EMI plans"
              value={String(data.activePlans)} sub="with something still to pay"/>
            <Tile icon={<AlertTriangle size={14}/>} tone={data.dueTodayOrEarlier > 0 ? 'rose' : 'gray'} label="To chase now"
              value={formatINR(data.dueTodayOrEarlier)} sub="due today or earlier, unpaid"/>
            <Tile icon={<Wallet size={14}/>} tone="emerald" label="Collected to date"
              value={formatINR(data.totalCollected)} sub={`${data.lifetimePct}% of all billed`}/>
            <Tile icon={<TrendingUp size={14}/>} tone="blue" label="Billed to date"
              value={formatINR(data.totalBilled)} sub="every instalment scheduled"/>
          </div>

          <Link to="/emi-overdue" className="inline-flex items-center gap-1.5 text-sm text-blue-700 hover:underline">
            See who is overdue, worst first<ArrowRight size={14}/>
          </Link>
        </>
      )}
    </div>
  )
}

const TONES: Record<string, string> = {
  gray:    'bg-white border-gray-200 text-gray-900',
  blue:    'bg-blue-50/50 border-blue-200 text-blue-900',
  emerald: 'bg-emerald-50/50 border-emerald-200 text-emerald-900',
  amber:   'bg-amber-50/50 border-amber-200 text-amber-900',
  rose:    'bg-rose-50/50 border-rose-200 text-rose-900',
}

function Tile({ icon, label, value, sub, tone }: { icon: any; label: string; value: string; sub: string; tone: string }) {
  return (
    <div className={`border rounded-xl p-4 ${TONES[tone] || TONES.gray}`}>
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide opacity-70">{icon}{label}</div>
      <div className="text-xl font-bold mt-1 tabular-nums">{value}</div>
      <div className="text-[11px] opacity-60 mt-0.5">{sub}</div>
    </div>
  )
}
