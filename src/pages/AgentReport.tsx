// Agent-wise report — "agent wise filtration: overview, active id, cancel, inactive,
// total customer, project wise".
//
// Until now the only way to answer "how is Ram Kishan's book doing" was to open Customer
// Pipeline, filter by his name, and count rows by eye.  This puts one agent's whole book
// on one screen: what they sold, what has been collected, who has stopped paying, and
// which project it came from.
//
// The three buckets are the ones admin asked for, and they are deliberately exclusive so
// the numbers add up to the total rather than double-counting:
//
//   Cancelled — the booking was cancelled (stage = 'cancelled').
//   Inactive  — at least one EMI instalment is past its due date and unpaid.  Admin chose
//               this definition: a customer who has stopped paying is the one worth a
//               phone call, which is not the same as one who simply has not started.
//   Active    — everything else: paying, or not yet due.
//
// Counts are shown as customers AND bookings, because one customer can hold several plots
// and the two numbers answer different questions ("how many people" vs "how many deals").
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { formatINR, formatDate } from '@/lib/utils'
import { bookingValue, paidByBooking } from '@/lib/bookingMath'
import { fetchEmiStatus, type EmiStatus } from '@/lib/emiStatus'
import { waLink } from '@/lib/whatsapp'
import {
  Search, Users, Building2, AlertTriangle, XCircle, CheckCircle2,
  Wallet, TrendingUp, Phone, MessageCircle, Download, ChevronRight,
} from 'lucide-react'

type Bucket = 'active' | 'inactive' | 'cancelled' | 'all'

const BUCKET_META: Record<Bucket, { label: string; hint: string; on: string; off: string }> = {
  all:       { label: 'Total',     hint: 'every booking this agent has sold',   on: 'bg-gray-900 text-white border-gray-900',       off: 'bg-white text-gray-700 border-gray-200 hover:border-gray-400' },
  active:    { label: 'Active',    hint: 'paying, or nothing overdue yet',      on: 'bg-emerald-600 text-white border-emerald-600', off: 'bg-white text-emerald-700 border-emerald-200 hover:border-emerald-400' },
  inactive:  { label: 'Inactive',  hint: 'EMI overdue — stopped paying',        on: 'bg-red-600 text-white border-red-600',         off: 'bg-white text-red-700 border-red-200 hover:border-red-400' },
  cancelled: { label: 'Cancelled', hint: 'booking cancelled',                   on: 'bg-slate-700 text-white border-slate-700',     off: 'bg-white text-slate-700 border-slate-200 hover:border-slate-400' },
}

type Enriched = {
  id: string
  broker_id: string | null
  booking_no: string
  customer_id: string | null
  customer_name: string
  customer_code: string
  phone: string | null
  project_id: string | null
  project_name: string
  plot_no: string
  stage: string
  commission_mode: string
  value: number
  paid: number
  balance: number
  emi: EmiStatus | undefined
  bucket: Bucket
}

