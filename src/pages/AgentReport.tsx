// Broker Sales — "kis broker ne kitna maal becha, kitna paisa aaya, kitni EMI baaki hai".
//
// The old Agent report put a broker picker, four bucket tiles, a league table, a project
// table and a booking list on one screen at once; admin found it hard to read.  This is one
// table — a row per broker, the money columns admin asked for — and a tap on a row opens
// that broker's customers underneath.
//
// Every figure comes from the Customer Pipeline's own index (lib/pipelineIndex), the same
// rows the pipeline tiles count, so a broker's "balance" here and the sum of their
// customers' cards there cannot disagree.  Two rules carried over from it:
//   - an old-register booking whose paid-till-date is not entered has an unknown balance,
//     so it is counted on its own and kept out of "balance due" (lib/bookingMath);
//   - cancelled bookings are not sales: they are listed in their own column, not in
//     "sold" or "balance".
// Bookings with no broker linked (most of the old register) get their own row, so the
// table adds up to the whole business.
import { useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { formatINR, formatDate } from '@/lib/utils'
import { bookingValue } from '@/lib/bookingMath'
import { fetchPipelineIndex, type IndexRow } from '@/lib/pipelineIndex'
import { fetchAllRows, todayLocalISO } from '@/lib/fetchAll'
import { downloadCsv } from '@/lib/download'
import { printSimpleTable } from '@/lib/printTemplates'
import { waLink } from '@/lib/whatsapp'
import {
  Search, Users, AlertTriangle, XCircle, CheckCircle2, Wallet, TrendingUp, Hourglass,
  Phone, MessageCircle, Download, Printer, ChevronRight, ChevronDown, X,
} from 'lucide-react'

const NONE = '__none__'

type Period = 'all' | 'this_month' | 'last_month' | 'this_fy' | 'custom'
type SortKey = 'value' | 'paid' | 'balance' | 'emiLeft' | 'late' | 'bookings' | 'name'
type Status = 'all' | 'active' | 'inactive' | 'cancelled'

type BookingLine = {
  id: string
  broker_key: string
  customer_id: string | null
  customer_name: string
  customer_code: string
  phone: string
  booking_no: string
  plot_no: string
  project_id: string | null
  date: string
  commission_mode: string
  value: number
  paid: number
  balance: number
  paidUnknown: boolean
  sqyd: number
  emi: IndexRow['emi']
  status: Exclude<Status, 'all'>
}

type BrokerRow = {
  key: string
  name: string
  code: string
  phone: string
  bookings: number
  customers: number
  sqyd: number
  value: number
  paid: number
  balance: number
  unknown: number
  emiLeft: number
  kistLeft: number
  late: number
  lateBookings: number
  cancelled: number
  cancelledValue: number
  earned: number
}

const STATUS_META: Record<Status, { label: string; hint: string }> = {
  all:       { label: 'All',          hint: 'every booking' },
  active:    { label: 'Paying fine',  hint: 'no EMI past its date' },
  inactive:  { label: 'EMI late',     hint: 'an instalment is past its date and unpaid' },
  cancelled: { label: 'Cancelled',    hint: 'booking cancelled' },
}

// Booking date as the office means it: the date on the application form, else the day it
// was entered.
const bookedOn = (b: { application_date?: string | null; created_at?: string | null }) =>
  b.application_date || (b.created_at || '').slice(0, 10)

function periodRange(p: Period, from: string, to: string): [string, string] {
  const now = new Date()
  const y = now.getFullYear(), m = now.getMonth()
  const iso = (d: Date) => todayLocalISO(d)
  if (p === 'this_month') return [iso(new Date(y, m, 1)), iso(new Date(y, m + 1, 0))]
  if (p === 'last_month') return [iso(new Date(y, m - 1, 1)), iso(new Date(y, m, 0))]
  if (p === 'this_fy') {
    // Indian financial year: 1 April to 31 March.
    const fy = m >= 3 ? y : y - 1
    return [iso(new Date(fy, 3, 1)), iso(new Date(fy + 1, 2, 31))]
  }
  if (p === 'custom') return [from, to]
  return ['', '']
}

export default function AgentReport() {
  const [q, setQ]             = useState('')
  const [period, setPeriod]   = useState<Period>('all')
  const [from, setFrom]       = useState('')
  const [to, setTo]           = useState('')
  const [projectF, setProjectF] = useState('')
  const [mode, setMode]       = useState<'' | 'mlm' | 'traditional'>('')
  const [sortKey, setSortKey] = useState<SortKey>('value')
  const [openKey, setOpenKey] = useState<string | null>(null)
  const [status, setStatus]   = useState<Status>('all')
  const [custQ, setCustQ]     = useState('')
  const detailRef = useRef<HTMLDivElement>(null)

  // Same query key as the Customer Pipeline, so the two pages share one load and one truth.
  const { data: index = [], isLoading } = useQuery<IndexRow[]>({
    queryKey: ['cp_index'],
    queryFn: fetchPipelineIndex,
    staleTime: 30_000,
  })

  // The pipeline index leaves cancelled bookings out; they are counted here in their own
  // column, never as a sale.
  const { data: cancelledRows = [] } = useQuery({
    queryKey: ['agent_report_cancelled'],
    queryFn: () => fetchAllRows((f, t) => supabase.from('bp_bookings')
      .select('id, booking_no, broker_id, customer_id, project_id, commission_mode, total_amount, plot_total_price, size_sqyd, application_date, created_at, bp_customers(name, customer_code, phone), bp_plots(plot_no, size_sqyd)')
      .eq('stage', 'cancelled').order('id').range(f, t)),
  })

  const { data: brokers = [] } = useQuery({
    queryKey: ['agent_report_brokers'],
    queryFn: () => fetchAllRows((f, t) => supabase.from('brokers')
      .select('id, name, broker_id, phone').order('id').range(f, t)),
  })

  const { data: projects = [] } = useQuery({
    queryKey: ['agent_report_projects'],
    queryFn: async () => {
      const { data, error } = await supabase.from('bp_projects').select('id, name').order('name')
      if (error) throw error
      return data || []
    },
  })

  // Commission actually credited — the same rows the broker wallet is built from.
  const { data: earnedBy = {} } = useQuery<Record<string, number>>({
    queryKey: ['agent_report_earned'],
    queryFn: async () => {
      const rows = await fetchAllRows((f, t) => supabase.from('payout_distributions')
        .select('beneficiary_broker_id, net_payout').order('id').range(f, t))
      const out: Record<string, number> = {}
      for (const d of rows as any[]) {
        if (!d.beneficiary_broker_id) continue
        out[d.beneficiary_broker_id] = (out[d.beneficiary_broker_id] || 0) + Number(d.net_payout || 0)
      }
      return out
    },
  })

  const brokerById = useMemo(() => {
    const m: Record<string, any> = {}
    for (const b of brokers as any[]) m[b.id] = b
    return m
  }, [brokers])
  const projectName = useMemo(() => {
    const m: Record<string, string> = {}
    for (const p of projects as any[]) m[p.id] = p.name
    return m
  }, [projects])

  const [pFrom, pTo] = periodRange(period, from, to)

  // Every booking as one line, live and cancelled, with the filters applied.
  const lines: BookingLine[] = useMemo(() => {
    const inScope = (date: string, project: string | null, cm: string) => {
      if (pFrom && date < pFrom) return false
      if (pTo && date > pTo) return false
      if (projectF && project !== projectF) return false
      if (mode === 'traditional' && cm !== 'traditional') return false
      if (mode === 'mlm' && cm === 'traditional') return false
      return true
    }
    const out: BookingLine[] = []
    for (const r of index) {
      const date = bookedOn(r)
      if (!inScope(date, r.project_id, r.commission_mode)) continue
      const paidUnknown = r.bucket === 'old_unrecorded'
      out.push({
        id: r.id, broker_key: r.broker_id || NONE,
        customer_id: r.customer_id, customer_name: r.customer_name || '—', customer_code: r.customer_code,
        phone: r.customer_phone, booking_no: r.booking_no, plot_no: r.plot_no, project_id: r.project_id,
        date, commission_mode: r.commission_mode,
        value: r.value, paid: r.paid, balance: paidUnknown ? 0 : r.balance, paidUnknown,
        sqyd: r.size_sqyd, emi: r.emi,
        status: r.emi && r.emi.overdue > 0 ? 'inactive' : 'active',
      })
    }
    for (const b of cancelledRows as any[]) {
      const date = bookedOn(b)
      const cm = b.commission_mode || 'mlm'
      if (!inScope(date, b.project_id || null, cm)) continue
      out.push({
        id: b.id, broker_key: b.broker_id || NONE,
        customer_id: b.customer_id || null, customer_name: b.bp_customers?.name || '—',
        customer_code: b.bp_customers?.customer_code || '', phone: b.bp_customers?.phone || '',
        booking_no: b.booking_no || '', plot_no: b.bp_plots?.plot_no || '', project_id: b.project_id || null,
        date, commission_mode: cm,
        value: bookingValue(b), paid: 0, balance: 0, paidUnknown: false,
        sqyd: Number(b.size_sqyd || b.bp_plots?.size_sqyd || 0), emi: undefined,
        status: 'cancelled',
      })
    }
    return out
  }, [index, cancelledRows, pFrom, pTo, projectF, mode])

  // One row per broker.  Sales figures count live bookings only.
  const rows: BrokerRow[] = useMemo(() => {
    const m = new Map<string, BrokerRow & { _cust: Set<string> }>()
    for (const l of lines) {
      const k = l.broker_key
      const br = k === NONE ? null : brokerById[k]
      const r = m.get(k) || {
        key: k,
        name: k === NONE ? 'No broker linked' : (br?.name || 'Unknown broker'),
        code: k === NONE ? 'direct / not recorded' : (br?.broker_id || ''),
        phone: br?.phone || '',
        bookings: 0, customers: 0, sqyd: 0, value: 0, paid: 0, balance: 0, unknown: 0,
        emiLeft: 0, kistLeft: 0, late: 0, lateBookings: 0, cancelled: 0, cancelledValue: 0,
        earned: k === NONE ? 0 : (earnedBy[k] || 0),
        _cust: new Set<string>(),
      }
      if (l.status === 'cancelled') { r.cancelled++; r.cancelledValue += l.value }
      else {
        r.bookings++
        r._cust.add(l.customer_id || l.id)
        r.sqyd += l.sqyd
        r.value += l.value
        r.paid += l.paid
        r.balance += l.balance
        if (l.paidUnknown) r.unknown++
        r.emiLeft += l.emi?.amount_left || 0
        r.kistLeft += l.emi?.left || 0
        r.late += l.emi?.amount_overdue || 0
        if (l.status === 'inactive') r.lateBookings++
      }
      m.set(k, r)
    }
    const needle = q.trim().toLowerCase()
    const list: BrokerRow[] = [...m.values()]
      .map(({ _cust, ...r }) => ({ ...r, customers: _cust.size }))
      .filter(r => !needle || `${r.name} ${r.code} ${r.phone}`.toLowerCase().includes(needle))
    const by: Record<SortKey, (a: BrokerRow, b: BrokerRow) => number> = {
      value:    (a, b) => b.value - a.value,
      paid:     (a, b) => b.paid - a.paid,
      balance:  (a, b) => b.balance - a.balance,
      emiLeft:  (a, b) => b.emiLeft - a.emiLeft,
      late:     (a, b) => b.late - a.late,
      bookings: (a, b) => b.bookings - a.bookings,
      name:     (a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }),
    }
    return list.sort((a, b) => by[sortKey](a, b) || b.value - a.value)
  }, [lines, q, sortKey, brokerById, earnedBy])

  const total = useMemo(() => rows.reduce((t, r) => ({
    bookings: t.bookings + r.bookings, customers: t.customers + r.customers, sqyd: t.sqyd + r.sqyd,
    value: t.value + r.value, paid: t.paid + r.paid, balance: t.balance + r.balance, unknown: t.unknown + r.unknown,
    emiLeft: t.emiLeft + r.emiLeft, kistLeft: t.kistLeft + r.kistLeft, late: t.late + r.late,
    lateBookings: t.lateBookings + r.lateBookings, cancelled: t.cancelled + r.cancelled,
    cancelledValue: t.cancelledValue + r.cancelledValue, earned: t.earned + r.earned,
  }), { bookings: 0, customers: 0, sqyd: 0, value: 0, paid: 0, balance: 0, unknown: 0, emiLeft: 0, kistLeft: 0, late: 0, lateBookings: 0, cancelled: 0, cancelledValue: 0, earned: 0 }), [rows])

  const pct = (paid: number, value: number) => value > 0 ? Math.round((paid / value) * 100) : 0

  // ── The opened broker ──────────────────────────────────────────
  const opened = openKey ? rows.find(r => r.key === openKey) || null : null
  const openedLines = useMemo(() => openKey ? lines.filter(l => l.broker_key === openKey) : [], [lines, openKey])
  const statusCount = (s: Status) => s === 'all' ? openedLines.length : openedLines.filter(l => l.status === s).length
  const detailLines = useMemo(() => {
    const needle = custQ.trim().toLowerCase()
    return openedLines
      .filter(l => status === 'all' || l.status === status)
      .filter(l => !needle || `${l.customer_name} ${l.customer_code} ${l.phone} ${l.booking_no} ${l.plot_no}`.toLowerCase().includes(needle))
      // Worst first: the most money late at the top, then the newest sale.
      .sort((a, b) => (b.emi?.amount_overdue || 0) - (a.emi?.amount_overdue || 0) || b.date.localeCompare(a.date))
  }, [openedLines, status, custQ])
  const byProject = useMemo(() => {
    const m = new Map<string, { name: string; bookings: number; value: number; paid: number; late: number }>()
    for (const l of openedLines) {
      if (l.status === 'cancelled') continue
      const k = l.project_id || 'none'
      const cur = m.get(k) || { name: l.project_id ? (projectName[l.project_id] || '—') : 'No project', bookings: 0, value: 0, paid: 0, late: 0 }
      cur.bookings++; cur.value += l.value; cur.paid += l.paid
      if (l.status === 'inactive') cur.late++
      m.set(k, cur)
    }
    return [...m.values()].sort((a, b) => b.value - a.value)
  }, [openedLines, projectName])

  const openBroker = (key: string) => {
    const next = openKey === key ? null : key
    setOpenKey(next); setStatus('all'); setCustQ('')
    if (next) setTimeout(() => detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
  }

  // ── Words for what is on screen (printouts) ─────────────────
  const filterWords = (): string[] => {
    const f: string[] = []
    const periodLabel: Record<Period, string> = { all: 'All time', this_month: 'This month', last_month: 'Last month', this_fy: 'This financial year', custom: 'Chosen dates' }
    f.push(period === 'all' ? 'All time' : `${periodLabel[period]} (${pFrom || '…'} to ${pTo || '…'})`)
    if (projectF) f.push(`Project: ${projectName[projectF] || '—'}`)
    if (mode) f.push(mode === 'mlm' ? 'MLM only' : 'Traditional only')
    if (q.trim()) f.push(`Broker search: "${q.trim()}"`)
    return f
  }

  const exportBrokers = () => {
    const headers = ['Broker', 'Code', 'Bookings sold', 'Customers', 'Sq yd', 'Sale value', 'Collected', 'Collected %', 'Balance due', 'EMI still to come', 'Kist left', 'EMI late', 'Late bookings', 'Old, paid not entered', 'Cancelled', 'Commission earned']
    const body = rows.map(r => [r.name, r.code, r.bookings, r.customers, r.sqyd, r.value, r.paid, pct(r.paid, r.value), r.balance, r.emiLeft, r.kistLeft, r.late, r.lateBookings, r.unknown, r.cancelled, r.earned])
    const tot = ['Total', '', total.bookings, total.customers, total.sqyd, total.value, total.paid, pct(total.paid, total.value), total.balance, total.emiLeft, total.kistLeft, total.late, total.lateBookings, total.unknown, total.cancelled, total.earned]
    downloadCsv(`broker-sales-${todayLocalISO()}.csv`, [headers, ...body, tot])
  }
  const printBrokers = () => {
    printSimpleTable(
      { title: 'Broker sales', filters: filterWords(), note: total.unknown ? `${total.unknown} old booking(s) with paid-till-date not entered are left out of Balance due` : undefined },
      ['Broker', 'Sold', 'Sq yd', 'Sale value', 'Collected', 'Balance due', 'EMI still to come', 'EMI late', 'Cancelled'],
      rows.map(r => [`${r.name}${r.code ? ` (${r.code})` : ''}`, r.bookings, r.sqyd, formatINR(r.value), `${formatINR(r.paid)} · ${pct(r.paid, r.value)}%`, formatINR(r.balance), `${formatINR(r.emiLeft)} · ${r.kistLeft} kist`, r.late ? `${formatINR(r.late)} · ${r.lateBookings}` : '—', r.cancelled || '—']),
      ['Total', total.bookings, total.sqyd, formatINR(total.value), `${formatINR(total.paid)} · ${pct(total.paid, total.value)}%`, formatINR(total.balance), `${formatINR(total.emiLeft)} · ${total.kistLeft} kist`, total.late ? `${formatINR(total.late)} · ${total.lateBookings}` : '—', total.cancelled || '—'],
    )
  }
  const exportDetail = () => {
    if (!opened) return
    const headers = ['Customer', 'Customer code', 'Phone', 'Booking', 'Plot', 'Project', 'Booked on', 'Sale type', 'Status', 'Sale value', 'Collected', 'Balance', 'Kist paid', 'Kist total', 'EMI still to come', 'EMI late']
    const body = detailLines.map(l => [
      l.customer_name, l.customer_code, l.phone, l.booking_no, l.plot_no, l.project_id ? (projectName[l.project_id] || '') : '', l.date,
      l.commission_mode === 'traditional' ? 'Traditional' : 'MLM', STATUS_META[l.status].label,
      l.value, l.paidUnknown ? 'Not entered' : l.paid, l.paidUnknown || l.status === 'cancelled' ? '' : l.balance,
      l.emi?.paid ?? '', l.emi?.total ?? '', l.emi?.amount_left ?? '', l.emi?.amount_overdue ?? '',
    ])
    downloadCsv(`broker-${(opened.code || opened.name).replace(/[^\w-]+/g, '_')}-customers-${todayLocalISO()}.csv`, [headers, ...body])
  }
  const printDetail = () => {
    if (!opened) return
    printSimpleTable(
      { title: `${opened.name}${opened.code ? ` (${opened.code})` : ''} — customers`, filters: [...filterWords(), `Status: ${STATUS_META[status].label}`] },
      ['Customer', 'Booking / plot', 'Project', 'Status', 'Sale value', 'Collected', 'Balance', 'EMI'],
      detailLines.map(l => [
        `${l.customer_name}${l.phone ? ` · ${l.phone}` : ''}`, `${l.booking_no}${l.plot_no ? ` / ${l.plot_no}` : ''}`,
        l.project_id ? (projectName[l.project_id] || '—') : '—', STATUS_META[l.status].label,
        formatINR(l.value), l.status === 'cancelled' ? '—' : l.paidUnknown ? 'not entered' : formatINR(l.paid),
        l.status === 'cancelled' || l.paidUnknown ? '—' : formatINR(l.balance),
        l.emi ? `${l.emi.paid}/${l.emi.total} kist · ${formatINR(l.emi.amount_left)} to come${l.emi.overdue ? ` · ${formatINR(l.emi.amount_overdue)} late` : ''}` : 'no plan',
      ]),
      undefined, 4,
    )
  }

  const SortBtn = ({ k, children }: { k: SortKey; children: any }) => (
    <button onClick={() => setSortKey(k)} className={`inline-flex items-center gap-0.5 uppercase tracking-wide ${sortKey === k ? 'text-gray-900' : 'text-gray-500 hover:text-gray-800'}`}>
      {children}{sortKey === k && <ChevronDown size={11}/>}
    </button>
  )
  const wa = opened?.phone ? waLink(opened.phone, `Namaste ${opened.name}`) : null

  return (
    <div className="p-4 md:p-8 space-y-5 max-w-7xl mx-auto">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Broker sales</h1>
          <p className="text-sm text-gray-500 mt-0.5">Who sold how much, what has come in, and how much EMI is still to come. Tap a broker to see their customers.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={printBrokers} disabled={rows.length === 0}
            className="inline-flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg bg-white border border-gray-200 text-gray-700 hover:border-gray-400 disabled:opacity-40">
            <Printer size={14}/>Print
          </button>
          <button onClick={exportBrokers} disabled={rows.length === 0}
            className="inline-flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg bg-white border border-gray-200 text-gray-700 hover:border-gray-400 disabled:opacity-40">
            <Download size={14}/>CSV
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white border border-gray-200 rounded-xl p-3 flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"/>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Find a broker — name, code or phone"
            className="w-full pl-8 pr-8 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"/>
          {q && <button onClick={() => setQ('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700"><X size={13}/></button>}
        </div>
        <select value={period} onChange={e => setPeriod(e.target.value as Period)} className="border border-gray-200 rounded-lg px-3 py-2 text-sm">
          <option value="all">All time</option>
          <option value="this_month">Sold this month</option>
          <option value="last_month">Sold last month</option>
          <option value="this_fy">This financial year</option>
          <option value="custom">Choose dates…</option>
        </select>
        {period === 'custom' && (
          <span className="flex items-center gap-1.5">
            <input type="date" value={from} onChange={e => setFrom(e.target.value)} className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm"/>
            <span className="text-gray-400">–</span>
            <input type="date" value={to} onChange={e => setTo(e.target.value)} className="border border-gray-200 rounded-lg px-2 py-1.5 text-sm"/>
          </span>
        )}
        <select value={projectF} onChange={e => setProjectF(e.target.value)} className="border border-gray-200 rounded-lg px-3 py-2 text-sm">
          <option value="">All projects</option>
          {(projects as any[]).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <div className="inline-flex rounded-lg border border-gray-200 overflow-hidden text-xs">
          <button onClick={() => setMode('')} className={`px-3 py-2 ${mode === '' ? 'bg-gray-900 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'}`}>All sales</button>
          <button onClick={() => setMode('mlm')} className={`px-3 py-2 border-l border-gray-200 ${mode === 'mlm' ? 'bg-blue-600 text-white' : 'bg-white text-blue-700 hover:bg-blue-50'}`}>MLM</button>
          <button onClick={() => setMode('traditional')} className={`px-3 py-2 border-l border-gray-200 ${mode === 'traditional' ? 'bg-amber-600 text-white' : 'bg-white text-amber-700 hover:bg-amber-50'}`}>Traditional</button>
        </div>
      </div>

      {isLoading ? (
        <div className="py-16 text-center text-sm text-gray-400">Adding up every broker's book…</div>
      ) : (
        <>
          {/* Whole-business totals for the filters above */}
          <div className="grid grid-cols-2 lg:grid-cols-6 gap-3">
            <Tile icon={<TrendingUp size={14}/>} tone="blue" label="Sold" value={formatINR(total.value)}
              sub={`${total.bookings} booking${total.bookings === 1 ? '' : 's'}${total.sqyd ? ` · ${total.sqyd.toLocaleString('en-IN')} sq yd` : ''}`}/>
            <Tile icon={<Wallet size={14}/>} tone="emerald" label="Collected" value={formatINR(total.paid)} sub={`${pct(total.paid, total.value)}% of sold`}/>
            <Tile icon={<Users size={14}/>} tone="amber" label="Balance due" value={formatINR(total.balance)}
              sub={total.unknown ? `+ ${total.unknown} old, paid not entered` : 'still to come in'}/>
            <Tile icon={<Hourglass size={14}/>} tone="indigo" label="EMI still to come" value={formatINR(total.emiLeft)} sub={`${total.kistLeft} kist left`}/>
            <Tile icon={<AlertTriangle size={14}/>} tone={total.late > 0 ? 'rose' : 'gray'} label="EMI late" value={formatINR(total.late)} sub={`${total.lateBookings} booking${total.lateBookings === 1 ? '' : 's'} behind`}/>
            <Tile icon={<XCircle size={14}/>} tone="gray" label="Cancelled" value={String(total.cancelled)} sub={total.cancelled ? `${formatINR(total.cancelledValue)} not counted as sold` : 'none'}/>
          </div>

          {/* One row per broker */}
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between gap-2 flex-wrap">
              <h2 className="text-sm font-semibold text-gray-900">{rows.length} broker{rows.length === 1 ? '' : 's'}</h2>
              <label className="text-[12px] text-gray-500 inline-flex items-center gap-1.5 md:hidden">
                Sort
                <select value={sortKey} onChange={e => setSortKey(e.target.value as SortKey)} className="border border-gray-200 rounded-lg px-2 py-1 text-[12px]">
                  <option value="value">Most sold</option>
                  <option value="paid">Most collected</option>
                  <option value="balance">Highest balance</option>
                  <option value="emiLeft">Most EMI to come</option>
                  <option value="late">Most EMI late</option>
                  <option value="bookings">Most bookings</option>
                  <option value="name">Name A–Z</option>
                </select>
              </label>
            </div>

            {rows.length === 0 && <div className="px-4 py-10 text-center text-sm text-gray-400">No sales under these filters.</div>}

            {/* Phone: one card per broker */}
            <div className="md:hidden divide-y divide-gray-100">
              {rows.map(r => (
                <button key={r.key} onClick={() => openBroker(r.key)}
                  className={`w-full text-left px-4 py-3 ${openKey === r.key ? 'bg-blue-50/60' : 'hover:bg-gray-50'}`}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className={`font-semibold truncate ${r.key === NONE ? 'text-gray-500 italic' : 'text-gray-900'}`}>{r.name}</div>
                      <div className="text-[11px] text-gray-400 font-mono">{r.code}</div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="font-bold tabular-nums">{formatINR(r.value)}</div>
                      <div className="text-[11px] text-gray-500">{r.bookings} booking{r.bookings === 1 ? '' : 's'}{r.sqyd ? ` · ${r.sqyd.toLocaleString('en-IN')} sq yd` : ''}</div>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2 mt-2 text-[12px]">
                    <Mini label="Collected" value={formatINR(r.paid)} tone="text-emerald-700"/>
                    <Mini label="Balance" value={formatINR(r.balance)} tone="text-gray-900"/>
                    <Mini label="EMI to come" value={formatINR(r.emiLeft)} tone="text-indigo-700"/>
                  </div>
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {r.late > 0 && <span className="text-[11px] font-semibold text-rose-700 bg-rose-50 border border-rose-200 rounded-full px-2 py-0.5">{formatINR(r.late)} EMI late · {r.lateBookings}</span>}
                    {r.unknown > 0 && <span className="text-[11px] text-orange-800 bg-orange-50 border border-orange-200 rounded-full px-2 py-0.5">{r.unknown} old, paid not entered</span>}
                    {r.cancelled > 0 && <span className="text-[11px] text-slate-600 bg-slate-50 border border-slate-200 rounded-full px-2 py-0.5">{r.cancelled} cancelled</span>}
                  </div>
                </button>
              ))}
            </div>

            {/* Desktop: the table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-[11px] font-semibold">
                  <tr>
                    <th className="px-4 py-2.5 text-left"><SortBtn k="name">Broker</SortBtn></th>
                    <th className="px-3 py-2.5 text-right"><SortBtn k="bookings">Sold</SortBtn></th>
                    <th className="px-3 py-2.5 text-right"><SortBtn k="value">Sale value</SortBtn></th>
                    <th className="px-3 py-2.5 text-right"><SortBtn k="paid">Collected</SortBtn></th>
                    <th className="px-3 py-2.5 text-right"><SortBtn k="balance">Balance due</SortBtn></th>
                    <th className="px-3 py-2.5 text-right"><SortBtn k="emiLeft">EMI to come</SortBtn></th>
                    <th className="px-3 py-2.5 text-right"><SortBtn k="late">EMI late</SortBtn></th>
                    <th className="px-3 py-2.5 text-right text-gray-500 uppercase tracking-wide">Cancelled</th>
                    <th className="px-3 py-2.5 text-right text-gray-500 uppercase tracking-wide">Commission</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {rows.map(r => (
                    <tr key={r.key} onClick={() => openBroker(r.key)}
                      className={`cursor-pointer ${openKey === r.key ? 'bg-blue-50/60' : 'hover:bg-gray-50/70'}`}>
                      <td className="px-4 py-2.5">
                        <div className={`font-medium flex items-center gap-1 ${r.key === NONE ? 'text-gray-500 italic' : 'text-gray-900'}`}>
                          <ChevronRight size={13} className={`shrink-0 text-gray-400 transition-transform ${openKey === r.key ? 'rotate-90' : ''}`}/>{r.name}
                        </div>
                        <div className="text-[11px] text-gray-400 font-mono pl-[17px]">{r.code}</div>
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums">
                        {r.bookings}<div className="text-[11px] text-gray-400">{r.sqyd ? `${r.sqyd.toLocaleString('en-IN')} sq yd` : `${r.customers} cust.`}</div>
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums font-semibold">{formatINR(r.value)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-emerald-700">{formatINR(r.paid)}<div className="text-[11px] text-gray-400">{pct(r.paid, r.value)}%</div></td>
                      <td className="px-3 py-2.5 text-right tabular-nums">
                        {formatINR(r.balance)}
                        {r.unknown > 0 && <div className="text-[11px] text-orange-700" title="Old-register bookings whose paid-till-date is not entered">+{r.unknown} not entered</div>}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-indigo-700">{formatINR(r.emiLeft)}<div className="text-[11px] text-gray-400">{r.kistLeft} kist</div></td>
                      <td className="px-3 py-2.5 text-right tabular-nums">
                        {r.late > 0 ? <><span className="text-rose-600 font-semibold">{formatINR(r.late)}</span><div className="text-[11px] text-gray-400">{r.lateBookings} booking{r.lateBookings === 1 ? '' : 's'}</div></> : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{r.cancelled ? r.cancelled : <span className="text-gray-300">—</span>}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{r.earned > 0 ? formatINR(r.earned) : <span className="text-gray-300">—</span>}</td>
                    </tr>
                  ))}
                </tbody>
                {rows.length > 1 && (
                  <tfoot className="bg-gray-50 font-semibold border-t-2 border-gray-200">
                    <tr>
                      <td className="px-4 py-2.5">Total</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{total.bookings}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{formatINR(total.value)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-emerald-700">{formatINR(total.paid)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{formatINR(total.balance)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-indigo-700">{formatINR(total.emiLeft)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-rose-600">{total.late ? formatINR(total.late) : '—'}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{total.cancelled || '—'}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{total.earned ? formatINR(total.earned) : '—'}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>

          {/* The opened broker's customers */}
          <div ref={detailRef}>
            {opened && (
              <div className="bg-white border-2 border-blue-200 rounded-xl overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-100 flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-base font-bold text-gray-900">{opened.name}</h2>
                    <div className="text-xs text-gray-500 flex flex-wrap items-center gap-x-3 gap-y-1 mt-0.5">
                      <span className="font-mono">{opened.code}</span>
                      {opened.phone && <a href={`tel:${opened.phone}`} className="inline-flex items-center gap-1 text-blue-700 hover:underline"><Phone size={11}/>{opened.phone}</a>}
                      {wa && <a href={wa} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-emerald-700 hover:underline"><MessageCircle size={11}/>WhatsApp</a>}
                      {opened.key !== NONE && <Link to={`/brokers/${opened.key}`} className="inline-flex items-center gap-0.5 text-gray-600 hover:underline">Profile<ChevronRight size={11}/></Link>}
                      <Link to={`/customer-pipeline?broker=${opened.key}`} className="inline-flex items-center gap-0.5 text-gray-600 hover:underline">Open in Customer Pipeline<ChevronRight size={11}/></Link>
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={printDetail} disabled={detailLines.length === 0} className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-white border border-gray-200 text-gray-700 hover:border-gray-400 disabled:opacity-40"><Printer size={13}/>Print</button>
                    <button onClick={exportDetail} disabled={detailLines.length === 0} className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-white border border-gray-200 text-gray-700 hover:border-gray-400 disabled:opacity-40"><Download size={13}/>CSV</button>
                    <button onClick={() => setOpenKey(null)} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100" title="Close"><X size={15}/></button>
                  </div>
                </div>

                <div className="px-4 py-3 grid grid-cols-2 sm:grid-cols-4 gap-2 border-b border-gray-100">
                  <Mini label="Sold" value={`${formatINR(opened.value)} · ${opened.bookings}`} tone="text-gray-900"/>
                  <Mini label="Collected" value={`${formatINR(opened.paid)} · ${pct(opened.paid, opened.value)}%`} tone="text-emerald-700"/>
                  <Mini label="Balance due" value={formatINR(opened.balance)} tone="text-gray-900"/>
                  <Mini label="EMI to come / late" value={`${formatINR(opened.emiLeft)} / ${formatINR(opened.late)}`} tone="text-indigo-700"/>
                </div>

                <div className="px-4 py-3 flex flex-wrap items-center gap-2 border-b border-gray-100">
                  {(['all', 'active', 'inactive', 'cancelled'] as Status[]).map(s => (
                    <button key={s} onClick={() => setStatus(s)} title={STATUS_META[s].hint}
                      className={`text-xs px-3 py-1.5 rounded-full border inline-flex items-center gap-1 ${status === s
                        ? (s === 'inactive' ? 'bg-rose-600 border-rose-600 text-white' : s === 'active' ? 'bg-emerald-600 border-emerald-600 text-white' : 'bg-gray-900 border-gray-900 text-white')
                        : 'bg-white border-gray-200 text-gray-700 hover:border-gray-400'}`}>
                      {s === 'active' && <CheckCircle2 size={12}/>}{s === 'inactive' && <AlertTriangle size={12}/>}{s === 'cancelled' && <XCircle size={12}/>}
                      {STATUS_META[s].label} · {statusCount(s)}
                    </button>
                  ))}
                  <div className="relative ml-auto w-full sm:w-60">
                    <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400"/>
                    <input value={custQ} onChange={e => setCustQ(e.target.value)} placeholder="Customer, phone, plot…"
                      className="w-full pl-7 pr-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"/>
                  </div>
                </div>

                <div className="divide-y divide-gray-50">
                  {detailLines.length === 0 && <div className="px-4 py-8 text-center text-sm text-gray-400">Nobody in this list.</div>}
                  {detailLines.map(l => (
                    <div key={l.id} className="px-4 py-2.5 flex flex-wrap items-start gap-x-4 gap-y-1 text-sm">
                      <div className="min-w-[180px] flex-1">
                        <div className="font-medium text-gray-900 flex items-center gap-1.5">
                          {l.status === 'inactive' && <AlertTriangle size={12} className="text-rose-500 shrink-0"/>}
                          {l.status === 'cancelled' && <XCircle size={12} className="text-slate-400 shrink-0"/>}
                          {l.customer_name}
                        </div>
                        <div className="text-[11px] text-gray-400">
                          <span className="font-mono">{l.booking_no}</span>{l.plot_no ? ` · Plot ${l.plot_no}` : ''}
                          {l.project_id ? ` · ${projectName[l.project_id] || ''}` : ''}{l.date ? ` · ${formatDate(l.date)}` : ''}
                          {l.phone ? ` · ${l.phone}` : ''}
                        </div>
                      </div>
                      <div className="text-right tabular-nums w-28">
                        <div className="font-semibold">{formatINR(l.value)}</div>
                        <div className="text-[11px] text-gray-400">{l.status === 'cancelled' ? 'cancelled' : l.paidUnknown ? <span className="text-orange-700">paid not entered</span> : <>paid <span className="text-emerald-700">{formatINR(l.paid)}</span></>}</div>
                      </div>
                      <div className="text-right tabular-nums w-28">
                        {l.status === 'cancelled' || l.paidUnknown ? <span className="text-gray-300">—</span> : <><div>{formatINR(l.balance)}</div><div className="text-[11px] text-gray-400">balance</div></>}
                      </div>
                      <div className="text-right w-44 text-[12px]">
                        {!l.emi ? <span className="text-gray-300">no EMI plan</span>
                          : <>
                              <div className="text-indigo-700">{l.emi.paid}/{l.emi.total} kist · {formatINR(l.emi.amount_left)} to come</div>
                              {l.emi.overdue > 0 && <div className="text-rose-600 font-semibold">{l.emi.overdue} late · {formatINR(l.emi.amount_overdue)}</div>}
                            </>}
                      </div>
                      {l.status !== 'cancelled' && (
                        <Link to={`/customer-pipeline?booking=${l.id}`} className="text-xs text-blue-700 hover:underline self-center">Open</Link>
                      )}
                    </div>
                  ))}
                </div>

                {byProject.length > 0 && (
                  <div className="border-t border-gray-100 px-4 py-3">
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-gray-500 mb-2">Project wise</div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                      {byProject.map(p => (
                        <div key={p.name} className="rounded-lg border border-gray-100 px-3 py-2 text-[12px]">
                          <div className="font-medium text-gray-900">{p.name}</div>
                          <div className="text-gray-500 tabular-nums">{p.bookings} sold · {formatINR(p.value)} · collected <span className="text-emerald-700">{formatINR(p.paid)}</span>{p.late ? <span className="text-rose-600"> · {p.late} late</span> : ''}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}

const TONES: Record<string, string> = {
  gray:    'bg-white border-gray-200 text-gray-900',
  blue:    'bg-blue-50/50 border-blue-200 text-blue-900',
  indigo:  'bg-indigo-50/50 border-indigo-200 text-indigo-900',
  emerald: 'bg-emerald-50/50 border-emerald-200 text-emerald-900',
  amber:   'bg-amber-50/50 border-amber-200 text-amber-900',
  rose:    'bg-rose-50/50 border-rose-200 text-rose-900',
}

function Tile({ icon, label, value, sub, tone }: { icon: any; label: string; value: string; sub: string; tone: string }) {
  return (
    <div className={`border rounded-xl p-3.5 ${TONES[tone] || TONES.gray}`}>
      <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide opacity-70">{icon}{label}</div>
      <div className="text-lg font-bold mt-1 tabular-nums">{value}</div>
      <div className="text-[11px] opacity-60 mt-0.5">{sub}</div>
    </div>
  )
}

function Mini({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-gray-400">{label}</div>
      <div className={`font-semibold tabular-nums ${tone}`}>{value}</div>
    </div>
  )
}
