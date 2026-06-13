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
  const modeFilter = (searchParams.get('mode') === 'traditional') ? 'traditional' as const : 'all' as const
  const [modal, setModal]     = useState(false)
  const [editing, setEditing] = useState<any>(null)
  const [form, setForm]       = useState<any>(EMPTY)
  const [splitBrokers, setSplitBrokers] = useState<{ broker_id: string; commission_pct: string; position: number }[]>([])
  const [category, setCategory] = useState<Category>('all')
  const [emiBooking, setEmiBooking] = useState<any>(null)
  const [recordBookingFor, setRecordBookingFor] = useState<any>(null)
  const [closureFor, setClosureFor] = useState<{ booking: any; action: 'close' | 'reopen' } | null>(null)
  const [bulkCloseFor, setBulkCloseFor] = useState<any[] | null>(null)
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

  // Pick the right pool of brokers for the current booking mode.
  // MLM bookings -> only MLM brokers. Traditional bookings -> only Traditional brokers.
  const pickerBrokers = useMemo(() => {
    const wantType = form.commission_mode === 'traditional' ? 'traditional' : 'mlm'
    const list = (brokers as any[]).filter((b: any) => {
      if (b.status && b.status !== 'active') return false
      const t = b.broker_type || 'mlm'
      return t === wantType
    })
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

  async function recordPaymentRow(p: any): Promise<{ paymentId: string | null; distributed: number }> {
    if (p.amount <= 0) return { paymentId: null, distributed: 0 }
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
        const r = await recordPaymentRow({ booking_id: bk.id, customer_id, payment_type: 'token',   amount: tokenAmt,   payment_date: rest.token_date,   payment_mode: rest.token_mode,   utr_ref: rest.token_utr,   drawn_on_bank: rest.token_drawn_on,   branch: rest.token_branch,   sponsor_name: sponsorName })
        distributed += r.distributed
      }
      if (rest.booking_enabled && bookingAmt > 0) {
        const r = await recordPaymentRow({ booking_id: bk.id, customer_id, payment_type: 'booking', amount: bookingAmt, payment_date: rest.booking_date, payment_mode: rest.booking_mode, utr_ref: rest.booking_utr, drawn_on_bank: rest.booking_drawn_on, branch: rest.booking_branch, sponsor_name: sponsorName })
        distributed += r.distributed
      }
      if (rest.full_enabled && fullAmt > 0) {
        const r = await recordPaymentRow({ booking_id: bk.id, customer_id, payment_type: 'full_payment', amount: fullAmt, payment_date: rest.full_date, payment_mode: rest.full_mode, utr_ref: rest.full_utr, sponsor_name: sponsorName })
        distributed += r.distributed
      }
      if (rest.emi_enabled) {
        const emiPrincipal = total - tokenAmt - bookingAmt - fullAmt
        if (emiPrincipal > 0) {
          await generateEmiSchedule(bk.id, customer_id, emiPrincipal, num(rest.emi_n) || 12, rest.emi_freq || 'monthly', rest.emi_start || today())
        }
      }
      await syncPlotStatus(rest.plot_id, stage)
      return { booking: bk, distributed }
    },
    onSuccess: ({ booking, distributed }) => {
      qc.invalidateQueries({ queryKey: ['bookings'] })
      qc.invalidateQueries({ queryKey: ['payments_by_booking'] })
      qc.invalidateQueries({ queryKey: ['plots_avail'] })
      qc.invalidateQueries({ queryKey: ['emi_schedules_by_booking'] })
      const msg = distributed > 0
        ? `Booking saved · ${distributed} commission row${distributed > 1 ? 's' : ''} distributed`
        : 'Booking saved'
      toast.success(msg)
      setModal(false)
      setForm(EMPTY)
      setSplitBrokers([])
    },
    onError: (err: any) => {
      console.error('Booking create error:', err)
      toast.error(friendlyError(err))
    },
  })

  const update = useMutation({
    mutationFn: async (p: any) => {
      const { id, cust_mode, new_customer, splitBrokers: spBrokers, ...rest } = p
      const stage = autoStage(rest)
      const sz  = num(rest.size_sqyd); const rt = num(rest.rate_per_sqyd)
      const base = Math.round(sz * rt)
      const d   = num(rest.dev_charges); const pl = num(rest.plc_charges); const dsc = num(rest.discount_amount)
      const total = Math.max(0, base + d + pl - dsc)
      const isTraditional = rest.commission_mode === 'traditional'
      const tradPct       = isTraditional && rest.traditional_input === 'pct'      ? num(rest.traditional_commission_pct)      : null
      const tradPerSqyd   = isTraditional && rest.traditional_input === 'per_sqyd' ? num(rest.traditional_commission_per_sqyd) : null
      const broker = (brokers as any[]).find((b: any) => b.id === rest.broker_id)
      const mlmPct = broker ? Number((ranks as any[]).find((r: any) => r.rank_name === broker.rank)?.commission_pct || 0) : 0
      const effectivePct = isTraditional
        ? (tradPct != null ? tradPct : (tradPerSqyd != null && sz > 0 && total > 0 ? round2((tradPerSqyd * sz / total) * 100) : 0))
        : mlmPct
      const { error } = await supabase.from('bp_bookings').update({
        plot_id: rest.plot_id || null, broker_id: rest.broker_id || null, project_id: rest.project_id || null,
        stage,
        size_sqyd: sz || null, rate_per_sqyd: rt || null, base_price: base || null,
        dev_charges: d, plc_charges: pl, discount_amount: dsc,
        plot_total_price: total, total_amount: total,
        token_amount: rest.token_enabled ? num(rest.token_amount) : null,
        token_date:   rest.token_enabled ? rest.token_date : null,
        expected_booking_amount: num(rest.expected_booking_amount) || null,
        booking_amount: rest.booking_enabled ? num(rest.booking_amount) : null,
        booking_date:   rest.booking_enabled ? rest.booking_date : null,
        full_payment_amount: rest.full_enabled ? (num(rest.full_amount) || total) : null,
        full_payment_date:   rest.full_enabled ? rest.full_date : null,
        commission_mode: isTraditional ? 'traditional' : 'mlm',
        traditional_commission_pct:      tradPct,
        traditional_commission_per_sqyd: tradPerSqyd,
        traditional_pay_upline:          isTraditional ? !!rest.traditional_pay_upline : false,
        commission_rate:   effectivePct || null,
        commission_amount: effectivePct > 0 ? Math.round(base * effectivePct / 100) : null,
        notes: rest.notes || null,
        application_date: rest.application_date || null,
        booking_time: rest.booking_time || null,
        customer_bank_name: rest.customer_bank_name || null,
        upline_broker_code: rest.upline_broker_code || null,
        manager_signature_by: rest.manager_signature_by || null,
        affidavit_accepted: !!rest.affidavit_accepted,
      }).eq('id', id)
      if (error) throw error
      if (isTraditional && spBrokers && spBrokers.length > 0 && tradPct != null && tradPct > 0) {
        await supabase.from('bp_booking_brokers').delete().eq('booking_id', id)
        const rows = [
          { booking_id: id, broker_id: rest.broker_id, commission_pct: tradPct, position: 1 },
          ...spBrokers
            .filter((s: any) => s.broker_id && num(s.commission_pct) > 0)
            .map((s: any, i: number) => ({ booking_id: id, broker_id: s.broker_id, commission_pct: num(s.commission_pct), position: i + 2 })),
        ]
        if (rows.length > 1) await supabase.from('bp_booking_brokers').insert(rows)
      }
      await syncPlotStatus(rest.plot_id, stage)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bookings'] })
      qc.invalidateQueries({ queryKey: ['plots_avail'] })
      toast.success('Booking updated')
      setModal(false)
      setEditing(null)
      setForm(EMPTY)
      setSplitBrokers([])
    },
    onError: (err: any) => {
      console.error('Booking update error:', err)
      toast.error(friendlyError(err))
    },
  })

  function openCreate() {
    setEditing(null)
    setForm({ ...EMPTY, commission_mode: modeFilter === 'traditional' ? 'traditional' : 'mlm' })
    setSplitBrokers([])
    setModal(true)
  }

  function openEdit(b: any) {
    setEditing(b)
    setForm({
      ...EMPTY,
      plot_id: b.plot_id || '', customer_id: b.customer_id || '', broker_id: b.broker_id || '',
      project_id: b.project_id || '', stage: b.stage || 'token_received',
      size_sqyd: b.size_sqyd || '', rate_per_sqyd: b.rate_per_sqyd || '',
      dev_charges: b.dev_charges ?? '0', plc_charges: b.plc_charges ?? '0', discount_amount: b.discount_amount ?? '0',
      commission_mode: b.commission_mode || 'mlm',
      traditional_input: b.traditional_commission_per_sqyd != null ? 'per_sqyd' : 'pct',
      traditional_commission_pct: b.traditional_commission_pct ?? '',
      traditional_commission_per_sqyd: b.traditional_commission_per_sqyd ?? '',
      traditional_pay_upline: b.traditional_pay_upline ?? false,
      notes: b.notes || '',
      application_date: b.application_date || today(),
      booking_time: b.booking_time || '',
      customer_bank_name: b.customer_bank_name || '',
      upline_broker_code: b.upline_broker_code || '',
      manager_signature_by: b.manager_signature_by || '',
      affidavit_accepted: b.affidavit_accepted ?? true,
      cust_mode: 'existing' as CustMode,
      token_enabled: !!b.token_amount,
      token_amount: b.token_amount || '', token_date: b.token_date || today(),
      token_mode: 'cash', token_utr: '', token_drawn_on: '', token_branch: '',
      expected_booking_amount: b.expected_booking_amount || '',
      booking_enabled: !!b.booking_amount,
      booking_amount: b.booking_amount || '', booking_date: b.booking_date || today(),
      booking_mode: 'cash', booking_utr: '', booking_drawn_on: '', booking_branch: '',
      emi_enabled: false, emi_n: '12', emi_freq: 'monthly', emi_start: today(),
      full_enabled: !!b.full_payment_amount,
      full_amount: b.full_payment_amount || '', full_date: b.full_payment_date || today(), full_mode: 'cash', full_utr: '',
    })
    setSplitBrokers([])
    setModal(true)
  }

  // ── Filtering ──────────────────────────────────────────────────────────────────────────────────
  const filtered = (bookings as any[]).filter((b: any) => {
    if (modeFilter === 'traditional' && b.commission_mode !== 'traditional') return false
    const paid = paidByBooking[b.id] || 0
    const total = Number(b.total_amount || 0)
    if (category === 'token')     return b.stage === 'token_received' && !b.closed_at
    if (category === 'advance')   return b.stage === 'booking_done' && paid < total && !b.closed_at
    if (category === 'full')      return b.stage === 'booking_done' && paid >= total && total > 0 && !b.closed_at
    if (category === 'cancelled') return b.stage === 'cancelled'
    if (category === 'closed')    return !!b.closed_at
    return true
  }).filter((b: any) => {
    if (filterProject && b.project_id !== filterProject) return false
    if (filterBroker  && b.broker_id  !== filterBroker)  return false
    if (filterStage   && b.stage      !== filterStage)   return false
    if (dateFrom && b.application_date && b.application_date < dateFrom) return false
    if (dateTo   && b.application_date && b.application_date > dateTo)   return false
    if (!search) return true
    const q = search.toLowerCase()
    return (
      b.bp_customers?.name?.toLowerCase().includes(q) ||
      b.brokers?.name?.toLowerCase().includes(q) ||
      b.booking_no?.toLowerCase().includes(q) ||
      b.bp_plots?.plot_no?.toLowerCase().includes(q) ||
      b.bp_projects?.name?.toLowerCase().includes(q)
    )
  })

  const allSelected = filtered.length > 0 && filtered.every((b: any) => selectedIds.has(b.id))
  const toggleAll = () => {
    if (allSelected) setSelectedIds(new Set())
    else setSelectedIds(new Set(filtered.map((b: any) => b.id)))
  }

  const plotOptions = (plots as any[]).map((p: any) => ({
    value: p.id,
    label: `${p.plot_no} — ${p.bp_projects?.name || ''} | ${p.size_sqyd} sqyd @ ₹${p.price_per_sqyd}/sqyd (Total ₹${(p.total_price || 0).toLocaleString('en-IN')})`,
  }))

  const customerOptions = (customers as any[]).map((c: any) => ({ value: c.id, label: `${c.name} — ${c.phone}` }))
  const brokerOptions   = pickerBrokers.map((b: any) => ({ value: b.id, label: `${b.name} (${b.broker_id}) — ${b.rank || 'N/A'}` }))
  const projectOptions  = (projects as any[]).map((p: any) => ({ value: p.id, label: p.name }))

  const handlePlotSelect = (plotId: string) => {
    const plot = (plots as any[]).find((p: any) => p.id === plotId)
    if (!plot) { set('plot_id', plotId); return }
    set('plot_id', plotId)
    if (!form.size_sqyd)     set('size_sqyd',     plot.size_sqyd     || '')
    if (!form.rate_per_sqyd) set('rate_per_sqyd', plot.price_per_sqyd || '')
    if (!form.plc_charges)   set('plc_charges',   plot.plc_charges   || '0')
    if (!form.project_id && plot.project_id) set('project_id', plot.project_id)
  }

  const isMLM = form.commission_mode !== 'traditional'

  return (
    <div className="p-6 space-y-6">
      {/* ── Header ── */}
      <div className="flex items-center justify-between">
        <div>
          {modeFilter === 'traditional' ? (
            <>
              <h1 className="text-2xl font-bold text-gray-900">Traditional Bookings</h1>
              <p className="text-sm text-gray-500 mt-0.5">
                Showing traditional-commission bookings only ·{' '}
                <Link to="/bookings" className="text-blue-600 hover:underline">All bookings</Link>
              </p>
            </>
          ) : (
            <h1 className="text-2xl font-bold text-gray-900">Bookings</h1>
          )}
        </div>
        <div className="flex gap-2">
          {selectedIds.size > 0 && (
            <Button variant="outline" size="sm"
              onClick={() => {
                const sel = filtered.filter((b: any) => selectedIds.has(b.id) && !b.closed_at && b.stage === 'booking_done')
                if (sel.length) setBulkCloseFor(sel)
                else toast.error('Select booking_done (open) bookings to bulk-close')
              }}
            >
              <Lock className="w-4 h-4 mr-1" /> Close Selected ({selectedIds.size})
            </Button>
          )}
          <Button onClick={openCreate}><Plus className="w-4 h-4 mr-1" />New Booking</Button>
        </div>
      </div>

      {/* ── Category tabs ── */}
      <div className="flex flex-wrap gap-2">
        {(Object.keys(CATEGORY_META) as Category[]).map(c => (
          <button key={c} onClick={() => setCategory(c)}
            className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-all ${
              category === c ? CATEGORY_META[c].activeClass : CATEGORY_META[c].idleClass
            }`}
          >
            {CATEGORY_META[c].label}
          </button>
        ))}
      </div>

      {/* ── Filters ── */}
      <div className="space-y-3">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Search by customer, broker, booking no, plot, project…"
              className="w-full pl-9 pr-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
          <Button variant="outline" size="sm" onClick={() => setShowFilters(f => !f)}>
            <Filter className="w-4 h-4 mr-1" />
            Filters
            {(filterProject || filterBroker || filterStage || dateFrom || dateTo) && (
              <span className="ml-1 w-2 h-2 rounded-full bg-blue-500 inline-block" />
            )}
            <ChevronDown className={`w-3 h-3 ml-1 transition-transform ${showFilters ? 'rotate-180' : ''}`} />
          </Button>
          {(filterProject || filterBroker || filterStage || dateFrom || dateTo) && (
            <Button variant="ghost" size="sm" onClick={() => { setFilterProject(''); setFilterBroker(''); setFilterStage(''); setDateFrom(''); setDateTo('') }}>
              <X className="w-4 h-4 mr-1" /> Clear
            </Button>
          )}
        </div>
        {showFilters && (
          <div className="grid grid-cols-2 md:grid-cols-5 gap-2 p-3 bg-gray-50 rounded-lg border border-gray-100">
            <select value={filterProject} onChange={e => setFilterProject(e.target.value)}
              className="border border-gray-200 rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500">
              <option value="">All Projects</option>
              {(projects as any[]).map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <select value={filterBroker} onChange={e => setFilterBroker(e.target.value)}
              className="border border-gray-200 rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500">
              <option value="">All Brokers</option>
              {(brokers as any[]).map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
            <select value={filterStage} onChange={e => setFilterStage(e.target.value)}
              className="border border-gray-200 rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500">
              <option value="">All Stages</option>
              {STAGES.map(s => <option key={s} value={s}>{STAGE_META[s].label}</option>)}
            </select>
            <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}
              className="border border-gray-200 rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
              placeholder="From date" />
            <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)}
              className="border border-gray-200 rounded-md px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500"
              placeholder="To date" />
          </div>
        )}
      </div>

      {/* ── Table ── */}
      {isLoading ? (
        <div className="text-center py-12 text-gray-400">Loading bookings…</div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="pb-3 text-left w-8">
                  <input type="checkbox" checked={allSelected} onChange={toggleAll} className="rounded" />
                </th>
                <th className="pb-3 text-left font-medium text-gray-500">Booking #</th>
                <th className="pb-3 text-left font-medium text-gray-500">Customer</th>
                <th className="pb-3 text-left font-medium text-gray-500">Plot</th>
                <th className="pb-3 text-left font-medium text-gray-500">Project</th>
                <th className="pb-3 text-left font-medium text-gray-500">Broker</th>
                <th className="pb-3 text-right font-medium text-gray-500">Total</th>
                <th className="pb-3 text-right font-medium text-gray-500">Paid</th>
                <th className="pb-3 text-right font-medium text-gray-500">Balance</th>
                <th className="pb-3 text-left font-medium text-gray-500">Stage</th>
                <th className="pb-3 text-left font-medium text-gray-500">Date</th>
                <th className="pb-3 text-left font-medium text-gray-500">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filtered.map((b: any) => {
                const paid    = paidByBooking[b.id] || 0
                const total   = Number(b.total_amount || 0)
                const balance = Math.max(0, total - paid)
                const isSelected = selectedIds.has(b.id)
                return (
                  <tr key={b.id} className={`hover:bg-gray-50 transition-colors ${ isSelected ? 'bg-blue-50' : '' }`}>
                    <td className="py-3 pr-2">
                      <input type="checkbox" checked={isSelected}
                        onChange={() => setSelectedIds(prev => {
                          const n = new Set(prev)
                          if (n.has(b.id)) n.delete(b.id); else n.add(b.id)
                          return n
                        })}
                        className="rounded" />
                    </td>
                    <td className="py-3 pr-4">
                      <div className="flex items-center gap-1">
                        <span className="font-mono text-xs text-gray-700">{b.booking_no || '—'}</span>
                        {b.closed_at && <Lock className="w-3 h-3 text-slate-400" title="Closed" />}
                        {b.commission_mode === 'traditional' && (
                          <span className="text-xs px-1 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200">TR</span>
                        )}
                      </div>
                    </td>
                    <td className="py-3 pr-4 font-medium text-gray-900">{b.bp_customers?.name || '—'}</td>
                    <td className="py-3 pr-4 text-gray-600">{b.bp_plots?.plot_no || '—'}</td>
                    <td className="py-3 pr-4 text-gray-600">{b.bp_projects?.name || '—'}</td>
                    <td className="py-3 pr-4 text-gray-600">{b.brokers?.name || '—'}</td>
                    <td className="py-3 pr-4 text-right font-medium">{formatINR(total)}</td>
                    <td className="py-3 pr-4 text-right text-emerald-600 font-medium">{formatINR(paid)}</td>
                    <td className="py-3 pr-4 text-right text-red-500 font-medium">{formatINR(balance)}</td>
                    <td className="py-3 pr-4">
                      <span className={`text-xs px-2 py-1 rounded-full font-medium ${
                        b.closed_at ? 'bg-slate-100 text-slate-600' : STAGE_META[b.stage as Stage]?.color || ''
                      }`}>
                        {b.closed_at ? 'Closed' : (STAGE_META[b.stage as Stage]?.label || b.stage)}
                      </span>
                    </td>
                    <td className="py-3 pr-4 text-gray-500">{b.application_date ? formatDate(b.application_date) : '—'}</td>
                    <td className="py-3">
                      <div className="flex items-center gap-1 flex-wrap">
                        <button onClick={() => openEdit(b)} className="p-1.5 hover:bg-gray-100 rounded text-gray-500 hover:text-gray-700" title="Edit">
                          <ArrowRight className="w-4 h-4" />
                        </button>
                        <button onClick={() => setEmiBooking(b)} className="p-1.5 hover:bg-blue-50 rounded text-blue-500" title={emiByBooking[b.id] ? 'View EMI' : 'Start EMI'}>
                          <Calculator className="w-4 h-4" />
                        </button>
                        <button onClick={() => setRecordBookingFor(b)} className="p-1.5 hover:bg-green-50 rounded text-green-600" title="Record Payment">
                          <Banknote className="w-4 h-4" />
                        </button>
                        <button onClick={() => printApplicationForm(b)} className="p-1.5 hover:bg-purple-50 rounded text-purple-600" title="Print Form">
                          <Printer className="w-4 h-4" />
                        </button>
                        {!b.closed_at && b.stage === 'booking_done' && (
                          <button onClick={() => setClosureFor({ booking: b, action: 'close' })} className="p-1.5 hover:bg-slate-100 rounded text-slate-500" title="Close Booking">
                            <Lock className="w-4 h-4" />
                          </button>
                        )}
                        {b.closed_at && (
                          <button onClick={() => setClosureFor({ booking: b, action: 'reopen' })} className="p-1.5 hover:bg-amber-50 rounded text-amber-600" title="Reopen Booking">
                            <Unlock className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {filtered.length === 0 && (
            <div className="text-center py-12 text-gray-400">No bookings found</div>
          )}
        </div>
      )}

      {/* ── Create / Edit Modal ── */}
      <Modal open={modal} onClose={() => { setModal(false); setEditing(null); setForm(EMPTY); setSplitBrokers([]) }}
        title={editing ? `Edit Booking — ${editing.booking_no || ''}` : 'New Booking'}
        size="xl"
      >
        <div className="space-y-6">

          {/* Commission Mode switcher */}
          <div className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
            <span className="text-sm font-medium text-gray-700">Booking Mode:</span>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input type="radio" name="comm_mode" value="mlm"
                checked={isMLM} onChange={() => { set('commission_mode','mlm'); set('broker_id','') }}
              />
              <span className="text-sm">MLM (Sponsor Tree)</span>
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input type="radio" name="comm_mode" value="traditional"
                checked={!isMLM} onChange={() => { set('commission_mode','traditional'); set('broker_id','') }}
              />
              <span className="text-sm">Traditional (Direct)</span>
            </label>
          </div>

          {/* Row 1: Plot + Project */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Plot</label>
              <Select value={form.plot_id} onChange={e => handlePlotSelect(e.target.value)} options={[{value:'',label:'-- Select plot --'},...plotOptions]} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Project</label>
              <Select value={form.project_id} onChange={e => set('project_id',e.target.value)} options={[{value:'',label:'-- Select project --'},...projectOptions]} />
            </div>
          </div>

          {/* Row 2: Customer */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Customer</label>
            <div className="flex gap-3 mb-2">
              <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                <input type="radio" checked={form.cust_mode === 'existing'} onChange={() => set('cust_mode','existing')} /> Existing
              </label>
              <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                <input type="radio" checked={form.cust_mode === 'new'} onChange={() => set('cust_mode','new')} /> New Customer
              </label>
            </div>
            {form.cust_mode === 'existing' ? (
              <Select value={form.customer_id} onChange={e => set('customer_id',e.target.value)}
                options={[{value:'',label:'-- Select customer --'},...customerOptions]} />
            ) : (
              <div className="grid grid-cols-2 gap-3 p-4 bg-gray-50 rounded-lg">
                <Input placeholder="Full Name *" value={form.new_customer.name} onChange={e => setNC('name',e.target.value)} />
                <Input placeholder="Phone *" value={form.new_customer.phone} onChange={e => setNC('phone',e.target.value)} />
                <Input placeholder="Email" value={form.new_customer.email} onChange={e => setNC('email',e.target.value)} />
                <Input placeholder="Father / Husband Name" value={form.new_customer.father_or_husband_name} onChange={e => setNC('father_or_husband_name',e.target.value)} />
                <Input type="date" placeholder="Date of Birth" value={form.new_customer.dob} onChange={e => setNC('dob',e.target.value)} />
                <Input placeholder="PAN" value={form.new_customer.pan} onChange={e => setNC('pan',e.target.value)} />
                <div className="col-span-2">
                  <Textarea placeholder="Address" value={form.new_customer.address} onChange={e => setNC('address',e.target.value)} rows={2} />
                </div>
                <div className="col-span-2 border-t border-gray-200 pt-3">
                  <p className="text-xs font-medium text-gray-500 mb-2">Nominee Details</p>
                  <div className="grid grid-cols-2 gap-3">
                    <Input placeholder="Nominee Name" value={form.new_customer.nominee_name} onChange={e => setNC('nominee_name',e.target.value)} />
                    <Input placeholder="Relation" value={form.new_customer.nominee_relation} onChange={e => setNC('nominee_relation',e.target.value)} />
                    <Input type="date" placeholder="Nominee DOB" value={form.new_customer.nominee_dob} onChange={e => setNC('nominee_dob',e.target.value)} />
                    <Input placeholder="Nominee Father Name" value={form.new_customer.nominee_father_name} onChange={e => setNC('nominee_father_name',e.target.value)} />
                    <Input placeholder="Nominee PAN" value={form.new_customer.nominee_pan} onChange={e => setNC('nominee_pan',e.target.value)} />
                    <div className="col-span-2">
                      <Textarea placeholder="Nominee Address" value={form.new_customer.nominee_address} onChange={e => setNC('nominee_address',e.target.value)} rows={2} />
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Row 3: Broker */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              {isMLM ? 'Broker (MLM, Upline) *' : 'Broker (Traditional) *'}
            </label>
            {brokerOptions.length === 0 ? (
              <p className="text-sm text-amber-600 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                No {isMLM ? 'MLM' : 'Traditional'} brokers yet.{' '}
                <Link to="/brokers" className="underline font-medium">Add one in Brokers →</Link>
              </p>
            ) : (
              <Select value={form.broker_id} onChange={e => set('broker_id',e.target.value)}
                options={[
                  {value:'', label:`-- Choose the broker who made the sale --`, disabled: true},
                  ...brokerOptions
                ]}
              />
            )}
          </div>

          {/* Row 4: Size / Rate / Charges */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Size (sq yd)</label>
              <Input type="number" value={form.size_sqyd} onChange={e => set('size_sqyd',e.target.value)} placeholder="0" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Rate (₹/sq yd)</label>
              <Input type="number" value={form.rate_per_sqyd} onChange={e => set('rate_per_sqyd',e.target.value)} placeholder="0" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Development Charges (₹)</label>
              <Input type="number" value={form.dev_charges} onChange={e => set('dev_charges',e.target.value)} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">PLC Charges (₹)</label>
              <Input type="number" value={form.plc_charges} onChange={e => set('plc_charges',e.target.value)} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Discount (₹)</label>
              <Input type="number" value={form.discount_amount} onChange={e => set('discount_amount',e.target.value)} />
            </div>
            <div className="flex items-end">
              <div className="p-3 bg-blue-50 rounded-lg w-full">
                <p className="text-xs text-blue-600 font-medium">Net Payable</p>
                <p className="text-lg font-bold text-blue-700">{formatINR(totalNet)}</p>
              </div>
            </div>
          </div>

          {/* Commission Preview (MLM) */}
          {isMLM && selectedBroker && (
            <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-sm">
              <span className="text-emerald-700 font-medium">Commission (MLM):</span>{' '}
              <span className="text-emerald-600">{selectedBroker.name} · {brokerRankPct}% · {formatINR(commissionAmt)}</span>
            </div>
          )}

          {/* Traditional Commission Panel */}
          {!isMLM && (
            <div className="p-4 bg-amber-50 border border-amber-200 rounded-lg space-y-4">
              <p className="text-sm font-semibold text-amber-800">Traditional Commission</p>
              <div className="flex gap-3">
                <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                  <input type="radio" checked={form.traditional_input === 'pct'} onChange={() => set('traditional_input','pct')} />
                  Percentage (%)
                </label>
                <label className="flex items-center gap-1.5 text-sm cursor-pointer">
                  <input type="radio" checked={form.traditional_input === 'per_sqyd'} onChange={() => set('traditional_input','per_sqyd')} />
                  Per sq yd (₹)
                </label>
              </div>
              {form.traditional_input === 'pct' ? (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Commission %</label>
                  <Input type="number" value={form.traditional_commission_pct} onChange={e => set('traditional_commission_pct',e.target.value)} placeholder="e.g. 2.5" />
                  {form.traditional_commission_pct && basePrice > 0 && (
                    <p className="text-xs text-amber-700 mt-1">
                      = {formatINR(Math.round(basePrice * num(form.traditional_commission_pct) / 100))}
                    </p>
                  )}
                </div>
              ) : (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Commission per sq yd (₹)</label>
                  <Input type="number" value={form.traditional_commission_per_sqyd} onChange={e => set('traditional_commission_per_sqyd',e.target.value)} placeholder="e.g. 150" />
                  {form.traditional_commission_per_sqyd && size > 0 && (
                    <p className="text-xs text-amber-700 mt-1">
                      = {formatINR(Math.round(num(form.traditional_commission_per_sqyd) * size))}
                    </p>
                  )}
                </div>
              )}
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" checked={form.traditional_pay_upline} onChange={e => set('traditional_pay_upline',e.target.checked)} />
                Also pay upline differential (cascade)
              </label>

              {/* Multi-broker split */}
              <div className="border-t border-amber-200 pt-3 space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-amber-800 uppercase tracking-wide">Co-brokers (optional)</p>
                  {splitBrokers.length < 2 && (
                    <button type="button" className="text-xs text-amber-700 underline"
                      onClick={() => setSplitBrokers(prev => [...prev, { broker_id: '', commission_pct: '', position: prev.length + 2 }])}
                    >+ Add broker</button>
                  )}
                </div>
                {splitBrokers.map((sb, idx) => (
                  <div key={idx} className="flex gap-2 items-center">
                    <Select value={sb.broker_id}
                      onChange={e => setSplitBrokers(prev => prev.map((x, i) => i === idx ? { ...x, broker_id: e.target.value } : x))}
                      options={[{value:'',label:'-- Broker --'}, ...(brokers as any[]).filter((b: any) => b.broker_type === 'traditional' || !b.broker_type).map((b: any) => ({ value: b.id, label: `${b.name} (${b.broker_id})` }))]}
                    />
                    <Input type="number" placeholder="%" value={sb.commission_pct} className="w-24"
                      onChange={e => setSplitBrokers(prev => prev.map((x, i) => i === idx ? { ...x, commission_pct: e.target.value } : x))}
                    />
                    <button type="button" onClick={() => setSplitBrokers(prev => prev.filter((_, i) => i !== idx))} className="text-red-400 hover:text-red-600">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ))}
                {splitBrokers.length > 0 && (
                  <p className="text-xs text-amber-700">
                    Primary {num(form.traditional_commission_pct) || 0}%
                    {splitBrokers.map((sb, i) => ` + Broker ${i+2} ${num(sb.commission_pct) || 0}%`).join('')}
                    {' '}= {(
                      num(form.traditional_commission_pct) +
                      splitBrokers.reduce((a, sb) => a + num(sb.commission_pct), 0)
                    ).toFixed(2)}% total
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Token Payment */}
          <div className="space-y-2">
            <label className="flex items-center gap-2 font-medium text-sm cursor-pointer">
              <input type="checkbox" checked={form.token_enabled} onChange={e => set('token_enabled',e.target.checked)} />
              Token Payment
            </label>
            {form.token_enabled && (
              <div className="grid grid-cols-2 gap-3 p-3 bg-orange-50 rounded-lg">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Amount (₹)</label>
                  <Input type="number" value={form.token_amount} onChange={e => set('token_amount',e.target.value)} placeholder="Token amount" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Date</label>
                  <Input type="date" value={form.token_date} onChange={e => set('token_date',e.target.value)} />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Mode</label>
                  <Select value={form.token_mode} onChange={e => set('token_mode',e.target.value)}
                    options={PAYMENT_MODES.map(m => ({ value: m, label: m.toUpperCase() }))} />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">UTR / Ref No.</label>
                  <Input value={form.token_utr} onChange={e => set('token_utr',e.target.value)} placeholder="Optional" />
                </div>
                {form.token_mode !== 'cash' && form.token_mode !== 'upi' && (
                  <>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Drawn On Bank</label>
                      <Input value={form.token_drawn_on} onChange={e => set('token_drawn_on',e.target.value)} placeholder="Bank name" />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Branch</label>
                      <Input value={form.token_branch} onChange={e => set('token_branch',e.target.value)} placeholder="Branch" />
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          {/* Expected Booking Amount */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Expected Booking Amount (₹)</label>
            <Input type="number" value={form.expected_booking_amount} onChange={e => set('expected_booking_amount',e.target.value)} placeholder="Optional — helps track target" />
          </div>

          {/* Booking Payment */}
          <div className="space-y-2">
            <label className="flex items-center gap-2 font-medium text-sm cursor-pointer">
              <input type="checkbox" checked={form.booking_enabled} onChange={e => set('booking_enabled',e.target.checked)} />
              Booking Payment
            </label>
            {form.booking_enabled && (
              <div className="grid grid-cols-2 gap-3 p-3 bg-blue-50 rounded-lg">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Amount (₹)</label>
                  <Input type="number" value={form.booking_amount} onChange={e => set('booking_amount',e.target.value)} placeholder="Booking amount" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Date</label>
                  <Input type="date" value={form.booking_date} onChange={e => set('booking_date',e.target.value)} />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Mode</label>
                  <Select value={form.booking_mode} onChange={e => set('booking_mode',e.target.value)}
                    options={PAYMENT_MODES.map(m => ({ value: m, label: m.toUpperCase() }))} />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">UTR / Ref No.</label>
                  <Input value={form.booking_utr} onChange={e => set('booking_utr',e.target.value)} placeholder="Optional" />
                </div>
                {form.booking_mode !== 'cash' && form.booking_mode !== 'upi' && (
                  <>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Drawn On Bank</label>
                      <Input value={form.booking_drawn_on} onChange={e => set('booking_drawn_on',e.target.value)} placeholder="Bank name" />
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500 mb-1">Branch</label>
                      <Input value={form.booking_branch} onChange={e => set('booking_branch',e.target.value)} placeholder="Branch" />
                    </div>
                  </>
                )}
              </div>
            )}
          </div>

          {/* EMI */}
          <div className="space-y-2">
            <label className="flex items-center gap-2 font-medium text-sm cursor-pointer">
              <input type="checkbox" checked={form.emi_enabled} onChange={e => set('emi_enabled',e.target.checked)} />
              EMI Schedule
            </label>
            {form.emi_enabled && (
              <div className="grid grid-cols-3 gap-3 p-3 bg-purple-50 rounded-lg">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Installments</label>
                  <Input type="number" value={form.emi_n} onChange={e => set('emi_n',e.target.value)} />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Frequency</label>
                  <Select value={form.emi_freq} onChange={e => set('emi_freq',e.target.value)}
                    options={[
                      {value:'monthly',label:'Monthly'},
                      {value:'quarterly',label:'Quarterly'},
                      {value:'half_yearly',label:'Half Yearly'},
                      {value:'yearly',label:'Yearly'},
                    ]} />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Start Date</label>
                  <Input type="date" value={form.emi_start} onChange={e => set('emi_start',e.target.value)} />
                </div>
              </div>
            )}
          </div>

          {/* Full Payment */}
          <div className="space-y-2">
            <label className="flex items-center gap-2 font-medium text-sm cursor-pointer">
              <input type="checkbox" checked={form.full_enabled} onChange={e => set('full_enabled',e.target.checked)} />
              Full Payment
            </label>
            {form.full_enabled && (
              <div className="grid grid-cols-2 gap-3 p-3 bg-emerald-50 rounded-lg">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Amount (₹) — leave blank for auto (= net payable)</label>
                  <Input type="number" value={form.full_amount} onChange={e => set('full_amount',e.target.value)} placeholder={String(totalNet)} />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Date</label>
                  <Input type="date" value={form.full_date} onChange={e => set('full_date',e.target.value)} />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">Mode</label>
                  <Select value={form.full_mode} onChange={e => set('full_mode',e.target.value)}
                    options={PAYMENT_MODES.map(m => ({ value: m, label: m.toUpperCase() }))} />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">UTR / Ref No.</label>
                  <Input value={form.full_utr} onChange={e => set('full_utr',e.target.value)} placeholder="Optional" />
                </div>
              </div>
            )}
          </div>

          {/* Meta fields */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Application Date</label>
              <Input type="date" value={form.application_date} onChange={e => set('application_date',e.target.value)} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Booking Time</label>
              <Input type="time" value={form.booking_time} onChange={e => set('booking_time',e.target.value)} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Customer Bank Name</label>
              <Input value={form.customer_bank_name} onChange={e => set('customer_bank_name',e.target.value)} placeholder="Optional" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Upline Broker Code</label>
              <Input value={form.upline_broker_code} onChange={e => set('upline_broker_code',e.target.value)} placeholder="Optional" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Manager / Witness Signature By</label>
              <Input value={form.manager_signature_by} onChange={e => set('manager_signature_by',e.target.value)} placeholder="Optional" />
            </div>
            <div className="flex items-center gap-2 pt-6">
              <input type="checkbox" id="affidavit" checked={form.affidavit_accepted} onChange={e => set('affidavit_accepted',e.target.checked)} />
              <label htmlFor="affidavit" className="text-sm text-gray-700 cursor-pointer">Affidavit Accepted</label>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
            <Textarea value={form.notes} onChange={e => set('notes',e.target.value)} rows={3} placeholder="Internal notes…" />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <Button variant="outline" onClick={() => { setModal(false); setEditing(null); setForm(EMPTY); setSplitBrokers([]) }}>Cancel</Button>
            <Button
              onClick={() => {
                if (!form.broker_id) { toast.error('Pick the broker who made the sale (required)'); return }
                if (editing) update.mutate({ ...form, id: editing.id, splitBrokers })
                else create.mutate({ ...form, splitBrokers })
              }}
              disabled={create.isPending || update.isPending}
            >
              {create.isPending || update.isPending ? 'Saving…' : (editing ? 'Update Booking' : 'Create Booking')}
            </Button>
          </div>
        </div>
      </Modal>

      {/* ── EMI Panel ── */}
      {emiBooking && (
        <EmiPanel booking={emiBooking} onClose={() => setEmiBooking(null)} />
      )}

      {/* ── Record Payment Modal ── */}
      {recordBookingFor && (
        <RecordPaymentModal
          booking={recordBookingFor}
          onClose={() => setRecordBookingFor(null)}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ['bookings'] })
            qc.invalidateQueries({ queryKey: ['payments_by_booking'] })
            setRecordBookingFor(null)
          }}
        />
      )}

      {/* ── Closure Dialog ── */}
      {closureFor && (
        <ClosureDialog
          booking={closureFor.booking}
          action={closureFor.action}
          onClose={() => setClosureFor(null)}
          onDone={() => {
            qc.invalidateQueries({ queryKey: ['bookings'] })
            setClosureFor(null)
          }}
        />
      )}

      {/* ── Bulk Close Dialog ── */}
      {bulkCloseFor && (
        <ClosureDialog
          booking={bulkCloseFor[0]}
          action="close"
          bulkBookings={bulkCloseFor}
          onClose={() => setBulkCloseFor(null)}
          onDone={() => {
            qc.invalidateQueries({ queryKey: ['bookings'] })
            setSelectedIds(new Set())
            setBulkCloseFor(null)
          }}
        />
      )}
    </div>
  )
}

// ── Inline Record-Payment Modal ──────────────────────────────────────────────────────────────────
function RecordPaymentModal({ booking, onClose, onSaved }: { booking: any; onClose: () => void; onSaved: () => void }) {
  const [amount, setAmount]   = useState('')
  const [mode, setMode]       = useState('cash')
  const [utr, setUtr]         = useState('')
  const [date, setDate]       = useState(today())
  const [type, setType]       = useState('extra')
  const [drawnOn, setDrawnOn] = useState('')
  const [branch, setBranch]   = useState('')
  const [saving, setSaving]   = useState(false)

  async function handleSave() {
    if (!amount || Number(amount) <= 0) { toast.error('Enter a valid amount'); return }
    setSaving(true)
    try {
      const trimmedUtr = utr.trim()
      if (trimmedUtr) {
        const conflict = await findUtrConflict(trimmedUtr)
        if (conflict) { toast.error(utrConflictMessage(conflict)); setSaving(false); return }
      }
      const { data: rn } = await supabase.rpc('next_receipt_no')
      const { error } = await supabase.from('bp_payments').insert({
        booking_id: booking.id, customer_id: booking.customer_id,
        payment_type: type, amount: Number(amount), payment_mode: mode,
        utr_ref: trimmedUtr || null, payment_date: date,
        verification_status: 'verified', verified_at: new Date().toISOString(),
        receipt_no: rn || null,
        drawn_on_bank: drawnOn || (mode === 'cash' ? 'Cash' : null),
        branch: branch || null,
      })
      if (error) throw error
      await distributePaymentCommission({ bookingId: booking.id, paymentId: null, amount: Number(amount) })
      toast.success('Payment recorded')
      onSaved()
    } catch (e: any) {
      toast.error(e.message || 'Failed to record payment')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open onClose={onClose} title={`Record Payment — ${booking.booking_no || ''}`}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Payment Type</label>
            <Select value={type} onChange={e => setType(e.target.value)}
              options={[
                {value:'token',label:'Token'},
                {value:'booking',label:'Booking'},
                {value:'emi',label:'EMI Installment'},
                {value:'full_payment',label:'Full Payment'},
                {value:'extra',label:'Extra / Ad-hoc'},
              ]} />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Amount (₹)</label>
            <Input type="number" value={amount} onChange={e => setAmount(e.target.value)} placeholder="Enter amount" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Payment Mode</label>
            <Select value={mode} onChange={e => setMode(e.target.value)}
              options={PAYMENT_MODES.map(m => ({ value: m, label: m.toUpperCase() }))} />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">Date</label>
            <Input type="date" value={date} onChange={e => setDate(e.target.value)} />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">UTR / Ref No.</label>
            <Input value={utr} onChange={e => setUtr(e.target.value)} placeholder="Optional" />
          </div>
          {mode !== 'cash' && mode !== 'upi' && (
            <>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Drawn On Bank</label>
                <Input value={drawnOn} onChange={e => setDrawnOn(e.target.value)} placeholder="Bank name" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Branch</label>
                <Input value={branch} onChange={e => setBranch(e.target.value)} placeholder="Branch" />
              </div>
            </>
          )}
        </div>
        <div className="flex justify-end gap-3">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : 'Record Payment'}</Button>
        </div>
      </div>
    </Modal>
  )
}
