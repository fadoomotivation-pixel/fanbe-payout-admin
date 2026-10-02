// Record Health — the bookings that are missing something, as a work queue.
//
// Measured when this page was written: 877 bookings, of which 796 came in from the old
// records sheet with only a name, a size and a price.  So
//
//   864 have no payment ever recorded      — collection reports cover ~1.5% of the book
//   796 have no broker                      — agent report and commission see 81 bookings
//   410 have no plot linked                 — and for 195 of them a plot of the same size
//                                             in the same project is still listed as free,
//                                             so inventory cannot be trusted not to resell
//   138 have no value                       — business value reads low
//
// No filter or report built on top of that can be more right than the records under it.
// This page does not guess the missing data — it cannot know who sold a 2019 plot — it
// lists exactly which records need a human, and sends the "Fix" click to the existing
// edit screen so there is one way to change a booking, not two.
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { formatINR } from '@/lib/utils'
import { bookingValue } from '@/lib/bookingMath'
import { ShieldCheck, Search, AlertTriangle, ArrowRight, Download } from 'lucide-react'

type Issue = 'no_payment' | 'no_broker' | 'no_plot' | 'no_value' | 'no_project' | 'bad_phone'

const ISSUES: { key: Issue; label: string; why: string; fix: 'booking' | 'customer'; severity: 'high' | 'mid' }[] = [
  { key: 'no_plot',    label: 'Plot not linked',        severity: 'high', fix: 'booking',
    why: 'Inventory cannot tell which plot was sold, so a sold plot may still show as available — and be sold again.' },
  { key: 'no_value',   label: 'Booking value is ₹0',    severity: 'high', fix: 'booking',
    why: 'Balance, collection % and business value are all wrong for these.' },
  { key: 'bad_phone',  label: 'Customer phone missing', severity: 'high', fix: 'customer',
    why: 'Nobody can call or WhatsApp them about an EMI.' },
  { key: 'no_broker',  label: 'Broker not recorded',    severity: 'mid',  fix: 'booking',
    why: 'Agent report and commission cannot see these. Leave empty only if it was a direct / walk-in sale.' },
  { key: 'no_project', label: 'Project not set',        severity: 'mid',  fix: 'booking',
    why: 'Project-wise reports leave these out.' },
  { key: 'no_payment', label: 'No payment ever recorded', severity: 'mid', fix: 'customer',
    why: 'Old bookings whose payment history was never entered. Until it is, collected and balance figures are not real.' },
]

const SCORED: Issue[] = ['no_plot', 'no_value', 'bad_phone', 'no_project']

type Row = {
  id: string
  booking_no: string
  legacy_no: string | null
  customer_id: string | null
  customer_name: string
  phone: string | null
  project_name: string
  size: number | null
  value: number
  issues: Issue[]
}

