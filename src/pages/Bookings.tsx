import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { Table } from '@/components/ui/Table.tsx'
import { Button } from '@/components/ui/Button.tsx'
import { Input, Select, Textarea } from '@/components/ui/Input.tsx'
import { Modal } from '@/components/ui/Modal.tsx'
import { Badge } from '@/components/ui/Badge.tsx'
import { formatINR, formatDate } from '@/lib/utils'
import { Plus, ArrowRight, FileText } from 'lucide-react'
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

const EMPTY = { plot_id:'', customer_id:'', broker_id:'', project_id:'', stage:'enquiry' as Stage, total_amount:'', discount_amount:'0', notes:'' }

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
        .select('*,bp_plots(plot_no,size_sqyd),bp_customers(name,phone),brokers(name,broker_id),bp_projects(name)')
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

  const { data: members = [] } = useQuery({
    queryKey: ['members_list'],
    queryFn: async () => {
      const { data, error } = await supabase.from('members').select('id,name,phone,email')
      if (error) throw error
      return data
    },
  })

  const { data: customers = [] } = useQuery({
    queryKey: ['customers'],
    queryFn: async () => {
      const { data, error } = await supabase.from('bp_customers').select('id,name,phone')
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
        .eq('id', id)
        .select().single()
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
      stage: b.stage, total_amount: b.total_amount,
      discount_amount: b.discount_amount || '0', notes: b.notes || ''
    } : EMPTY)
    setModal(true)
  }

  const save = async () => {
    const d = { ...form, total_amount: Number(form.total_amount), discount_amount: Number(form.discount_amount) }
    editing ? await update.mutateAsync({ id: editing.id, data: d }) : await create.mutateAsync(d)
    setModal(false)
  }

  // Auto-fill total_cost from selected plot
  const handlePlotChange = (plotId: string) => {
    set('plot_id', plotId)
    const p = (plots as any[]).find((pl: any) => pl.id === plotId)
    if (p?.total_cost) set('total_amount', String(p.total_cost))
    if (p?.projects?.id) set('project_id', p.projects.id)
  }

  const nextStage = (current: Stage): Stage | null => {
    const idx = PIPELINE_STAGES.indexOf(current)
    if (idx === -1 || idx >= PIPELINE_STAGES.length - 1) return null
    return PIPELINE_STAGES[idx + 1]
  }

  // Stats
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
          <div className="text-xs text-gray-400">{r.bp_customers?.phone}</div>
        </div>
      ),
    },
    {
      header: 'Plot / Project',
      render: (r: any) => (
        <div>
          <div className="font-medium text-sm">{r.bp_plots?.plot_no || '—'}</div>
          <div className="text-xs text-gray-400">{r.bp_projects?.name}</div>
        </div>
      ),
    },
    { header: 'Broker',  render: (r: any) => <span className="text-sm">{r.brokers?.name || '—'}</span> },
    { header: 'Amount',  render: (r: any) => <span className="font-semibold text-green-700">{formatINR(r.total_amount)}</span> },
    {
      header: 'Stage',
      render: (r: any) => {
        const meta = STAGE_META[r.stage as Stage] || STAGE_META.enquiry
        return <Badge label={meta.label} className={meta.color} />
      },
    },
    { header: 'Date',    render: (r: any) => <span className="text-xs text-gray-500">{formatDate(r.created_at)}</span> },
    {
      header: 'Actions',
      render: (r: any) => {
        const ns = nextStage(r.stage as Stage)
        return (
          <div className="flex gap-1">
            <Button size="sm" variant="ghost" onClick={() => open(r)}><FileText size={12} />Edit</Button>
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
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Bookings</h1>
          <p className="text-sm text-gray-500">{all.length} total · Confirmed value: {formatINR(totalValue)}</p>
        </div>
        <Button onClick={() => open()}><Plus size={14} />New Booking</Button>
      </div>

      {/* Pipeline stats */}
      <div className="flex gap-2 mb-5 overflow-x-auto pb-1">
        <button
          onClick={() => setStageFilter('all')}
          className={`px-4 py-2 rounded-xl text-sm font-medium border transition-all whitespace-nowrap ${
            stageFilter === 'all' ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'
          }`}
        >
          All ({all.length})
        </button>
        {STAGES.map(s => (
          <button
            key={s}
            onClick={() => setStageFilter(s)}
            className={`px-4 py-2 rounded-xl text-sm font-medium border transition-all whitespace-nowrap ${
              stageFilter === s
                ? 'bg-gray-900 text-white border-gray-900'
                : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400'
            }`}
          >
            {STAGE_META[s].label} ({stageCounts[s] || 0})
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm">
        <Table columns={cols} data={filtered} loading={isLoading} />
      </div>

      {/* Modal */}
      <Modal open={modal} onClose={() => setModal(false)} title={editing ? 'Edit Booking' : 'New Booking'}>
        <div className="grid grid-cols-2 gap-4">
          <Select label="Project" value={form.project_id} onChange={(e: any) => set('project_id', e.target.value)} className="col-span-2">
            <option value="">Select Project</option>
            {(projects as any[]).map((p: any) => <option key={p.id} value={p.id}>{p.name} [{p.project_code}]</option>)}
          </Select>
          <Select label="Plot (Vacant)" value={form.plot_id} onChange={(e: any) => handlePlotChange(e.target.value)}>
            <option value="">Select Plot</option>
            {(plots as any[]).map((p: any) => <option key={p.id} value={p.id}>{p.plot_number} — {p.dimension} ({p.property_type})</option>)}
          </Select>
          <Select label="Customer" value={form.customer_id} onChange={(e: any) => set('customer_id', e.target.value)}>
            <option value="">Select Customer</option>
            {(customers as any[]).map((c: any) => <option key={c.id} value={c.id}>{c.name} ({c.phone})</option>)}
            {(members as any[]).length > 0 && <option disabled>── Members ──</option>}
            {(members as any[]).map((m: any) => <option key={`m-${m.id}`} value={m.id}>{m.name} ★</option>)}
          </Select>
          <Select label="Broker" value={form.broker_id} onChange={(e: any) => set('broker_id', e.target.value)}>
            <option value="">No Broker</option>
            {(brokers as any[]).map((b: any) => <option key={b.id} value={b.id}>{b.name} [{b.broker_id}]</option>)}
          </Select>
          <Select label="Stage" value={form.stage} onChange={(e: any) => set('stage', e.target.value)}>
            {STAGES.map(s => <option key={s} value={s}>{STAGE_META[s].label}</option>)}
          </Select>
          <Input label="Total Amount (₹)" type="number" value={form.total_amount} onChange={(e: any) => set('total_amount', e.target.value)} />
          <Input label="Discount (₹)" type="number" value={form.discount_amount} onChange={(e: any) => set('discount_amount', e.target.value)} />
          <Textarea label="Notes" value={form.notes} onChange={(e: any) => set('notes', e.target.value)} className="col-span-2" rows={2} />
        </div>
        {form.plot_id && (() => {
          const p = (plots as any[]).find((pl: any) => pl.id === form.plot_id)
          return p ? (
            <div className="mt-3 p-3 bg-blue-50 rounded-lg text-xs text-blue-700 grid grid-cols-3 gap-2">
              <span>📌 Plot: <b>{p.plot_number}</b></span>
              <span>📍 Dim: <b>{p.dimension}</b></span>
              <span>💰 Cost: <b>{formatINR(p.total_cost)}</b></span>
            </div>
          ) : null
        })()}
        <div className="flex justify-end gap-2 mt-6">
          <Button variant="secondary" onClick={() => setModal(false)}>Cancel</Button>
          <Button onClick={save} loading={create.isPending || update.isPending}>Save Booking</Button>
        </div>
      </Modal>
    </div>
  )
}
