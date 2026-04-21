import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import toast from 'react-hot-toast'

const initialForm = {
  name: '',
  location: '',
  description: '',
  total_plots: '',
  price_per_sqyd: '',
  status: 'Active',
  rera_no: '',
  brochure_url: '',
  launch_date: '',
  site_manager: '',
  map_url: '',
}

export default function ProjectForm() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [form, setForm] = useState(initialForm)
  const [saving, setSaving] = useState(false)
  const isEdit = Boolean(id)

  useEffect(() => {
    if (isEdit) loadProject()
  }, [id])

  async function loadProject() {
    const { data, error } = await supabase.from('bp_projects').select('*').eq('id', id).single()
    if (error) return toast.error(error.message)
    setForm({
      ...initialForm,
      ...data,
      total_plots: data.total_plots ?? '',
      price_per_sqyd: data.price_per_sqyd ?? '',
      launch_date: data.launch_date || '',
    })
  }

  async function handleSubmit(e) {
    e.preventDefault()
    setSaving(true)

    const payload = {
      ...form,
      total_plots: form.total_plots === '' ? null : Number(form.total_plots),
      price_per_sqyd: form.price_per_sqyd === '' ? null : Number(form.price_per_sqyd),
      updated_at: new Date().toISOString(),
    }

    const query = isEdit
      ? supabase.from('bp_projects').update(payload).eq('id', id)
      : supabase.from('bp_projects').insert(payload)

    const { error } = await query
    setSaving(false)
    if (error) return toast.error(error.message)
    toast.success(isEdit ? 'Project updated' : 'Project created')
    navigate('/projects')
  }

  const setField = (key, value) => setForm((prev) => ({ ...prev, [key]: value }))

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">{isEdit ? 'Edit Project' : 'Create Project'}</h1>
        <p className="text-sm text-slate-500 mt-1">Define the plotted development so inventory can be mapped correctly.</p>
      </div>

      <form onSubmit={handleSubmit} className="card p-6 grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="label">Project Name</label>
          <input className="input" value={form.name} onChange={(e) => setField('name', e.target.value)} required />
        </div>
        <div>
          <label className="label">Location</label>
          <input className="input" value={form.location} onChange={(e) => setField('location', e.target.value)} />
        </div>
        <div>
          <label className="label">Total Plots</label>
          <input type="number" className="input" value={form.total_plots} onChange={(e) => setField('total_plots', e.target.value)} />
        </div>
        <div>
          <label className="label">Base Price per Sq. Yard</label>
          <input type="number" className="input" value={form.price_per_sqyd} onChange={(e) => setField('price_per_sqyd', e.target.value)} />
        </div>
        <div>
          <label className="label">Status</label>
          <select className="input" value={form.status} onChange={(e) => setField('status', e.target.value)}>
            <option>Active</option>
            <option>Draft</option>
            <option>Sold Out</option>
            <option>On Hold</option>
          </select>
        </div>
        <div>
          <label className="label">RERA Number</label>
          <input className="input" value={form.rera_no} onChange={(e) => setField('rera_no', e.target.value)} />
        </div>
        <div>
          <label className="label">Launch Date</label>
          <input type="date" className="input" value={form.launch_date} onChange={(e) => setField('launch_date', e.target.value)} />
        </div>
        <div>
          <label className="label">Site Manager</label>
          <input className="input" value={form.site_manager} onChange={(e) => setField('site_manager', e.target.value)} />
        </div>
        <div className="md:col-span-2">
          <label className="label">Description</label>
          <textarea className="input min-h-28" value={form.description} onChange={(e) => setField('description', e.target.value)} />
        </div>
        <div>
          <label className="label">Brochure URL</label>
          <input className="input" value={form.brochure_url} onChange={(e) => setField('brochure_url', e.target.value)} />
        </div>
        <div>
          <label className="label">Map URL</label>
          <input className="input" value={form.map_url} onChange={(e) => setField('map_url', e.target.value)} />
        </div>

        <div className="md:col-span-2 flex justify-end gap-3 pt-2">
          <button type="button" className="btn-secondary" onClick={() => navigate('/projects')}>Cancel</button>
          <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Saving...' : isEdit ? 'Update Project' : 'Create Project'}</button>
        </div>
      </form>
    </div>
  )
}
