// Expenses — spend register with the analysis admin actually needs on the page.
//
// The old screen was a stacked form, a head list and an untouchable table: no dates,
// no editing, no filters, no sense of "are we spending more than last month".  This
// version keeps the same data model and adds the things that make it usable day to
// day — period filters, a head breakdown, edit/delete, backdating, and an advances
// panel, since Advance-head spend is the one that quietly reduces broker payouts.
import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { Modal } from '@/components/ui/Modal.tsx'
import { Button } from '@/components/ui/Button.tsx'
import { Input, Select, Textarea } from '@/components/ui/Input.tsx'
import { formatINR, formatDate } from '@/lib/utils'
import {
  Plus, Search, Download, X, Pencil, Trash2, Tag, Wallet,
  TrendingUp, TrendingDown, AlertTriangle, Users,
} from 'lucide-react'
import toast from 'react-hot-toast'

type Head = { id: string; name: string; active?: boolean }
type Broker = { id: string; name: string | null; broker_id: string | null }
type Row = {
  id: string; item_name: string; amount: number; head_id: string | null
  expense_date: string; description: string | null
  responsible_person: string | null; broker_id: string | null
}

// Heads that are about money owed to / taken by a specific broker.  Picking one makes
// the form ask WHICH broker, so the spend can be attributed — and for Advance, later
// debited from that broker's withdrawable balance (see payoutEngine.loadBrokerWallets).
const BROKER_HEADS = ['advance', 'payout', 'discount']

const today = () => new Date().toISOString().slice(0, 10)
const monthStart = (d = new Date()) => new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10)
const monthsAgo = (n: number) => { const d = new Date(); d.setMonth(d.getMonth() - n); return d }

type Period = 'this_month' | 'last_month' | 'last_3' | 'year' | 'all' | 'custom'
const PERIODS: { value: Period; label: string }[] = [
  { value: 'this_month', label: 'This month' },
  { value: 'last_month', label: 'Last month' },
  { value: 'last_3',     label: 'Last 3 months' },
  { value: 'year',       label: 'This year' },
  { value: 'all',        label: 'All time' },
  { value: 'custom',     label: 'Custom range' },
]

function rangeFor(p: Period, from: string, to: string): { from: string; to: string } {
  const now = new Date()
  switch (p) {
    case 'this_month': return { from: monthStart(), to: today() }
    case 'last_month': {
      const s = new Date(now.getFullYear(), now.getMonth() - 1, 1)
      const e = new Date(now.getFullYear(), now.getMonth(), 0)
      return { from: s.toISOString().slice(0, 10), to: e.toISOString().slice(0, 10) }
    }
    case 'last_3': return { from: monthStart(monthsAgo(2)), to: today() }
    case 'year':   return { from: `${now.getFullYear()}-01-01`, to: today() }
    case 'all':    return { from: '1900-01-01', to: '2999-12-31' }
    case 'custom': return { from: from || '1900-01-01', to: to || '2999-12-31' }
  }
}

const EMPTY_FORM = {
  id: '', item_name: '', amount: '', head_id: '', description: '',
  responsible_person: '', broker_id: '', expense_date: today(),
}

