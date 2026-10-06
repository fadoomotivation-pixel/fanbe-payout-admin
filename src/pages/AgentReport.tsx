// Broker Sales — "kis broker ne kitna maal becha, kitna paisa aaya, kitni EMI baaki hai,
// company ne kitna de diya".
//
// Four tabs, one per question on the office's list:
//   Overview      one row per broker ID: sold, collected, balance, EMI to come / late.
//                 Chips split the IDs: active (sold something), no sale, EMI late.
//   Customers     every customer across all brokers — Active / Inactive (EMI late) /
//                 Cancelled — filtered by broker and project.
//   Project wise  the same money, per project.
//   Company paid  per broker: commission earned, what the company has already paid
//                 (payouts + advances), and what is still owed — with the advance list.
//
// Sales figures come from the Customer Pipeline's own index (lib/pipelineIndex) and the
// money owed to brokers from the broker wallet (lib/payoutEngine loadBrokerWallets), the
// same functions those pages use, so no number here can disagree with them.
//   - an old-register booking whose paid-till-date is not entered has an unknown balance:
//     counted on its own, kept out of "balance due" (lib/bookingMath);
//   - cancelled bookings are not sales: own column, never in "sold" or "balance".
// Bookings with no broker linked get their own row so the totals are the whole business.
import { useMemo, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { formatINR, formatDate } from '@/lib/utils'
import { bookingValue } from '@/lib/bookingMath'
import { fetchPipelineIndex, type IndexRow } from '@/lib/pipelineIndex'
import { loadBrokerWallets, isAdvanceHead, type BrokerWallet } from '@/lib/payoutEngine'
import { fetchAllRows, todayLocalISO } from '@/lib/fetchAll'
import { downloadCsv } from '@/lib/download'
import { printSimpleTable } from '@/lib/printTemplates'
import { waLink } from '@/lib/whatsapp'
import {
  Search, Users, AlertTriangle, XCircle, CheckCircle2, Wallet, TrendingUp, Hourglass,
  Phone, MessageCircle, Download, Printer, ChevronRight, ChevronDown, X, Building2, Banknote,
} from 'lucide-react'

const NONE = '__none__'

type View = 'overview' | 'customers' | 'projects' | 'paid'
type Period = 'all' | 'this_month' | 'last_month' | 'this_fy' | 'custom'
type SortKey = 'value' | 'paid' | 'balance' | 'emiLeft' | 'late' | 'bookings' | 'name'
type Status = 'all' | 'active' | 'inactive' | 'cancelled'
type IdFilter = 'all' | 'sold' | 'nosale' | 'late'

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

type Money = {
  bookings: number; customers: number; sqyd: number; value: number; paid: number; balance: number
  unknown: number; emiLeft: number; kistLeft: number; late: number; lateBookings: number
  cancelled: number; cancelledValue: number
}

type BrokerRow = Money & { key: string; name: string; code: string; phone: string; earned: number }

const STATUS_META: Record<Status, { label: string; hint: string }> = {
  all:       { label: 'All',                 hint: 'every booking' },
  active:    { label: 'Active',              hint: 'paying, or nothing past its due date' },
  inactive:  { label: 'Inactive (EMI late)', hint: 'an instalment is past its date and unpaid' },
  cancelled: { label: 'Cancelled',           hint: 'booking cancelled' },
}

const emptyMoney = (): Money => ({ bookings: 0, customers: 0, sqyd: 0, value: 0, paid: 0, balance: 0, unknown: 0, emiLeft: 0, kistLeft: 0, late: 0, lateBookings: 0, cancelled: 0, cancelledValue: 0 })

// Adds booking lines into a money summary.  The one place sold / collected / balance /
// EMI are summed, used by the broker rows, the project rows and the totals alike.
function summarise(lines: BookingLine[]): Money {
  const m = emptyMoney()
  const cust = new Set<string>()
  for (const l of lines) {
    if (l.status === 'cancelled') { m.cancelled++; m.cancelledValue += l.value; continue }
    m.bookings++
    cust.add(l.customer_id || l.id)
    m.sqyd += l.sqyd
    m.value += l.value
    m.paid += l.paid
    m.balance += l.balance
    if (l.paidUnknown) m.unknown++
    m.emiLeft += l.emi?.amount_left || 0
    m.kistLeft += l.emi?.left || 0
    m.late += l.emi?.amount_overdue || 0
    if (l.status === 'inactive') m.lateBookings++
  }
  m.customers = cust.size
  return m
}

// Booking date as the office means it: the application form date, else the day entered.
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

const pct = (paid: number, value: number) => value > 0 ? Math.round((paid / value) * 100) : 0

export default function AgentReport() {
  const [view, setView]       = useState<View>('overview')
  const [q, setQ]             = useState('')
  const [period, setPeriod]   = useState<Period>('all')
  const [from, setFrom]       = useState('')
  const [to, setTo]           = useState('')
  const [projectF, setProjectF] = useState('')
  const [mode, setMode]       = useState<'' | 'mlm' | 'traditional'>('')
  const [sortKey, setSortKey] = useState<SortKey>('value')
  const [idFilter, setIdFilter] = useState<IdFilter>('all')
  const [openKey, setOpenKey] = useState<string | null>(null)
  const [status, setStatus]   = useState<Status>('all')
  const [custQ, setCustQ]     = useState('')
  const [custBroker, setCustBroker] = useState('')
  const [paidBroker, setPaidBroker] = useState('')
  const detailRef = useRef<HTMLDivElement>(null)

  // Same query key as the Customer Pipeline, so the two pages share one load and one truth.
  const { data: index = [], isLoading } = useQuery<IndexRow[]>({
    queryKey: ['cp_index'],
    queryFn: fetchPipelineIndex,
    staleTime: 30_000,
  })

  // The pipeline index leaves cancelled bookings out; here they are their own column.
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

  // Earned / paid / pending / advance / still owed — the broker wallet every payout page uses.
  const { data: wallets = {} } = useQuery<Record<string, BrokerWallet>>({
    queryKey: ['agent_report_wallets'],
    queryFn: loadBrokerWallets,
  })

  // Money handed to brokers through Expenses: the Advance head (counted in the wallet) and
  // anything else attributed to a broker (listed, so nothing paid is invisible).
  const { data: brokerExpenses = [] } = useQuery({
    queryKey: ['agent_report_broker_expenses'],
    queryFn: () => fetchAllRows((f, t) => supabase.from('expenses')
      .select('id, broker_id, amount, expense_date, payment_mode, reference_no, item_name, description, paid_by, expense_heads(name)')
      .not('broker_id', 'is', null).order('id').range(f, t)),
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
  const nameOf = (key: string) => key === NONE ? 'No broker linked' : (brokerById[key]?.name || 'Unknown broker')
  const codeOf = (key: string) => key === NONE ? 'direct / not recorded' : (brokerById[key]?.broker_id || '')

  const [pFrom, pTo] = periodRange(period, from, to)

  // Every booking as one line, live and cancelled, with period / project / sale type applied.
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

  const linesByBroker = useMemo(() => {
    const m = new Map<string, BookingLine[]>()
    for (const l of lines) { const a = m.get(l.broker_key); a ? a.push(l) : m.set(l.broker_key, [l]) }
    return m
  }, [lines])

  // One row per broker ID — every registered broker, so an ID with no sale shows as such,
  // plus the no-broker row when there are such bookings.
  const allRows: BrokerRow[] = useMemo(() => {
    const keys = new Set<string>([...(brokers as any[]).map(b => b.id), ...linesByBroker.keys()])
    return [...keys].map(k => ({
      key: k, name: nameOf(k), code: codeOf(k), phone: k === NONE ? '' : (brokerById[k]?.phone || ''),
      earned: k === NONE ? 0 : (wallets[k]?.earned || 0),
      ...summarise(linesByBroker.get(k) || []),
    }))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brokers, linesByBroker, brokerById, wallets])

  const idCounts = useMemo(() => {
    const ids = allRows.filter(r => r.key !== NONE)
    return {
      all: ids.length,
      sold: ids.filter(r => r.bookings > 0).length,
      nosale: ids.filter(r => r.bookings === 0).length,
      late: ids.filter(r => r.lateBookings > 0).length,
    }
  }, [allRows])

  const rows: BrokerRow[] = useMemo(() => {
    const needle = q.trim().toLowerCase()
    const list = allRows
      .filter(r => idFilter === 'all' ? (r.bookings > 0 || r.cancelled > 0 || r.key !== NONE)
        : idFilter === 'sold' ? r.bookings > 0
        : idFilter === 'nosale' ? r.key !== NONE && r.bookings === 0
        : r.lateBookings > 0)
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
    return list.sort((a, b) => by[sortKey](a, b) || b.value - a.value || a.name.localeCompare(b.name))
  }, [allRows, q, sortKey, idFilter])

  // Business totals for the period / project / sale-type filters (independent of the ID chips).
  const total = useMemo(() => ({ ...summarise(lines), earned: allRows.reduce((s, r) => s + r.earned, 0) }), [lines, allRows])

  // ── Overview: the opened broker ────────────────────────────────
  const opened = openKey ? allRows.find(r => r.key === openKey) || null : null
  const openedLines = useMemo(() => openKey ? (linesByBroker.get(openKey) || []) : [], [linesByBroker, openKey])
  const statusCount = (list: BookingLine[], s: Status) => s === 'all' ? list.length : list.filter(l => l.status === s).length
  const sortWorstFirst = (a: BookingLine, b: BookingLine) =>
    (b.emi?.amount_overdue || 0) - (a.emi?.amount_overdue || 0) || b.date.localeCompare(a.date)
  const matchCustomer = (l: BookingLine, needle: string) =>
    !needle || `${l.customer_name} ${l.customer_code} ${l.phone} ${l.booking_no} ${l.plot_no}`.toLowerCase().includes(needle)
  const detailLines = useMemo(() => {
    const needle = custQ.trim().toLowerCase()
    return openedLines.filter(l => (status === 'all' || l.status === status) && matchCustomer(l, needle)).sort(sortWorstFirst)
  }, [openedLines, status, custQ])

  const openBroker = (key: string) => {
    const next = openKey === key ? null : key
    setOpenKey(next); setStatus('all'); setCustQ('')
    if (next) setTimeout(() => detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50)
  }

  // ── Customers tab ──────────────────────────────────────────────
  const custScope = useMemo(() => custBroker ? lines.filter(l => l.broker_key === custBroker) : lines, [lines, custBroker])
  const custLines = useMemo(() => {
    const needle = custQ.trim().toLowerCase()
    return custScope.filter(l => (status === 'all' || l.status === status) && matchCustomer(l, needle)).sort(sortWorstFirst)
  }, [custScope, status, custQ])
  const custSummary = useMemo(() => summarise(custScope), [custScope])

  // ── Project wise ───────────────────────────────────────────────
  const projectRows = useMemo(() => {
    const m = new Map<string, BookingLine[]>()
    for (const l of lines) { const k = l.project_id || 'none'; const a = m.get(k); a ? a.push(l) : m.set(k, [l]) }
    return [...m.entries()].map(([k, ls]) => ({
      key: k, name: k === 'none' ? 'No project' : (projectName[k] || '—'),
      brokers: new Set(ls.filter(l => l.status !== 'cancelled' && l.broker_key !== NONE).map(l => l.broker_key)).size,
      ...summarise(ls),
    })).sort((a, b) => b.value - a.value)
  }, [lines, projectName])

  // ── Company paid ───────────────────────────────────────────────
  const advanceList = useMemo(() => (brokerExpenses as any[])
    .map(e => ({
      id: e.id, broker_key: e.broker_id as string, date: e.expense_date || '', amount: Number(e.amount || 0),
      head: e.expense_heads?.name || '—', isAdvance: isAdvanceHead(e.expense_heads?.name),
      mode: e.payment_mode || '', ref: e.reference_no || '', note: e.item_name || e.description || '', paid_by: e.paid_by || '',
    }))
    .sort((a, b) => b.date.localeCompare(a.date)), [brokerExpenses])
  const otherExpenseBy = useMemo(() => {
    const m: Record<string, number> = {}
    for (const e of advanceList) if (!e.isAdvance) m[e.broker_key] = (m[e.broker_key] || 0) + e.amount
    return m
  }, [advanceList])
  const paidRows = useMemo(() => {
    const keys = new Set<string>([...(brokers as any[]).map(b => b.id), ...Object.keys(wallets), ...advanceList.map(e => e.broker_key)])
    const needle = q.trim().toLowerCase()
    return [...keys].map(k => {
      const w = wallets[k] || { earned: 0, paid: 0, pending: 0, advance: 0, available: 0 }
      const other = otherExpenseBy[k] || 0
      return {
        key: k, name: nameOf(k), code: codeOf(k),
        earned: w.earned, paidOut: w.paid, pending: w.pending, advance: w.advance, other,
        // Everything that has actually left the company towards this broker.
        totalPaid: w.paid + w.advance + other,
        owed: w.available,
      }
    })
      .filter(r => r.earned || r.paidOut || r.pending || r.advance || r.other)
      .filter(r => !needle || `${r.name} ${r.code}`.toLowerCase().includes(needle))
      .sort((a, b) => b.totalPaid - a.totalPaid || b.earned - a.earned)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [brokers, wallets, advanceList, otherExpenseBy, q, brokerById])
  const paidTotal = useMemo(() => paidRows.reduce((t, r) => ({
    earned: t.earned + r.earned, paidOut: t.paidOut + r.paidOut, pending: t.pending + r.pending,
    advance: t.advance + r.advance, other: t.other + r.other, totalPaid: t.totalPaid + r.totalPaid, owed: t.owed + r.owed,
  }), { earned: 0, paidOut: 0, pending: 0, advance: 0, other: 0, totalPaid: 0, owed: 0 }), [paidRows])
  const advanceShown = useMemo(() => paidBroker ? advanceList.filter(e => e.broker_key === paidBroker) : advanceList, [advanceList, paidBroker])

  // ── Printouts and files ────────────────────────────────────────
  const filterWords = (): string[] => {
    const f: string[] = []
    const periodLabel: Record<Period, string> = { all: 'All time', this_month: 'This month', last_month: 'Last month', this_fy: 'This financial year', custom: 'Chosen dates' }
    f.push(period === 'all' ? 'All time' : `${periodLabel[period]} (${pFrom || '…'} to ${pTo || '…'})`)
    if (projectF) f.push(`Project: ${projectName[projectF] || '—'}`)
    if (mode) f.push(mode === 'mlm' ? 'MLM only' : 'Traditional only')
    return f
  }
  const stamp = todayLocalISO()

  const exportBrokers = () => {
    const headers = ['Broker', 'Code', 'Bookings sold', 'Customers', 'Sq yd', 'Sale value', 'Collected', 'Collected %', 'Balance due', 'EMI still to come', 'Kist left', 'EMI late', 'Late bookings', 'Old, paid not entered', 'Cancelled', 'Commission earned']
    const body = rows.map(r => [r.name, r.code, r.bookings, r.customers, r.sqyd, r.value, r.paid, pct(r.paid, r.value), r.balance, r.emiLeft, r.kistLeft, r.late, r.lateBookings, r.unknown, r.cancelled, r.earned])
    downloadCsv(`broker-sales-${stamp}.csv`, [headers, ...body])
  }
  const printBrokers = () => printSimpleTable(
    { title: 'Broker sales', filters: [...filterWords(), `IDs: ${ID_LABEL[idFilter]}`] },
    ['Broker', 'Sold', 'Sq yd', 'Sale value', 'Collected', 'Balance due', 'EMI still to come', 'EMI late', 'Cancelled'],
    rows.map(r => [`${r.name}${r.code ? ` (${r.code})` : ''}`, r.bookings, r.sqyd, formatINR(r.value), `${formatINR(r.paid)} · ${pct(r.paid, r.value)}%`, formatINR(r.balance), `${formatINR(r.emiLeft)} · ${r.kistLeft} kist`, r.late ? `${formatINR(r.late)} · ${r.lateBookings}` : '—', r.cancelled || '—']),
  )
  const customerCsv = (list: BookingLine[], name: string) => {
    const headers = ['Broker', 'Broker code', 'Customer', 'Customer code', 'Phone', 'Booking', 'Plot', 'Project', 'Booked on', 'Sale type', 'Status', 'Sale value', 'Collected', 'Balance', 'Kist paid', 'Kist total', 'EMI still to come', 'EMI late']
    const body = list.map(l => [
      nameOf(l.broker_key), codeOf(l.broker_key), l.customer_name, l.customer_code, l.phone, l.booking_no, l.plot_no,
      l.project_id ? (projectName[l.project_id] || '') : '', l.date, l.commission_mode === 'traditional' ? 'Traditional' : 'MLM',
      STATUS_META[l.status].label, l.value, l.paidUnknown ? 'Not entered' : l.paid, l.paidUnknown || l.status === 'cancelled' ? '' : l.balance,
      l.emi?.paid ?? '', l.emi?.total ?? '', l.emi?.amount_left ?? '', l.emi?.amount_overdue ?? '',
    ])
    downloadCsv(`${name}-${stamp}.csv`, [headers, ...body])
  }
  const customerPrint = (list: BookingLine[], title: string, extra: string[]) => printSimpleTable(
    { title, filters: [...filterWords(), ...extra] },
    ['Customer', 'Broker', 'Booking / plot', 'Project', 'Status', 'Sale value', 'Collected', 'Balance', 'EMI'],
    list.map(l => [
      `${l.customer_name}${l.phone ? ` · ${l.phone}` : ''}`, nameOf(l.broker_key), `${l.booking_no}${l.plot_no ? ` / ${l.plot_no}` : ''}`,
      l.project_id ? (projectName[l.project_id] || '—') : '—', STATUS_META[l.status].label,
      formatINR(l.value), l.status === 'cancelled' ? '—' : l.paidUnknown ? 'not entered' : formatINR(l.paid),
      l.status === 'cancelled' || l.paidUnknown ? '—' : formatINR(l.balance),
      l.emi ? `${l.emi.paid}/${l.emi.total} kist · ${formatINR(l.emi.amount_left)} to come${l.emi.overdue ? ` · ${formatINR(l.emi.amount_overdue)} late` : ''}` : 'no plan',
    ]),
    undefined, 5,
  )
  const exportProjects = () => {
    const headers = ['Project', 'Brokers', 'Bookings sold', 'Customers', 'Sq yd', 'Sale value', 'Collected', 'Balance due', 'EMI still to come', 'EMI late', 'Late bookings', 'Cancelled']
    downloadCsv(`project-wise-${stamp}.csv`, [headers, ...projectRows.map(p => [p.name, p.brokers, p.bookings, p.customers, p.sqyd, p.value, p.paid, p.balance, p.emiLeft, p.late, p.lateBookings, p.cancelled])])
  }
  const printProjects = () => printSimpleTable(
    { title: 'Project wise sales', filters: filterWords() },
    ['Project', 'Brokers', 'Sold', 'Sale value', 'Collected', 'Balance due', 'EMI still to come', 'EMI late', 'Cancelled'],
    projectRows.map(p => [p.name, p.brokers, p.bookings, formatINR(p.value), `${formatINR(p.paid)} · ${pct(p.paid, p.value)}%`, formatINR(p.balance), formatINR(p.emiLeft), p.late ? `${formatINR(p.late)} · ${p.lateBookings}` : '—', p.cancelled || '—']),
  )
  const exportPaid = () => {
    const headers = ['Broker', 'Code', 'Commission earned', 'Paid out (payouts)', 'Advance given', 'Other paid via expenses', 'Total company paid', 'Payout requested (pending)', 'Still to pay']
    downloadCsv(`company-paid-${stamp}.csv`, [headers, ...paidRows.map(r => [r.name, r.code, r.earned, r.paidOut, r.advance, r.other, r.totalPaid, r.pending, r.owed])])
  }
  const exportAdvances = () => {
    const headers = ['Date', 'Broker', 'Code', 'Head', 'Amount', 'Mode', 'Reference', 'Paid by', 'Note']
    downloadCsv(`broker-advances-${stamp}.csv`, [headers, ...advanceShown.map(e => [e.date, nameOf(e.broker_key), codeOf(e.broker_key), e.head, e.amount, e.mode, e.ref, e.paid_by, e.note])])
  }
  const printPaid = () => printSimpleTable(
    { title: 'Company paid to brokers', filters: [`As on ${formatDate(stamp)}`] },
    ['Broker', 'Commission earned', 'Paid out', 'Advance', 'Other', 'Total paid', 'Pending request', 'Still to pay'],
    paidRows.map(r => [`${r.name}${r.code ? ` (${r.code})` : ''}`, formatINR(r.earned), formatINR(r.paidOut), formatINR(r.advance), formatINR(r.other), formatINR(r.totalPaid), formatINR(r.pending), formatINR(r.owed)]),
    ['Total', formatINR(paidTotal.earned), formatINR(paidTotal.paidOut), formatINR(paidTotal.advance), formatINR(paidTotal.other), formatINR(paidTotal.totalPaid), formatINR(paidTotal.pending), formatINR(paidTotal.owed)],
  )

  const SortBtn = ({ k, children }: { k: SortKey; children: any }) => (
    <button onClick={() => setSortKey(k)} className={`inline-flex items-center gap-0.5 uppercase tracking-wide ${sortKey === k ? 'text-gray-900' : 'text-gray-500 hover:text-gray-800'}`}>
      {children}{sortKey === k && <ChevronDown size={11}/>}
    </button>
  )
  const wa = opened?.phone ? waLink(opened.phone, `Namaste ${opened.name}`) : null
  const brokerOptions = useMemo(() => allRows.filter(r => r.bookings > 0 || r.cancelled > 0).sort((a, b) => a.name.localeCompare(b.name)), [allRows])

  const TABS: { key: View; label: string; icon: any }[] = [
    { key: 'overview',  label: 'Overview',     icon: TrendingUp },
    { key: 'customers', label: 'Customers',    icon: Users },
    { key: 'projects',  label: 'Project wise', icon: Building2 },
    { key: 'paid',      label: 'Company paid', icon: Banknote },
  ]

  return (
    <div className="p-4 md:p-8 space-y-5 max-w-7xl mx-auto">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Broker sales</h1>
        <p className="text-sm text-gray-500 mt-0.5">Who sold how much, what has come in, how much EMI is still to come, and what the company has already paid each broker.</p>
      </div>

      {/* The four questions, one tab each */}
      <div className="flex gap-1 overflow-x-auto bg-gray-100 p-1 rounded-xl w-full sm:w-fit">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setView(t.key)}
            className={`inline-flex items-center gap-1.5 whitespace-nowrap px-3.5 py-2 rounded-lg text-sm font-medium transition ${view === t.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-600 hover:text-gray-900'}`}>
            <t.icon size={14}/>{t.label}
          </button>
        ))}
      </div>

      {/* Filters shared by every tab */}
      <div className="bg-white border border-gray-200 rounded-xl p-3 flex flex-wrap gap-2 items-center">
        {(view === 'overview' || view === 'paid') && (
          <div className="relative flex-1 min-w-[200px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"/>
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Find a broker — name, code or phone"
              className="w-full pl-8 pr-8 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"/>
            {q && <button onClick={() => setQ('')} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700"><X size={13}/></button>}
          </div>
        )}
        {view !== 'paid' && (
          <>
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
          </>
        )}
        {view === 'paid' && <span className="text-[12px] text-gray-500">All amounts are lifetime, as on today.</span>}
      </div>

      {isLoading ? (
        <div className="py-16 text-center text-sm text-gray-400">Adding up every broker's book…</div>
      ) : view === 'overview' ? (
        <>
          <Totals total={total}/>

          {/* Which IDs to show */}
          <div className="flex flex-wrap gap-2">
            {(['all', 'sold', 'nosale', 'late'] as IdFilter[]).map(k => (
              <button key={k} onClick={() => setIdFilter(k)}
                className={`px-3.5 py-2 rounded-xl border text-left transition ${idFilter === k ? 'bg-gray-900 border-gray-900 text-white' : 'bg-white border-gray-200 text-gray-700 hover:border-gray-400'}`}>
                <div className="text-[11px] font-semibold uppercase tracking-wide opacity-80">{ID_LABEL[k]}</div>
                <div className="text-lg font-bold leading-tight tabular-nums">{idCounts[k]}</div>
              </button>
            ))}
          </div>

          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between gap-2 flex-wrap">
              <h2 className="text-sm font-semibold text-gray-900">{rows.length} row{rows.length === 1 ? '' : 's'} · tap a broker to see their customers</h2>
              <div className="flex items-center gap-2">
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
                <ActionButtons onPrint={printBrokers} onCsv={exportBrokers} disabled={rows.length === 0}/>
              </div>
            </div>

            {rows.length === 0 && <div className="px-4 py-10 text-center text-sm text-gray-400">No brokers in this list.</div>}

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
                      <div className="text-[11px] text-gray-500">{r.bookings ? `${r.bookings} booking${r.bookings === 1 ? '' : 's'}${r.sqyd ? ` · ${r.sqyd.toLocaleString('en-IN')} sq yd` : ''}` : 'no sale'}</div>
                    </div>
                  </div>
                  {r.bookings > 0 && (
                    <div className="grid grid-cols-3 gap-2 mt-2 text-[12px]">
                      <Mini label="Collected" value={formatINR(r.paid)} tone="text-emerald-700"/>
                      <Mini label="Balance" value={formatINR(r.balance)} tone="text-gray-900"/>
                      <Mini label="EMI to come" value={formatINR(r.emiLeft)} tone="text-indigo-700"/>
                    </div>
                  )}
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
                        {r.bookings || <span className="text-gray-300">0</span>}<div className="text-[11px] text-gray-400">{r.sqyd ? `${r.sqyd.toLocaleString('en-IN')} sq yd` : r.bookings ? `${r.customers} cust.` : 'no sale'}</div>
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
              </table>
            </div>
          </div>

          {/* The opened broker */}
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
                    <ActionButtons small disabled={detailLines.length === 0}
                      onPrint={() => customerPrint(detailLines, `${opened.name}${opened.code ? ` (${opened.code})` : ''} — customers`, [`Status: ${STATUS_META[status].label}`])}
                      onCsv={() => customerCsv(detailLines, `broker-${(opened.code || opened.name).replace(/[^\w-]+/g, '_')}-customers`)}/>
                    <button onClick={() => setOpenKey(null)} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100" title="Close"><X size={15}/></button>
                  </div>
                </div>

                <div className="px-4 py-3 grid grid-cols-2 sm:grid-cols-4 gap-2 border-b border-gray-100">
                  <Mini label="Sold" value={`${formatINR(opened.value)} · ${opened.bookings}`} tone="text-gray-900"/>
                  <Mini label="Collected" value={`${formatINR(opened.paid)} · ${pct(opened.paid, opened.value)}%`} tone="text-emerald-700"/>
                  <Mini label="Balance due" value={formatINR(opened.balance)} tone="text-gray-900"/>
                  <Mini label="EMI to come / late" value={`${formatINR(opened.emiLeft)} / ${formatINR(opened.late)}`} tone="text-indigo-700"/>
                  {opened.key !== NONE && wallets[opened.key] && (
                    <>
                      <Mini label="Commission earned" value={formatINR(wallets[opened.key].earned)} tone="text-gray-900"/>
                      <Mini label="Company paid" value={formatINR(wallets[opened.key].paid + wallets[opened.key].advance + (otherExpenseBy[opened.key] || 0))} tone="text-emerald-700"/>
                      <Mini label="of which advance" value={formatINR(wallets[opened.key].advance)} tone="text-amber-700"/>
                      <Mini label="Still to pay" value={formatINR(wallets[opened.key].available)} tone="text-indigo-700"/>
                    </>
                  )}
                </div>

                <StatusChips list={openedLines} status={status} setStatus={setStatus} count={statusCount} q={custQ} setQ={setCustQ}/>
                <CustomerList lines={detailLines} projectName={projectName}/>
              </div>
            )}
          </div>
        </>
      ) : view === 'customers' ? (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <Tile icon={<Users size={14}/>} tone="gray" label="Total customers" value={String(custSummary.customers)} sub={`${custSummary.bookings} live booking${custSummary.bookings === 1 ? '' : 's'}`}/>
            <Tile icon={<CheckCircle2 size={14}/>} tone="emerald" label="Active" value={String(statusCount(custScope, 'active'))} sub="paying / nothing late"/>
            <Tile icon={<AlertTriangle size={14}/>} tone={custSummary.lateBookings ? 'rose' : 'gray'} label="Inactive (EMI late)" value={String(custSummary.lateBookings)} sub={`${formatINR(custSummary.late)} late`}/>
            <Tile icon={<XCircle size={14}/>} tone="gray" label="Cancelled" value={String(custSummary.cancelled)} sub={custSummary.cancelled ? formatINR(custSummary.cancelledValue) : 'none'}/>
          </div>
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 flex flex-wrap items-center gap-2 justify-between">
              <select value={custBroker} onChange={e => setCustBroker(e.target.value)} className="border border-gray-200 rounded-lg px-3 py-2 text-sm min-w-[220px]">
                <option value="">All brokers</option>
                {brokerOptions.map(b => <option key={b.key} value={b.key}>{b.name}{b.key !== NONE && b.code ? ` [${b.code}]` : ''} · {b.bookings + b.cancelled}</option>)}
              </select>
              <ActionButtons disabled={custLines.length === 0}
                onPrint={() => customerPrint(custLines, 'Customers', [custBroker ? `Broker: ${nameOf(custBroker)}` : 'All brokers', `Status: ${STATUS_META[status].label}`])}
                onCsv={() => customerCsv(custLines, 'customers-by-broker')}/>
            </div>
            <StatusChips list={custScope} status={status} setStatus={setStatus} count={statusCount} q={custQ} setQ={setCustQ}/>
            <CustomerList lines={custLines} projectName={projectName} showBroker nameOf={nameOf}/>
          </div>
        </>
      ) : view === 'projects' ? (
        <>
          <Totals total={total}/>
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-gray-900">{projectRows.length} project{projectRows.length === 1 ? '' : 's'} with sales</h2>
              <ActionButtons onPrint={printProjects} onCsv={exportProjects} disabled={projectRows.length === 0}/>
            </div>
            {projectRows.length === 0 && <div className="px-4 py-10 text-center text-sm text-gray-400">No sales under these filters.</div>}
            <div className="divide-y divide-gray-50">
              {projectRows.map(p => (
                <div key={p.key} className="px-4 py-3 flex flex-wrap items-start gap-x-6 gap-y-2">
                  <div className="min-w-[180px] flex-1">
                    <div className="font-semibold text-gray-900">{p.name}</div>
                    <div className="text-[11px] text-gray-500">{p.bookings} sold · {p.customers} customers · {p.brokers} broker{p.brokers === 1 ? '' : 's'}{p.sqyd ? ` · ${p.sqyd.toLocaleString('en-IN')} sq yd` : ''}</div>
                  </div>
                  <div className="grid grid-cols-2 sm:grid-cols-5 gap-x-5 gap-y-1 text-[12px]">
                    <Mini label="Sale value" value={formatINR(p.value)} tone="text-gray-900"/>
                    <Mini label="Collected" value={`${formatINR(p.paid)} · ${pct(p.paid, p.value)}%`} tone="text-emerald-700"/>
                    <Mini label="Balance" value={formatINR(p.balance)} tone="text-gray-900"/>
                    <Mini label="EMI to come" value={formatINR(p.emiLeft)} tone="text-indigo-700"/>
                    <Mini label="EMI late" value={p.late ? `${formatINR(p.late)} · ${p.lateBookings}` : '—'} tone={p.late ? 'text-rose-600' : 'text-gray-400'}/>
                  </div>
                  <button onClick={() => { setProjectF(p.key === 'none' ? '' : p.key); setCustBroker(''); setStatus('all'); setView('customers') }}
                    className="text-xs text-blue-700 hover:underline self-center">Customers →</button>
                </div>
              ))}
            </div>
          </div>
        </>
      ) : (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            <Tile icon={<TrendingUp size={14}/>} tone="blue" label="Commission earned" value={formatINR(paidTotal.earned)} sub="credited to brokers, after TDS + admin"/>
            <Tile icon={<Banknote size={14}/>} tone="emerald" label="Company already paid" value={formatINR(paidTotal.totalPaid)} sub="payouts + advances + other"/>
            <Tile icon={<Wallet size={14}/>} tone="amber" label="Advance given" value={formatINR(paidTotal.advance)} sub="Advance-head expenses"/>
            <Tile icon={<Hourglass size={14}/>} tone="gray" label="Requested, not paid" value={formatINR(paidTotal.pending)} sub="withdrawals / cycle lines open"/>
            <Tile icon={<AlertTriangle size={14}/>} tone="indigo" label="Still to pay" value={formatINR(paidTotal.owed)} sub="earned − paid − requested − advance"/>
          </div>

          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-gray-900">Per broker</h2>
              <ActionButtons onPrint={printPaid} onCsv={exportPaid} disabled={paidRows.length === 0}/>
            </div>
            {paidRows.length === 0 && <div className="px-4 py-10 text-center text-sm text-gray-400">No commission earned or paid yet.</div>}
            <div className="overflow-x-auto">
              {paidRows.length > 0 && (
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 text-[11px] font-semibold text-gray-500 uppercase tracking-wide">
                    <tr>
                      <th className="px-4 py-2.5 text-left">Broker</th>
                      <th className="px-3 py-2.5 text-right">Earned</th>
                      <th className="px-3 py-2.5 text-right">Paid out</th>
                      <th className="px-3 py-2.5 text-right">Advance</th>
                      <th className="px-3 py-2.5 text-right">Other</th>
                      <th className="px-3 py-2.5 text-right">Total paid</th>
                      <th className="px-3 py-2.5 text-right">Requested</th>
                      <th className="px-3 py-2.5 text-right">Still to pay</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {paidRows.map(r => (
                      <tr key={r.key} className={`cursor-pointer ${paidBroker === r.key ? 'bg-blue-50/60' : 'hover:bg-gray-50/70'}`} onClick={() => setPaidBroker(paidBroker === r.key ? '' : r.key)}>
                        <td className="px-4 py-2.5"><div className="font-medium text-gray-900">{r.name}</div><div className="text-[11px] text-gray-400 font-mono">{r.code}</div></td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{formatINR(r.earned)}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-emerald-700">{formatINR(r.paidOut)}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-amber-700">{formatINR(r.advance)}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{r.other ? formatINR(r.other) : <span className="text-gray-300">—</span>}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums font-semibold">{formatINR(r.totalPaid)}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{r.pending ? formatINR(r.pending) : <span className="text-gray-300">—</span>}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-indigo-700 font-semibold">{formatINR(r.owed)}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot className="bg-gray-50 font-semibold border-t-2 border-gray-200">
                    <tr>
                      <td className="px-4 py-2.5">Total</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{formatINR(paidTotal.earned)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-emerald-700">{formatINR(paidTotal.paidOut)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-amber-700">{formatINR(paidTotal.advance)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{formatINR(paidTotal.other)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{formatINR(paidTotal.totalPaid)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{formatINR(paidTotal.pending)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-indigo-700">{formatINR(paidTotal.owed)}</td>
                    </tr>
                  </tfoot>
                </table>
              )}
            </div>
            <p className="px-4 py-2 text-[11px] text-gray-500 border-t border-gray-100">
              "Other" is money booked under another expense head with this broker attached (e.g. Payout). It counts as paid here, but only advances reduce "Still to pay" — record a broker payment as a withdrawal so the wallet sees it.
            </p>
          </div>

          {/* The advance list */}
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h2 className="text-sm font-semibold text-gray-900">Agent advance list{paidBroker ? ` · ${nameOf(paidBroker)}` : ''}</h2>
                <p className="text-[11px] text-gray-500">Every expense paid to a broker. Tap a broker above to see only theirs. Add new ones on the Expenses page (head "Advance", pick the broker).</p>
              </div>
              <div className="flex items-center gap-2">
                {paidBroker && <button onClick={() => setPaidBroker('')} className="text-xs text-gray-600 underline">Show all</button>}
                <ActionButtons onCsv={exportAdvances} disabled={advanceShown.length === 0}/>
              </div>
            </div>
            {advanceShown.length === 0 && <div className="px-4 py-8 text-center text-sm text-gray-400">No advance or broker expense recorded.</div>}
            <div className="divide-y divide-gray-50">
              {advanceShown.map(e => (
                <div key={e.id} className="px-4 py-2.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                  <div className="w-24 text-[12px] text-gray-500 tabular-nums">{formatDate(e.date)}</div>
                  <div className="flex-1 min-w-[160px]">
                    <div className="font-medium text-gray-900">{nameOf(e.broker_key)} <span className="text-[11px] text-gray-400 font-mono">{codeOf(e.broker_key)}</span></div>
                    <div className="text-[11px] text-gray-500">{e.note || '—'}{e.paid_by ? ` · by ${e.paid_by}` : ''}</div>
                  </div>
                  <span className={`text-[11px] px-2 py-0.5 rounded-full border ${e.isAdvance ? 'bg-amber-50 border-amber-200 text-amber-800' : 'bg-gray-50 border-gray-200 text-gray-600'}`}>{e.head}</span>
                  <div className="text-[12px] text-gray-500 w-28">{(e.mode || '—').toUpperCase()}{e.ref ? ` · ${e.ref}` : ''}</div>
                  <div className="w-28 text-right font-semibold tabular-nums">{formatINR(e.amount)}</div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

const ID_LABEL: Record<IdFilter, string> = {
  all: 'All IDs', sold: 'Active IDs (sold)', nosale: 'No sale yet', late: 'IDs with EMI late',
}

function Totals({ total }: { total: Money & { earned: number } }) {
  return (
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
  )
}

function ActionButtons({ onPrint, onCsv, disabled, small }: { onPrint?: () => void; onCsv: () => void; disabled?: boolean; small?: boolean }) {
  const cls = `inline-flex items-center gap-1.5 ${small ? 'text-xs px-3 py-1.5' : 'text-sm px-3 py-2'} rounded-lg bg-white border border-gray-200 text-gray-700 hover:border-gray-400 disabled:opacity-40`
  return (
    <div className="flex gap-2">
      {onPrint && <button onClick={onPrint} disabled={disabled} className={cls}><Printer size={13}/>Print</button>}
      <button onClick={onCsv} disabled={disabled} className={cls}><Download size={13}/>CSV</button>
    </div>
  )
}

function StatusChips({ list, status, setStatus, count, q, setQ }: {
  list: BookingLine[]; status: Status; setStatus: (s: Status) => void
  count: (list: BookingLine[], s: Status) => number; q: string; setQ: (v: string) => void
}) {
  return (
    <div className="px-4 py-3 flex flex-wrap items-center gap-2 border-b border-gray-100">
      {(['all', 'active', 'inactive', 'cancelled'] as Status[]).map(s => (
        <button key={s} onClick={() => setStatus(s)} title={STATUS_META[s].hint}
          className={`text-xs px-3 py-1.5 rounded-full border inline-flex items-center gap-1 ${status === s
            ? (s === 'inactive' ? 'bg-rose-600 border-rose-600 text-white' : s === 'active' ? 'bg-emerald-600 border-emerald-600 text-white' : 'bg-gray-900 border-gray-900 text-white')
            : 'bg-white border-gray-200 text-gray-700 hover:border-gray-400'}`}>
          {s === 'active' && <CheckCircle2 size={12}/>}{s === 'inactive' && <AlertTriangle size={12}/>}{s === 'cancelled' && <XCircle size={12}/>}
          {STATUS_META[s].label} · {count(list, s)}
        </button>
      ))}
      <div className="relative ml-auto w-full sm:w-60">
        <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400"/>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Customer, phone, plot…"
          className="w-full pl-7 pr-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"/>
      </div>
    </div>
  )
}

function CustomerList({ lines, projectName, showBroker, nameOf }: { lines: BookingLine[]; projectName: Record<string, string>; showBroker?: boolean; nameOf?: (k: string) => string }) {
  return (
    <div className="divide-y divide-gray-50">
      {lines.length === 0 && <div className="px-4 py-8 text-center text-sm text-gray-400">Nobody in this list.</div>}
      {lines.map(l => (
        <div key={l.id} className="px-4 py-2.5 flex flex-wrap items-start gap-x-4 gap-y-1 text-sm">
          <div className="min-w-[180px] flex-1">
            <div className="font-medium text-gray-900 flex items-center gap-1.5">
              {l.status === 'inactive' && <AlertTriangle size={12} className="text-rose-500 shrink-0"/>}
              {l.status === 'cancelled' && <XCircle size={12} className="text-slate-400 shrink-0"/>}
              {l.customer_name}
            </div>
            <div className="text-[11px] text-gray-400">
              {showBroker && nameOf && <span className="text-gray-600">{nameOf(l.broker_key)} · </span>}
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
