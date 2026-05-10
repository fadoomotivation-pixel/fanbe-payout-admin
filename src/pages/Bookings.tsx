import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { Table } from '@/components/ui/Table.tsx'
import { Button } from '@/components/ui/Button.tsx'
import { Input, Select, Textarea } from '@/components/ui/Input.tsx'
import { Modal } from '@/components/ui/Modal.tsx'
import { Badge } from '@/components/ui/Badge.tsx'
import { formatINR, formatDate } from '@/lib/utils'
import { printApplicationForm } from '@/lib/printTemplates'
import EmiPanel from '@/components/EmiPanel'
import { Plus, ArrowRight, FileText, Printer, Calculator, UserPlus, UserCheck, Info } from 'lucide-react'
import toast from 'react-hot-toast'

const STAGES = ['token_received','booking_done','cancelled'] as const
type Stage = typeof STAGES[number]

const STAGE_META: Record<Stage, { label: string; color: string }> = {
  token_received: { label: 'Token Received', color: 'bg-orange-50 text-orange-700 border border-orange-200' },
  booking_done:   { label: 'Booking Done',   color: 'bg-green-50 text-green-700 border border-green-200' },
  cancelled:      { label: 'Cancelled',      color: 'bg-red-50 text-red-700 border border-red-200' },
}
const PIPELINE_STAGES: Stage[] = ['token_received','booking_done']

const PAYMENT_MODES = ['cash','neft','rtgs','imps','upi','cheque','dd'] as const
type CustMode = 'existing' | 'new'

const NEW_CUST_EMPTY = {
  name:'', phone:'', email:'', father_or_husband_name:'', dob:'',
  address:'', pan:'',
  nominee_name:'', nominee_relation:'', nominee_dob:'', nominee_father_name:'',
  nominee_address:'', nominee_pan:'',
}

const today = () => new Date().toISOString().slice(0,10)

const EMPTY: any = {
  plot_id:'', customer_id:'', broker_id:'', project_id:'', stage:'token_received',

  // Pricing breakdown (the booking math)
  size_sqyd:'', rate_per_sqyd:'',
  dev_charges:'0', plc_charges:'0', discount_amount:'0',

  notes:'',
  application_date: today(), booking_time:'', customer_bank_name:'',
  upline_broker_code:'', manager_signature_by:'', affidavit_accepted:true,
  cust_mode: 'new' as CustMode,
  new_customer: { ...NEW_CUST_EMPTY },

  token_enabled: false,
  token_amount: '', token_date: today(), token_mode: 'cash', token_utr: '', token_drawn_on: '', token_branch: '',

  booking_enabled: true,
  booking_amount: '', booking_date: today(), booking_mode: 'cash', booking_utr: '', booking_drawn_on: '', booking_branch: '',

  emi_enabled: false,
  emi_n: '12', emi_freq: 'monthly', emi_start: today(),

  full_enabled: false,
  full_amount: '', full_date: today(), full_mode: 'cash', full_utr: '',
}

