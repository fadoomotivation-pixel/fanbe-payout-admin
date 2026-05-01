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
import { Plus, ArrowRight, FileText, Printer } from 'lucide-react'
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

const EMPTY = {
  plot_id:'', customer_id:'', broker_id:'', project_id:'', stage:'enquiry' as Stage,
  total_amount:'', booking_amount:'', discount_amount:'0', notes:'',
  scheme_name:'', application_date:'', booking_time:'', customer_bank_name:'',
  upline_broker_code:'', manager_signature_by:'', affidavit_accepted:true,
}

export default function Bookings() {
  const qc = useQueryClient()
  const [modal, setModal]     = useState(false)
  const [editing, setEditing] = useState<any>(null)
  const [form, setForm]       = useState<any>(EMPTY)
  const [stageFilter, setStageFilter] = useState<Stage | 'all'>('all')
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
        .select('id,plot_number,projects(name,project_code),property_type,dimension,area,total_cost')
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

  const create = useMutation({
    mutationFn: async (p: any) => {
      const { data, error } = await supabase.from('bp_bookings').insert(p).select().single()
      if (error) throw error
      return data
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['bookings'] }); toast.success('Booking created') },
    onError: (e: any) => toast.error(e.message),
  })

  const update = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: any }) => {
      const { data: d, error } = await supabase
        .from('bp_bookings')
        .update({ ...data, updated_at: new Date().toISOString() })
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
      plot_id: b.plot_id || '', customer_id: b.customer_id || '',
      broker_id: b.broker_id || '', project_id: b.project_id || '',
      stage: b.stage, total_amount: b.total_amount || '', booking_amount: b.booking_amount || '',
      discount_amount: b.discount_amount || '0', notes: b.notes || '',
      scheme_name: b.scheme_name || '', application_date: b.application_date || '',
      booking_time: b.booking_time || '', customer_bank_name: b.customer_bank_name || '',
      upline_broker_code: b.upline_broker_code || '', manager_signature_by: b.manager_signature_by || '',
      affidavit_accepted: b.affidavit_accepted !== false,
    } : EMPTY)
    setModal(true)
  }

  const save = async () => {
    const d: any = {
      ...form,
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
          <div className="text-xs text-gray-400">{r.scheme_name || r.bp_projects?.name}</div>
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
          <div className="flex gap-1">
            <Button size="sm" variant="ghost" onClick={() => open(r)}><FileText size={12} />Edit</Button>
            <Button size="sm" variant="ghost" onClick={() => printApplicationForm(r)}><Printer size={12} />Form</Button>
            {ns && r.stage !== 'cancelled' && (
              <Button size="sm" onClick={() => advanceStage.mutate({ id: r.id, stage: ns })}>
                <ArrowRight size={12} />{STAGE_META[ns].label}
              </Button>
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
        <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Scheme & Plot</div>
        <div className="grid grid-cols-2 gap-3">
          <Input label="आवासीय योजना का नाम (Scheme)" value={form.scheme_name} onChange={(e: any) => set('scheme_name', e.target.value)} className="col-span-2" placeholder="e.g. Brijvatika Awasiya Yojana" />
          <Select label="Project" value={form.project_id} onChange={(e: any) => set('project_id', e.target.value)}>
            <option value="">Select Project</option>
            {(projects as any[]).map((p: any) => <option key={p.id} value={p.id}>{p.name} [{p.project_code}]</option>)}
          </Select>
          <Select label="Plot (Vacant)" value={form.plot_id} onChange={(e: any) => handlePlotChange(e.target.value)}>
            <option value="">Select Plot</option>
            {(plots as any[]).map((p: any) => <option key={p.id} value={p.id}>{p.plot_number} — {p.dimension} ({p.property_type})</option>)}
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
          <Input label="बुकिंग राशि (Booking Amount ₹)" type="number" value={form.booking_amount} onChange={(e: any) => set('booking_amount', e.target.value)} />
          <Input label="प्लॉट की कुल कीमत (Total ₹)" type="number" value={form.total_amount} onChange={(e: any) => set('total_amount', e.target.value)} />
          <Input label="Discount (₹)" type="number" value={form.discount_amount} onChange={(e: any) => set('discount_amount', e.target.value)} />
          <Input label="Customer Bank Name" value={form.customer_bank_name} onChange={(e: any) => set('customer_bank_name', e.target.value)} placeholder="e.g. HDFC Bank" />
        </div>

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
          <Button onClick={save} loading={create.isPending || update.isPending}>Save Booking</Button>
        </div>
      </Modal>
    </div>
  )
}
