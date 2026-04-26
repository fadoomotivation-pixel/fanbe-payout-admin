import { useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { queryClient } from '../../lib/queryClient'
import { formatINR } from '../../lib/utils'
import LoadingSpinner from '../../components/ui/LoadingSpinner'
import Modal from '../../components/ui/Modal'
import toast from 'react-hot-toast'
import { MapPin, TrendingUp, Edit2, Save, Filter, LayoutGrid, List } from 'lucide-react'

const STATUS_COLORS = {
  available: 'bg-green-100 text-green-700',
  booked: 'bg-blue-100 text-blue-700',
  reserved: 'bg-yellow-100 text-yellow-800',
  sold: 'bg-slate-100 text-slate-600',
  blocked: 'bg-red-100 text-red-700',
  registry_done: 'bg-purple-100 text-purple-700',
}

const STATUS_GRID = {
  available: 'bg-green-400',
  booked: 'bg-blue-400',
  reserved: 'bg-yellow-400',
  sold: 'bg-slate-400',
  blocked: 'bg-red-400',
  registry_done: 'bg-purple-400',
}

const PLC_PRESETS = [
  { label: 'Corner Plot', key: 'corner', pct: 5 },
  { label: 'Park Facing', key: 'park_facing', pct: 8 },
  { label: 'Main Road', key: 'main_road', pct: 10 },
  { label: 'East Facing', key: 'east_facing', pct: 3 },
  { label: 'Wide Road', key: 'wide_road', pct: 6 },
]

export default function InventoryPricing() {
  const [projectFilter, setProjectFilter] = useState('all')
  const [sectorFilter, setSectorFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [viewMode, setViewMode] = useState('table') // table | grid
  const [editOpen, setEditOpen] = useState(false)
  const [plcOpen, setPlcOpen] = useState(false)
  const [bulkOpen, setBulkOpen] = useState(false)
  const [selectedPlot, setSelectedPlot] = useState(null)
  const [editForm, setEditForm] = useState({ rate_per_sqyd: '', status: '' })
  const [plcForm, setPlcForm] = useState({ corner: false, park_facing: false, main_road: false, east_facing: false, wide_road: false })
  const [bulkForm, setBulkForm] = useState({ sector: '', rate_per_sqyd: '', project_id: '' })

  const { data: projects = [] } = useQuery({
    queryKey: ['projects-list'],
    queryFn: async () => {
      const { data } = await supabase.from('bp_projects').select('id, name').order('name')
      return data || []
    },
  })

  const { data: plots = [], isLoading } = useQuery({
    queryKey: ['inventory-pricing', projectFilter, sectorFilter, statusFilter],
    queryFn: async () => {
      let q = supabase
        .from('bp_plots')
        .select('*, bp_projects(name)')
        .order('plot_no')
      if (projectFilter !== 'all') q = q.eq('project_id', projectFilter)
      if (sectorFilter !== 'all') q = q.eq('sector', sectorFilter)
      if (statusFilter !== 'all') q = q.eq('status', statusFilter)
      const { data } = await q
      return data || []
    },
  })

  const sectors = [...new Set(plots.map(p => p.sector).filter(Boolean))]

  const editMutation = useMutation({
    mutationFn: async () => {
      const rate = parseFloat(editForm.rate_per_sqyd)
      const area = selectedPlot.area_sqyd || 0
      const plcPct = PLC_PRESETS.filter(p => plcForm[p.key]).reduce((s, p) => s + p.pct, 0)
      const basePrice = Math.round(rate * area)
      const plcAmount = Math.round(basePrice * plcPct / 100)
      const total = basePrice + plcAmount

      const { error } = await supabase.from('bp_plots').update({
        rate_per_sqyd: rate,
        total_price: total,
        plc_amount: plcAmount,
        plc_tags: PLC_PRESETS.filter(p => plcForm[p.key]).map(p => p.key),
        status: editForm.status || selectedPlot.status,
        updated_at: new Date().toISOString(),
      }).eq('id', selectedPlot.id)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory-pricing'] })
      toast.success('Plot updated')
      setEditOpen(false)
    },
    onError: (e) => toast.error(e.message),
  })

  const bulkMutation = useMutation({
    mutationFn: async () => {
      let q = supabase.from('bp_plots')
      if (bulkForm.project_id) q = q.eq('project_id', bulkForm.project_id)
      if (bulkForm.sector) q = q.eq('sector', bulkForm.sector)
      const { data: targetPlots } = await q.select('id, area_sqyd')
      if (!targetPlots?.length) throw new Error('No plots matched')
      const rate = parseFloat(bulkForm.rate_per_sqyd)
      const updates = targetPlots.map(p => ({
        id: p.id,
        rate_per_sqyd: rate,
        total_price: Math.round(rate * (p.area_sqyd || 0)),
      }))
      for (const u of updates) {
        await supabase.from('bp_plots').update({ rate_per_sqyd: u.rate_per_sqyd, total_price: u.total_price }).eq('id', u.id)
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory-pricing'] })
      toast.success('Bulk pricing applied')
      setBulkOpen(false)
      setBulkForm({ sector: '', rate_per_sqyd: '', project_id: '' })
    },
    onError: (e) => toast.error(e.message),
  })

  const availableCount = plots.filter(p => p.status === 'available').length
  const bookedCount = plots.filter(p => ['booked', 'sold', 'registry_done'].includes(p.status)).length
  const totalValue = plots.filter(p => p.status === 'available').reduce((s, p) => s + (p.total_price || 0), 0)

  const openEdit = (plot) => {
    setSelectedPlot(plot)
    setEditForm({ rate_per_sqyd: plot.rate_per_sqyd || '', status: plot.status || 'available' })
    const tags = plot.plc_tags || []
    setPlcForm({ corner: tags.includes('corner'), park_facing: tags.includes('park_facing'), main_road: tags.includes('main_road'), east_facing: tags.includes('east_facing'), wide_road: tags.includes('wide_road') })
    setEditOpen(true)
  }

  const plcPct = PLC_PRESETS.filter(p => plcForm[p.key]).reduce((s, p) => s + p.pct, 0)
  const basePreview = parseFloat(editForm.rate_per_sqyd || 0) * (selectedPlot?.area_sqyd || 0)
  const plcPreview = Math.round(basePreview * plcPct / 100)
  const totalPreview = basePreview + plcPreview

  if (isLoading) return <LoadingSpinner fullPage />

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="page-title">Inventory Pricing Engine</h1>
          <p className="text-sm text-slate-500 mt-0.5">PLC logic, sector pricing &amp; availability states</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => setBulkOpen(true)} className="btn-secondary text-sm">Bulk Rate Update</button>
          <button onClick={() => setViewMode(v => v === 'table' ? 'grid' : 'table')} className="btn-secondary text-sm">
            {viewMode === 'table' ? <LayoutGrid size={14} /> : <List size={14} />}
            {viewMode === 'table' ? ' Grid' : ' Table'}
          </button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Total Plots', value: plots.length },
          { label: 'Available', value: availableCount, color: 'text-green-700' },
          { label: 'Sold / Booked', value: bookedCount, color: 'text-blue-700' },
          { label: 'Available Value', value: formatINR(totalValue), color: 'text-teal-700' },
        ].map(({ label, value, color }) => (
          <div key={label} className="card p-4">
            <p className="text-xs text-slate-500">{label}</p>
            <p className={`text-lg font-bold mt-0.5 ${color || 'text-slate-800'}`}>{value}</p>
          </div>
        ))}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <select className="input w-auto" value={projectFilter} onChange={e => setProjectFilter(e.target.value)}>
          <option value="all">All Projects</option>
          {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select className="input w-auto" value={sectorFilter} onChange={e => setSectorFilter(e.target.value)}>
          <option value="all">All Sectors</option>
          {sectors.map(s => <option key={s} value={s}>Sector {s}</option>)}
        </select>
        <select className="input w-auto" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          <option value="all">All Status</option>
          {Object.keys(STATUS_COLORS).map(s => (
            <option key={s} value={s}>{s.replace('_', ' ')}</option>
          ))}
        </select>
      </div>

      {viewMode === 'grid' ? (
        <div>
          <div className="flex gap-3 mb-3 flex-wrap">
            {Object.entries(STATUS_GRID).map(([s, cls]) => (
              <div key={s} className="flex items-center gap-1.5 text-xs text-slate-600">
                <div className={`w-3 h-3 rounded-sm ${cls}`} />
                <span className="capitalize">{s.replace('_', ' ')}</span>
              </div>
            ))}
          </div>
          <div className="grid grid-cols-6 sm:grid-cols-10 md:grid-cols-16 gap-1.5">
            {plots.map(p => (
              <button
                key={p.id}
                onClick={() => openEdit(p)}
                title={`Plot ${p.plot_no} — ${p.status} — ${formatINR(p.total_price)}`}
                className={`h-10 w-full rounded text-xs font-semibold text-white transition-opacity hover:opacity-80 ${STATUS_GRID[p.status] || 'bg-slate-300'}`}
              >
                {p.plot_no}
              </button>
            ))}
          </div>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                {['Plot No', 'Project', 'Sector', 'Area (SqYd)', 'Rate/SqYd', 'PLC', 'Total Price', 'Status', 'Edit'].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-slate-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {plots.map(p => (
                <tr key={p.id} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium">{p.plot_no}</td>
                  <td className="px-4 py-3 text-slate-500">{p.bp_projects?.name}</td>
                  <td className="px-4 py-3 text-slate-500">{p.sector || '—'}</td>
                  <td className="px-4 py-3">{p.area_sqyd}</td>
                  <td className="px-4 py-3">{p.rate_per_sqyd ? formatINR(p.rate_per_sqyd) : '—'}</td>
                  <td className="px-4 py-3">
                    {p.plc_tags?.length > 0 ? (
                      <span className="inline-flex px-2 py-0.5 rounded-full text-xs bg-indigo-50 text-indigo-700">
                        +{p.plc_tags.length} PLC
                      </span>
                    ) : '—'}
                  </td>
                  <td className="px-4 py-3 font-semibold">{p.total_price ? formatINR(p.total_price) : '—'}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium capitalize ${STATUS_COLORS[p.status] || 'bg-slate-100 text-slate-600'}`}>
                      {p.status?.replace('_', ' ')}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <button onClick={() => openEdit(p)} className="p-1.5 rounded hover:bg-slate-100 text-slate-500">
                      <Edit2 size={13} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Edit / PLC Modal */}
      <Modal open={editOpen} onClose={() => setEditOpen(false)} title={`Edit Plot ${selectedPlot?.plot_no}`} size="sm">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Rate / SqYd (₹)</label>
              <input type="number" className="input" value={editForm.rate_per_sqyd}
                onChange={e => setEditForm(f => ({ ...f, rate_per_sqyd: e.target.value }))} />
            </div>
            <div>
              <label className="label">Status</label>
              <select className="input" value={editForm.status}
                onChange={e => setEditForm(f => ({ ...f, status: e.target.value }))}>
                {Object.keys(STATUS_COLORS).map(s => (
                  <option key={s} value={s}>{s.replace('_', ' ')}</option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label className="label mb-2 block">PLC (Preferential Location Charges)</label>
            <div className="space-y-2">
              {PLC_PRESETS.map(p => (
                <label key={p.key} className="flex items-center gap-2.5 cursor-pointer">
                  <input type="checkbox" checked={plcForm[p.key]}
                    onChange={e => setPlcForm(f => ({ ...f, [p.key]: e.target.checked }))} />
                  <span className="text-sm text-slate-700">{p.label}</span>
                  <span className="ml-auto text-xs text-teal-600 font-medium">+{p.pct}%</span>
                </label>
              ))}
            </div>
          </div>

          {editForm.rate_per_sqyd && (
            <div className="bg-teal-50 border border-teal-100 rounded-lg p-3 text-sm space-y-1">
              <div className="flex justify-between"><span className="text-slate-500">Base Price</span><span>{formatINR(basePreview)}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">PLC ({plcPct}%)</span><span className="text-indigo-600">+{formatINR(plcPreview)}</span></div>
              <div className="flex justify-between font-semibold border-t border-teal-200 pt-1 mt-1">
                <span>Total Price</span><span className="text-teal-700">{formatINR(totalPreview)}</span>
              </div>
            </div>
          )}

          <div className="flex gap-3 justify-end">
            <button onClick={() => setEditOpen(false)} className="btn-secondary">Cancel</button>
            <button onClick={() => editMutation.mutate()} disabled={editMutation.isPending} className="btn-primary">
              {editMutation.isPending ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </div>
      </Modal>

      {/* Bulk Rate Modal */}
      <Modal open={bulkOpen} onClose={() => setBulkOpen(false)} title="Bulk Rate Update" size="sm">
        <div className="space-y-4">
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3 text-sm text-yellow-800">
            This will overwrite rates for all matching plots. PLC will not be recalculated.
          </div>
          <div>
            <label className="label">Project</label>
            <select className="input" value={bulkForm.project_id} onChange={e => setBulkForm(f => ({ ...f, project_id: e.target.value }))}>
              <option value="">All Projects</option>
              {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Sector (optional)</label>
            <input type="text" className="input" value={bulkForm.sector}
              onChange={e => setBulkForm(f => ({ ...f, sector: e.target.value }))} placeholder="e.g. A, B, C" />
          </div>
          <div>
            <label className="label">New Rate / SqYd (₹) *</label>
            <input type="number" className="input" value={bulkForm.rate_per_sqyd}
              onChange={e => setBulkForm(f => ({ ...f, rate_per_sqyd: e.target.value }))} />
          </div>
          <div className="flex gap-3 justify-end">
            <button onClick={() => setBulkOpen(false)} className="btn-secondary">Cancel</button>
            <button onClick={() => bulkMutation.mutate()} disabled={!bulkForm.rate_per_sqyd || bulkMutation.isPending} className="btn-primary">
              {bulkMutation.isPending ? 'Applying…' : 'Apply Bulk Rate'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
