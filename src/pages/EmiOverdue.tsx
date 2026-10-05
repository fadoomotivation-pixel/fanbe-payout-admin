// EMI overdue — the list behind the Analytics tile.
//
// Analytics has shown "EMI Overdue (today)" with a figure on it for a long time, but the
// tile led to the Customer Pipeline's EMI tab, which lists every booking that HAS an EMI
// plan — not the ones that are late.  So the number was visible and the names were not,
// which makes the number useless: you cannot ring a total.
//
// This is the call list.  Worst first, with the phone number and a WhatsApp message
// already written, because the only thing anybody does with this screen is chase people.
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { formatINR, formatDate } from '@/lib/utils'
import { fetchOverdueEmi, type OverdueEmiRow } from '@/lib/emiStatus'
import { waLink } from '@/lib/whatsapp'
import { AlertTriangle, Phone, MessageCircle, Search, Download, Clock } from 'lucide-react'
import { downloadCsv } from '@/lib/download'

type Band = 'all' | '0_30' | '31_90' | '90_plus'

const BANDS: { key: Band; label: string; hint: string }[] = [
  { key: 'all',     label: 'All overdue', hint: 'every booking with a missed instalment' },
  { key: '0_30',    label: '1–30 days',   hint: 'just slipped — a reminder usually fixes it' },
  { key: '31_90',   label: '31–90 days',  hint: 'needs a call, not a message' },
  { key: '90_plus', label: '90+ days',    hint: 'past the lapsation window — receipts are held back' },
]

function bandOf(days: number): Band {
  if (days > 90) return '90_plus'
  if (days > 30) return '31_90'
  return '0_30'
}

