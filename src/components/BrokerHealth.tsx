// Broker Health — the brokers that cannot yet be paid, logged in, or found by a booking.
//
// This is the screen the office opens straight after an import, and the reason it exists
// is the state the system was actually in on 13 Oct: two brokers on file, 99 bookings, and
// not one upline row anywhere. Nothing on any report said so. The office found out because
// a commission figure read zero.
//
// It lives beside Record Health rather than as its own page, and it links the money-critical
// fixes (which broker is on a booking, which plot) to the screens that already do them.
// What it DOES edit inline is the handful of plain facts that have no logic behind them -
// a bank account, an IFSC, a phone number. Those are the ones that block a payout, they are
// typed from a form in somebody's hand, and sending someone to a different screen for each
// one is how a hundred brokers stay unpayable for a month.
import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { fetchAllRows } from '@/lib/fetchAll'
import { downloadCsv } from '@/lib/download'
import { Secret, usePrivacy } from '@/lib/privacy'
import { Search, Download, Check, X, Pencil, AlertTriangle } from 'lucide-react'
import toast from 'react-hot-toast'
import { basisOf } from '@/lib/tradSplit'

type Issue = 'no_bank' | 'no_rate' | 'no_phone' | 'no_sponsor' | 'no_pan' | 'no_booking'

const ISSUES: { key: Issue; label: string; why: string; severity: 'high' | 'mid' }[] = [
  { key: 'no_bank', label: 'No bank details', severity: 'high',
    why: 'Withdrawals cannot pay these brokers at all. Account number AND IFSC are both needed — half of one is no use to the bank.' },
  { key: 'no_rate', label: 'No rate per gaj', severity: 'high',
    why: 'Traditional brokers only. Without the rate they are on, the booking form cannot work out their share of a sale — they are left out of the team commission and earn nothing. This is the number that used to be kept in Excel.' },
  { key: 'no_phone', label: 'No phone', severity: 'high',
    why: 'The phone is the broker login. Without it they can never open their own dashboard, and nobody can call them.' },
  { key: 'no_booking', label: 'No booking yet', severity: 'mid',
    why: 'Imported but no sale has been linked to them. Normal for a new joiner; suspicious for an old broker whose bookings should have come across.' },
  { key: 'no_sponsor', label: 'No upline', severity: 'mid',
    why: 'Nobody above them in the tree. Correct for the top of a tree — wrong for everyone else, and the differential cascade skips them.' },
  { key: 'no_pan', label: 'No PAN', severity: 'mid',
    why: 'TDS is deducted at a higher rate without a PAN, so the broker is paid less than they should be.' },
]

type Row = {
  id: string
  broker_id: string | null
  name: string
  phone: string | null
  pan_no: string | null
  bank_name: string | null
  account_no: string | null
  ifsc: string | null
  account_holder: string | null
  broker_type: string | null
  sponsor_id: string | null
  traditional_rate_per_sqyd: number | null
  traditional_rate_per_plot: number | null
  bookings: number
  issues: Issue[]
}

const BLANK_EDIT = { phone: '', pan_no: '', bank_name: '', account_no: '', ifsc: '', account_holder: '', traditional_rate_per_sqyd: '', traditional_rate_per_plot: '' }

