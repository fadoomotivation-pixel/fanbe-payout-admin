import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { Table } from '@/components/ui/Table.tsx'
import { Button } from '@/components/ui/Button.tsx'
import { Input, Select, Textarea } from '@/components/ui/Input.tsx'
import { Modal } from '@/components/ui/Modal.tsx'
import { Badge } from '@/components/ui/Badge.tsx'
import { formatINR } from '@/lib/utils'
import { Building2, Plus, Edit3 } from 'lucide-react'
import toast from 'react-hot-toast'

// Projects writes to `bp_projects` — the same table that bp_plots / bp_bookings /
// CustomerPipeline / BrokerDashboard reference.  The old `projects` table existed only as
// a leftover from an earlier schema and was disconnected from every booking flow, which is
// why the page rendered blank rows (column names didn't match) and projects created here
// never appeared in any dropdown.

const EMPTY_PROJECT = {
  name: '', location: '', description: '', rera_no: '',
  price_per_sqyd: '', site_manager: '', launch_date: '',
  status: 'active',
}

export default function Projects() {
  const qc = useQueryClient()

  const { data: projects = [], isLoading } = useQuery({
    queryKey: ['projects'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('bp_projects')
        .select('*, bp_plots(count)')
        .order('created_at', { ascending: false })
      if (error) throw error
      return data
    },
  })

  const createProject = useMutation({
    mutationFn: async (p: any) => {
      const { data, error } = await supabase.from('bp_projects').insert(p).select().single()
      if (error) throw error
      return data
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['projects'] }); toast.success('Project created') },
    onError: (e: any) => toast.error(e.message),
  })

  const updateProject = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: any }) => {
      const { data: d, error } = await supabase.from('bp_projects').update({ ...data, updated_at: new Date().toISOString() }).eq('id', id).select().single()
      if (error) throw error
      return d
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['projects'] }); toast.success('Project updated') },
    onError: (e: any) => toast.error(e.message),
  })

  const [modal, setModal] = useState(false)
  const [editing, setEditing] = useState<any>(null)
  const [form, setForm] = useState<any>(EMPTY_PROJECT)

  const openCreate = () => { setEditing(null); setForm(EMPTY_PROJECT); setModal(true) }
  const openEdit = (p: any) => {
    setEditing(p)
    setForm({
      name: p.name || '',
      location: p.location || '',
      description: p.description || '',
      rera_no: p.rera_no || '',
      price_per_sqyd: p.price_per_sqyd ?? '',
      site_manager: p.site_manager || '',
      launch_date: p.launch_date || '',
      status: p.status || 'active',
    })
    setModal(true)
  }
  const set = (k: string, v: any) => setForm((prev: any) => ({ ...prev, [k]: v }))

  const save = async () => {
    if (!form.name.trim()) return toast.error('Project name is required')
    const payload: any = {
      name: form.name.trim(),
      location: form.location.trim() || null,
      description: form.description.trim() || null,
      rera_no: form.rera_no.trim() || null,
      price_per_sqyd: form.price_per_sqyd !== '' ? Number(form.price_per_sqyd) : null,
      site_manager: form.site_manager.trim() || null,
      launch_date: form.launch_date || null,
      status: form.status || 'active',
    }
    editing
      ? await updateProject.mutateAsync({ id: editing.id, data: payload })
      : await createProject.mutateAsync(payload)
    setModal(false)
  }

  const cols = [
    {
      header: 'Project',
      render: (r: any) => (
        <div className="min-w-0">
          <div className="font-semibold text-gray-900 truncate">{r.name || '—'}</div>
          {r.rera_no && <div className="text-[10px] font-mono text-gray-400 truncate">RERA · {r.rera_no}</div>}
        </div>
      ),
    },
    { header: 'Location', render: (r: any) => <span className="text-sm text-gray-700">{r.location || '—'}</span> },
    {
      header: 'Plots',
      render: (r: any) => {
        const cnt = r.bp_plots?.[0]?.count ?? 0
        return <span className="font-semibold text-gray-700 tabular-nums">{cnt}</span>
      },
    },
    {
      header: 'Rate / sqyd',
      render: (r: any) => r.price_per_sqyd ? <span className="text-sm tabular-nums">{formatINR(Number(r.price_per_sqyd))}</span> : <span className="text-gray-300">—</span>,
    },
    { header: 'Site Manager', render: (r: any) => <span className="text-sm text-gray-700">{r.site_manager || '—'}</span> },
    {
      header: 'Status',
      render: (r: any) => (
        <Badge label={r.status || 'active'}
          className={r.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'} />
      ),
    },
    {
      header: '',
      render: (r: any) => (
        <Button size="sm" variant="ghost" onClick={() => openEdit(r)}><Edit3 size={13}/>Edit</Button>
      ),
    },
  ]

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-indigo-50 rounded-lg"><Building2 size={20} className="text-indigo-600" /></div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">Projects</h1>
            <p className="text-sm text-gray-500">{(projects as any[]).length} projects · shared with Plots, Bookings &amp; Customer Pipeline</p>
          </div>
        </div>
        <Button onClick={openCreate}><Plus size={14} />New Project</Button>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm">
        <Table columns={cols} data={projects} loading={isLoading} />
      </div>

      <Modal open={modal} onClose={() => setModal(false)} title={editing ? `Edit project — ${editing.name}` : 'New Project'}>
        <div className="grid grid-cols-2 gap-4">
          <Input
            label="Project Name *"
            value={form.name}
            onChange={(e: any) => set('name', e.target.value)}
            required
            className="col-span-2"
            placeholder="e.g. Fanbe Green Valley"
          />
          <Input label="Location" value={form.location} onChange={(e: any) => set('location', e.target.value)} placeholder="e.g. Sector 12, Gurugram, Haryana" className="col-span-2"/>
          <Input label="RERA No" value={form.rera_no} onChange={(e: any) => set('rera_no', e.target.value)} placeholder="e.g. HRERA-GGN-2025-001"/>
          <Input label="Rate / sqyd (₹)" type="number" value={form.price_per_sqyd} onChange={(e: any) => set('price_per_sqyd', e.target.value)} placeholder="0"/>
          <Input label="Site Manager" value={form.site_manager} onChange={(e: any) => set('site_manager', e.target.value)} />
          <Input label="Launch Date" type="date" value={form.launch_date} onChange={(e: any) => set('launch_date', e.target.value)} />
          <Select label="Status" value={form.status} onChange={(e: any) => set('status', e.target.value)}>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
            <option value="upcoming">Upcoming</option>
            <option value="sold_out">Sold out</option>
          </Select>
          <Textarea label="Description" value={form.description} onChange={(e: any) => set('description', e.target.value)} className="col-span-2" rows={2}/>
        </div>
        <div className="flex justify-end gap-2 mt-6">
          <Button variant="secondary" onClick={() => setModal(false)}>Cancel</Button>
          <Button onClick={save} loading={createProject.isPending || updateProject.isPending}>Save Project</Button>
        </div>
      </Modal>
    </div>
  )
}
