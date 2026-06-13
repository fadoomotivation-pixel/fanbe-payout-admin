import { useState, useEffect, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { Table } from '@/components/ui/Table.tsx'
import { Button } from '@/components/ui/Button.tsx'
import { Input, Select, Textarea } from '@/components/ui/Input.tsx'
import { Modal } from '@/components/ui/Modal.tsx'
import { Badge } from '@/components/ui/Badge.tsx'
import { formatINR, formatDate } from '@/lib/utils'
import { printApplicationForm } from '@/lib/printTemplates'
import { logClosure, getCurrentUserId } from '@/lib/closure'
import { ClosureDialog } from '@/components/ClosureDialog'
import { distributePaymentCommission, reverseBookingCommission } from '@/lib/payoutEngine'
import { findUtrConflict, utrConflictMessage } from '@/lib/utr'
import EmiPanel from '@/components/EmiPanel'
import { Plus, ArrowRight, FileText, Printer, Calculator, UserPlus, UserCheck, Info, Banknote, IndianRupee, Lock, Unlock, Search, Download, X, Filter, ChevronDown, Users } from 'lucide-react'
import toast from 'react-hot-toast'

const STAGES = ['token_received','booking_done','cancelled'] as const
type Stage = typeof STAGES[number]

const STAGE_META: Record<Stage, { label: string; color: string }> = {
  token_received: { label: 'Token Received', color: 'bg-orange-50 text-orange-700 border border-orange-200' },
  booking_done:   { label: 'Booking Done',   color: 'bg-green-50 text-green-700 border border-green-200' },
  cancelled:      { label: 'Cancelled',      color: 'bg-red-50 text-red-700 border border-red-200' },
}
const PIPELINE_STAGES: Stage[] = ['token_received','booking_done']

type Category = 'all' | 'token' | 'advance' | 'full' | 'cancelled' | 'closed'

const CATEGORY_META: Record<Category, { label: string; sub: string; activeClass: string; idleClass: string }> = {
  all:       { label: 'All Bookings',    sub: 'Everything across stages',                   activeClass: 'bg-gray-900 text-white border-gray-900',         idleClass: 'bg-white text-gray-600 border-gray-200 hover:border-gray-400' },
  token:     { label: 'Token Booking',   sub: 'Token paid · awaiting booking amount',       activeClass: 'bg-orange-600 text-white border-orange-600',     idleClass: 'bg-white text-orange-700 border-orange-200 hover:border-orange-400' },
  advance:   { label: 'Advance Booking', sub: 'Booking amount paid · EMI in progress',      activeClass: 'bg-blue-600 text-white border-blue-600',         idleClass: 'bg-white text-blue-700 border-blue-200 hover:border-blue-400' },
  full:      { label: 'Full Payment',    sub: 'Fully settled · zero balance',               activeClass: 'bg-emerald-600 text-white border-emerald-600',   idleClass: 'bg-white text-emerald-700 border-emerald-200 hover:border-emerald-400' },
  cancelled: { label: 'Cancelled',       sub: 'Cancelled bookings',                         activeClass: 'bg-red-600 text-white border-red-600',           idleClass: 'bg-white text-red-700 border-red-200 hover:border-red-400' },
  closed:    { label: 'Closed',          sub: 'Locked · settled & archived',                 activeClass: 'bg-slate-900 text-white border-slate-900',        idleClass: 'bg-white text-slate-700 border-slate-300 hover:border-slate-500' },
}

const PAYMENT_MODES = ['cash','neft','rtgs','imps','upi','cheque','dd'] as const
type CustMode = 'existing' | 'new'

const NEW_CUST_EMPTY = {
  name:'', phone:'', email:'', father_or_husband_name:'', dob:'',
  address:'', pan:'',
  nominee_name:'', nominee_relation:'', nominee_dob:'', nominee_father_name:'',
  nominee_address:'', nominee_pan:'',
}

const today = () => new Date().toISOString().slice(0,10)

// Translate Postgres / Supabase error spew into something a non-technical admin can
// read.  Falls back to the original message when we don't recognise the pattern.
function friendlyError(err: any, defaultMsg = 'Could not save the booking.  Please check the fields and try again.') {
  const m = (err?.message || err?.error?.message || String(err || '')).toLowerCase()
  if (!m) return defaultMsg
  if (m.includes('null value in column "broker_id"') || m.includes('broker_id') && m.includes('null')) {
    return 'Please pick the broker who made this sale.  Every booking needs a broker assigned.'
  }
  if (m.includes('null value in column "customer_id"') || m.includes('customer') && m.includes('null')) {
    return 'Please pick or create a customer for this booking.'
  }
  if (m.includes('null value in column "plot_id"') || m.includes('plot_id') && m.includes('null')) {
    return 'Please select a plot for this booking.'
  }
  if (m.includes('duplicate key') && m.includes('utr')) {
    return 'That UTR / reference number has already been used on another payment.'
  }
  if (m.includes('duplicate key')) {
    return 'A booking with the same details already exists.'
  }
  if (m.includes('foreign key') || m.includes('violates') && m.includes('constraint')) {
    return 'One of the linked records (broker, customer or plot) is missing or was deleted.  Please reselect and try again.'
  }
  if (m.includes('jwt') || m.includes('not authenticated') || m.includes('unauthorized')) {
    return 'Your session has expired.  Please sign in again.'
  }
  if (m.includes('network') || m.includes('failed to fetch')) {
    return 'Could not reach the server.  Check your internet connection and try again.'
  }
  return defaultMsg
}

const EMPTY: any = {
  plot_id:'', customer_id:'', broker_id:'', project_id:'', stage:'token_received',
  size_sqyd:'', rate_per_sqyd:'',
  dev_charges:'0', plc_charges:'0', discount_amount:'0',
  // Commission mode — 'mlm' (default, rank-based + upline differential) or 'traditional'
  // (admin-defined commission paid only to the direct broker, with optional upline cascade).
  commission_mode: 'mlm',
  traditional_input: 'pct' as 'pct' | 'per_sqyd', // UI-only: which input field the admin used
  traditional_commission_pct: '',
  traditional_commission_per_sqyd: '',
  traditional_pay_upline: false,
  notes:'',
  application_date: today(), booking_time:'', customer_bank_name:'',
  upline_broker_code:'', manager_signature_by:'', affidavit_accepted:true,
  cust_mode: 'new' as CustMode,
  new_customer: { ...NEW_CUST_EMPTY },
  token_enabled: false,
  token_amount: '', token_date: today(), token_mode: 'cash', token_utr: '', token_drawn_on: '', token_branch: '',
  expected_booking_amount: '',
  booking_enabled: false,
  booking_amount: '', booking_date: today(), booking_mode: 'cash', booking_utr: '', booking_drawn_on: '', booking_branch: '',
  emi_enabled: false,
  emi_n: '12', emi_freq: 'monthly', emi_start: today(),
  full_enabled: false,
  full_amount: '', full_date: today(), full_mode: 'cash', full_utr: '',
}

export default function Bookings() {
  const qc = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()
  // ?mode=traditional puts the whole page into "Traditional Bookings" mode: the list
  // filters to traditional bookings only and the New Booking modal defaults to the
  // traditional form.  Driven by the "Traditional Bookings" sidebar entry.
  const modeFilter = (searchParams.get('mode') === 'traditional') ? 'traditional' as const : 'all' as const
  const [modal, setModal]     = useState(false)
  const [editing, setEditing] = useState<any>(null)
  const [form, setForm]       = useState<any>(EMPTY)
  // Additional brokers for traditional multi-broker splits.  Array of { broker_id, commission_pct, position }.
  // Empty by default; admin clicks "+Add another broker" inside the Traditional panel to add up to 2 more.
  const [splitBrokers, setSplitBrokers] = useState<{ broker_id: string; commission_pct: string; position: number }[]>([])
  const [category, setCategory] = useState<Category>('all')
  const [emiBooking, setEmiBooking] = useState<any>(null)
  const [recordBookingFor, setRecordBookingFor] = useState<any>(null)
  const [closureFor, setClosureFor] = useState<{ booking: any; action: 'close' | 'reopen' } | null>(null)
  const [bulkCloseFor, setBulkCloseFor] = useState<any[] | null>(null)
  // ── Admin filter / search state ─────────────────────────────────────────────────────────────────
  const [search, setSearch] = useState('')
  const [filterProject, setFilterProject] = useState('')
  const [filterBroker, setFilterBroker]   = useState('')
  const [filterStage, setFilterStage]     = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo]     = useState('')
  const [showFilters, setShowFilters] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const set = (k: string, v: any) => setForm((p: any) => ({ ...p, [k]: v }))
  const setNC = (k: string, v: any) => setForm((p: any) => ({ ...p, new_customer: { ...p.new_customer, [k]: v } }))

  const { data: bookings = [], isLoading } = useQuery({
    queryKey: ['bookings'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('bp_bookings')
        .select('*,bp_plots(*),bp_customers(*),brokers(name,broker_id),bp_projects(*)')
        .in('stage', ['token_received','booking_done','cancelled'])
        .order('created_at', { ascending: false })
      if (error) throw error
      return data
    },
  })

  // Sum verified payments per booking → drives the Paid / Balance columns.
  const { data: paidByBooking = {} } = useQuery<Record<string, number>>({
    queryKey: ['payments_by_booking'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('bp_payments')
        .select('booking_id, amount')
        .eq('verification_status', 'verified')
      if (error) throw error
      const out: Record<string, number> = {}
      for (const p of data || []) {
        if (!p.booking_id) continue
        out[p.booking_id] = (out[p.booking_id] || 0) + Number(p.amount || 0)
      }
      return out
    },
  })

  // Booking IDs that already have an EMI schedule — drives "Start EMI" vs "View EMI" labels.
  const { data: emiByBooking = {} } = useQuery<Record<string, boolean>>({
    queryKey: ['emi_schedules_by_booking'],
    queryFn: async () => {
      const { data, error } = await supabase.from('emi_schedules').select('booking_id')
      if (error) throw error
      const out: Record<string, boolean> = {}
      for (const s of data || []) if (s.booking_id) out[s.booking_id] = true
      return out
    },
  })

  const { data: plots = [] } = useQuery({
    queryKey: ['plots_avail'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('bp_plots')
        .select('id, plot_no, size_sqyd, price_per_sqyd, plc_charges, total_price, status, project_id, bp_projects(id, name)')
        .eq('status','available')
        .order('plot_no')
      if (error) throw error
      return data
    },
  })

  const { data: customers = [] } = useQuery({
    queryKey: ['customers'],
    queryFn: async () => {
      const { data, error } = await supabase.from('bp_customers').select('*').order('created_at', { ascending: false })
      if (error) throw error
      return data
    },
  })

  const { data: brokers = [] } = useQuery({
    queryKey: ['brokers'],
    queryFn: async () => {
      // Include broker_type so the booking form can filter the picker by sale mode
      // (MLM brokers for MLM bookings, traditional brokers for traditional bookings).
      const { data, error } = await supabase.from('brokers').select('id,name,broker_id,rank,broker_type,status')
      if (error) throw error
      return data
    },
  })

  const { data: ranks = [] } = useQuery({
    queryKey: ['commission_ranks_active'],
    queryFn: async () => {
      const { data, error } = await supabase.from('commission_ranks').select('rank_name, commission_pct').eq('active', true)
      if (error) throw error
      return data
    },
  })

  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: async () => {
      const { data, error } = await supabase.from('bp_projects').select('id,name,location').order('name')
      if (error) throw error
      return data
    },
  })

  const num = (v: any) => Number(v) || 0
  const round2 = (v: number) => Math.round(v * 100) / 100
  const size  = num(form.size_sqyd)
  const rate  = num(form.rate_per_sqyd)
  const basePrice = Math.round(size * rate)
  const dev   = num(form.dev_charges)
  const plc   = num(form.plc_charges)
  const disc  = num(form.discount_amount)
  const totalNet = Math.max(0, basePrice + dev + plc - disc)

  const selectedBroker = (brokers as any[]).find((b: any) => b.id === form.broker_id)
  const brokerRankPct = selectedBroker
    ? Number((ranks as any[]).find((r: any) => r.rank_name === selectedBroker.rank)?.commission_pct || 0)
    : 0
  const commissionAmt = Math.round(basePrice * brokerRankPct / 100)

  // Pick the right pool of brokers for the current booking mode.  MLM bookings only show
  // MLM brokers (the ones in the sponsor tree); Traditional bookings only show
  // Traditional brokers (standalone, no sponsor cascade).  Keeps the picker honest so
  // admin can't accidentally credit a tree broker on a traditional sale or vice versa.
  const pickerBrokers = useMemo(() => {
    const wantType = form.commission_mode === 'traditional' ? 'traditional' : 'mlm'
    const list = (brokers as any[]).filter((b: any) => {
      if (b.status && b.status !== 'active') return false
      const t = b.broker_type || 'mlm'
      return t === wantType
    })
    // Always include the currently-selected broker even if the type doesn't match
    // (e.g. legacy bookings where the broker was reclassified after the fact) so the
    // dropdown can render the chosen value instead of silently dropping it.
    if (form.broker_id && !list.find((b: any) => b.id === form.broker_id)) {
      const stray = (brokers as any[]).find((b: any) => b.id === form.broker_id)
      if (stray) list.push(stray)
    }
    return list
  }, [brokers, form.commission_mode, form.broker_id])

  async function generateEmiSchedule(bookingId: string, customerId: string|null, principal: number, n: number, freq: string, startDate: string) {
    if (principal <= 0 || n <= 0) return
    const amt = Math.round(principal / n)
    const { data: sched, error } = await supabase.from('emi_schedules').insert({
      booking_id: bookingId, customer_id: customerId,
      frequency: freq, start_date: startDate,
      num_installments: n, principal, total_payable: principal,
      interest_rate_pct: 0, interest_method: 'flat',
    }).select('id').single()
    if (error || !sched) throw error || new Error('Schedule insert failed')
    const offset = freq === 'monthly' ? 1 : freq === 'quarterly' ? 3 : freq === 'half_yearly' ? 6 : 12
    const start = new Date(startDate)
    const rows = Array.from({ length: n }, (_, i) => {
      const d = new Date(start)
      d.setMonth(d.getMonth() + offset * (i + 1))
      return { schedule_id: sched.id, seq: i + 1, due_date: d.toISOString().slice(0,10), amount: amt, principal_component: amt, interest_component: 0, status: 'pending' }
    })
    await supabase.from('emi_installments').insert(rows)
  }

  // Records a bp_payments row + fires per-payment MLM distribution.
  // Returns { paymentId, distributedRows } so callers can surface a toast.
  async function recordPaymentRow(p: any): Promise<{ paymentId: string | null; distributed: number }> {
    if (p.amount <= 0) return { paymentId: null, distributed: 0 }
    // UTR uniqueness — single chokepoint for token / booking / full_payment / extra payments.
    // The booking form lets admin enter the same UTR across separate payment_type buckets,
    // which would create duplicates in bp_payments.  Bail before insert so the trigger
    // doesn't fire on a payment that will need to be reversed.
    const trimmedUtr = (p.utr_ref || '').trim()
    if (trimmedUtr) {
      const conflict = await findUtrConflict(trimmedUtr)
      if (conflict) throw new Error(utrConflictMessage(conflict))
    }
    const { data: rn } = await supabase.rpc('next_receipt_no')
    const { data: inserted, error } = await supabase.from('bp_payments').insert({
      booking_id: p.booking_id, customer_id: p.customer_id,
      payment_type: p.payment_type, amount: p.amount, payment_mode: p.payment_mode,
      utr_ref: trimmedUtr || null, payment_date: p.payment_date,
      verification_status: 'verified', verified_at: new Date().toISOString(),
      receipt_no: rn || null,
      drawn_on_bank: p.drawn_on_bank || (p.payment_mode === 'cash' ? 'Cash' : null),
      branch: p.branch || null, sponsor_name: p.sponsor_name || null,
    }).select('id').single()
    if (error) throw error
    const rows = await distributePaymentCommission({
      bookingId: p.booking_id,
      paymentId: inserted.id,
      amount: Number(p.amount),
    })
    return { paymentId: inserted.id, distributed: rows.length }
  }

  function autoStage(f: any): Stage {
    if (f.full_enabled || f.booking_enabled) return 'booking_done'
    if (f.token_enabled || f.emi_enabled) return 'token_received'
    return 'token_received'
  }

  function plotStatusForStage(stage: Stage): 'available' | 'token' | 'booked' {
    if (stage === 'cancelled') return 'available'
    if (stage === 'token_received') return 'token'
    return 'booked'
  }

  async function syncPlotStatus(plotId: string | null | undefined, stage: Stage) {
    if (!plotId) return
    await supabase.from('bp_plots').update({ status: plotStatusForStage(stage) }).eq('id', plotId)
  }

  const create = useMutation({
    mutationFn: async (p: any) => {
      const { cust_mode, new_customer, ...rest } = p
      let customer_id = rest.customer_id
      if (cust_mode === 'new') {
        if (!new_customer?.name || !new_customer?.phone) throw new Error('New customer name & phone required')
        const { data: nc, error: ncErr } = await supabase.from('bp_customers').insert({
          ...new_customer,
          dob: new_customer.dob || null,
          nominee_dob: new_customer.nominee_dob || null,
        }).select('id').single()
        if (ncErr || !nc) throw ncErr || new Error('Failed to create customer')
        customer_id = nc.id
      }
      const stage = autoStage(rest)
      const project = (projects as any[]).find((pj: any) => pj.id === rest.project_id)
      const broker  = (brokers as any[]).find((b: any) => b.id === rest.broker_id)
      const mlmPct = broker ? Number((ranks as any[]).find((r: any) => r.rank_name === broker.rank)?.commission_pct || 0) : 0
      const sz   = num(rest.size_sqyd); const rt = num(rest.rate_per_sqyd)
      const base = Math.round(sz * rt)
      const d    = num(rest.dev_charges); const pl = num(rest.plc_charges); const dsc = num(rest.discount_amount)
      const total = Math.max(0, base + d + pl - dsc)
      const tokenAmt   = rest.token_enabled   ? num(rest.token_amount) : 0
      const bookingAmt = rest.booking_enabled ? num(rest.booking_amount) : 0
      const fullAmt    = rest.full_enabled    ? (num(rest.full_amount) || total) : 0
      // Traditional-mode commission overrides the MLM rank %.  Only one of pct / per_sqyd is sent
      // (whichever input the admin chose); the trigger reads them and computes the effective
      // direct-broker pct -- per_sqyd is converted to an equivalent % via plot.size_sqyd.
      const isTraditional = rest.commission_mode === 'traditional'
      const tradPct       = isTraditional && rest.traditional_input === 'pct'      ? num(rest.traditional_commission_pct)      : null
      const tradPerSqyd   = isTraditional && rest.traditional_input === 'per_sqyd' ? num(rest.traditional_commission_per_sqyd) : null
      const effectivePct  = isTraditional
        ? (tradPct != null ? tradPct : (tradPerSqyd != null && sz > 0 && total > 0 ? round2((tradPerSqyd * sz / total) * 100) : 0))
        : mlmPct
      const bookingPayload: any = {
        plot_id: rest.plot_id || null, customer_id, broker_id: rest.broker_id || null, project_id: rest.project_id || null,
        stage,
        size_sqyd: sz || null, rate_per_sqyd: rt || null, base_price: base || null,
        dev_charges: d, plc_charges: pl, discount_amount: dsc,
        plot_total_price: total, total_amount: total,
        token_amount: tokenAmt || null, token_date: rest.token_enabled ? rest.token_date : null,
        expected_booking_amount: num(rest.expected_booking_amount) || null,
        booking_amount: bookingAmt || null, booking_date: rest.booking_enabled ? rest.booking_date : null,
        full_payment_amount: fullAmt || null, full_payment_date: rest.full_enabled ? rest.full_date : null,
        commission_mode: isTraditional ? 'traditional' : 'mlm',
        traditional_commission_pct:      tradPct,
        traditional_commission_per_sqyd: tradPerSqyd,
        traditional_pay_upline:          isTraditional ? !!rest.traditional_pay_upline : false,
        commission_rate:                 effectivePct || null,
        commission_amount:               effectivePct > 0 ? Math.round(base * effectivePct / 100) : null,
        notes: rest.notes || null, scheme_name: project?.name || null,
        application_date: rest.application_date || null, booking_time: rest.booking_time || null,
        customer_bank_name: rest.customer_bank_name || null,
        upline_broker_code: rest.upline_broker_code || null,
        manager_signature_by: rest.manager_signature_by || null,
        affidavit_accepted: !!rest.affidavit_accepted,
        payment_type: rest.emi_enabled ? 'emi' : (rest.full_enabled ? 'full' : (rest.booking_enabled ? 'booking' : 'token')),
      }
      const { data: bk, error } = await supabase.from('bp_bookings').insert(bookingPayload).select().single()
      if (error) throw error
      // Multi-broker traditional split (1..3 brokers).  Only written when this is a
      // traditional booking AND admin added at least one extra broker.  Position 1 is the
      // primary broker (bp_bookings.broker_id) + their traditional_commission_pct; we
      // duplicate it into bp_booking_brokers so the trigger only has to read one source.
      const splits = (rest.splitBrokers || []) as any[]
      if (isTraditional && splits.length > 0 && tradPct != null && tradPct > 0) {
        const rows = [
          { booking_id: bk.id, broker_id: rest.broker_id, commission_pct: tradPct, position: 1 },
          ...splits
            .filter((s: any) => s.broker_id && num(s.commission_pct) > 0)
            .map((s: any, i: number) => ({ booking_id: bk.id, broker_id: s.broker_id, commission_pct: num(s.commission_pct), position: i + 2 })),
        ]
        if (rows.length > 1) {
          await supabase.from('bp_booking_brokers').insert(rows)
        }
      }
      const sponsorName = broker?.name || null
      let distributed = 0
      if (rest.token_enabled && tokenAmt > 0) {
        const r = await recordPaymentRow({ booking_id: bk.id, customer_id, payment_type: 'token',        amount: tokenAmt,   payment_date: rest.token_date,   payment_mode: rest.token_mode,   utr_ref: rest.token_utr,   drawn_on_bank: rest.token_drawn_on,   branch: rest.token_branch,   sponsor_name: sponsorName })
        distributed += r.distributed
      }
      if (rest.booking_enabled && bookingAmt > 0) {
        const r = await recordPaymentRow({ booking_id: bk.id, customer_id, payment_type: 'booking',      amount: bookingAmt, payment_date: rest.booking_date, payment_mode: rest.booking_mode, utr_ref: rest.booking_utr, drawn_on_bank: rest.booking_drawn_on, branch: rest.booking_branch, sponsor_name: sponsorName })
        distributed += r.distributed
      }
      if (rest.full_enabled