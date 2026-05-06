import { useState } from 'react'
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
import { Plus, ArrowRight, FileText, Printer, Calculator, UserPlus, UserCheck, Coins, BookOpen, Wallet, CreditCard } from 'lucide-react'
import toast from 'react-hot-toast'

const STAGES = ['enquiry','site_visit','negotiation','token_received','booking_done','cancelled'] as const
type Stage = typeof STAGES[number]

const STAGE_META: Record<Stage, { label: string; color: string }> = {
  enquiry:        { label: 'Enquiry',        color: 'bg-gray-100 text-gray-600 border border-gray-200' },
  site_visit:     { label: 'Site Visit',     color: 'bg-blue-50 text-blue-700 border border-blue-200' },
  negotiation:    { label: 'Negotiation',    color: 'bg-yellow-50 text-yellow-700 border border-yellow-200' },
  token_received: { label: 'Token Received', color: 'bg-orange-50 text-orange-700 border border-orange-200' },
  booking_done:   { label: 'Booking Done',   color: 'bg-green-50 text-green-700 border border-green-200' },
  cancelled:      { label: 'Cancelled',      color: 'bg-red-50 text-red-700 border border-red-200' },
}

const PIPELINE_STAGES: Stage[] = ['enquiry','site_visit','negotiation','token_received','booking_done']

type Plan = 'token_only' | 'booking_only' | 'full_payment' | 'emi_plan'
type CustMode = 'existing' | 'new'

const NEW_CUST_EMPTY = {
  name:'', phone:'', email:'', father_or_husband_name:'', dob:'',
  address:'', pan:'',
  nominee_name:'', nominee_relation:'', nominee_dob:'', nominee_father_name:'',
  nominee_address:'', nominee_pan:'',
}

