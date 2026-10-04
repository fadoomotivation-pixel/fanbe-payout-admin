import { useMemo, useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/Button.tsx'
import { Input, Select } from '@/components/ui/Input.tsx'
import { Modal } from '@/components/ui/Modal.tsx'
import { Badge } from '@/components/ui/Badge.tsx'
import { formatINR, formatDate } from '@/lib/utils'
import { distributePaymentCommission } from '@/lib/payoutEngine'
import { findUtrConflict, utrConflictMessage } from '@/lib/utr'
import { printApplicationForm, printApplicationForms, printPaymentReceipt, printEmiCards, printPipelineRegister, printCustomerStatement } from '@/lib/printTemplates'
import { getCurrentUserId } from '@/lib/closure'
import { bookingValue, sumVerified, balanceOf, collectionPct } from '@/lib/bookingMath'
import { waLink } from '@/lib/whatsapp'
import { fetchEmiStatus, fetchEmiSchedules } from '@/lib/emiStatus'
import { fetchPipelineIndex, emiDueByToday, type IndexRow, type Bucket } from '@/lib/pipelineIndex'
import { inChunks, todayLocalISO } from '@/lib/fetchAll'
import { deleteBookingSafely } from '@/lib/deleteBooking'
import DeleteBookingModal from '@/components/DeleteBookingModal'
import EmiPanel from '@/components/EmiPanel'
import { Users, Search, Filter, ChevronRight, Banknote, Calculator, ArrowUpRight, CheckCircle2, AlertTriangle, Coins, Phone, MessageCircle, IndianRupee, X, ExternalLink, FileText, Printer, Pencil, Landmark, ScrollText, CalendarClock, Trash2, SlidersHorizontal, Download, ListOrdered, Hourglass, Tag } from 'lucide-react'
import toast from 'react-hot-toast'

// 'today' and 'all' plus one tab per bucket from lib/pipelineIndex — every booking sits in
// exactly one bucket, so the bucket tiles add up to "All".
type Tab = 'all' | 'today' | Bucket
const TAB_VALUES: Tab[] = ['all', 'today', 'not_started', 'token_only', 'balance_no_plan', 'emi_running', 'emi_overdue', 'settled', 'price_missing']
// Older links (Analytics used to send ?tab=emi_active) still land on the right list.
const LEGACY_TAB: Record<string, Tab> = { emi_active: 'emi_running', unpaid_booking: 'token_only' }

const TAB_LABEL: Record<Tab, string> = {
  all: 'All customers', today: "Today's work", not_started: 'No payment yet', token_only: 'Token only',
  balance_no_plan: 'Balance, no EMI plan', emi_running: 'EMI running', emi_overdue: 'EMI overdue',
  settled: 'Fully settled', price_missing: 'Price not set',
}
const EMPTY_TEXT: Record<Tab, string> = {
  today: '✓ Nothing due today. No EMI, no cheque to bank, no registry waiting.',
  all: 'No customers match. Clear a filter or the search.',
  not_started: '✓ Every booking here has at least one payment.',
  token_only: '✓ No deals waiting on the booking deposit.',
  balance_no_plan: '✓ Every balance here has an EMI plan to collect it.',
  emi_running: 'No running EMI plans under these filters.',
  emi_overdue: '✓ Nobody here is late on an EMI.',
  settled: 'No fully settled deals under these filters.',
  price_missing: '✓ Every booking here has a price.',
}

type SortKey = 'newest' | 'oldest' | 'balance' | 'overdue' | 'next_due' | 'name' | 'kist_left'
type DueWindow = '' | 'overdue' | 'today' | 'week' | 'month' | 'no_plan'

const STAGE_COLORS: Record<string, string> = {
  token_received: 'bg-orange-50 text-orange-700 border-orange-200',
  booking_done:   'bg-green-50 text-green-700 border-green-200',
  cancelled:      'bg-red-50 text-red-700 border-red-200',
}

const PAYMENT_MODES = ['cash','neft','rtgs','imps','upi','cheque','dd']

// Local calendar date.  toISOString() is UTC, which in India is still yesterday until 05:30.
const today = () => todayLocalISO()

const PAGE_SIZE = 25
const SEARCH_DEBOUNCE_MS = 300

// How the data is split:
//   - one light index of EVERY booking (lib/pipelineIndex) drives tabs, tiles, search,
//     filters, sort and the printouts — so they all describe the whole book;
//   - the heavy detail (receipts, commission, cheques, upline) is fetched only for the 25
//     rows on screen.
// The previous version paginated on the server and then counted the tiles from the 25 rows
// it had, which is why the tiles read 0 / 0 / 0 beside "877 customers".  The index is a few
// hundred bytes a booking, so it stays quick well past ten thousand bookings; fetchAllRows
// pages past PostgREST's 1,000-row cap so nothing is silently cut off.
export default function CustomerPipeline() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  // Customer focus — when present, the page renders a customer-aggregate header at the
  // top and filters the bookings list to just this customer's deals.  This is the entry
  // point that replaces the deleted /customer-history page; old /customer-history?customer=X
  // links redirect here in App.tsx.
  // One refresh for everything this page shows.  Each action used to invalidate its own
  // hand-picked keys, and two of them named keys that did not exist ('cp_bookings'), so
  // the list kept showing the old state after a payment until the page was reloaded.
  const refreshPipeline = () => qc.invalidateQueries({
    predicate: q => typeof q.queryKey[0] === 'string' && (q.queryKey[0] as string).startsWith('cp_'),
  })
  const customerFocusId = searchParams.get('customer')
  const [tab, setTab] = useState<Tab>(() => {
    const t = searchParams.get('tab') || ''
    return LEGACY_TAB[t] || (TAB_VALUES.includes(t as Tab) ? (t as Tab) : 'all')
  })
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [searchScope, setSearchScope] = useState<'all' | 'customer' | 'broker' | 'booking' | 'plot'>('all')
  const [filterBroker, setFilterBroker] = useState('')
  const [filterProject, setFilterProject] = useState('')
  // MLM and traditional sales pay commission by completely different rules, and with 806
  // traditional against 71 MLM the MLM customers were impossible to find in one list.
  const [filterMode, setFilterMode] = useState<'' | 'mlm' | 'traditional'>('')
  // The finer filters live behind "More filters" so the everyday bar stays four controls.
  const [showMore, setShowMore]     = useState(false)
  const [dueWindow, setDueWindow]   = useState<DueWindow>('')
  const [registryF, setRegistryF]   = useState<'' | 'ready' | 'done' | 'not_done'>('')
  const [stageF, setStageF]         = useState<'' | 'token_received' | 'booking_done'>('')
  const [bookedFrom, setBookedFrom] = useState('')
  const [bookedTo, setBookedTo]     = useState('')
  const [minBalance, setMinBalance] = useState('')
  const [sortBy, setSortBy]         = useState<SortKey>('newest')
  const [page, setPage] = useState(0)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [emiBooking, setEmiBooking] = useState<any>(null)
  const [payFor, setPayFor] = useState<{ booking: any; type: 'token' | 'booking' } | null>(null)
  const [editCustomer, setEditCustomer] = useState<any>(null)
  const [chequeFor, setChequeFor] = useState<any>(null)
  const [registryFor, setRegistryFor] = useState<any>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [printing, setPrinting] = useState(false)
  const [deleteFor, setDeleteFor] = useState<any>(null)

  // Fetch the focused customer's profile + aggregate stats across ALL their bookings.
  // This is the data that used to live on the deleted /customer-history page — it gives
  // admin a "total picture" of the customer (cost, paid, outstanding, overdue) so they
  // don't have to mentally sum across multiple booking rows.
  const { data: customerFocus, isFetched: customerFocusFetched } = useQuery({
    queryKey: ['cp_customer_focus', customerFocusId],
    enabled: !!customerFocusId,
    queryFn: async () => {
      const [{ data: c }, { data: bks }] = await Promise.all([
        supabase.from('bp_customers').select('id, customer_code, previous_customer_code, name, phone, email, address, father_or_husband_name, pan, dob, nominee_name, nominee_relation').eq('id', customerFocusId!).maybeSingle(),
        supabase.from('bp_bookings').select('id, booking_no, total_amount, plot_total_price, total_collected, stage').eq('customer_id', customerFocusId!),
      ])
      // A cancelled booking is not owed: counting its price in "total cost" showed the
      // customer owing the whole value of a deal that no longer exists.
      const live = (bks || []).filter((b: any) => b.stage !== 'cancelled')
      const bookingIds = live.map((b: any) => b.id)
      // EMI comes from the shared rule.  This used to select booking_id off
      // emi_installments — a column that table does not have — so the query failed and
      // "Overdue EMI" in this header always read ₹0.
      const [{ data: pays }, emiByBooking] = await Promise.all([
        bookingIds.length
          ? supabase.from('bp_payments').select('amount, verification_status, booking_id').in('booking_id', bookingIds)
          : Promise.resolve({ data: [] as any[] }),
        fetchEmiStatus(bookingIds),
      ])
      const totalCost   = live.reduce((s: number, b: any) => s + bookingValue(b), 0)
      const paid        = sumVerified(pays as any[])
      const emiList     = Object.values(emiByBooking)
      const overdueAmt  = emiList.reduce((s, e) => s + e.amount_overdue, 0)
      const overdueCnt  = emiList.reduce((s, e) => s + e.overdue, 0)
      return {
        customer: c,
        bookingCount: live.length,
        totalCost,
        paid,
        outstanding: balanceOf(totalCost, paid),
        collectionPct: collectionPct(totalCost, paid),
        overdueAmt,
        overdueCnt,
      }
    },
  })

  const clearCustomerFocus = () => {
    const next = new URLSearchParams(searchParams)
    next.delete('customer')
    setSearchParams(next, { replace: true })
  }

  // Debounce the search input so we don't fire a query on every keystroke.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [search])

  // Reset to page 0 whenever any filter changes — current page may not exist in the new result set.
  useEffect(() => { setPage(0) }, [tab, debouncedSearch, searchScope, filterBroker, filterProject, filterMode, dueWindow, registryF, stageF, bookedFrom, bookedTo, minBalance, sortBy, customerFocusId])

  // Drop the print selection when the list underneath it changes.  Keeping it would show
  // "5 selected" while only the 2 still on screen could actually be printed.
  useEffect(() => { setSelected(new Set()) }, [tab, debouncedSearch, searchScope, filterBroker, filterProject, filterMode, dueWindow, registryF, stageF, bookedFrom, bookedTo, minBalance, sortBy, customerFocusId, page])

  // ── Every booking, once ────────────────────────────────────────────
  // Tabs, tiles, search, filters and sort all run over this index, so they cover the whole
  // book.  They used to run over the 25 rows on screen, which is why the tiles read
  // 0 / 0 / 0 next to "877 customers" and a tab could never find anyone on page 2.
  const { data: index = [], isLoading: indexLoading, isError: indexError } = useQuery<IndexRow[]>({
    queryKey: ['cp_index'],
    queryFn: fetchPipelineIndex,
    staleTime: 30_000,
  })
  const indexById = useMemo(() => {
    const m: Record<string, IndexRow> = {}
    for (const r of index) m[r.id] = r
    return m
  }, [index])

  // Cheques due to bank today or earlier.  The only part of "today's work" that is not in
  // the index: EMI and registry are read off the index rows (same rules as everywhere).
  const { data: chequeDueIds = new Set<string>() } = useQuery<Set<string>>({
    queryKey: ['cp_today_cheques'],
    queryFn: async () => {
      const { data, error } = await supabase.from('bp_pdc_cheques')
        .select('booking_id').in('status', ['pending', 'deposited']).lte('cheque_date', today())
      if (error) throw error
      return new Set(((data || []) as any[]).map(c => c.booking_id).filter(Boolean))
    },
  })

  const t0 = today()
  const isToday = (r: IndexRow) => emiDueByToday(r, t0) || chequeDueIds.has(r.id) || r.readyForRegistry

  // Everything except the tab, so each tile shows what it holds under the current filters.
  const narrowed = useMemo(() => {
    const needle = debouncedSearch.toLowerCase()
    const digits = needle.replace(/\D/g, '')
    const weekEnd  = (() => { const d = new Date(); d.setDate(d.getDate() + 7); return todayLocalISO(d) })()
    const monthEnd = (() => { const d = new Date(); return todayLocalISO(new Date(d.getFullYear(), d.getMonth() + 1, 0)) })()
    const minBal = Number(minBalance) || 0
    return index.filter(r => {
      if (customerFocusId && r.customer_id !== customerFocusId) return false
      if (filterBroker  && r.broker_id  !== filterBroker)  return false
      if (filterProject && r.project_id !== filterProject) return false
      if (filterMode === 'traditional' && r.commission_mode !== 'traditional') return false
      if (filterMode === 'mlm' && r.commission_mode === 'traditional') return false
      if (stageF && r.stage !== stageF) return false
      if (registryF === 'ready'    && !r.readyForRegistry) return false
      if (registryF === 'done'     && !r.registryDone)     return false
      if (registryF === 'not_done' && r.registryDone)      return false
      const booked = r.application_date || (r.created_at || '').slice(0, 10)
      if (bookedFrom && booked < bookedFrom) return false
      if (bookedTo   && booked > bookedTo)   return false
      if (minBal > 0 && r.balance < minBal) return false
      if (dueWindow) {
        const next = r.emi?.next_due || ''
        if (dueWindow === 'no_plan') { if (r.emi || r.balance <= 0) return false }
        else if (!r.emi || r.emi.left === 0) return false
        else if (dueWindow === 'overdue' && !(r.emi.overdue > 0)) return false
        else if (dueWindow === 'today'   && !(next && next <= t0)) return false
        else if (dueWindow === 'week'    && !(next && next <= weekEnd)) return false
        else if (dueWindow === 'month'   && !(next && next <= monthEnd)) return false
      }
      if (needle) {
        const inCustomer = () =>
          r.customer_name.toLowerCase().includes(needle) ||
          r.customer_code.toLowerCase().includes(needle) ||
          r.previous_customer_code.toLowerCase().includes(needle) ||
          // Phones are matched on digits so "98765 43210" and "+91 9876543210" both hit.
          (digits.length >= 3 && r.customer_phone.replace(/\D/g, '').includes(digits))
        const inBroker  = () => r.broker_name.toLowerCase().includes(needle) || r.broker_code.toLowerCase().includes(needle)
        const inBooking = () => r.booking_no.toLowerCase().includes(needle) || (r.legacy_booking_no || '').toLowerCase().includes(needle)
        const inPlot    = () => r.plot_no.toLowerCase().includes(needle)
        const hit =
          searchScope === 'customer' ? inCustomer()
        : searchScope === 'broker'   ? inBroker()
        : searchScope === 'booking'  ? inBooking()
        : searchScope === 'plot'     ? inPlot()
        : inCustomer() || inBroker() || inBooking() || inPlot()
        if (!hit) return false
      }
      return true
    })
  }, [index, customerFocusId, filterBroker, filterProject, filterMode, stageF, registryF, bookedFrom, bookedTo, minBalance, dueWindow, debouncedSearch, searchScope, t0])

  // Tile counts and money, from the same narrowed list the tabs filter.
  const counts = useMemo(() => {
    const c: Record<string, { n: number; value: number; balance: number; overdue: number }> = {}
    const add = (k: string, r: IndexRow) => {
      const x = (c[k] ??= { n: 0, value: 0, balance: 0, overdue: 0 })
      x.n++; x.value += r.value; x.balance += r.balance; x.overdue += r.emi?.amount_overdue || 0
    }
    let todayEmi = 0, todayCheque = 0, todayRegistry = 0
    for (const r of narrowed) {
      add('all', r)
      add(r.bucket, r)
      if (isToday(r)) {
        add('today', r)
        if (emiDueByToday(r, t0)) todayEmi++
        if (chequeDueIds.has(r.id)) todayCheque++
        if (r.readyForRegistry) todayRegistry++
      }
    }
    const get = (k: string) => c[k] || { n: 0, value: 0, balance: 0, overdue: 0 }
    return { get, todayEmi, todayCheque, todayRegistry }
  }, [narrowed, chequeDueIds, t0])

  const sorted = useMemo(() => {
    const list = tab === 'all' ? narrowed
      : tab === 'today' ? narrowed.filter(isToday)
      : narrowed.filter(r => r.bucket === tab)
    const out = [...list]
    const far = '9999-12-31'
    switch (sortBy) {
      case 'oldest':    out.sort((a, b) => a.created_at.localeCompare(b.created_at)); break
      case 'balance':   out.sort((a, b) => b.balance - a.balance); break
      case 'overdue':   out.sort((a, b) => (b.emi?.amount_overdue || 0) - (a.emi?.amount_overdue || 0) || b.balance - a.balance); break
      case 'next_due':  out.sort((a, b) => (a.emi?.next_due || far).localeCompare(b.emi?.next_due || far)); break
      case 'name':      out.sort((a, b) => a.customer_name.localeCompare(b.customer_name, 'en', { sensitivity: 'base' })); break
      case 'kist_left': out.sort((a, b) => (b.emi?.left || 0) - (a.emi?.left || 0)); break
      default:          out.sort((a, b) => b.created_at.localeCompare(a.created_at))
    }
    return out
  }, [narrowed, tab, sortBy, chequeDueIds, t0])

  const totalBookings = sorted.length
  const totalPages = Math.max(1, Math.ceil(totalBookings / PAGE_SIZE))
  const pageIds = useMemo(() => sorted.slice(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE).map(r => r.id), [sorted, page])
  // A payment or an EMI can move rows out of the current tab; if that empties the last page,
  // step back to the new last page instead of showing an empty list.
  useEffect(() => { if (page > totalPages - 1) setPage(totalPages - 1) }, [page, totalPages])

  // Full rows — receipts, upline, cheques, deed — only for the page on screen.
  const { data: pageRows = [], isLoading: pageLoading } = useQuery({
    queryKey: ['cp_page_detail', pageIds],
    enabled: pageIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('bp_bookings')
        .select(`
          id, booking_no, legacy_booking_no, stage, application_date, total_amount, plot_total_price,
          token_amount, booking_amount, full_payment_amount,
          expected_booking_amount, commission_amount, commission_rate,
          commission_mode, traditional_commission_pct, traditional_commission_per_sqyd, traditional_pay_upline,
          broker_id, customer_id, plot_id, project_id, closed_at,
          registry_date, registry_doc_no, registry_office, registry_completed_at,
          bp_customers(id, customer_code, name, phone),
          bp_plots(plot_no, size_sqyd, sector, block),
          bp_projects(name, location),
          brokers(name, broker_id, rank),
          bp_booking_plots(plot_id)
        `)
        .in('id', pageIds)
      if (error) throw error
      return data || []
    },
  })
  // Kept in the order the index sorted them; .in() returns rows in any order.
  const bookings = useMemo(() => {
    const byId: Record<string, any> = {}
    for (const b of pageRows as any[]) byId[b.id] = b
    return pageIds.map(id => byId[id]).filter(Boolean)
  }, [pageRows, pageIds])
  const isLoading = indexLoading || (pageIds.length > 0 && pageLoading)

  const bookingIds = useMemo(() => bookings.map((b: any) => b.id), [bookings])

  // Also carries the latest receipt's UTR / receipt no / mode / amount.  Admin asked for
  // these on the row itself: the reference is what a customer quotes on the phone and what
  // a bank line is matched against, and having to expand a row to see it made every such
  // check a two-step job.
  const { data: paymentsByBooking = {} } = useQuery<Record<string, { token: number; booking: number; emi: number; full: number; total: number; last_date: string | null; last_utr: string | null; last_receipt: string | null; last_mode: string | null; last_amount: number; count: number }>>({
    queryKey: ['cp_payments', bookingIds],
    enabled: bookingIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('bp_payments')
        .select('booking_id, amount, payment_type, payment_date, verification_status, utr_ref, receipt_no, payment_mode, created_at')
        .in('booking_id', bookingIds)
        .eq('verification_status', 'verified')
      if (error) throw error
      const m: Record<string, any> = {}
      for (const p of (data || [])) {
        if (!p.booking_id) continue
        if (!m[p.booking_id]) m[p.booking_id] = { token: 0, booking: 0, emi: 0, full: 0, total: 0, last_date: null, last_utr: null, last_receipt: null, last_mode: null, last_amount: 0, count: 0, _lastKey: '' }
        const row = m[p.booking_id]
        const amt = Number(p.amount || 0)
        row.total += amt
        row.count += 1
        if (p.payment_type === 'token')        row.token   += amt
        if (p.payment_type === 'booking')      row.booking += amt
        if (p.payment_type === 'emi')          row.emi     += amt
        if (p.payment_type === 'full_payment' || p.payment_type === 'full') row.full += amt
        if (!row.last_date || (p.payment_date && p.payment_date > row.last_date)) {
          row.last_date = p.payment_date
        }
        // Latest receipt by date, falling back to created_at so same-day payments still
        // resolve to the one actually entered last.
        const key = `${p.payment_date || ''}|${p.created_at || ''}`
        if (key >= row._lastKey) {
          row._lastKey     = key
          row.last_utr     = p.utr_ref || null
          row.last_receipt = p.receipt_no || null
          row.last_mode    = p.payment_mode || null
          row.last_amount  = amt
        }
      }
      return m
    },
  })

  // Post-dated cheques held against each booking.  Shown on the row because "kitne cheque
  // pade hain aur agla kab hai" is a question admin was answering by opening another page.
  const { data: pdcByBooking = {} } = useQuery<Record<string, { open: number; next: string | null; overdue: number; openAmount: number }>>({
    queryKey: ['cp_pdc', bookingIds],
    enabled: bookingIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('bp_pdc_cheques')
        .select('booking_id, cheque_date, amount, status')
        .in('booking_id', bookingIds)
      if (error) throw error
      const todayStr = today()
      const m: Record<string, any> = {}
      for (const c of (data || [])) {
        if (!c.booking_id) continue
        if (!m[c.booking_id]) m[c.booking_id] = { open: 0, next: null, overdue: 0, openAmount: 0 }
        // Only cheques still on file are actionable.  bp_pdc_cheques_status_check allows
        // pending / deposited / cleared / bounced / cancelled; the last three are history
        // and must not be counted as money still sitting in the drawer.
        if (c.status !== 'pending' && c.status !== 'deposited') continue
        const row = m[c.booking_id]
        row.open += 1
        row.openAmount += Number(c.amount || 0)
        if (c.cheque_date && c.cheque_date < todayStr) row.overdue += 1
        if (c.cheque_date && (!row.next || c.cheque_date < row.next)) row.next = c.cheque_date
      }
      return m
    },
  })

  const { data: mlmByBooking = {} } = useQuery<Record<string, { rows: number; net: number }>>({
    queryKey: ['cp_mlm', bookingIds],
    enabled: bookingIds.length > 0,
    queryFn: async () => {
      const { data } = await supabase
        .from('payout_distributions')
        .select('booking_id, net_payout')
        .in('booking_id', bookingIds)
      const m: Record<string, any> = {}
      for (const d of (data || [])) {
        if (!d.booking_id) continue
        if (!m[d.booking_id]) m[d.booking_id] = { rows: 0, net: 0 }
        m[d.booking_id].rows++
        m[d.booking_id].net += Number(d.net_payout || 0)
      }
      return m
    },
  })

  // Brokers + sponsor chain for upline display
  const { data: brokerChains = {} } = useQuery<Record<string, { id: string; name: string; broker_id: string; rank: string }[]>>({
    queryKey: ['cp_broker_chains'],
    queryFn: async () => {
      const [{ data: brokers }, { data: tree }] = await Promise.all([
        supabase.from('brokers').select('id, name, broker_id, rank, sponsor_id'),
        supabase.from('sponsor_tree').select('descendant_id, ancestor_id, depth'),
      ])
      const lookup: Record<string, any> = {}
      for (const b of (brokers || [])) lookup[b.id] = b
      const chains: Record<string, any[]> = {}
      // For each broker, build chain via sponsor_id walk (fallback if sponsor_tree empty)
      for (const b of (brokers || [])) {
        const chain: any[] = [{ ...b, depth: 0 }]
        let cur: any = b
        let safety = 15
        while (cur?.sponsor_id && safety-- > 0) {
          const up = lookup[cur.sponsor_id]
          if (!up) break
          chain.push({ ...up, depth: chain.length })
          cur = up
        }
        chains[b.id] = chain
      }
      // Override via sponsor_tree if it has explicit ancestor mappings
      if (tree && tree.length) {
        for (const b of (brokers || [])) {
          const ancestors = tree
            .filter((t: any) => t.descendant_id === b.id && t.ancestor_id !== b.id)
            .sort((x: any, y: any) => (x.depth || 0) - (y.depth || 0))
          if (ancestors.length) {
            const chain: any[] = [{ ...b, depth: 0 }]
            for (const a of ancestors) {
              const up = lookup[a.ancestor_id]
              if (up) chain.push({ ...up, depth: a.depth })
            }
            chains[b.id] = chain
          }
        }
      }
      return chains
    },
  })

  const { data: brokers = [] } = useQuery({
    queryKey: ['cp_brokers_list'],
    queryFn: async () => {
      const { data } = await supabase.from('brokers').select('id, name, broker_id').order('name')
      return data || []
    },
  })

  const { data: projects = [] } = useQuery({
    queryKey: ['cp_projects_list'],
    queryFn: async () => {
      const { data } = await supabase.from('bp_projects').select('id, name').order('name')
      return data || []
    },
  })

  // ── Mutations ──────────────────────────────────────────────────────
  const recordPay = useMutation({
    mutationFn: async (p: { booking: any; type: 'token' | 'booking'; amount: number; mode: string; date: string; utr: string; drawn_on: string; branch: string; expected_booking_amount?: number }) => {
      if (!p.amount || p.amount <= 0) throw new Error('Amount required')
      // Money on a cancelled booking would also flip its stage back to token_received below.
      if (p.booking.stage === 'cancelled') throw new Error('This booking is cancelled — record a refund instead of a payment.')
      // UTR uniqueness — bail before inserting the row so the commission trigger doesn't
      // fire on a payment that will need to be reversed.
      const trimmedUtr = (p.utr || '').trim()
      if (trimmedUtr) {
        const conflict = await findUtrConflict(trimmedUtr)
        if (conflict) throw new Error(utrConflictMessage(conflict))
      }
      // receipt_no comes back from the trigger on the inserted row — the printed receipt
      // below reads it off `payment`, so it is always the number actually stored.
      const { data: payment, error } = await supabase.from('bp_payments').insert({
        booking_id: p.booking.id, customer_id: p.booking.customer_id,
        payment_type: p.type, amount: p.amount, payment_mode: p.mode,
        payment_date: p.date, verification_status: 'verified',
        verified_at: new Date().toISOString(),
        utr_ref: trimmedUtr || null,
        drawn_on_bank: p.drawn_on || (p.mode === 'cash' ? 'Cash' : null),
        branch: p.branch || null,
        sponsor_name: p.booking.brokers?.name || null,
      }).select('*').single()
      if (error) throw error

      // Booking-type payment: also update bp_bookings.booking_amount + advance stage if needed
      if (p.type === 'booking') {
        const prevBooking = Number(p.booking.booking_amount || 0)
        const patch: any = {
          booking_amount: prevBooking + p.amount,
          booking_date: p.booking.booking_date || p.date,
          updated_at: new Date().toISOString(),
        }
        // Admin may have set/changed the expected booking amount inline — persist it
        // Modal sends null to deliberately clear, or a positive number to set; undefined = don't touch
        if (p.expected_booking_amount !== undefined) patch.expected_booking_amount = p.expected_booking_amount
        if (p.booking.stage === 'token_received') patch.stage = 'booking_done'
        await supabase.from('bp_bookings').update(patch).eq('id', p.booking.id)
        if (p.booking.plot_id) {
          await supabase.from('bp_plots').update({ status: 'booked' }).eq('id', p.booking.plot_id)
        }
      }
      if (p.type === 'token' && p.booking.stage !== 'token_received' && p.booking.stage !== 'booking_done') {
        await supabase.from('bp_bookings').update({ stage: 'token_received', token_amount: Number(p.booking.token_amount || 0) + p.amount, updated_at: new Date().toISOString() }).eq('id', p.booking.id)
      } else if (p.type === 'token') {
        await supabase.from('bp_bookings').update({ token_amount: Number(p.booking.token_amount || 0) + p.amount, updated_at: new Date().toISOString() }).eq('id', p.booking.id)
      }

      // Per-payment MLM distribution
      const rows = await distributePaymentCommission({ bookingId: p.booking.id, paymentId: payment.id, amount: p.amount })
      return { distributed: rows.length, payment, booking: p.booking }
    },
    onSuccess: (res: any) => {
      refreshPipeline()
      qc.invalidateQueries({ queryKey: ['bookings'] })
      qc.invalidateQueries({ queryKey: ['payments'] })
      qc.invalidateQueries({ queryKey: ['payouts'] })
      qc.invalidateQueries({ queryKey: ['commission_ledger'] })
      qc.invalidateQueries({ queryKey: ['plots'] })
      toast.success(`Payment recorded${res?.distributed ? ` · MLM × ${res.distributed}` : ''} · printing receipt`)
      setPayFor(null)
      // Hand admin the A4 receipt (customer + office copies on one sheet)
      if (res?.payment && res?.booking) {
        printPaymentReceipt(res.payment, {
          customer: res.booking.bp_customers,
          booking:  res.booking,
          project:  res.booking.bp_projects,
          plot:     res.booking.bp_plots,
        })
      }
    },
    onError: (e: any) => toast.error(e.message),
  })

  // Add a post-dated cheque without leaving the row.  Deliberately the same insert shape as
  // /pdc-cheques — including the duplicate-identity message — so a cheque entered here is
  // indistinguishable from one entered there.
  const addCheque = useMutation({
    mutationFn: async (p: { booking: any; cheque_no: string; bank_name: string; branch: string; cheque_date: string; amount: number; payment_type: string; notes: string }) => {
      if (!p.cheque_no.trim())      throw new Error('Enter the cheque number.')
      if (!(Number(p.amount) > 0))  throw new Error('Enter an amount greater than zero.')
      if (!p.cheque_date)           throw new Error('Enter the date written on the cheque.')
      const { error } = await supabase.from('bp_pdc_cheques').insert({
        booking_id:   p.booking.id,
        customer_id:  p.booking.customer_id || null,
        cheque_no:    p.cheque_no.trim(),
        bank_name:    p.bank_name.trim() || null,
        branch:       p.branch.trim() || null,
        cheque_date:  p.cheque_date,
        amount:       Number(p.amount),
        payment_type: p.payment_type,
        notes:        p.notes.trim() || null,
      })
      if (error) {
        if ((error.message || '').toLowerCase().includes('uq_bp_pdc_cheque_identity')) {
          throw new Error('This cheque number is already entered for this bank. Check the PDC register before re-entering.')
        }
        throw error
      }
    },
    onSuccess: () => {
      refreshPipeline()
      qc.invalidateQueries({ queryKey: ['pdc_cheques'] })
      toast.success('Cheque added to the register')
      setChequeFor(null)
    },
    onError: (e: any) => toast.error(e.message),
  })

  // Mark the registry done.  Same writes as /registry: the booking carries the deed details
  // and the plots move to 'registry_done', which is the only terminal value
  // bp_plots_status_check accepts.
  const markRegistry = useMutation({
    mutationFn: async (p: { booking: any; registry_date: string; registry_doc_no: string; registry_office: string; registry_notes: string }) => {
      if (!p.registry_date) throw new Error('Enter the registry date.')
      const userId = await getCurrentUserId()
      const { error } = await supabase.from('bp_bookings').update({
        registry_date:         p.registry_date || null,
        registry_doc_no:       p.registry_doc_no?.trim() || null,
        registry_office:       p.registry_office?.trim() || null,
        registry_notes:        p.registry_notes?.trim() || null,
        registry_completed_at: new Date().toISOString(),
        registry_completed_by: userId,
        updated_at: new Date().toISOString(),
      }).eq('id', p.booking.id)
      if (error) throw error

      // Errors here are surfaced, not swallowed: a registry recorded against a plot that is
      // still shown as merely 'booked' is how a plot ends up sold twice.
      const ids = ((p.booking.bp_booking_plots || []) as any[]).map(r => r.plot_id).filter(Boolean)
      if (ids.length > 0) {
        const { error: plotErr } = await supabase.from('bp_plots').update({ status: 'registry_done' }).in('id', ids)
        if (plotErr) throw plotErr
      }
    },
    onSuccess: () => {
      refreshPipeline()
      qc.invalidateQueries({ queryKey: ['bookings'] })
      qc.invalidateQueries({ queryKey: ['plots'] })
      qc.invalidateQueries({ queryKey: ['plots_avail'] })
      toast.success('Registry recorded')
      setRegistryFor(null)
    },
    onError: (e: any) => toast.error(e?.message || 'Could not save the registry details.'),
  })

  // Guards live in lib/deleteBooking and run again inside it, so the pipeline and the
  // Bookings page cannot end up allowing different things.
  const removeBooking = useMutation({
    mutationFn: async (booking: any) => { await deleteBookingSafely(booking) },
    onSuccess: () => {
      refreshPipeline()
      qc.invalidateQueries({ queryKey: ['bookings'] })
      qc.invalidateQueries({ queryKey: ['plots'] })
      qc.invalidateQueries({ queryKey: ['plots_avail'] })
      toast.success('Booking deleted')
      setDeleteFor(null)
    },
    onError: (e: any) => toast.error(e.message || 'Could not delete the booking.'),
  })

  const updateCustomer = useMutation({
    mutationFn: async (p: { id: string; name: string; phone: string; father_or_husband_name?: string; email?: string; pan?: string; address?: string; dob?: string; aadhaar?: string; nominee_name?: string; nominee_relation?: string }) => {
      const { id, ...fields } = p
      const { error } = await supabase.from('bp_customers').update({
        ...fields,
        dob: fields.dob || null,
        updated_at: new Date().toISOString(),
      }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      refreshPipeline()
      qc.invalidateQueries({ queryKey: ['bookings'] })
      toast.success('Customer updated')
      setEditCustomer(null)
    },
    onError: (e: any) => toast.error(e.message),
  })

  // ── Derive per-row state ───────────────────────────────────────────
  // Value, paid, balance, EMI and bucket are read off the index row — the same numbers the
  // tiles and tabs were counted from — so a card can never disagree with the tile it sits
  // under.  The per-page payment summary is kept only for the receipt detail it carries
  // (last UTR, receipt no, mode) and the split shown when a row is expanded.
  const rows = useMemo(() => {
    return (bookings as any[]).map((b: any) => {
      const ix = indexById[b.id]
      const pm = paymentsByBooking[b.id] || { token: 0, booking: 0, emi: 0, full: 0, total: 0, last_date: null, last_utr: null, last_receipt: null, last_mode: null, last_amount: 0, count: 0 }
      const total   = ix ? ix.value   : bookingValue(b)
      const paid    = ix ? ix.paid    : pm.total
      const balance = ix ? ix.balance : balanceOf(total, paid)
      const emi = ix?.emi
      const mlm = mlmByBooking[b.id] || { rows: 0, net: 0 }
      const pdc = pdcByBooking[b.id] || { open: 0, next: null, overdue: 0, openAmount: 0 }
      const registryDone = ix ? ix.registryDone : !!(b.registry_completed_at || b.registry_date)
      const readyForRegistry = !!ix?.readyForRegistry
      const chain = brokerChains[b.broker_id] || []
      const expected = Number(b.expected_booking_amount || 0)
      const hasToken   = (ix ? ix.token : pm.token) > 0
      const hasBooking = (ix ? ix.booking : pm.booking) > 0
      const bookingShortfall = expected > 0 && pm.booking < expected ? expected - pm.booking : 0
      // No value set is its own state.  Treating it as "balance 0 → settled" is what put a
      // green "Settled" on customers who had not paid a rupee and hid their Record-token
      // button.
      const priceMissing = !(total > 0)
      const settled = !priceMissing && balance <= 0
      const category: Bucket = ix?.bucket || (priceMissing ? 'price_missing' : settled ? 'settled' : 'not_started')
      return {
        ...b, pm, total, paid, balance, emi, mlm, pdc, registryDone, readyForRegistry, chain, expected,
        hasToken, hasBooking, bookingShortfall, priceMissing, settled, category,
      }
    })
  }, [bookings, indexById, paymentsByBooking, mlmByBooking, pdcByBooking, brokerChains])

  // The page is already the tab's slice, cut from the whole index above.
  const filtered = rows
  const selectedShown = filtered.filter((r: any) => selected.has(r.id))
  const [printingKist, setPrintingKist] = useState(false)

  const moreActive = [dueWindow, registryF, stageF, bookedFrom || bookedTo, minBalance].filter(Boolean).length
  const clearMore = () => { setDueWindow(''); setRegistryF(''); setStageF(''); setBookedFrom(''); setBookedTo(''); setMinBalance('') }
  const listBalance = useMemo(() => sorted.reduce((sum, r) => sum + r.balance, 0), [sorted])
  const projectName = useMemo(() => {
    const m: Record<string, string> = {}
    for (const p of projects as any[]) m[p.id] = p.name
    return m
  }, [projects])

  // What is on screen, in words — printed at the top of the register so a sheet in a file
  // still says which list it is.
  const filterSummary = (): string[] => {
    const f: string[] = []
    if (customerFocusId && customerFocus?.customer) f.push(`Customer: ${customerFocus.customer.name}`)
    if (filterBroker) { const b = (brokers as any[]).find(x => x.id === filterBroker); f.push(`Broker: ${b ? `${b.name} [${b.broker_id}]` : '—'}`) }
    if (filterProject) f.push(`Project: ${projectName[filterProject] || '—'}`)
    if (filterMode) f.push(filterMode === 'mlm' ? 'MLM only' : 'Traditional only')
    if (debouncedSearch) f.push(`Search: "${debouncedSearch}"`)
    const dueLabel: Record<string, string> = { overdue: 'EMI late', today: 'EMI due by today', week: 'EMI due in 7 days', month: 'EMI due this month', no_plan: 'Balance without EMI plan' }
    if (dueWindow) f.push(dueLabel[dueWindow])
    if (registryF) f.push(registryF === 'ready' ? 'Registry ready' : registryF === 'done' ? 'Registry done' : 'Registry not done')
    if (stageF) f.push(stageF === 'booking_done' ? 'Booking done' : 'Token received')
    if (bookedFrom || bookedTo) f.push(`Booked ${bookedFrom || '…'} to ${bookedTo || '…'}`)
    if (minBalance) f.push(`Balance ≥ ${formatINR(Number(minBalance))}`)
    return f
  }

  // The register and the CSV run over the WHOLE filtered list, not the 25 on screen.
  const registerRows = () => sorted.map(r => ({
    customer_name: r.customer_name, customer_code: r.customer_code, customer_phone: r.customer_phone,
    booking_no: r.booking_no, legacy_booking_no: r.legacy_booking_no, plot_no: r.plot_no,
    project_name: r.project_id ? (projectName[r.project_id] || '') : '',
    broker_name: r.broker_name, broker_code: r.broker_code, commission_mode: r.commission_mode,
    value: r.value, paid: r.paid, balance: r.balance, emi: r.emi || null,
  }))
  const printRegister = () => {
    if (sorted.length === 0) return
    printPipelineRegister(registerRows(), { title: TAB_LABEL[tab], filters: filterSummary() })
  }
  const exportCsv = () => {
    const header = ['Customer', 'Customer code', 'Phone', 'Booking', 'Old no', 'Plot', 'Project', 'Broker', 'Broker code', 'Sale type',
      'Value', 'Paid', 'Balance', 'Kist total', 'Kist paid', 'Kist left', 'Kist late', 'EMI left', 'EMI late', 'Next due', 'Status']
    const body = registerRows().map((r, i) => [
      r.customer_name, r.customer_code, r.customer_phone, r.booking_no, r.legacy_booking_no || '', r.plot_no, r.project_name,
      r.broker_name, r.broker_code, r.commission_mode === 'traditional' ? 'Traditional' : 'MLM',
      r.value, r.paid, r.balance,
      r.emi?.total ?? '', r.emi?.paid ?? '', r.emi?.left ?? '', r.emi?.overdue ?? '', r.emi?.amount_left ?? '', r.emi?.amount_overdue ?? '', r.emi?.next_due ?? '',
      TAB_LABEL[sorted[i].bucket],
    ])
    const csv = [header, ...body].map(line => line.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `customers-${tab}-${today()}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  // Kist cards: the full instalment table for each booking, one sheet each.
  const printKistCards = async (list: any[]) => {
    const withPlan = list.filter((r: any) => r.emi)
    if (withPlan.length === 0) { toast.error('No EMI plan on this booking yet.'); return }
    setPrintingKist(true)
    try {
      const details = await fetchEmiSchedules(withPlan.map((r: any) => r.id))
      const items = withPlan
        .filter((r: any) => details[r.id])
        .map((r: any) => ({
          detail: details[r.id],
          customer: r.bp_customers, booking: r, plot: r.bp_plots, project: r.bp_projects, broker: r.brokers,
        }))
      if (items.length === 0) { toast.error('Could not load the instalments.'); return }
      printEmiCards(items)
    } catch (e: any) {
      toast.error(e?.message || 'Could not build the EMI cards.')
    } finally {
      setPrintingKist(false)
    }
  }

  const toggleExpand = (id: string) => setExpanded(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })

  const toggleSelect = (id: string) => setSelected(prev => {
    const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n
  })
  // Covers the rows on screen, not every booking behind the filters.
  const allShownSelected = filtered.length > 0 && filtered.every((r: any) => selected.has(r.id))
  const toggleSelectAllShown = () => setSelected(prev => {
    const n = new Set(prev)
    if (allShownSelected) filtered.forEach((r: any) => n.delete(r.id))
    else filtered.forEach((r: any) => n.add(r.id))
    return n
  })

  // One window, one print dialog, one form per sheet.  Opening a window per booking gets
  // blocked by the browser after the first couple, so the forms are batched.
  const printSelectedForms = async () => {
    const chosen = filtered.filter((r: any) => selected.has(r.id))
    if (chosen.length === 0) return
    setPrinting(true)
    try {
      const ids = chosen.map((r: any) => r.id)
      const { data: pays, error } = await supabase
        .from('bp_payments')
        .select('id, booking_id, amount, payment_type, payment_mode, payment_date, receipt_no, utr_ref, instalment_no, created_at')
        .in('booking_id', ids)
        .eq('verification_status', 'verified')
        .order('payment_date', { ascending: true })
      if (error) throw error
      const byBooking: Record<string, any[]> = {}
      for (const p of (pays || [])) {
        if (!p.booking_id) continue
        ;(byBooking[p.booking_id] ||= []).push(p)
      }
      printApplicationForms(chosen.map((r: any) => ({
        b: r,
        ctx: {
          customer: r.bp_customers, project: r.bp_projects, plot: r.bp_plots,
          broker: r.brokers, payments: byBooking[r.id] || [],
        },
      })))
    } catch (e: any) {
      toast.error(e?.message || 'Could not build the forms.')
    } finally {
      setPrinting(false)
    }
  }

  // Simple English reminder, prefilled so admin only has to press send.  Opened per
  // customer because WhatsApp has no bulk link and browsers block a burst of popups.
  const whatsappReminder = (r: any) => {
    const name = r.bp_customers?.name || 'Sir/Madam'
    const lines = [
      `Dear ${name},`,
      '',
      `This is a payment reminder from Fanbe Group for booking ${r.booking_no || ''}.`,
    ]
    if (r.emi?.overdue > 0) {
      lines.push(`You have ${r.emi.overdue} EMI instalment${r.emi.overdue === 1 ? '' : 's'} pending.`)
    }
    if (r.balance > 0) lines.push(`Balance due: ${formatINR(r.balance)}.`)
    if (r.emi?.next_due) lines.push(`Next due date: ${formatDate(r.emi.next_due)}.`)
    lines.push('', 'Please pay at your earliest. Ignore this message if you have already paid.', '', 'Thank you.')
    const url = waLink(r.bp_customers?.phone, lines.join('\n'))
    if (!url) { toast.error('This customer has no usable phone number saved.'); return }
    window.open(url, '_blank')
  }

  // Full account statement for the focused customer: bookings, every payment, the EMI
  // schedule and a running total.  Replaces the by-hand Excel the team made on request.
  const [statementBusy, setStatementBusy] = useState(false)
  const printStatement = async () => {
    if (!customerFocusId) return
    setStatementBusy(true)
    try {
      const { data: c } = await supabase.from('bp_customers')
        .select('id, customer_code, name, phone, address, father_or_husband_name, pan').eq('id', customerFocusId).maybeSingle()
      const { data: bks } = await supabase.from('bp_bookings')
        .select('id, booking_no, total_amount, plot_total_price, bp_plots(plot_no), bp_projects(name)')
        .eq('customer_id', customerFocusId).neq('stage', 'cancelled')
      const ids = (bks || []).map((b: any) => b.id)
      if (ids.length === 0) { toast.error('This customer has no bookings to put on a statement.'); return }
      const bookingNo: Record<string, string> = {}
      for (const b of (bks || []) as any[]) bookingNo[b.id] = b.booking_no
      const [{ data: pays }, emiDetail] = await Promise.all([
        supabase.from('bp_payments')
          .select('payment_date, receipt_no, payment_type, payment_mode, utr_ref, amount, booking_id, created_at')
          .in('booking_id', ids).eq('verification_status', 'verified'),
        fetchEmiSchedules(ids),
      ])
      // Payments oldest first so the running total climbs the way a passbook reads.
      const payments = ((pays || []) as any[])
        .sort((a, b) => `${a.payment_date || ''}${a.created_at || ''}`.localeCompare(`${b.payment_date || ''}${b.created_at || ''}`))
        .map(p => ({
          date: p.payment_date, receipt_no: p.receipt_no, type: p.payment_type, mode: p.payment_mode,
          ref: p.utr_ref || null, booking_no: bookingNo[p.booking_id] || null, amount: Number(p.amount || 0),
        }))
      const emis: any[] = []
      let emiLeft = 0, emiOverdue = 0
      for (const id of ids) {
        const det = emiDetail[id]
        if (!det) continue
        emiLeft += det.status.amount_left
        emiOverdue += det.status.amount_overdue
        for (const row of det.rows) {
          emis.push({ booking_no: bookingNo[id] || null, seq: row.seq, due_date: row.due_date, amount: row.amount, paid_amount: row.paid_amount, state: row.state })
        }
      }
      const bookings = ((bks || []) as any[]).map(b => {
        const value = Number(b.total_amount || b.plot_total_price || 0)
        const paid = payments.filter(p => p.booking_no === b.booking_no).reduce((x, p) => x + p.amount, 0)
        return { booking_no: b.booking_no, plot_no: b.bp_plots?.plot_no || null, project_name: b.bp_projects?.name || null, value, paid }
      })
      const totalValue = bookings.reduce((x, b) => x + b.value, 0)
      const totalPaid = payments.reduce((x, p) => x + p.amount, 0)
      printCustomerStatement({
        customer: c || { name: customerFocus?.customer?.name },
        bookings, payments, emis,
        totals: { value: totalValue, paid: totalPaid, balance: Math.max(0, totalValue - totalPaid), emiLeft, emiOverdue },
      })
    } catch (e: any) {
      toast.error(e?.message || 'Could not build the statement.')
    } finally {
      setStatementBusy(false)
    }
  }

  return (
    <div className="p-4 md:p-8 space-y-6 max-w-6xl mx-auto">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold text-gray-900 tracking-tight">Customer Pipeline</h1>
        <p className="text-sm text-gray-500 mt-1">Every deal · clean. One tap to do the next thing.</p>
      </div>

      {/* Customer focus header — present when ?customer= is in the URL.  Replaces the
          deleted /customer-history page: shows the customer profile + aggregate totals
          across ALL their bookings, then narrows the list below to just this customer. */}
      {customerFocusId && customerFocusFetched && !customerFocus?.customer && (
        // The ?customer=X in the URL doesn't match any bp_customers row.  Don't pretend
        // the filter is active — show a clear 404 with a way to clear the filter.
        <div className="bg-rose-50 border border-rose-200 rounded-xl p-4 flex items-start gap-3">
          <span className="inline-flex items-center justify-center w-9 h-9 rounded-full bg-rose-100 text-rose-700 shrink-0 font-bold text-sm">404</span>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-semibold text-rose-900">Customer not found</div>
            <div className="text-xs text-rose-800 mt-0.5">
              No customer exists with id <code className="font-mono bg-white px-1 py-0.5 rounded">{customerFocusId}</code>. They may have been deleted, or the link is wrong.
            </div>
          </div>
          <button onClick={clearCustomerFocus} className="text-xs font-medium px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white shrink-0">
            Clear filter
          </button>
        </div>
      )}

      {customerFocusId && customerFocus?.customer && (
        <div className="bg-gradient-to-br from-blue-50 to-indigo-50 border border-blue-200 rounded-2xl p-5 shadow-sm">
          <div className="flex items-start gap-4 flex-wrap">
            <div className="w-12 h-12 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 text-white flex items-center justify-center text-lg font-bold shrink-0">
              {(customerFocus.customer.name || '?').charAt(0).toUpperCase()}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-lg font-bold text-gray-900">{customerFocus.customer.name || '—'}</h2>
                <span className="font-mono text-[11px] text-gray-500">[{customerFocus.customer.customer_code || '—'}]</span>
                {/* The code this person was first issued. It disappears when they are made
                    a broker, but it is what is written on their older paperwork. */}
                {customerFocus.customer.previous_customer_code && (
                  <span className="font-mono text-[11px] text-gray-400" title="Code before this customer became a broker">
                    (पुराना {customerFocus.customer.previous_customer_code})
                  </span>
                )}
                <span className="text-[10px] uppercase tracking-wide font-semibold bg-blue-100 text-blue-800 px-2 py-0.5 rounded-full">Customer view</span>
              </div>
              <div className="text-xs text-gray-600 mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                {customerFocus.customer.phone && <span>📞 {customerFocus.customer.phone}</span>}
                {customerFocus.customer.email && <span>✉️ {customerFocus.customer.email}</span>}
                {customerFocus.customer.pan && <span>PAN: <span className="font-mono">{customerFocus.customer.pan}</span></span>}
                {customerFocus.customer.father_or_husband_name && <span>S/o {customerFocus.customer.father_or_husband_name}</span>}
              </div>
              {customerFocus.customer.address && <div className="text-xs text-gray-500 mt-0.5 truncate">📍 {customerFocus.customer.address}</div>}
            </div>
            <div className="flex flex-col gap-1.5 shrink-0">
              <button onClick={() => setEditCustomer(customerFocus.customer)} className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white">
                <Pencil size={12}/>Edit
              </button>
              <button onClick={printStatement} disabled={statementBusy}
                className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-lg bg-white border border-blue-300 text-blue-700 hover:bg-blue-50 disabled:opacity-50">
                <FileText size={12}/>{statementBusy ? 'Building…' : 'Statement'}
              </button>
              <button onClick={clearCustomerFocus} className="text-xs text-blue-700 hover:text-blue-900 underline">
                Clear filter →
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mt-4">
            <CustomerStat label="Bookings"        value={String(customerFocus.bookingCount)} sub="active (excl. cancelled)"/>
            <CustomerStat label="Total cost"      value={formatINR(customerFocus.totalCost)} sub="all bookings"/>
            <CustomerStat label="Paid"            value={formatINR(customerFocus.paid)} sub={`${customerFocus.collectionPct}% collected`} tone="emerald"/>
            <CustomerStat label="Outstanding"     value={formatINR(customerFocus.outstanding)} sub="still due" tone={customerFocus.outstanding > 0 ? 'amber' : 'gray'}/>
            <CustomerStat label="Overdue EMI"     value={formatINR(customerFocus.overdueAmt)} sub={`${customerFocus.overdueCnt} past-due`} tone={customerFocus.overdueAmt > 0 ? 'rose' : 'gray'}/>
          </div>
        </div>
      )}

      {/* KPI tiles = tabs.  Counted across every booking under the current filters, and
          the buckets are exclusive, so the bucket tiles add up to "All". */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3">
        <TabTile active={tab==='today'} onClick={() => setTab('today')} tint="rose"
          label="Today's work" value={indexLoading ? '—' : String(counts.get('today').n)}
          sub={`${counts.todayEmi} EMI · ${counts.todayCheque} cheque · ${counts.todayRegistry} registry`}/>
        <TabTile active={tab==='all'} onClick={() => setTab('all')} tint="indigo"
          label="All customers" value={indexLoading ? '—' : String(counts.get('all').n)}
          sub={`${formatINR(counts.get('all').balance)} still to collect`}/>
        <TabTile active={tab==='emi_overdue'} onClick={() => setTab('emi_overdue')} tint="rose"
          label="EMI overdue" value={String(counts.get('emi_overdue').n)}
          sub={`${formatINR(counts.get('emi_overdue').overdue)} late`}/>
        <TabTile active={tab==='emi_running'} onClick={() => setTab('emi_running')} tint="blue"
          label="EMI running" value={String(counts.get('emi_running').n)}
          sub={`${formatINR(counts.get('emi_running').balance)} balance`}/>
        <TabTile active={tab==='balance_no_plan'} onClick={() => setTab('balance_no_plan')} tint="violet"
          label="Balance, no EMI plan" value={String(counts.get('balance_no_plan').n)}
          sub={`${formatINR(counts.get('balance_no_plan').balance)} unplanned`}/>
        <TabTile active={tab==='token_only'} onClick={() => setTab('token_only')} tint="amber"
          label="Token only" value={String(counts.get('token_only').n)}
          sub="booking deposit pending"/>
        <TabTile active={tab==='not_started'} onClick={() => setTab('not_started')} tint="slate"
          label="No payment yet" value={String(counts.get('not_started').n)}
          sub={`${formatINR(counts.get('not_started').value)} booked`}/>
        <TabTile active={tab==='settled'} onClick={() => setTab('settled')} tint="emerald"
          label="Fully settled" value={String(counts.get('settled').n)}
          sub={`${formatINR(counts.get('settled').value)} collected`}/>
        <TabTile active={tab==='price_missing'} onClick={() => setTab('price_missing')} tint="amber"
          label="Price not set" value={String(counts.get('price_missing').n)}
          sub="plot / price never entered"/>
      </div>

      {indexError && (
        <div className="p-3 rounded-xl bg-rose-50 border border-rose-200 text-sm text-rose-800 flex items-center gap-2">
          <AlertTriangle size={14}/>The customer list did not load. Counts and tabs below are not reliable — refresh the page.
        </div>
      )}

      {/* Search + everyday filters */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[240px]">
          <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400"/>
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder={
              searchScope === 'customer' ? 'Customer name, phone or code'
              : searchScope === 'broker' ? 'Broker name or code'
              : searchScope === 'booking' ? 'Booking number or old register number'
              : searchScope === 'plot' ? 'Plot number'
              : 'Name, phone, code, booking, broker or plot'
            }
            className="w-full pl-10 pr-9 py-2.5 text-sm bg-white border border-gray-200 rounded-full focus:outline-none focus:border-gray-900 transition"/>
          {search && (
            <button onClick={() => setSearch('')} title="Clear search"
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700"><X size={14}/></button>
          )}
        </div>
        <select value={searchScope} onChange={e => setSearchScope(e.target.value as any)}
          className="bg-white border border-gray-200 rounded-full px-3 py-2.5 text-sm focus:outline-none focus:border-gray-900">
          <option value="all">Search: All</option>
          <option value="customer">Search: Customers</option>
          <option value="broker">Search: Brokers</option>
          <option value="booking">Search: Booking #</option>
          <option value="plot">Search: Plots</option>
        </select>
        <select value={filterBroker} onChange={e => setFilterBroker(e.target.value)} className="bg-white border border-gray-200 rounded-full px-3 py-2.5 text-sm focus:outline-none focus:border-gray-900">
          <option value="">All brokers</option>
          {(brokers as any[]).map((b: any) => <option key={b.id} value={b.id}>{b.name} [{b.broker_id}]</option>)}
        </select>
        <select value={filterProject} onChange={e => setFilterProject(e.target.value)} className="bg-white border border-gray-200 rounded-full px-3 py-2.5 text-sm focus:outline-none focus:border-gray-900">
          <option value="">All projects</option>
          {(projects as any[]).map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        {/* Sale type.  Kept as a pill group rather than a fourth dropdown because admin
            flips between the two books constantly, and a dropdown hides which one is on. */}
        <div className="inline-flex rounded-full border border-gray-200 overflow-hidden text-sm bg-white">
          <button onClick={() => setFilterMode('')}
            className={`px-3 py-2.5 ${filterMode === '' ? 'bg-gray-900 text-white' : 'text-gray-700 hover:bg-gray-50'}`}>All</button>
          <button onClick={() => setFilterMode('mlm')}
            className={`px-3 py-2.5 border-l border-gray-200 ${filterMode === 'mlm' ? 'bg-blue-600 text-white' : 'text-blue-700 hover:bg-blue-50'}`}>MLM</button>
          <button onClick={() => setFilterMode('traditional')}
            className={`px-3 py-2.5 border-l border-gray-200 ${filterMode === 'traditional' ? 'bg-amber-600 text-white' : 'text-amber-700 hover:bg-amber-50'}`}>Traditional</button>
        </div>
        <button onClick={() => setShowMore(v => !v)}
          className={`inline-flex items-center gap-1.5 rounded-full border px-3.5 py-2.5 text-sm transition ${
            showMore || moreActive ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-200 bg-white text-gray-700 hover:border-gray-400'}`}>
          <SlidersHorizontal size={14}/>More filters{moreActive ? ` · ${moreActive}` : ''}
        </button>
      </div>

      {showMore && (
        <div className="bg-white border border-gray-200 rounded-2xl p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <label className="text-[12px] text-gray-600 space-y-1">
            <span className="block font-medium">Next EMI due</span>
            <select value={dueWindow} onChange={e => setDueWindow(e.target.value as DueWindow)} className="w-full border border-gray-200 rounded-lg px-2.5 py-2 text-sm">
              <option value="">Any</option>
              <option value="overdue">Already late</option>
              <option value="today">Due today or late</option>
              <option value="week">Due within 7 days</option>
              <option value="month">Due by month end</option>
              <option value="no_plan">Balance left but no EMI plan</option>
            </select>
          </label>
          <label className="text-[12px] text-gray-600 space-y-1">
            <span className="block font-medium">Registry</span>
            <select value={registryF} onChange={e => setRegistryF(e.target.value as any)} className="w-full border border-gray-200 rounded-lg px-2.5 py-2 text-sm">
              <option value="">Any</option>
              <option value="ready">Ready — fully paid, deed pending</option>
              <option value="not_done">Not done yet</option>
              <option value="done">Done</option>
            </select>
          </label>
          <label className="text-[12px] text-gray-600 space-y-1">
            <span className="block font-medium">Stage</span>
            <select value={stageF} onChange={e => setStageF(e.target.value as any)} className="w-full border border-gray-200 rounded-lg px-2.5 py-2 text-sm">
              <option value="">Any</option>
              <option value="token_received">Token received</option>
              <option value="booking_done">Booking done</option>
            </select>
          </label>
          <label className="text-[12px] text-gray-600 space-y-1">
            <span className="block font-medium">Booked between</span>
            <span className="flex items-center gap-1.5">
              <input type="date" value={bookedFrom} onChange={e => setBookedFrom(e.target.value)} className="flex-1 min-w-0 border border-gray-200 rounded-lg px-2 py-1.5 text-sm"/>
              <span className="text-gray-400">–</span>
              <input type="date" value={bookedTo} onChange={e => setBookedTo(e.target.value)} className="flex-1 min-w-0 border border-gray-200 rounded-lg px-2 py-1.5 text-sm"/>
            </span>
          </label>
          <label className="text-[12px] text-gray-600 space-y-1">
            <span className="block font-medium">Balance at least (₹)</span>
            <input type="number" min={0} value={minBalance} onChange={e => setMinBalance(e.target.value)} placeholder="e.g. 100000"
              className="w-full border border-gray-200 rounded-lg px-2.5 py-2 text-sm"/>
          </label>
          <div className="flex items-end">
            <button onClick={clearMore} disabled={!moreActive}
              className="text-sm text-gray-600 hover:text-gray-900 underline disabled:opacity-40 disabled:no-underline">Clear these filters</button>
          </div>
        </div>
      )}

      {/* List toolbar: count, sort, and the printouts that run on the WHOLE filtered list,
          not just the 25 on screen. */}
      <div className="flex items-center gap-2 flex-wrap px-1">
        <span className="text-[13px] text-gray-700">
          <b className="tabular-nums">{totalBookings.toLocaleString('en-IN')}</b> {tab === 'all' ? 'customer' : 'match'}{totalBookings === 1 ? '' : (tab === 'all' ? 's' : 'es')}
          {totalBookings > 0 && <span className="text-gray-400"> · {formatINR(listBalance)} balance</span>}
        </span>
        <div className="ml-auto flex items-center gap-2 flex-wrap">
          <label className="inline-flex items-center gap-1.5 text-[12px] text-gray-500">
            <ListOrdered size={13}/>
            <select value={sortBy} onChange={e => setSortBy(e.target.value as SortKey)} className="bg-white border border-gray-200 rounded-full px-2.5 py-1.5 text-[12px]">
              <option value="newest">Newest first</option>
              <option value="oldest">Oldest first</option>
              <option value="balance">Highest balance</option>
              <option value="overdue">Most EMI overdue</option>
              <option value="next_due">Next EMI due soonest</option>
              <option value="kist_left">Most kist left</option>
              <option value="name">Customer A–Z</option>
            </select>
          </label>
          <Button size="sm" variant="secondary" onClick={printRegister} disabled={totalBookings === 0}
            title="Print every customer in this list with their EMI position">
            <Printer size={13}/>Print list ({totalBookings})
          </Button>
          <Button size="sm" variant="secondary" onClick={exportCsv} disabled={totalBookings === 0}>
            <Download size={13}/>CSV
          </Button>
        </div>
      </div>

      {/* Select rows to print forms / EMI cards together */}
      {filtered.length > 0 && (
        <div className="flex items-center gap-3 flex-wrap px-1">
          <label className="inline-flex items-center gap-2 text-[12px] text-gray-600 cursor-pointer">
            <input type="checkbox" checked={allShownSelected} onChange={toggleSelectAllShown}
              className="w-4 h-4 accent-gray-900 cursor-pointer"/>
            Select all shown
          </label>
          {selectedShown.length > 0 && (
            <>
              <span className="text-[12px] font-semibold text-gray-900">{selectedShown.length} selected</span>
              <button onClick={() => setSelected(new Set())}
                className="text-[12px] text-gray-500 hover:text-gray-900 underline">Clear</button>
              <Button size="sm" onClick={printSelectedForms} loading={printing}>
                <Printer size={13}/>Print {selectedShown.length} form{selectedShown.length === 1 ? '' : 's'}
              </Button>
              <Button size="sm" variant="secondary" onClick={() => printKistCards(selectedShown)} loading={printingKist}
                disabled={!selectedShown.some((r: any) => r.emi)}
                title={selectedShown.some((r: any) => r.emi) ? 'Print the instalment card for each selected customer' : 'None of the selected bookings has an EMI plan'}>
                <Calculator size={13}/>Print EMI cards ({selectedShown.filter((r: any) => r.emi).length})
              </Button>
            </>
          )}
        </div>
      )}

      {/* Deals list */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-[0_1px_2px_rgba(0,0,0,0.02)] divide-y divide-gray-100 overflow-hidden">
        {isLoading && <div className="py-10 text-center text-sm text-gray-400">Loading…</div>}
        {!isLoading && filtered.length === 0 && (
          <div className="py-12 text-center">
            <div className="text-sm text-gray-400">
              {EMPTY_TEXT[tab]}
            </div>
          </div>
        )}
        {filtered.map((r: any) => {
          const open = expanded.has(r.id)
          const cust = r.bp_customers
          // Progress = 4 milestones: token, booking deposit, EMI started, fully settled
          const m1 = r.hasToken
          const m2 = r.hasBooking && r.bookingShortfall <= 0
          const m3 = !!r.emi
          const m4 = r.settled
          const pct = r.total > 0 ? Math.min(100, Math.round((r.paid / r.total) * 100)) : 0
          // ONE primary, contextual call-to-action.  "Not settled" rather than "balance > 0":
          // a booking with no price has a balance of 0 too, and keying off the balance hid
          // its Record-token button and showed it as Settled.
          const open_ = !r.settled
          const primary = !r.hasToken && open_
              ? { label: 'Record token',          onClick: () => setPayFor({ booking: r, type: 'token' }) }
            : r.priceMissing
              ? { label: 'Set plot & price',      onClick: () => navigate(`/bookings?edit=${r.id}`) }
            : r.hasToken && !r.hasBooking && open_
              ? { label: 'Record booking',        onClick: () => setPayFor({ booking: r, type: 'booking' }) }
            : r.hasBooking && r.bookingShortfall > 0
              ? { label: 'Top up booking',        onClick: () => setPayFor({ booking: r, type: 'booking' }) }
            : !r.emi && open_
              ? { label: 'Start EMI',             onClick: () => setEmiBooking(r) }
            : r.emi && open_
              ? { label: r.emi.overdue > 0 ? 'Collect late EMI' : 'Collect EMI payment', onClick: () => setEmiBooking(r) }
            : null  // settled

          // Next-step subtitle that explains the primary action
          const nextHint = r.priceMissing
              ? (r.hasToken ? 'Token in, but no plot or price on this booking — set them so the balance can be worked out.'
                            : 'No plot or price on this booking yet. Record the token now, set the price when the plot is allotted.')
            : !r.hasToken
              ? 'Customer hasn\'t paid yet.'
            : !r.hasBooking
              ? r.expected > 0 ? `Booking deposit expected: ${formatINR(r.expected)}.` : 'Awaiting booking deposit.'
            : r.bookingShortfall > 0
              ? `Booking deposit short by ${formatINR(r.bookingShortfall)}.`
            : !r.emi && r.balance > 0
              ? `Balance ${formatINR(r.balance)} — set up the EMI plan.`
            : r.emi && r.balance > 0
              ? r.emi.overdue > 0
                  ? `${r.emi.overdue} EMI overdue · ${formatINR(r.balance)} balance.`
                  : `Next EMI ${formatDate(r.emi.next_due || '')} · ${r.emi.per_inst ? `${formatINR(r.emi.per_inst)} ea` : ''}`
            : 'Settled — no further action needed.'

          return (
            <div key={r.id} className="px-4 md:px-6 py-5 hover:bg-gray-50/40 transition-colors">
              {/* Header: name + balance */}
              <div className="flex items-start justify-between gap-4">
                <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggleSelect(r.id)}
                  title="Select for printing"
                  className="mt-1.5 w-4 h-4 accent-gray-900 cursor-pointer shrink-0"/>
                <div className="min-w-0 flex-1">
                  {/* Explicit "Customer" pill so it can never be confused with the broker badge below. */}
                  <div className="inline-flex items-center gap-1.5 text-[10px] font-semibold text-indigo-700 bg-indigo-50 border border-indigo-100 rounded-full px-2 py-0.5 mb-1">
                    <Users size={10}/>CUSTOMER
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Link to={`/customer-pipeline?customer=${r.customer_id}`} className="text-[17px] font-semibold text-gray-900 hover:text-blue-700 truncate">
                      {cust?.name || '—'}
                    </Link>
                    <button onClick={() => setEditCustomer(cust)} title="Edit customer" className="p-0.5 rounded hover:bg-gray-200 text-gray-400 hover:text-gray-700 shrink-0">
                      <Pencil size={12}/>
                    </button>
                  </div>
                  {/* Subline 1: identity (booking_no · plot · project · sale mode badge) */}
                  <div className="text-[13px] text-gray-500 mt-0.5 truncate flex items-center gap-1.5 flex-wrap">
                    <span className="font-mono">{r.booking_no}</span>
                    {/* The number from the old paper register, kept next to the system id
                        rather than replacing it, so a row can be matched against the
                        old files without the two ever being confused. */}
                    {r.legacy_booking_no && (
                      <span className="text-[11px] text-gray-400 font-mono" title="Number from the old register">
                        (पुराना {r.legacy_booking_no})
                      </span>
                    )}
                    {r.bp_plots?.plot_no && <span>· Plot {r.bp_plots.plot_no}</span>}
                    {r.bp_plots?.size_sqyd && <span>· {r.bp_plots.size_sqyd} sqyd</span>}
                    {(r.bp_projects?.name || r.scheme_name) && <span>· {r.bp_projects?.name || r.scheme_name}</span>}
                    {/* Sale-mode badge — admin can spot Traditional bookings without expanding. */}
                    {r.commission_mode === 'traditional' && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-800 bg-amber-100 border border-amber-200 rounded-full px-1.5 py-0.5" title="Sold the traditional way — custom commission, no MLM upline cascade">
                        TRADITIONAL
                        {r.traditional_commission_pct != null && <span className="font-mono opacity-80">· {r.traditional_commission_pct}%</span>}
                        {r.traditional_commission_per_sqyd != null && <span className="font-mono opacity-80">· ₹{r.traditional_commission_per_sqyd}/sqyd</span>}
                      </span>
                    )}
                  </div>
                  {/* Subline 2: broker (explicit "BROKER" pill) · application date · stage */}
                  <div className="text-[12px] text-gray-400 mt-1 flex items-center gap-2 flex-wrap">
                    {r.brokers ? (
                      <span className="inline-flex items-center gap-1">
                        <span className="text-[10px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-full px-2 py-0.5">BROKER</span>
                        <Link to={`/broker/dashboard?broker_id=${r.broker_id}`} className="text-blue-600 hover:underline">
                          {r.brokers.name}{r.brokers.broker_id ? ` [${r.brokers.broker_id}]` : ''}
                        </Link>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1">
                        <span className="text-[10px] font-semibold text-gray-500 bg-gray-50 border border-gray-200 rounded-full px-2 py-0.5">BROKER</span>
                        <span className="italic">none</span>
                      </span>
                    )}
                    {r.application_date && <span>· {formatDate(r.application_date)}</span>}
                    <span>·</span>
                    <span className="capitalize">{(r.stage || '').replace(/_/g, ' ')}</span>
                  </div>
                </div>
                <div className="text-right shrink-0">
                  {r.priceMissing ? (
                    <>
                      <div className="text-[13px] font-semibold text-amber-700 inline-flex items-center gap-1"><Tag size={12}/>Price not set</div>
                      <div className="text-[11px] text-gray-400 tabular-nums">{r.paid > 0 ? `paid ${formatINR(r.paid)}` : 'nothing paid'}</div>
                    </>
                  ) : (
                    <>
                      <div className={`text-[18px] font-bold tabular-nums ${r.settled ? 'text-emerald-700' : 'text-gray-900'}`}>{formatINR(r.balance)}</div>
                      <div className="text-[11px] text-gray-400 tabular-nums">{r.settled ? 'settled' : `paid ${formatINR(r.paid)} / ${formatINR(r.total)}`}</div>
                    </>
                  )}
                </div>
              </div>

              {/* Calm progress strip + next-step hint */}
              <div className="mt-4 flex items-center gap-3">
                <Milestone done={m1} label="Token"/>
                <Connector done={m2}/>
                <Milestone done={m2}   partial={r.hasBooking && r.bookingShortfall > 0} label="Booking"/>
                <Connector done={m3}/>
                <Milestone done={m3}   partial={r.emi && r.emi.overdue > 0} label="EMI"/>
                <Connector done={m4}/>
                <Milestone done={m4}   label="Settled"/>
                <div className="ml-auto text-[12px] text-gray-400 tabular-nums shrink-0">{pct}%</div>
              </div>
              <div className="mt-2 text-[12px] text-gray-500">{nextHint}</div>

              {/* The details admin was opening every row to read — phone, and the last
                  receipt with its bank reference — kept on the row itself.  Each one is a
                  live control: tap the number to dial, tap the UTR to copy it. */}
              <div className="mt-2 flex items-center gap-x-3 gap-y-1 flex-wrap text-[11.5px]">
                {cust?.phone && (
                  <a href={`tel:${cust.phone}`} onClick={e => e.stopPropagation()}
                    className="inline-flex items-center gap-1 text-gray-600 hover:text-blue-700 font-medium">
                    <Phone size={11}/>{cust.phone}
                  </a>
                )}
                {r.pm.last_utr && (
                  <button
                    onClick={() => { navigator.clipboard?.writeText(r.pm.last_utr); toast.success(`UTR ${r.pm.last_utr} copied`) }}
                    title="Copy UTR / reference"
                    className="inline-flex items-center gap-1 text-gray-600 hover:text-blue-700 font-mono">
                    <Banknote size={11}/>UTR {r.pm.last_utr}
                  </button>
                )}
                {r.pm.last_receipt && (
                  <span className="inline-flex items-center gap-1 text-gray-500 font-mono" title="Latest receipt number">
                    <Printer size={11}/>{r.pm.last_receipt}
                  </span>
                )}
                {r.pm.last_date && (
                  <span className="text-gray-500">
                    last {formatINR(r.pm.last_amount)}
                    {r.pm.last_mode ? ` · ${String(r.pm.last_mode).toUpperCase()}` : ''} · {formatDate(r.pm.last_date)}
                  </span>
                )}
                {r.pm.count > 0 && (
                  <span className="text-gray-400">{r.pm.count} receipt{r.pm.count === 1 ? '' : 's'}</span>
                )}
                {/* Which commission rule this sale runs on.  Shown on every row because the
                    two books are managed differently and were indistinguishable in a list. */}
                <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 font-bold border text-[9px] ${
                  r.commission_mode === 'traditional'
                    ? 'text-amber-800 bg-amber-50 border-amber-200'
                    : 'text-blue-800 bg-blue-50 border-blue-200'}`}>
                  {r.commission_mode === 'traditional' ? 'TRAD' : 'MLM'}
                </span>
                {/* How much EMI is still to come — the question admin asked to see without
                    opening each row. */}
                {/* "Kitni EMI hai" answered on the row: kist paid of total, kist left, and the
                    money still to come. */}
                {r.emi && (
                  <span className="inline-flex items-center gap-1 text-indigo-700 bg-indigo-50 border border-indigo-200 rounded-full px-1.5 py-0.5 font-medium"
                    title={`${r.emi.paid} of ${r.emi.total} instalments paid · ${r.emi.left} left${r.emi.per_inst ? ` · ${formatINR(r.emi.per_inst)} each` : ''}`}>
                    <Hourglass size={10}/>EMI {r.emi.paid}/{r.emi.total} kist
                    {r.emi.left > 0 ? ` · ${r.emi.left} left · ${formatINR(r.emi.amount_left)}` : ' · all paid'}
                  </span>
                )}
                {r.emi?.overdue > 0 && (
                  <span className="inline-flex items-center gap-1 text-rose-700 bg-rose-50 border border-rose-200 rounded-full px-1.5 py-0.5 font-semibold"
                    title={`${formatINR(r.emi.amount_overdue)} past its due date`}>
                    <AlertTriangle size={10}/>{r.emi.overdue} EMI overdue · {formatINR(r.emi.amount_overdue)}
                  </span>
                )}

                {/* Cheques still in the drawer, and whether the registry is done — both were
                    a trip to another page to answer. */}
                {r.pdc.open > 0 && (
                  <span className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 font-medium border ${
                    r.pdc.overdue > 0
                      ? 'text-rose-700 bg-rose-50 border-rose-200'
                      : 'text-purple-700 bg-purple-50 border-purple-200'}`}
                    title={`${formatINR(r.pdc.openAmount)} still on file`}>
                    <Landmark size={10}/>
                    {r.pdc.open} cheque{r.pdc.open === 1 ? '' : 's'}
                    {r.pdc.overdue > 0
                      ? ` · ${r.pdc.overdue} overdue`
                      : r.pdc.next ? ` · next ${formatDate(r.pdc.next)}` : ''}
                  </span>
                )}
                {r.registryDone && (
                  <span className="inline-flex items-center gap-1 text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-1.5 py-0.5 font-semibold"
                    title={r.registry_office || 'Registry completed'}>
                    <ScrollText size={10}/>Registry {r.registry_date ? formatDate(r.registry_date) : 'done'}
                    {r.registry_doc_no ? ` · ${r.registry_doc_no}` : ''}
                  </span>
                )}
                {/* Only nudged once the money is actually in — chasing a registry on an
                    unpaid deal is not the next step. */}
                {r.readyForRegistry && (
                  <span className="inline-flex items-center gap-1 text-amber-800 bg-amber-50 border border-amber-200 rounded-full px-1.5 py-0.5 font-semibold">
                    <ScrollText size={10}/>Registry pending
                  </span>
                )}
              </div>

              {/* Single primary CTA + minimal secondary affordances */}
              <div className="mt-4 flex items-center gap-3 flex-wrap">
                {primary ? (
                  <button onClick={primary.onClick}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-gray-900 text-white text-sm font-semibold hover:bg-black shadow-sm transition">
                    {primary.label} <ArrowUpRight size={14}/>
                  </button>
                ) : r.settled ? (
                  <span className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-emerald-50 text-emerald-700 text-sm font-semibold">
                    <CheckCircle2 size={14}/>Settled
                  </span>
                ) : null}
                {/* The two operations admin was leaving the page for.  Kept next to the
                    primary action rather than inside Details, since both are counter work
                    done while the customer is standing there. */}
                {/* Only where there is actually money to ask for. */}
                {r.balance > 0 && r.bp_customers?.phone && (
                  <button onClick={() => whatsappReminder(r)}
                    title="Open WhatsApp with a payment reminder ready to send"
                    className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full border text-sm font-medium shadow-sm transition ${
                      r.emi?.overdue > 0
                        ? 'border-emerald-300 bg-emerald-50 text-emerald-800 hover:bg-emerald-100'
                        : 'border-gray-300 bg-white text-gray-800 hover:bg-gray-50 hover:border-gray-400'}`}>
                    <MessageCircle size={14}/>Remind
                  </button>
                )}
                <button onClick={() => setChequeFor(r)}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full border border-gray-300 bg-white text-gray-800 text-sm font-medium hover:bg-gray-50 hover:border-gray-400 shadow-sm transition">
                  <Landmark size={14}/>PDC cheque
                </button>
                {r.emi && (
                  <button onClick={() => printKistCards([r])} disabled={printingKist}
                    title="Print every instalment of this plan — paid, late and still to come"
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full border border-gray-300 bg-white text-gray-800 text-sm font-medium hover:bg-gray-50 hover:border-gray-400 shadow-sm transition disabled:opacity-50">
                    <Printer size={14}/>EMI card
                  </button>
                )}
                {!r.registryDone && (
                  <button onClick={() => setRegistryFor(r)}
                    className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full border text-sm font-medium shadow-sm transition ${
                      r.readyForRegistry
                        ? 'border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100'
                        : 'border-gray-300 bg-white text-gray-800 hover:bg-gray-50 hover:border-gray-400'}`}>
                    <ScrollText size={14}/>Mark registry
                  </button>
                )}
                <button onClick={() => toggleExpand(r.id)}
                  className="ml-auto inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full border border-gray-300 bg-white text-gray-800 text-sm font-medium hover:bg-gray-50 hover:border-gray-400 shadow-sm transition">
                  {open ? 'Hide details' : 'Details'}<ChevronRight size={14} className={`transition-transform ${open ? 'rotate-90' : ''}`}/>
                </button>
              </div>

              {/* Expanded — full data + secondary actions */}
              {open && (
                <div className="mt-5 pt-5 border-t border-gray-100 space-y-5">
                  {/* Status list */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-1.5 text-[13px]">
                    <DetailRow icon={r.pm.token > 0 ? '✓' : '○'} label="Token"
                      value={r.pm.token > 0 ? `${formatINR(r.pm.token)} received` : 'not received'}
                      tone={r.pm.token > 0 ? 'emerald' : 'gray'}/>

                    <DetailRow
                      icon={r.pm.booking > 0 ? (r.bookingShortfall > 0 ? '◴' : '✓') : '○'}
                      label="Booking deposit"
                      value={
                        r.pm.booking > 0
                          ? r.bookingShortfall > 0
                            ? `${formatINR(r.pm.booking)} of ${formatINR(r.pm.booking + r.bookingShortfall)} (partial)`
                            : `${formatINR(r.pm.booking)} paid`
                          : r.expected > 0 ? `${formatINR(r.expected)} expected (unpaid)` : 'pending'
                      }
                      tone={r.pm.booking > 0 ? (r.bookingShortfall > 0 ? 'amber' : 'blue') : 'amber'}/>

                    <DetailRow
                      icon={r.emi ? (r.emi.overdue > 0 ? '◴' : '✓') : '○'}
                      label="EMI left"
                      value={
                        r.emi
                          ? `${formatINR(r.emi.amount_left)} · ${r.emi.left} of ${r.emi.total} instalment${r.emi.left === 1 ? '' : 's'}`
                          : r.hasBooking ? 'no schedule yet' : '—'
                      }
                      sub={
                        r.emi
                          ? (r.emi.overdue > 0
                              ? `${r.emi.overdue} overdue · ${formatINR(r.emi.amount_overdue)} past due`
                              : r.emi.next_due ? `next ${formatDate(r.emi.next_due)}${r.emi.per_inst ? ` · ${formatINR(r.emi.per_inst)} ea` : ''}` : undefined)
                          : undefined
                      }
                      tone={r.emi ? (r.emi.overdue > 0 ? 'rose' : 'blue') : 'gray'}/>

                    <DetailRow icon={r.brokers ? '●' : '○'} label="Broker"
                      value={r.brokers ? r.brokers.name : 'no broker assigned'}
                      tone="blue"
                      onClick={r.brokers ? () => navigate(`/broker/dashboard?broker_id=${r.broker_id}`) : undefined}
                      sub={r.chain.length > 1 ? `↑ ${r.chain.slice(1, 4).map((c: any) => c.name).join(' → ')}${r.chain.length > 4 ? ` …+${r.chain.length - 4}` : ''}` : undefined}/>

                    <DetailRow icon="✓" label="MLM net distributed"
                      value={`${formatINR(r.mlm.net)} · ${r.mlm.rows} row${r.mlm.rows === 1 ? '' : 's'}`}
                      tone="emerald"/>

                    <DetailRow icon="₹" label="Total paid / net"
                      value={`${formatINR(r.paid)} / ${formatINR(r.total)}`}
                      tone="gray"/>
                  </div>

                  {/* Customer contact + secondary actions */}
                  <div className="flex flex-wrap items-center gap-2">
                    {cust?.phone && (
                      <>
                        <a href={`tel:${cust.phone}`} className="inline-flex items-center gap-1.5 text-[12px] px-3 py-1.5 rounded-full border border-gray-200 text-gray-700 hover:bg-gray-50">
                          <Phone size={12}/>{cust.phone}
                        </a>
                        <a href={`https://wa.me/${String(cust.phone).replace(/[^\d]/g,'')}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-[12px] px-3 py-1.5 rounded-full border border-gray-200 text-gray-700 hover:bg-gray-50">
                          <MessageCircle size={12}/>WhatsApp
                        </a>
                      </>
                    )}
                    <div className="ml-auto flex flex-wrap gap-1.5">
                      {r.hasToken && r.balance > 0 && r.hasBooking && (
                        <button onClick={() => setPayFor({ booking: r, type: 'booking' })}
                          className="inline-flex items-center gap-1 text-[12px] px-3 py-1.5 rounded-full border border-gray-200 text-gray-700 hover:bg-gray-50">
                          <Banknote size={12}/>Add booking payment
                        </button>
                      )}
                      {r.balance > 0 && (
                        <button onClick={() => setEmiBooking(r)}
                          className="inline-flex items-center gap-1 text-[12px] px-3 py-1.5 rounded-full border border-gray-200 text-gray-700 hover:bg-gray-50">
                          <Calculator size={12}/>{r.emi ? 'EMI schedule' : 'Start EMI'}
                        </button>
                      )}
                      <button onClick={() => navigate(`/bookings?edit=${r.id}`)}
                        className="inline-flex items-center gap-1 text-[12px] px-3 py-1.5 rounded-full border border-gray-200 text-gray-700 hover:bg-gray-50">
                        <FileText size={12}/>Edit
                      </button>
                      {/* Kept inside Details rather than on the row: deleting a booking is
                          not a one-tap action, and the modal refuses outright once any
                          money is attached. */}
                      <button onClick={() => setDeleteFor(r)}
                        className="inline-flex items-center gap-1 text-[12px] px-3 py-1.5 rounded-full border border-rose-200 text-rose-700 hover:bg-rose-50">
                        <Trash2 size={12}/>Delete
                      </button>
                      <button onClick={async () => {
                          // Fetch every verified payment for this booking, oldest first, then print the form with full history
                          const { data: pays } = await supabase
                            .from('bp_payments')
                            .select('id, amount, payment_type, payment_mode, payment_date, receipt_no, utr_ref, instalment_no, created_at')
                            .eq('booking_id', r.id)
                            .eq('verification_status', 'verified')
                            .order('payment_date', { ascending: true })
                          printApplicationForm(r, { payments: pays || [] })
                        }}
                        className="inline-flex items-center gap-1 text-[12px] px-3 py-1.5 rounded-full border border-gray-200 text-gray-700 hover:bg-gray-50">
                        <Printer size={12}/>Form
                      </button>
                    </div>
                  </div>

                  {/* Payment history — reprint individual receipts for any past verified payment
                      (booking deposit, token, EMI instalments).  Lazy-loaded the first time the row
                      is expanded so we don't fan out queries for collapsed rows. */}
                  <PaymentHistoryList booking={r} customer={cust} />
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Pagination — server-side range; total comes from the bookings query's count.
          Designed to stay responsive at 10,000+ rows by only fetching PAGE_SIZE at a time. */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="text-[12px] text-gray-500">
            Page <b>{page + 1}</b> of <b>{totalPages}</b> · showing {rows.length} of {totalBookings.toLocaleString('en-IN')}
          </div>
          <div className="inline-flex items-center gap-1">
            <button onClick={() => setPage(0)} disabled={page === 0}
              className="px-3 py-1.5 text-xs rounded-full bg-white border border-gray-200 text-gray-700 disabled:opacity-40 disabled:cursor-not-allowed hover:border-gray-300">« First</button>
            <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
              className="px-3 py-1.5 text-xs rounded-full bg-white border border-gray-200 text-gray-700 disabled:opacity-40 disabled:cursor-not-allowed hover:border-gray-300">‹ Prev</button>
            <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}
              className="px-3 py-1.5 text-xs rounded-full bg-white border border-gray-200 text-gray-700 disabled:opacity-40 disabled:cursor-not-allowed hover:border-gray-300">Next ›</button>
            <button onClick={() => setPage(totalPages - 1)} disabled={page >= totalPages - 1}
              className="px-3 py-1.5 text-xs rounded-full bg-white border border-gray-200 text-gray-700 disabled:opacity-40 disabled:cursor-not-allowed hover:border-gray-300">Last »</button>
          </div>
        </div>
      )}

      {/* EMI panel (reuse from Bookings) */}
      {/* Closing the panel refreshes the list: an EMI collected or a plan created inside it
          moves the booking between tiles, and the row used to stay in its old bucket. */}
      <EmiPanel booking={emiBooking} open={!!emiBooking} onClose={() => { setEmiBooking(null); refreshPipeline() }}/>

      {/* Quick payment modal */}
      <RecordPaymentModal
        open={!!payFor}
        booking={payFor?.booking}
        type={payFor?.type || 'token'}
        onClose={() => setPayFor(null)}
        onSubmit={(form: any) => recordPay.mutate({ booking: payFor!.booking, type: payFor!.type, ...form })}
        submitting={recordPay.isPending}
      />

      {/* Post-dated cheque */}
      <AddChequeModal
        booking={chequeFor}
        open={!!chequeFor}
        onClose={() => setChequeFor(null)}
        onSubmit={(f: any) => addCheque.mutate({ booking: chequeFor, ...f })}
        submitting={addCheque.isPending}
      />

      {/* Registry */}
      <MarkRegistryModal
        booking={registryFor}
        open={!!registryFor}
        onClose={() => setRegistryFor(null)}
        onSubmit={(f: any) => markRegistry.mutate({ booking: registryFor, ...f })}
        submitting={markRegistry.isPending}
      />

      <DeleteBookingModal
        booking={deleteFor}
        open={!!deleteFor}
        onClose={() => setDeleteFor(null)}
        onConfirm={() => removeBooking.mutate(deleteFor)}
        deleting={removeBooking.isPending}
      />

      {/* Edit customer modal */}
      <EditCustomerModal
        customer={editCustomer}
        open={!!editCustomer}
        onClose={() => setEditCustomer(null)}
        onSubmit={(data: any) => updateCustomer.mutate(data)}
        submitting={updateCustomer.isPending}
      />
    </div>
  )
}

// Mirrors bp_pdc_cheques' payment_type check constraint, so a cheque entered here can
// always create its payment when it clears.
const CHEQUE_TOWARDS = [
  { value: 'emi',          label: 'EMI instalment' },
  { value: 'booking',      label: 'Booking amount' },
  { value: 'token',        label: 'Token' },
  { value: 'full_payment', label: 'Full payment' },
]

function AddChequeModal({ booking, open, onClose, onSubmit, submitting }: any) {
  const [f, setF] = useState<any>({})
  useEffect(() => {
    if (!open || !booking) return
    setF({
      cheque_no: '', bank_name: '', branch: '',
      cheque_date: today(), amount: '',
      payment_type: booking.emi ? 'emi' : 'booking',
      notes: '',
    })
  }, [open, booking?.id])
  const set = (k: string, v: string) => setF((p: any) => ({ ...p, [k]: v }))
  if (!booking) return null
  const amt = Number(f.amount) || 0
  return (
    <Modal open={open} onClose={onClose} title={`Add PDC cheque · ${booking.bp_customers?.name || ''}`} size="sm">
      <div className="space-y-4">
        <div className="text-[13px] space-y-1.5">
          <Leader label="Booking" value={booking.booking_no || '—'}/>
          {/* With no price there is no balance to show — "₹0" in green read as "nothing owed". */}
          {!booking.priceMissing && (
            <Leader label="Balance remaining" value={formatINR(booking.balance)} accent={booking.balance > 0 ? 'text-orange-700' : 'text-emerald-700'}/>
          )}
          {booking.pdc?.open > 0 && (
            <Leader label="Cheques already on file" value={`${booking.pdc.open} · ${formatINR(booking.pdc.openAmount)}`} accent="text-purple-700"/>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3 pt-2 border-t border-gray-100">
          <Input label="Cheque number" value={f.cheque_no} onChange={(e: any) => set('cheque_no', e.target.value)} autoFocus/>
          <Input label="Amount (₹)" type="number" value={f.amount} onChange={(e: any) => set('amount', e.target.value)}/>
          <Input label="Date on the cheque" type="date" value={f.cheque_date} onChange={(e: any) => set('cheque_date', e.target.value)}/>
          <Select label="Money goes towards" value={f.payment_type} onChange={(e: any) => set('payment_type', e.target.value)}>
            {CHEQUE_TOWARDS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </Select>
          <Input label="Bank" value={f.bank_name} onChange={(e: any) => set('bank_name', e.target.value)}/>
          <Input label="Branch" value={f.branch} onChange={(e: any) => set('branch', e.target.value)}/>
          <div className="col-span-2"><Input label="Notes" value={f.notes} onChange={(e: any) => set('notes', e.target.value)}/></div>
        </div>
        <p className="text-[11px] text-gray-500">
          A cheque on file is not a payment. Nothing is added to the customer's paid amount and no
          commission moves until it is marked cleared on the PDC register.
        </p>
      </div>
      <div className="flex justify-end gap-2 mt-5">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button onClick={() => onSubmit(f)} loading={submitting} disabled={!f.cheque_no?.trim() || !(amt > 0) || !f.cheque_date}>
          <Landmark size={14}/>Add cheque
        </Button>
      </div>
    </Modal>
  )
}

function MarkRegistryModal({ booking, open, onClose, onSubmit, submitting }: any) {
  const [f, setF] = useState<any>({})
  useEffect(() => {
    if (!open || !booking) return
    setF({
      registry_date: booking.registry_date || today(),
      registry_doc_no: booking.registry_doc_no || '',
      registry_office: booking.registry_office || '',
      registry_notes: '',
      ack_balance: false,
    })
  }, [open, booking?.id])
  const set = (k: string, v: any) => setF((p: any) => ({ ...p, [k]: v }))
  if (!booking) return null
  const plotCount = (booking.bp_booking_plots || []).length
  const owes = booking.balance > 0
  return (
    <Modal open={open} onClose={onClose} title={`Mark registry done · ${booking.bp_customers?.name || ''}`} size="sm">
      <div className="space-y-4">
        <div className="text-[13px] space-y-1.5">
          <Leader label="Booking" value={booking.booking_no || '—'}/>
          <Leader label="Paid" value={formatINR(booking.paid)} accent="text-emerald-700"/>
          <Leader label="Balance remaining" value={formatINR(booking.balance)} accent={owes ? 'text-orange-700' : 'text-emerald-700'}/>
        </div>

        {owes && (
          <label className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 cursor-pointer">
            <input type="checkbox" className="mt-0.5 rounded" checked={!!f.ack_balance}
              onChange={e => set('ack_balance', e.target.checked)}/>
            <span className="text-[12px] text-amber-900">
              This customer still owes <b>{formatINR(booking.balance)}</b>. Register anyway — I have confirmed
              the balance is settled outside the system.
            </span>
          </label>
        )}

        <div className="grid grid-cols-2 gap-3 pt-2 border-t border-gray-100">
          <Input label="Registry date" type="date" value={f.registry_date} onChange={(e: any) => set('registry_date', e.target.value)}/>
          <Input label="Registered document no." value={f.registry_doc_no} onChange={(e: any) => set('registry_doc_no', e.target.value)} placeholder="as on the deed"/>
          <div className="col-span-2"><Input label="Sub-registrar office" value={f.registry_office} onChange={(e: any) => set('registry_office', e.target.value)}/></div>
          <div className="col-span-2"><Input label="Notes" value={f.registry_notes} onChange={(e: any) => set('registry_notes', e.target.value)}/></div>
        </div>

        <p className="text-[11px] text-gray-500">
          {plotCount > 0
            ? `${plotCount} plot${plotCount === 1 ? '' : 's'} on this booking will move to Registry done and leave the available pool.`
            : 'No plot is linked to this booking, so only the deed details are recorded.'}
        </p>
      </div>
      <div className="flex justify-end gap-2 mt-5">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button onClick={() => onSubmit(f)} loading={submitting} disabled={!f.registry_date || (owes && !f.ack_balance)}>
          <ScrollText size={14}/>Record registry
        </Button>
      </div>
    </Modal>
  )
}

function EditCustomerModal({ customer, open, onClose, onSubmit, submitting }: any) {
  const [f, setF] = useState<any>({})
  useEffect(() => {
    if (!open || !customer) return
    setF({
      name: customer.name || '',
      phone: customer.phone || '',
      father_or_husband_name: customer.father_or_husband_name || '',
      email: customer.email || '',
      pan: customer.pan || '',
      aadhaar: customer.aadhaar || '',
      address: customer.address || '',
      dob: customer.dob || '',
      nominee_name: customer.nominee_name || '',
      nominee_relation: customer.nominee_relation || '',
    })
  }, [open, customer?.id])
  const set = (k: string, v: string) => setF((p: any) => ({ ...p, [k]: v }))
  if (!customer) return null
  const isMissing = (customer.name || '').startsWith('NAME MISSING')
  return (
    <Modal open={open} onClose={onClose} title="Edit Customer" size="md">
      {isMissing && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg px-3 py-2 mb-4 text-[12px] text-amber-800">
          This customer was auto-created during a data repair. Please fill in the real name and phone from the original Excel sheet.
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Input label="Full Name" value={f.name} onChange={(e: any) => set('name', e.target.value)} autoFocus />
        <Input label="Mobile" value={f.phone} onChange={(e: any) => set('phone', e.target.value)} />
        <Input label="Father / Husband" value={f.father_or_husband_name} onChange={(e: any) => set('father_or_husband_name', e.target.value)} />
        <Input label="Date of Birth" type="date" value={f.dob} onChange={(e: any) => set('dob', e.target.value)} />
        <Input label="Email" value={f.email} onChange={(e: any) => set('email', e.target.value)} />
        <Input label="PAN" value={f.pan} onChange={(e: any) => set('pan', e.target.value.toUpperCase())} />
        <Input label="Aadhaar" value={f.aadhaar} onChange={(e: any) => set('aadhaar', e.target.value)} />
        <div />
        <div className="col-span-2">
          <Input label="Address" value={f.address} onChange={(e: any) => set('address', e.target.value)} />
        </div>
        <Input label="Nominee Name" value={f.nominee_name} onChange={(e: any) => set('nominee_name', e.target.value)} />
        <Input label="Nominee Relation" value={f.nominee_relation} onChange={(e: any) => set('nominee_relation', e.target.value)} />
      </div>
      <div className="flex justify-between items-center mt-5">
        <span className="text-[11px] text-gray-400 font-mono">{customer.customer_code}</span>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={() => onSubmit({ id: customer.id, ...f })} loading={submitting}>
            Save
          </Button>
        </div>
      </div>
    </Modal>
  )
}

// Lists every verified payment on a booking, with a "Reprint receipt" button per row.
// Used inside the expanded pipeline row so an admin can issue a duplicate token / booking-deposit
// / EMI receipt without having to dig through the Payments page.
function PaymentHistoryList({ booking, customer }: { booking: any; customer: any }) {
  const { data: payments = [], isLoading } = useQuery({
    queryKey: ['cp_payment_history', booking.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('bp_payments')
        .select('id, amount, payment_type, payment_mode, payment_date, receipt_no, utr_ref, instalment_no, verification_status, notes, created_at, print_count')
        .eq('booking_id', booking.id)
        .eq('verification_status', 'verified')
        .order('payment_date', { ascending: false })
      if (error) throw error
      return data || []
    },
  })

  if (isLoading) return (
    <div className="text-[12px] text-gray-400">Loading payment history…</div>
  )

  if (!payments.length) return (
    <div className="text-[12px] text-gray-400 italic">No verified payments yet on this booking.</div>
  )

  const reprint = (p: any) => printPaymentReceipt(p, {
    customer,
    booking,
    project: booking.bp_projects,
    plot: booking.bp_plots,
  })

  const labelFor = (p: any) => {
    if (p.payment_type === 'emi') return `EMI #${p.instalment_no || '?'}`
    if (p.payment_type === 'booking') return 'Booking deposit'
    if (p.payment_type === 'token') return 'Token'
    if (p.payment_type === 'full') return 'Full settlement'
    return p.payment_type || 'Payment'
  }

  return (
    <div className="rounded-2xl border border-gray-100 bg-gray-50/40 overflow-hidden">
      <div className="px-4 py-2 flex items-center justify-between border-b border-gray-100">
        <h4 className="text-[12px] font-semibold text-gray-700 inline-flex items-center gap-1.5">
          <Printer size={12} className="text-gray-500"/>Receipts
          <span className="text-[11px] text-gray-400 font-normal">({payments.length})</span>
        </h4>
        <span className="text-[10px] text-gray-400">Tap any row to reprint that receipt.</span>
      </div>
      <div className="divide-y divide-gray-100">
        {payments.map((p: any) => (
          <button
            key={p.id}
            onClick={() => reprint(p)}
            className="w-full text-left px-4 py-2 flex items-center gap-3 hover:bg-white transition"
          >
            <div className="shrink-0 w-7 h-7 rounded-full bg-white border border-gray-200 flex items-center justify-center text-gray-500">
              <Printer size={12}/>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap text-[12px]">
                <span className="font-semibold text-gray-900">{labelFor(p)}</span>
                {p.receipt_no && <span className="font-mono text-[10px] text-gray-400">{p.receipt_no}</span>}
                <span className="text-[10px] text-gray-400">· {(p.payment_mode || '—').toUpperCase()}</span>
                {p.utr_ref && <span className="text-[10px] text-gray-400">· UTR {p.utr_ref}</span>}
              </div>
              <div className="text-[11px] text-gray-500 mt-0.5">{formatDate(p.payment_date)}</div>
            </div>
            <div className="shrink-0 text-right">
              <div className="text-[13px] font-semibold text-emerald-700 tabular-nums">{formatINR(Number(p.amount || 0))}</div>
              <div className="text-[10px] text-blue-600 inline-flex items-center gap-0.5"><Printer size={10}/>Reprint</div>
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}

function CustomerStat({ label, value, sub, tone = 'gray' }: { label: string; value: string; sub?: string; tone?: 'gray'|'emerald'|'amber'|'rose' }) {
  const tones = {
    gray:    'text-gray-900',
    emerald: 'text-emerald-700',
    amber:   'text-amber-700',
    rose:    'text-rose-700',
  } as const
  return (
    <div className="bg-white/70 backdrop-blur-sm rounded-lg border border-blue-100 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-gray-500 font-medium">{label}</div>
      <div className={`text-base font-bold tabular-nums ${tones[tone]}`}>{value}</div>
      {sub && <div className="text-[10px] text-gray-400 mt-0.5">{sub}</div>}
    </div>
  )
}

function TabTile({ active, onClick, label, value, sub, tint }: any) {
  const dotColor: Record<string, string> = {
    indigo:  'bg-gray-900',
    amber:   'bg-amber-400',
    blue:    'bg-blue-500',
    emerald: 'bg-emerald-500',
    rose:    'bg-rose-500',
    slate:   'bg-slate-400',
    violet:  'bg-violet-500',
  }
  return (
    <button onClick={onClick}
      className={`text-left rounded-2xl border px-4 py-3.5 transition bg-white ${active ? 'border-gray-900 ring-1 ring-gray-900/5' : 'border-gray-200 hover:border-gray-300'}`}>
      <div className="flex items-center gap-1.5 mb-1">
        <span className={`w-1.5 h-1.5 rounded-full ${dotColor[tint] || 'bg-gray-400'}`}/>
        <span className="text-[11px] uppercase tracking-wider text-gray-500">{label}</span>
      </div>
      <div className="text-2xl font-bold text-gray-900 tabular-nums">{value}</div>
      {sub && <div className="text-[11px] text-gray-400 mt-0.5">{sub}</div>}
    </button>
  )
}

function Milestone({ done, partial, label }: { done?: boolean; partial?: boolean; label: string }) {
  const dotCls = done ? 'bg-gray-900' : partial ? 'bg-amber-400 ring-2 ring-amber-200' : 'bg-gray-200'
  return (
    <div className="flex flex-col items-center gap-1 shrink-0">
      <div className={`w-2.5 h-2.5 rounded-full ${dotCls}`}/>
      <span className="text-[10px] text-gray-400 hidden sm:block">{label}</span>
    </div>
  )
}

function Connector({ done }: { done?: boolean }) {
  return <div className={`h-px flex-1 ${done ? 'bg-gray-900' : 'bg-gray-200'}`}/>
}

const TONE: Record<string, string> = {
  emerald: 'text-emerald-700',
  blue:    'text-blue-700',
  amber:   'text-amber-700',
  rose:    'text-rose-700',
  gray:    'text-gray-900',
}

function DetailRow({ icon, label, value, sub, tone = 'gray', onClick }: any) {
  const inner = (
    <div className="flex items-baseline gap-2 py-1">
      <span className={`w-4 text-center shrink-0 text-[13px] ${TONE[tone] || 'text-gray-600'}`}>{icon}</span>
      <span className="text-gray-500 shrink-0">{label}</span>
      <span className="mx-1 flex-1 border-b border-dotted border-gray-200 self-end mb-1"/>
      <div className="text-right shrink-0">
        <div className={`font-medium ${TONE[tone] || 'text-gray-900'}`}>{value}</div>
        {sub && <div className="text-[11px] text-gray-400">{sub}</div>}
      </div>
    </div>
  )
  if (onClick) return <button type="button" onClick={onClick} className="text-left w-full hover:opacity-80 cursor-pointer">{inner}</button>
  return inner
}

function RecordPaymentModal({ open, booking, type, onClose, onSubmit, submitting }: any) {
  const [form, setForm] = useState<any>({ amount: '', expected: '', mode: 'cash', date: today(), utr: '', drawn_on: '', branch: '' })
  // Reset form whenever the modal (re)opens for a booking — useEffect is correct here, not useMemo (which is for memoization, not side effects).
  // Keying on booking.id ensures the form re-initializes if admin closes one row's modal and opens another.
  useEffect(() => {
    if (!open || !booking) return
    setForm({
      amount: '',
      // Pre-fill with current expected; admin can change OR clear (clearing = leave the saved value alone on submit)
      expected: booking.expected > 0 ? String(booking.expected) : '',
      mode: 'cash', date: today(), utr: '', drawn_on: '', branch: '',
    })
  }, [open, booking?.id, type])
  const set = (k: string, v: any) => setForm((p: any) => ({ ...p, [k]: v }))

  if (!booking) return null

  const amt = Number(form.amount) || 0
  // Use the LIVE expected from the form, so admin's edit is reflected in shortfall + presets
  const liveExpected = type === 'booking' ? Number(form.expected) || 0 : 0
  const expectedRemaining = liveExpected > 0 ? Math.max(0, liveExpected - Number(booking.pm?.booking || 0)) : 0
  const balanceAfter = Math.max(0, Number(booking.balance) - amt)

  // Quick-amount presets
  const presets: { label: string; value: number; tone: string }[] = []
  if (type === 'booking' && expectedRemaining > 0) {
    presets.push({ label: `Expected · ${formatINR(expectedRemaining)}`, value: expectedRemaining, tone: 'bg-gray-900 text-white border-gray-900' })
    presets.push({ label: `Half · ${formatINR(Math.round(expectedRemaining / 2))}`, value: Math.round(expectedRemaining / 2), tone: 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50' })
  }
  // No "full balance" button when there is no price: it would offer to record ₹0.
  if (booking.balance > 0) {
    presets.push({ label: `Full balance · ${formatINR(booking.balance)}`, value: booking.balance, tone: 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50' })
  }

  return (
    <Modal open={open} onClose={onClose} title={type === 'token' ? `Record token · ${booking.bp_customers?.name || ''}` : `Record booking deposit · ${booking.bp_customers?.name || ''}`} size="sm">
      <div className="space-y-4">
        {/* Context — leader-dot rows (Apple style) */}
        <div className="text-[13px] space-y-1.5">
          <Leader label="Total plot value" value={booking.priceMissing ? 'Not set yet' : formatINR(booking.total)} accent={booking.priceMissing ? 'text-amber-700' : undefined}/>
          <Leader label="Already paid" value={formatINR(booking.paid)} accent="text-emerald-700"/>
          {type === 'booking' && Number(booking.pm?.booking || 0) > 0 && (
            <Leader label="Booking deposit so far" value={formatINR(booking.pm.booking)} accent="text-blue-700"/>
          )}
          <Leader label="Balance remaining" value={formatINR(booking.balance)} accent={booking.balance > 0 ? 'text-orange-700' : 'text-emerald-700'}/>
        </div>

        {/* EXPECTED BOOKING AMOUNT — editable, only for booking type */}
        {type === 'booking' && (
          <div className="pt-2 border-t border-gray-100">
            <label className="text-[13px] font-semibold text-gray-900 block mb-1">Expected booking amount</label>
            <p className="text-[11px] text-gray-500 mb-2">The planned booking deposit for this deal. We use it to compute the shortfall — and save it on the booking so the Pipeline shows the right state next time.</p>
            <input type="number" value={form.expected} onChange={e => set('expected', e.target.value)}
              placeholder="e.g. 1,00,000 (or leave blank if no fixed commitment)"
              className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-900"/>
          </div>
        )}

        {/* AMOUNT RECEIVED TODAY — the only required input */}
        <div className="pt-2 border-t border-gray-100">
          <label className="text-[13px] font-semibold text-gray-900 block mb-1">Amount received today (₹)</label>
          <p className="text-[11px] text-gray-500 mb-2">{type === 'token' ? 'How much the customer is paying for the token.' : 'How much the customer is paying right now. Can be any value — full, partial, or extra.'}</p>
          <input type="number" autoFocus value={form.amount} onChange={e => set('amount', e.target.value)}
            placeholder="0"
            className="w-full border border-gray-300 rounded-lg px-3 py-2 text-base font-semibold tabular-nums focus:outline-none focus:border-gray-900"/>

          {/* Quick presets */}
          <div className="flex flex-wrap gap-1.5 mt-2">
            {presets.map(p => (
              <button key={p.label} type="button" onClick={() => set('amount', String(p.value))}
                className={`text-[11px] px-2.5 py-1 rounded-full border ${p.tone}`}>{p.label}</button>
            ))}
          </div>

          {/* Live feedback */}
          {amt > 0 && (
            <div className="mt-2.5 text-[11px] space-y-0.5">
              {type === 'booking' && liveExpected > 0 && amt < expectedRemaining && (
                <div className="text-amber-700">⏳ Partial booking deposit · shortfall {formatINR(expectedRemaining - amt)} (carries forward, can be collected later)</div>
              )}
              {type === 'booking' && liveExpected > 0 && amt >= expectedRemaining && (
                <div className="text-emerald-700">✓ Booking deposit fully covered{amt > expectedRemaining ? ` · ${formatINR(amt - expectedRemaining)} extra towards balance` : ''}</div>
              )}
              {booking.priceMissing ? (
                <div className="text-amber-700">No price on this booking yet — the payment is recorded now; the balance is worked out once the plot and price are set.</div>
              ) : (
                <>
                  {amt > booking.balance && (
                    <div className="text-rose-700">⚠ Amount exceeds balance ({formatINR(booking.balance)}). Excess will be recorded but not applied to outstanding.</div>
                  )}
                  {amt <= booking.balance && <div className="text-gray-500">Balance after this payment: <b className="text-orange-700">{formatINR(balanceAfter)}</b></div>}
                </>
              )}
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3 pt-2 border-t border-gray-100">
          <Select label="Mode" value={form.mode} onChange={(e: any) => set('mode', e.target.value)}>
            {PAYMENT_MODES.map(m => <option key={m} value={m}>{m.toUpperCase()}</option>)}
          </Select>
          <Input label="Date" type="date" value={form.date} onChange={(e: any) => set('date', e.target.value)}/>
          <Input label="UTR / Reference" value={form.utr} onChange={(e: any) => set('utr', e.target.value)} className="col-span-2"/>
          <Input label="Drawn on (bank)" value={form.drawn_on} onChange={(e: any) => set('drawn_on', e.target.value)}/>
          <Input label="Branch" value={form.branch} onChange={(e: any) => set('branch', e.target.value)}/>
        </div>

        <div className="text-[11px] text-gray-500">
          Per-payment MLM commission will be distributed to the broker chain automatically.
        </div>
      </div>
      <div className="flex justify-end gap-2 mt-5">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button onClick={() => onSubmit({
          amount: amt,
          // If field is blank → don't touch existing value (undefined).
          // If admin typed 0 → explicitly clear it (null), so the row no longer shows a shortfall.
          expected_booking_amount: type !== 'booking' || form.expected === '' ? undefined : (Number(form.expected) > 0 ? Number(form.expected) : null),
          mode: form.mode, date: form.date, utr: form.utr, drawn_on: form.drawn_on, branch: form.branch,
        })} loading={submitting} disabled={!amt}>
          <IndianRupee size={14}/>Record &amp; distribute MLM
        </Button>
      </div>
    </Modal>
  )
}

function Leader({ label, value, accent }: any) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-gray-500">{label}</span>
      <span className="mx-1 flex-1 border-b border-dotted border-gray-200 self-end mb-1"/>
      <span className={`font-semibold tabular-nums ${accent || 'text-gray-900'}`}>{value}</span>
    </div>
  )
}
