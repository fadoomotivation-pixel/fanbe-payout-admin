import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { Table } from '@/components/ui/Table.tsx'
import { Button } from '@/components/ui/Button.tsx'
import { Input, Select, Textarea } from '@/components/ui/Input.tsx'
import { Modal } from '@/components/ui/Modal.tsx'
import { Badge } from '@/components/ui/Badge.tsx'
import { formatINR, formatDate } from '@/lib/utils'
import { Plus } from 'lucide-react'
import toast from 'react-hot-toast'

const STAGE_COLORS: Record<string,string> = { enquiry:'bg-gray-100 text-gray-600', site_visit:'bg-blue-100 text-blue-700', negotiation:'bg-yellow-100 text-yellow-700', token_received:'bg-orange-100 text-orange-700', booking_done:'bg-green-100 text-green-700', cancelled:'bg-red-100 text-red-700' }
const EMPTY = { plot_id:'', customer_id:'', broker_id:'', project_id:'', stage:'enquiry', total_amount:'', discount_amount:'0', notes:'' }

export default function Bookings() {
  const qc = useQueryClient()
  const { data: bookings = [], isLoading } = useQuery({
    queryKey: ['bookings'],
    queryFn: async () => {
      const { data, error } = await supabase.from('bp_bookings').select('*,bp_plots(plot_no,size_sqyd),bp_customers(name,phone),brokers(name,broker_id),bp_projects(name)').order('created_at', { ascending: false })
      if (error) throw error; return data
    },
  })
  const { data: plots = [] } = useQuery({ queryKey: ['plots_avail'], queryFn: async () => { const { data, error } = await supabase.from('bp_plots').select('id,plot_no,bp_projects(name)').eq('status','available'); if (error) throw error; return data } })
  const { data: customers = [] } = useQuery({ queryKey: ['customers'], queryFn: async () => { const { data, error } = await supabase.from('bp_customers').select('id,name,phone'); if (error) throw error; return data } })
  const { data: brokers = [] } = useQuery({ queryKey: ['brokers'], queryFn: async () => { const { data, error } = await supabase.from('brokers').select('id,name,broker_id'); if (error) throw error; return data } })
  const { data: projects = [] } = useQuery({ queryKey: ['projects'], queryFn: async () => { const { data, error } = await supabase.from('bp_projects').select('id,name'); if (error) throw error; return data } })

  const create = useMutation({ mutationFn: async (p: any) => { const { data, error } = await supabase.from('bp_bookings').insert(p).select().single(); if (error) throw error; return data }, onSuccess: () => { qc.invalidateQueries({ queryKey: ['bookings'] }); toast.success('Booking created') }, onError: (e: any) => toast.error(e.message) })
  const update = useMutation({ mutationFn: async ({ id, data }: { id: string; data: any }) => { const { data: d, error } = await supabase.from('bp_bookings').update({ ...data, updated_at: new Date().toISOString() }).eq('id', id).select().single(); if (error) throw error; return d }, onSuccess: () => { qc.invalidateQueries({ queryKey: ['bookings'] }); toast.success('Booking updated') }, onError: (e: any) => toast.error(e.message) })

  const [modal, setModal] = useState(false); const [editing, setEditing] = useState<any>(null); const [form, setForm] = useState<any>(EMPTY)
  const open = (b?: any) => { setEditing(b || null); setForm(b ? { plot_id:b.plot_id||'', customer_id:b.customer_id||'', broker_id:b.broker_id||'', project_id:b.project_id||'', stage:b.stage, total_amount:b.total_amount, discount_amount:b.discount_amount||'0', notes:b.notes||'' } : EMPTY); setModal(true) }
  const save = async () => { const d = { ...form, total_amount: Number(form.total_amount), discount_amount: Number(form.discount_amount) }; editing ? await update.mutateAsync({ id: editing.id, data: d }) : await create.mutateAsync(d); setModal(false) }
  const set = (k: string, v: any) => setForm((p: any) => ({ ...p, [k]: v }))

  const cols = [
    { header: 'Booking No', render: (r: any) => <span className="font-mono text-xs font-semibold">{r.booking_no}</span> },
    { header: 'Customer', render: (r: any) => <div><div className="font-medium">{r.bp_customers?.name}</div><div className="text-xs text-gray-400">{r.bp_customers?.phone}</div></div> },
    { header: 'Plot', render: (r: any) => <span>{r.bp_plots?.plot_no} — {r.bp_projects?.name}</span> },
    { header: 'Broker', render: (r: any) => r.brokers?.name || '—' },
    { header: 'Amount', render: (r: any) => <span className="font-semibold">{formatINR(r.total_amount)}</span> },
    { header: 'Stage', render: (r: any) => <Badge label={r.stage?.replace(/_/g,' ')} className={STAGE_COLORS[r.stage] || 'bg-gray-100 text-gray-600'} /> },
    { header: 'Date', render: (r: any) => formatDate(r.created_at) },
    { header: '', render: (r: any) => <Button size="sm" variant="ghost" onClick={() => open(r)}>Edit</Button> },
  ]

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div><h1 className="text-xl font-bold text-gray-900">Bookings</h1><p className="text-sm text-gray-500">{(bookings as any[]).length} bookings</p></div>
        <Button onClick={() => open()}><Plus size={14} />New Booking</Button>
      </div>
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm"><Table columns={cols} data={bookings} loading={isLoading} /></div>
      <Modal open={modal} onClose={() => setModal(false)} title={editing ? 'Edit Booking' : 'New Booking'}>
        <div className="grid grid-cols-2 gap-4">
          <Select label="Project" value={form.project_id} onChange={(e: any) => set('project_id', e.target.value)} className="col-span-2">
            <option value="">Select Project</option>
            {(projects as any[]).map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </Select>
          <Select label="Plot" value={form.plot_id} onChange={(e: any) => set('plot_id', e.target.value)}>
            <option value="">Select Plot</option>
            {(plots as any[]).map((p: any) => <option key={p.id} value={p.id}>{p.plot_no} — {(p.bp_projects as any)?.name}</option>)}
          </Select>
          <Select label="Customer" value={form.customer_id} onChange={(e: any) => set('customer_id', e.target.value)}>
            <option value="">Select Customer</option>
            {(customers as any[]).map((c: any) => <option key={c.id} value={c.id}>{c.name} ({c.phone})</option>)}
          </Select>
          <Select label="Broker" value={form.broker_id} onChange={(e: any) => set('broker_id', e.target.value)}>
            <option value="">No Broker</option>
            {(brokers as any[]).map((b: any) => <option key={b.id} value={b.id}>{b.name} [{b.broker_id}]</option>)}
          </Select>
          <Select label="Stage" value={form.stage} onChange={(e: any) => set('stage', e.target.value)}>
            {['enquiry','site_visit','negotiation','token_received','booking_done','cancelled'].map(s => <option key={s} value={s}>{s.replace(/_/g,' ')}</option>)}
          </Select>
          <Input label="Total Amount (₹)" type="number" value={form.total_amount} onChange={(e: any) => set('total_amount', e.target.value)} />
          <Input label="Discount (₹)" type="number" value={form.discount_amount} onChange={(e: any) => set('discount_amount', e.target.value)} />
          <Textarea label="Notes" value={form.notes} onChange={(e: any) => set('notes', e.target.value)} className="col-span-2" rows={2} />
        </div>
        <div className="flex justify-end gap-2 mt-6">
          <Button variant="secondary" onClick={() => setModal(false)}>Cancel</Button>
          <Button onClick={save} loading={create.isPending || update.isPending}>Save</Button>
        </div>
      </Modal>
    </div>
  )
}