const EMPTY: any = {
  plot_id:'', customer_id:'', broker_id:'', project_id:'', stage:'enquiry',
  total_amount:'', booking_amount:'', discount_amount:'0', notes:'',
  application_date: new Date().toISOString().slice(0,10), booking_time:'', customer_bank_name:'',
  upline_broker_code:'', manager_signature_by:'', affidavit_accepted:true,
  payment_plan: 'booking_only' as Plan,
  emi_n: '12', emi_freq: 'monthly', emi_start: new Date().toISOString().slice(0,10),
  cust_mode: 'new' as CustMode,
  new_customer: { ...NEW_CUST_EMPTY },
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
        .order('created_at', { ascending: false })
      if (error) throw error
      return data
    },
  })

  // Use bp_plots (live data); only available plots
  const { data: plots = [] } = useQuery({
    queryKey: ['plots_avail'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('bp_plots')
        .select('id, plot_no, size_sqyd, total_price, status, project_id, bp_projects(id, name)')
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
      const { data, error } = await supabase.from('brokers').select('id,name,broker_id')
      if (error) throw error
      return data
    },
  })

  // Use bp_projects (live data)
  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: async () => {
      const { data, error } = await supabase.from('bp_projects').select('id,name,location').order('name')
      if (error) throw error
      return data
    },
  })

  async function generateEmiForBooking(bookingId: string, principal: number, num: number, freq: string, startDate: string) {
    if (principal <= 0 || num <= 0) return
    const amt = Math.round(principal / num)
    const { data: sched, error } = await supabase.from('emi_schedules').insert({
      booking_id: bookingId, frequency: freq, start_date: startDate,
      num_installments: num, principal, total_payable: principal,
      interest_rate_pct: 0, interest_method: 'flat',
    }).select('id').single()
    if (error || !sched) throw error || new Error('Schedule insert failed')
    const offset = freq === 'monthly' ? 1 : freq === 'quarterly' ? 3 : freq === 'half_yearly' ? 6 : 12
    const start = new Date(startDate)
    const rows = Array.from({ length: num }, (_, i) => {
      const d = new Date(start)
      d.setMonth(d.getMonth() + offset * (i + 1))
      return {
        schedule_id: sched.id, seq: i + 1, due_date: d.toISOString().slice(0,10),
        amount: amt, principal_component: amt, interest_component: 0, status: 'pending',
      }
    })
    await supabase.from('emi_installments').insert(rows)
  }

  const create = useMutation({
    mutationFn: async (p: any) => {
      const { payment_plan, emi_n, emi_freq, emi_start, cust_mode, new_customer, ...bookingData } = p

      if (cust_mode === 'new') {
        if (!new_customer?.name || !new_customer?.phone) throw new Error('New customer name & phone required')
        const { data: nc, error: ncErr } = await supabase.from('bp_customers').insert({
          ...new_customer,
          dob: new_customer.dob || null,
          nominee_dob: new_customer.nominee_dob || null,
        }).select('id').single()
        if (ncErr || !nc) throw ncErr || new Error('Failed to create customer')
        bookingData.customer_id = nc.id
      }

      const { data, error } = await supabase.from('bp_bookings').insert(bookingData).select().single()
      if (error) throw error
      if (payment_plan === 'emi_plan') {
        const principal = Math.max(0, Number(bookingData.total_amount || 0) - Number(bookingData.booking_amount || 0))
        await generateEmiForBooking(data.id, principal, Number(emi_n) || 12, emi_freq || 'monthly', emi_start || new Date().toISOString().slice(0,10))
      }
      return data
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['bookings'] })
      qc.invalidateQueries({ queryKey: ['customers'] })
      const baseMsg = vars.cust_mode === 'new' ? 'Customer + booking created' : 'Booking created'
      toast.success(vars.payment_plan === 'emi_plan' ? `${baseMsg} + EMI schedule` : baseMsg)
    },
    onError: (e: any) => toast.error(e.message),
  })

  const update = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: any }) => {
      const { payment_plan, emi_n, emi_freq, emi_start, cust_mode, new_customer, ...rest } = data
      const { data: d, error } = await supabase
        .from('bp_bookings')
        .update({ ...rest, updated_at: new Date().toISOString() })
        .eq('id', id).select().single()
      if (error) throw error
      return d
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
      stage: b.stage, total_amount: b.total_amount || b.plot_total_price || '', booking_amount: b.booking_amount || '',
      discount_amount: b.discount_amount || '0', notes: b.notes || '',
      application_date: b.application_date || new Date().toISOString().slice(0,10),
      booking_time: b.booking_time || '', customer_bank_name: b.customer_bank_name || '',
      upline_broker_code: b.upline_broker_code || '', manager_signature_by: b.manager_signature_by || '',
      affidavit_accepted: b.affidavit_accepted !== false,
      payment_plan: 'booking_only',
      cust_mode: 'existing',  // Editing always uses existing
    } : EMPTY)
    setModal(true)
  }

  const save = async () => {
    const project = (projects as any[]).find((p: any) => p.id === form.project_id)
    const d: any = {
      ...form,
      scheme_name: project?.name || null,
      total_amount: Number(form.total_amount) || 0,
      booking_amount: form.booking_amount ? Number(form.booking_amount) : null,
      discount_amount: Number(form.discount_amount) || 0,
      application_date: form.application_date || null,
      booking_time: form.booking_time || null,
    }
    if (editing) await update.mutateAsync({ id: editing.id, data: d })
    else await create.mutateAsync(d)
    setModal(false)
  }

  const handlePlotChange = (plotId: string) => {
    set('plot_id', plotId)
    const p = (plots as any[]).find((pl: any) => pl.id === plotId)
    if (p?.total_price) set('total_amount', String(p.total_price))
    if (p?.bp_projects?.id) set('project_id', p.bp_projects.id)
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

  const principalPreview = Math.max(0, (Number(form.total_amount) || 0) - (Number(form.booking_amount) || 0))
  const emiAmtPreview = principalPreview > 0 && Number(form.emi_n) > 0 ? Math.round(principalPreview / Number(form.emi_n)) : 0

  // Plan card metadata with icons
  const PLAN_META: { key: Plan; label: string; hint: string; icon: any }[] = [
    { key: 'token_only',   label: 'Token only',     hint: 'Customer pays only token now. Add EMI/booking later via the EMI button on the row.', icon: Coins },
    { key: 'booking_only', label: 'Booking amount', hint: 'Book today, balance handled manually later. Recommended default.',                       icon: BookOpen },
    { key: 'emi_plan',     label: 'EMI plan',       hint: 'Auto-generates monthly/quarterly schedule for the balance after booking amount.',         icon: Calculator },
    { key: 'full_payment', label: 'Full payment',   hint: 'Buyer pays total today — no EMI / pending dues.',                                          icon: Wallet },
  ]

  const cols = [
    { header: 'Booking No', render: (r: any) => <span className="font-mono text-xs font-semibold text-blue-700">{r.booking_no}</span> },
    {
      header: 'Customer',
      render: (r: any) => (
        <div>
          <div className="font-medium text-gray-900">{r.bp_customers?.name}</div>
          <div className="text-xs text-gray-400">{r.bp_customers?.customer_code ? r.bp_customers.customer_code + ' · ' : ''}{r.bp_customers?.phone}{r.bp_customers?.father_or_husband_name ? ` · S/o ${r.bp_customers.father_or_husband_name}` : ''}</div>
        </div>
      ),
    },
    {
      header: 'Plot / Scheme',
      render: (r: any) => (
        <div>
          <div className="font-medium text-sm">{r.bp_plots?.plot_no || '—'}</div>
          <div className="text-xs text-gray-400">{r.bp_projects?.name || r.scheme_name || ''}</div>
        </div>
      ),
    },
    { header: 'Broker',  render: (r: any) => <span className="text-sm">{r.brokers?.name || '—'}<br/><span className="text-xs text-gray-400 font-mono">{r.upline_broker_code || r.brokers?.broker_id || ''}</span></span> },
    { header: 'Amount',  render: (r: any) => <span className="font-semibold text-green-700">{formatINR(r.total_amount || r.plot_total_price)}</span> },
    {
      header: 'Stage',
      render: (r: any) => {
        const meta = STAGE_META[r.stage as Stage] || STAGE_META.enquiry
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
            <option value="">{(projects as any[]).length === 0 ? 'No projects yet — create one in Projects nav first' : 'Select scheme / project'}</option>
            {(projects as any[]).map((p: any) => <option key={p.id} value={p.id}>{p.name}{p.location ? ` · ${p.location}` : ''}</option>)}
          </Select>
          <Select label="Plot (Available) — प्लॉट नं." value={form.plot_id} onChange={(e: any) => handlePlotChange(e.target.value)} className="col-span-2">
            <option value="">{(plots as any[]).length === 0 ? 'No available plots — add some in Plots nav first' : 'Select Plot'}</option>
            {(plots as any[]).map((p: any) => <option key={p.id} value={p.id}>{p.plot_no} — {p.size_sqyd} sqyd · {formatINR(p.total_price)} · {p.bp_projects?.name}</option>)}
          </Select>
        </div>

        {/* 2. PAYMENT PLAN — moved up to set context */}
        <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2 mt-4 pt-3 border-t border-gray-100">Payment Plan</div>
        <div className="text-[11px] text-gray-500 mb-2">How will the customer pay? Pick one — you can change it anytime later from the booking row's <b>EMI</b> button.</div>
        <div className="grid grid-cols-4 gap-2">
          {PLAN_META.map(({ key, label, hint, icon: Icon }) => (
            <label key={key} className={`cursor-pointer rounded-lg border p-2.5 text-xs ${form.payment_plan === key ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-400'}`}>
              <input type="radio" name="plan" value={key} className="hidden" checked={form.payment_plan === key} onChange={() => set('payment_plan', key)} />
              <div className="flex items-center gap-1.5 font-semibold"><Icon size={12}/>{label}</div>
              <div className="text-[11px] text-gray-500 mt-1 leading-tight">{hint}</div>
            </label>
          ))}
        </div>
        {form.payment_plan === 'emi_plan' && (
          <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-lg">
            <div className="text-xs text-amber-900 mb-2">EMI principal: <b>{formatINR(principalPreview)}</b> (Total − Booking) · Per instalment: <b>{formatINR(emiAmtPreview)}</b></div>
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
            {editing && <p className="text-[11px] text-amber-700 mt-2">Editing existing booking won't regenerate the schedule — use the EMI button on the row to manage it.</p>}
          </div>
        )}

        {/* 3. CUSTOMER — defaults to NEW */}
        <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2 mt-4 pt-3 border-t border-gray-100 flex items-center justify-between">
          <span>Customer</span>
          {!editing && (
            <div className="flex gap-1 normal-case">
              <button type="button" onClick={() => set('cust_mode', 'new')}      className={`text-xs px-2.5 py-1 rounded-lg flex items-center gap-1 ${form.cust_mode === 'new' ? 'bg-emerald-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}><UserPlus  size={12}/>New customer</button>
              <button type="button" onClick={() => set('cust_mode', 'existing')} className={`text-xs px-2.5 py-1 rounded-lg flex items-center gap-1 ${form.cust_mode === 'existing' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}><UserCheck size={12}/>Existing</button>
            </div>
          )}
        </div>

        {form.cust_mode === 'existing' || editing ? (
          <>
            <Select label="Existing Customer" value={form.customer_id} onChange={(e: any) => set('customer_id', e.target.value)}>
              <option value="">Select Customer</option>
              {(customers as any[]).map((c: any) => <option key={c.id} value={c.id}>{c.customer_code ? `[${c.customer_code}] ` : ''}{c.name} ({c.phone}){c.father_or_husband_name ? ` · S/o ${c.father_or_husband_name}` : ''}</option>)}
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
                  <span className="col-span-2 pt-1 border-t border-blue-200">Nominee: <b>{c.nominee_name || '—'}</b> ({c.nominee_relation || '—'}) · PAN <b>{c.nominee_pan || '—'}</b></span>
                  {!c.nominee_name && <span className="col-span-2 text-amber-700">⚠ Nominee details missing — update on Customers page after booking.</span>}
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

        {/* 4. BOOKING DETAILS */}
        <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2 mt-4 pt-3 border-t border-gray-100">Booking</div>
        <div className="grid grid-cols-2 gap-3">
          <Input label="Application Date" type="date" value={form.application_date} onChange={(e: any) => set('application_date', e.target.value)} />
          <Input label="Booking Time" type="time" value={form.booking_time} onChange={(e: any) => set('booking_time', e.target.value)} />
          <Input label="प्लॉट की कुल कीमत (Total ₹)" type="number" value={form.total_amount} onChange={(e: any) => set('total_amount', e.target.value)} />
          <Input label="बुकिंग राशि (Booking Amount ₹)" type="number" value={form.booking_amount} onChange={(e: any) => set('booking_amount', e.target.value)} />
          <Input label="Discount (₹)" type="number" value={form.discount_amount} onChange={(e: any) => set('discount_amount', e.target.value)} />
          <Input label="Customer Bank Name" value={form.customer_bank_name} onChange={(e: any) => set('customer_bank_name', e.target.value)} placeholder="e.g. HDFC Bank" />
        </div>

        {/* 5. SPONSOR & APPROVALS */}
        <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2 mt-4 pt-3 border-t border-gray-100">Sponsor & Approvals</div>
        <div className="grid grid-cols-2 gap-3">
          <Select label="परिचयकर्ता / Upline Broker" value={form.broker_id} onChange={(e: any) => handleBrokerChange(e.target.value)}>
            <option value="">No Broker</option>
            {(brokers as any[]).map((b: any) => <option key={b.id} value={b.id}>{b.name} [{b.broker_id}]</option>)}
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
          <Button onClick={save} loading={create.isPending || update.isPending}>{editing ? 'Save changes' : (form.cust_mode === 'new' ? 'Create Customer + Booking' : (form.payment_plan === 'emi_plan' ? 'Save Booking + EMI' : 'Save Booking'))}</Button>
        </div>
      </Modal>

      <EmiPanel booking={emiBooking} open={!!emiBooking} onClose={() => setEmiBooking(null)} />
    </div>
  )
}
