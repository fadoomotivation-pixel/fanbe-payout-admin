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
import { printApplicationForm, printPaymentReceipt } from '@/lib/printTemplates'
import EmiPanel from '@/components/EmiPanel'
import {
  Users, Search, Filter, ChevronRight, Banknote, Calculator, ArrowUpRight,
  CheckCircle2, AlertTriangle, Coins, Phone, MessageCircle, IndianRupee, X, ExternalLink,
  FileText, Printer, Pencil,
} from 'lucide-react'
import toast from 'react-hot-toast'

type Tab = 'all' | 'unpaid_booking' | 'emi_active' | 'settled'

const STAGE_COLORS: Record<string, string> = {
  token_received: 'bg-orange-50 text-orange-700 border-orange-200',
  booking_done:   'bg-green-50 text-green-700 border-green-200',
  cancelled:      'bg-red-50 text-red-700 border-red-200',
}

const PAYMENT_MODES = ['cash','neft','rtgs','imps','upi','cheque','dd']

const today = () => new Date().toISOString().slice(0, 10)

const PAGE_SIZE = 25
const SEARCH_DEBOUNCE_MS = 300

// Built so the page stays responsive at 10,000+ bookings: pagination + debounced server-side
// search + per-page derived queries.  Earlier .limit(500) loaded everything and filtered in
// the browser — fine at small scale, broken at production scale.
export default function CustomerPipeline() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  // Customer focus — when present, the page renders a customer-aggregate header at the
  // top and filters the bookings list to just this customer's deals.  This is the entry
  // point that replaces the deleted /customer-history page; old /customer-history?customer=X
  // links redirect here in App.tsx.
  const customerFocusId = searchParams.get('customer')
  const [tab, setTab] = useState<Tab>('all')
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [searchScope, setSearchScope] = useState<'all' | 'customer' | 'broker' | 'booking' | 'plot'>('all')
  const [filterBroker, setFilterBroker] = useState('')
  const [filterProject, setFilterProject] = useState('')
  const [page, setPage] = useState(0)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [emiBooking, setEmiBooking] = useState<any>(null)
  const [payFor, setPayFor] = useState<{ booking: any; type: 'token' | 'booking' } | null>(null)
  const [editCustomer, setEditCustomer] = useState<any>(null)

  // Fetch the focused customer's profile + aggregate stats across ALL their bookings.
  // This is the data that used to live on the deleted /customer-history page — it gives
  // admin a "total picture" of the customer (cost, paid, outstanding, overdue) so they
  // don't have to mentally sum across multiple booking rows.
  const { data: customerFocus, isFetched: customerFocusFetched } = useQuery({
    queryKey: ['cp_customer_focus', customerFocusId],
    enabled: !!customerFocusId,
    queryFn: async () => {
      const today = new Date().toISOString().slice(0, 10)
      const [{ data: c }, { data: bks }] = await Promise.all([
        supabase.from('bp_customers').select('id, customer_code, name, phone, email, address, father_or_husband_name, pan, dob, nominee_name, nominee_relation').eq('id', customerFocusId!).maybeSingle(),
        supabase.from('bp_bookings').select('id, booking_no, total_amount, plot_total_price, total_collected, stage').eq('customer_id', customerFocusId!),
      ])
      const bookingIds = (bks || []).map((b: any) => b.id)
      const [{ data: pays }, { data: emis }] = await Promise.all([
        bookingIds.length
          ? supabase.from('bp_payments').select('amount, verification_status, booking_id').in('booking_id', bookingIds)
          : Promise.resolve({ data: [] as any[] }),
        bookingIds.length
          ? supabase.from('emi_installments').select('amount, paid_amount, status, due_date, booking_id').in('booking_id', bookingIds)
          : Promise.resolve({ data: [] as any[] }),
      ])
      const totalCost   = (bks || []).reduce((s, b: any) => s + Number(b.total_amount || b.plot_total_price || 0), 0)
      const paid        = (pays || []).filter((p: any) => p.verification_status === 'verified').reduce((s, p: any) => s + Number(p.amount || 0), 0)
      const overdueAmt  = (emis || []).filter((e: any) => e.status !== 'paid' && (e.due_date || '') <= today)
                                       .reduce((s, e: any) => s + Math.max(0, Number(e.amount || 0) - Number(e.paid_amount || 0)), 0)
      const overdueCnt  = (emis || []).filter((e: any) => e.status !== 'paid' && (e.due_date || '') <= today).length
      return {
        customer: c,
        bookingCount: (bks || []).length,
        totalCost,
        paid,
        outstanding: Math.max(0, totalCost - paid),
        collectionPct: totalCost > 0 ? Math.round((paid / totalCost) * 100) : 0,
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
  useEffect(() => { setPage(0) }, [tab, debouncedSearch, searchScope, filterBroker, filterProject])

  // Server-side search: resolve customer/broker IDs that match the query, then constrain bookings
  // via OR across booking_no.ilike and the resolved IDs.  PostgREST can't filter on nested table
  // columns directly, so we do this two-step lookup ourselves.
  const { data: searchTargets } = useQuery({
    queryKey: ['cp_search_targets', debouncedSearch, searchScope],
    enabled: !!debouncedSearch,
    queryFn: async () => {
      const q = debouncedSearch
      const wantsCustomer = searchScope === 'all' || searchScope === 'customer'
      const wantsBroker   = searchScope === 'all' || searchScope === 'broker'
      const wantsPlot     = searchScope === 'all' || searchScope === 'plot'
      const [cust, brk, plots] = await Promise.all([
        wantsCustomer
          ? supabase.from('bp_customers').select('id').or(`name.ilike.%${q}%,phone.ilike.%${q}%,customer_code.ilike.%${q}%`).limit(500)
          : Promise.resolve({ data: [] as any[] }),
        wantsBroker
          ? supabase.from('brokers').select('id').or(`name.ilike.%${q}%,broker_id.ilike.%${q}%`).limit(500)
          : Promise.resolve({ data: [] as any[] }),
        wantsPlot
          ? supabase.from('bp_plots').select('id').ilike('plot_no', `%${q}%`).limit(500)
          : Promise.resolve({ data: [] as any[] }),
      ])
      return {
        customerIds: (cust.data || []).map((r: any) => r.id),
        brokerIds:   (brk.data  || []).map((r: any) => r.id),
        plotIds:     (plots.data || []).map((r: any) => r.id),
      }
    },
  })

  // Build the bookings query: server-side filter + sort + range pagination + count.
  const bookingsQueryKey = useMemo(() => ['cp_bookings_page', tab, debouncedSearch, searchScope, filterBroker, filterProject, page, searchTargets, customerFocusId], [tab, debouncedSearch, searchScope, filterBroker, filterProject, page, searchTargets, customerFocusId])
  const { data: pageResult, isLoading } = useQuery({
    queryKey: bookingsQueryKey,
    queryFn: async () => {
      let q = supabase
        .from('bp_bookings')
        .select(`
          id, booking_no, legacy_booking_no, stage, application_date, total_amount, plot_total_price,
          token_amount, booking_amount, full_payment_amount,
          expected_booking_amount, commission_amount, commission_rate,
          commission_mode, traditional_commission_pct, traditional_commission_per_sqyd, traditional_pay_upline,
          broker_id, customer_id, plot_id, project_id, closed_at,
          bp_customers(id, customer_code, name, phone),
          bp_plots(plot_no, size_sqyd, sector, block),
          bp_projects(name, location),
          brokers(name, broker_id, rank)
        `, { count: 'exact' })
        .not('stage', 'eq', 'cancelled')
        .order('created_at', { ascending: false })

      // Customer focus narrows the list to one customer's deals (replaces the deleted
      // /customer-history page).  Applied before any other filter.
      if (customerFocusId) q = q.eq('customer_id', customerFocusId)
      if (filterBroker)  q = q.eq('broker_id',  filterBroker)
      if (filterProject) q = q.eq('project_id', filterProject)

      if (debouncedSearch) {
        const orParts: string[] = []
        if (searchScope === 'all' || searchScope === 'booking') {
          orParts.push(`booking_no.ilike.%${debouncedSearch}%`)
          // Imported bookings also carry their old paper-register number, and admin
          // searches by whichever one is in front of them.
          orParts.push(`legacy_booking_no.ilike.%${debouncedSearch}%`)
        }
        if ((searchScope === 'all' || searchScope === 'customer') && searchTargets?.customerIds?.length) {
          orParts.push(`customer_id.in.(${searchTargets.customerIds.join(',')})`)
        }
        if ((searchScope === 'all' || searchScope === 'broker') && searchTargets?.brokerIds?.length) {
          orParts.push(`broker_id.in.(${searchTargets.brokerIds.join(',')})`)
        }
        if ((searchScope === 'all' || searchScope === 'plot') && searchTargets?.plotIds?.length) {
          orParts.push(`plot_id.in.(${searchTargets.plotIds.join(',')})`)
        }
        if (orParts.length === 0) {
          // No targets matched at all — short-circuit to empty result without hitting bookings.
          return { rows: [] as any[], total: 0 }
        }
        q = q.or(orParts.join(','))
      }

      q = q.range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)
      const { data, error, count } = await q
      if (error) throw error
      return { rows: data || [], total: count || 0 }
    },
  })
  const bookings = pageResult?.rows ?? []
  const totalBookings = pageResult?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(totalBookings / PAGE_SIZE))

  const bookingIds = useMemo(() => bookings.map((b: any) => b.id), [bookings])

  const { data: paymentsByBooking = {} } = useQuery<Record<string, { token: number; booking: number; emi: number; full: number; total: number; last_date: string | null }>>({
    queryKey: ['cp_payments', bookingIds],
    enabled: bookingIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('bp_payments')
        .select('booking_id, amount, payment_type, payment_date, verification_status')
        .in('booking_id', bookingIds)
        .eq('verification_status', 'verified')
      if (error) throw error
      const m: Record<string, any> = {}
      for (const p of (data || [])) {
        if (!p.booking_id) continue
        if (!m[p.booking_id]) m[p.booking_id] = { token: 0, booking: 0, emi: 0, full: 0, total: 0, last_date: null }
        const amt = Number(p.amount || 0)
        m[p.booking_id].total += amt
        if (p.payment_type === 'token')        m[p.booking_id].token   += amt
        if (p.payment_type === 'booking')      m[p.booking_id].booking += amt
        if (p.payment_type === 'emi')          m[p.booking_id].emi     += amt
        if (p.payment_type === 'full_payment') m[p.booking_id].full    += amt
        if (!m[p.booking_id].last_date || (p.payment_date && p.payment_date > m[p.booking_id].last_date)) {
          m[p.booking_id].last_date = p.payment_date
        }
      }
      return m
    },
  })

  const { data: emiSummary = {} } = useQuery<Record<string, { schedule_id: string; n: number; paid: number; partial: number; overdue: number; next_due: string | null; per_inst: number }>>({
    queryKey: ['cp_emi', bookingIds],
    enabled: bookingIds.length > 0,
    queryFn: async () => {
      const { data: scheds } = await supabase
        .from('emi_schedules')
        .select('id, booking_id, num_installments')
        .in('booking_id', bookingIds)
      const schedIds = (scheds || []).map((s: any) => s.id)
      if (schedIds.length === 0) return {}
      const { data: insts } = await supabase
        .from('emi_installments')
        .select('schedule_id, due_date, amount, paid_amount, status')
        .in('schedule_id', schedIds)
      const schedToBooking: Record<string, string> = {}
      for (const s of (scheds || [])) schedToBooking[s.id] = s.booking_id
      const todayStr = today()
      const out: Record<string, any> = {}
      for (const s of (scheds || [])) {
        const bid = schedToBooking[s.id]
        out[bid] = { schedule_id: s.id, n: s.num_installments, paid: 0, partial: 0, overdue: 0, next_due: null as string | null, per_inst: 0 }
      }
      for (const i of (insts || [])) {
        const bid = schedToBooking[i.schedule_id]
        if (!bid) continue
        const row = out[bid]
        if (!row.per_inst && i.amount) row.per_inst = i.amount
        if (i.status === 'paid')    row.paid++
        if (i.status === 'partial') row.partial++
        if (i.status !== 'paid' && i.due_date < todayStr) row.overdue++
        if (i.status !== 'paid' && (!row.next_due || i.due_date < row.next_due)) row.next_due = i.due_date
      }
      return out
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
      // UTR uniqueness — bail before inserting the row so the commission trigger doesn't
      // fire on a payment that will need to be reversed.
      const trimmedUtr = (p.utr || '').trim()
      if (trimmedUtr) {
        const conflict = await findUtrConflict(trimmedUtr)
        if (conflict) throw new Error(utrConflictMessage(conflict))
      }
      const { data: rn } = await supabase.rpc('generate_receipt_no', { p_customer_id: p.booking.customer_id })
      const { data: payment, error } = await supabase.from('bp_payments').insert({
        booking_id: p.booking.id, customer_id: p.booking.customer_id,
        payment_type: p.type, amount: p.amount, payment_mode: p.mode,
        payment_date: p.date, verification_status: 'verified',
        verified_at: new Date().toISOString(),
        receipt_no: rn || null,
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
      qc.invalidateQueries({ queryKey: ['cp_bookings'] })
      qc.invalidateQueries({ queryKey: ['cp_payments'] })
      qc.invalidateQueries({ queryKey: ['cp_mlm'] })
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
      qc.invalidateQueries({ queryKey: ['cp_bookings_page'] })
      qc.invalidateQueries({ queryKey: ['cp_customer_focus'] })
      qc.invalidateQueries({ queryKey: ['cp_search_targets'] })
      qc.invalidateQueries({ queryKey: ['bookings'] })
      toast.success('Customer updated')
      setEditCustomer(null)
    },
    onError: (e: any) => toast.error(e.message),
  })

  // ── Derive per-row state ───────────────────────────────────────────
  const rows = useMemo(() => {
    return (bookings as any[]).map((b: any) => {
      const pm = paymentsByBooking[b.id] || { token: 0, booking: 0, emi: 0, full: 0, total: 0, last_date: null }
      const total = Number(b.total_amount || b.plot_total_price || 0)
      const paid  = pm.total
      const balance = Math.max(0, total - paid)
      const emi = emiSummary[b.id]
      const mlm = mlmByBooking[b.id] || { rows: 0, net: 0 }
      const chain = brokerChains[b.broker_id] || []
      const expected = Number(b.expected_booking_amount || 0)
      const hasToken   = pm.token > 0
      const hasBooking = pm.booking > 0
      const bookingShortfall = expected > 0 && pm.booking < expected ? expected - pm.booking : 0
      const category: Tab =
        balance <= 0 && total > 0  ? 'settled'
      : (hasToken && !hasBooking && pm.full === 0) ? 'unpaid_booking'
      : (!!emi && balance > 0)      ? 'emi_active'
                                    : 'all'
      return {
        ...b, pm, total, paid, balance, emi, mlm, chain, expected,
        hasToken, hasBooking, bookingShortfall, category,
      }
    })
  }, [bookings, paymentsByBooking, emiSummary, mlmByBooking, brokerChains])

  // Global counts (independent of the visible page) so the four KPI tiles still show the truth.
  // Run as a single round-trip with head:true counts; cheap even at 10k+ bookings.
  const { data: globalStats } = useQuery({
    queryKey: ['cp_global_stats'],
    queryFn: async () => {
      const { count: all } = await supabase.from('bp_bookings').select('id', { count: 'exact', head: true }).not('stage', 'eq', 'cancelled')
      return { all: all || 0 }
    },
  })

  // Tab-scoped stats use the current page's data (derived locally).  At 10k+ rows it's
  // intentionally a snapshot — admins switch tabs which re-queries with that tab applied.
  const stats = useMemo(() => {
    const all = globalStats?.all ?? totalBookings
    const unpaid = rows.filter(r => r.category === 'unpaid_booking').length
    const emi    = rows.filter(r => r.category === 'emi_active').length
    const settled = rows.filter(r => r.category === 'settled').length
    const expectedAmt = rows.filter(r => r.category === 'unpaid_booking').reduce((s, r) => s + r.expected, 0)
    const balanceAmt  = rows.reduce((s, r) => s + r.balance, 0)
    return { all, unpaid, emi, settled, expectedAmt, balanceAmt }
  }, [rows, globalStats, totalBookings])

  // Tab filter is applied locally to the current page.  Search / broker / project are server-side
  // (handled in the bookings query above) so the user can navigate the full data set.
  const filtered = useMemo(() => {
    if (tab === 'all') return rows
    return rows.filter(r => r.category === tab)
  }, [rows, tab])

  const toggleExpand = (id: string) => setExpanded(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })

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
              <button onClick={clearCustomerFocus} className="text-xs text-blue-700 hover:text-blue-900 underline">
                Clear filter →
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-5 gap-2 mt-4">
            <CustomerStat label="Bookings"        value={String(customerFocus.bookingCount)} sub="lifetime"/>
            <CustomerStat label="Total cost"      value={formatINR(customerFocus.totalCost)} sub="all bookings"/>
            <CustomerStat label="Paid"            value={formatINR(customerFocus.paid)} sub={`${customerFocus.collectionPct}% collected`} tone="emerald"/>
            <CustomerStat label="Outstanding"     value={formatINR(customerFocus.outstanding)} sub="still due" tone={customerFocus.outstanding > 0 ? 'amber' : 'gray'}/>
            <CustomerStat label="Overdue EMI"     value={formatINR(customerFocus.overdueAmt)} sub={`${customerFocus.overdueCnt} past-due`} tone={customerFocus.overdueAmt > 0 ? 'rose' : 'gray'}/>
          </div>
        </div>
      )}

      {/* KPI tiles + tabs combined */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <TabTile active={tab==='all'}            onClick={() => setTab('all')}
          icon={<Users size={16}/>}              label="All customers"     value={String(stats.all)}                                tint="indigo"/>
        <TabTile active={tab==='unpaid_booking'} onClick={() => setTab('unpaid_booking')}
          icon={<AlertTriangle size={16}/>}      label="Unpaid booking"     value={String(stats.unpaid)} sub={stats.expectedAmt > 0 ? `expects ${formatINR(stats.expectedAmt)}` : 'token paid · deposit pending'} tint="amber"/>
        <TabTile active={tab==='emi_active'}     onClick={() => setTab('emi_active')}
          icon={<Calculator size={16}/>}         label="EMI collection"     value={String(stats.emi)} sub={`balance ${formatINR(stats.balanceAmt)}`}     tint="blue"/>
        <TabTile active={tab==='settled'}        onClick={() => setTab('settled')}
          icon={<CheckCircle2 size={16}/>}       label="Fully settled"      value={String(stats.settled)} sub="zero balance"                              tint="emerald"/>
      </div>

      {/* Search bar — scope dropdown disambiguates whether you mean customer or broker, etc. */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[240px]">
          <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400"/>
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder={
              searchScope === 'customer' ? 'Search customer name / phone / code'
              : searchScope === 'broker' ? 'Search broker name / code'
              : searchScope === 'booking' ? 'Search booking number (BK-…)'
              : searchScope === 'plot' ? 'Search plot number'
              : 'Search anything — pick scope to narrow'
            }
            className="w-full pl-10 pr-3 py-2.5 text-sm bg-white border border-gray-200 rounded-full focus:outline-none focus:border-gray-900 transition"/>
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
        <span className="text-[12px] text-gray-400 tabular-nums ml-auto">
          {totalBookings.toLocaleString('en-IN')} result{totalBookings === 1 ? '' : 's'}
        </span>
      </div>

      {/* Deals list */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-[0_1px_2px_rgba(0,0,0,0.02)] divide-y divide-gray-100 overflow-hidden">
        {isLoading && <div className="py-10 text-center text-sm text-gray-400">Loading…</div>}
        {!isLoading && filtered.length === 0 && (
          <div className="py-12 text-center">
            <div className="text-sm text-gray-400">
              {tab === 'unpaid_booking' && '✓ No deals waiting on booking deposit — well done.'}
              {tab === 'emi_active' && 'No active EMI plans. Once a booking has an EMI schedule and balance, it appears here.'}
              {tab === 'settled' && 'No fully settled deals yet.'}
              {tab === 'all' && 'No customers in pipeline. Create a booking to start.'}
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
          const m4 = r.balance <= 0 && r.total > 0
          const pct = r.total > 0 ? Math.min(100, Math.round((r.paid / r.total) * 100)) : 0
          // ONE primary, contextual call-to-action
          const primary = !r.hasToken && r.balance > 0
              ? { label: 'Record token',          onClick: () => setPayFor({ booking: r, type: 'token' }) }
            : r.hasToken && !r.hasBooking && r.balance > 0
              ? { label: 'Record booking',        onClick: () => setPayFor({ booking: r, type: 'booking' }) }
            : r.hasBooking && r.bookingShortfall > 0
              ? { label: 'Top up booking',        onClick: () => setPayFor({ booking: r, type: 'booking' }) }
            : !r.emi && r.balance > 0
              ? { label: 'Start EMI',             onClick: () => setEmiBooking(r) }
            : r.emi && r.balance > 0
              ? { label: 'Collect EMI payment',   onClick: () => setEmiBooking(r) }
            : null  // settled

          // Next-step subtitle that explains the primary action
          const nextHint = !r.hasToken
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
                  <div className={`text-[18px] font-bold tabular-nums ${r.balance > 0 ? 'text-gray-900' : 'text-emerald-700'}`}>{formatINR(r.balance)}</div>
                  <div className="text-[11px] text-gray-400 tabular-nums">{r.balance > 0 ? `paid ${formatINR(r.paid)} / ${formatINR(r.total)}` : 'settled'}</div>
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

              {/* Single primary CTA + minimal secondary affordances */}
              <div className="mt-4 flex items-center gap-3 flex-wrap">
                {primary ? (
                  <button onClick={primary.onClick}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-gray-900 text-white text-sm font-semibold hover:bg-black shadow-sm transition">
                    {primary.label} <ArrowUpRight size={14}/>
                  </button>
                ) : (
                  <span className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full bg-emerald-50 text-emerald-700 text-sm font-semibold">
                    <CheckCircle2 size={14}/>Settled
                  </span>
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
                      label="EMI"
                      value={
                        r.emi
                          ? `${r.emi.paid + r.emi.partial}/${r.emi.n}${r.emi.overdue > 0 ? ` · ${r.emi.overdue} overdue` : r.emi.next_due ? ` · next ${formatDate(r.emi.next_due)}` : ''}`
                          : r.hasBooking ? 'no schedule yet' : '—'
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
      <EmiPanel booking={emiBooking} open={!!emiBooking} onClose={() => setEmiBooking(null)}/>

      {/* Quick payment modal */}
      <RecordPaymentModal
        open={!!payFor}
        booking={payFor?.booking}
        type={payFor?.type || 'token'}
        onClose={() => setPayFor(null)}
        onSubmit={(form: any) => recordPay.mutate({ booking: payFor!.booking, type: payFor!.type, ...form })}
        submitting={recordPay.isPending}
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
  presets.push({ label: `Full balance · ${formatINR(booking.balance)}`, value: booking.balance, tone: 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50' })

  return (
    <Modal open={open} onClose={onClose} title={type === 'token' ? `Record token · ${booking.bp_customers?.name || ''}` : `Record booking deposit · ${booking.bp_customers?.name || ''}`} size="sm">
      <div className="space-y-4">
        {/* Context — leader-dot rows (Apple style) */}
        <div className="text-[13px] space-y-1.5">
          <Leader label="Total plot value" value={formatINR(booking.total)}/>
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
              {amt > booking.balance && (
                <div className="text-rose-700">⚠ Amount exceeds balance ({formatINR(booking.balance)}). Excess will be recorded but not applied to outstanding.</div>
              )}
              {amt <= booking.balance && <div className="text-gray-500">Balance after this payment: <b className="text-orange-700">{formatINR(balanceAfter)}</b></div>}
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
