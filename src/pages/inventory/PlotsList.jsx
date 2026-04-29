import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { Link } from 'react-router-dom'
import { Plus, ChevronDown, ChevronRight } from 'lucide-react'
import toast from 'react-hot-toast'

const PLOT_STATUS_COLORS = {
  available:     'bg-green-100 text-green-700',
  token:         'bg-yellow-100 text-yellow-700',
  booked:        'bg-blue-100 text-blue-700',
  registry_done: 'bg-teal-100 text-teal-700',
  blocked:       'bg-red-100 text-red-700',
}

const PROPERTY_TYPES = ['Plot', 'Villa', 'Farmhouse', 'Commercial']
const SECTORS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('')
const STATUSES = ['available', 'token', 'booked', 'registry_done', 'blocked']

export default function PlotsList() {
  const [projectFilter, setProjectFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [sectorFilter, setSectorFilter] = useState('')
  const [expanded, setExpanded] = useState({})
  const qc = useQueryClient()

  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: async () => {
      const { data } = await supabase.from('bp_projects').select('id, name').order('name')
      return data || []
    },
  })

  const { data: plots = [], isLoading } = useQuery({
    queryKey: ['plots-all', projectFilter, statusFilter, typeFilter, sectorFilter],
    queryFn: async () => {
      let q = supabase.from('bp_plots').select('*, bp_projects(name)').order('plot_no')
      if (projectFilter) q = q.eq('project_id', projectFilter)
      if (statusFilter) q = q.eq('status', statusFilter)
      if (typeFilter) q = q.eq('property_type', typeFilter)
      if (sectorFilter) q = q.eq('sector', sectorFilter)
      const { data } = await q
      return data || []
    },
  })

  const statusMutation = useMutation({
    mutationFn: async ({ id, status }) => {
      const { error } = await supabase.from('bp_plots').update({ status }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['plots-all'] }); toast.success('Status updated') },
    onError: () => toast.error('Failed to update status'),
  })

  const toggle = (id) => setExpanded(p => ({ ...p, [id]: !p[id] }))

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="page-title">Inventory</h1>
        <Link to="/inventory/bulk-add" className="btn-primary flex items-center gap-1.5"><Plus size={16} />Bulk Add</Link>
      </div>

      <div className="flex gap-3 flex-wrap">
        <select className="input w-auto" value={projectFilter} onChange={e => setProjectFilter(e.target.value)}>
          <option value="">All Projects</option>
          {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select className="input w-auto" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          <option value="">All Status</option>
          {STATUSES.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
        </select>
        <select className="input w-auto" value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
          <option value="">All Types</option>
          {PROPERTY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <select className="input w-auto" value={sectorFilter} onChange={e => setSectorFilter(e.target.value)}>
          <option value="">All Sectors</option>
          {SECTORS.map(s => <option key={s} value={`Sector ${s}`}>Sector {s}</option>)}
        </select>
      </div>

      <div className="card overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="w-6 h-6 border-2 border-teal-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : plots.length === 0 ? (
          <p className="text-center text-slate-400 py-10 text-sm">No plots found</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="w-8 px-2 py-3" />
                  {['Plot No', 'Project', 'Type', 'Sector', 'Area (SqYd)', 'Rate/SqFt', 'Discount', 'Status', 'Facing'].map(h => (
                    <th key={h} className="text-left px-3 py-3 text-xs font-semibold text-slate-500">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {plots.map(p => (
                  <>
                    <tr key={p.id} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="px-2 py-3">
                        <button onClick={() => toggle(p.id)} className="text-slate-400 hover:text-teal-600 transition-colors">
                          {expanded[p.id] ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                        </button>
                      </td>
                      <td className="px-3 py-3 font-medium text-teal-700">
                        <Link to={`/inventory/${p.id}`}>{p.plot_no}</Link>
                      </td>
                      <td className="px-3 py-3 text-slate-600 text-xs">{p.bp_projects?.name || '—'}</td>
                      <td className="px-3 py-3 text-slate-600 text-xs">{p.property_type || 'Plot'}</td>
                      <td className="px-3 py-3 text-slate-600 text-xs">{p.sector || '—'}</td>
                      <td className="px-3 py-3 text-xs">{p.area_sqyd || '—'}</td>
                      <td className="px-3 py-3 text-xs">{p.rate_per_sqft ? `₹${p.rate_per_sqft.toLocaleString('en-IN')}` : '—'}</td>
                      <td className="px-3 py-3 text-xs">{p.discount ? `${p.discount}%` : '—'}</td>
                      <td className="px-3 py-3">
                        <select
                          value={p.status || 'available'}
                          onChange={e => statusMutation.mutate({ id: p.id, status: e.target.value })}
                          onClick={e => e.stopPropagation()}
                          className={`text-xs font-medium rounded-full px-2 py-1 border-0 cursor-pointer outline-none ${PLOT_STATUS_COLORS[p.status] || 'bg-gray-100 text-gray-600'}`}
                        >
                          {STATUSES.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
                        </select>
                      </td>
                      <td className="px-3 py-3 text-xs capitalize">{p.facing || '—'}</td>
                    </tr>
                    {expanded[p.id] && (
                      <tr key={`${p.id}-exp`} className="bg-teal-50/40 border-b border-teal-100">
                        <td colSpan={10} className="px-8 py-3">
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-8 gap-y-1 text-xs text-slate-700">
                            <div><span className="font-medium text-slate-500">Price: </span>{p.price ? `₹${p.price.toLocaleString('en-IN')}` : '—'}</div>
                            <div><span className="font-medium text-slate-500">Dimension: </span>{p.dimension || '—'}</div>
                            <div><span className="font-medium text-slate-500">Corner Plot: </span>{p.is_corner ? 'Yes' : 'No'}</div>
                            <div><span className="font-medium text-slate-500">Block: </span>{p.block || '—'}</div>
                            <div><span className="font-medium text-slate-500">Floor: </span>{p.floor || '—'}</div>
                            <div className="col-span-2"><span className="font-medium text-slate-500">PLC: </span>{Array.isArray(p.plc) ? p.plc.join(', ') : (p.plc || '—')}</div>
                            {p.remarks && <div className="col-span-4"><span className="font-medium text-slate-500">Remarks: </span>{p.remarks}</div>}
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!isLoading && (
          <div className="px-4 py-2 border-t border-slate-100 text-xs text-slate-400">
            {plots.length} plot{plots.length !== 1 ? 's' : ''} found
          </div>
        )}
      </div>
    </div>
  )
}
