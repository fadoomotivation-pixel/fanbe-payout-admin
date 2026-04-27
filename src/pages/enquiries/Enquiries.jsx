import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { formatDate } from '../../lib/utils'
import { Plus, Search } from 'lucide-react'

const STATUS_LIST = ['new', 'contacted', 'interested', 'converted', 'lost']
const STATUS_COLORS = {
  new: 'bg-blue-100 text-blue-700',
  contacted: 'bg-yellow-100 text-yellow-700',
  interested: 'bg-purple-100 text-purple-700',
  converted: 'bg-green-100 text-green-700',
  lost: 'bg-red-100 text-red-700',
}

export default function Enquiries() {
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState({ name: '', phone: '', email: '', project_interest: '', broker_id: '', source: '', notes: '', status: 'new' })
  const qc = useQueryClient()

  const { data: enquiries = [], isLoading } = useQuery({
    queryKey: ['enquiries', filter],
    queryFn: async () => {
      let q = supabase.from('enquiries').select('*, brokers(name,broker_id)').order('created_at', { ascending: false })
      if (filter !== 'all') q = q.eq('status', filter)
      const { data } = await q
      return data || []
    },
  })

  const { data: projects = [] } = useQuery({
    queryKey: ['projects_mini'],
    queryFn: async () => { const { data } = await supabase.from('bp_projects').select('id,name'); return data || [] },
  })

  const { data: brokers = [] } = useQuery({
    queryKey: ['brokers_mini'],
    queryFn: async () => { const { data } = await supabase.from('brokers').select('id,name,broker_id').eq('status', 'active'); return data || [] },
  })

  const create = useMutation({
    mutationFn: async () => { const { error } = await supabase.from('enquiries').insert(form); if (error) throw error },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['enquiries'] }); setShowModal(false); setForm({ name: '', phone: '', email: '', project_interest: '', broker_id: '', source: '', notes: '', status: 'new' }) },
  })

  const updateStatus = useMutation({
    mutationFn: async ({ id, status }) => { const { error } = await supabase.from('enquiries').update({ status }).eq('id', id); if (error) throw error },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['enquiries'] }),
  })

  const filtered = enquiries.filter(e =>
    e.name?.toLowerCase().includes(search.toLowerCase()) || e.phone?.includes(search)
  )

  const counts = STATUS_LIST.reduce((acc, s) => { acc[s] = enquiries.filter(e => e.status === s).length; return acc }, {})

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Enquiries</h1>
          <p className="text-sm text-gray-500">Lead tracking & conversion funnel</p>
        </div>
        <button onClick={() => setShowModal(true)} className="btn-primary flex items-center gap-1.5 text-sm"><Plus size={14} /> Add Enquiry</button>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1">
        {STATUS_LIST.map(s => (
          <div key={s} className="bg-white rounded-xl border border-gray-100 shadow-sm p-3 shrink-0 min-w-[90px] text-center">
            <p className="text-xs text-gray-500 capitalize">{s}</p>
            <p className="text-xl font-bold text-gray-900 mt-0.5">{counts[s] || 0}</p>
          </div>
        ))}
      </div>

      <div className="flex gap-2 items-center flex-wrap">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input className="input pl-8 w-44 text-sm" placeholder="Name or phone…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {['all', ...STATUS_LIST].map(s => (
            <button key={s} onClick={() => setFilter(s)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium capitalize transition-colors ${
                filter === s ? 'bg-teal-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}>{s}</button>
          ))}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">Lead</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">Project</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">Broker</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">Source</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">Added</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {isLoading
                ? <tr><td colSpan={6} className="text-center py-8 text-gray-400 text-xs">Loading…</td></tr>
                : filtered.length === 0
                ? <tr><td colSpan={6} className="text-center py-8 text-gray-400 text-xs">No enquiries found</td></tr>
                : filtered.map(row => (
                  <tr key={row.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3"><p className="font-medium text-gray-900">{row.name}</p><p className="text-xs text-gray-400">{row.phone}</p></td>
                    <td className="px-4 py-3 text-sm text-gray-700">{row.project_interest || '—'}</td>
                    <td className="px-4 py-3 text-xs text-gray-600">{row.brokers?.name || '—'}</td>
                    <td className="px-4 py-3 text-xs text-gray-600 capitalize">{row.source || '—'}</td>
                    <td className="px-4 py-3 text-xs text-gray-500">{formatDate(row.created_at)}</td>
                    <td className="px-4 py-3">
                      <select value={row.status} onChange={e => updateStatus.mutate({ id: row.id, status: e.target.value })}
                        className={`text-xs font-medium rounded-full px-2 py-1 border-0 cursor-pointer ${STATUS_COLORS[row.status] || 'bg-gray-100 text-gray-600'}`}>
                        {STATUS_LIST.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </td>
                  </tr>
                ))
              }
            </tbody>
          </table>
        </div>
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
            <h3 className="text-base font-semibold text-gray-900 mb-4">Add New Enquiry</h3>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2"><label className="label">Full Name *</label><input className="input w-full mt-1" value={form.name} onChange={e => setForm(p => ({ ...p, name: e.target.value }))} /></div>
              <div><label className="label">Phone *</label><input className="input w-full mt-1" value={form.phone} onChange={e => setForm(p => ({ ...p, phone: e.target.value }))} /></div>
              <div><label className="label">Email</label><input type="email" className="input w-full mt-1" value={form.email} onChange={e => setForm(p => ({ ...p, email: e.target.value }))} /></div>
              <div>
                <label className="label">Project Interest</label>
                <select className="input w-full mt-1" value={form.project_interest} onChange={e => setForm(p => ({ ...p, project_interest: e.target.value }))}>
                  <option value="">Select…</option>
                  {projects.map(p => <option key={p.id} value={p.name}>{p.name}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Referred By Broker</label>
                <select className="input w-full mt-1" value={form.broker_id} onChange={e => setForm(p => ({ ...p, broker_id: e.target.value }))}>
                  <option value="">None</option>
                  {brokers.map(b => <option key={b.id} value={b.id}>{b.name} ({b.broker_id})</option>)}
                </select>
              </div>
              <div>
                <label className="label">Source</label>
                <select className="input w-full mt-1" value={form.source} onChange={e => setForm(p => ({ ...p, source: e.target.value }))}>
                  <option value="">Select…</option>
                  {['walk-in','referral','broker','facebook','instagram','google','website','other'].map(s => <option key={s} value={s} className="capitalize">{s}</option>)}
                </select>
              </div>
              <div>
                <label className="label">Status</label>
                <select className="input w-full mt-1" value={form.status} onChange={e => setForm(p => ({ ...p, status: e.target.value }))}>
                  {STATUS_LIST.map(s => <option key={s} value={s} className="capitalize">{s}</option>)}
                </select>
              </div>
              <div className="col-span-2"><label className="label">Notes</label><textarea className="input w-full mt-1" rows={2} value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} /></div>
            </div>
            <div className="flex gap-2 justify-end mt-4">
              <button onClick={() => setShowModal(false)} className="btn-secondary">Cancel</button>
              <button onClick={() => create.mutate()} disabled={!form.name || !form.phone || create.isPending} className="btn-primary">Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
