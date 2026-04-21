import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus, Search, Building2, MapPinned } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import KpiCard from '../../components/ui/KpiCard'
import Badge from '../../components/ui/Badge'

const currency = (value) => `₹${Number(value || 0).toLocaleString('en-IN')}`

export default function ProjectsList() {
  const [projects, setProjects] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  useEffect(() => {
    fetchProjects()
  }, [])

  async function fetchProjects() {
    setLoading(true)
    const { data } = await supabase
      .from('bp_projects')
      .select('*')
      .order('created_at', { ascending: false })

    setProjects(data || [])
    setLoading(false)
  }

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim()
    if (!q) return projects
    return projects.filter((p) =>
      [p.name, p.location, p.status, p.rera_no].filter(Boolean).some((v) =>
        String(v).toLowerCase().includes(q)
      )
    )
  }, [projects, search])

  const activeCount = projects.filter((p) => (p.status || '').toLowerCase() === 'active').length

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Projects</h1>
          <p className="text-sm text-slate-500 mt-1">Manage plotted developments and inventory-linked projects.</p>
        </div>
        <Link to="/projects/new" className="btn-primary">
          <Plus size={16} /> Add Project
        </Link>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <KpiCard title="Total Projects" value={projects.length} icon={Building2} />
        <KpiCard title="Active Projects" value={activeCount} icon={MapPinned} color="green" />
        <KpiCard title="Avg. Base Rate" value={currency(projects.length ? projects.reduce((a, c) => a + Number(c.price_per_sqyd || 0), 0) / projects.length : 0)} color="blue" />
      </div>

      <div className="card p-4">
        <div className="relative max-w-md">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input pl-9"
            placeholder="Search by project, location, RERA no..."
          />
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="text-left px-4 py-3 font-semibold">Project</th>
                <th className="text-left px-4 py-3 font-semibold">Location</th>
                <th className="text-left px-4 py-3 font-semibold">Base Rate</th>
                <th className="text-left px-4 py-3 font-semibold">Plots</th>
                <th className="text-left px-4 py-3 font-semibold">Status</th>
                <th className="text-right px-4 py-3 font-semibold">Action</th>
              </tr>
            </thead>
            <tbody>
              {!loading && filtered.length === 0 && (
                <tr>
                  <td colSpan="6" className="px-4 py-10 text-center text-slate-500">No projects found.</td>
                </tr>
              )}
              {filtered.map((project) => (
                <tr key={project.id} className="border-t border-slate-100">
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-900">{project.name}</div>
                    <div className="text-xs text-slate-500">{project.rera_no || 'RERA pending'}</div>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{project.location || '—'}</td>
                  <td className="px-4 py-3 text-slate-600">{currency(project.price_per_sqyd)}</td>
                  <td className="px-4 py-3 text-slate-600">{project.total_plots || 0}</td>
                  <td className="px-4 py-3"><Badge color={(project.status || '').toLowerCase() === 'active' ? 'green' : 'yellow'}>{project.status || 'Draft'}</Badge></td>
                  <td className="px-4 py-3 text-right">
                    <Link to={`/projects/${project.id}`} className="text-teal-700 hover:text-teal-800 font-medium">View</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
