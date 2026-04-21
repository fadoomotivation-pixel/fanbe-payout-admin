import { useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { queryClient } from '../../lib/queryClient'
import { useNavigate, Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import toast from 'react-hot-toast'

export default function BulkAddPlots() {
  const navigate = useNavigate()
  const [projectId, setProjectId] = useState('')
  const [prefix, setPrefix] = useState('')
  const [startNo, setStartNo] = useState(1)
  const [count, setCount] = useState(10)
  const [area, setArea] = useState('')
  const [price, setPrice] = useState('')
  const [facing, setFacing] = useState('')

  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: async () => {
      const { data } = await supabase.from('bp_projects').select('id, name').order('name')
      return data
    },
  })

  const mutation = useMutation({
    mutationFn: async () => {
      const plots = Array.from({ length: count }, (_, i) => ({
        project_id: projectId,
        plot_no: `${prefix}${startNo + i}`,
        area_sqyd: parseFloat(area),
        price: parseFloat(price) || null,
        facing: facing || null,
        status: 'available',
      }))
      const { error } = await supabase.from('bp_plots').insert(plots)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['plots'] })
      toast.success(`${count} plots added successfully`)
      navigate('/inventory')
    },
    onError: (e) => toast.error(e.message),
  })

  return (
    <div className="max-w-lg space-y-6">
      <div className="flex items-center gap-3">
        <Link to="/inventory" className="p-2 rounded-lg hover:bg-slate-100"><ArrowLeft size={16} /></Link>
        <h1 className="page-title">Bulk Add Plots</h1>
      </div>

      <div className="card p-6 space-y-4">
        <div>
          <label className="label">Project *</label>
          <select className="input" value={projectId} onChange={e => setProjectId(e.target.value)}>
            <option value="">Select project</option>
            {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div><label className="label">Plot No Prefix</label><input className="input" value={prefix} onChange={e => setPrefix(e.target.value)} placeholder="e.g. A-" /></div>
          <div><label className="label">Start Number</label><input type="number" className="input" value={startNo} onChange={e => setStartNo(parseInt(e.target.value))} /></div>
          <div><label className="label">Number of Plots</label><input type="number" className="input" value={count} onChange={e => setCount(parseInt(e.target.value))} /></div>
          <div><label className="label">Area (SqYd) *</label><input type="number" className="input" value={area} onChange={e => setArea(e.target.value)} /></div>
          <div><label className="label">Price (₹)</label><input type="number" className="input" value={price} onChange={e => setPrice(e.target.value)} /></div>
          <div><label className="label">Facing</label>
            <select className="input" value={facing} onChange={e => setFacing(e.target.value)}>
              <option value="">Select</option>
              {['north', 'south', 'east', 'west', 'north-east', 'north-west', 'south-east', 'south-west'].map(f => <option key={f} value={f}>{f}</option>)}
            </select>
          </div>
        </div>

        <div className="bg-slate-50 rounded-lg p-3 text-sm text-slate-600">
          Will create: <strong>{prefix}{startNo}</strong> to <strong>{prefix}{startNo + count - 1}</strong> ({count} plots)
        </div>

        <div className="flex gap-3">
          <button onClick={() => mutation.mutate()} disabled={!projectId || !area || mutation.isPending} className="btn-primary">
            {mutation.isPending ? 'Adding...' : `Add ${count} Plots`}
          </button>
          <Link to="/inventory" className="btn-secondary">Cancel</Link>
        </div>
      </div>
    </div>
  )
}