export default function Bookings() {
  const qc = useQueryClient()
  const [modal, setModal]     = useState(false)
  const [editing, setEditing] = useState<any>(null)
  const [form, setForm]       = useState<any>(EMPTY)
  const [stageFilter, setStageFilter] = useState<Stage | 'all'>('all')
  const [emiBooking, setEmiBooking] = useState<any>(null)
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
      const { data, error } = await supabase.from('brokers').select('id,name,broker_id,rank')
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

  // ── Pricing math ───────────────────────────────────────────────
  const num = (v: any) => Number(v) || 0
  const size  = num(form.size_sqyd)
  const rate  = num(form.rate_per_sqyd)
  const basePrice = Math.round(size * rate)
  const dev   = num(form.dev_charges)
  const plc   = num(form.plc_charges)
  const disc  = num(form.discount_amount)
  const totalNet = Math.max(0, basePrice + dev + plc - disc)

  // ── Broker commission preview (BASE PRICE ONLY, excludes dev + plc) ──
  const selectedBroker = (brokers as any[]).find((b: any) => b.id === form.broker_id)
  const brokerRankPct = selectedBroker
    ? Number((ranks as any[]).find((r: any) => r.rank_name === selectedBroker.rank)?.commission_pct || 0)
    : 0
  const commissionAmt = Math.round(basePrice * brokerRankPct / 100)

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

  async function recordPaymentRow(p: any) {
    if (p.amount <= 0) return
    const { data: rn } = await supabase.rpc('next_receipt_no')
    const { error } = await supabase.from('bp_payments').insert({
      booking_id: p.booking_id, customer_id: p.customer_id,
      payment_type: p.payment_type, amount: p.amount, payment_mode: p.payment_mode,
      utr_ref: p.utr_ref || null, payment_date: p.payment_date,
      verification_status: 'verified', verified_at: new Date().toISOString(),
      receipt_no: rn || null,
      drawn_on_bank: p.drawn_on_bank || (p.payment_mode === 'cash' ? 'Cash' : null),
      branch: p.branch || null, sponsor_name: p.sponsor_name || null,
    })
    if (error) throw error
  }

  function autoStage(f: any): Stage {
    if (f.full_enabled) return 'booking_done'
    if (f.booking_enabled || f.emi_enabled) return 'booking_done'
    if (f.token_enabled) return 'token_received'
    return 'token_received'
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
      const brokerPct = broker ? Number((ranks as any[]).find((r: any) => r.rank_name === broker.rank)?.commission_pct || 0) : 0

      const sz   = num(rest.size_sqyd)
      const rt   = num(rest.rate_per_sqyd)
      const base = Math.round(sz * rt)
      const d    = num(rest.dev_charges)
      const pl   = num(rest.plc_charges)
      const dsc  = num(rest.discount_amount)
      const total = Math.max(0, base + d + pl - dsc)

      const tokenAmt   = rest.token_enabled   ? num(rest.token_amount) : 0
      const bookingAmt = rest.booking_enabled ? num(rest.booking_amount) : 0
      const fullAmt    = rest.full_enabled    ? (num(rest.full_amount) || total) : 0

      const bookingPayload: any = {
        plot_id: rest.plot_id || null, customer_id, broker_id: rest.broker_id || null, project_id: rest.project_id || null,
        stage,
        size_sqyd: sz || null,
        rate_per_sqyd: rt || null,
        base_price: base || null,
        dev_charges: d,
        plc_charges: pl,
        discount_amount: dsc,
        plot_total_price: total,
        total_amount: total,

        token_amount: tokenAmt || null,
        token_date: rest.token_enabled ? rest.token_date : null,
        booking_amount: bookingAmt || null,
        booking_date: rest.booking_enabled ? rest.booking_date : null,
        full_payment_amount: fullAmt || null,
        full_payment_date: rest.full_enabled ? rest.full_date : null,

        // Commission applies only to BASE price (not dev/plc)
        commission_rate: brokerPct || null,
        commission_amount: brokerPct > 0 ? Math.round(base * brokerPct / 100) : null,

        notes: rest.notes || null,
        scheme_name: project?.name || null,
        application_date: rest.application_date || null,
        booking_time: rest.booking_time || null,
        customer_bank_name: rest.customer_bank_name || null,
        upline_broker_code: rest.upline_broker_code || null,
        manager_signature_by: rest.manager_signature_by || null,
        affidavit_accepted: !!rest.affidavit_accepted,
        payment_type: rest.emi_enabled ? 'emi' : (rest.full_enabled ? 'full' : (rest.booking_enabled ? 'booking' : 'token')),
      }

      const { data: bk, error } = await supabase.from('bp_bookings').insert(bookingPayload).select().single()
      if (error) throw error

      const sponsorName = broker?.name || null

      if (rest.token_enabled && tokenAmt > 0) {
        await recordPaymentRow({ booking_id: bk.id, customer_id, payment_type: 'token', amount: tokenAmt, payment_date: rest.token_date, payment_mode: rest.token_mode, utr_ref: rest.token_utr, drawn_on_bank: rest.token_drawn_on, branch: rest.token_branch, sponsor_name: sponsorName })
      }
      if (rest.booking_enabled && bookingAmt > 0) {
        await recordPaymentRow({ booking_id: bk.id, customer_id, payment_type: 'booking', amount: bookingAmt, payment_date: rest.booking_date, payment_mode: rest.booking_mode, utr_ref: rest.booking_utr, drawn_on_bank: rest.booking_drawn_on, branch: rest.booking_branch, sponsor_name: sponsorName })
      }
      if (rest.full_enabled && fullAmt > 0) {
        await recordPaymentRow({ booking_id: bk.id, customer_id, payment_type: 'full_payment', amount: fullAmt, payment_date: rest.full_date, payment_mode: rest.full_mode, utr_ref: rest.full_utr, sponsor_name: sponsorName })
      }

      if (rest.emi_enabled) {
        const principal = Math.max(0, total - tokenAmt - bookingAmt - fullAmt)
        if (principal > 0) {
          await generateEmiSchedule(bk.id, customer_id, principal, num(rest.emi_n) || 12, rest.emi_freq || 'monthly', rest.emi_start || today())
        }
      }

      return bk
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bookings'] })
      qc.invalidateQueries({ queryKey: ['customers'] })
      qc.invalidateQueries({ queryKey: ['payments'] })
      qc.invalidateQueries({ queryKey: ['emi_schedules'] })
      toast.success('Booking saved')
    },
    onError: (e: any) => toast.error(e.message),
  })

  const update = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: any }) => {
      const project = (projects as any[]).find((pj: any) => pj.id === data.project_id)
      const broker  = (brokers as any[]).find((b: any) => b.id === data.broker_id)
      const brokerPct = broker ? Number((ranks as any[]).find((r: any) => r.rank_name === broker.rank)?.commission_pct || 0) : 0
      const sz   = num(data.size_sqyd)
      const rt   = num(data.rate_per_sqyd)
      const base = Math.round(sz * rt)
      const d    = num(data.dev_charges)
      const pl   = num(data.plc_charges)
      const dsc  = num(data.discount_amount)
      const total = Math.max(0, base + d + pl - dsc)
      const payload = {
        plot_id: data.plot_id || null, customer_id: data.customer_id || null,
        broker_id: data.broker_id || null, project_id: data.project_id || null,
        stage: data.stage,
        size_sqyd: sz || null, rate_per_sqyd: rt || null,
        base_price: base || null,
        dev_charges: d, plc_charges: pl, discount_amount: dsc,
        plot_total_price: total, total_amount: total,
        commission_rate: brokerPct || null,
        commission_amount: brokerPct > 0 ? Math.round(base * brokerPct / 100) : null,
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
      const { data: d2, error } = await supabase.from('bp_bookings').update(payload).eq('id', id).select().single()
      if (error) throw error
      return d2
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['bookings'] }); toast.success('Booking updated') },
    onError: (e: any) => toast.error(e.message),
  })

  const advanceStage = useMutation({
    mutationFn: async ({ id, stage }: { id: string; stage: Stage }) => {
      const { error } = await supabase.from('bp_bookings').update({ stage, updated_at: new Date().toISOString() }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['bookings'] }); toast.success('Stage advanced') },
    onError: (e: any) => toast.error(e.message),
  })

  const open = (b?: any) => {
    setEditing(b || null)
    setForm(b ? {
      ...EMPTY,
      plot_id: b.plot_id || '', customer_id: b.customer_id || '',
      broker_id: b.broker_id || '', project_id: b.project_id || '',
      stage: (STAGES.includes(b.stage) ? b.stage : 'token_received'),
      size_sqyd: b.size_sqyd || b.bp_plots?.size_sqyd || '',
      rate_per_sqyd: b.rate_per_sqyd || b.bp_plots?.price_per_sqyd || '',
      dev_charges: b.dev_charges ?? '0',
      plc_charges: b.plc_charges ?? '0',
      discount_amount: b.discount_amount ?? '0',
      notes: b.notes || '',
      application_date: b.application_date || today(),
      booking_time: b.booking_time || '', customer_bank_name: b.customer_bank_name || '',
      upline_broker_code: b.upline_broker_code || '', manager_signature_by: b.manager_signature_by || '',
      affidavit_accepted: b.affidavit_accepted !== false,
      cust_mode: 'existing',
      token_enabled: false, booking_enabled: false, emi_enabled: false, full_enabled: false,
    } : EMPTY)
    setModal(true)
  }

  const save = async () => {
    if (editing) {
      await update.mutateAsync({ id: editing.id, data: form })
    } else {
      await create.mutateAsync(form)
    }
    setModal(false)
  }

  const handlePlotChange = (plotId: string) => {
    set('plot_id', plotId)
    const p = (plots as any[]).find((pl: any) => pl.id === plotId)
    if (p) {
      if (p.size_sqyd)       set('size_sqyd', String(p.size_sqyd))
      if (p.price_per_sqyd)  set('rate_per_sqyd', String(p.price_per_sqyd))
      if (p.plc_charges != null) set('plc_charges', String(p.plc_charges))
      if (p.bp_projects?.id) set('project_id', p.bp_projects.id)
    }
  }

  const handleBrokerChange = (brokerId: string) => {
    set('broker_id', brokerId)
    const b = (brokers as any[]).find((br: any) => br.id === brokerId)
    if (b?.broker_id) set('upline_broker_code', b.broker_id)
  }

  const nextStage = (current: Stage): Stage | null => {
    const idx = PIPELINE_STAGES.indexOf(current)
    if (idx === -1 || idx >= PIPELINE_STAGES.length - 1) return null
    return PIPELINE_STAGES[idx + 1]
  }

  const all = bookings as any[]
  const stageCounts = STAGES.reduce((acc, s) => ({ ...acc, [s]: all.filter((b: any) => b.stage === s).length }), {} as Record<string, number>)
  const totalValue  = all.filter((b: any) => b.stage === 'booking_done').reduce((s: number, b: any) => s + Number(b.total_amount || b.plot_total_price || 0), 0)
  const filtered = stageFilter === 'all' ? all : all.filter((b: any) => b.stage === stageFilter)

  // Payment / balance preview — token + booking + full are deducted
  // from the total net value to show the admin the remaining balance.
  const tokenAmt = form.token_enabled ? num(form.token_amount) : 0
  const bookingAmt = form.booking_enabled ? num(form.booking_amount) : 0
  const fullAmt = form.full_enabled ? (num(form.full_amount) || totalNet) : 0
  const paidToday = tokenAmt + bookingAmt + fullAmt
  const balanceDue = Math.max(0, totalNet - paidToday)
  const principalPreview = balanceDue
  const emiAmtPreview = principalPreview > 0 && num(form.emi_n) > 0 ? Math.round(principalPreview / num(form.emi_n)) : 0

  const cols = [
    { header: 'Booking No', render: (r: any) => <span className="font-mono text-xs font-semibold text-blue-700">{r.booking_no}</span> },
    {
      header: 'Customer',
      render: (r: any) => (
        <div>
          <div className="font-medium text-gray-900">{r.bp_customers?.name}</div>
          <div className="text-xs text-gray-400">{r.bp_customers?.customer_code ? r.bp_customers.customer_code + ' · ' : ''}{r.bp_customers?.phone}</div>
        </div>
      ),
    },
    {
      header: 'Plot / Scheme',
      render: (r: any) => (
        <div>
          <div className="font-medium text-sm">{r.bp_plots?.plot_no || '—'}</div>
          <div className="text-xs text-gray-400">{(r.size_sqyd || r.bp_plots?.size_sqyd || '—')} sqyd · {r.bp_projects?.name || r.scheme_name || ''}</div>
        </div>
      ),
    },
    { header: 'Broker',  render: (r: any) => <span className="text-sm">{r.brokers?.name || '—'}</span> },
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
      header: 'Stage',
      render: (r: any) => {
        const meta = STAGE_META[r.stage as Stage] || STAGE_META.token_received
        return <Badge label={meta.label} className={meta.color} />
      },
    },
    { header: 'Date', render: (r: any) => <span className="text-xs text-gray-500">{formatDate(r.application_date || r.created_at)}</span> },
    {
      header: 'Actions',
      render: (r: any) => {
        const ns = nextStage(r.stage as Stage)
        return (
          <div className="flex gap-1 flex-wrap">
            <Button size="sm" variant="ghost" onClick={() => open(r)}><FileText size={12} />Edit</Button>
            <Button size="sm" variant="ghost" onClick={() => setEmiBooking(r)}><Calculator size={12} />EMI</Button>
            <Button size="sm" variant="ghost" onClick={() => printApplicationForm(r)}><Printer size={12} />Form</Button>
            {ns && r.stage !== 'cancelled' && (
              <Button size="sm" onClick={() => advanceStage.mutate({ id: r.id, stage: ns })}><ArrowRight size={12} />{STAGE_META[ns].label}</Button>
            )}
          </div>
        )
      },
    },
  ]

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Bookings</h1>
          <p className="text-sm text-gray-500">{all.length} total · Confirmed value: {formatINR(totalValue)}</p>
        </div>
        <Button onClick={() => open()}><Plus size={14} />New Booking</Button>
      </div>

      <div className="flex gap-2 mb-5 overflow-x-auto pb-1">
        <button onClick={() => setStageFilter('all')} className={`px-4 py-2 rounded-xl text-sm font-medium border transition-all whitespace-nowrap ${stageFilter === 'all' ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'}`}>All ({all.length})</button>
        {STAGES.map(s => (
          <button key={s} onClick={() => setStageFilter(s)} className={`px-4 py-2 rounded-xl text-sm font-medium border transition-all whitespace-nowrap ${stageFilter === s ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'}`}>
            {STAGE_META[s].label} ({stageCounts[s] || 0})
          </button>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm">
        <Table columns={cols} data={filtered} loading={isLoading} />
      </div>

      <Modal open={modal} onClose={() => setModal(false)} title={editing ? 'Edit Booking' : 'New Booking — आवेदन-पत्र'}>
        {/* 1. SCHEME & PLOT */}
        <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">आवासीय योजना (Scheme) & Plot</div>
        <div className="grid grid-cols-2 gap-3">
          <Select label="आवासीय योजना का नाम (Project / Scheme)" value={form.project_id} onChange={(e: any) => set('project_id', e.target.value)} className="col-span-2">
            <option value="">{(projects as any[]).length === 0 ? 'No projects yet' : 'Select scheme / project'}</option>
            {(projects as any[]).map((p: any) => <option key={p.id} value={p.id}>{p.name}{p.location ? ` · ${p.location}` : ''}</option>)}
          </Select>
          <Select label="Plot (Available) — प्लॉट नं." value={form.plot_id} onChange={(e: any) => handlePlotChange(e.target.value)} className="col-span-2">
            <option value="">{(plots as any[]).length === 0 ? 'No available plots' : 'Select Plot'}</option>
            {(plots as any[]).map((p: any) => <option key={p.id} value={p.id}>{p.plot_no} — {p.size_sqyd} sqyd @ {formatINR(p.price_per_sqyd)}/gaj · {p.bp_projects?.name}</option>)}
          </Select>
        </div>

        {/* 2. PRICING BREAKDOWN */}
        <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2 mt-4 pt-3 border-t border-gray-100">Pricing Breakdown</div>
        <div className="grid grid-cols-2 gap-3">
          <Input label="आकार / Size (वर्ग गज / sq.yd)" type="number" value={form.size_sqyd} onChange={(e:any) => set('size_sqyd', e.target.value)} />
          <Input label="प्रति गज दर / Rate per sq.yd (₹)" type="number" value={form.rate_per_sqyd} onChange={(e:any) => set('rate_per_sqyd', e.target.value)} />
          <Input label="विकास शुल्क / Development charges (₹)" type="number" value={form.dev_charges} onChange={(e:any) => set('dev_charges', e.target.value)} placeholder="0" />
          <Input label="PLC charges (₹)" type="number" value={form.plc_charges} onChange={(e:any) => set('plc_charges', e.target.value)} placeholder="auto from plot" />
          <Input label="Discount (₹)" type="number" value={form.discount_amount} onChange={(e:any) => set('discount_amount', e.target.value)} />
        </div>

        {/* Live calc panel */}
        <div className="mt-3 p-3 bg-gray-50 border border-gray-200 rounded-lg text-sm">
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
            {!editing && paidToday > 0 && (
              <>
                {tokenAmt > 0 && (
                  <>
                    <div className="text-gray-600">− Token paid today</div>
                    <div className="text-right font-semibold text-red-700">−{formatINR(tokenAmt)}</div>
                  </>
                )}
                {bookingAmt > 0 && (
                  <>
                    <div className="text-gray-600">− Booking amount paid today</div>
                    <div className="text-right font-semibold text-red-700">−{formatINR(bookingAmt)}</div>
                  </>
                )}
                {fullAmt > 0 && (
                  <>
                    <div className="text-gray-600">− Full payment today</div>
                    <div className="text-right font-semibold text-red-700">−{formatINR(fullAmt)}</div>
                  </>
                )}
                <div className="text-gray-900 font-semibold border-t border-gray-300 pt-1.5">शेष / Balance due</div>
                <div className={`text-right font-bold text-base border-t border-gray-300 pt-1.5 ${balanceDue > 0 ? 'text-orange-700' : 'text-green-700'}`}>{formatINR(balanceDue)}</div>
              </>
            )}
          </div>
          {selectedBroker && brokerRankPct > 0 && (
            <div className="mt-3 pt-3 border-t border-gray-200 flex items-start gap-2 text-xs text-blue-900 bg-blue-50 -mx-3 -mb-3 px-3 py-2 rounded-b-lg">
              <Info size={13} className="mt-0.5 shrink-0"/>
              <div>
                <b>{selectedBroker.name}</b>'s commission ({brokerRankPct}% of base price): <b>{formatINR(commissionAmt)}</b>.
                Development & PLC charges are excluded from commission.
              </div>
            </div>
          )}
        </div>

        {/* 3. PAYMENT PLAN */}
        {!editing && (
          <>
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2 mt-4 pt-3 border-t border-gray-100">Payment Plan</div>
            <div className="text-[11px] text-gray-500 mb-3">Tick everything the customer is paying today. Token + Booking + EMI combinations are supported.</div>

            <PayBlock checked={form.token_enabled} onCheck={v => set('token_enabled', v)} label="Token amount" subtitle="Token receipt will be auto-generated" color="amber">
              <PayFields prefix="token" form={form} set={set} />
            </PayBlock>

            <PayBlock checked={form.booking_enabled} onCheck={v => set('booking_enabled', v)} label="Booking amount" subtitle="The main booking deposit" color="blue">
              <PayFields prefix="booking" form={form} set={set} />
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

            <PayBlock checked={form.full_enabled} onCheck={v => set('full_enabled', v)} label="Full payment today" subtitle="Customer settles the entire net total in one shot" color="violet">
              <PayFields prefix="full" form={form} set={set} amountPlaceholder={totalNet ? `Defaults to total ${formatINR(totalNet)}` : ''} hideBranch />
            </PayBlock>
          </>
        )}

        {/* 4. CUSTOMER */}
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
              <Input label="Full Name *"             value={form.new_customer.name}                   onChange={(e:any) => setNC('name', e.target.value)} required />
              <Input label="Mobile *"                value={form.new_customer.phone}                  onChange={(e:any) => setNC('phone', e.target.value)} required />
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

        {/* 5. BOOKING META */}
        <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2 mt-4 pt-3 border-t border-gray-100">Booking</div>
        <div className="grid grid-cols-2 gap-3">
          <Input label="Application Date" type="date" value={form.application_date} onChange={(e: any) => set('application_date', e.target.value)} />
          <Input label="Booking Time" type="time" value={form.booking_time} onChange={(e: any) => set('booking_time', e.target.value)} />
          <Input label="Customer Bank Name" value={form.customer_bank_name} onChange={(e: any) => set('customer_bank_name', e.target.value)} placeholder="e.g. HDFC Bank" />
        </div>

        {/* 6. SPONSOR & APPROVALS */}
        <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2 mt-4 pt-3 border-t border-gray-100">Sponsor & Approvals</div>
        <div className="grid grid-cols-2 gap-3">
          <Select label="परिचयकर्ता / Upline Broker" value={form.broker_id} onChange={(e: any) => handleBrokerChange(e.target.value)}>
            <option value="">No Broker</option>
            {(brokers as any[]).map((b: any) => <option key={b.id} value={b.id}>{b.name} [{b.broker_id}] · {b.rank}</option>)}
          </Select>
          <Input label="परिचयकर्ता कोड (Upline Code)" value={form.upline_broker_code} onChange={(e: any) => set('upline_broker_code', e.target.value)} />
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

      <EmiPanel booking={emiBooking} open={!!emiBooking} onClose={() => setEmiBooking(null)} />
    </div>
  )
}

function PayBlock({ checked, onCheck, label, subtitle, color, children }: any) {
  const palette: Record<string, string> = {
    amber:   'bg-amber-50 border-amber-200',
    blue:    'bg-blue-50 border-blue-200',
    emerald: 'bg-emerald-50 border-emerald-200',
    violet:  'bg-violet-50 border-violet-200',
  }
  return (
    <div className={`mb-3 rounded-lg border p-3 ${checked ? palette[color] || 'bg-gray-50 border-gray-200' : 'bg-white border-gray-200'}`}>
      <label className="flex items-start gap-2 cursor-pointer">
        <input type="checkbox" checked={checked} onChange={e => onCheck(e.target.checked)} className="mt-0.5 rounded" />
        <div className="flex-1">
          <div className="text-sm font-semibold text-gray-900">{label}</div>
          <div className="text-[11px] text-gray-500">{subtitle}</div>
        </div>
      </label>
      {checked && <div className="mt-3 pl-6">{children}</div>}
    </div>
  )
}

function PayFields({ prefix, form, set, amountPlaceholder = '', hideBranch = false }: any) {
  const k = (s: string) => `${prefix}_${s}`
  return (
    <div className="grid grid-cols-2 gap-3">
      <Input label="Amount (₹)" type="number" value={form[k('amount')]} onChange={(e:any)=>set(k('amount'), e.target.value)} placeholder={amountPlaceholder} />
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