export default function DataHealth() {
  const [active, setActive] = useState<Issue>('no_plot')
  const [q, setQ] = useState('')
  const [limit, setLimit] = useState(100)

  const { data: rows = [], isLoading } = useQuery<Row[]>({
    queryKey: ['data_health'],
    // Re-checked whenever the tab regains focus, so fixing a record in the edit screen and
    // coming back shows the queue shrink without a manual refresh.
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const [bk, pay] = await Promise.all([
        supabase.from('bp_bookings')
          .select('id, booking_no, legacy_booking_no, customer_id, broker_id, plot_id, project_id, stage, size_sqyd, total_amount, plot_total_price, base_price, bp_customers(name, phone), bp_projects(name)')
          .neq('stage', 'cancelled'),
        supabase.from('bp_payments').select('booking_id'),
      ])
      if (bk.error) throw bk.error
      const paid = new Set(((pay.data || []) as any[]).map(p => p.booking_id))
      return ((bk.data || []) as any[]).map(b => {
        const value = bookingValue(b)
        const digits = String(b.bp_customers?.phone || '').replace(/\D/g, '')
        const issues: Issue[] = []
        if (!b.plot_id) issues.push('no_plot')
        if (!(value > 0)) issues.push('no_value')
        // Indian mobiles are 10 digits; anything shorter cannot be dialled.
        if (digits.length < 10) issues.push('bad_phone')
        if (!b.broker_id) issues.push('no_broker')
        if (!b.project_id) issues.push('no_project')
        if (!paid.has(b.id)) issues.push('no_payment')
        return {
          id: b.id,
          booking_no: b.booking_no || '—',
          legacy_no: b.legacy_booking_no || null,
          customer_id: b.customer_id || null,
          customer_name: b.bp_customers?.name || '—',
          phone: b.bp_customers?.phone || null,
          project_name: b.bp_projects?.name || '—',
          size: b.size_sqyd != null ? Number(b.size_sqyd) : null,
          value,
          issues,
        }
      })
    },
  })

  const counts = useMemo(() => {
    const c = Object.fromEntries(ISSUES.map(i => [i.key, 0])) as Record<Issue, number>
    for (const r of rows) for (const i of r.issues) c[i]++
    return c
  }, [rows])

  // The score counts only definite defects — no plot, no value, no dialable phone, no
  // project.  Two things are left out on purpose:
  //   - broker: a direct / walk-in sale legitimately has none, and the page cannot tell
  //     those apart, so counting it would make 100% unreachable and the number meaningless;
  //   - payment history: a backlog of past entries, not something wrong with the booking.
  // Both still have their own queue below.  (At the time of writing: 51% on this score;
  // it would read 1% if broker were counted, which is alarming but not actionable.)
  const score = useMemo(() => {
    if (rows.length === 0) return 100
    const complete = rows.filter(r => !r.issues.some(i => SCORED.includes(i))).length
    return Math.round((complete / rows.length) * 100)
  }, [rows])

  const list = useMemo(() => {
    let l = rows.filter(r => r.issues.includes(active))
    const needle = q.trim().toLowerCase()
    if (needle) {
      l = l.filter(r => `${r.customer_name} ${r.booking_no} ${r.legacy_no || ''} ${r.project_name} ${r.phone || ''}`.toLowerCase().includes(needle))
    }
    return l
  }, [rows, active, q])

  const meta = ISSUES.find(i => i.key === active)!

  const fixHref = (r: Row) =>
    meta.fix === 'customer' && r.customer_id
      ? `/customer-pipeline?customer=${r.customer_id}`
      : `/bookings?edit=${r.id}`

  const exportCsv = () => {
    const header = ['Issue', 'Booking', 'Old no', 'Customer', 'Phone', 'Project', 'Size (sq yd)', 'Value', 'All issues']
    const body = list.map(r => [
      meta.label, r.booking_no, r.legacy_no || '', r.customer_name, r.phone || '', r.project_name,
      r.size ?? '', r.value, r.issues.map(i => ISSUES.find(x => x.key === i)?.label).join('; '),
    ])
    const csv = [header, ...body].map(line => line.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `record-health-${active}-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="p-4 md:p-8 space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2"><ShieldCheck size={18} className="text-blue-600"/>Record Health</h1>
          <p className="text-sm text-gray-500 mt-0.5 max-w-2xl">
            Every report in this CRM is only as right as the bookings under it. These are the records missing something — work through them and the reports become true.
          </p>
        </div>
        <div className="text-right">
          <div className={`text-3xl font-bold tabular-nums ${score >= 90 ? 'text-emerald-600' : score >= 60 ? 'text-amber-600' : 'text-red-600'}`}>{score}%</div>
          <div className="text-[11px] text-gray-500">have plot, value, phone &amp; project</div>
        </div>
      </div>

      {isLoading ? (
        <div className="py-16 text-center text-sm text-gray-400">Checking every booking…</div>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
            {ISSUES.map(i => {
              const n = counts[i.key]
              const on = active === i.key
              return (
                <button key={i.key} onClick={() => { setActive(i.key); setLimit(100) }}
                  className={`text-left rounded-xl border p-4 transition ${
                    on ? 'border-gray-900 bg-gray-900 text-white'
                       : n === 0 ? 'border-emerald-200 bg-emerald-50/40 hover:border-emerald-400'
                       : i.severity === 'high' ? 'border-red-200 bg-white hover:border-red-400'
                       : 'border-amber-200 bg-white hover:border-amber-400'}`}>
                  <div className={`text-[11px] font-semibold uppercase tracking-wide ${on ? 'text-gray-300' : n === 0 ? 'text-emerald-700' : i.severity === 'high' ? 'text-red-700' : 'text-amber-700'}`}>
                    {n === 0 ? '✓ ' : ''}{i.label}
                  </div>
                  <div className="text-2xl font-bold tabular-nums mt-1">{n}</div>
                  <div className={`text-[11px] ${on ? 'text-gray-400' : 'text-gray-500'}`}>
                    {rows.length ? Math.round((n / rows.length) * 100) : 0}% of {rows.length} bookings
                  </div>
                </button>
              )
            })}
          </div>

          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-sm font-semibold text-gray-900">{meta.label} · {list.length}</h2>
                <div className="flex items-center gap-2">
                  <div className="relative w-56">
                    <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"/>
                    <input value={q} onChange={e => setQ(e.target.value)} placeholder="Customer, booking, project…"
                      className="w-full pl-8 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"/>
                  </div>
                  <button onClick={exportCsv} disabled={list.length === 0}
                    className="inline-flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg bg-white border border-gray-200 text-gray-700 hover:border-gray-400 disabled:opacity-40">
                    <Download size={14}/>CSV
                  </button>
                </div>
              </div>
              <p className="text-[12px] text-gray-600 flex items-start gap-1.5">
                <AlertTriangle size={12} className="mt-0.5 shrink-0 text-amber-600"/>{meta.why}
              </p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>{['Booking', 'Customer', 'Project', 'Size', 'Value', 'Also missing', ''].map(h => (
                    <th key={h} className="px-4 py-2.5 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                  ))}</tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {list.length === 0 && (
                    <tr><td colSpan={7} className="px-4 py-12 text-center text-sm text-emerald-700">
                      {rows.some(r => r.issues.includes(active)) ? 'No one matches this search.' : 'Nothing left in this queue. ✓'}
                    </td></tr>
                  )}
                  {list.slice(0, limit).map(r => (
                    <tr key={r.id} className="hover:bg-gray-50/60">
                      <td className="px-4 py-2.5">
                        <div className="font-mono text-xs text-gray-800">{r.booking_no}</div>
                        {r.legacy_no && <div className="text-[11px] text-gray-400">old no. {r.legacy_no}</div>}
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="text-gray-900">{r.customer_name}</div>
                        <div className="text-[11px] text-gray-400">{r.phone || 'no phone'}</div>
                      </td>
                      <td className="px-4 py-2.5 text-xs text-gray-600">{r.project_name}</td>
                      <td className="px-4 py-2.5 text-xs tabular-nums">{r.size != null ? `${r.size} sq yd` : '—'}</td>
                      <td className="px-4 py-2.5 text-xs tabular-nums">{r.value > 0 ? formatINR(r.value) : <span className="text-red-600">₹0</span>}</td>
                      <td className="px-4 py-2.5">
                        <div className="flex flex-wrap gap-1">
                          {r.issues.filter(i => i !== active).map(i => (
                            <span key={i} className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-600 whitespace-nowrap">
                              {ISSUES.find(x => x.key === i)?.label}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="px-4 py-2.5">
                        <Link to={fixHref(r)}
                          className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1.5 rounded-lg bg-blue-600 text-white hover:bg-blue-700 whitespace-nowrap">
                          Fix<ArrowRight size={11}/>
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {list.length > limit && (
              <div className="px-4 py-3 border-t border-gray-100 text-center">
                <button onClick={() => setLimit(l => l + 100)} className="text-sm text-blue-700 hover:underline">
                  Show 100 more ({list.length - limit} left)
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
