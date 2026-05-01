import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { Table } from '@/components/ui/Table.tsx'
import { Button } from '@/components/ui/Button.tsx'
import { Input, Select } from '@/components/ui/Input.tsx'
import { Modal } from '@/components/ui/Modal.tsx'
import { Badge } from '@/components/ui/Badge.tsx'
import { Building2, Plus, Layers } from 'lucide-react'
import toast from 'react-hot-toast'

const EMPTY_PROJECT = {
  project_code: '', project_name: '', state: '', city: '', image_url: '', is_active: true,
}

const EMPTY_BULK = {
  number_of_plots: '', property_type: '', sector: '', dimension: '', area: '', total_cost: '', sqft_rate: '',
}

export default function Projects() {
  const qc = useQueryClient()

  // ── Queries ──────────────────────────────────────────────────────
  const { data: projects = [], isLoading } = useQuery({
    queryKey: ['projects'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('projects')
        .select('*, plots(count)')
        .order('created_at', { ascending: false })
      if (error) throw error
      return data
    },
  })

  // ── Mutations ─────────────────────────────────────────────────────
  const createProject = useMutation({
    mutationFn: async (p: any) => {
      const { data, error } = await supabase.from('projects').insert(p).select().single()
      if (error) throw error
      return data
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['projects'] }); toast.success('Project created') },
    onError: (e: any) => toast.error(e.message),
  })

  const updateProject = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: any }) => {
      const { data: d, error } = await supabase.from('projects').update({ ...data, updated_at: new Date().toISOString() }).eq('id', id).select().single()
      if (error) throw error
      return d
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['projects'] }); toast.success('Project updated') },
    onError: (e: any) => toast.error(e.message),
  })

  const bulkGeneratePlots = useMutation({
    mutationFn: async ({ projectId, bulk }: { projectId: string; bulk: typeof EMPTY_BULK }) => {
      const count = parseInt(bulk.number_of_plots)
      if (!count || count < 1 || count > 500) throw new Error('Enter between 1 and 500 plots')
      // Check existing max plot_number for this project
      const { data: existing } = await supabase
        .from('plots')
        .select('plot_number')
        .eq('project_id', projectId)
        .order('plot_number', { ascending: false })
        .limit(1)
      const startFrom = existing && existing.length > 0 ? existing[0].plot_number + 1 : 1
      // Build rows descending in insert order (highest first per blueprint)
      const rows = Array.from({ length: count }, (_, i) => ({
        project_id: projectId,
        plot_number: startFrom + (count - 1 - i),
        property_type: bulk.property_type || null,
        sector: bulk.sector || null,
        dimension: bulk.dimension || null,
        area: bulk.area ? parseFloat(bulk.area) : null,
        total_cost: bulk.total_cost ? parseFloat(bulk.total_cost) : null,
        sqft_rate: bulk.sqft_rate ? parseFloat(bulk.sqft_rate) : null,
        status: 'vacant',
      }))
      const { error } = await supabase.from('plots').insert(rows)
      if (error) throw error
      return count
    },
    onSuccess: (count) => {
      qc.invalidateQueries({ queryKey: ['projects'] })
      qc.invalidateQueries({ queryKey: ['plots'] })
      toast.success(`${count} plots generated successfully`)
      setBulkModal(false)
      setBulk(EMPTY_BULK)
    },
    onError: (e: any) => toast.error(e.message),
  })

  // ── Local State ───────────────────────────────────────────────────
  const [modal, setModal] = useState(false)
  const [editing, setEditing] = useState<any>(null)
  const [form, setForm] = useState<any>(EMPTY_PROJECT)
  const [bulkModal, setBulkModal] = useState(false)
  const [bulkTargetProject, setBulkTargetProject] = useState<any>(null)
  const [bulk, setBulk] = useState<any>(EMPTY_BULK)

  const openCreate = () => { setEditing(null); setForm(EMPTY_PROJECT); setModal(true) }
  const openEdit = (p: any) => {
    setEditing(p)
    setForm({ project_code: p.project_code, project_name: p.project_name, state: p.state || '', city: p.city || '', image_url: p.image_url || '', is_active: p.is_active })
    setModal(true)
  }
  const openBulk = (p: any) => { setBulkTargetProject(p); setBulk(EMPTY_BULK); setBulkModal(true) }
  const set = (k: string, v: any) => setForm((prev: any) => ({ ...prev, [k]: v }))
  const setBulkField = (k: string, v: any) => setBulk((prev: any) => ({ ...prev, [k]: v }))

  const save = async () => {
    editing
      ? await updateProject.mutateAsync({ id: editing.id, data: form })
      : await createProject.mutateAsync(form)
    setModal(false)
  }

  // ── Table columns ─────────────────────────────────────────────────
  const cols = [
    {
      header: 'Code',
      render: (r: any) => (
        <span className="font-mono font-bold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded text-xs">{r.project_code}</span>
      ),
    },
    { header: 'Project Name', render: (r: any) => <span className="font-semibold text-gray-900">{r.project_name}</span> },
    { header: 'State', key: 'state' },
    { header: 'City', key: 'city' },
    {
      header: 'Total Plots',
      render: (r: any) => {
        const cnt = r.plots?.[0]?.count ?? 0
        return <span className="font-semibold text-gray-700">{cnt}</span>
      },
    },
    {
      header: 'Status',
      render: (r: any) => (
        <Badge label={r.is_active ? 'Active' : 'Inactive'}
          className={r.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'} />
      ),
    },
    {
      header: '',
      render: (r: any) => (
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={() => openBulk(r)}>
            <Layers size={13} /> Add Plots
          </Button>
          <Button size="sm" variant="ghost" onClick={() => openEdit(r)}>Edit</Button>
        </div>
      ),
    },
  ]

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-indigo-50 rounded-lg"><Building2 size={20} className="text-indigo-600" /></div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">Projects</h1>
            <p className="text-sm text-gray-500">{(projects as any[]).length} projects</p>
          </div>
        </div>
        <Button onClick={openCreate}><Plus size={14} />New Project</Button>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm">
        <Table columns={cols} data={projects} loading={isLoading} />
      </div>

      {/* ── Create / Edit Project Modal ── */}
      <Modal open={modal} onClose={() => setModal(false)} title={editing ? 'Edit Project' : 'New Project'}>
        <div className="grid grid-cols-2 gap-4">
          <Input
            label="Project Code (max 6 chars)"
            value={form.project_code}
            onChange={(e: any) => set('project_code', e.target.value.toUpperCase().slice(0, 6))}
            required
          />
          <Input
            label="Project Name"
            value={form.project_name}
            onChange={(e: any) => set('project_name', e.target.value)}
            required
            className="col-span-1"
          />
          <Input label="State" value={form.state} onChange={(e: any) => set('state', e.target.value)} />
          <Input label="City" value={form.city} onChange={(e: any) => set('city', e.target.value)} />
          <Input
            label="Image URL (optional)"
            value={form.image_url}
            onChange={(e: any) => set('image_url', e.target.value)}
            className="col-span-2"
          />
          <Select label="Status" value={form.is_active ? 'true' : 'false'} onChange={(e: any) => set('is_active', e.target.value === 'true')}>
            <option value="true">Active</option>
            <option value="false">Inactive</option>
          </Select>
        </div>
        <div className="flex justify-end gap-2 mt-6">
          <Button variant="secondary" onClick={() => setModal(false)}>Cancel</Button>
          <Button onClick={save} loading={createProject.isPending || updateProject.isPending}>Save Project</Button>
        </div>
      </Modal>

      {/* ── Bulk Plot Generator Modal ── */}
      <Modal open={bulkModal} onClose={() => setBulkModal(false)} title={`Generate Plots — ${bulkTargetProject?.project_name || ''}`}>
        <p className="text-sm text-gray-500 mb-4">
          Enter the number of plots and shared attributes. The system will auto-generate
          individual plot entries in descending order.
        </p>
        <div className="grid grid-cols-2 gap-4">
          <Input
            label="Number of Plots *"
            type="number"
            min={1}
            max={500}
            value={bulk.number_of_plots}
            onChange={(e: any) => setBulkField('number_of_plots', e.target.value)}
            className="col-span-2"
            required
          />
          <Input label="Property Type" value={bulk.property_type} onChange={(e: any) => setBulkField('property_type', e.target.value)} placeholder="e.g. Residential" />
          <Input label="Sector" value={bulk.sector} onChange={(e: any) => setBulkField('sector', e.target.value)} placeholder="e.g. A" />
          <Input label="Dimension" value={bulk.dimension} onChange={(e: any) => setBulkField('dimension', e.target.value)} placeholder="e.g. 30x40" />
          <Input label="Area (sqft)" type="number" value={bulk.area} onChange={(e: any) => setBulkField('area', e.target.value)} />
          <Input label="Total Cost (₹)" type="number" value={bulk.total_cost} onChange={(e: any) => setBulkField('total_cost', e.target.value)} />
          <Input label="Sqft Rate (₹)" type="number" value={bulk.sqft_rate} onChange={(e: any) => setBulkField('sqft_rate', e.target.value)} />
        </div>
        {bulk.number_of_plots > 0 && (
          <div className="mt-4 p-3 bg-indigo-50 rounded-lg text-sm text-indigo-700">
            ⚡ Will generate <strong>{bulk.number_of_plots}</strong> plots for <strong>{bulkTargetProject?.project_name}</strong>, all set to <strong>Vacant</strong>.
          </div>
        )}
        <div className="flex justify-end gap-2 mt-6">
          <Button variant="secondary" onClick={() => setBulkModal(false)}>Cancel</Button>
          <Button
            onClick={() => bulkGeneratePlots.mutate({ projectId: bulkTargetProject?.id, bulk })}
            loading={bulkGeneratePlots.isPending}
            disabled={!bulk.number_of_plots}
          >
            <Layers size={14} /> Generate Plots
          </Button>
        </div>
      </Modal>
    </div>
  )
}