export default function BrokerHealth() {
  const qc = useQueryClient()
  const { locked } = usePrivacy()
  const [active, setActive] = useState<Issue>('no_bank')
  const [q, setQ] = useState('')
  const [limit, setLimit] = useState(100)
  const [editId, setEditId] = useState<string | null>(null)
  const [edit, setEdit] = useState({ ...BLANK_EDIT })

  const { data: rows = [], isLoading } = useQuery<Row[]>({
    queryKey: ['broker_health'],
    refetchOnWindowFocus: true,
    queryFn: async () => {
      // traditional_rate_per_sqyd arrives with migration 20261014, which is run by hand
      // after this deploys. Asking for a column Postgres does not have fails the request,
      // so this screen falls back to the old list rather than going blank.
      const BASE = 'id, broker_id, name, phone, pan_no, bank_name, account_no, ifsc, account_holder, broker_type, sponsor_id, status'
      let rateCols = ', traditional_rate_per_sqyd, traditional_rate_per_plot'
      const probe = await supabase.from('brokers').select(`id${rateCols}`).limit(1)
      if (probe.error?.code === '42703') {
        // The per-plot column lands with a later migration than the per-gaj one, so fall
        // back one step at a time rather than losing both.
        const probe2 = await supabase.from('brokers').select('id, traditional_rate_per_sqyd').limit(1)
        rateCols = probe2.error?.code === '42703' ? '' : ', traditional_rate_per_sqyd'
      }

      const [brokers, bookings] = await Promise.all([
        fetchAllRows((from, to) => supabase.from('brokers')
          .select(BASE + rateCols)
          .order('id').range(from, to)),
        fetchAllRows((from, to) => supabase.from('bp_bookings')
          .select('broker_id').neq('stage', 'cancelled').order('id').range(from, to)),
      ])
      const sold = new Map<string, number>()
      for (const b of bookings as any[]) {
        if (b.broker_id) sold.set(b.broker_id, (sold.get(b.broker_id) || 0) + 1)
      }
      return (brokers as any[])
        .filter(b => b.status !== 'inactive')
        .map(b => {
          const issues: Issue[] = []
          // Both halves or nothing: a transfer with an account number and no IFSC fails at
          // the bank days later, which is worse than knowing now.
          if (!(b.account_no && b.ifsc)) issues.push('no_bank')
          // Only a traditional broker needs a rate. An Affiliate broker is paid from their
          // rank, so asking them for one would be noise on this screen.
          // Either basis counts. A broker on a flat per-plot amount is not missing a rate.
          if (rateCols && b.broker_type === 'traditional' && basisOf(b) == null) issues.push('no_rate')
          if (!b.phone) issues.push('no_phone')
          if (!b.sponsor_id) issues.push('no_sponsor')
          if (!b.pan_no) issues.push('no_pan')
          if (!sold.get(b.id)) issues.push('no_booking')
          return { ...b, bookings: sold.get(b.id) || 0, issues } as Row
        })
    },
  })

  // Did the rate column come back with the rows? Gates both the editor below and the
  // update, so the screen keeps working in the window before migration 20261014 is run.
  const hasRateColumn = rows.length === 0
    || Object.prototype.hasOwnProperty.call(rows[0] as any, 'traditional_rate_per_sqyd')

  const save = useMutation({
    mutationFn: async (row: Row) => {
      const digits = (s: string) => (s || '').replace(/\D/g, '')
      const account_no = digits(edit.account_no)
      const ifsc = edit.ifsc.toUpperCase().replace(/\s/g, '')
      // The same half-an-account check the import makes, so a row fixed here and a row
      // imported correctly end up in the same state.
      if ((account_no || ifsc) && !(account_no && ifsc)) {
        throw new Error('A bank transfer needs BOTH the account number and the IFSC.')
      }
      if (ifsc && !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc)) {
        throw new Error(`${ifsc} does not look like an IFSC code.`)
      }
      const phone = digits(edit.phone)
      if (phone && phone.length < 10) throw new Error('A phone number needs 10 digits.')

      const { error } = await supabase.from('brokers').update({
        phone: phone || null,
        pan_no: edit.pan_no.toUpperCase().trim() || null,
        bank_name: edit.bank_name.trim() || null,
        account_no: account_no || null,
        ifsc: ifsc || null,
        // A bank rejects a transfer with no holder name; the broker's own name is the
        // right default and is what the import uses too.
        account_holder: edit.account_holder.trim() || row.name || null,
        // Traditional brokers only, and only when the column exists. Blank clears it back
        // to "no rate agreed" rather than writing a zero somebody never decided on.
        // Only the basis this broker is actually on is editable here; switching a broker
        // between per-gaj and per-plot is a decision, and it belongs on the broker form
        // where the consequence is spelled out.
        ...(hasRateColumn && row.broker_type === 'traditional'
          ? (row.traditional_rate_per_plot != null
              ? { traditional_rate_per_plot: Number(edit.traditional_rate_per_plot) > 0 ? Number(edit.traditional_rate_per_plot) : null }
              : { traditional_rate_per_sqyd: Number(edit.traditional_rate_per_sqyd) > 0 ? Number(edit.traditional_rate_per_sqyd) : null })
          : {}),
      }).eq('id', row.id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['broker_health'] })
      qc.invalidateQueries({ queryKey: ['brokers'] })
      toast.success('Broker updated')
      setEditId(null)
    },
    onError: (e: any) => toast.error(e.message || 'Could not save.'),
  })

  const counts = useMemo(() => {
    const c: Record<Issue, number> = { no_bank: 0, no_rate: 0, no_phone: 0, no_sponsor: 0, no_pan: 0, no_booking: 0 }
    for (const r of rows) for (const i of r.issues) c[i]++
    return c
  }, [rows])

  const payable = rows.filter(r => r.account_no && r.ifsc).length
  const meta = ISSUES.find(i => i.key === active)!

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return rows
      .filter(r => r.issues.includes(active))
      .filter(r => !needle || `${r.name} ${r.broker_id || ''} ${r.phone || ''}`.toLowerCase().includes(needle))
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [rows, active, q])

  const startEdit = (r: Row) => {
    setEditId(r.id)
    setEdit({
      phone: r.phone || '', pan_no: r.pan_no || '', bank_name: r.bank_name || '',
      account_no: r.account_no || '', ifsc: r.ifsc || '', account_holder: r.account_holder || '',
      traditional_rate_per_sqyd: r.traditional_rate_per_sqyd != null ? String(r.traditional_rate_per_sqyd) : '',
      traditional_rate_per_plot: r.traditional_rate_per_plot != null ? String(r.traditional_rate_per_plot) : '',
    })
  }

  const exportCsv = () => {
    downloadCsv(`broker-health-${active}`, [
      ['Issue', 'Broker ID', 'Name', 'Phone', 'PAN', 'Bank', 'Account no', 'IFSC', 'Type', 'Rate per gaj', 'Per plot', 'Bookings'],
      ...list.map(r => [meta.label, r.broker_id || '', r.name, r.phone || '', r.pan_no || '',
        r.bank_name || '', r.account_no || '', r.ifsc || '', r.broker_type === 'mlm' ? 'Affiliate' : 'Traditional',
        r.traditional_rate_per_sqyd ?? '', r.traditional_rate_per_plot ?? '', r.bookings]),
    ])
  }

  if (isLoading) return <div className="py-16 text-center text-sm text-gray-400">Checking every broker…</div>

  return (
    <div className="space-y-5">
      {/* The one number that decides whether a payout run can happen at all. */}
      <div className={`rounded-xl border px-4 py-3 ${payable === rows.length ? 'border-emerald-200 bg-emerald-50/50' : 'border-amber-200 bg-amber-50/50'}`}>
        <div className="text-sm font-semibold text-gray-900">
          {payable} of {rows.length} broker{rows.length === 1 ? '' : 's'} can actually be paid
        </div>
        <div className="text-[12px] text-gray-600 mt-0.5">
          {payable === rows.length
            ? 'Every broker has an account number and an IFSC. A payout run will not stall.'
            : `${rows.length - payable} have no usable bank account. Withdrawals will hold their money until somebody fills it in — below, or on the broker's own page.`}
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        {ISSUES.map(i => {
          const n = counts[i.key]
          const on = active === i.key
          return (
            <button key={i.key} onClick={() => { setActive(i.key); setLimit(100); setEditId(null) }}
              className={`text-left rounded-xl border p-4 transition ${
                on ? 'border-gray-900 bg-gray-900 text-white'
                   : n === 0 ? 'border-emerald-200 bg-emerald-50/40 hover:border-emerald-400'
                   : i.severity === 'high' ? 'border-red-200 bg-white hover:border-red-400'
                   : 'border-amber-200 bg-white hover:border-amber-400'}`}>
              <div className={`text-[11px] font-semibold uppercase tracking-wide ${
                on ? 'text-gray-300' : n === 0 ? 'text-emerald-700' : i.severity === 'high' ? 'text-red-700' : 'text-amber-700'}`}>
                {n === 0 ? '✓ ' : ''}{i.label}
              </div>
              <div className="text-2xl font-bold tabular-nums mt-1">{n}</div>
              <div className={`text-[11px] ${on ? 'text-gray-400' : 'text-gray-500'}`}>
                {rows.length ? Math.round((n / rows.length) * 100) : 0}% of {rows.length} brokers
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
                <input value={q} onChange={e => setQ(e.target.value)} placeholder="Name, code, phone…"
                  className="w-full pl-8 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"/>
              </div>
              <button onClick={exportCsv} disabled={list.length === 0}
                className="inline-flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg bg-white border border-gray-200 text-gray-700 hover:border-gray-400 disabled:opacity-40">
                <Download size={14}/>CSV
              </button>
            </div>
          </div>
          <p className="text-[12px] text-gray-600 flex items-start gap-1.5">
            <AlertTriangle size={13} className="mt-0.5 shrink-0 text-amber-500"/>{meta.why}
          </p>
        </div>

        {list.length === 0 ? (
          <div className="py-14 text-center text-sm text-emerald-700">Nothing to fix here.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-[11px] uppercase tracking-wide text-gray-500">
                <tr>
                  {['Broker', 'Phone', 'PAN', 'Bank', 'Account no', 'IFSC',
                    ...(hasRateColumn ? ['Paid on'] : []), 'Sales', ''].map(h => (
                    <th key={h} className="text-left px-4 py-2 font-semibold whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {list.slice(0, limit).map(r => {
                  const editing = editId === r.id
                  const cell = 'w-full border border-gray-300 rounded px-2 py-1 text-xs'
                  return (
                    <tr key={r.id} className={editing ? 'bg-blue-50/40' : ''}>
                      <td className="px-4 py-2.5">
                        <div className="font-medium text-gray-900">{r.name}</div>
                        <div className="text-[11px] font-mono text-gray-400">
                          {r.broker_id || '—'} · {r.broker_type === 'mlm' ? 'Affiliate' : 'Traditional'}
                        </div>
                      </td>
                      <td className="px-4 py-2.5">
                        {editing
                          ? <input className={cell} value={edit.phone} onChange={e => setEdit(p => ({ ...p, phone: e.target.value }))} placeholder="10 digits"/>
                          : <Secret>{r.phone || '—'}</Secret>}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-xs">
                        {editing
                          ? <input className={cell} value={edit.pan_no} onChange={e => setEdit(p => ({ ...p, pan_no: e.target.value }))}/>
                          : (r.pan_no || <span className="text-gray-300">—</span>)}
                      </td>
                      <td className="px-4 py-2.5">
                        {editing
                          ? <input className={cell} value={edit.bank_name} onChange={e => setEdit(p => ({ ...p, bank_name: e.target.value }))} placeholder="e.g. HDFC Bank"/>
                          : (r.bank_name || <span className="text-gray-300">—</span>)}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-xs">
                        {editing
                          ? <input className={cell} value={edit.account_no} onChange={e => setEdit(p => ({ ...p, account_no: e.target.value }))}/>
                          : <Secret>{r.account_no || '—'}</Secret>}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-xs">
                        {editing
                          ? <input className={cell} value={edit.ifsc} onChange={e => setEdit(p => ({ ...p, ifsc: e.target.value }))} placeholder="HDFC0000123"/>
                          : (r.ifsc || <span className="text-gray-300">—</span>)}
                      </td>
                      {/* The rate only means something on a traditional broker — an
                          Affiliate one is paid from their rank, so there is nothing to type. */}
                      {hasRateColumn && (
                        <td className="px-4 py-2.5 font-mono text-xs">
                          {r.broker_type !== 'traditional'
                            ? <span className="text-gray-300" title="Affiliate brokers are paid from their rank">n/a</span>
                            : editing
                              ? (r.traditional_rate_per_plot != null
                                  ? <input className={cell} type="number" value={edit.traditional_rate_per_plot}
                                      onChange={e => setEdit(p => ({ ...p, traditional_rate_per_plot: e.target.value }))}
                                      placeholder="₹ per plot"/>
                                  : <input className={cell} type="number" value={edit.traditional_rate_per_sqyd}
                                      onChange={e => setEdit(p => ({ ...p, traditional_rate_per_sqyd: e.target.value }))}
                                      placeholder="₹ per gaj"/>)
                              : (() => {
                                  const x = basisOf(r as any)
                                  return x
                                    ? <Secret>{`₹${x.rate}/${x.basis === 'per_plot' ? 'plot' : 'gaj'}`}</Secret>
                                    : <span className="text-gray-300">—</span>
                                })()}
                        </td>
                      )}
                      <td className="px-4 py-2.5 tabular-nums text-gray-600">{r.bookings}</td>
                      <td className="px-4 py-2.5 text-right whitespace-nowrap">
                        {editing ? (
                          <div className="inline-flex gap-1">
                            <button onClick={() => save.mutate(r)} disabled={save.isPending}
                              className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50">
                              <Check size={12}/>Save
                            </button>
                            <button onClick={() => setEditId(null)}
                              className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md border border-gray-200 text-gray-600 hover:bg-gray-50">
                              <X size={12}/>
                            </button>
                          </div>
                        ) : locked ? (
                          // Editing means typing a phone and an account number into plain
                          // boxes, which is exactly what the lock is hiding. Ask for the PIN
                          // rather than quietly opening a window onto it.
                          <span className="text-[11px] text-gray-400">Enter the PIN to edit</span>
                        ) : (
                          <button onClick={() => startEdit(r)}
                            className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md border border-gray-200 text-blue-700 hover:bg-blue-50">
                            <Pencil size={12}/>Fix here
                          </button>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
            {list.length > limit && (
              <div className="px-4 py-3 border-t border-gray-100 text-center">
                <button onClick={() => setLimit(l => l + 200)} className="text-sm text-blue-700 hover:underline">
                  Show more ({list.length - limit} left)
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
