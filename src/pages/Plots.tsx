import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { Table } from '@/components/ui/Table.tsx'
import { Button } from '@/components/ui/Button.tsx'
import { Input, Select } from '@/components/ui/Input.tsx'
import { Modal } from '@/components/ui/Modal.tsx'
import { Badge } from '@/components/ui/Badge.tsx'
import { formatINR } from '@/lib/utils'
import { LayoutGrid, Plus, Layers } from 'lucide-react'
import toast from 'react-hot-toast'

const STATUS_COLORS: Record<string, string> = {
  vacant: 'bg-green-100 text-green-700',
  booked: 'bg-blue-100 text-blue-700',
  cancelled: 'bg-red-100 text-red-700',
}

export default function Plots() {
  const qc = useQueryClient()
  const [projectFilter, setProjectFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')

  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: async () => {
      const { data, error } = await supabase.from('projects').select('id,project_name,project_code').order('project_name')
      if (error) throw error
      return data
    },
  })

  const { data: plots = [], isLoading } = useQuery({
    queryKey: ['plots', projectFilter, statusFilter],
    queryFn: async () => {
      let q = supabase
        .from('plots')
        .select('*, projects(project_name, project_code)')
        .order('plot_number', { ascending: true })
      if (projectFilter) q = q.eq('project_id', projectFilter)
      if (statusFilter) q = q.eq('status', statusFilter)
      const { data, error } = await q
      if (error) throw error
      return data
    },
  })

  const allPlots = plots as any[]
  const vacantCount = allPlots.filter(p => p.status === 'vacant').length
  const bookedCount = allPlots.filter(p => p.status === 'booked').length
  const cancelledCount = allPlots.filter(p => p.status === 'cancelled').length

  const updatePlot = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: any }) => {
      const { data: d, error } = await supabase
        .from('plots')
        .update({ ...data, updated_at: new Date().toISOString() })
        .eq('id', id).select().single()
      if (error) throw error
      return d
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['plots'] }); toast.success('Plot updated') },
    onError: (e: any) => toast.error(e.message),
  })

  const createPlot = useMutation({
    mutationFn: async (p: any) => {
      const { data, error } = await supabase.from('plots').insert(p).select().single()
      if (error) throw error
      return data
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['plots'] }); toast.success('Plot added') },
    onError: (e: any) => toast.error(e.message),
  })

  const bulkCreate = useMutation({
    mutationFn: async (rows: any[]) => {
      const { data, error } = await supabase.from('plots').insert(rows).select()
      if (error) throw error
      return data
    },
    onSuccess: (rows) => { qc.invalidateQueries({ queryKey: ['plots'] }); toast.success(`${rows?.length || 0} plots added`) },
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
      plot_number: p.plot_number || '',
      property_type: p.property_type || '',
      sector: p.sector || '',
      dimension: p.dimension || '',
      area: p.area ?? '',
      total_cost: p.total_cost ?? '',
      sqft_rate: p.sqft_rate ?? '',
      status: p.status,
    })
    setModal(true)
  }

  const openAdd = () => {
    setEditing(null)
    setForm({
      project_id: projectFilter || (projects as any[])[0]?.id || '',
      plot_number: '', property_type: 'Residential', sector: '',
      dimension: '', area: '', total_cost: '', sqft_rate: '', status: 'vacant',
    })
    setModal(true)
  }

  const save = async () => {
    const payload = {
      ...form,
      area: form.area !== '' ? parseFloat(form.area) : null,
      total_cost: form.total_cost !== '' ? parseFloat(form.total_cost) : null,
      sqft_rate: form.sqft_rate !== '' ? parseFloat(form.sqft_rate) : null,
    }
    if (editing) await updatePlot.mutateAsync({ id: editing.id, data: payload })
    else await createPlot.mutateAsync(payload)
    setModal(false)
  }

  // ── Bulk Add ──
  const [bulkModal, setBulkModal] = useState(false)
  const [bulk, setBulk] = useState<any>({
    project_id: '', prefix: 'A', start_no: 1, count: 10, property_type: 'Residential',
    sector: '', dimension: '30x60', area: 1800, sqft_rate: 1500, status: 'vacant',
  })
  const setB = (k: string, v: any) => setBulk((p: any) => ({ ...p, [k]: v }))

  const runBulk = async () => {
    if (!bulk.project_id) return toast.error('Select a project')
    const start = parseInt(bulk.start_no, 10) || 1
    const count = Math.min(parseInt(bulk.count, 10) || 0, 500)
    if (count <= 0) return toast.error('Count must be >0')
    const area = parseFloat(bulk.area) || 0
    const rate = parseFloat(bulk.sqft_rate) || 0
    const rows = Array.from({ length: count }, (_, i) => ({
      project_id: bulk.project_id,
      plot_number: `${bulk.prefix}${start + i}`,
      property_type: bulk.property_type,
      sector: bulk.sector || null,
      dimension: bulk.dimension || null,
      area: area || null,
      sqft_rate: rate || null,
      total_cost: area && rate ? area * rate : null,
      status: bulk.status,
    }))
    await bulkCreate.mutateAsync(rows)
    setBulkModal(false)
  }

  const cols = [
    { header: 'Plot No', render: (r: any) => <span className="font-bold text-gray-900">#{r.plot_number}</span> },
    {
      header: 'Project',
      render: (r: any) => (
        <div>
          <span className="font-medium text-xs text-gray-700">{r.projects?.project_name}</span>
          <span className="ml-1 text-xs text-gray-400 font-mono">[{r.projects?.project_code}]</span>
        </div>
      ),
    },
    { header: 'Type', render: (r: any) => r.property_type || '—' },
    { header: 'Sector', render: (r: any) => r.sector || '—' },
    { header: 'Dimension', render: (r: any) => r.dimension || '—' },
    { header: 'Area (sqft)', render: (r: any) => r.area ? r.area.toLocaleString('en-IN') : '—' },
    { header: 'Total Cost', render: (r: any) => r.total_cost ? formatINR(r.total_cost) : '—' },
    {
      header: 'Status',
      render: (r: any) => (
        <Badge label={r.status} className={STATUS_COLORS[r.status] || 'bg-gray-100 text-gray-600'} />
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
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setBulkModal(true)}><Layers size={14} />Bulk Add</Button>
          <Button onClick={openAdd}><Plus size={14} />Add Plot</Button>
        </div>
      </div>

      <div className="grid grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Total', value: allPlots.length, color: 'bg-gray-50 text-gray-700' },
          { label: 'Vacant', value: vacantCount, color: 'bg-green-50 text-green-700' },
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
            {(projects as any[]).map((p: any) => <option key={p.id} value={p.id}>{p.project_name} [{p.project_code}]</option>)}
          </select>
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300">
            <option value="">All Status</option>
            <option value="vacant">Vacant</option>
            <option value="booked">Booked</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>
        <Table columns={cols} data={plots} loading={isLoading} />
      </div>

      <Modal open={modal} onClose={() => setModal(false)} title={editing ? `Edit Plot #${editing?.plot_number}` : 'Add Plot'}>
        <div className="grid grid-cols-2 gap-4">
          <Select label="Project" value={form.project_id} onChange={(e: any) => set('project_id', e.target.value)} className="col-span-2">
            <option value="">Select Project</option>
            {(projects as any[]).map((p: any) => <option key={p.id} value={p.id}>{p.project_name} [{p.project_code}]</option>)}
          </Select>
          <Input label="Plot Number" value={form.plot_number} onChange={(e: any) => set('plot_number', e.target.value)} required />
          <Input label="Property Type" value={form.property_type} onChange={(e: any) => set('property_type', e.target.value)} />
          <Input label="Sector" value={form.sector} onChange={(e: any) => set('sector', e.target.value)} />
          <Input label="Dimension" value={form.dimension} onChange={(e: any) => set('dimension', e.target.value)} placeholder="e.g. 30x60" />
          <Input label="Area (sqft)" type="number" value={form.area} onChange={(e: any) => set('area', e.target.value)} />
          <Input label="Sqft Rate (₹)" type="number" value={form.sqft_rate} onChange={(e: any) => set('sqft_rate', e.target.value)} />
          <Input label="Total Cost (₹)" type="number" value={form.total_cost} onChange={(e: any) => set('total_cost', e.target.value)} />
          <Select label="Status" value={form.status} onChange={(e: any) => set('status', e.target.value)}>
            <option value="vacant">Vacant</option>
            <option value="booked">Booked</option>
            <option value="cancelled">Cancelled</option>
          </Select>
        </div>
        <div className="flex justify-end gap-2 mt-6">
          <Button variant="secondary" onClick={() => setModal(false)}>Cancel</Button>
          <Button onClick={save} loading={updatePlot.isPending || createPlot.isPending}>{editing ? 'Save Changes' : 'Create Plot'}</Button>
        </div>
      </Modal>

      <Modal open={bulkModal} onClose={() => setBulkModal(false)} title="Bulk Add Plots">
        <p className="text-xs text-gray-500 mb-4">Generates a contiguous run of plots in one project. e.g. prefix "A", start 1, count 10 → A1, A2 … A10.</p>
        <div className="grid grid-cols-2 gap-4">
          <Select label="Project" value={bulk.project_id} onChange={(e: any) => setB('project_id', e.target.value)} className="col-span-2">
            <option value="">Select Project</option>
            {(projects as any[]).map((p: any) => <option key={p.id} value={p.id}>{p.project_name} [{p.project_code}]</option>)}
          </Select>
          <Input label="Plot No Prefix" value={bulk.prefix} onChange={(e: any) => setB('prefix', e.target.value)} placeholder="A" />
          <Input label="Start Number" type="number" value={bulk.start_no} onChange={(e: any) => setB('start_no', e.target.value)} />
          <Input label="Count (max 500)" type="number" value={bulk.count} onChange={(e: any) => setB('count', e.target.value)} />
          <Input label="Property Type" value={bulk.property_type} onChange={(e: any) => setB('property_type', e.target.value)} />
          <Input label="Sector" value={bulk.sector} onChange={(e: any) => setB('sector', e.target.value)} />
          <Input label="Dimension" value={bulk.dimension} onChange={(e: any) => setB('dimension', e.target.value)} />
          <Input label="Default Area (sqft)" type="number" value={bulk.area} onChange={(e: any) => setB('area', e.target.value)} />
          <Input label="Sqft Rate (₹)" type="number" value={bulk.sqft_rate} onChange={(e: any) => setB('sqft_rate', e.target.value)} />
          <Select label="Initial Status" value={bulk.status} onChange={(e: any) => setB('status', e.target.value)}>
            <option value="vacant">Vacant</option>
            <option value="booked">Booked</option>
          </Select>
        </div>
        {bulk.area && bulk.sqft_rate && (
          <div className="mt-3 p-3 bg-blue-50 rounded-lg text-xs text-blue-700">
            Each plot total: <b>{formatINR((parseFloat(bulk.area) || 0) * (parseFloat(bulk.sqft_rate) || 0))}</b>
            {' · '}Total inventory value: <b>{formatINR((parseFloat(bulk.area) || 0) * (parseFloat(bulk.sqft_rate) || 0) * (parseInt(bulk.count, 10) || 0))}</b>
          </div>
        )}
        <div className="flex justify-end gap-2 mt-6">
          <Button variant="secondary" onClick={() => setBulkModal(false)}>Cancel</Button>
          <Button onClick={runBulk} loading={bulkCreate.isPending}>Generate {bulk.count || 0} plots</Button>
        </div>
      </Modal>
    </div>
  )
}
