import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { Link } from 'react-router-dom'
import { Plus } from 'lucide-react'
import LoadingSpinner from '../../components/ui/LoadingSpinner'
import EmptyState from '../../components/ui/EmptyState'
import { PLOT_STATUS_COLORS } from '../../constants/enums'

export default function PlotsList() {
  const [projectFilter, setProjectFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')

  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: async () => {
      const { data } = await supabase.from('bp_projects').select('id, name').order('name')
      return data
    },
  })

  const { data: plots = [], isLoading } = useQuery({
    queryKey: ['plots-all', projectFilter, statusFilter],
    queryFn: async () => {
      let q = supabase.from('bp_plots').select('*, bp_projects(name)').order('plot_no')
      if (projectFilter) q = q.eq('project_id', projectFilter)
      if (statusFilter) q = q.eq('status', statusFilter)
      const { data } = await q
      return data
    },
  })

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="page-title">Inventory</h1>
        <Link to="/inventory/bulk-add" className="btn-primary"><Plus size={16} />Bulk Add</Link>
      </div>

      <div className="flex gap-3 flex-wrap">
        <select className="input w-auto" value={projectFilter} onChange={e => setProjectFilter(e.target.value)}>
          <option value="">All Projects</option>
          {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select className="input w-auto" value={statusFilter} onChange={e => setStatusFilter(e.target.value)}>
          <option value="">All Status</option>
          {['available', 'token', 'booked', 'registry_done', 'blocked'].map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
        </select>
      </div>

      <div className="card overflow-hidden">
        {isLoading ? <LoadingSpinner fullPage /> : plots.length === 0 ? <EmptyState title="No plots found" /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="bg-slate-50 border-b border-slate-200">
                {['Plot No', 'Project', 'Area (SqYd)', 'Status', 'Facing', 'Corner', 'Price'].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-slate-500">{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {plots.map(p => (
                  <tr key={p.id} className="border-b border-slate-100 hover:bg-slate-50 cursor-pointer">
                    <td className="px-4 py-3 font-medium text-teal-700"><Link to={`/inventory/${p.id}`}>{p.plot_no}</Link></td>
                    <td className="px-4 py-3 text-slate-600">{p.bp_projects?.name}</td>
                    <td className="px-4 py-3">{p.area_sqyd}</td>
                    <td className="px-4 py-3"><span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${PLOT_STATUS_COLORS[p.status]}`}>{p.status}</span></td>
                    <td className="px-4 py-3 capitalize">{p.facing || '—'}</td>
                    <td className="px-4 py-3">{p.is_corner ? 'Yes' : 'No'}</td>
                    <td className="px-4 py-3">₹{p.price?.toLocaleString('en-IN') || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}