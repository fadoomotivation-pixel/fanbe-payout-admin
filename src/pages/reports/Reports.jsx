import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { formatINR, formatDate } from '../../lib/utils'
import {
  Users, BarChart2, CreditCard, Building2, Banknote, Star,
  Download, Printer, ChevronUp, ChevronDown, Search
} from 'lucide-react'

// ── Helpers ─────────────────────────────────────────────────
function jsonToCSV(rows, headers, keys) {
  const lines = [headers.join(',')]
  rows.forEach(r => lines.push(keys.map(k => `"${r[k] ?? ''}"`).join(',')))
  return lines.join('\n')
}
function downloadCSV(content, filename) {
  const blob = new Blob([content], { type: 'text/csv' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
}
function today() { return new Date().toISOString().slice(0, 10) }
function monthStart() {
  const d = new Date(); d.setDate(1)
  return d.toISOString().slice(0, 10)
}

function SortIcon({ dir }) {
  if (!dir) return <ChevronDown size={12} className="text-slate-300" />
  return dir === 'asc' ? <ChevronUp size={12} className="text-teal-600" /> : <ChevronDown size={12} className="text-teal-600" />
}

function useSortedData(data, initCol, initDir = 'asc') {
  const [sort, setSort] = useState({ col: initCol, dir: initDir })
  function toggle(col) {
    setSort(s => s.col === col ? { col, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { col, dir: 'asc' })
  }
  const sorted = useMemo(() => {
    if (!sort.col) return data
    return [...data].sort((a, b) => {
      const av = a[sort.col], bv = b[sort.col]
      const r = typeof av === 'number' ? av - bv : String(av ?? '').localeCompare(String(bv ?? ''))
      return sort.dir === 'asc' ? r : -r
    })
  }, [data, sort])
  return { sorted, sort, toggle }
}

function Th({ children, col, sort, toggle, right }) {
  return (
    <th
      className={`px-4 py-2.5 text-xs font-semibold text-slate-500 cursor-pointer select-none hover:text-teal-700 ${right ? 'text-right' : 'text-left'}`}
      onClick={() => toggle(col)}
    >
      <span className="inline-flex items-center gap-1">
        {children} <SortIcon dir={sort.col === col ? sort.dir : null} />
      </span>
    </th>
  )
}

function EmptyRow({ cols, msg = 'No data found. Adjust your filters and generate report.' }) {
  return <tr><td colSpan={cols} className="px-4 py-12 text-center text-slate-400 text-sm">{msg}</td></tr>
}

function SkeletonRows({ cols, rows = 5 }) {
  return Array.from({ length: rows }).map((_, i) => (
    <tr key={i} className="border-b border-slate-100">
      {Array.from({ length: cols }).map((_, j) => (
        <td key={j} className="px-4 py-3"><div className="skeleton skeleton-text rounded" /></td>
      ))}
    </tr>
  ))
}

const STATUS_COLORS = {
  on_time: 'bg-green-100 text-green-700',
  overdue: 'bg-orange-100 text-orange-700',
  lapsed: 'bg-red-100 text-red-700',
  paid_late: 'bg-yellow-100 text-yellow-700',
  paid: 'bg-green-100 text-green-700',
  pending: 'bg-yellow-100 text-yellow-700',
  approved: 'bg-blue-100 text-blue-700',
  rejected: 'bg-red-100 text-red-700',
}

// ── Report Definitions ───────────────────────────────────────
const REPORTS = [
  { id: 'broker_performance', label: 'Broker Performance', icon: Users },
  { id: 'commission_ledger',  label: 'Commission Ledger',  icon: BarChart2 },
  { id: 'installment',       label: 'Installment Collection', icon: CreditCard },
  { id: 'project_sales',     label: 'Project Sales',      icon: Building2 },
  { id: 'payout_summary',    label: 'Payout Summary',     icon: Banknote },
  { id: 'achievers_club',    label: 'Achievers Club',     icon: Star },
]

// ─────────────────────────────────────────────────
function ReportBrokerPerformance() {
  const [from, setFrom] = useState(monthStart())
  const [to, setTo] = useState(today())
  const [generated, setGenerated] = useState(false)

  const { data = [], isLoading, refetch } = useQuery({
    queryKey: ['report-broker-perf', from, to],
    queryFn: async () => {
      const { data } = await supabase
        .from('brokers')
        .select('id, name, rank, joined_date, status, bp_payout_transactions(amount, status, created_at)')
        .gte('bp_payout_transactions.created_at', from)
        .lte('bp_payout_transactions.created_at', to + 'T23:59:59')
      return (data || []).map(b => ({
        name: b.name,
        rank: b.rank,
        joined: b.joined_date,
        status: b.status,
        commission_earned: (b.bp_payout_transactions || []).reduce((s, t) => s + (t.amount || 0), 0),
        payout_status: (b.bp_payout_transactions || []).some(t => t.status === 'pending') ? 'Pending' : 'Cleared',
      }))
    },
    enabled: false,
  })

  const { sorted, sort, toggle } = useSortedData(data, 'name')

  function generate() { setGenerated(true); refetch() }
  function exportCSV() {
    downloadCSV(
      jsonToCSV(sorted,
        ['Broker Name','Rank','Commission Earned (₹)','Payout Status','Joined'],
        ['name','rank','commission_earned','payout_status','joined']
      ),
      `broker-performance-${from}-${to}.csv`
    )
  }

  const total = data.reduce((s, r) => s + r.commission_earned, 0)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 items-end">
        <div>
          <label className="block text-xs text-slate-500 mb-1">From</label>
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} className="input text-sm py-2" />
        </div>
        <div>
          <label className="block text-xs text-slate-500 mb-1">To</label>
          <input type="date" value={to} onChange={e => setTo(e.target.value)} className="input text-sm py-2" />
        </div>
        <button onClick={generate} className="btn-primary">Generate Report</button>
        {generated && data.length > 0 && (
          <button onClick={exportCSV} className="btn-secondary flex items-center gap-1.5">
            <Download size={14} /> Export CSV
          </button>
        )}
        <button onClick={() => window.print()} className="btn-secondary flex items-center gap-1.5">
          <Printer size={14} /> Print
        </button>
      </div>

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <Th col="name" sort={sort} toggle={toggle}>Broker Name</Th>
              <Th col="rank" sort={sort} toggle={toggle}>Rank</Th>
              <Th col="commission_earned" sort={sort} toggle={toggle} right>Commission Earned</Th>
              <Th col="payout_status" sort={sort} toggle={toggle}>Payout Status</Th>
              <Th col="joined" sort={sort} toggle={toggle}>Joined</Th>
            </tr>
          </thead>
          <tbody>
            {!generated ? (
              <tr><td colSpan={5} className="px-4 py-10 text-center text-slate-400">Set filters and click Generate Report</td></tr>
            ) : isLoading ? <SkeletonRows cols={5} /> : sorted.length === 0 ? <EmptyRow cols={5} /> : (
              <>
                {sorted.map((r, i) => (
                  <tr key={i} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium text-slate-800">{r.name}</td>
                    <td className="px-4 py-3 text-slate-600">{r.rank ?? '—'}</td>
                    <td className="px-4 py-3 text-right font-semibold text-teal-700">{formatINR(r.commission_earned)}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${r.payout_status === 'Pending' ? 'bg-yellow-100 text-yellow-700' : 'bg-green-100 text-green-700'}`}>
                        {r.payout_status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-400 text-xs">{formatDate(r.joined)}</td>
                  </tr>
                ))}
                <tr className="bg-slate-50 font-semibold">
                  <td className="px-4 py-3 text-slate-700" colSpan={2}>Total ({data.length} brokers)</td>
                  <td className="px-4 py-3 text-right text-teal-700">{formatINR(total)}</td>
                  <td colSpan={2} />
                </tr>
              </>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────
function ReportCommissionLedger() {
  const [from, setFrom] = useState(monthStart())
  const [to, setTo] = useState(today())
  const [statusFilter, setStatusFilter] = useState('')
  const [brokerSearch, setBrokerSearch] = useState('')
  const [generated, setGenerated] = useState(false)

  const { data = [], isLoading, refetch } = useQuery({
    queryKey: ['report-commission-ledger', from, to, statusFilter],
    queryFn: async () => {
      let q = supabase
        .from('bp_payout_transactions')
        .select('*, brokers(name), bp_bookings(booking_no, bp_plots(plot_no))')
        .gte('created_at', from)
        .lte('created_at', to + 'T23:59:59')
        .order('created_at', { ascending: false })
      if (statusFilter) q = q.eq('status', statusFilter)
      const { data } = await q
      return data || []
    },
    enabled: false,
  })

  const filtered = useMemo(() => {
    if (!brokerSearch) return data
    return data.filter(r => r.brokers?.name?.toLowerCase().includes(brokerSearch.toLowerCase()))
  }, [data, brokerSearch])

  const { sorted, sort, toggle } = useSortedData(filtered, 'created_at', 'desc')

  const totalPending = filtered.filter(r => r.status === 'pending').reduce((s, r) => s + (r.amount || 0), 0)
  const totalPaid = filtered.filter(r => r.status === 'paid').reduce((s, r) => s + (r.net_amount || r.amount || 0), 0)

  function exportCSV() {
    const rows = sorted.map(r => ({
      date: formatDate(r.created_at),
      broker: r.brokers?.name || '',
      booking: r.bp_bookings?.booking_no || '',
      plot: r.bp_bookings?.bp_plots?.plot_no || '',
      installment: r.amount || 0,
      diff_pct: r.diff_pct || '',
      commission: r.net_amount || r.amount || 0,
      status: r.status || '',
    }))
    downloadCSV(
      jsonToCSV(rows,
        ['Date','Broker','Booking Ref','Plot No','Installment ₹','Diff %','Commission ₹','Status'],
        ['date','broker','booking','plot','installment','diff_pct','commission','status']
      ),
      `commission-ledger-${from}-${to}.csv`
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 items-end">
        <div>
          <label className="block text-xs text-slate-500 mb-1">From</label>
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} className="input text-sm py-2" />
        </div>
        <div>
          <label className="block text-xs text-slate-500 mb-1">To</label>
          <input type="date" value={to} onChange={e => setTo(e.target.value)} className="input text-sm py-2" />
        </div>
        <div>
          <label className="block text-xs text-slate-500 mb-1">Status</label>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="input text-sm py-2">
            <option value="">All</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="paid">Paid</option>
            <option value="rejected">Lapsed/Rejected</option>
          </select>
        </div>
        <div className="relative">
          <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input placeholder="Search broker…" value={brokerSearch} onChange={e => setBrokerSearch(e.target.value)} className="input pl-8 text-sm py-2" />
        </div>
        <button onClick={() => { setGenerated(true); refetch() }} className="btn-primary">Generate</button>
        {generated && sorted.length > 0 && (
          <button onClick={exportCSV} className="btn-secondary flex items-center gap-1.5"><Download size={14} /> CSV</button>
        )}
      </div>

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <Th col="created_at" sort={sort} toggle={toggle}>Date</Th>
              <Th col="broker" sort={sort} toggle={toggle}>Broker</Th>
              <Th col="booking" sort={sort} toggle={toggle}>Booking Ref</Th>
              <Th col="amount" sort={sort} toggle={toggle} right>Installment ₹</Th>
              <Th col="net_amount" sort={sort} toggle={toggle} right>Commission ₹</Th>
              <Th col="status" sort={sort} toggle={toggle}>Status</Th>
            </tr>
          </thead>
          <tbody>
            {!generated ? (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-400">Set filters and click Generate</td></tr>
            ) : isLoading ? <SkeletonRows cols={6} /> : sorted.length === 0 ? <EmptyRow cols={6} /> : (
              <>
                {sorted.map((r, i) => (
                  <tr key={i} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="px-4 py-3 text-xs text-slate-400 whitespace-nowrap">{formatDate(r.created_at)}</td>
                    <td className="px-4 py-3 font-medium text-slate-800">{r.brokers?.name || '—'}</td>
                    <td className="px-4 py-3 text-teal-700">{r.bp_bookings?.booking_no || r.reference_no || '—'}</td>
                    <td className="px-4 py-3 text-right">{formatINR(r.amount)}</td>
                    <td className="px-4 py-3 text-right font-semibold text-teal-700">{formatINR(r.net_amount || r.amount)}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[r.status] || 'bg-slate-100 text-slate-600'}`}>
                        {r.status || 'pending'}
                      </span>
                    </td>
                  </tr>
                ))}
                <tr className="bg-slate-50 font-semibold text-sm">
                  <td colSpan={4} className="px-4 py-3 text-slate-600">Totals</td>
                  <td className="px-4 py-3 text-right">
                    <span className="text-yellow-700 block">Pending: {formatINR(totalPending)}</span>
                    <span className="text-green-700 block">Paid: {formatINR(totalPaid)}</span>
                  </td>
                  <td />
                </tr>
              </>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────
function ReportInstallment() {
  const [from, setFrom] = useState(monthStart())
  const [to, setTo] = useState(today())
  const [generated, setGenerated] = useState(false)

  const { data = [], isLoading, refetch } = useQuery({
    queryKey: ['report-installment', from, to],
    queryFn: async () => {
      const { data } = await supabase
        .from('bp_payment_milestones')
        .select('*, bp_bookings(booking_no, customers(name), brokers(name), bp_plots(plot_no))')
        .gte('due_date', from)
        .lte('due_date', to)
        .order('due_date')
      return (data || []).map(r => {
        const daysOverdue = r.paid_date ? 0 : Math.max(0, Math.floor((Date.now() - new Date(r.due_date)) / 86400000))
        const status = r.paid_date
          ? (new Date(r.paid_date) > new Date(r.due_date) ? 'paid_late' : 'on_time')
          : daysOverdue > 90 ? 'lapsed' : daysOverdue > 0 ? 'overdue' : 'on_time'
        return {
          customer: r.bp_bookings?.customers?.name || '—',
          plot: r.bp_bookings?.bp_plots?.plot_no || '—',
          broker: r.bp_bookings?.brokers?.name || '—',
          due_date: r.due_date,
          amount_due: r.amount_due || 0,
          amount_paid: r.amount_paid || 0,
          paid_date: r.paid_date,
          days_overdue: daysOverdue,
          status,
        }
      })
    },
    enabled: false,
  })

  const { sorted, sort, toggle } = useSortedData(data, 'due_date')

  const totalDue = data.reduce((s, r) => s + r.amount_due, 0)
  const totalCollected = data.reduce((s, r) => s + r.amount_paid, 0)
  const totalOverdue = data.filter(r => r.status === 'overdue').reduce((s, r) => s + r.amount_due, 0)
  const totalLapsed = data.filter(r => r.status === 'lapsed').reduce((s, r) => s + r.amount_due, 0)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 items-end">
        <div><label className="block text-xs text-slate-500 mb-1">From</label>
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} className="input text-sm py-2" /></div>
        <div><label className="block text-xs text-slate-500 mb-1">To</label>
          <input type="date" value={to} onChange={e => setTo(e.target.value)} className="input text-sm py-2" /></div>
        <button onClick={() => { setGenerated(true); refetch() }} className="btn-primary">Generate</button>
      </div>

      {generated && !isLoading && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[['Total Due', totalDue, 'text-slate-700'], ['Collected', totalCollected, 'text-green-700'],
            ['Overdue', totalOverdue, 'text-orange-600'], ['Lapsed', totalLapsed, 'text-red-600']].map(([l, v, c]) => (
            <div key={l} className="card p-4">
              <p className="text-xs text-slate-500">{l}</p>
              <p className={`text-xl font-bold mt-1 ${c}`}>{formatINR(v)}</p>
            </div>
          ))}
        </div>
      )}

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <Th col="customer" sort={sort} toggle={toggle}>Customer</Th>
              <Th col="plot" sort={sort} toggle={toggle}>Plot No</Th>
              <Th col="broker" sort={sort} toggle={toggle}>Broker</Th>
              <Th col="due_date" sort={sort} toggle={toggle}>Due Date</Th>
              <Th col="amount_due" sort={sort} toggle={toggle} right>Due ₹</Th>
              <Th col="amount_paid" sort={sort} toggle={toggle} right>Paid ₹</Th>
              <Th col="days_overdue" sort={sort} toggle={toggle} right>Days Overdue</Th>
              <Th col="status" sort={sort} toggle={toggle}>Status</Th>
            </tr>
          </thead>
          <tbody>
            {!generated ? (
              <tr><td colSpan={8} className="px-4 py-10 text-center text-slate-400">Set filters and click Generate</td></tr>
            ) : isLoading ? <SkeletonRows cols={8} /> : sorted.length === 0 ? <EmptyRow cols={8} /> : (
              sorted.map((r, i) => (
                <tr key={i} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-slate-800">{r.customer}</td>
                  <td className="px-4 py-3 text-slate-600">{r.plot}</td>
                  <td className="px-4 py-3 text-slate-600">{r.broker}</td>
                  <td className="px-4 py-3 text-xs text-slate-400">{formatDate(r.due_date)}</td>
                  <td className="px-4 py-3 text-right">{formatINR(r.amount_due)}</td>
                  <td className="px-4 py-3 text-right text-green-700">{formatINR(r.amount_paid)}</td>
                  <td className="px-4 py-3 text-right">{r.days_overdue > 0 ? r.days_overdue : '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[r.status] || 'bg-slate-100 text-slate-600'}`}>
                      {r.status.replace('_', ' ')}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────
function ReportProjectSales() {
  const [projectId, setProjectId] = useState('')
  const [from, setFrom] = useState(monthStart())
  const [to, setTo] = useState(today())
  const [generated, setGenerated] = useState(false)

  const { data: projects = [] } = useQuery({
    queryKey: ['projects-list-mini'],
    queryFn: async () => { const { data } = await supabase.from('bp_projects').select('id, name'); return data || [] },
  })

  const { data: rows = [], isLoading, refetch } = useQuery({
    queryKey: ['report-project-sales', projectId, from, to],
    queryFn: async () => {
      if (!projectId) return []
      const { data } = await supabase
        .from('bp_plots')
        .select('*, bp_bookings(*, customers(name), brokers(name), bp_payment_milestones(amount_paid))')
        .eq('project_id', projectId)
      return (data || []).map(p => {
        const booking = p.bp_bookings?.[0]
        const collected = (booking?.bp_payment_milestones || []).reduce((s, m) => s + (m.amount_paid || 0), 0)
        return {
          plot_no: p.plot_no,
          sq_yards: p.area_sqyd,
          status: p.status,
          customer: booking?.customers?.name || '—',
          broker: booking?.brokers?.name || '—',
          sale_price: booking?.total_amount || 0,
          collected,
          collection_pct: booking?.total_amount ? Math.round((collected / booking.total_amount) * 100) : 0,
        }
      })
    },
    enabled: false,
  })

  const { sorted, sort, toggle } = useSortedData(rows, 'plot_no')
  const totalRevenue = rows.reduce((s, r) => s + r.sale_price, 0)
  const totalCollected = rows.reduce((s, r) => s + r.collected, 0)
  const booked = rows.filter(r => r.status !== 'available').length

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 items-end">
        <div>
          <label className="block text-xs text-slate-500 mb-1">Project *</label>
          <select value={projectId} onChange={e => setProjectId(e.target.value)} className="input text-sm py-2">
            <option value="">Select project…</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <button onClick={() => { if (!projectId) return; setGenerated(true); refetch() }} className="btn-primary" disabled={!projectId}>
          Generate
        </button>
      </div>

      {generated && !isLoading && rows.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[['Total Plots', rows.length, 'text-slate-700'], ['Booked', booked, 'text-blue-700'],
            ['Revenue Booked', formatINR(totalRevenue), 'text-teal-700'], ['Collected', formatINR(totalCollected), 'text-green-700']].map(([l, v, c]) => (
            <div key={l} className="card p-4">
              <p className="text-xs text-slate-500">{l}</p>
              <p className={`text-xl font-bold mt-1 ${c}`}>{v}</p>
            </div>
          ))}
        </div>
      )}

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <Th col="plot_no" sort={sort} toggle={toggle}>Plot No</Th>
              <Th col="sq_yards" sort={sort} toggle={toggle} right>Sq Yards</Th>
              <Th col="status" sort={sort} toggle={toggle}>Status</Th>
              <Th col="customer" sort={sort} toggle={toggle}>Customer</Th>
              <Th col="broker" sort={sort} toggle={toggle}>Broker</Th>
              <Th col="sale_price" sort={sort} toggle={toggle} right>Sale Price</Th>
              <Th col="collected" sort={sort} toggle={toggle} right>Collected</Th>
              <Th col="collection_pct" sort={sort} toggle={toggle} right>%</Th>
            </tr>
          </thead>
          <tbody>
            {!generated ? (
              <tr><td colSpan={8} className="px-4 py-10 text-center text-slate-400">Select a project and click Generate</td></tr>
            ) : isLoading ? <SkeletonRows cols={8} /> : sorted.length === 0 ? <EmptyRow cols={8} /> : (
              sorted.map((r, i) => (
                <tr key={i} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-teal-700">{r.plot_no}</td>
                  <td className="px-4 py-3 text-right">{r.sq_yards?.toLocaleString() ?? '—'}</td>
                  <td className="px-4 py-3">
                    <span className="px-2 py-0.5 rounded-full text-xs bg-slate-100 text-slate-600 capitalize">{r.status}</span>
                  </td>
                  <td className="px-4 py-3 text-slate-700">{r.customer}</td>
                  <td className="px-4 py-3 text-slate-600">{r.broker}</td>
                  <td className="px-4 py-3 text-right">{formatINR(r.sale_price)}</td>
                  <td className="px-4 py-3 text-right text-green-700">{formatINR(r.collected)}</td>
                  <td className="px-4 py-3 text-right">
                    <span className={`text-xs font-semibold ${r.collection_pct >= 100 ? 'text-green-600' : r.collection_pct > 50 ? 'text-teal-600' : 'text-orange-600'}`}>
                      {r.collection_pct}%
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────
function ReportPayoutSummary() {
  const now = new Date()
  const [month, setMonth] = useState(`${now.getFullYear()}-${String(now.getMonth()).padStart(2, '0')}`)
  const [generated, setGenerated] = useState(false)

  const monthFrom = `${month}-01`
  const monthTo = `${month}-31`

  const { data = [], isLoading, refetch } = useQuery({
    queryKey: ['report-payout-summary', month],
    queryFn: async () => {
      const { data } = await supabase
        .from('bp_payout_transactions')
        .select('*, brokers(id, name, pan, bank_account, ifsc)')
        .gte('created_at', monthFrom)
        .lte('created_at', monthTo + 'T23:59:59')
      // Group by broker
      const map = {}
      ;(data || []).forEach(t => {
        const bid = t.broker_id
        if (!map[bid]) map[bid] = { name: t.brokers?.name || '—', pan: t.brokers?.pan || '—', bank: t.brokers?.bank_account || '—', ifsc: t.brokers?.ifsc || '—', gross: 0, tds: 0, net: 0, status: t.status }
        map[bid].gross += t.amount || 0
        map[bid].tds += t.tds_amount || 0
        map[bid].net += t.net_amount || t.amount || 0
      })
      return Object.values(map)
    },
    enabled: false,
  })

  const { sorted, sort, toggle } = useSortedData(data, 'name')
  const totalGross = data.reduce((s, r) => s + r.gross, 0)
  const totalTds = data.reduce((s, r) => s + r.tds, 0)
  const totalNet = data.reduce((s, r) => s + r.net, 0)

  function exportCSV() {
    downloadCSV(
      jsonToCSV(sorted,
        ['Broker Name','PAN','Bank Account','IFSC','Gross ₹','TDS ₹','Net ₹','Status'],
        ['name','pan','bank','ifsc','gross','tds','net','status']
      ),
      `payout-summary-${month}.csv`
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 items-end">
        <div>
          <label className="block text-xs text-slate-500 mb-1">Month</label>
          <input type="month" value={month} onChange={e => setMonth(e.target.value)} className="input text-sm py-2" />
        </div>
        <button onClick={() => { setGenerated(true); refetch() }} className="btn-primary">Generate</button>
        {generated && sorted.length > 0 && (
          <button onClick={exportCSV} className="btn-secondary flex items-center gap-1.5"><Download size={14} /> CSV (Bank Upload)</button>
        )}
        <button onClick={() => window.print()} className="btn-secondary flex items-center gap-1.5"><Printer size={14} /> Print</button>
      </div>

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <Th col="name" sort={sort} toggle={toggle}>Broker Name</Th>
              <Th col="pan" sort={sort} toggle={toggle}>PAN</Th>
              <Th col="bank" sort={sort} toggle={toggle}>Bank Account</Th>
              <Th col="ifsc" sort={sort} toggle={toggle}>IFSC</Th>
              <Th col="gross" sort={sort} toggle={toggle} right>Gross ₹</Th>
              <Th col="tds" sort={sort} toggle={toggle} right>TDS ₹</Th>
              <Th col="net" sort={sort} toggle={toggle} right>Net ₹</Th>
              <Th col="status" sort={sort} toggle={toggle}>Status</Th>
            </tr>
          </thead>
          <tbody>
            {!generated ? (
              <tr><td colSpan={8} className="px-4 py-10 text-center text-slate-400">Select month and click Generate</td></tr>
            ) : isLoading ? <SkeletonRows cols={8} /> : sorted.length === 0 ? <EmptyRow cols={8} /> : (
              <>
                {sorted.map((r, i) => (
                  <tr key={i} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium text-slate-800">{r.name}</td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-500">{r.pan}</td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-500">{r.bank}</td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-500">{r.ifsc}</td>
                    <td className="px-4 py-3 text-right">{formatINR(r.gross)}</td>
                    <td className="px-4 py-3 text-right text-red-500">-{formatINR(r.tds)}</td>
                    <td className="px-4 py-3 text-right font-semibold text-teal-700">{formatINR(r.net)}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[r.status] || 'bg-slate-100 text-slate-600'}`}>{r.status || '—'}</span>
                    </td>
                  </tr>
                ))}
                <tr className="bg-slate-50 font-semibold">
                  <td colSpan={4} className="px-4 py-3 text-slate-700">Total ({data.length} brokers)</td>
                  <td className="px-4 py-3 text-right">{formatINR(totalGross)}</td>
                  <td className="px-4 py-3 text-right text-red-500">-{formatINR(totalTds)}</td>
                  <td className="px-4 py-3 text-right text-teal-700">{formatINR(totalNet)}</td>
                  <td />
                </tr>
              </>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────
function ReportAchieversClub() {
  const now = new Date()
  const [month, setMonth] = useState(`${now.getFullYear()}-${String(now.getMonth()).padStart(2, '0')}`)
  const [generated, setGenerated] = useState(false)
  const POOL_RATE = 100
  const TARGET_SQYD = 3000
  const STREAK_MONTHS = 3

  const { data = [], isLoading, refetch } = useQuery({
    queryKey: ['report-achievers', month],
    queryFn: async () => {
      const { data } = await supabase
        .from('brokers')
        .select('id, name, achievers_streak, achievers_sqyd_this_month, achievers_qualified')
      return data || []
    },
    enabled: false,
  })

  const qualified = data.filter(r => r.achievers_qualified)
  const poolSize = TARGET_SQYD * POOL_RATE
  const perHead = qualified.length ? Math.floor(poolSize / qualified.length) : 0
  const { sorted, sort, toggle } = useSortedData(data, 'name')

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 items-end">
        <div>
          <label className="block text-xs text-slate-500 mb-1">Month</label>
          <input type="month" value={month} onChange={e => setMonth(e.target.value)} className="input text-sm py-2" />
        </div>
        <button onClick={() => { setGenerated(true); refetch() }} className="btn-primary">Generate</button>
      </div>

      {generated && !isLoading && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[['Pool Size', formatINR(poolSize), 'text-teal-700'], ['Qualified Brokers', qualified.length, 'text-blue-700'],
            ['Per Head Share', formatINR(perHead), 'text-green-700'], ['Target (sq yd)', TARGET_SQYD.toLocaleString(), 'text-slate-700']].map(([l, v, c]) => (
            <div key={l} className="card p-4">
              <p className="text-xs text-slate-500">{l}</p>
              <p className={`text-xl font-bold mt-1 ${c}`}>{v}</p>
            </div>
          ))}
        </div>
      )}

      <div className="card overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-slate-50 border-b border-slate-200">
              <Th col="name" sort={sort} toggle={toggle}>Broker</Th>
              <Th col="achievers_sqyd_this_month" sort={sort} toggle={toggle} right>Team Sq Yd</Th>
              <Th col="achievers_streak" sort={sort} toggle={toggle} right>Streak (months)</Th>
              <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-500">Qualified</th>
              <Th col="share" sort={sort} toggle={toggle} right>Share ₹</Th>
            </tr>
          </thead>
          <tbody>
            {!generated ? (
              <tr><td colSpan={5} className="px-4 py-10 text-center text-slate-400">Select month and click Generate</td></tr>
            ) : isLoading ? <SkeletonRows cols={5} /> : sorted.length === 0 ? <EmptyRow cols={5} /> : (
              sorted.map((r, i) => (
                <tr key={i} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-slate-800">{r.name}</td>
                  <td className="px-4 py-3 text-right">{(r.achievers_sqyd_this_month || 0).toLocaleString()}</td>
                  <td className="px-4 py-3 text-right">{r.achievers_streak || 0}/{STREAK_MONTHS}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${r.achievers_qualified ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
                      {r.achievers_qualified ? 'Yes ✓' : 'No'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right font-semibold text-teal-700">
                    {r.achievers_qualified ? formatINR(perHead) : '—'}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Main Reports Shell ───────────────────────────────────────────
const REPORT_COMPONENTS = {
  broker_performance: ReportBrokerPerformance,
  commission_ledger: ReportCommissionLedger,
  installment: ReportInstallment,
  project_sales: ReportProjectSales,
  payout_summary: ReportPayoutSummary,
  achievers_club: ReportAchieversClub,
}

export default function Reports() {
  const [active, setActive] = useState('broker_performance')
  const ActiveReport = REPORT_COMPONENTS[active]

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">Reports</h1>
        <p className="text-sm text-slate-500 mt-0.5">Generate, filter, and export operational reports</p>
      </div>

      <div className="flex flex-col md:flex-row gap-6 items-start">
        {/* Sidebar */}
        <nav className="w-full md:w-52 shrink-0">
          <div className="card overflow-hidden">
            {REPORTS.map(r => {
              const Icon = r.icon
              const isActive = active === r.id
              return (
                <button
                  key={r.id}
                  onClick={() => setActive(r.id)}
                  className={`w-full flex items-center gap-3 px-4 py-3 text-sm text-left border-b border-slate-100 last:border-0 transition-colors ${
                    isActive ? 'bg-teal-50 text-teal-700 font-semibold' : 'text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <Icon size={15} className={isActive ? 'text-teal-600' : 'text-slate-400'} />
                  {r.label}
                </button>
              )
            })}
          </div>
        </nav>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="mb-4">
            <h2 className="text-lg font-semibold text-slate-800">
              {REPORTS.find(r => r.id === active)?.label}
            </h2>
          </div>
          <ActiveReport key={active} />
        </div>
      </div>
    </div>
  )
}
