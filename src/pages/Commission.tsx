import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { Table } from '@/components/ui/Table.tsx'
import { Badge } from '@/components/ui/Badge.tsx'
import { formatINR, formatDate } from '@/lib/utils'
import { Layers, ArrowUpRight, ArrowDownRight, Search, Filter, Download, Wallet, Coins, Banknote, TrendingUp } from 'lucide-react'

type Entry = {
  id: string
  at: string
  broker_id: string | null
  broker_name: string
  broker_code: string
  kind: 'commission_earned' | 'payout_paid' | 'withdrawal_paid'
  direction: 'credit' | 'debit'
  amount: number
  ref: string
  booking_no?: string
  detail?: string
}

const KIND_META: Record<string, { label: string; color: string }> = {
  commission_earned: { label: 'Commission earned', color: 'bg-emerald-50 text-emerald-700 border border-emerald-200' },
  payout_paid:       { label: 'Payout paid',       color: 'bg-indigo-50 text-indigo-700 border border-indigo-200' },
  withdrawal_paid:   { label: 'Withdrawal paid',   color: 'bg-blue-50 text-blue-700 border border-blue-200' },
}

export default function Commission() {
  const [search, setSearch] = useState('')
  const [filterBroker, setFilterBroker] = useState('')
  const [filterKind, setFilterKind] = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')

  const { data: brokers = [] } = useQuery({
    queryKey: ['brokers_lite'],
    queryFn: async () => {
      const { data } = await supabase.from('brokers').select('id, name, broker_id').order('name')
      return data || []
    },
  })

  const brokerLookup = useMemo(() => {
    const m: Record<string, { name: string; code: string }> = {}
    for (const b of brokers as any[]) m[b.id] = { name: b.name, code: b.broker_id }
    return m
  }, [brokers])

  const { data: entries = [], isLoading } = useQuery<Entry[]>({
    queryKey: ['commission_ledger'],
    queryFn: async () => {
      // Credit side = per-payment MLM distributions (the real money a broker has earned).
      // We DO NOT use bp_bookings.commission_amount here — that's only the promised lifetime
      // commission on full payment, which inflates the ledger by the unpaid portion of every
      // booking. The wallet must reflect what was actually distributed (matches broker dashboards).
      const [{ data: dists }, { data: payouts }, { data: withdrawals }] = await Promise.all([
        supabase.from('payout_distributions')
          .select('id, beneficiary_broker_id, net_payout, created_at, income_type, level, bp_bookings(booking_no)'),
        supabase.from('bp_payout_transactions').select('id, broker_id, net_amount, amount, paid_date, status, payout_type, utr_ref, booking_id').eq('status', 'paid'),
        supabase.from('withdrawal_requests').select('id, broker_id, net_amount, amount, paid_at, status, utr').eq('status', 'paid'),
      ])

      const list: Entry[] = []
      for (const d of (dists || []) as any[]) {
        const amt = Number(d.net_payout || 0)
        if (!d.beneficiary_broker_id || amt <= 0) continue
        const bookingNo = d.bp_bookings?.booking_no || '—'
        const levelLabel = d.level === 0 ? 'self' : `L${d.level} upline`
        list.push({
          id: `pd-${d.id}`,
          at: d.created_at || new Date().toISOString(),
          broker_id: d.beneficiary_broker_id,
          broker_name: '', broker_code: '',
          kind: 'commission_earned',
          direction: 'credit',
          amount: amt,
          ref: bookingNo,
          booking_no: bookingNo,
          detail: `${d.income_type || 'direct'} · ${levelLabel}`,
        })
      }
      for (const p of (payouts || []) as any[]) {
        const amt = Number(p.net_amount || p.amount || 0)
        if (!p.broker_id || amt <= 0) continue
        list.push({
          id: `po-${p.id}`,
          at: p.paid_date || new Date().toISOString(),
          broker_id: p.broker_id,
          broker_name: '', broker_code: '',
          kind: 'payout_paid',
          direction: 'debit',
          amount: amt,
          ref: p.utr_ref || `payout · ${p.payout_type || ''}`,
        })
      }
      for (const w of (withdrawals || []) as any[]) {
        const amt = Number(w.net_amount || w.amount || 0)
        if (!w.broker_id || amt <= 0) continue
        list.push({
          id: `wd-${w.id}`,
          at: w.paid_at || new Date().toISOString(),
          broker_id: w.broker_id,
          broker_name: '', broker_code: '',
          kind: 'withdrawal_paid',
          direction: 'debit',
          amount: amt,
          ref: w.utr ? `UTR ${w.utr}` : 'withdrawal',
        })
      }
      list.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())
      return list
    },
  })

  // Apply filters
  const filtered = useMemo(() => {
    return entries.filter(e => {
      if (filterBroker && e.broker_id !== filterBroker) return false
      if (filterKind && e.kind !== filterKind) return false
      if (dateFrom && e.at.slice(0, 10) < dateFrom) return false
      if (dateTo   && e.at.slice(0, 10) > dateTo)   return false
      if (search.trim()) {
        const q = search.toLowerCase()
        const meta = brokerLookup[e.broker_id || '']
        const hay = `${meta?.name || ''} ${meta?.code || ''} ${e.ref || ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [entries, filterBroker, filterKind, dateFrom, dateTo, search, brokerLookup])

  // Running balance — compute over ALL entries (sorted oldest→newest), filter the display set after
  const rowsWithBalance = useMemo(() => {
    // per-broker running balance through time over the *unfiltered* list
    const perBroker: Record<string, number> = {}
    const balanceById: Record<string, number> = {}
    for (const e of entries) {
      const bid = e.broker_id || ''
      perBroker[bid] = (perBroker[bid] || 0) + (e.direction === 'credit' ? e.amount : -e.amount)
      balanceById[e.id] = perBroker[bid]
    }
    // attach name + balance, then take the filtered subset in display order (newest first)
    return filtered
      .map(e => ({ ...e, broker_name: brokerLookup[e.broker_id || '']?.name || '—', broker_code: brokerLookup[e.broker_id || '']?.code || '—', balance: balanceById[e.id] }))
      .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
  }, [filtered, entries, brokerLookup])

  // Totals (always over the filtered set)
  const totals = useMemo(() => {
    let credit = 0, debit = 0
    for (const e of filtered) (e.direction === 'credit' ? credit += e.amount : debit += e.amount)
    const balance = credit - debit
    // Distinct brokers in filtered view
    const brokerSet = new Set(filtered.map(e => e.broker_id).filter(Boolean))
    return { credit, debit, balance, brokers: brokerSet.size }
  }, [filtered])

  const exportCSV = () => {
    if (rowsWithBalance.length === 0) return
    const headers = ['Date','Broker','Code','Type','Direction','Amount','Running Balance','Reference']
    const lines = rowsWithBalance.map(r => [
      r.at.slice(0,10), r.broker_name, r.broker_code, KIND_META[r.kind]?.label || r.kind,
      r.direction, r.amount, r.balance, r.ref,
    ])
    const csv = [headers, ...lines].map(r => r.map(c => {
      const s = String(c ?? '')
      return /[",\n]/.test(s) ? `"${s.replace(/"/g,'""')}"` : s
    }).join(',')).join('\r\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `commission-ledger-${new Date().toISOString().slice(0,10)}.csv`; a.click()
    URL.revokeObjectURL(url)
  }

  const filtersActive = !!(search || filterBroker || filterKind || dateFrom || dateTo)

  const cols = [
    { header: 'Date', render: (r: any) => <span className="text-xs text-gray-600">{formatDate(r.at)}</span> },
    { header: 'Broker', render: (r: any) => (
      <div>
        <Link to={`/broker/dashboard?broker_id=${r.broker_id}`} className="font-medium text-sm text-blue-700 hover:underline">{r.broker_name}</Link>
        <div className="text-[10px] text-gray-400 font-mono">[{r.broker_code}]</div>
      </div>
    )},
    { header: 'Type', render: (r: any) => {
      const m = KIND_META[r.kind]
      return <Badge label={m?.label || r.kind} className={m?.color || 'bg-gray-100 text-gray-700'} />
    }},
    { header: 'Reference', render: (r: any) => (
      <div>
        {r.booking_no && r.booking_no !== '—' ? (
          <Link to={`/bookings?search=${r.booking_no}`} className="text-xs font-mono text-blue-700 hover:underline">{r.ref}</Link>
        ) : <span className="text-xs font-mono text-gray-600">{r.ref}</span>}
        {r.detail && <div className="text-[10px] text-gray-400 capitalize">{r.detail}</div>}
      </div>
    )},
    { header: 'Amount', render: (r: any) => (
      <span className={`font-semibold inline-flex items-center gap-1 ${r.direction === 'credit' ? 'text-emerald-700' : 'text-rose-700'}`}>
        {r.direction === 'credit' ? <ArrowUpRight size={12}/> : <ArrowDownRight size={12}/>}
        {r.direction === 'credit' ? '+' : '−'}{formatINR(r.amount)}
      </span>
    )},
    { header: 'Running Balance', render: (r: any) => <span className={`font-bold ${r.balance >= 0 ? 'text-gray-900' : 'text-rose-600'}`}>{formatINR(r.balance)}</span> },
  ]

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-indigo-50 rounded-lg"><Layers size={20} className="text-indigo-600"/></div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">Commission Ledger</h1>
            <p className="text-sm text-gray-500">Live broker wallet · derived from confirmed bookings, payouts, and withdrawals</p>
          </div>
        </div>
        <button onClick={exportCSV} disabled={rowsWithBalance.length === 0}
          className="inline-flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-40">
          <Download size={14}/>Export CSV
        </button>
      </div>

      {/* KPI tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        <Stat icon={<Coins size={16}/>}   label="Total earned (credit)" value={formatINR(totals.credit)} accent="text-emerald-700" bg="bg-emerald-50 border-emerald-200"/>
        <Stat icon={<Banknote size={16}/>}label="Total paid out (debit)" value={formatINR(totals.debit)}  accent="text-rose-700"    bg="bg-rose-50 border-rose-200"/>
        <Stat icon={<Wallet size={16}/>}  label="Net balance"           value={formatINR(totals.balance)} accent={totals.balance >= 0 ? 'text-indigo-700' : 'text-rose-700'} bg="bg-indigo-50 border-indigo-200"/>
        <Stat icon={<TrendingUp size={16}/>}label="Brokers in view"     value={String(totals.brokers)}    accent="text-gray-900"   bg="bg-gray-50 border-gray-200"/>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm mb-3">
        <div className="p-3 flex flex-wrap gap-2 items-center">
          <div className="relative flex-1 min-w-[220px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"/>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search broker, code, reference..."
              className="w-full pl-8 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-300"/>
          </div>
          <select value={filterBroker} onChange={e => setFilterBroker(e.target.value)} className="border border-gray-200 rounded-lg px-2 py-2 text-sm focus:outline-none">
            <option value="">All Brokers</option>
            {(brokers as any[]).map((b: any) => <option key={b.id} value={b.id}>{b.name} [{b.broker_id}]</option>)}
          </select>
          <select value={filterKind} onChange={e => setFilterKind(e.target.value)} className="border border-gray-200 rounded-lg px-2 py-2 text-sm focus:outline-none">
            <option value="">All Types</option>
            <option value="commission_earned">Commission earned</option>
            <option value="payout_paid">Payout paid</option>
            <option value="withdrawal_paid">Withdrawal paid</option>
          </select>
          <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} className="border border-gray-200 rounded-lg px-2 py-2 text-sm focus:outline-none"/>
          <input type="date" value={dateTo}   onChange={e => setDateTo(e.target.value)}   className="border border-gray-200 rounded-lg px-2 py-2 text-sm focus:outline-none"/>
          {filtersActive && (
            <button onClick={() => { setSearch(''); setFilterBroker(''); setFilterKind(''); setDateFrom(''); setDateTo('') }}
              className="text-xs text-gray-500 hover:text-gray-800 underline">Clear filters</button>
          )}
          <div className="text-xs text-gray-500 ml-auto">{rowsWithBalance.length} entries</div>
        </div>
        <Table columns={cols} data={rowsWithBalance} loading={isLoading} emptyMsg="No commission activity in this range yet."/>
      </div>

      <div className="mt-4 text-[11px] text-gray-400 leading-relaxed">
        <Filter size={11} className="inline-block mr-1 -mt-0.5"/>
        Credits come from <b>payout_distributions</b> — one row per payment per beneficiary (direct + every upline differential), net of TDS &amp; admin. These are the same numbers shown on every broker dashboard. Debits come from <b>bp_payout_transactions</b> &amp; <b>withdrawal_requests</b> (status = paid). The balance column is a per-broker running total across all time.
      </div>
    </div>
  )
}

function Stat({ icon, label, value, accent, bg }: any) {
  return (
    <div className={`rounded-xl border p-3 ${bg}`}>
      <div className="flex items-center justify-between mb-1">
        <span className={accent}>{icon}</span>
      </div>
      <div className={`text-xl font-bold ${accent}`}>{value}</div>
      <div className="text-xs text-gray-500 mt-0.5">{label}</div>
    </div>
  )
}
