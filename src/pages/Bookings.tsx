import { useState, useEffect, useMemo, useRef } from 'react'
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
import { Plus, ArrowRight, FileText, Printer, Calculator, UserPlus, UserCheck, Info, Banknote, IndianRupee, Lock, Unlock, Search, Download, X, Filter, ChevronDown, Users, ScrollText } from 'lucide-react'
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
  // Pre-flight error thrown by the create mutation when the new-customer block is
  // missing name or phone -- and the matching DB NOT NULL on bp_customers.phone.
  if (m.includes('new customer name & phone required') || m.includes('null value in column "phone"') || (m.includes('phone') && m.includes('not-null'))) {
    return "Please enter the customer's mobile number — it's required to save the booking."
  }
  if (m.includes('duplicate key') && m.includes('utr')) {
    return 'That UTR / reference number has already been used on another payment.'
  }
  if (m.includes('duplicate key') && (m.includes('brokers_email_key') || m.includes('brokers_email'))) {
    return "A broker with that email already exists.  If you've already added this broker, pick them from the dropdown instead of adding again."
  }
  if (m.includes('duplicate key') && (m.includes('brokers_phone') || m.includes('brokers_phone_key'))) {
    return "A broker with that phone number already exists.  Pick them from the dropdown instead of adding again."
  }
  if (m.includes('duplicate key')) {
    return 'A booking with the same details already exists.'
  }
  // Identify which FK or check constraint actually failed so admin knows what to fix.
  if (m.includes('broker') && (m.includes('foreign key') || m.includes('violates') || m.includes('constraint'))) {
    return "The broker you picked no longer exists.  Pick another broker or use the '+ Add new broker' button to create one inline."
  }
  if (m.includes('customer') && (m.includes('foreign key') || m.includes('violates') || m.includes('constraint'))) {
    return 'The customer you picked no longer exists.  Switch to "New customer" or pick another existing customer.'
  }
  if (m.includes('plot') && (m.includes('foreign key') || m.includes('violates') || m.includes('constraint'))) {
    return 'The plot you picked no longer exists.  Pick another available plot.'
  }
  if (m.includes('project') && (m.includes('foreign key') || m.includes('violates') || m.includes('constraint'))) {
    return 'The project you picked no longer exists.  Pick another project.'
  }
  if (m.includes('foreign key') || m.includes('violates') && m.includes('constraint')) {
    return 'One of the linked records (broker, customer, plot or project) is missing.  Please reselect and try again.  Check the browser console for the exact field.'
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
  // One booking can carry several plots (customer buys two adjacent plots on one
  // application).  plot_ids is the source of truth in the form; bp_bookings.plot_id is
  // written from plot_ids[0] so every existing read path keeps working.
  plot_ids: [] as string[],
  customer_id:'', broker_id:'', project_id:'', stage:'token_received',
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
  // Registry completion — the sale's final step: the plot is transferred into the
  // customer's name at the sub-registrar.  Recorded on the booking, and it moves the
  // plot(s) to their terminal 'registry_done' state.
  const [registryFor, setRegistryFor] = useState<any>(null)
  const [registryForm, setRegistryForm] = useState<any>({ registry_date: '', registry_doc_no: '', registry_office: '', registry_notes: '', ack_balance: false })
  const [bulkCloseFor, setBulkCloseFor] = useState<any[] | null>(null)
  // ── Admin filter / search state ─────────────────────────────────
  const [search, setSearch] = useState('')
  const [filterProject, setFilterProject] = useState('')
  const [filterBroker, setFilterBroker]   = useState('')
  const [filterStage, setFilterStage]     = useState('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo]     = useState('')
  const [showFilters, setShowFilters] = useState(false)
  // Inline "Add new broker" modal triggered from the broker picker on the booking form.
  // Saves a quick broker (name + phone + auto broker_type from booking mode) and
  // auto-selects them so admin doesn't have to leave the page mid-booking.
  const [quickBroker, setQuickBroker] = useState<null | { name: string; phone: string; email: string }>(null)
  const [quickBrokerSaving, setQuickBrokerSaving] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const set = (k: string, v: any) => setForm((p: any) => ({ ...p, [k]: v }))
  const setNC = (k: string, v: any) => setForm((p: any) => ({ ...p, new_customer: { ...p.new_customer, [k]: v } }))

  const { data: bookings = [], isLoading } = useQuery({
    // Include modeFilter in the key so the cache splits properly per view (all vs traditional).
    queryKey: ['bookings', modeFilter],
    queryFn: async () => {
      let q = supabase
        .from('bp_bookings')
        .select('*,bp_plots(*),bp_customers(*),brokers(name,broker_id),bp_projects(*),bp_booking_plots(position,plot_id,bp_plots(*))')
        .in('stage', ['token_received','booking_done','cancelled'])
        .order('created_at', { ascending: false })
      // Server-side filter: don't even fetch MLM rows when admin is on the Traditional
      // Bookings menu.  Belt-and-suspenders with the client-side filter below.
      if (modeFilter === 'traditional') q = q.eq('commission_mode', 'traditional')
      const { data, error } = await q
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

  // Plot picker options — scoped to the scheme picked on the booking form.  This used
  // to fetch every available plot in every project, so choosing "Brij Vatika" still
  // listed Gokul Vatika / Khatushyam plots and admin could book a plot that doesn't
  // belong to the selected scheme.  Now nothing loads until a project is chosen and
  // only that project's plots come back.
  //
  // Fetched in pages of 1000 because PostgREST caps a single response at max-rows and
  // the bigger schemes hold more plots than that — without the loop the tail of the
  // scheme was simply missing from the dropdown.
  const { data: plots = [] } = useQuery({
    queryKey: ['plots_avail', form.project_id],
    enabled: !!form.project_id,
    queryFn: async () => {
      const PAGE = 1000
      const out: any[] = []
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await supabase
          .from('bp_plots')
          .select('id, plot_no, size_sqyd, price_per_sqyd, plc_charges, total_price, status, project_id, bp_projects(id, name)')
          .eq('project_id', form.project_id)
          .eq('status', 'available')
          .order('plot_no')
          .range(from, from + PAGE - 1)
        if (error) throw error
        out.push(...(data || []))
        if (!data || data.length < PAGE) break
      }
      return out
    },
  })

  // While editing, the booking's own plots are already token/booked/sold, so they are not
  // in the "available" list above — merge them back in or the picker drops them from an
  // existing booking.
  const plotOptions = useMemo(() => {
    const list = plots as any[]
    const seen = new Set(list.map((p: any) => p.id))
    const own: any[] = []
    for (const p of [...((editing?.bp_booking_plots || []) as any[]).map((r: any) => r.bp_plots), editing?.bp_plots]) {
      if (!p?.id || p.project_id !== form.project_id || seen.has(p.id)) continue
      seen.add(p.id)
      own.push(p)
    }
    return own.length > 0 ? [...own, ...list] : list
  }, [plots, editing, form.project_id])

  // Every plot on a booking row — the join table when present, else the legacy single
  // plot_id.  Used wherever plot status has to follow the booking (stage moves, closing).
  const plotIdsOf = (b: any): string[] => {
    const rows = (b?.bp_booking_plots || []) as any[]
    if (rows.length > 0) {
      return [...rows].sort((x, y) => (x.position || 1) - (y.position || 1)).map(r => r.plot_id).filter(Boolean)
    }
    return b?.plot_id ? [b.plot_id] : []
  }

  const plotNosOf = (b: any): string[] => {
    const rows = (b?.bp_booking_plots || []) as any[]
    return rows.length > 0
      ? [...rows].sort((x, y) => (x.position || 1) - (y.position || 1)).map(r => r.bp_plots?.plot_no).filter(Boolean)
      : [b?.bp_plots?.plot_no].filter(Boolean)
  }

  // "A-101" / "A-101 +2" for the list columns, which only have room for one line.
  const plotLabelOf = (b: any): string => {
    const nos = plotNosOf(b)
    if (nos.length === 0) return '—'
    if (nos.length === 1) return nos[0]
    return `${nos[0]} +${nos.length - 1}`
  }

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
      const { data, error } = await supabase.from('brokers').select('id,name,broker_id,rank,broker_type,status,phone')
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

  // The plots currently on the form, in the order admin picked them.
  const selectedPlots = useMemo(
    () => ((form.plot_ids || []) as string[]).map(id => plotOptions.find((p: any) => p.id === id)).filter(Boolean),
    [form.plot_ids, plotOptions],
  )

  // Pricing inputs follow the whole selection: sizes add up, PLC charges add up, and the
  // rate becomes the size-weighted average so base price still works out to the sum of
  // each plot's own size × rate.  Admin can still type over any of the three.
  const pricingForPlots = (picked: any[]) => {
    if (picked.length === 0) return null
    const totalSize = picked.reduce((s: number, p: any) => s + num(p.size_sqyd), 0)
    const totalBase = picked.reduce((s: number, p: any) => s + num(p.size_sqyd) * num(p.price_per_sqyd), 0)
    const totalPlc  = picked.reduce((s: number, p: any) => s + num(p.plc_charges), 0)
    return {
      size_sqyd:     totalSize > 0 ? String(round2(totalSize)) : '',
      rate_per_sqyd: totalSize > 0 ? String(round2(totalBase / totalSize)) : '',
      plc_charges:   String(totalPlc),
    }
  }

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

  // Accepts one id or many — a booking can hold several plots and they all move together.
  //
  // 'registry_done' is the terminal state: once a plot is registered in the customer's
  // name, editing the booking or nudging its stage must not walk it back to 'booked'.
  // Cancelling is the one exception — that releases the plot deliberately.
  async function syncPlotStatus(plotIds: string | string[] | null | undefined, stage: Stage) {
    const ids = (Array.isArray(plotIds) ? plotIds : [plotIds]).filter(Boolean) as string[]
    if (ids.length === 0) return
    let q = supabase.from('bp_plots').update({ status: plotStatusForStage(stage) }).in('id', ids)
    if (stage !== 'cancelled') q = q.neq('status', 'registry_done')
    await q
  }

  // Rewrite the booking ↔ plots join rows.  Wipe + re-insert (same shape as the
  // multi-broker split) because admin may have added, removed or re-ordered plots.
  async function saveBookingPlots(bookingId: string, plotIds: string[]) {
    await supabase.from('bp_booking_plots').delete().eq('booking_id', bookingId)
    if (plotIds.length === 0) return
    await supabase.from('bp_booking_plots').insert(
      plotIds.map((plot_id, i) => ({ booking_id: bookingId, plot_id, position: i + 1 })),
    )
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
      const plotIds: string[] = (rest.plot_ids || []).filter(Boolean)
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
        // plot_id stays the position-1 plot so every existing join keeps resolving; the
        // full set is written to bp_booking_plots right after the insert.
        plot_id: plotIds[0] || null, customer_id, broker_id: rest.broker_id || null, project_id: rest.project_id || null,
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
      await saveBookingPlots(bk.id, plotIds)

      // Auto-promote: every customer becomes a broker the moment their MLM booking lands,
      // sponsored by the broker who made the sale.  No more "Make broker" chasing in the
      // team tree.  Skipped for traditional bookings (those are standalone, no tree) and
      // skipped when this customer was already a broker (matched by customer_id, then by
      // phone/email).  Failure here is non-fatal -- the booking succeeded, the broker
      // backfill can be retried later from /brokers.
      if (!isTraditional && customer_id && rest.broker_id) {
        try {
          const { data: existing } = await supabase
            .from('brokers')
            .select('id')
            .or(`customer_id.eq.${customer_id}` + (rest.new_customer?.phone ? `,phone.eq.${rest.new_customer.phone}` : ''))
            .limit(1)
          if (!existing || existing.length === 0) {
            // Get the customer details for name/phone/email
            const { data: cust } = await supabase.from('bp_customers').select('name, phone, email').eq('id', customer_id).single()
            if (cust?.name) {
              await supabase.from('brokers').insert({
                name: cust.name,
                phone: (cust.phone || '').trim() || null,
                email: (cust.email || '').trim() || `auto-${customer_id.slice(0, 8)}@example.com`,
                customer_id: customer_id,
                sponsor_id: rest.broker_id,
                broker_type: 'mlm',
                status: 'active',
                // 'Executive' is the lowest active slab in commission_ranks (level 1, 5%).
                // If we set this to a name not in commission_ranks the trigger gets direct_pct=0
                // and historically over-paid uplines on the full rank% instead of the differential.
                rank: 'Executive',
              })
              qc.invalidateQueries({ queryKey: ['brokers'] })
            }
          }
        } catch (autoErr) {
          // Don't throw -- the booking is already saved.  Log so we can debug later.
          // eslint-disable-next-line no-console
          console.warn('Auto-promote customer to broker skipped:', autoErr)
        }
      }

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
      if (rest.full_enabled && fullAmt > 0) {
        const r = await recordPaymentRow({ booking_id: bk.id, customer_id, payment_type: 'full_payment', amount: fullAmt,    payment_date: rest.full_date,    payment_mode: rest.full_mode,    utr_ref: rest.full_utr, sponsor_name: sponsorName })
        distributed += r.distributed
      }
      if (rest.emi_enabled) {
        const principal = Math.max(0, total - tokenAmt - bookingAmt - fullAmt)
        if (principal > 0) await generateEmiSchedule(bk.id, customer_id, principal, num(rest.emi_n) || 12, rest.emi_freq || 'monthly', rest.emi_start || today())
      }
      await syncPlotStatus(plotIds, stage)
      return { ...bk, distributed }
    },
    onSuccess: (res: any) => {
      qc.invalidateQueries({ queryKey: ['bookings'] })
      qc.invalidateQueries({ queryKey: ['customers'] })
      qc.invalidateQueries({ queryKey: ['payments_by_booking'] })
      qc.invalidateQueries({ queryKey: ['emi_schedules'] })
      qc.invalidateQueries({ queryKey: ['plots_avail'] })
      qc.invalidateQueries({ queryKey: ['plots'] })
      qc.invalidateQueries({ queryKey: ['payouts'] })
      qc.invalidateQueries({ queryKey: ['commission_ledger'] })
      toast.success(`Booking saved${res?.distributed ? ` · MLM distributed to ${res.distributed} broker${res.distributed !== 1 ? 's' : ''}` : ''}`)
    },
    // Translate Supabase / Postgres error spew into plain English so non-technical
    // admins know what to fix.  Raw DB messages still log to console for support.
    onError: (e: any) => { console.error('Create booking failed:', e); toast.error(friendlyError(e)) },
  })

  const update = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: any }) => {
      const project = (projects as any[]).find((pj: any) => pj.id === data.project_id)
      const broker  = (brokers as any[]).find((b: any) => b.id === data.broker_id)
      const mlmPct = broker ? Number((ranks as any[]).find((r: any) => r.rank_name === broker.rank)?.commission_pct || 0) : 0
      const sz   = num(data.size_sqyd); const rt = num(data.rate_per_sqyd)
      const base = Math.round(sz * rt)
      const d    = num(data.dev_charges); const pl = num(data.plc_charges); const dsc = num(data.discount_amount)
      const total = Math.max(0, base + d + pl - dsc)
      // Same traditional-mode handling as the create path -- editing must persist the
      // commission_mode + traditional_* columns so the trigger recomputes correctly.
      const isTraditional = data.commission_mode === 'traditional'
      const tradPct       = isTraditional && data.traditional_input === 'pct'      ? num(data.traditional_commission_pct)      : null
      const tradPerSqyd   = isTraditional && data.traditional_input === 'per_sqyd' ? num(data.traditional_commission_per_sqyd) : null
      const effectivePct  = isTraditional
        ? (tradPct != null ? tradPct : (tradPerSqyd != null && sz > 0 && total > 0 ? round2((tradPerSqyd * sz / total) * 100) : 0))
        : mlmPct
      const { data: current } = await supabase
        .from('bp_bookings')
        .select('plot_id, token_amount, booking_amount, full_payment_amount, payment_type')
        .eq('id', id).single()
      const { data: currentPlotRows } = await supabase
        .from('bp_booking_plots').select('plot_id').eq('booking_id', id)
      const oldPlotIds: string[] = [
        ...((currentPlotRows || []) as any[]).map(r => r.plot_id),
        ...(current?.plot_id ? [current.plot_id] : []),
      ].filter((v, i, a) => v && a.indexOf(v) === i)
      const plotIds: string[] = (data.plot_ids || []).filter(Boolean)

      // Payments can now be added while editing (admin books the plot first with no money
      // taken, then records the token / booking deposit later).  Only the sections that
      // are ticked in the form are recorded, and each one becomes a fresh bp_payments row
      // on top of whatever this booking already collected.
      const { data: paidRows } = await supabase
        .from('bp_payments').select('amount').eq('booking_id', id).eq('verification_status', 'verified')
      const alreadyPaidOnBooking = ((paidRows || []) as any[]).reduce((s: number, r: any) => s + num(r.amount), 0)

      const addTokenAmt   = data.token_enabled   ? num(data.token_amount)   : 0
      const addBookingAmt = data.booking_enabled ? num(data.booking_amount) : 0
      // A blank "full payment" means "settle whatever is left", same shorthand the create
      // form uses — except here the outstanding balance is net of what's already banked.
      const addFullAmt    = data.full_enabled    ? (num(data.full_amount) || Math.max(0, total - alreadyPaidOnBooking)) : 0
      const addsPayment   = addTokenAmt > 0 || addBookingAmt > 0 || addFullAmt > 0
      // A deposit or full payment moves a token-stage booking forward, same rule the
      // "Receive booking amount" quick action already applies.
      const stageAfterPayment: Stage = (addBookingAmt > 0 || addFullAmt > 0) && data.stage === 'token_received'
        ? 'booking_done'
        : (data.stage as Stage)

      const payload: any = {
        plot_id: plotIds[0] || null, customer_id: data.customer_id || null,
        broker_id: data.broker_id || null, project_id: data.project_id || null,
        stage: stageAfterPayment,
        size_sqyd: sz || null, rate_per_sqyd: rt || null,
        base_price: base || null,
        dev_charges: d, plc_charges: pl, discount_amount: dsc,
        plot_total_price: total, total_amount: total,
        commission_mode: isTraditional ? 'traditional' : 'mlm',
        traditional_commission_pct:      tradPct,
        traditional_commission_per_sqyd: tradPerSqyd,
        traditional_pay_upline:          isTraditional ? !!data.traditional_pay_upline : false,
        commission_rate:                 effectivePct || null,
        commission_amount:               effectivePct > 0 ? Math.round(base * effectivePct / 100) : null,
        expected_booking_amount: num(data.expected_booking_amount) || null,
        notes: data.notes || null,
        scheme_name: project?.name || null,
        application_date: data.application_date || null,
        booking_time: data.booking_time || null,
        customer_bank_name: data.customer_bank_name || null,
        upline_broker_code: data.upline_broker_code || null,
        manager_signature_by: data.manager_signature_by || null,
        affidavit_accepted: !!data.affidavit_accepted,
        updated_at: new Date().toISOString(),
      }
      // Roll any newly-recorded amount into the booking's own running totals so the
      // Final Summary and the receipts stay in step with bp_payments.
      if (addTokenAmt > 0) {
        payload.token_amount = num(current?.token_amount) + addTokenAmt
        payload.token_date   = data.token_date || null
      }
      if (addBookingAmt > 0) {
        payload.booking_amount = num(current?.booking_amount) + addBookingAmt
        payload.booking_date   = data.booking_date || null
      }
      if (addFullAmt > 0) {
        payload.full_payment_amount = num(current?.full_payment_amount) + addFullAmt
        payload.full_payment_date   = data.full_date || null
      }
      if (addsPayment) {
        payload.payment_type = data.emi_enabled ? 'emi'
          : addFullAmt > 0 ? 'full'
          : addBookingAmt > 0 ? 'booking'
          : (current?.payment_type || 'token')
      }
      const { data: d2, error } = await supabase.from('bp_bookings').update(payload).eq('id', id).select().single()
      if (error) throw error
      // Re-sync the multi-broker split rows on edit: wipe + re-insert is simplest because
      // admin may have added / removed / re-ordered brokers in the form.  CASCADE on the
      // FK means re-inserting is safe.
      await supabase.from('bp_booking_brokers').delete().eq('booking_id', id)
      if (isTraditional && data.splitBrokers?.length > 0 && tradPct != null && tradPct > 0) {
        const rows = [
          { booking_id: id, broker_id: data.broker_id, commission_pct: tradPct, position: 1 },
          ...(data.splitBrokers as any[])
            .filter((s: any) => s.broker_id && num(s.commission_pct) > 0)
            .map((s: any, i: number) => ({ booking_id: id, broker_id: s.broker_id, commission_pct: num(s.commission_pct), position: i + 2 })),
        ]
        if (rows.length > 1) {
          await supabase.from('bp_booking_brokers').insert(rows)
        }
      }
      await saveBookingPlots(id, plotIds)
      // Plots dropped from the booking go back into the available pool.
      const freed = oldPlotIds.filter(pid => !plotIds.includes(pid))
      if (freed.length > 0) {
        await supabase.from('bp_plots').update({ status: 'available' }).in('id', freed)
      }
      await syncPlotStatus(plotIds, stageAfterPayment)

      // Record the payments admin ticked on this edit, reusing the same path as the
      // create flow so receipts, UTR checks and MLM distribution all behave identically.
      const sponsorName = broker?.name || null
      let distributed = 0
      if (addTokenAmt > 0) {
        const r = await recordPaymentRow({ booking_id: id, customer_id: data.customer_id, payment_type: 'token',        amount: addTokenAmt,   payment_date: data.token_date,   payment_mode: data.token_mode,   utr_ref: data.token_utr,   drawn_on_bank: data.token_drawn_on,   branch: data.token_branch,   sponsor_name: sponsorName })
        distributed += r.distributed
      }
      if (addBookingAmt > 0) {
        const r = await recordPaymentRow({ booking_id: id, customer_id: data.customer_id, payment_type: 'booking',      amount: addBookingAmt, payment_date: data.booking_date, payment_mode: data.booking_mode, utr_ref: data.booking_utr, drawn_on_bank: data.booking_drawn_on, branch: data.booking_branch, sponsor_name: sponsorName })
        distributed += r.distributed
      }
      if (addFullAmt > 0) {
        const r = await recordPaymentRow({ booking_id: id, customer_id: data.customer_id, payment_type: 'full_payment', amount: addFullAmt,    payment_date: data.full_date,    payment_mode: data.full_mode,    utr_ref: data.full_utr, sponsor_name: sponsorName })
        distributed += r.distributed
      }
      // EMI: only build a schedule if this booking doesn't already have one — the EMI
      // panel owns an existing schedule and must not be silently duplicated.
      if (data.emi_enabled) {
        const { data: existingSched } = await supabase.from('emi_schedules').select('id').eq('booking_id', id).limit(1)
        if (!existingSched || existingSched.length === 0) {
          const principal = Math.max(0, total - alreadyPaidOnBooking - addTokenAmt - addBookingAmt - addFullAmt)
          if (principal > 0) await generateEmiSchedule(id, data.customer_id, principal, num(data.emi_n) || 12, data.emi_freq || 'monthly', data.emi_start || today())
        }
      }
      return { ...d2, distributed, addedPayment: addsPayment }
    },
    onSuccess: (res: any) => {
      qc.invalidateQueries({ queryKey: ['bookings'] })
      qc.invalidateQueries({ queryKey: ['plots_avail'] })
      qc.invalidateQueries({ queryKey: ['plots'] })
      qc.invalidateQueries({ queryKey: ['payments_by_booking'] })
      qc.invalidateQueries({ queryKey: ['payments'] })
      qc.invalidateQueries({ queryKey: ['emi_schedules'] })
      qc.invalidateQueries({ queryKey: ['emi_schedules_by_booking'] })
      qc.invalidateQueries({ queryKey: ['payouts'] })
      qc.invalidateQueries({ queryKey: ['commission_ledger'] })
      toast.success(res?.addedPayment
        ? `Booking updated · payment recorded${res.distributed > 0 ? ` · ${res.distributed} commission row(s)` : ''}`
        : 'Booking updated')
    },
    onError: (e: any) => { console.error('Update booking failed:', e); toast.error(friendlyError(e, 'Could not update the booking. Please check the fields and try again.')) },
  })

  const advanceStage = useMutation({
    mutationFn: async ({ id, stage }: { id: string; stage: Stage }) => {
      const { data: current } = await supabase
        .from('bp_bookings').select('plot_id, bp_booking_plots(position, plot_id)').eq('id', id).single()
      const { error } = await supabase.from('bp_bookings').update({ stage, updated_at: new Date().toISOString() }).eq('id', id)
      if (error) throw error
      await syncPlotStatus(plotIdsOf(current), stage)
      // Per-payment MLM model: commission is distributed when payments are recorded.
      // Stage advance does not redistribute. Cancelling rolls back all commissions for this booking.
      if (stage === 'cancelled') await reverseBookingCommission(id)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bookings'] })
      qc.invalidateQueries({ queryKey: ['plots_avail'] })
      qc.invalidateQueries({ queryKey: ['plots'] })
      qc.invalidateQueries({ queryKey: ['payouts'] })
      qc.invalidateQueries({ queryKey: ['commission_ledger'] })
      toast.success('Stage advanced')
    },
    onError: (e: any) => toast.error(e.message),
  })

  // Quick-action used from the "Token Booking" tab: receive the booking deposit, move stage forward,
  // mark the plot booked, and optionally pop the EMI panel so the user can set up instalments next.
  const recordBookingPayment = useMutation({
    mutationFn: async (p: { booking: any; amount: number; date: string; mode: string; utr: string; drawn_on: string; branch: string; openEmiAfter: boolean }) => {
      if (p.amount <= 0) throw new Error('Amount must be greater than zero')
      const b = p.booking
      const r = await recordPaymentRow({
        booking_id: b.id, customer_id: b.customer_id,
        payment_type: 'booking', amount: p.amount, payment_date: p.date,
        payment_mode: p.mode, utr_ref: p.utr,
        drawn_on_bank: p.drawn_on, branch: p.branch,
        sponsor_name: b.brokers?.name || null,
      })
      const updatePayload: any = {
        stage: 'booking_done',
        booking_amount: Number(b.booking_amount || 0) + p.amount,
        booking_date: b.booking_date || p.date,
        payment_type: b.payment_type === 'token' ? 'booking' : b.payment_type,
        updated_at: new Date().toISOString(),
      }
      const { error } = await supabase.from('bp_bookings').update(updatePayload).eq('id', b.id)
      if (error) throw error
      await syncPlotStatus(plotIdsOf(b), 'booking_done')
      return { booking: b, openEmiAfter: p.openEmiAfter, distributed: r.distributed }
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['bookings'] })
      qc.invalidateQueries({ queryKey: ['payments_by_booking'] })
      qc.invalidateQueries({ queryKey: ['payments'] })
      qc.invalidateQueries({ queryKey: ['plots_avail'] })
      qc.invalidateQueries({ queryKey: ['plots'] })
      qc.invalidateQueries({ queryKey: ['payouts'] })
      qc.invalidateQueries({ queryKey: ['commission_ledger'] })
      toast.success(`Booking amount recorded${res?.distributed ? ` · MLM distributed to ${res.distributed} broker${res.distributed !== 1 ? 's' : ''}` : ''}`)
      setRecordBookingFor(null)
      if (res?.openEmiAfter) setEmiBooking(res.booking)
    },
    onError: (e: any) => toast.error(e.message),
  })

  const closeBooking = useMutation({
    mutationFn: async (p: { booking: any; reason: string }) => {
      const userId = await getCurrentUserId()
      const { error } = await supabase.from('bp_bookings').update({
        closed_at: new Date().toISOString(),
        closed_by: userId,
        closure_notes: p.reason || null,
        reopened_at: null,
        reopened_by: null,
        reopen_reason: null,
        updated_at: new Date().toISOString(),
      }).eq('id', p.booking.id)
      if (error) throw error
      const soldIds = plotIdsOf(p.booking)
      if (soldIds.length > 0 && p.booking.stage === 'booking_done') {
        await supabase.from('bp_plots').update({ status: 'registry_done' }).in('id', soldIds)
      }
      await logClosure({ entityType: 'booking', entityId: p.booking.id, action: 'closed', reason: p.reason, metadata: { booking_no: p.booking.booking_no, stage: p.booking.stage, total: p.booking.total_amount } })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bookings'] })
      qc.invalidateQueries({ queryKey: ['plots_avail'] })
      qc.invalidateQueries({ queryKey: ['plots'] })
      toast.success('Booking closed')
      setClosureFor(null)
    },
    onError: (e: any) => toast.error(e.message),
  })

  const openRegistry = (b: any) => {
    setRegistryForm({
      registry_date:   b.registry_date || today(),
      registry_doc_no: b.registry_doc_no || '',
      registry_office: b.registry_office || '',
      registry_notes:  b.registry_notes || '',
      ack_balance: false,
    })
    setRegistryFor(b)
  }

  const saveRegistry = useMutation({
    mutationFn: async ({ booking, data }: { booking: any; data: any }) => {
      const userId = await getCurrentUserId()
      const { error } = await supabase.from('bp_bookings').update({
        registry_date:         data.registry_date || null,
        registry_doc_no:       data.registry_doc_no?.trim() || null,
        registry_office:       data.registry_office?.trim() || null,
        registry_notes:        data.registry_notes?.trim() || null,
        registry_completed_at: new Date().toISOString(),
        registry_completed_by: userId,
        updated_at: new Date().toISOString(),
      }).eq('id', booking.id)
      if (error) throw error
      // Registry is the end of the road for the plot — mark every plot on this booking
      // as registered.  This is checked for errors on purpose: 'registry_done' is the
      // only terminal value bp_plots_status_check accepts.
      const ids = plotIdsOf(booking)
      if (ids.length > 0) {
        const { error: plotErr } = await supabase.from('bp_plots').update({ status: 'registry_done' }).in('id', ids)
        if (plotErr) throw plotErr
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bookings'] })
      qc.invalidateQueries({ queryKey: ['plots_avail'] })
      qc.invalidateQueries({ queryKey: ['plots'] })
      setRegistryFor(null)
      toast.success('Registry recorded — plot marked registered')
    },
    onError: (e: any) => { console.error('Registry save failed:', e); toast.error(friendlyError(e, 'Could not save the registry details.')) },
  })

  // Undo — a registry entered against the wrong booking has to be reversible, and the
  // plot has to come back with it or the inventory is stuck.
  const clearRegistry = useMutation({
    mutationFn: async (booking: any) => {
      const { error } = await supabase.from('bp_bookings').update({
        registry_date: null, registry_doc_no: null, registry_office: null,
        registry_completed_at: null, registry_completed_by: null,
        updated_at: new Date().toISOString(),
      }).eq('id', booking.id)
      if (error) throw error
      const ids = plotIdsOf(booking)
      if (ids.length > 0) {
        await supabase.from('bp_plots')
          .update({ status: plotStatusForStage(booking.stage as Stage) })
          .in('id', ids).eq('status', 'registry_done')
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bookings'] })
      qc.invalidateQueries({ queryKey: ['plots_avail'] })
      qc.invalidateQueries({ queryKey: ['plots'] })
      setRegistryFor(null)
      toast.success('Registry entry removed')
    },
    onError: (e: any) => toast.error(e.message),
  })

  const reopenBooking = useMutation({
    mutationFn: async (p: { booking: any; reason: string }) => {
      if (!p.reason) throw new Error('Reopen reason is required')
      const userId = await getCurrentUserId()
      const { error } = await supabase.from('bp_bookings').update({
        closed_at: null,
        reopened_at: new Date().toISOString(),
        reopened_by: userId,
        reopen_reason: p.reason,
        updated_at: new Date().toISOString(),
      }).eq('id', p.booking.id)
      if (error) throw error
      await syncPlotStatus(plotIdsOf(p.booking), p.booking.stage as Stage)
      await logClosure({ entityType: 'booking', entityId: p.booking.id, action: 'reopened', reason: p.reason, metadata: { booking_no: p.booking.booking_no } })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bookings'] })
      qc.invalidateQueries({ queryKey: ['plots_avail'] })
      qc.invalidateQueries({ queryKey: ['plots'] })
      toast.success('Booking reopened')
      setClosureFor(null)
    },
    onError: (e: any) => toast.error(e.message),
  })

  const open = (b?: any) => {
    setEditing(b || null)
    setForm(b ? {
      ...EMPTY,
      plot_ids: plotIdsOf(b), customer_id: b.customer_id || '',
      broker_id: b.broker_id || '', project_id: b.project_id || '',
      stage: (STAGES.includes(b.stage) ? b.stage : 'token_received'),
      size_sqyd: b.size_sqyd || b.bp_plots?.size_sqyd || '',
      rate_per_sqyd: b.rate_per_sqyd || b.bp_plots?.price_per_sqyd || '',
      dev_charges: b.dev_charges ?? '0',
      plc_charges: b.plc_charges ?? '0',
      discount_amount: b.discount_amount ?? '0',
      commission_mode: b.commission_mode || 'mlm',
      // Pick which input the admin used: prefer per_sqyd if it's set, else fall back to pct.
      traditional_input: b.traditional_commission_per_sqyd != null ? 'per_sqyd' : 'pct',
      traditional_commission_pct:      b.traditional_commission_pct      ?? '',
      traditional_commission_per_sqyd: b.traditional_commission_per_sqyd ?? '',
      traditional_pay_upline:          !!b.traditional_pay_upline,
      notes: b.notes || '',
      application_date: b.application_date || today(),
      booking_time: b.booking_time || '', customer_bank_name: b.customer_bank_name || '',
      upline_broker_code: b.upline_broker_code || '', manager_signature_by: b.manager_signature_by || '',
      affidavit_accepted: b.affidavit_accepted !== false,
      cust_mode: 'existing',
      expected_booking_amount: b.expected_booking_amount ?? '',
      token_enabled: false, booking_enabled: false, emi_enabled: false, full_enabled: false,
    } : { ...EMPTY, commission_mode: modeFilter === 'traditional' ? 'traditional' : 'mlm' })
    // Seed splitBrokers from existing bp_booking_brokers when editing; otherwise reset.
    setSplitBrokers([])
    if (b?.id) {
      supabase
        .from('bp_booking_brokers')
        .select('broker_id, commission_pct, position')
        .eq('booking_id', b.id)
        .order('position', { ascending: true })
        .then(({ data }) => {
          if (!data || data.length === 0) return
          // Position 1 stays in form.broker_id; positions 2+ live in splitBrokers state.
          setSplitBrokers(
            (data as any[]).filter(r => r.position > 1).map(r => ({
              broker_id: r.broker_id,
              commission_pct: String(r.commission_pct ?? ''),
              position: r.position,
            }))
          )
        })
    }
    setModal(true)
  }

  const save = async () => {
    // Broker is optional — admin asked for the mandatory marker to come off, since
    // plenty of sales are walk-in / direct with nobody to credit.  When one is picked
    // the trigger still uses broker_id to credit the commission; when it isn't, the
    // booking simply saves with no payout attached.

    // New-customer block: bp_customers.phone is NOT NULL on this schema, so blocking
    // here avoids hitting the generic "Could not save the booking" toast that admins
    // saw whenever the customer card was filled in without a mobile number.
    if (form.cust_mode === 'new') {
      const cName = (form.new_customer?.name || '').trim()
      const cPhone = (form.new_customer?.phone || '').trim()
      if (!cName)  { toast.error("Please enter the customer's full name."); return }
      if (!cPhone) { toast.error("Please enter the customer's mobile number — it's required to save the booking."); return }
    } else if (!form.customer_id) {
      toast.error("Pick a customer or switch to 'New customer' to add one."); return
    }

    // Commission on a traditional booking is optional too — leaving it blank saves the
    // booking with nothing to distribute (the broker earns ₹0 until admin fills it in
    // from Edit).  The form shows an inline heads-up instead of blocking the save.

    if (!editing) {
      if (form.token_enabled && !num(form.token_amount))     { toast.error('Token amount is required (or uncheck the section)'); return }
      if (form.booking_enabled && !num(form.booking_amount)) { toast.error('Booking amount is required (or uncheck the section if the customer has not paid the booking deposit yet)'); return }
      if (form.full_enabled && !num(form.full_amount))       { toast.error('Full payment amount is required (or uncheck the section)'); return }
    }
    // Thread splitBrokers state through to the mutation closures via the data payload —
    // it lives outside the form object so we attach it explicitly.
    const payload = { ...form, splitBrokers }
    if (editing) await update.mutateAsync({ id: editing.id, data: payload })
    else await create.mutateAsync(payload)
    setModal(false)
  }

  // Switching scheme drops plots picked from the previous scheme, so the scheme and the
  // plot list can never disagree about which project the booking belongs to.
  const handleProjectChange = (projectId: string) => {
    setForm((p: any) => {
      const kept = ((p.plot_ids || []) as string[]).filter(id => {
        const pl = plotOptions.find((x: any) => x.id === id)
        return pl?.project_id === projectId
      })
      return { ...p, project_id: projectId, plot_ids: kept, ...(pricingForPlots(
        kept.map(id => plotOptions.find((x: any) => x.id === id)).filter(Boolean),
      ) || {}) }
    })
  }

  // Add / remove a plot, re-deriving size, rate and PLC from whatever is selected after
  // the change so the pricing block always matches the plots on the booking.
  const applyPlotIds = (ids: string[]) => {
    const picked = ids.map(id => plotOptions.find((p: any) => p.id === id)).filter(Boolean)
    setForm((p: any) => ({
      ...p,
      plot_ids: ids,
      ...(pricingForPlots(picked) || {}),
      ...(picked[0]?.project_id ? { project_id: picked[0].project_id } : {}),
    }))
  }

  // What's still on offer in the dropdown — everything in the scheme minus what's picked.
  const addablePlots = useMemo(
    () => plotOptions.filter((p: any) => !((form.plot_ids || []) as string[]).includes(p.id)),
    [plotOptions, form.plot_ids],
  )

  const addPlot    = (plotId: string) => {
    if (!plotId || (form.plot_ids || []).includes(plotId)) return
    applyPlotIds([...(form.plot_ids || []), plotId])
  }
  const removePlot = (plotId: string) => applyPlotIds(((form.plot_ids || []) as string[]).filter(id => id !== plotId))

  const handleBrokerChange = (brokerId: string) => {
    setForm((p: any) => {
      const b = (brokers as any[]).find((br: any) => br.id === brokerId)
      const shouldPopulate = b?.broker_id && !p.upline_broker_code?.trim()
      return { ...p, broker_id: brokerId, upline_broker_code: shouldPopulate ? b.broker_id : p.upline_broker_code }
    })
  }

  // Save the inline-created broker: writes a brokers row with broker_type matching the
  // current booking mode, refetches the broker list, and auto-selects the new broker
  // so admin doesn't have to find them in the picker.
  const saveQuickBroker = async () => {
    if (!quickBroker) return
    const name = quickBroker.name.trim()
    const phone = quickBroker.phone.trim()
    if (!name) { toast.error('Please enter the broker name.'); return }
    if (!phone) { toast.error('Please enter a phone number.'); return }
    setQuickBrokerSaving(true)
    try {
      const broker_type = form.commission_mode === 'traditional' ? 'traditional' : 'mlm'
      // brokers.email is NOT NULL on this schema, so when admin doesn't type one we
      // synthesize a stable placeholder.  Phone-based is preferred (matches the
      // syntheticEmailFromPhone helper used elsewhere) and falls back to a random
      // suffix when phone is missing.
      const typedEmail = quickBroker.email.trim()
      const phoneDigits = phone.replace(/\D/g, '')
      const email = typedEmail || (phoneDigits ? `b${phoneDigits}@example.com` : `auto-${Date.now().toString(36)}@example.com`)
      const payload: any = {
        name,
        phone,
        email,
        broker_type,
        status: 'active',
        // MLM brokers default to the lowest active rank slab; traditional brokers don't use
        // ranks but the column is non-null so 'Executive' is the safe fallback either way.
        // Must match a row in commission_ranks (level 1, 5%) — anything else makes
        // recompute_booking_payouts hit direct_pct=0 and historically over-paid the upline cascade.
        rank: 'Executive',
      }
      const { data: created, error } = await supabase.from('brokers').insert(payload).select().single()
      if (error) throw error
      await qc.invalidateQueries({ queryKey: ['brokers'] })
      // Auto-select the new broker in the form
      handleBrokerChange(created.id)
      toast.success(`${broker_type === 'traditional' ? 'Traditional' : 'MLM'} broker added · selected`)
      setQuickBroker(null)
    } catch (e: any) {
      console.error('Quick broker save failed:', e)
      toast.error(friendlyError(e, 'Could not add the broker. Please check the name and phone and try again.'))
    } finally {
      setQuickBrokerSaving(false)
    }
  }

  const nextStage = (current: Stage): Stage | null => {
    const idx = PIPELINE_STAGES.indexOf(current)
    if (idx === -1 || idx >= PIPELINE_STAGES.length - 1) return null
    return PIPELINE_STAGES[idx + 1]
  }

  const all = bookings as any[]
  const totalValue  = all.filter((b: any) => b.stage === 'booking_done').reduce((s: number, b: any) => s + Number(b.total_amount || b.plot_total_price || 0), 0)

  // Money this booking has already banked (edit mode only) — a payment added from the
  // Edit modal sits on top of it, so previews and the "full payment" default have to
  // work off the outstanding balance, not the whole plot value.
  const alreadyPaid = editing ? Number(paidByBooking[editing.id] || 0) : 0
  const outstanding = Math.max(0, totalNet - alreadyPaid)

  const tokenAmt = form.token_enabled ? num(form.token_amount) : 0
  const bookingAmt = form.booking_enabled ? num(form.booking_amount) : 0
  const fullAmt = form.full_enabled ? (num(form.full_amount) || outstanding) : 0
  const paidToday = tokenAmt + bookingAmt + fullAmt
  const balanceDue = Math.max(0, outstanding - paidToday)
  const principalPreview = balanceDue
  const emiCount = Math.max(1, num(form.emi_n) || 12)
  const emiAmtPreview = principalPreview > 0 ? Math.round(principalPreview / emiCount) : 0
  // Inline breakdowns for Token / Booking sections
  const balanceAfterToken     = Math.max(0, totalNet - tokenAmt)
  const balanceAfterBooking   = Math.max(0, totalNet - tokenAmt - bookingAmt)
  const suggestedDeposit10pct = totalNet > 0 ? Math.round(totalNet * 0.10) : 0
  const perEmiAfterToken      = balanceAfterToken   > 0 ? Math.round(balanceAfterToken   / emiCount) : 0
  const perEmiAfterBooking    = balanceAfterBooking > 0 ? Math.round(balanceAfterBooking / emiCount) : 0
  const freqLabel             = form.emi_freq === 'monthly' ? '/mo' : form.emi_freq === 'quarterly' ? '/qtr' : form.emi_freq === 'half_yearly' ? '/6mo' : '/yr'

  const paidMap = paidByBooking as Record<string, number>
  const emiMap = emiByBooking as Record<string, boolean>

  const isClosed = (b: any) => !!b.closed_at

  const categorize = (b: any): Category => {
    if (b.stage === 'cancelled') return 'cancelled'
    if (b.stage === 'token_received') return 'token'
    const total = Number(b.total_amount || b.plot_total_price || 0)
    const paid = paidMap[b.id] || 0
    return total > 0 && paid >= total ? 'full' : 'advance'
  }

  // For per-tab counts: operational tabs exclude closed; "closed" is its own bucket.
  const categoryCounts = all.reduce((acc, b) => {
    if (isClosed(b)) { acc.closed++; acc.all++; return acc }
    acc[categorize(b)]++
    acc.all++
    return acc
  }, { all: 0, token: 0, advance: 0, full: 0, cancelled: 0, closed: 0 } as Record<Category, number>)

  const inCategory =
    category === 'all'    ? all :
    category === 'closed' ? all.filter(isClosed) :
                            all.filter((b: any) => !isClosed(b) && categorize(b) === category)

  // Apply admin filters (search, project, broker, stage, date range, sale mode)
  const filtered = inCategory.filter((b: any) => {
    // ?mode=traditional narrows the page to traditional bookings only — driven by the
    // "Traditional Bookings" sidebar entry so the same /bookings page can serve both
    // browsing experiences without splitting into a second route.
    if (modeFilter === 'traditional' && b.commission_mode !== 'traditional') return false
    if (filterProject && b.project_id !== filterProject) return false
    if (filterBroker  && b.broker_id  !== filterBroker)  return false
    if (filterStage   && b.stage      !== filterStage)   return false
    if (dateFrom && b.application_date && b.application_date < dateFrom) return false
    if (dateTo   && b.application_date && b.application_date > dateTo)   return false
    if (search.trim()) {
      const q = search.toLowerCase()
      const hay = [
        b.booking_no, b.bp_customers?.name, b.bp_customers?.phone, b.bp_customers?.customer_code,
        ...plotNosOf(b), b.brokers?.name, b.brokers?.broker_id,
        b.bp_projects?.name, b.scheme_name,
      ].filter(Boolean).join(' ').toLowerCase()
      if (!hay.includes(q)) return false
    }
    return true
  })

  const filtersActive = !!(search || filterProject || filterBroker || filterStage || dateFrom || dateTo)
  const clearFilters = () => { setSearch(''); setFilterProject(''); setFilterBroker(''); setFilterStage(''); setDateFrom(''); setDateTo('') }

  const fullyPaid = (b: any) => {
    const total = Number(b.total_amount || b.plot_total_price || 0)
    return total > 0 && (paidMap[b.id] || 0) >= total
  }
  const canClose = (b: any) => !isClosed(b) && (fullyPaid(b) || b.stage === 'cancelled')

  // ── Selection ─────────────────────────────────────────────────
  const toggleSelect = (id: string) => setSelectedIds(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  const toggleSelectAll = () => setSelectedIds(prev => prev.size === filtered.length ? new Set() : new Set(filtered.map((b: any) => b.id)))
  const selectedRows = filtered.filter((b: any) => selectedIds.has(b.id))
  const closeableSelected = selectedRows.filter((b: any) => canClose(b))

  // ── CSV export ────────────────────────────────────────────────
  const exportCSV = () => {
    const rows = filtered
    if (rows.length === 0) return toast.error('Nothing to export')
    const headers = ['Booking No','Date','Customer','Phone','Plot','Project','Broker','Broker Code','Stage','Total','Paid','Balance','Closed']
    const data = rows.map((b: any) => {
      const total = Number(b.total_amount || b.plot_total_price || 0)
      const paid  = Number(paidMap[b.id] || 0)
      return [
        b.booking_no || '',
        b.application_date || '',
        b.bp_customers?.name || '',
        b.bp_customers?.phone || '',
        plotNosOf(b).join(' | ') || '',
        b.bp_projects?.name || '',
        b.brokers?.name || '',
        b.brokers?.broker_id || '',
        b.stage || '',
        total, paid, Math.max(0, total - paid),
        b.closed_at ? new Date(b.closed_at).toISOString().slice(0,10) : '',
      ]
    })
    const csv = [headers, ...data].map(r => r.map(cell => {
      const s = String(cell ?? '')
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
    }).join(',')).join('\r\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `bookings-${new Date().toISOString().slice(0,10)}.csv`; a.click()
    URL.revokeObjectURL(url)
    toast.success(`${rows.length} rows exported`)
  }

  // ── Bulk close ────────────────────────────────────────────────
  const bulkClose = useMutation({
    mutationFn: async ({ items, reason }: { items: any[]; reason: string }) => {
      const userId = await getCurrentUserId()
      const now = new Date().toISOString()
      for (const b of items) {
        const { error } = await supabase.from('bp_bookings').update({
          closed_at: now, closed_by: userId, closure_notes: reason || null,
          reopened_at: null, reopened_by: null, reopen_reason: null, updated_at: now,
        }).eq('id', b.id)
        if (error) throw error
        const soldIds = plotIdsOf(b)
        if (soldIds.length > 0 && b.stage === 'booking_done') {
          await supabase.from('bp_plots').update({ status: 'registry_done' }).in('id', soldIds)
        }
        await logClosure({ entityType: 'booking', entityId: b.id, action: 'closed', reason, metadata: { bulk: true, booking_no: b.booking_no, stage: b.stage } })
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bookings'] })
      qc.invalidateQueries({ queryKey: ['plots_avail'] })
      qc.invalidateQueries({ queryKey: ['plots'] })
      toast.success(`${bulkCloseFor?.length || 0} bookings closed`)
      setBulkCloseFor(null); setSelectedIds(new Set())
    },
    onError: (e: any) => toast.error(e.message),
  })

  const cols = [
    {
      key: '__select__',
      header: (
        <input type="checkbox"
          checked={filtered.length > 0 && selectedIds.size === filtered.length}
          ref={(el: any) => { if (el) el.indeterminate = selectedIds.size > 0 && selectedIds.size < filtered.length }}
          onChange={toggleSelectAll}
          className="rounded border-gray-300"/>
      ),
      render: (r: any) => (
        <input type="checkbox" checked={selectedIds.has(r.id)} onChange={() => toggleSelect(r.id)} className="rounded border-gray-300"/>
      ),
    },
    { header: 'Booking No', render: (r: any) => (
      <div className="leading-tight">
        <span className="font-mono text-xs font-semibold text-blue-700">{r.booking_no}</span>
        {/* Sale-mode badge — admin can scan the list and spot Traditional sales without
            opening each row.  Default MLM is not badged because every booking is MLM
            unless explicitly switched. */}
        {r.commission_mode === 'traditional' && (
          <div className="mt-0.5 inline-flex items-center gap-1 text-[9px] font-semibold text-amber-800 bg-amber-100 border border-amber-200 rounded-full px-1.5 py-0.5" title="Sold the traditional way — custom commission, no MLM upline cascade unless opted in">
            TRADITIONAL
            {r.traditional_commission_pct != null && <span className="font-mono opacity-80">· {r.traditional_commission_pct}%</span>}
            {r.traditional_commission_per_sqyd != null && <span className="font-mono opacity-80">· ₹{r.traditional_commission_per_sqyd}/sqyd</span>}
          </div>
        )}
      </div>
    )},
    {
      header: 'Customer',
      render: (r: any) => {
        const cid = r.bp_customers?.id || r.customer_id
        const name = r.bp_customers?.name || '—'
        const sub = `${r.bp_customers?.customer_code ? r.bp_customers.customer_code + ' · ' : ''}${r.bp_customers?.phone || ''}`
        return cid ? (
          <Link to={`/customer-pipeline?customer=${cid}`} className="block group">
            <div className="font-medium text-gray-900 group-hover:text-blue-700 group-hover:underline">{name}</div>
            <div className="text-xs text-gray-400">{sub}</div>
          </Link>
        ) : (
          <div>
            <div className="font-medium text-gray-900">{name}</div>
            <div className="text-xs text-gray-400">{sub}</div>
          </div>
        )
      },
    },
    {
      header: 'Plot / Scheme',
      render: (r: any) => (
        <div>
          <div className="font-medium text-sm" title={plotNosOf(r).join(', ')}>{plotLabelOf(r)}</div>
          <div className="text-xs text-gray-400">{(r.size_sqyd || r.bp_plots?.size_sqyd || '—')} sqyd · {r.bp_projects?.name || r.scheme_name || ''}</div>
        </div>
      ),
    },
    {
      header: 'Broker',
      render: (r: any) => {
        const bid = r.broker_id
        const name = r.brokers?.name
        if (!bid || !name) return <span className="text-sm text-gray-400">—</span>
        return (
          <Link to={`/brokers/${bid}`} className="text-sm text-blue-700 hover:underline">
            {name}{r.brokers?.broker_id ? <span className="text-[10px] text-gray-400 ml-1">[{r.brokers.broker_id}]</span> : null}
          </Link>
        )
      },
    },
    {
      header: 'Net / Base',
      render: (r: any) => (
        <div>
          <div className="font-semibold text-green-700">{formatINR(r.total_amount || r.plot_total_price)}</div>
          <div className="text-[10px] text-gray-400">Base {formatINR(r.base_price || (r.size_sqyd && r.rate_per_sqyd ? r.size_sqyd * r.rate_per_sqyd : 0))}</div>
        </div>
      ),
    },
    {
      header: 'Paid / Balance',
      render: (r: any) => {
        const paid = paidMap[r.id] || 0
        const total = Number(r.total_amount || r.plot_total_price || 0)
        const bal = Math.max(0, total - paid)
        return (
          <div>
            <div className="font-semibold text-emerald-700 text-sm">{formatINR(paid)}</div>
            <div className={`text-[11px] font-medium ${bal > 0 ? 'text-orange-600' : 'text-gray-400'}`}>Bal {formatINR(bal)}</div>
          </div>
        )
      },
    },
    {
      header: 'Stage',
      render: (r: any) => {
        const meta = STAGE_META[r.stage as Stage] || STAGE_META.token_received
        const bookingPending = r.stage === 'token_received' && !Number(r.booking_amount || 0)
        const bookingReceived = r.stage === 'token_received' && Number(r.booking_amount || 0) > 0
        return (
          <div className="flex flex-col gap-1">
            <Badge label={meta.label} className={meta.color} />
            {bookingPending && (
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-amber-800 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded">
                ⏳ Booking deposit pending{r.expected_booking_amount ? ` · expects ${formatINR(r.expected_booking_amount)}` : ''}
              </span>
            )}
            {bookingReceived && (
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-blue-700 bg-blue-50 border border-blue-200 px-1.5 py-0.5 rounded">
                ₹{Number(r.booking_amount).toLocaleString()} booking paid
              </span>
            )}
            {isClosed(r) && (
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-slate-700 bg-slate-100 border border-slate-200 px-1.5 py-0.5 rounded">
                <Lock size={9}/>Closed {formatDate(r.closed_at)}
              </span>
            )}
            {/* Registry status is derived from registry_date alone — there is no separate
                status column that could drift out of step with the date. */}
            {r.registry_date && (
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-teal-800 bg-teal-50 border border-teal-200 px-1.5 py-0.5 rounded">
                <ScrollText size={9}/>Registry done {formatDate(r.registry_date)}
              </span>
            )}
          </div>
        )
      },
    },
    { header: 'Date', render: (r: any) => <span className="text-xs text-gray-500">{formatDate(r.application_date || r.created_at)}</span> },
    {
      header: 'Actions',
      // Slim action set — Bookings is the create/edit page; Customer Pipeline does day-to-day payments.
      render: (r: any) => {
        const locked = isClosed(r)
        return (
          <div className="flex gap-1 flex-wrap">
            <Link to={`/customer-pipeline?booking=${r.id}`}
              className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md bg-indigo-50 text-indigo-700 border border-indigo-200 hover:bg-indigo-100">
              <Users size={11}/>Pipeline
            </Link>
            {!locked && <Button size="sm" variant="ghost" onClick={() => open(r)}><FileText size={12} />Edit</Button>}
            <Button size="sm" variant="ghost" onClick={() => printApplicationForm(r)}><Printer size={12} />Form</Button>
            {locked && (
              <Button size="sm" variant="secondary" onClick={() => setClosureFor({ booking: r, action: 'reopen' })}>
                <Unlock size={12}/>Reopen
              </Button>
            )}
            {!locked && canClose(r) && (
              <Button size="sm" variant="secondary" onClick={() => setClosureFor({ booking: r, action: 'close' })}>
                <Lock size={12}/>Close
              </Button>
            )}
            {r.stage !== 'cancelled' && (
              <Button size="sm" variant="ghost" onClick={() => openRegistry(r)}>
                <ScrollText size={12}/>{r.registry_date ? 'Registry ✓' : 'Registry'}
              </Button>
            )}
          </div>
        )
      },
    },
  ]

  // Auto-open edit modal when arriving from /customer-pipeline?edit=<id> or /bookings?edit=<id>
  useEffect(() => {
    const editId = searchParams.get('edit')
    if (editId && all.length > 0 && !modal) {
      const target = all.find((b: any) => b.id === editId)
      if (target) {
        open(target)
        // Clear the param so the modal doesn't keep re-opening
        const next = new URLSearchParams(searchParams)
        next.delete('edit')
        setSearchParams(next, { replace: true })
      }
    }
  }, [searchParams, all.length])

  // Recent bookings — just the last 10 for verification; full management is in Customer Pipeline
  const recent = (all as any[]).slice(0, 10)

  return (
    <div className="p-4 md:p-8 space-y-6 max-w-4xl mx-auto">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold text-gray-900 tracking-tight">
          {modeFilter === 'traditional' ? 'Traditional Bookings' : 'Create a booking'}
        </h1>
        <p className="text-sm text-gray-500 mt-1">
          {modeFilter === 'traditional'
            ? <>Custom-commission sales (single or multi-broker split). New bookings here default to traditional mode. <Link to="/bookings" className="text-blue-700 hover:underline">All bookings →</Link></>
            : <>{all.length} bookings · Confirmed value {formatINR(totalValue)}. Manage payments &amp; EMIs in <Link to="/customer-pipeline" className="text-blue-700 hover:underline">Customer Pipeline →</Link></>
          }
        </p>
      </div>

      <div className="flex flex-wrap gap-3 items-center">
        <button onClick={() => open()}
          className="inline-flex items-center gap-1.5 px-5 py-2.5 rounded-full bg-gray-900 text-white text-sm font-semibold hover:bg-black shadow-sm transition">
          <Plus size={14}/>New Booking
        </button>
        <Link to="/customer-pipeline"
          className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-full bg-white border border-gray-200 text-gray-700 text-sm hover:border-gray-300 transition">
          <Users size={14}/>Open Customer Pipeline
        </Link>
      </div>

      {/* Minimal recent list — read-only, just for verification. */}
      <div>
        <div className="text-[11px] uppercase tracking-wider text-gray-500 mb-2 px-1">Recent bookings</div>
        <div className="bg-white border border-gray-200 rounded-2xl divide-y divide-gray-100 overflow-hidden">
          {isLoading && <div className="py-10 text-center text-sm text-gray-400">Loading…</div>}
          {!isLoading && recent.length === 0 && (
            <div className="py-12 text-center text-sm text-gray-400">
              No bookings yet. <button onClick={() => open()} className="text-blue-700 hover:underline">Create the first one →</button>
            </div>
          )}
          {recent.map((r: any) => (
            <div key={r.id} className="px-4 py-3 hover:bg-gray-50/40 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-gray-900 truncate">{r.bp_customers?.name || '—'}</div>
                <div className="text-[12px] text-gray-500 truncate">
                  <span className="font-mono">{r.booking_no}</span>
                  {plotNosOf(r).length > 0 && <> · Plot{plotNosOf(r).length > 1 ? 's' : ''} {plotNosOf(r).join(', ')}</>}
                  {(r.bp_projects?.name || r.scheme_name) && <> · {r.bp_projects?.name || r.scheme_name}</>}
                  {r.brokers?.name && <> · {r.brokers.name}</>}
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className="text-sm font-semibold text-gray-900 tabular-nums">{formatINR(r.total_amount || r.plot_total_price || 0)}</div>
                <div className="text-[11px] text-gray-400">{formatDate(r.application_date || r.created_at)}</div>
              </div>
              <Link to={`/customer-pipeline?booking=${r.id}`} className="text-[12px] text-blue-700 hover:underline whitespace-nowrap">Manage →</Link>
            </div>
          ))}
        </div>
        {all.length > recent.length && (
          <div className="text-center mt-3">
            <Link to="/customer-pipeline" className="text-sm text-blue-700 hover:underline">See all {all.length} in Customer Pipeline →</Link>
          </div>
        )}
      </div>

      <Modal open={modal} onClose={() => setModal(false)} title={editing ? 'Edit Booking' : 'New Booking — आवेदन-पत्र'}>
        <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">आवासीय योजना (Scheme) & Plot</div>
        <div className="grid grid-cols-2 gap-3">
          <Select label="आवासीय योजना का नाम (Project / Scheme)" value={form.project_id} onChange={(e: any) => handleProjectChange(e.target.value)} className="col-span-2">
            <option value="">{(projects as any[]).length === 0 ? 'No projects yet' : 'Select scheme / project'}</option>
            {(projects as any[]).map((p: any) => <option key={p.id} value={p.id}>{p.name}{p.location ? ` · ${p.location}` : ''}</option>)}
          </Select>
          {/* Plot list is scoped to the scheme selected above — picking Brij Vatika shows
              Brij Vatika's available plots only.  The select adds a plot to the booking
              rather than replacing it, so a customer buying two plots gets one booking. */}
          <Select
            label="Plot (Available) — प्लॉट नं. (एक से ज़्यादा भी चुन सकते हैं)"
            value=""
            onChange={(e: any) => addPlot(e.target.value)}
            className="col-span-2"
            disabled={!form.project_id || addablePlots.length === 0}
          >
            <option value="">
              {!form.project_id
                ? 'Select a scheme / project first'
                : addablePlots.length === 0
                  ? (selectedPlots.length > 0 ? 'No more available plots in this scheme' : 'No available plots in this scheme')
                  : selectedPlots.length > 0 ? '+ Add another plot' : 'Select Plot'}
            </option>
            {addablePlots.map((p: any) => <option key={p.id} value={p.id}>{p.plot_no} — {p.size_sqyd} sqyd @ {formatINR(p.price_per_sqyd)}/gaj</option>)}
          </Select>

          {/* Selected plots — chips with the running total, so admin can see (and undo)
              exactly which plots this one booking covers. */}
          {selectedPlots.length > 0 && (
            <div className="col-span-2 -mt-1">
              <div className="flex flex-wrap gap-1.5">
                {selectedPlots.map((p: any, i: number) => (
                  <span key={p.id} className="inline-flex items-center gap-1.5 bg-blue-50 border border-blue-200 text-blue-900 rounded-lg pl-2 pr-1 py-1 text-xs">
                    <b>{p.plot_no}</b>
                    <span className="text-blue-700/70">{p.size_sqyd} sqyd @ {formatINR(p.price_per_sqyd)}/gaj</span>
                    {i === 0 && selectedPlots.length > 1 && <span className="text-[9px] uppercase tracking-wide bg-blue-600 text-white rounded px-1 py-0.5">main</span>}
                    <button type="button" onClick={() => removePlot(p.id)} className="text-blue-500 hover:text-rose-600 hover:bg-white rounded p-0.5" title="Remove this plot">
                      <X size={12} />
                    </button>
                  </span>
                ))}
              </div>
              {selectedPlots.length > 1 && (
                <div className="mt-1.5 text-[11px] text-blue-800 bg-blue-50/60 border border-blue-200 rounded-lg px-2 py-1.5">
                  {selectedPlots.length} plots on this booking — total{' '}
                  <b>{round2(selectedPlots.reduce((s: number, p: any) => s + num(p.size_sqyd), 0))} sqyd</b>.
                  Size, rate and PLC below are filled from all of them (rate is the size-weighted average); you can still type over them.
                </div>
              )}
            </div>
          )}

          {form.project_id && (
            <div className="col-span-2 -mt-1 text-[11px] text-gray-500">
              {(plots as any[]).length > 0
                ? <>{(plots as any[]).length} plot{(plots as any[]).length === 1 ? '' : 's'} available in {(projects as any[]).find((p: any) => p.id === form.project_id)?.name || 'this scheme'}.</>
                : <>No available plots left in this scheme — add plots from the Plots page or pick another scheme.</>}
            </div>
          )}
        </div>

        <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2 mt-4 pt-3 border-t border-gray-100">Pricing Inputs</div>
        <div className="grid grid-cols-2 gap-3">
          <Input label="आकार / Size (वर्ग गज / sq.yd)" type="number" value={form.size_sqyd} onChange={(e:any) => set('size_sqyd', e.target.value)} />
          <Input label="प्रति गज दर / Rate per sq.yd (₹)" type="number" value={form.rate_per_sqyd} onChange={(e:any) => set('rate_per_sqyd', e.target.value)} />
          <Input label="विकास शुल्क / Development charges (₹)" type="number" value={form.dev_charges} onChange={(e:any) => set('dev_charges', e.target.value)} placeholder="0" />
          <Input label="PLC charges (₹)" type="number" value={form.plc_charges} onChange={(e:any) => set('plc_charges', e.target.value)} placeholder="auto from plot" />
          <Input label="Discount (₹)" type="number" value={form.discount_amount} onChange={(e:any) => set('discount_amount', e.target.value)} />
        </div>

        {totalNet > 0 && (
          <div className="mt-3 px-3 py-2 bg-emerald-50 border border-emerald-200 rounded-lg text-sm flex items-center justify-between">
            <span className="text-emerald-900">कुल नेट / Total net value</span>
            <span className="text-emerald-700 font-bold">{formatINR(totalNet)}</span>
          </div>
        )}

        {/* Commission mode -- MLM (broker rank + upline cascade) or Traditional (admin-defined
            commission paid only to the direct broker, with optional upline cascade).  Defaults
            to MLM so existing flows keep working unchanged.  The selected mode + value are
            persisted to bp_bookings.commission_mode + traditional_commission_pct /
            traditional_commission_per_sqyd, which the recompute_booking_payouts trigger reads. */}
        <div className="mt-4 rounded-lg border border-gray-200 overflow-hidden">
          <div className="flex">
            <button
              type="button"
              onClick={() => set('commission_mode', 'mlm')}
              className={`flex-1 px-3 py-2 text-sm font-medium transition ${form.commission_mode !== 'traditional' ? 'bg-blue-600 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'}`}
            >
              MLM (rank-based + upline cascade)
            </button>
            <button
              type="button"
              onClick={() => set('commission_mode', 'traditional')}
              className={`flex-1 px-3 py-2 text-sm font-medium transition ${form.commission_mode === 'traditional' ? 'bg-amber-600 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'}`}
            >
              Traditional (custom commission)
            </button>
          </div>

          {form.commission_mode === 'traditional' && (
            <div className="p-3 bg-amber-50/40 border-t border-amber-200 space-y-3">
              <p className="text-xs text-amber-900">
                Traditional sale -- the system uses the value below instead of the broker's rank %.
                Direct broker gets paid only; upline cascade is OFF by default.
              </p>

              {/* Commission is no longer mandatory — but a blank value means nothing gets
                  distributed, so say so plainly instead of blocking the save. */}
              {(() => {
                const primary = form.traditional_input === 'per_sqyd'
                  ? num(form.traditional_commission_per_sqyd)
                  : num(form.traditional_commission_pct)
                const extras = (splitBrokers || []).reduce((s, x) => s + num(x.commission_pct), 0)
                if (primary > 0 || extras > 0) return null
                return (
                  <div className="text-[11px] bg-white border border-amber-300 text-amber-900 rounded-lg px-2 py-1.5">
                    No commission set — the booking will save, but the broker earns ₹0 until you add a value here.
                  </div>
                )
              })()}

              {/* Choose the input shape -- a straight % OR Rs/gaj */}
              <div className="flex gap-2 text-xs">
                <label className={`flex-1 cursor-pointer px-3 py-2 rounded-lg border ${form.traditional_input === 'pct' ? 'border-amber-500 bg-white' : 'border-gray-200 bg-white/60'}`}>
                  <input type="radio" name="trad_input" className="mr-1.5" checked={form.traditional_input === 'pct'} onChange={() => set('traditional_input', 'pct')}/>
                  <b>Custom %</b> of deposited amount
                </label>
                <label className={`flex-1 cursor-pointer px-3 py-2 rounded-lg border ${form.traditional_input === 'per_sqyd' ? 'border-amber-500 bg-white' : 'border-gray-200 bg-white/60'}`}>
                  <input type="radio" name="trad_input" className="mr-1.5" checked={form.traditional_input === 'per_sqyd'} onChange={() => set('traditional_input', 'per_sqyd')}/>
                  <b>Rs per gaj</b> (sq.yd) -- traditional
                </label>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                {form.traditional_input === 'pct' ? (
                  <Input
                    label="Commission % of each payment (optional)"
                    type="number"
                    value={form.traditional_commission_pct}
                    onChange={(e: any) => set('traditional_commission_pct', e.target.value)}
                    placeholder="e.g. 2.5"
                  />
                ) : (
                  <>
                    <Input
                      label="Commission rate per gaj (₹/sq.yd) (optional)"
                      type="number"
                      value={form.traditional_commission_per_sqyd}
                      onChange={(e: any) => set('traditional_commission_per_sqyd', e.target.value)}
                      placeholder="e.g. 100"
                    />
                    {/* Live preview: total commission + equivalent % so admin sees what'll be saved */}
                    {(() => {
                      const psy = num(form.traditional_commission_per_sqyd)
                      const sz  = num(form.size_sqyd)
                      const tot = totalNet
                      if (psy <= 0 || sz <= 0) return null
                      const totalComm = Math.round(psy * sz)
                      const eqPct = tot > 0 ? round2((totalComm / tot) * 100) : 0
                      return (
                        <div className="rounded-lg bg-white border border-amber-200 p-2 text-xs flex flex-col justify-center">
                          <div className="text-gray-500">Total commission ({sz} sq.yd × ₹{psy})</div>
                          <div className="font-bold text-amber-900">{formatINR(totalComm)} <span className="text-gray-500 font-normal">≈ {eqPct}% of total</span></div>
                        </div>
                      )
                    })()}
                  </>
                )}
              </div>

              <label className="flex items-center gap-2 text-xs text-gray-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={!!form.traditional_pay_upline}
                  onChange={e => set('traditional_pay_upline', e.target.checked)}
                  className="rounded"
                />
                Also pay upline differential (mixed mode — uncommon)
              </label>

              {/* Multi-broker split — admin can add up to 2 more brokers to share the
                  commission on a single traditional sale.  Each additional broker has
                  their own commission %.  When at least one extra broker is added,
                  the trigger uses bp_booking_brokers rows instead of the single % above. */}
              <div className="border-t border-amber-200 pt-3 mt-1">
                <div className="flex items-center justify-between mb-2">
                  <div>
                    <div className="text-xs font-semibold text-amber-900">Sold with help of other brokers? (optional)</div>
                    <div className="text-[10px] text-amber-800">Add up to 2 more brokers and choose what % each gets on every payment.</div>
                  </div>
                  {splitBrokers.length < 2 && (
                    <button type="button"
                      onClick={() => setSplitBrokers([...splitBrokers, { broker_id: '', commission_pct: '', position: splitBrokers.length + 2 }])}
                      className="text-xs font-medium bg-amber-600 hover:bg-amber-700 text-white px-3 py-1.5 rounded-lg">
                      + Add broker
                    </button>
                  )}
                </div>
                {splitBrokers.length > 0 && (
                  <div className="space-y-2">
                    {splitBrokers.map((sb, idx) => (
                      <div key={idx} className="flex gap-2 items-center bg-white border border-amber-200 rounded-lg p-2">
                        <span className="shrink-0 text-[10px] uppercase tracking-wide font-bold text-amber-700">#{sb.position}</span>
                        <select
                          value={sb.broker_id}
                          onChange={e => setSplitBrokers(splitBrokers.map((x, i) => i === idx ? { ...x, broker_id: e.target.value } : x))}
                          className="flex-1 border border-gray-200 rounded-lg px-2 py-1.5 text-sm"
                        >
                          <option value="">— pick broker —</option>
                          {/* Use the SAME pool as the primary picker so MLM brokers don't
                              leak into a Traditional booking's split selector.  Was just
                              `brokers` before, which is the bug admin was reporting. */}
                          {pickerBrokers
                            .filter((b: any) => b.id !== form.broker_id && !splitBrokers.some((x, i) => i !== idx && x.broker_id === b.id))
                            .map((b: any) => <option key={b.id} value={b.id}>{b.name} [{b.broker_id}]</option>)}
                        </select>
                        <input
                          type="number"
                          value={sb.commission_pct}
                          onChange={e => setSplitBrokers(splitBrokers.map((x, i) => i === idx ? { ...x, commission_pct: e.target.value } : x))}
                          placeholder="% of payment"
                          className="w-28 border border-gray-200 rounded-lg px-2 py-1.5 text-sm"
                        />
                        <button type="button"
                          onClick={() => setSplitBrokers(splitBrokers.filter((_, i) => i !== idx).map((x, i) => ({ ...x, position: i + 2 })))}
                          className="text-rose-600 hover:bg-rose-50 px-2 py-1 rounded text-xs">
                          Remove
                        </button>
                      </div>
                    ))}
                    {/* Live total so admin sees the combined commission burden at a glance */}
                    {(() => {
                      const primary = num(form.traditional_input === 'pct' ? form.traditional_commission_pct : 0)
                      const extra = splitBrokers.reduce((s, x) => s + num(x.commission_pct), 0)
                      const total = round2(primary + extra)
                      return (
                        <div className="text-[11px] text-amber-900 px-1">
                          Total commission paid per verified payment: <b>{total}%</b>
                          {' '} (primary {primary}% + extras {extra}%)
                        </div>
                      )
                    })()}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Payment plan is available while editing too — admin books the plot first with
            no money taken (just to get the ID out), then reopens the booking and records
            the token / booking deposit when it actually arrives.  Anything ticked here on
            an edit is recorded as a NEW payment on top of what the booking already
            collected; nothing that was already received is re-posted. */}
        <>
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2 mt-4 pt-3 border-t border-gray-100">
              {editing ? 'Add a payment' : 'Payment Plan'}
            </div>
            <div className="text-[11px] text-gray-500 mb-3">
              {editing
                ? 'Tick only what the customer is paying NOW — it is added on top of whatever this booking has already collected. Leave everything unticked to just save the other edits.'
                : 'Tick everything the customer is paying today. Token + Booking + EMI combinations are supported.'}
            </div>
            {editing && (
              <div className="text-[11px] mb-3 rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-2 text-gray-700">
                Already collected on this booking: <b>{formatINR(paidMap[editing.id] || 0)}</b>
                {' '}of {formatINR(Number(editing.total_amount || editing.plot_total_price || 0))}
                {emiByBooking[editing.id] && <> · EMI schedule already set up — manage it from the EMI panel.</>}
              </div>
            )}

            <PayBlock checked={form.token_enabled} onCheck={v => set('token_enabled', v)} label="Token amount" subtitle={
              form.token_enabled && !form.booking_enabled
                ? 'Token-only today — booking deposit will be recorded later from the Bookings list.'
                : 'Token receipt will be auto-generated'
            } color="amber"
              warning={form.token_enabled && !num(form.token_amount) ? 'Enter the token amount or uncheck this section' : undefined}>
              <PayFields prefix="token" form={form} set={set}
                amountError={form.token_enabled && !num(form.token_amount) ? 'Required' : undefined} />

              {/* Expected (unpaid) booking deposit — purely informational, does NOT trigger MLM */}
              {form.token_enabled && !form.booking_enabled && (
                <div className="mt-3 rounded-lg border border-dashed border-blue-300 bg-blue-50/30 p-3">
                  <label className="flex items-start gap-2">
                    <div className="flex-1">
                      <div className="text-sm font-semibold text-blue-900">Expected booking deposit (unpaid)</div>
                      <div className="text-[11px] text-blue-700/80">
                        Planned amount the customer will pay later. Tracked on the booking — <b>MLM commission does NOT distribute on this amount</b> until it's actually received.
                      </div>
                      <div className="grid grid-cols-2 gap-3 mt-2">
                        <Input label="Expected amount (₹)" type="number" value={form.expected_booking_amount}
                          onChange={(e: any) => set('expected_booking_amount', e.target.value)}
                          placeholder={`e.g. ${suggestedDeposit10pct ? formatINR(suggestedDeposit10pct).replace('₹','') : '1,00,000'}`} />
                        {num(form.expected_booking_amount) > 0 && (
                          <div className="bg-white border border-blue-200 rounded-lg px-3 py-2 text-xs flex flex-col justify-center">
                            <span className="text-blue-700">Balance after booking deposit</span>
                            <span className="font-semibold text-orange-700">{formatINR(Math.max(0, totalNet - tokenAmt - num(form.expected_booking_amount)))}</span>
                          </div>
                        )}
                      </div>
                    </div>
                  </label>
                </div>
              )}

              {/* Explicit "What about the booking deposit?" decision panel — appears whenever token is being received but booking is not yet decided */}
              {form.token_enabled && num(form.token_amount) > 0 && !form.booking_enabled && (
                <div className="mt-3 rounded-lg border border-blue-200 bg-blue-50/60 p-3">
                  <div className="text-[11px] font-semibold text-blue-900 mb-2 uppercase tracking-wider">Booking deposit — what now?</div>
                  <div className="flex flex-wrap gap-2">
                    <button type="button"
                      onClick={() => { set('booking_enabled', true); set('booking_amount', String(suggestedDeposit10pct)); set('booking_date', form.token_date) }}
                      className="flex-1 min-w-[140px] text-left px-3 py-2 text-xs rounded-md bg-blue-600 text-white hover:bg-blue-700">
                      <div className="font-semibold">Receiving today (10% suggested)</div>
                      <div className="opacity-80 text-[11px]">{formatINR(suggestedDeposit10pct)} — tick Booking section</div>
                    </button>
                    <button type="button"
                      onClick={() => { set('booking_enabled', true); set('booking_amount', '') }}
                      className="flex-1 min-w-[140px] text-left px-3 py-2 text-xs rounded-md bg-white border border-blue-300 text-blue-800 hover:bg-blue-50">
                      <div className="font-semibold">Receiving today — custom amount</div>
                      <div className="opacity-80 text-[11px]">opens Booking section blank</div>
                    </button>
                    <div className="flex-1 min-w-[140px] px-3 py-2 text-xs rounded-md bg-amber-50 border border-amber-200 text-amber-900">
                      <div className="font-semibold">⏳ Pending — record later</div>
                      <div className="opacity-80 text-[11px]">leave both unticked, list will flag it</div>
                    </div>
                  </div>
                </div>
              )}

              {form.token_enabled && (
                <InlineBreakdown
                  hint={totalNet <= 0 ? 'Enter Size + Rate per sq.yd above to see live balance & EMI numbers.' : undefined}
                  rows={[
                    { label: 'Total plot value', value: formatINR(totalNet), accent: 'text-gray-700' },
                    { label: 'Balance after token', value: formatINR(balanceAfterToken), accent: 'text-orange-700' },
                    { label: '10% booking deposit (suggested)', value: formatINR(suggestedDeposit10pct), accent: 'text-blue-700' },
                    { label: `${emiCount} ${form.emi_freq.replace(/_/g, ' ')} EMIs on balance`, value: `${formatINR(perEmiAfterToken)}${freqLabel}`, accent: 'text-emerald-700' },
                  ]}
                  emiN={form.emi_n}
                  emiFreq={form.emi_freq}
                  onN={(v: any) => set('emi_n', v)}
                  onFreq={(v: any) => set('emi_freq', v)}
                />
              )}
            </PayBlock>

            <PayBlock checked={form.booking_enabled} onCheck={v => set('booking_enabled', v)} label="Booking amount (deposit)" subtitle={
              !form.booking_enabled
                ? form.token_enabled
                  ? 'Customer is only paying token today? Leave this off — record the deposit later.'
                  : 'Tick this when the customer is paying the booking deposit today.'
                : form.token_enabled
                  ? 'Token + Booking — full upfront. The booking will advance to "Booking Done".'
                  : 'Booking-deposit-only today (no separate token).'
            } color="blue"
              warning={form.booking_enabled && !num(form.booking_amount) ? 'Enter the booking deposit amount, or uncheck if the customer has not paid it yet.' : undefined}>
              <PayFields prefix="booking" form={form} set={set}
                amountError={form.booking_enabled && !num(form.booking_amount) ? 'Required when this section is enabled' : undefined} />
              {form.booking_enabled && (
                <InlineBreakdown
                  hint={totalNet <= 0 ? 'Enter Size + Rate per sq.yd above to see live balance & EMI numbers.' : undefined}
                  rows={[
                    { label: 'Total plot value', value: formatINR(totalNet), accent: 'text-gray-700' },
                    { label: 'Balance after booking deposit', value: formatINR(balanceAfterBooking), accent: 'text-orange-700' },
                    { label: `${emiCount} ${form.emi_freq.replace(/_/g, ' ')} EMIs on balance`, value: `${formatINR(perEmiAfterBooking)}${freqLabel}`, accent: 'text-emerald-700' },
                    { label: 'Total payable across EMIs', value: formatINR(perEmiAfterBooking * emiCount), accent: 'text-gray-700' },
                  ]}
                  emiN={form.emi_n}
                  emiFreq={form.emi_freq}
                  onN={(v: any) => set('emi_n', v)}
                  onFreq={(v: any) => set('emi_freq', v)}
                  actions={
                    !form.emi_enabled && balanceAfterBooking > 0 ? (
                      <button type="button" onClick={() => set('emi_enabled', true)}
                        className="text-[11px] px-2 py-1 rounded-md bg-emerald-600 text-white hover:bg-emerald-700 whitespace-nowrap">
                        Auto-create EMI schedule
                      </button>
                    ) : null
                  }
                />
              )}
            </PayBlock>

            <PayBlock checked={form.emi_enabled} onCheck={v => set('emi_enabled', v)} label="EMI plan for the balance" subtitle={`Principal: ${formatINR(principalPreview)} · Per instalment: ${formatINR(emiAmtPreview)}`} color="emerald">
              <div className="grid grid-cols-3 gap-3">
                <Input label="# Instalments" type="number" value={form.emi_n} onChange={(e:any)=>set('emi_n', e.target.value)} />
                <Select label="Frequency" value={form.emi_freq} onChange={(e:any)=>set('emi_freq', e.target.value)}>
                  <option value="monthly">Monthly</option>
                  <option value="quarterly">Quarterly</option>
                  <option value="half_yearly">Half-Yearly</option>
                  <option value="annual">Annual</option>
                </Select>
                <Input label="Start Date" type="date" value={form.emi_start} onChange={(e:any)=>set('emi_start', e.target.value)} />
              </div>
            </PayBlock>

            <PayBlock checked={form.full_enabled} onCheck={v => set('full_enabled', v)} label="Full payment today" subtitle={editing ? 'Customer settles the outstanding balance in one shot' : 'Customer settles the entire net total in one shot'} color="violet">
              <PayFields prefix="full" form={form} set={set} amountPlaceholder={outstanding ? `Defaults to ${editing ? 'balance' : 'total'} ${formatINR(outstanding)}` : ''} hideBranch />
            </PayBlock>

            {/* Pricing summary moved here — appears below payment plan so admin sees a final commit summary */}
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2 mt-4 pt-3 border-t border-gray-100">Final Summary</div>
            <div className="p-3 bg-gray-50 border border-gray-200 rounded-lg text-sm">
              <div className="grid grid-cols-2 gap-y-1.5 gap-x-4">
                <div className="text-gray-600">Base price <span className="text-[10px] text-gray-400">({size || 0} × ₹{rate || 0})</span></div>
                <div className="text-right font-semibold">{formatINR(basePrice)}</div>
                <div className="text-gray-600">+ Development charges</div>
                <div className="text-right font-semibold">{formatINR(dev)}</div>
                <div className="text-gray-600">+ PLC charges</div>
                <div className="text-right font-semibold">{formatINR(plc)}</div>
                <div className="text-gray-600">− Discount</div>
                <div className="text-right font-semibold text-red-700">{disc > 0 ? '−' : ''}{formatINR(disc)}</div>
                <div className="text-gray-900 font-semibold border-t border-gray-300 pt-1.5">कुल नेट / Total net value</div>
                <div className="text-right text-green-700 font-bold text-base border-t border-gray-300 pt-1.5">{formatINR(totalNet)}</div>
                {paidToday > 0 && (
                  <>
                    {tokenAmt   > 0 && (<><div className="text-gray-600">− Token paid today</div><div className="text-right font-semibold text-red-700">−{formatINR(tokenAmt)}</div></>)}
                    {bookingAmt > 0 && (<><div className="text-gray-600">− Booking amount paid today</div><div className="text-right font-semibold text-red-700">−{formatINR(bookingAmt)}</div></>)}
                    {fullAmt    > 0 && (<><div className="text-gray-600">− Full payment today</div><div className="text-right font-semibold text-red-700">−{formatINR(fullAmt)}</div></>)}
                    <div className="text-gray-900 font-semibold border-t border-gray-300 pt-1.5">शेष / Balance due</div>
                    <div className={`text-right font-bold text-base border-t border-gray-300 pt-1.5 ${balanceDue > 0 ? 'text-orange-700' : 'text-green-700'}`}>{formatINR(balanceDue)}</div>
                  </>
                )}
                {form.token_enabled && num(form.token_amount) > 0 && !form.booking_enabled && (
                  <>
                    <div className="text-amber-800 col-span-2 pt-2 mt-1 border-t border-amber-200 bg-amber-50 -mx-3 -mb-3 px-3 py-2 rounded-b-lg text-xs flex items-center gap-1.5">
                      ⏳ <span><b>Booking deposit pending</b> — record from the Bookings list when received.</span>
                    </div>
                  </>
                )}
              </div>
              {selectedBroker && brokerRankPct > 0 && (
                <div className="mt-3 pt-3 border-t border-gray-200 flex items-start gap-2 text-xs text-blue-900 bg-blue-50 -mx-3 -mb-3 px-3 py-2 rounded-b-lg">
                  <Info size={13} className="mt-0.5 shrink-0"/>
                  <div><b>{selectedBroker.name}</b>'s commission ({brokerRankPct}% of base price): <b>{formatINR(commissionAmt)}</b>. Distributed per-payment as the customer pays.</div>
                </div>
              )}
            </div>
          </>


        <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2 mt-4 pt-3 border-t border-gray-100 flex items-center justify-between">
          <span>Customer</span>
          {!editing && (
            <div className="flex gap-1 normal-case">
              <button type="button" onClick={() => set('cust_mode', 'new')}      className={`text-xs px-2.5 py-1 rounded-lg flex items-center gap-1 ${form.cust_mode === 'new' ? 'bg-emerald-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}><UserPlus size={12}/>New customer</button>
              <button type="button" onClick={() => set('cust_mode', 'existing')} className={`text-xs px-2.5 py-1 rounded-lg flex items-center gap-1 ${form.cust_mode === 'existing' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}><UserCheck size={12}/>Existing</button>
            </div>
          )}
        </div>

        {form.cust_mode === 'existing' || editing ? (
          <>
            <Select label="Existing Customer" value={form.customer_id} onChange={(e: any) => set('customer_id', e.target.value)}>
              <option value="">Select Customer</option>
              {(customers as any[]).map((c: any) => <option key={c.id} value={c.id}>{c.customer_code ? `[${c.customer_code}] ` : ''}{c.name} ({c.phone})</option>)}
            </Select>
            {form.customer_id && (() => {
              const c = (customers as any[]).find((x: any) => x.id === form.customer_id)
              return c ? (
                <div className="mt-2 p-3 bg-blue-50 rounded-lg text-xs text-blue-900 grid grid-cols-2 gap-2">
                  <span>Code: <b>{c.customer_code || '—'}</b></span>
                  <span>S/o W/o: <b>{c.father_or_husband_name || '—'}</b></span>
                  <span>DOB: <b>{c.dob || '—'}</b></span>
                  <span>PAN: <b>{c.pan || '—'}</b></span>
                  <span className="col-span-2">Address: <b>{c.address || '—'}</b></span>
                  <span className="col-span-2 pt-1 border-t border-blue-200">Nominee: <b>{c.nominee_name || '—'}</b> ({c.nominee_relation || '—'})</span>
                </div>
              ) : null
            })()}
          </>
        ) : (
          <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg space-y-3">
            <div className="text-[11px] text-emerald-800">A new customer record will be created and auto-assigned a CR-XXXX code on save.</div>
            <div className="grid grid-cols-2 gap-3">
              <Input label="Full Name"             value={form.new_customer.name}                   onChange={(e:any) => setNC('name', e.target.value)} required />
              <Input label="Mobile"                value={form.new_customer.phone}                  onChange={(e:any) => setNC('phone', e.target.value)} required />
              <Input label="Father / Husband"        value={form.new_customer.father_or_husband_name} onChange={(e:any) => setNC('father_or_husband_name', e.target.value)} />
              <Input label="Date of Birth"           type="date" value={form.new_customer.dob}        onChange={(e:any) => setNC('dob', e.target.value)} />
              <Input label="Email"                   value={form.new_customer.email}                  onChange={(e:any) => setNC('email', e.target.value)} />
              <Input label="PAN"                     value={form.new_customer.pan}                    onChange={(e:any) => setNC('pan', e.target.value.toUpperCase())} />
              <div className="col-span-2"><Input label="Permanent Address" value={form.new_customer.address} onChange={(e:any) => setNC('address', e.target.value)} /></div>
            </div>
            <div className="text-[11px] font-semibold text-emerald-800 uppercase tracking-wide pt-2 border-t border-emerald-200">उतराधिकारी / Nominee</div>
            <div className="grid grid-cols-2 gap-3">
              <Input label="Nominee Name"            value={form.new_customer.nominee_name}        onChange={(e:any) => setNC('nominee_name', e.target.value)} />
              <Input label="Relation"                value={form.new_customer.nominee_relation}    onChange={(e:any) => setNC('nominee_relation', e.target.value)} placeholder="Wife / Son / Mother…" />
              <Input label="Nominee DOB"             type="date" value={form.new_customer.nominee_dob} onChange={(e:any) => setNC('nominee_dob', e.target.value)} />
              <Input label="Nominee Father / Husband" value={form.new_customer.nominee_father_name} onChange={(e:any) => setNC('nominee_father_name', e.target.value)} />
              <Input label="Nominee PAN"             value={form.new_customer.nominee_pan}         onChange={(e:any) => setNC('nominee_pan', e.target.value.toUpperCase())} />
              <div className="col-span-2"><Input label="Nominee Address" value={form.new_customer.nominee_address} onChange={(e:any) => setNC('nominee_address', e.target.value)} /></div>
            </div>
          </div>
        )}

        <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2 mt-4 pt-3 border-t border-gray-100">Booking</div>
        <div className="grid grid-cols-2 gap-3">
          <Input label="Application Date" type="date" value={form.application_date} onChange={(e: any) => set('application_date', e.target.value)} />
          <Input label="Booking Time" type="time" value={form.booking_time} onChange={(e: any) => set('booking_time', e.target.value)} />
          <Input label="Customer Bank Name" value={form.customer_bank_name} onChange={(e: any) => set('customer_bank_name', e.target.value)} placeholder="e.g. HDFC Bank" />
        </div>

        <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2 mt-4 pt-3 border-t border-gray-100">Broker & Approvals</div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              {form.commission_mode === 'traditional' ? 'Broker / Company (Traditional)' : 'Broker (MLM, Upline)'}
              <span className="ml-1 font-normal text-gray-400">(optional)</span>
            </label>
            <BrokerCombobox
              value={form.broker_id}
              options={pickerBrokers}
              onChange={handleBrokerChange}
              placeholder="— Search by name, broker code or phone —"
            />
            {!form.broker_id && (
              <div className="mt-1.5 text-[11px] text-gray-500">
                Leave blank for a direct / walk-in sale — no commission will be credited.
              </div>
            )}
            {/* Quick add — admin can create a fresh broker without leaving the booking
                page.  Auto-sets broker_type from the current booking mode so the new
                broker shows up in the right pool (traditional or MLM) immediately. */}
            <button
              type="button"
              onClick={() => setQuickBroker({ name: '', phone: '', email: '' })}
              className="mt-1.5 text-[11px] text-blue-700 hover:underline inline-flex items-center gap-1 font-medium"
            >
              + Add new {form.commission_mode === 'traditional' ? 'traditional' : 'MLM'} broker
            </button>
            {pickerBrokers.length === 0 && (
              <div className="mt-1.5 text-[11px] bg-amber-50 border border-amber-200 text-amber-900 rounded-lg px-2 py-1.5">
                No {form.commission_mode === 'traditional' ? 'traditional' : 'MLM'} brokers yet — tap the button above to add one without leaving this page.
              </div>
            )}
          </div>
          <div>
            <Input label="परिचयकर्ता कोड (Upline Code)" value={form.upline_broker_code} onChange={(e: any) => set('upline_broker_code', e.target.value)} placeholder="e.g. FNB05012" />
            {/* Resolve the typed sponsor/upline code to a real broker so admin can
                confirm the NAME + MOBILE before saving — a mistyped code is caught here
                instead of crediting the wrong upline. */}
            {(() => {
              const code = (form.upline_broker_code || '').trim().toLowerCase()
              if (!code) return null
              const match = (brokers as any[]).find((b: any) => (b.broker_id || '').toLowerCase() === code)
              return match ? (
                <div className="mt-1 text-[11px] bg-emerald-50 border border-emerald-200 text-emerald-800 rounded-lg px-2 py-1.5">
                  ✓ {match.name || '—'}{match.phone ? ` · 📞 ${match.phone}` : ' · no mobile on file'}
                </div>
              ) : (
                <div className="mt-1 text-[11px] bg-amber-50 border border-amber-200 text-amber-900 rounded-lg px-2 py-1.5">
                  No broker with code “{form.upline_broker_code.trim()}” — check the code.
                </div>
              )
            })()}
          </div>
          <Input label="Manager Signed By" value={form.manager_signature_by} onChange={(e: any) => set('manager_signature_by', e.target.value)} placeholder="Office manager name" />
          <Select label="Stage" value={form.stage} onChange={(e: any) => set('stage', e.target.value)}>
            {STAGES.map(s => <option key={s} value={s}>{STAGE_META[s].label}</option>)}
          </Select>
          <div className="col-span-2 flex items-center gap-2 mt-1">
            <input type="checkbox" id="aff" checked={!!form.affidavit_accepted} onChange={e => set('affidavit_accepted', e.target.checked)} className="rounded" />
            <label htmlFor="aff" className="text-sm text-gray-700">Applicant has read & accepted the हलफनामा / Affidavit (clauses 1–6)</label>
          </div>
          <Textarea label="Notes" value={form.notes} onChange={(e: any) => set('notes', e.target.value)} className="col-span-2" rows={2} />
        </div>

        <div className="flex justify-end gap-2 mt-6">
          <Button variant="secondary" onClick={() => setModal(false)}>Cancel</Button>
          <Button onClick={save} loading={create.isPending || update.isPending}>{editing ? 'Save changes' : 'Create Booking'}</Button>
        </div>
      </Modal>

      {/* ── Registry completion ─────────────────────────────────────────── */}
      <Modal open={!!registryFor} onClose={() => setRegistryFor(null)} title={`Registry — ${registryFor?.booking_no || ''}`} size="sm">
        {registryFor && (() => {
          const total   = Number(registryFor.total_amount || registryFor.plot_total_price || 0)
          const paid    = Number(paidMap[registryFor.id] || 0)
          const balance = Math.max(0, total - paid)
          const plotNos = plotNosOf(registryFor)
          return (
            <div className="space-y-3">
              <div className="text-xs bg-gray-50 border border-gray-200 rounded-lg px-2.5 py-2 text-gray-700 grid grid-cols-2 gap-y-1 gap-x-3">
                <span>Customer: <b>{registryFor.bp_customers?.name || '—'}</b></span>
                <span>Plot{plotNos.length > 1 ? 's' : ''}: <b>{plotNos.join(', ') || '—'}</b></span>
                <span>Total: <b>{formatINR(total)}</b></span>
                <span>Collected: <b>{formatINR(paid)}</b></span>
              </div>

              {/* You don't normally register a plot with money still outstanding, but
                  part-payment registries do happen — so warn and require an explicit
                  acknowledgement rather than blocking outright. */}
              {balance > 0 && (
                <label className="flex items-start gap-2 text-xs bg-amber-50 border border-amber-200 text-amber-900 rounded-lg px-2.5 py-2 cursor-pointer">
                  <input type="checkbox" className="mt-0.5 rounded" checked={!!registryForm.ack_balance}
                    onChange={e => setRegistryForm((p: any) => ({ ...p, ack_balance: e.target.checked }))}/>
                  <span>
                    <b>{formatINR(balance)} is still outstanding</b> on this booking. Tick to confirm the registry is going ahead anyway.
                  </span>
                </label>
              )}

              <div className="grid grid-cols-2 gap-3">
                <Input label="Registry date" type="date" value={registryForm.registry_date}
                  onChange={(e: any) => setRegistryForm((p: any) => ({ ...p, registry_date: e.target.value }))} />
                <Input label="Registered document no." value={registryForm.registry_doc_no}
                  onChange={(e: any) => setRegistryForm((p: any) => ({ ...p, registry_doc_no: e.target.value }))} placeholder="as on the deed" />
              </div>
              <Input label="Sub-registrar office" value={registryForm.registry_office}
                onChange={(e: any) => setRegistryForm((p: any) => ({ ...p, registry_office: e.target.value }))} placeholder="e.g. Tehsil Ballabgarh" />
              <Textarea label="Notes" rows={2} value={registryForm.registry_notes}
                onChange={(e: any) => setRegistryForm((p: any) => ({ ...p, registry_notes: e.target.value }))} placeholder="Anything worth recording about the registry" />

              <div className="text-[11px] text-gray-600 bg-teal-50 border border-teal-200 rounded-lg px-2.5 py-2">
                Saving marks {plotNos.length > 1 ? 'these plots' : 'this plot'} <b>registry done</b> — the terminal state. The plot leaves the available pool and later edits to the booking will not move it back.
              </div>

              <div className="flex justify-between gap-2 pt-1">
                {registryFor.registry_date ? (
                  <Button variant="ghost" className="text-red-600" loading={clearRegistry.isPending}
                    onClick={() => clearRegistry.mutate(registryFor)}>
                    Remove registry entry
                  </Button>
                ) : <span />}
                <div className="flex gap-2">
                  <Button variant="secondary" onClick={() => setRegistryFor(null)}>Cancel</Button>
                  <Button
                    loading={saveRegistry.isPending}
                    disabled={!registryForm.registry_date || (balance > 0 && !registryForm.ack_balance)}
                    onClick={() => saveRegistry.mutate({ booking: registryFor, data: registryForm })}
                  >
                    {registryFor.registry_date ? 'Update registry' : 'Mark registry done'}
                  </Button>
                </div>
              </div>
            </div>
          )
        })()}
      </Modal>

      <EmiPanel booking={emiBooking} open={!!emiBooking} onClose={() => setEmiBooking(null)} />

      <ClosureDialog
        open={!!closureFor}
        action={closureFor?.action === 'reopen' ? 'reopen' : 'close'}
        entityLabel={`booking ${closureFor?.booking?.booking_no || ''}`}
        warning={closureFor?.action === 'close' && closureFor.booking && !fullyPaid(closureFor.booking) && closureFor.booking.stage !== 'cancelled' ? `Balance of ${formatINR(Math.max(0, Number(closureFor.booking.total_amount || 0) - (paidMap[closureFor.booking.id] || 0)))} is still outstanding.` : undefined}
        reasonRequired={closureFor?.action === 'reopen'}
        onClose={() => setClosureFor(null)}
        onConfirm={async (reason) => {
          if (!closureFor) return
          if (closureFor.action === 'close') await closeBooking.mutateAsync({ booking: closureFor.booking, reason })
          else await reopenBooking.mutateAsync({ booking: closureFor.booking, reason })
        }}
        submitting={closeBooking.isPending || reopenBooking.isPending}
      />

      <ClosureDialog
        open={!!bulkCloseFor}
        action="close"
        entityLabel={`${bulkCloseFor?.length || 0} bookings`}
        description={`You are about to close ${bulkCloseFor?.length || 0} bookings in one go. Each will be locked and its plot (where applicable) marked as sold. Reopening each requires a written reason.`}
        onClose={() => setBulkCloseFor(null)}
        onConfirm={async (reason) => {
          if (!bulkCloseFor || bulkCloseFor.length === 0) return
          await bulkClose.mutateAsync({ items: bulkCloseFor, reason })
        }}
        submitting={bulkClose.isPending}
      />

      <RecordBookingPaymentModal
        booking={recordBookingFor}
        paid={recordBookingFor ? (paidMap[recordBookingFor.id] || 0) : 0}
        onClose={() => setRecordBookingFor(null)}
        onSubmit={(p) => recordBookingPayment.mutate(p)}
        submitting={recordBookingPayment.isPending}
      />

      {/* Quick "Add new broker" modal launched from the booking form picker.  Minimal
          fields (name + phone + optional email) so the workflow stays fast; rank / KYC
          / bank details can be filled in later from the Brokers page. */}
      <Modal open={!!quickBroker} onClose={() => setQuickBroker(null)} title={`Add new ${form.commission_mode === 'traditional' ? 'traditional' : 'MLM'} broker`}>
        {quickBroker && (
          <div className="space-y-3">
            <div className="text-xs bg-blue-50 border border-blue-200 text-blue-900 rounded-lg p-2.5">
              This broker will be added as <b>{form.commission_mode === 'traditional' ? 'Traditional' : 'MLM'}</b> and selected on this booking automatically.  Rank, KYC and bank details can be filled in later from the <Link to="/brokers" target="_blank" className="text-blue-700 hover:underline">Brokers page</Link>.
            </div>
            <Input label={form.commission_mode === 'traditional' ? 'Broker / Company name' : 'Broker name'} value={quickBroker.name} onChange={(e: any) => setQuickBroker({ ...quickBroker, name: e.target.value })} placeholder={form.commission_mode === 'traditional' ? 'Broker name or company name' : 'Full name as on documents'} required />
            <Input label="Phone" value={quickBroker.phone} onChange={(e: any) => setQuickBroker({ ...quickBroker, phone: e.target.value })} placeholder="10-digit mobile (used as login + password)" required />
            <Input label="Email (optional)" value={quickBroker.email} onChange={(e: any) => setQuickBroker({ ...quickBroker, email: e.target.value })} placeholder="Auto-generated from phone if blank" />
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" onClick={() => setQuickBroker(null)} disabled={quickBrokerSaving}>Cancel</Button>
              <Button onClick={saveQuickBroker} loading={quickBrokerSaving}>Add & select</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}

// Search-as-you-type broker picker.  Replaces the native <select> on the booking form
// because that select struggles at 10,000+ brokers -- the browser has to render every
// <option> on first paint, the keyboard search jumps to whoever's first letter matches,
// and there's no way to filter by phone / broker_id.  This combobox:
//
//   - stays closed by default (just a button showing the current selection)
//   - on open, shows a search input + the top 30 matches by name / broker code / phone
//   - matches are case-insensitive and substring-based (so admin can type "987" to find
//     a phone or "FNB-05" to find a broker_id range)
//   - autofocuses the search input so admin can type immediately
//   - closes on Escape and on clicking outside
function BrokerCombobox({ value, options, onChange, placeholder }: {
  value: string
  options: any[]
  onChange: (id: string) => void
  placeholder?: string
}) {
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const selected = options.find((o: any) => o.id === value)

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 0)
  }, [open])

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase()
    if (!term) return options.slice(0, 30)
    return options
      .filter((o: any) => {
        const hay = `${o.name || ''} ${o.broker_id || ''} ${o.phone || ''} ${o.rank || ''}`.toLowerCase()
        return hay.includes(term)
      })
      .slice(0, 50)
  }, [options, q])

  return (
    <div className="relative" ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className={`w-full text-left bg-white border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 ${selected ? 'text-gray-900' : 'text-gray-400'}`}
      >
        {selected
          ? <span><b className="text-gray-900">{selected.name}</b> <span className="text-gray-500 font-mono text-xs">[{selected.broker_id}]</span>{selected.phone && <span className="text-gray-400 text-xs"> · {selected.phone}</span>}</span>
          : placeholder || '— Select broker —'}
      </button>
      {open && (
        <div className="absolute z-30 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden">
          <div className="p-2 border-b border-gray-100">
            <input
              ref={inputRef}
              value={q}
              onChange={e => setQ(e.target.value)}
              placeholder="Type a name, broker code or phone…"
              className="w-full border border-gray-200 rounded-md px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />
          </div>
          <div className="max-h-72 overflow-y-auto">
            {options.length === 0 && (
              <div className="px-3 py-6 text-center text-xs text-gray-400">No brokers in this pool yet.</div>
            )}
            {options.length > 0 && filtered.length === 0 && (
              <div className="px-3 py-6 text-center text-xs text-gray-400">No matches for "{q}".</div>
            )}
            {filtered.map((o: any) => {
              const isSel = o.id === value
              return (
                <button
                  key={o.id}
                  type="button"
                  onClick={() => { onChange(o.id); setOpen(false); setQ('') }}
                  className={`w-full text-left px-3 py-2 text-sm hover:bg-gray-50 border-b border-gray-50 last:border-b-0 ${isSel ? 'bg-emerald-50' : ''}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="font-medium text-gray-900 truncate">{o.name || '—'}</div>
                      <div className="text-[11px] text-gray-500 truncate">
                        <span className="font-mono">{o.broker_id || '—'}</span>
                        {o.phone && <> · {o.phone}</>}
                        {o.broker_type === 'traditional' ? ' · Traditional' : (o.rank ? ` · ${o.rank}` : '')}
                      </div>
                    </div>
                    {isSel && <span className="text-emerald-600 text-xs font-semibold shrink-0">✓ Selected</span>}
                  </div>
                </button>
              )
            })}
            {!q && options.length > 30 && (
              <div className="px-3 py-2 text-[10px] text-gray-400 bg-gray-50 text-center">
                Showing first 30 of {options.length}. Type to search.
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function RecordBookingPaymentModal({ booking, paid, onClose, onSubmit, submitting }: any) {
  const [amount, setAmount] = useState('')
  const [date, setDate] = useState(today())
  const [mode, setMode] = useState('cash')
  const [utr, setUtr] = useState('')
  const [drawnOn, setDrawnOn] = useState('')
  const [branch, setBranch] = useState('')

  useEffect(() => {
    if (!booking) return
    const total = Number(booking.total_amount || booking.plot_total_price || 0)
    const balance = Math.max(0, total - paid)
    setAmount(balance > 0 ? String(balance) : '')
    setDate(today())
    setMode('cash')
    setUtr(''); setDrawnOn(''); setBranch('')
  }, [booking, paid])

  if (!booking) return null

  const total = Number(booking.total_amount || booking.plot_total_price || 0)
  const balance = Math.max(0, total - paid)
  const amt = Number(amount) || 0
  const remainingAfter = Math.max(0, balance - amt)

  const submit = (openEmiAfter: boolean) => {
    onSubmit({ booking, amount: amt, date, mode, utr, drawn_on: drawnOn, branch, openEmiAfter })
  }

  return (
    <Modal open={!!booking} onClose={onClose} title={`Record Booking — ${booking.bp_customers?.name || booking.booking_no}`}>
      <div className="grid grid-cols-2 gap-y-1 gap-x-4 p-3 bg-blue-50 rounded-lg text-xs mb-4 text-blue-900">
        <span>Booking: <b>{booking.booking_no}</b></span>
        <span>Plot: <b>{
          ([...(booking.bp_booking_plots || [])]
            .sort((a: any, b: any) => (a.position || 1) - (b.position || 1))
            .map((r: any) => r.bp_plots?.plot_no)
            .filter(Boolean)
            .join(', ')) || booking.bp_plots?.plot_no || '—'
        }</b></span>
        <span>Total: <b>{formatINR(total)}</b></span>
        <span>Already paid: <b>{formatINR(paid)}</b></span>
        <span className="col-span-2 pt-1 border-t border-blue-200">Outstanding balance: <b className="text-orange-700">{formatINR(balance)}</b></span>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Input label="राशि / Amount (₹)" type="number" value={amount} onChange={(e: any) => setAmount(e.target.value)} />
        <Input label="दिनांक / Date" type="date" value={date} onChange={(e: any) => setDate(e.target.value)} />
        <Select label="Mode" value={mode} onChange={(e: any) => setMode(e.target.value)}>
          {['cash','neft','rtgs','imps','upi','cheque','dd'].map(m => <option key={m} value={m}>{m.toUpperCase()}</option>)}
        </Select>
        <Input label={mode === 'cheque' ? 'Cheque No' : mode === 'dd' ? 'Draft No' : 'UTR / Ref'} value={utr} onChange={(e: any) => setUtr(e.target.value)} placeholder="paste from receipt" />
        <Input label="Drawn On (Bank)" value={drawnOn} onChange={(e: any) => setDrawnOn(e.target.value)} placeholder="e.g. HDFC Bank" />
        <Input label="Branch" value={branch} onChange={(e: any) => setBranch(e.target.value)} placeholder="e.g. Sector 12 Gurugram" />
      </div>

      <div className="mt-3 p-3 bg-gray-50 border border-gray-200 rounded-lg text-xs grid grid-cols-2 gap-y-1">
        <span className="text-gray-600">Recording today</span>
        <span className="text-right font-semibold">{formatINR(amt)}</span>
        <span className="text-gray-600">Balance after this payment</span>
        <span className={`text-right font-semibold ${remainingAfter > 0 ? 'text-orange-700' : 'text-emerald-700'}`}>{formatINR(remainingAfter)}</span>
      </div>

      <div className="flex justify-end gap-2 mt-5">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button variant="ghost" onClick={() => submit(false)} loading={submitting} disabled={amt <= 0}>
          <IndianRupee size={12}/>Just Record
        </Button>
        <Button onClick={() => submit(true)} loading={submitting} disabled={amt <= 0}>
          <Calculator size={12}/>Record &amp; Start EMI
        </Button>
      </div>
    </Modal>
  )
}

function InlineBreakdown({ rows, emiN, emiFreq, onN, onFreq, actions, hint }: any) {
  return (
    <div className="mt-3 rounded-lg border border-white/60 bg-white/70 backdrop-blur-sm shadow-inner p-2.5 text-xs">
      <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
        <span className="text-[10px] font-semibold tracking-wider text-gray-500 uppercase">Live breakdown</span>
        <div className="flex items-center gap-1.5">
          <input type="number" value={emiN} onChange={(e: any) => onN(e.target.value)}
            className="w-12 border border-gray-200 rounded px-1.5 py-0.5 text-xs text-right focus:outline-none focus:ring-1 focus:ring-emerald-300"
            aria-label="Number of EMI instalments"/>
          <select value={emiFreq} onChange={e => onFreq(e.target.value)}
            className="border border-gray-200 rounded px-1 py-0.5 text-xs focus:outline-none">
            <option value="monthly">monthly</option>
            <option value="quarterly">quarterly</option>
            <option value="half_yearly">half-yearly</option>
            <option value="annual">annual</option>
          </select>
          {actions}
        </div>
      </div>
      {hint && (
        <div className="mb-2 text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded px-2 py-1">{hint}</div>
      )}
      <div className="space-y-1">
        {rows.map((r: any, i: number) => (
          <div key={i} className="flex items-center justify-between">
            <span className="text-gray-600">{r.label}</span>
            <span className={`font-semibold ${r.accent || 'text-gray-900'}`}>{r.value}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

function PayBlock({ checked, onCheck, label, subtitle, color, children, warning }: any) {
  const palette: Record<string, string> = {
    amber:   'bg-amber-50 border-amber-200',
    blue:    'bg-blue-50 border-blue-200',
    emerald: 'bg-emerald-50 border-emerald-200',
    violet:  'bg-violet-50 border-violet-200',
  }
  const borderClass = warning ? 'bg-rose-50 border-rose-300' : (checked ? palette[color] || 'bg-gray-50 border-gray-200' : 'bg-white border-gray-200')
  return (
    <div className={`mb-3 rounded-lg border p-3 ${borderClass}`}>
      <label className="flex items-start gap-2 cursor-pointer">
        <input type="checkbox" checked={checked} onChange={e => onCheck(e.target.checked)} className="mt-0.5 rounded" />
        <div className="flex-1">
          <div className="text-sm font-semibold text-gray-900">{label}</div>
          <div className="text-[11px] text-gray-500">{subtitle}</div>
        </div>
      </label>
      {warning && (
        <div className="mt-2 pl-6 text-xs font-medium text-rose-700 inline-flex items-center gap-1.5">
          <Info size={12}/>{warning}
        </div>
      )}
      {checked && <div className="mt-3 pl-6">{children}</div>}
    </div>
  )
}

function PayFields({ prefix, form, set, amountPlaceholder = '', hideBranch = false, amountError }: any) {
  const k = (s: string) => `${prefix}_${s}`
  return (
    <div className="grid grid-cols-2 gap-3">
      <div>
        <Input label="Amount (₹)" type="number" value={form[k('amount')]} onChange={(e:any)=>set(k('amount'), e.target.value)} placeholder={amountPlaceholder}
          className={amountError ? 'border-rose-400 focus:ring-rose-300' : ''} />
        {amountError && <div className="text-[11px] text-rose-700 mt-1">{amountError}</div>}
      </div>
      <Input label="Date" type="date" value={form[k('date')]} onChange={(e:any)=>set(k('date'), e.target.value)} />
      <Select label="Mode" value={form[k('mode')]} onChange={(e:any)=>set(k('mode'), e.target.value)}>
        {PAYMENT_MODES.map(m => <option key={m} value={m}>{m.toUpperCase()}</option>)}
      </Select>
      <Input label={form[k('mode')] === 'cheque' ? 'Cheque No' : form[k('mode')] === 'dd' ? 'Draft No' : 'UTR / Reference'} value={form[k('utr')]} onChange={(e:any)=>set(k('utr'), e.target.value)} placeholder="paste from bank receipt" />
      {!hideBranch && (
        <>
          <Input label="Drawn On (Bank)" value={form[k('drawn_on')]} onChange={(e:any)=>set(k('drawn_on'), e.target.value)} placeholder="e.g. HDFC Bank" />
          <Input label="Branch" value={form[k('branch')]} onChange={(e:any)=>set(k('branch'), e.target.value)} placeholder="e.g. Sector 12 Gurugram" />
        </>
      )}
    </div>
  )
}
