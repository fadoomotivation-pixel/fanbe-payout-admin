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
import { Plus, ArrowRight, FileText, Printer, Calculator } from 'lucide-react'
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

const EMPTY: any = {
  plot_id:'', customer_id:'', broker_id:'', project_id:'', stage:'enquiry',
  total_amount:'', booking_amount:'', discount_amount:'0', notes:'',
  application_date: new Date().toISOString().slice(0,10), booking_time:'', customer_bank_name:'',
  upline_broker_code:'', manager_signature_by:'', affidavit_accepted:true,
  payment_plan: 'token_only' as Plan,
  emi_n: '12', emi_freq: 'monthly', emi_start: new Date().toISOString().slice(0,10),
}

export default function Bookings() {
  const qc = useQueryClient()
  const [modal, setModal]     = useState(false)
  const [editing, setEditing] = useState<any>(null)
  const [form, setForm]       = useState<any>(EMPTY)
  const [stageFilter, setStageFilter] = useState<Stage | 'all'>('all')
  const [emiBooking, setEmiBooking] = useState<any>(null)
  const set = (k: string, v: any) => setForm((p: any) => ({ ...p, [k]: v }))

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

  const { data: plots = [] } = useQuery({
    queryKey: ['plots_avail'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('plots')
        .select('id,plot_number,projects(name,project_code,id),property_type,dimension,area,total_cost')
        .eq('status','vacant')
      if (error) throw error
      return data
    },
  })

  const { data: customers = [] } = useQuery({
    queryKey: ['customers'],
    queryFn: async () => {
      const { data, error } = await supabase.from('bp_customers').select('*')
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

  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: async () => {
      const { data, error } = await supabase.from('projects').select('id,name,project_code')
      if (error) throw error
      return data
    },
  })

  // Generate EMI schedule + instalments after booking insert
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
      const { payment_plan, emi_n, emi_freq, emi_start, ...bookingData } = p
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
      toast.success(vars.payment_plan === 'emi_plan' ? 'Booking + EMI schedule created' : 'Booking created')
    },
    onError: (e: any) => toast.error(e.message),
  })

  const update = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: any }) => {
      const { payment_plan, emi_n, emi_freq, emi_start, ...rest } = data
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
      stage: b.stage, total_amount: b.total_amount || '', booking_amount: b.booking_amount || '',
      discount_amount: b.discount_amount || '0', notes: b.notes || '',
      application_date: b.application_date || new Date().toISOString().slice(0,10),
      booking_time: b.booking_time || '', customer_bank_name: b.customer_bank_name || '',
      upline_broker_code: b.upline_broker_code || '', manager_signature_by: b.manager_signature_by || '',
      affidavit_accepted: b.affidavit_accepted !== false,
      payment_plan: 'token_only',
    } : EMPTY)
    setModal(true)
  }

  const save = async () => {
    // Auto-set scheme_name from selected project so the print template still has it
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
    if (p?.total_cost) set('total_amount', String(p.total_cost))
    if (p?.projects?.id) set('project_id', p.projects.id)
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
  const totalValue  = all.filter((b: any) => b.stage === 'booking_done').reduce((s: number, b: any) => s + Number(b.total_amount || 0), 0)
  const filtered = stageFilter === 'all' ? all : all.filter((b: any) => b.stage === stageFilter)

  // Derived for the modal: outstanding principal preview
  const principalPreview = Math.max(0, (Number(form.total_amount) || 0) - (Number(form.booking_amount) || 0))
  const emiAmtPreview = principalPreview > 0 && Number(form.emi_n) > 0 ? Math.round(principalPreview / Number(form.emi_n)) : 0

  const cols = [
    { header: 'Booking No', render: (r: any) => <span className="font-mono text-xs font-semibold text-blue-700">{r.booking_no}</span> },
    {
      header: 'Customer',
      render: (r: any) => (
        <div>
          <div className="font-medium text-gray-900">{r.bp_customers?.name}</div>
          <div className="text-xs text-gray-400">{r.bp_customers?.phone}{r.bp_customers?.father_or_husband_name ? ` · S/o ${r.bp_customers.father_or_husband_name}` : ''}</div>
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
    { header: 'Amount',  render: (r: any) => <span className="font-semibold text-green-700">{formatINR(r.total_amount)}</span> },
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
        <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">आवासीय योजना (Scheme) & Plot</div>
        <div className="grid grid-cols-2 gap-3">
          <Select label="आवासीय योजना का नाम (Project / Scheme)" value={form.project_id} onChange={(e: any) => set('project_id', e.target.value)} className="col-span-2">
            <option value="">Select scheme / project</option>
            {(projects as any[]).map((p: any) => <option key={p.id} value={p.id}>{p.name} [{p.project_code}]</option>)}
          </Select>
          <Select label="Plot (Vacant) — प्लॉट नं." value={form.plot_id} onChange={(e: any) => handlePlotChange(e.target.value)} className="col-span-2">
            <option value="">Select Plot</option>
            {(plots as any[]).map((p: any) => <option key={p.id} value={p.id}>{p.plot_number} — {p.dimension} · {p.property_type} · {p.projects?.name}</option>)}
          </Select>
        </div>

        <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2 mt-4 pt-3 border-t border-gray-100">Customer</div>
        <Select label="Existing Customer" value={form.customer_id} onChange={(e: any) => set('customer_id', e.target.value)}>
          <option value="">Select Customer</option>
          {(customers as any[]).map((c: any) => <option key={c.id} value={c.id}>{c.name} ({c.phone}){c.father_or_husband_name ? ` · S/o ${c.father_or_husband_name}` : ''}</option>)}
        </Select>
        {form.customer_id && (() => {
          const c = (customers as any[]).find((x: any) => x.id === form.customer_id)
          return c ? (
            <div className="mt-2 p-3 bg-blue-50 rounded-lg text-xs text-blue-900 grid grid-cols-2 gap-2">
              <span>S/o W/o: <b>{c.father_or_husband_name || '—'}</b></span>
              <span>DOB: <b>{c.dob || '—'}</b></span>
              <span>Address: <b>{c.address || '—'}</b></span>
              <span>PAN: <b>{c.pan || '—'}</b></span>
              <span className="col-span-2 pt-1 border-t border-blue-200">Nominee: <b>{c.nominee_name || '—'}</b> ({c.nominee_relation || '—'}) · PAN <b>{c.nominee_pan || '—'}</b></span>
              {!c.nominee_name && <span className="col-span-2 text-amber-700">⚠ Nominee details missing — update on Members page before printing form.</span>}
            </div>
          ) : null
        })()}

        <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2 mt-4 pt-3 border-t border-gray-100">Booking</div>
        <div className="grid grid-cols-2 gap-3">
          <Input label="Application Date" type="date" value={form.application_date} onChange={(e: any) => set('application_date', e.target.value)} />
          <Input label="Booking Time" type="time" value={form.booking_time} onChange={(e: any) => set('booking_time', e.target.value)} />
          <Input label="प्लॉट की कुल कीमत (Total ₹)" type="number" value={form.total_amount} onChange={(e: any) => set('total_amount', e.target.value)} />
          <Input label="बुकिंग राशि (Booking Amount ₹)" type="number" value={form.booking_amount} onChange={(e: any) => set('booking_amount', e.target.value)} />
          <Input label="Discount (₹)" type="number" value={form.discount_amount} onChange={(e: any) => set('discount_amount', e.target.value)} />
          <Input label="Customer Bank Name" value={form.customer_bank_name} onChange={(e: any) => set('customer_bank_name', e.target.value)} placeholder="e.g. HDFC Bank" />
        </div>

        <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2 mt-4 pt-3 border-t border-gray-100">Payment Plan</div>
        <div className="grid grid-cols-4 gap-2">
          {([
            ['token_only',  'Token only',     'No structured plan; record token receipt manually'],
            ['booking_only','Booking amount', 'Book today, balance handled manually later'],
            ['emi_plan',    'EMI plan',       'Auto-generate instalment schedule for the balance'],
            ['full_payment','Full payment',   'Buyer pays total today — mark all as paid'],
          ] as [Plan, string, string][]).map(([key, label, hint]) => (
            <label key={key} className={`cursor-pointer rounded-lg border p-2.5 text-xs ${form.payment_plan === key ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:border-gray-400'}`}>
              <input type="radio" name="plan" value={key} className="hidden" checked={form.payment_plan === key} onChange={() => set('payment_plan', key)} />
              <div className="font-semibold">{label}</div>
              <div className="text-[11px] text-gray-500 mt-0.5 leading-tight">{hint}</div>
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
            {editing && <p className="text-[11px] text-amber-700 mt-2">Editing existing booking won’t regenerate the schedule — use the EMI button on the row to manage it.</p>}
          </div>
        )}

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
          <Button onClick={save} loading={create.isPending || update.isPending}>{editing ? 'Save changes' : (form.payment_plan === 'emi_plan' ? 'Save Booking + EMI' : 'Save Booking')}</Button>
        </div>
      </Modal>

      <EmiPanel booking={emiBooking} open={!!emiBooking} onClose={() => setEmiBooking(null)} />
    </div>
  )
}