export default function EmiOverdue() {
  const [band, setBand] = useState<Band>('all')
  const [q, setQ] = useState('')
  const [mode, setMode] = useState<'' | 'mlm' | 'traditional'>('')

  const { data: rows = [], isLoading } = useQuery<OverdueEmiRow[]>({
    queryKey: ['emi_overdue'],
    queryFn: fetchOverdueEmi,
  })

  const counts = useMemo(() => {
    const c: Record<Band, { n: number; amt: number }> = {
      all: { n: 0, amt: 0 }, '0_30': { n: 0, amt: 0 }, '31_90': { n: 0, amt: 0 }, '90_plus': { n: 0, amt: 0 },
    }
    for (const r of rows) {
      c.all.n++; c.all.amt += r.amount_overdue
      const b = bandOf(r.days_late)
      c[b].n++; c[b].amt += r.amount_overdue
    }
    return c
  }, [rows])

  const filtered = useMemo(() => {
    let list = band === 'all' ? rows : rows.filter(r => bandOf(r.days_late) === band)
    if (mode) list = list.filter(r => mode === 'traditional' ? r.commission_mode === 'traditional' : r.commission_mode !== 'traditional')
    const needle = q.trim().toLowerCase()
    if (needle) {
      list = list.filter(r =>
        `${r.customer_name} ${r.customer_code} ${r.booking_no} ${r.plot_no} ${r.project_name} ${r.broker_name} ${r.broker_code} ${r.phone || ''}`
          .toLowerCase().includes(needle))
    }
    return list
  }, [rows, band, mode, q])

  const exportCsv = () => {
    const header = ['Customer', 'Code', 'Phone', 'Booking', 'Plot', 'Project', 'Agent', 'Agent code', 'Sale type', 'Instalments late', 'Amount overdue', 'Oldest due', 'Days late']
    const body = filtered.map(r => [
      r.customer_name, r.customer_code, r.phone || '', r.booking_no, r.plot_no, r.project_name,
      r.broker_name, r.broker_code, r.commission_mode === 'traditional' ? 'Traditional' : 'MLM',
      r.instalments_overdue, r.amount_overdue, r.oldest_due, r.days_late,
    ])
    downloadCsv(`emi-overdue-${new Date().toISOString().slice(0, 10)}.csv`, [header, ...body])
  }

  const chaseMessage = (r: OverdueEmiRow) =>
    `Namaste ${r.customer_name}, aapki ${r.instalments_overdue} EMI kist baaki hai — kul ${formatINR(r.amount_overdue)}, ` +
    `sabse purani ${formatDate(r.oldest_due)} ki. Plot ${r.plot_no}, ${r.project_name}. ` +
    `Kripya jald jama kar dein. — Fanbe Developers`

  return (
    <div className="p-4 md:p-8 space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            <AlertTriangle size={18} className="text-red-600"/>EMI overdue
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Who has missed an instalment, worst first. {formatINR(counts.all.amt)} across {counts.all.n} booking{counts.all.n === 1 ? '' : 's'}.
          </p>
        </div>
        <button onClick={exportCsv} disabled={filtered.length === 0}
          className="inline-flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg bg-white border border-gray-200 text-gray-700 hover:border-gray-400 disabled:opacity-40">
          <Download size={14}/>Export ({filtered.length})
        </button>
      </div>

      {/* How late.  A customer 10 days behind and one 10 months behind need completely
          different handling, and lumping them together is why nobody worked the list. */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {BANDS.map(b => {
          const c = counts[b.key]
          const on = band === b.key
          const tone = b.key === '90_plus' ? 'red' : b.key === '31_90' ? 'amber' : b.key === '0_30' ? 'yellow' : 'gray'
          const cls = on
            ? tone === 'red' ? 'bg-red-600 text-white border-red-600'
              : tone === 'amber' ? 'bg-amber-600 text-white border-amber-600'
              : tone === 'yellow' ? 'bg-yellow-500 text-white border-yellow-500'
              : 'bg-gray-900 text-white border-gray-900'
            : 'bg-white border-gray-200 text-gray-800 hover:border-gray-400'
          return (
            <button key={b.key} onClick={() => setBand(b.key)} title={b.hint}
              className={`text-left border rounded-xl p-4 transition ${cls}`}>
              <div className="text-[11px] font-semibold uppercase tracking-wide opacity-80">{b.label}</div>
              <div className="text-xl font-bold mt-1 tabular-nums">{formatINR(c.amt)}</div>
              <div className="text-[11px] opacity-70">{c.n} booking{c.n === 1 ? '' : 's'}</div>
            </button>
          )
        })}
      </div>

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 flex flex-wrap gap-3 items-center justify-between">
          <div className="inline-flex rounded-lg border border-gray-200 overflow-hidden text-xs">
            <button onClick={() => setMode('')}
              className={`px-3 py-2 ${mode === '' ? 'bg-gray-900 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'}`}>All sales</button>
            <button onClick={() => setMode('mlm')}
              className={`px-3 py-2 border-l border-gray-200 ${mode === 'mlm' ? 'bg-blue-600 text-white' : 'bg-white text-blue-700 hover:bg-blue-50'}`}>MLM</button>
            <button onClick={() => setMode('traditional')}
              className={`px-3 py-2 border-l border-gray-200 ${mode === 'traditional' ? 'bg-amber-600 text-white' : 'bg-white text-amber-700 hover:bg-amber-50'}`}>Traditional</button>
          </div>
          <div className="relative w-full sm:w-72">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"/>
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search customer, plot, agent…"
              className="w-full pl-8 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"/>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50">
              <tr>{['Customer', 'Booking / Plot', 'Project', 'Agent', 'Late by', 'Instalments', 'Amount overdue', ''].map(h => (
                <th key={h} className="px-4 py-2.5 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
              ))}</tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {isLoading && <tr><td colSpan={8} className="px-4 py-12 text-center text-sm text-gray-400">Loading…</td></tr>}
              {!isLoading && filtered.length === 0 && (
                <tr><td colSpan={8} className="px-4 py-12 text-center text-sm text-gray-400">
                  {rows.length === 0 ? 'Nobody is behind on an EMI. Nothing to chase today.' : 'No one matches this filter.'}
                </td></tr>
              )}
              {filtered.map(r => (
                <tr key={r.booking_id} className="hover:bg-gray-50/60">
                  <td className="px-4 py-2.5">
                    <div className="font-medium text-gray-900 truncate">{r.customer_name}</div>
                    <div className="text-[11px] text-gray-400 font-mono">{r.customer_code}</div>
                  </td>
                  <td className="px-4 py-2.5">
                    <div className="font-mono text-xs text-gray-700">{r.booking_no}</div>
                    <div className="text-[11px] text-gray-400">Plot {r.plot_no}</div>
                  </td>
                  <td className="px-4 py-2.5 text-xs text-gray-600">{r.project_name}</td>
                  <td className="px-4 py-2.5">
                    <div className="text-xs text-gray-700 truncate">{r.broker_name}</div>
                    {r.broker_code && <div className="text-[11px] text-gray-400 font-mono">{r.broker_code}</div>}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={`inline-flex items-center gap-1 text-xs font-semibold ${
                      r.days_late > 90 ? 'text-red-700' : r.days_late > 30 ? 'text-amber-700' : 'text-yellow-700'}`}>
                      <Clock size={11}/>{r.days_late} days
                    </span>
                    <div className="text-[11px] text-gray-400">since {formatDate(r.oldest_due)}</div>
                  </td>
                  <td className="px-4 py-2.5 tabular-nums">{r.instalments_overdue}</td>
                  <td className="px-4 py-2.5 tabular-nums font-semibold text-red-700">{formatINR(r.amount_overdue)}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-1.5">
                      {r.phone && (
                        <>
                          <a href={`tel:${r.phone}`} title={`Call ${r.phone}`}
                            className="p-1.5 rounded-md text-gray-400 hover:text-blue-700 hover:bg-blue-50"><Phone size={13}/></a>
                          <a href={waLink(r.phone, chaseMessage(r))} target="_blank" rel="noreferrer" title="WhatsApp reminder"
                            className="p-1.5 rounded-md text-gray-400 hover:text-emerald-700 hover:bg-emerald-50"><MessageCircle size={13}/></a>
                        </>
                      )}
                      <Link to={`/customer-pipeline?customer=${r.customer_id || ''}`}
                        className="text-xs text-blue-700 hover:underline whitespace-nowrap">Open</Link>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
