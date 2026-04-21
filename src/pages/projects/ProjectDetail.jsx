import { useParams, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import LoadingSpinner from '../../components/ui/LoadingSpinner'
import { Pencil, ArrowLeft } from 'lucide-react'
import { formatDate } from '../../lib/utils'
import { PLOT_STATUS_COLORS } from '../../constants/enums'

export default function ProjectDetail() {
  const { id } = useParams()

  const { data: project, isLoading } = useQuery({
    queryKey: ['project', id],
    queryFn: async () => {
      const { data } = await supabase.from('bp_projects').select('*').eq('id', id).single()
      return data
    },
  })

  const { data: plots = [] } = useQuery({
    queryKey: ['plots', id],
    queryFn: async () => {
      const { data } = await supabase.from('bp_plots').select('*').eq('project_id', id).order('plot_no')
      return data
    },
  })

  if (isLoading) return <LoadingSpinner fullPage />

  const statusCounts = plots.reduce((acc, p) => {
    acc[p.status] = (acc[p.status] || 0) + 1
    return acc
  }, {})

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link to="/projects" className="p-2 rounded-lg hover:bg-slate-100"><ArrowLeft size={16} /></Link>
          <h1 className="page-title">{project?.name}</h1>
          <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${project?.status === 'active' ? 'bg-green-100 text-green-800' : 'bg-slate-100 text-slate-600'}`}>{project?.status}</span>
        </div>
        <Link to={`/projects/${id}/edit`} className="btn-secondary"><Pencil size={14} />Edit</Link>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {Object.entries(statusCounts).map(([status, count]) => (
          <div key={status} className="card p-4">
            <p className="text-xs text-slate-500 capitalize">{status.replace('_', ' ')}</p>
            <p className="text-2xl font-bold text-slate-900 mt-1">{count}</p>
          </div>
        ))}
      </div>

      <div className="card p-5 grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
        <div><p className="text-slate-500 text-xs">Location</p><p className="font-medium mt-0.5">{project?.location}</p></div>
        <div><p className="text-slate-500 text-xs">Total Plots</p><p className="font-medium mt-0.5">{project?.total_plots}</p></div>
        <div><p className="text-slate-500 text-xs">Price / SqYd</p><p className="font-medium mt-0.5">₹{project?.price_per_sqyd?.toLocaleString('en-IN')}</p></div>
        <div><p className="text-slate-500 text-xs">RERA No</p><p className="font-medium mt-0.5">{project?.rera_no || '—'}</p></div>
        <div><p className="text-slate-500 text-xs">Site Manager</p><p className="font-medium mt-0.5">{project?.site_manager || '—'}</p></div>
        <div><p className="text-slate-500 text-xs">Launch Date</p><p className="font-medium mt-0.5">{formatDate(project?.launch_date)}</p></div>
      </div>

      <div className="card overflow-hidden">
        <div className="p-4 border-b border-slate-200"><h2 className="section-title">Plots ({plots.length})</h2></div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="bg-slate-50 border-b border-slate-200">
              {['Plot No', 'Area (SqYd)', 'Status', 'Facing', 'Corner', 'Price'].map(h => (
                <th key={h} className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500">{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {plots.map(p => (
                <tr key={p.id} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium">{p.plot_no}</td>
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
      </div>
    </div>
  )
}