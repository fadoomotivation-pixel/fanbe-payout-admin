import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { Table } from '@/components/ui/Table.tsx'
import { Button } from '@/components/ui/Button.tsx'
import { Input, Select, Textarea } from '@/components/ui/Input.tsx'
import { Modal } from '@/components/ui/Modal.tsx'
import { Badge } from '@/components/ui/Badge.tsx'
import { formatINR } from '@/lib/utils'
import { Plus } from 'lucide-react'
import toast from 'react-hot-toast'

const EMPTY = { name:'', location:'', description:'', total_plots:0, price_per_sqyd:0, status:'active', rera_no:'', site_manager:'', launch_date:'' }

export default function Projects() {
  const qc = useQueryClient()
  const { data: projects = [], isLoading } = useQuery({
    queryKey: ['projects'],
    queryFn: async () => { const { data, error } = await supabase.from('bp_projects').select('*').order('created_at', { ascending: false }); if (error) throw error; return data },
  })
  const create = useMutation({ mutationFn: async (p: any) => { const { data, error } = await supabase.from('bp_projects').insert(p).select().single(); if (error) throw error; return data }, onSuccess: () => { qc.invalidateQueries({ queryKey: ['projects'] }); toast.success('Project created') }, onError: (e: any) => toast.error(e.message) })
  const update = useMutation({ mutationFn: async ({ id, data }: { id: string; data: any }) => { const { data: d, error } = await supabase.from('bp_projects').update({ ...data, updated_at: new Date().toISOString() }).eq('id', id).select().single(); if (error) throw error; return d }, onSuccess: () => { qc.invalidateQueries({ queryKey: ['projects'] }); toast.success('Project updated') }, onError: (e: any) => toast.error(e.message) })

  const [modal, setModal] = useState(false); const [editing, setEditing] = useState<any>(null); const [form, setForm] = useState<any>(EMPTY)
  const open = (p?: any) => { setEditing(p || null); setForm(p ? { name:p.name, location:p.location, description:p.description||'', total_plots:p.total_plots, price_per_sqyd:p.price_per_sqyd, status:p.status, rera_no:p.rera_no||'', site_manager:p.site_manager||'', launch_date:p.launch_date||'' } : EMPTY); setModal(true) }
  const save = async () => { const d = { ...form, total_plots: Number(form.total_plots), price_per_sqyd: Number(form.price_per_sqyd) }; editing ? await update.mutateAsync({ id: editing.id, data: d }) : await create.mutateAsync(d); setModal(false) }
  const set = (k: string, v: any) => setForm((p: any) => ({ ...p, [k]: v }))

  const cols = [
    { header: 'Name', render: (r: any) => <span className="font-semibold">{r.name}</span> },
    { header: 'Location', key: 'location' },
    { header: 'Price/sqyd', render: (r: any) => formatINR(r.price_per_sqyd) },
    { header: 'Plots', key: 'total_plots' },
    { header: 'RERA', key: 'rera_no' },
    { header: 'Status', render: (r: any) => <Badge label={r.status} className={r.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'} /> },
    { header: '', render: (r: any) => <Button size="sm" variant="ghost" onClick={() => open(r)}>Edit</Button> },
  ]

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div><h1 className="text-xl font-bold text-gray-900">Projects</h1><p className="text-sm text-gray-500">{(projects as any[]).length} projects</p></div>
        <Button onClick={() => open()}><Plus size={14} />Add Project</Button>
      </div>
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm"><Table columns={cols} data={projects} loading={isLoading} /></div>
      <Modal open={modal} onClose={() => setModal(false)} title={editing ? 'Edit Project' : 'New Project'}>
        <div className="grid grid-cols-2 gap-4">
          <Input label="Project Name" value={form.name} onChange={(e: any) => set('name', e.target.value)} required className="col-span-2" />
          <Input label="Location" value={form.location} onChange={(e: any) => set('location', e.target.value)} required />
          <Input label="RERA No" value={form.rera_no} onChange={(e: any) => set('rera_no', e.target.value)} />
          <Input label="Total Plots" type="number" value={form.total_plots} onChange={(e: any) => set('total_plots', e.target.value)} />
          <Input label="Price per sqyd (₹)" type="number" value={form.price_per_sqyd} onChange={(e: any) => set('price_per_sqyd', e.target.value)} />
          <Input label="Site Manager" value={form.site_manager} onChange={(e: any) => set('site_manager', e.target.value)} />
          <Input label="Launch Date" type="date" value={form.launch_date} onChange={(e: any) => set('launch_date', e.target.value)} />
          <Select label="Status" value={form.status} onChange={(e: any) => set('status', e.target.value)}>
            <option value="active">Active</option><option value="upcoming">Upcoming</option><option value="completed">Completed</option><option value="on_hold">On Hold</option>
          </Select>
          <Textarea label="Description" value={form.description} onChange={(e: any) => set('description', e.target.value)} className="col-span-2" rows={2} />
        </div>
        <div className="flex justify-end gap-2 mt-6">
          <Button variant="secondary" onClick={() => setModal(false)}>Cancel</Button>
          <Button onClick={save} loading={create.isPending || update.isPending}>Save</Button>
        </div>
      </Modal>
    </div>
  )
}