export default function Expenses() {
  const qc = useQueryClient()
  const [modal, setModal] = useState(false)
  const [headsModal, setHeadsModal] = useState(false)
  const [form, setForm] = useState<any>({ ...EMPTY_FORM })
  const [newHead, setNewHead] = useState('')
  const [period, setPeriod] = useState<Period>('this_month')
  const [customFrom, setCustomFrom] = useState('')
  const [customTo, setCustomTo] = useState('')
  const [filterHead, setFilterHead] = useState('')
  const [filterBroker, setFilterBroker] = useState('')
  const [search, setSearch] = useState('')
  const [deleteFor, setDeleteFor] = useState<Row | null>(null)
  const set = (k: string, v: any) => setForm((p: any) => ({ ...p, [k]: v }))

  const { data: heads = [] } = useQuery<Head[]>({
    queryKey: ['expense_heads'],
    queryFn: async () => {
      const { data, error } = await supabase.from('expense_heads').select('id,name,active').order('name')
      if (error) throw error
      return (data || []) as Head[]
    },
  })

  const { data: brokers = [] } = useQuery<Broker[]>({
    queryKey: ['brokers_for_expenses'],
    queryFn: async () => {
      const { data, error } = await supabase.from('brokers').select('id,name,broker_id').order('name')
      if (error) throw error
      return (data || []) as Broker[]
    },
  })

  // Every expense is pulled once and filtered in the browser: the table is small, and
  // it keeps the period tiles instant instead of a round trip per switch.
  const { data: all = [], isLoading } = useQuery<Row[]>({
    queryKey: ['expenses_all'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('expenses')
        .select('id,item_name,amount,head_id,expense_date,description,responsible_person,broker_id')
        .order('expense_date', { ascending: false })
        .limit(2000)
      if (error) throw error
      return (data || []) as Row[]
    },
  })

  const headById   = useMemo(() => Object.fromEntries(heads.map(h => [h.id, h.name])), [heads])
  const brokerById = useMemo(() => Object.fromEntries(brokers.map(b => [b.id, b])), [brokers])
  const headNameOf = (id: string | null) => (id ? headById[id] || '—' : '—')
  const brokerLabel = (id: string | null) => {
    if (!id) return null
    const b = brokerById[id]
    return b ? `${b.name || '—'}${b.broker_id ? ` [${b.broker_id}]` : ''}` : '—'
  }

  const selectedHeadName = (headById[form.head_id] || '').toLowerCase()
  const headWantsBroker  = BROKER_HEADS.includes(selectedHeadName)

  const range = rangeFor(period, customFrom, customTo)
  const inRange = (r: Row) => r.expense_date >= range.from && r.expense_date <= range.to

  const rows = all.filter(r => {
    if (!inRange(r)) return false
    if (filterHead && r.head_id !== filterHead) return false
    if (filterBroker && r.broker_id !== filterBroker) return false
    if (search.trim()) {
      const q = search.toLowerCase()
      const hay = [r.item_name, r.description, r.responsible_person, headNameOf(r.head_id), brokerLabel(r.broker_id)]
      if (!hay.some(v => (v || '').toString().toLowerCase().includes(q))) return false
    }
    return true
  })

  const sum = (list: Row[]) => list.reduce((s, r) => s + Number(r.amount || 0), 0)
  const total = sum(rows)

  // Same window, one period back — gives the "up or down on last time" read that makes
  // a spend number mean something.
  const prevTotal = useMemo(() => {
    if (period === 'all' || period === 'custom') return null
    const now = new Date()
    let f: string, t: string
    if (period === 'this_month') {
      f = new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().slice(0, 10)
      t = new Date(now.getFullYear(), now.getMonth(), 0).toISOString().slice(0, 10)
    } else if (period === 'last_month') {
      f = new Date(now.getFullYear(), now.getMonth() - 2, 1).toISOString().slice(0, 10)
      t = new Date(now.getFullYear(), now.getMonth() - 1, 0).toISOString().slice(0, 10)
    } else if (period === 'last_3') {
      f = monthStart(monthsAgo(5)); t = new Date(now.getFullYear(), now.getMonth() - 2, 0).toISOString().slice(0, 10)
    } else {
      f = `${now.getFullYear() - 1}-01-01`; t = `${now.getFullYear() - 1}-12-31`
    }
    return sum(all.filter(r => r.expense_date >= f && r.expense_date <= t))
  }, [all, period])

  const delta = prevTotal != null && prevTotal > 0 ? Math.round(((total - prevTotal) / prevTotal) * 100) : null

  // Spend per head for the selected window, biggest first.
  const byHead = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of rows) {
      const k = headNameOf(r.head_id)
      m.set(k, (m.get(k) || 0) + Number(r.amount || 0))
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  }, [rows, headById])

  // Advances are the spend that quietly reduces what a broker can withdraw, so they get
  // their own panel rather than being buried in the table.
  const advanceHeadIds = heads.filter(h => (h.name || '').toLowerCase() === 'advance').map(h => h.id)
  const advancesByBroker = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of all) {
      if (!r.broker_id || !r.head_id || !advanceHeadIds.includes(r.head_id)) continue
      m.set(r.broker_id, (m.get(r.broker_id) || 0) + Number(r.amount || 0))
    }
    return [...m.entries()].sort((a, b) => b[1] - a[1])
  }, [all, heads])
  const advanceTotal = advancesByBroker.reduce((s, [, v]) => s + v, 0)

  const openAdd = () => { setForm({ ...EMPTY_FORM }); setModal(true) }
  const openEdit = (r: Row) => {
    setForm({
      id: r.id, item_name: r.item_name, amount: String(r.amount ?? ''), head_id: r.head_id || '',
      description: r.description || '', responsible_person: r.responsible_person || '',
      broker_id: r.broker_id || '', expense_date: r.expense_date || today(),
    })
    setModal(true)
  }

  const refresh = () => qc.invalidateQueries({ queryKey: ['expenses_all'] })

  const save = async () => {
    if (!form.item_name.trim()) return toast.error('What was the spend on? Enter an item name.')
    if (!(Number(form.amount) > 0)) return toast.error('Enter an amount greater than zero.')
    if (headWantsBroker && !form.broker_id) return toast.error(`Pick the broker this ${selectedHeadName} is for.`)

    const payload = {
      item_name: form.item_name.trim(),
      amount: Number(form.amount),
      head_id: form.head_id || null,
      description: form.description.trim() || null,
      responsible_person: form.responsible_person.trim() || null,
      // A broker is only attached on the heads that are about a broker; switching the
      // head away from those clears it so a stale link can't linger on the row.
      broker_id: headWantsBroker ? form.broker_id : null,
      expense_date: form.expense_date || today(),
    }
    const { error } = form.id
      ? await supabase.from('expenses').update(payload).eq('id', form.id)
      : await supabase.from('expenses').insert(payload)
    if (error) return toast.error(error.message)
    toast.success(form.id ? 'Expense updated' : 'Expense added')
    setModal(false)
    refresh()
  }

  const remove = async () => {
    if (!deleteFor) return
    const { error } = await supabase.from('expenses').delete().eq('id', deleteFor.id)
    if (error) return toast.error(error.message)
    toast.success('Expense deleted')
    setDeleteFor(null)
    refresh()
  }

  const addHead = async () => {
    if (!newHead.trim()) return
    const { error } = await supabase.from('expense_heads').insert({ name: newHead.trim() })
    if (error) return toast.error(error.message)
    setNewHead('')
    qc.invalidateQueries({ queryKey: ['expense_heads'] })
  }

  const exportCsv = () => {
    const headers = ['Date', 'Head', 'Item', 'Amount', 'Broker', 'Responsible', 'Description']
    const body = rows.map(r => [
      r.expense_date, headNameOf(r.head_id), r.item_name, r.amount,
      brokerLabel(r.broker_id) || '', r.responsible_person || '', r.description || '',
    ])
    const csv = [headers, ...body].map(l => l.map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }))
    const a = document.createElement('a')
    a.href = url; a.download = `expenses-${range.from}-to-${range.to}.csv`; a.click()
    URL.revokeObjectURL(url)
  }

  const filtersOn = !!(filterHead || filterBroker || search)

  return (
    <div className="p-4 md:p-8 space-y-5 max-w-6xl mx-auto">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Expenses</h1>
          <p className="text-sm text-gray-500 mt-0.5">Office spend, broker advances and payouts — with what it adds up to.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setHeadsModal(true)}><Tag size={14}/>Heads</Button>
          <Button variant="secondary" onClick={exportCsv}><Download size={14}/>Export</Button>
          <Button onClick={openAdd}><Plus size={14}/>Add expense</Button>
        </div>
      </div>

      {/* Period chips — the whole page follows this one control. */}
      <div className="flex flex-wrap gap-1.5">
        {PERIODS.map(p => (
          <button key={p.value} onClick={() => setPeriod(p.value)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium border transition ${
              period === p.value ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'}`}>
            {p.label}
          </button>
        ))}
        {period === 'custom' && (
          <div className="flex gap-1.5 items-center ml-1">
            <input type="date" value={customFrom} onChange={e => setCustomFrom(e.target.value)} className="border border-gray-200 rounded-lg px-2 py-1 text-xs"/>
            <span className="text-xs text-gray-400">to</span>
            <input type="date" value={customTo} onChange={e => setCustomTo(e.target.value)} className="border border-gray-200 rounded-lg px-2 py-1 text-xs"/>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Spend this period</div>
          <div className="text-2xl font-bold text-gray-900 mt-1">{formatINR(total)}</div>
          {delta != null && (
            <div className={`text-[11px] mt-0.5 inline-flex items-center gap-1 ${delta > 0 ? 'text-red-600' : 'text-emerald-600'}`}>
              {delta > 0 ? <TrendingUp size={12}/> : <TrendingDown size={12}/>}
              {Math.abs(delta)}% vs previous · {formatINR(prevTotal || 0)}
            </div>
          )}
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Entries</div>
          <div className="text-2xl font-bold text-gray-900 mt-1">{rows.length}</div>
          <div className="text-[11px] text-gray-400 mt-0.5">avg {formatINR(rows.length ? Math.round(total / rows.length) : 0)}</div>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Biggest head</div>
          <div className="text-lg font-bold text-gray-900 mt-1 truncate">{byHead[0]?.[0] || '—'}</div>
          <div className="text-[11px] text-gray-400 mt-0.5">{byHead[0] ? formatINR(byHead[0][1]) : 'nothing yet'}</div>
        </div>
        <div className="bg-white border border-amber-200 bg-amber-50/40 rounded-xl p-4">
          <div className="text-[11px] font-semibold text-amber-800 uppercase tracking-wide">Advances outstanding</div>
          <div className="text-2xl font-bold text-amber-900 mt-1">{formatINR(advanceTotal)}</div>
          <div className="text-[11px] text-amber-700 mt-0.5">{advancesByBroker.length} broker{advancesByBroker.length === 1 ? '' : 's'} · all time</div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Where the money went — proportional bars beat a pie for reading exact splits. */}
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <h2 className="text-sm font-semibold text-gray-900 mb-3">Where it went</h2>
          {byHead.length === 0 ? (
            <p className="text-xs text-gray-400">Nothing recorded in this period.</p>
          ) : (
            <div className="space-y-2">
              {byHead.slice(0, 7).map(([name, amt]) => (
                <div key={name}>
                  <div className="flex justify-between text-xs mb-0.5">
                    <span className="text-gray-700 truncate">{name}</span>
                    <span className="font-semibold text-gray-900 tabular-nums shrink-0 ml-2">{formatINR(amt)}</span>
                  </div>
                  <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full bg-blue-500 rounded-full" style={{ width: `${total > 0 ? Math.max(2, (amt / total) * 100) : 0}%` }}/>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Advances get their own panel: this money is already out of the door AND it
            reduces what each broker can withdraw, so it needs to be visible by name. */}
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <h2 className="text-sm font-semibold text-gray-900 mb-1 flex items-center gap-1.5"><Wallet size={14} className="text-amber-600"/>Broker advances</h2>
          <p className="text-[11px] text-gray-500 mb-3">Deducted from what each broker can withdraw until recovered.</p>
          {advancesByBroker.length === 0 ? (
            <p className="text-xs text-gray-400">No advances given.</p>
          ) : (
            <ul className="space-y-1.5 max-h-48 overflow-y-auto">
              {advancesByBroker.map(([bid, amt]) => (
                <li key={bid} className="flex justify-between text-xs">
                  <span className="text-gray-700 truncate">{brokerLabel(bid)}</span>
                  <span className="font-semibold text-amber-800 tabular-nums shrink-0 ml-2">{formatINR(amt)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <h2 className="text-sm font-semibold text-gray-900 mb-3 flex items-center gap-1.5"><Users size={14} className="text-gray-500"/>Who spent it</h2>
          {(() => {
            const m = new Map<string, number>()
            for (const r of rows) m.set(r.responsible_person || 'Not recorded', (m.get(r.responsible_person || 'Not recorded') || 0) + Number(r.amount || 0))
            const list = [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, 7)
            if (list.length === 0) return <p className="text-xs text-gray-400">Nothing recorded in this period.</p>
            return (
              <ul className="space-y-1.5">
                {list.map(([who, amt]) => (
                  <li key={who} className="flex justify-between text-xs">
                    <span className={`truncate ${who === 'Not recorded' ? 'text-gray-400 italic' : 'text-gray-700'}`}>{who}</span>
                    <span className="font-semibold text-gray-900 tabular-nums shrink-0 ml-2">{formatINR(amt)}</span>
                  </li>
                ))}
              </ul>
            )
          })()}
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="p-3 border-b border-gray-100 flex flex-wrap gap-2 items-center">
          <div className="relative flex-1 min-w-[180px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"/>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search item, person or description"
              className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"/>
          </div>
          <select value={filterHead} onChange={e => setFilterHead(e.target.value)} className="px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white">
            <option value="">All heads</option>
            {heads.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
          </select>
          <select value={filterBroker} onChange={e => setFilterBroker(e.target.value)} className="px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white">
            <option value="">All brokers</option>
            {brokers.map(b => <option key={b.id} value={b.id}>{b.name || '—'}{b.broker_id ? ` [${b.broker_id}]` : ''}</option>)}
          </select>
          {filtersOn && (
            <button onClick={() => { setSearch(''); setFilterHead(''); setFilterBroker('') }}
              className="text-xs text-gray-500 hover:text-gray-800 px-2 py-1 inline-flex items-center gap-1"><X size={12}/>Clear</button>
          )}
          <span className="text-sm text-gray-500 ml-auto">Total <b className="text-gray-900">{formatINR(total)}</b></span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-y border-gray-100">
              <tr>
                {['Date', 'Head', 'Item', 'Amount', 'Broker', 'Responsible', ''].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {isLoading ? (
                <tr><td colSpan={7} className="py-12 text-center text-gray-400">Loading…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={7} className="py-12 text-center text-gray-400">No expenses in this period.</td></tr>
              ) : rows.map(r => {
                const headName = headNameOf(r.head_id)
                const isAdvance = headName.toLowerCase() === 'advance'
                return (
                  <tr key={r.id} className="hover:bg-blue-50/30">
                    <td className="px-4 py-3 text-gray-500 whitespace-nowrap">{formatDate(r.expense_date)}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ${
                        isAdvance ? 'bg-amber-100 text-amber-800' : 'bg-gray-100 text-gray-700'}`}>{headName}</span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="text-gray-900">{r.item_name}</div>
                      {r.description && <div className="text-xs text-gray-400 truncate max-w-[220px]" title={r.description}>{r.description}</div>}
                    </td>
                    <td className="px-4 py-3 font-semibold text-gray-900 tabular-nums whitespace-nowrap">{formatINR(r.amount)}</td>
                    <td className="px-4 py-3 text-gray-600 text-xs">{brokerLabel(r.broker_id) || '—'}</td>
                    <td className="px-4 py-3 text-gray-600 text-xs">{r.responsible_person || <span className="text-gray-300">—</span>}</td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <button onClick={() => openEdit(r)} className="p-1.5 rounded-md text-gray-400 hover:text-blue-700 hover:bg-blue-50" title="Edit"><Pencil size={13}/></button>
                      <button onClick={() => setDeleteFor(r)} className="p-1.5 rounded-md text-gray-400 hover:text-red-700 hover:bg-red-50" title="Delete"><Trash2 size={13}/></button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Add / edit ─────────────────────────────────────────────────────── */}
      <Modal open={modal} onClose={() => setModal(false)} title={form.id ? 'Edit expense' : 'Add expense'}>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <Input label="What was it for?" value={form.item_name} onChange={(e: any) => set('item_name', e.target.value)} placeholder="e.g. Office rent, site boarding" />
            <Input label="Amount (₹)" type="number" value={form.amount} onChange={(e: any) => set('amount', e.target.value)} placeholder="e.g. 25000" />
            <Select label="Expense head" value={form.head_id} onChange={(e: any) => setForm((p: any) => ({ ...p, head_id: e.target.value, broker_id: '' }))}>
              <option value="">— Pick a head —</option>
              {heads.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
            </Select>
            {/* Backdating matters: expenses get entered days after they happen, and the
                period tiles are only honest if the date is the real one. */}
            <Input label="Date of the spend" type="date" value={form.expense_date} onChange={(e: any) => set('expense_date', e.target.value)} />
          </div>

          {headWantsBroker && (
            <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-3 space-y-2">
              <Select label={`Which broker is this ${selectedHeadName} for?`} value={form.broker_id} onChange={(e: any) => set('broker_id', e.target.value)}>
                <option value="">— Pick the broker —</option>
                {brokers.map(b => <option key={b.id} value={b.id}>{b.name || '—'}{b.broker_id ? ` [${b.broker_id}]` : ''}</option>)}
              </Select>
              {selectedHeadName === 'advance' && (
                <p className="text-[11px] text-amber-900 flex items-start gap-1.5">
                  <AlertTriangle size={12} className="mt-0.5 shrink-0"/>
                  Money handed to the broker up front — it is deducted from what they can withdraw until it is recovered.
                </p>
              )}
            </div>
          )}

          <Input label="Responsible person (who is accountable)" value={form.responsible_person} onChange={(e: any) => set('responsible_person', e.target.value)} placeholder="e.g. Office manager's name" />
          <Textarea label="Notes" rows={2} value={form.description} onChange={(e: any) => set('description', e.target.value)} placeholder="Anything worth recording about this spend" />

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="secondary" onClick={() => setModal(false)}>Cancel</Button>
            <Button onClick={save}>{form.id ? 'Save changes' : 'Add expense'}</Button>
          </div>
        </div>
      </Modal>

      {/* ── Heads ──────────────────────────────────────────────────────────── */}
      <Modal open={headsModal} onClose={() => setHeadsModal(false)} title="Expense heads" size="sm">
        <div className="space-y-3">
          <p className="text-xs text-gray-500">
            <b>Advance</b>, <b>Payout</b> and <b>Discount</b> are broker-linked: picking one of those asks which broker the money is for.
          </p>
          <div className="flex gap-2">
            <input value={newHead} onChange={e => setNewHead(e.target.value)} placeholder="e.g. Electricity"
              onKeyDown={e => { if (e.key === 'Enter') addHead() }}
              className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"/>
            <Button onClick={addHead}><Plus size={14}/>Add</Button>
          </div>
          <ul className="divide-y divide-gray-100 border border-gray-100 rounded-lg">
            {heads.map(h => {
              const linked = BROKER_HEADS.includes((h.name || '').toLowerCase())
              const used = all.filter(r => r.head_id === h.id).length
              return (
                <li key={h.id} className="px-3 py-2 flex items-center justify-between text-sm">
                  <span className="text-gray-800">{h.name}</span>
                  <span className="text-[11px] text-gray-400">
                    {linked && <span className="text-amber-700 mr-2">broker-linked</span>}
                    {used} entr{used === 1 ? 'y' : 'ies'}
                  </span>
                </li>
              )
            })}
          </ul>
        </div>
      </Modal>

      {/* ── Delete ─────────────────────────────────────────────────────────── */}
      <Modal open={!!deleteFor} onClose={() => setDeleteFor(null)} title="Delete this expense?" size="sm">
        {deleteFor && (
          <div className="space-y-3">
            <p className="text-sm text-gray-700">
              <b>{deleteFor.item_name}</b> · {formatINR(deleteFor.amount)} · {formatDate(deleteFor.expense_date)}
            </p>
            {headNameOf(deleteFor.head_id).toLowerCase() === 'advance' && deleteFor.broker_id && (
              <p className="text-xs bg-amber-50 border border-amber-200 text-amber-900 rounded-lg px-2.5 py-2">
                This is an advance against <b>{brokerLabel(deleteFor.broker_id)}</b>. Deleting it gives them that much back in withdrawable balance.
              </p>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => setDeleteFor(null)}>Cancel</Button>
              <Button variant="danger" onClick={remove}>Delete</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