export default function AgentReport() {
  const [agentId, setAgentId] = useState('')
  const [bucket, setBucket]   = useState<Bucket>('all')
  const [q, setQ]             = useState('')
  const [mode, setMode]       = useState<'' | 'mlm' | 'traditional'>('')

  const { data: agents = [] } = useQuery({
    queryKey: ['agent_report_brokers'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('brokers')
        .select('id, name, broker_id, phone, rank, status, broker_type')
        .order('broker_id', { ascending: true })
      if (error) throw error
      return (data || []) as any[]
    },
  })

  // Every booking that has an agent on it.  Fetched once for the whole page so switching
  // agent is instant — the office flicks between agents constantly and a round trip per
  // agent made the screen feel broken.
  const { data: bookings = [], isLoading } = useQuery({
    queryKey: ['agent_report_bookings'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('bp_bookings')
        .select('id, booking_no, broker_id, customer_id, project_id, stage, commission_mode, total_amount, plot_total_price, application_date, bp_customers(name, customer_code, phone), bp_projects(name), bp_plots(plot_no)')
        .not('broker_id', 'is', null)
        .order('created_at', { ascending: false })
      if (error) throw error
      return (data || []) as any[]
    },
  })

  const { data: payments = [] } = useQuery({
    queryKey: ['agent_report_payments'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('bp_payments')
        .select('booking_id, amount, verification_status')
      if (error) throw error
      return (data || []) as any[]
    },
  })

  const bookingIds = useMemo(() => (bookings as any[]).map(b => b.id), [bookings])

  const { data: emiByBooking = {} } = useQuery<Record<string, EmiStatus>>({
    queryKey: ['agent_report_emi', bookingIds.length],
    enabled: bookingIds.length > 0,
    queryFn: () => fetchEmiStatus(bookingIds),
  })

  // Commission actually distributed, per agent — the same source the Brokers page uses,
  // so the two screens cannot disagree about what an agent has earned.
  const { data: earnedByAgent = {} } = useQuery<Record<string, number>>({
    queryKey: ['agent_report_earnings'],
    queryFn: async () => {
      const { data } = await supabase.from('payout_distributions').select('beneficiary_broker_id, net_payout')
      const out: Record<string, number> = {}
      for (const d of ((data || []) as any[])) {
        if (!d.beneficiary_broker_id) continue
        out[d.beneficiary_broker_id] = (out[d.beneficiary_broker_id] || 0) + Number(d.net_payout || 0)
      }
      return out
    },
  })

  const paidMap = useMemo(() => paidByBooking(payments as any[]), [payments])

  // One pass that labels every booking, so the chips, the tiles, the project table and the
  // list below all read the same classification instead of each re-deciding it.
  const enrichedAll: Enriched[] = useMemo(() => {
    return (bookings as any[]).map(b => {
      const value = bookingValue(b)
      const paid  = paidMap[b.id] || 0
      const emi   = emiByBooking[b.id]
      const bk: Bucket =
        b.stage === 'cancelled'        ? 'cancelled' :
        (emi && emi.overdue > 0)       ? 'inactive'  :
                                         'active'
      return {
        id: b.id,
        broker_id: b.broker_id || null,
        booking_no: b.booking_no || '—',
        customer_id: b.customer_id || null,
        customer_name: b.bp_customers?.name || '—',
        customer_code: b.bp_customers?.customer_code || '',
        phone: b.bp_customers?.phone || null,
        project_id: b.project_id || null,
        project_name: b.bp_projects?.name || 'No project',
        plot_no: b.bp_plots?.plot_no || '—',
        stage: b.stage,
        commission_mode: b.commission_mode || 'mlm',
        value, paid,
        balance: Math.max(0, value - paid),
        emi,
        bucket: bk,
      }
    })
  }, [bookings, paidMap, emiByBooking])

  // Grouped off the row's own broker_id rather than by matching array positions: a future
  // filter or sort on either list would silently pair the wrong booking with the wrong agent.
  const byAgent = useMemo(() => {
    const m: Record<string, Enriched[]> = {}
    for (const e of enrichedAll) {
      if (!e.broker_id) continue
      ;(m[e.broker_id] ??= []).push(e)
    }
    return m
  }, [enrichedAll])

  const counts = (list: Enriched[], bk: Bucket) => {
    const rows = bk === 'all' ? list : list.filter(r => r.bucket === bk)
    return { bookings: rows.length, customers: new Set(rows.map(r => r.customer_id || r.id)).size }
  }

  const selectedAgent = (agents as any[]).find(a => a.id === agentId)
  const agentRowsAll  = agentId ? (byAgent[agentId] || []) : enrichedAll
  const agentRows     = mode ? agentRowsAll.filter(r => (mode === 'traditional' ? r.commission_mode === 'traditional' : r.commission_mode !== 'traditional')) : agentRowsAll

  const totals = useMemo(() => {
    const value = agentRows.reduce((s, r) => s + r.value, 0)
    const paid  = agentRows.reduce((s, r) => s + r.paid, 0)
    const overdueAmt = agentRows.reduce((s, r) => s + (r.emi?.amount_overdue || 0), 0)
    return {
      value, paid, balance: Math.max(0, value - paid), overdueAmt,
      customers: new Set(agentRows.map(r => r.customer_id || r.id)).size,
      bookings: agentRows.length,
      pct: value > 0 ? Math.round((paid / value) * 100) : 0,
    }
  }, [agentRows])

  // Project-wise split for whoever is selected.
  const byProject = useMemo(() => {
    const m = new Map<string, { name: string; bookings: number; customers: Set<string>; value: number; paid: number; overdue: number }>()
    for (const r of agentRows) {
      const key = r.project_id || 'none'
      const cur = m.get(key) || { name: r.project_name, bookings: 0, customers: new Set<string>(), value: 0, paid: 0, overdue: 0 }
      cur.bookings++
      cur.customers.add(r.customer_id || r.id)
      cur.value += r.value
      cur.paid  += r.paid
      if (r.bucket === 'inactive') cur.overdue++
      m.set(key, cur)
    }
    return [...m.values()].sort((a, b) => b.value - a.value)
  }, [agentRows])

  const listRows = useMemo(() => {
    let rows = bucket === 'all' ? agentRows : agentRows.filter(r => r.bucket === bucket)
    const needle = q.trim().toLowerCase()
    if (needle) {
      rows = rows.filter(r =>
        `${r.customer_name} ${r.customer_code} ${r.booking_no} ${r.plot_no} ${r.project_name} ${r.phone || ''}`
          .toLowerCase().includes(needle))
    }
    return rows
  }, [agentRows, bucket, q])

  // League table when no agent is picked: who is carrying the business, worst defaulters last.
  const leaderboard = useMemo(() => {
    if (agentId) return []
    return (agents as any[])
      .map(a => {
        const rows = byAgent[a.id] || []
        const value = rows.reduce((s, r) => s + r.value, 0)
        const paid  = rows.reduce((s, r) => s + r.paid, 0)
        return {
          ...a,
          bookings: rows.length,
          customers: new Set(rows.map(r => r.customer_id || r.id)).size,
          inactive: rows.filter(r => r.bucket === 'inactive').length,
          cancelled: rows.filter(r => r.bucket === 'cancelled').length,
          value, paid,
          earned: earnedByAgent[a.id] || 0,
        }
      })
      .filter(a => a.bookings > 0)
      .sort((a, b) => b.value - a.value)
  }, [agents, byAgent, agentId, earnedByAgent])

  const exportCsv = () => {
    const header = ['Agent', 'Agent code', 'Customer', 'Customer code', 'Phone', 'Booking', 'Plot', 'Project', 'Sale type', 'Status', 'Value', 'Paid', 'Balance', 'EMI overdue', 'Overdue amount']
    const agentLabel = selectedAgent ? `${selectedAgent.name || ''}` : 'All agents'
    const agentCode  = selectedAgent?.broker_id || ''
    const body = listRows.map(r => [
      agentLabel, agentCode, r.customer_name, r.customer_code, r.phone || '', r.booking_no, r.plot_no,
      r.project_name, r.commission_mode === 'traditional' ? 'Traditional' : 'MLM',
      BUCKET_META[r.bucket].label, r.value, r.paid, r.balance,
      r.emi?.overdue || 0, r.emi?.amount_overdue || 0,
    ])
    const csv = [header, ...body]
      .map(line => line.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(','))
      .join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `agent-report-${agentCode || 'all'}-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const agentOptions = (agents as any[]).filter(a => (byAgent[a.id] || []).length > 0)

  return (
    <div className="p-4 md:p-8 space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Agent report</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            One agent&rsquo;s whole book on one screen — what they sold, what came in, and who stopped paying.
          </p>
        </div>
        <button
          onClick={exportCsv}
          disabled={listRows.length === 0}
          className="inline-flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg bg-white border border-gray-200 text-gray-700 hover:border-gray-400 disabled:opacity-40"
        >
          <Download size={14}/>Export ({listRows.length})
        </button>
      </div>

      {/* Agent picker + sale type */}
      <div className="bg-white border border-gray-200 rounded-xl p-4 flex flex-wrap gap-3 items-center">
        <select
          value={agentId}
          onChange={e => { setAgentId(e.target.value); setBucket('all') }}
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm min-w-[260px] focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">— All agents (league table) —</option>
          {agentOptions.map(a => (
            <option key={a.id} value={a.id}>
              {a.name || '—'}{a.broker_id ? ` [${a.broker_id}]` : ''} · {(byAgent[a.id] || []).length} bookings
            </option>
          ))}
        </select>

        <div className="inline-flex rounded-lg border border-gray-200 overflow-hidden text-xs">
          <button onClick={() => setMode('')}
            className={`px-3 py-2 ${mode === '' ? 'bg-gray-900 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'}`}>All sales</button>
          <button onClick={() => setMode('mlm')}
            className={`px-3 py-2 border-l border-gray-200 ${mode === 'mlm' ? 'bg-blue-600 text-white' : 'bg-white text-blue-700 hover:bg-blue-50'}`}>MLM</button>
          <button onClick={() => setMode('traditional')}
            className={`px-3 py-2 border-l border-gray-200 ${mode === 'traditional' ? 'bg-amber-600 text-white' : 'bg-white text-amber-700 hover:bg-amber-50'}`}>Traditional</button>
        </div>

        {selectedAgent && (
          <div className="flex items-center gap-2 text-xs text-gray-500 ml-auto">
            <span className="font-mono bg-gray-100 px-2 py-0.5 rounded">{selectedAgent.broker_id}</span>
            {selectedAgent.phone && (
              <>
                <a href={`tel:${selectedAgent.phone}`} className="inline-flex items-center gap-1 text-blue-700 hover:underline"><Phone size={11}/>{selectedAgent.phone}</a>
                <a href={waLink(selectedAgent.phone, `Namaste ${selectedAgent.name || ''}`)} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-emerald-700 hover:underline"><MessageCircle size={11}/>WhatsApp</a>
              </>
            )}
            <Link to={`/brokers/${selectedAgent.id}`} className="inline-flex items-center gap-0.5 text-gray-600 hover:underline">Profile<ChevronRight size={11}/></Link>
          </div>
        )}
      </div>

      {isLoading && <div className="py-16 text-center text-sm text-gray-400">Loading the book…</div>}

      {!isLoading && (
        <>
          {/* ── Overview ── */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            <Tile icon={<Users size={14}/>}        label="Total customers" value={String(totals.customers)} sub={`${totals.bookings} booking${totals.bookings === 1 ? '' : 's'}`} tone="gray"/>
            <Tile icon={<TrendingUp size={14}/>}   label="Business value"  value={formatINR(totals.value)}  sub="booking value sold" tone="blue"/>
            <Tile icon={<Wallet size={14}/>}       label="Collected"       value={formatINR(totals.paid)}   sub={`${totals.pct}% of value`} tone="emerald"/>
            <Tile icon={<Building2 size={14}/>}    label="Balance due"     value={formatINR(totals.balance)} sub="still to come in" tone="amber"/>
            <Tile icon={<AlertTriangle size={14}/>} label="EMI overdue"    value={formatINR(totals.overdueAmt)} sub={`${counts(agentRows, 'inactive').bookings} booking(s) behind`} tone={totals.overdueAmt > 0 ? 'rose' : 'gray'}/>
          </div>

          {/* ── Buckets ── */}
          <div className="flex flex-wrap gap-2">
            {(['all', 'active', 'inactive', 'cancelled'] as Bucket[]).map(bk => {
              const c = counts(agentRows, bk)
              const meta = BUCKET_META[bk]
              return (
                <button
                  key={bk}
                  onClick={() => setBucket(bk)}
                  title={meta.hint}
                  className={`px-4 py-2.5 rounded-xl border text-left transition ${bucket === bk ? meta.on : meta.off}`}
                >
                  <div className="text-xs font-semibold uppercase tracking-wide">{meta.label}</div>
                  <div className="text-lg font-bold leading-tight">{c.customers}<span className="text-xs font-medium opacity-70"> customers</span></div>
                  <div className="text-[11px] opacity-70">{c.bookings} booking{c.bookings === 1 ? '' : 's'}</div>
                </button>
              )
            })}
          </div>

          {/* ── League table when nobody is picked ── */}
          {!agentId && (
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-100">
                <h2 className="text-sm font-semibold text-gray-900">All agents</h2>
                <p className="text-[11px] text-gray-500">Pick an agent above to open their book. Sorted by business value.</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50">
                    <tr>{['Agent', 'Customers', 'Bookings', 'Inactive', 'Cancelled', 'Value', 'Collected', 'Commission earned', ''].map(h => (
                      <th key={h} className="px-4 py-2.5 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                    ))}</tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {leaderboard.length === 0 && (
                      <tr><td colSpan={9} className="px-4 py-10 text-center text-sm text-gray-400">No agent has a booking yet.</td></tr>
                    )}
                    {leaderboard.map(a => (
                      <tr key={a.id} className="hover:bg-gray-50/60">
                        <td className="px-4 py-2.5">
                          <div className="font-medium text-gray-900">{a.name || '—'}</div>
                          <div className="text-[11px] text-gray-400 font-mono">{a.broker_id}</div>
                        </td>
                        <td className="px-4 py-2.5 tabular-nums">{a.customers}</td>
                        <td className="px-4 py-2.5 tabular-nums">{a.bookings}</td>
                        <td className="px-4 py-2.5 tabular-nums">{a.inactive > 0 ? <span className="text-red-600 font-semibold">{a.inactive}</span> : <span className="text-gray-300">—</span>}</td>
                        <td className="px-4 py-2.5 tabular-nums">{a.cancelled > 0 ? <span className="text-slate-600">{a.cancelled}</span> : <span className="text-gray-300">—</span>}</td>
                        <td className="px-4 py-2.5 tabular-nums">{formatINR(a.value)}</td>
                        <td className="px-4 py-2.5 tabular-nums text-emerald-700">{formatINR(a.paid)}</td>
                        <td className="px-4 py-2.5 tabular-nums">{a.earned > 0 ? formatINR(a.earned) : <span className="text-gray-300">—</span>}</td>
                        <td className="px-4 py-2.5">
                          <button onClick={() => { setAgentId(a.id); setBucket('all') }} className="text-xs text-blue-700 hover:underline">Open</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ── Project-wise ── */}
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100">
              <h2 className="text-sm font-semibold text-gray-900">Project wise</h2>
              <p className="text-[11px] text-gray-500">{selectedAgent ? `Where ${selectedAgent.name || 'this agent'}'s sales came from.` : 'Across all agents.'}</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>{['Project', 'Customers', 'Bookings', 'Value', 'Collected', 'Behind on EMI'].map(h => (
                    <th key={h} className="px-4 py-2.5 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                  ))}</tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {byProject.length === 0 && (
                    <tr><td colSpan={6} className="px-4 py-8 text-center text-sm text-gray-400">Nothing to show.</td></tr>
                  )}
                  {byProject.map(p => (
                    <tr key={p.name} className="hover:bg-gray-50/60">
                      <td className="px-4 py-2.5 font-medium text-gray-900">{p.name}</td>
                      <td className="px-4 py-2.5 tabular-nums">{p.customers.size}</td>
                      <td className="px-4 py-2.5 tabular-nums">{p.bookings}</td>
                      <td className="px-4 py-2.5 tabular-nums">{formatINR(p.value)}</td>
                      <td className="px-4 py-2.5 tabular-nums text-emerald-700">{formatINR(p.paid)}</td>
                      <td className="px-4 py-2.5 tabular-nums">{p.overdue > 0 ? <span className="text-red-600 font-semibold">{p.overdue}</span> : <span className="text-gray-300">—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* ── The bookings themselves ── */}
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 flex flex-wrap gap-3 items-center justify-between">
              <div>
                <h2 className="text-sm font-semibold text-gray-900">
                  {BUCKET_META[bucket].label} · {listRows.length} booking{listRows.length === 1 ? '' : 's'}
                </h2>
                <p className="text-[11px] text-gray-500">{BUCKET_META[bucket].hint}</p>
              </div>
              <div className="relative w-full sm:w-64">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"/>
                <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search customer, plot, booking…"
                  className="w-full pl-8 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"/>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>{['Customer', 'Booking / Plot', 'Project', 'Type', 'Value', 'Collected', 'Balance', 'EMI', ''].map(h => (
                    <th key={h} className="px-4 py-2.5 text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                  ))}</tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {listRows.length === 0 && (
                    <tr><td colSpan={9} className="px-4 py-10 text-center text-sm text-gray-400">
                      {bucket === 'inactive' ? 'Nobody in this list is behind on EMI — good.' : 'Nothing in this bucket.'}
                    </td></tr>
                  )}
                  {listRows.map(r => (
                    <tr key={r.id} className="hover:bg-gray-50/60">
                      <td className="px-4 py-2.5">
                        <div className="font-medium text-gray-900 flex items-center gap-1.5">
                          {r.bucket === 'cancelled' && <XCircle size={12} className="text-slate-400 shrink-0"/>}
                          {r.bucket === 'inactive'  && <AlertTriangle size={12} className="text-red-500 shrink-0"/>}
                          {r.bucket === 'active'    && <CheckCircle2 size={12} className="text-emerald-500 shrink-0"/>}
                          <span className="truncate">{r.customer_name}</span>
                        </div>
                        <div className="text-[11px] text-gray-400 font-mono">{r.customer_code}{r.phone ? ` · ${r.phone}` : ''}</div>
                      </td>
                      <td className="px-4 py-2.5">
                        <div className="font-mono text-xs text-gray-700">{r.booking_no}</div>
                        <div className="text-[11px] text-gray-400">Plot {r.plot_no}</div>
                      </td>
                      <td className="px-4 py-2.5 text-xs text-gray-600">{r.project_name}</td>
                      <td className="px-4 py-2.5">
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full border ${
                          r.commission_mode === 'traditional'
                            ? 'bg-amber-50 text-amber-800 border-amber-200'
                            : 'bg-blue-50 text-blue-800 border-blue-200'}`}>
                          {r.commission_mode === 'traditional' ? 'TRAD' : 'MLM'}
                        </span>
                      </td>
                      <td className="px-4 py-2.5 tabular-nums">{formatINR(r.value)}</td>
                      <td className="px-4 py-2.5 tabular-nums text-emerald-700">{formatINR(r.paid)}</td>
                      <td className="px-4 py-2.5 tabular-nums">{formatINR(r.balance)}</td>
                      <td className="px-4 py-2.5">
                        {!r.emi ? <span className="text-xs text-gray-300">no plan</span>
                         : r.emi.overdue > 0
                          ? <span className="text-xs text-red-600 font-semibold">{r.emi.overdue} late · {formatINR(r.emi.amount_overdue)}</span>
                          : <span className="text-xs text-gray-600">{r.emi.left} left{r.emi.next_due ? ` · ${formatDate(r.emi.next_due)}` : ''}</span>}
                      </td>
                      <td className="px-4 py-2.5">
                        <Link to={`/customer-pipeline?customer=${r.customer_id || ''}`} className="text-xs text-blue-700 hover:underline whitespace-nowrap">Open</Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
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
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide opacity-70">
        {icon}{label}
      </div>
      <div className="text-xl font-bold mt-1 tabular-nums">{value}</div>
      <div className="text-[11px] opacity-60 mt-0.5">{sub}</div>
    </div>
  )
}
