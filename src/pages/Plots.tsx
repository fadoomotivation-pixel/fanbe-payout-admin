import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { Table } from '@/components/ui/Table.tsx'
import { Button } from '@/components/ui/Button.tsx'
import { Input, Select } from '@/components/ui/Input.tsx'
import { Modal } from '@/components/ui/Modal.tsx'
import { Badge } from '@/components/ui/Badge.tsx'
import { formatINR } from '@/lib/utils'
import { LayoutGrid, Info } from 'lucide-react'
import toast from 'react-hot-toast'

const STATUS_COLORS: Record<string, string> = {
  available: 'bg-green-100 text-green-700',
  token: 'bg-amber-100 text-amber-700',
  booked: 'bg-blue-100 text-blue-700',
  cancelled: 'bg-red-100 text-red-700',
  sold: 'bg-purple-100 text-purple-700',
}

export default function Plots() {
  const qc = useQueryClient()
  const [projectFilter, setProjectFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')

  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: async () => {
      const { data, error } = await supabase.from('bp_projects').select('id,name,location').order('name')
      if (error) throw error
      return data
    },
  })

  const { data: plots = [], isLoading } = useQuery({
    queryKey: ['plots', projectFilter, statusFilter],
    queryFn: async () => {
      let q = supabase
        .from('bp_plots')
        .select('*, bp_projects(name, location)')
        .order('plot_no', { ascending: true })
      if (projectFilter) q = q.eq('project_id', projectFilter)
      if (statusFilter) q = q.eq('status', statusFilter)
      const { data, error } = await q
      if (error) throw error
      return data
    },
  })

  const allPlots = plots as any[]
  const availableCount = allPlots.filter(p => p.status === 'available').length
  const tokenCount = allPlots.filter(p => p.status === 'token').length
  const bookedCount = allPlots.filter(p => p.status === 'booked').length
  const cancelledCount = allPlots.filter(p => p.status === 'cancelled').length

  const updatePlot = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: any }) => {
      const { data: d, error } = await supabase
        .from('bp_plots')
        .update({ ...data, updated_at: new Date().toISOString() })
        .eq('id', id).select().single()
      if (error) throw error
      return d
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['plots'] })
      qc.invalidateQueries({ queryKey: ['plots_avail'] })
      toast.success('Plot updated')
    },
    onError: (e: any) => toast.error(e.message),
  })

  const [modal, setModal] = useState(false)
  const [editing, setEditing] = useState<any>(null)
  const [form, setForm] = useState<any>({})
  const set = (k: string, v: any) => setForm((prev: any) => ({ ...prev, [k]: v }))

  const openEdit = (p: any) => {
    setEditing(p)
    setForm({
      project_id: p.project_id || '',
      plot_no: p.plot_no || '',
      size_sqyd: p.size_sqyd ?? '',
      price_per_sqyd: p.price_per_sqyd ?? '',
      plc_charges: p.plc_charges ?? '',
      total_price: p.total_price ?? '',
      status: p.status || 'available',
    })
    setModal(true)
  }

  const save = async () => {
    if (!editing) return
    const payload = {
      project_id: form.project_id || null,
      plot_no: form.plot_no || null,
      size_sqyd: form.size_sqyd !== '' ? parseFloat(form.size_sqyd) : null,
      price_per_sqyd: form.price_per_sqyd !== '' ? parseFloat(form.price_per_sqyd) : null,
      plc_charges: form.plc_charges !== '' ? parseFloat(form.plc_charges) : 0,
      total_price: form.total_price !== '' ? parseFloat(form.total_price) : null,
      status: form.status,
    }
    await updatePlot.mutateAsync({ id: editing.id, data: payload })
    setModal(false)
  }

  const cols = [
    { header: 'Plot No', render: (r: any) => <span className="font-bold text-gray-900">#{r.plot_no || '—'}</span> },
    {
      header: 'Project',
      render: (r: any) => (
        <div>
          <span className="font-medium text-xs text-gray-700">{r.bp_projects?.name || '—'}</span>
          {r.bp_projects?.location && <span className="ml-1 text-xs text-gray-400">· {r.bp_projects.location}</span>}
        </div>
      ),
    },
    { header: 'Size (sqyd)', render: (r: any) => r.size_sqyd ? Number(r.size_sqyd).toLocaleString('en-IN') : '—' },
    { header: 'Rate / sqyd', render: (r: any) => r.price_per_sqyd ? formatINR(r.price_per_sqyd) : '—' },
    { header: 'PLC', render: (r: any) => r.plc_charges ? formatINR(r.plc_charges) : '—' },
    { header: 'Total Price', render: (r: any) => r.total_price ? formatINR(r.total_price) : '—' },
    {
      header: 'Status',
      render: (r: any) => (
        <Badge label={r.status || 'available'} className={STATUS_COLORS[r.status] || 'bg-gray-100 text-gray-600'} />
      ),
    },
    { header: '', render: (r: any) => <Button size="sm" variant="ghost" onClick={() => openEdit(r)}>Edit</Button> },
  ]

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-green-50 rounded-lg"><LayoutGrid size={20} className="text-green-600" /></div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">Plots</h1>
            <p className="text-sm text-gray-500">{allPlots.length} plots</p>
          </div>
        </div>
      </div>

      <div className="mb-5 flex items-start gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-900">
        <Info size={16} className="mt-0.5 shrink-0" />
        <div>
          New plots are created from the <Link to="/projects" className="font-semibold underline">Projects</Link> page using the bulk plot generator.
          This page is for editing or updating existing plots only.
        </div>
      </div>

      <div className="grid grid-cols-5 gap-4 mb-6">
        {[
          { label: 'Total', value: allPlots.length, color: 'bg-gray-50 text-gray-700' },
          { label: 'Available', value: availableCount, color: 'bg-green-50 text-green-700' },
          { label: 'Token', value: tokenCount, color: 'bg-amber-50 text-amber-700' },
          { label: 'Booked', value: bookedCount, color: 'bg-blue-50 text-blue-700' },
          { label: 'Cancelled', value: cancelledCount, color: 'bg-red-50 text-red-700' },
        ].map(s => (
          <div key={s.label} className={`rounded-xl p-4 ${s.color}`}>
            <p className="text-2xl font-bold">{s.value}</p>
            <p className="text-xs mt-0.5 font-medium opacity-70">{s.label}</p>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm">
        <div className="p-4 border-b border-gray-100 flex gap-3">
          <select value={projectFilter} onChange={e => setProjectFilter(e.target.value)} className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300">
            <option value="">All Projects</option>
            {(projects as any[]).map((p: any) => <option key={p.id} value={p.id}>{p.name}{p.location ? ` · ${p.location}` : ''}</option>)}
          </select>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300">
            <option value="">All Status</option>
            <option value="available">Available</option>
            <option value="token">Token</option>
            <option value="booked">Booked</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>
        <Table columns={cols} data={plots} loading={isLoading} />
      </div>

      <Modal open={modal} onClose={() => setModal(false)} title={`Edit Plot #${editing?.plot_no ?? ''}`}>
        <div className="grid grid-cols-2 gap-4">
          <Select label="Project" value={form.project_id} onChange={(e: any) => set('project_id', e.target.value)} className="col-span-2">
            <option value="">Select Project</option>
            {(projects as any[]).map((p: any) => <option key={p.id} value={p.id}>{p.name}{p.location ? ` · ${p.location}` : ''}</option>)}
          </Select>
          <Input label="Plot No" value={form.plot_no} onChange={(e: any) => set('plot_no', e.target.value)} required />
          <Input label="Size (sqyd)" type="number" value={form.size_sqyd} onChange={(e: any) => set('size_sqyd', e.target.value)} />
          <Input label="Rate per sqyd (₹)" type="number" value={form.price_per_sqyd} onChange={(e: any) => set('price_per_sqyd', e.target.value)} />
          <Input label="PLC Charges (₹)" type="number" value={form.plc_charges} onChange={(e: any) => set('plc_charges', e.target.value)} placeholder="0" />
          <Input label="Total Price (₹)" type="number" value={form.total_price} onChange={(e: any) => set('total_price', e.target.value)} />
          <Select label="Status" value={form.status} onChange={(e: any) => set('status', e.target.value)}>
            <option value="available">Available</option>
            <option value="token">Token</option>
            <option value="booked">Booked</option>
            <option value="cancelled">Cancelled</option>
          </Select>
        </div>
        <div className="flex justify-end gap-2 mt-6">
          <Button variant="secondary" onClick={() => setModal(false)}>Cancel</Button>
          <Button onClick={save} loading={updatePlot.isPending}>Save Changes</Button>
        </div>
      </Modal>
    </div>
  )
}
