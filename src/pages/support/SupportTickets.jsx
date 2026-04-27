import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { formatDate } from '../../lib/utils'
import { Plus, Search, LifeBuoy } from 'lucide-react'

const STATUS_LIST = ['open', 'in_progress', 'resolved', 'closed']
const PRIORITY_LIST = ['low', 'medium', 'high', 'urgent']

const STATUS_COLORS = {
  open: 'bg-blue-100 text-blue-700',
  in_progress: 'bg-yellow-100 text-yellow-700',
  resolved: 'bg-green-100 text-green-700',
  closed: 'bg-gray-100 text-gray-600',
}
const PRIORITY_COLORS = {
  low: 'bg-gray-100 text-gray-600',
  medium: 'bg-blue-100 text-blue-700',
  high: 'bg-orange-100 text-orange-700',
  urgent: 'bg-red-100 text-red-700',
}

export default function SupportTickets() {
  const [filter, setFilter] = useState('all')
  const [search, setSearch] = useState('')
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState({ subject: '', description: '', category: '', priority: 'medium', raised_by: '' })
  const qc = useQueryClient()

  const { data: tickets = [], isLoading } = useQuery({
    queryKey: ['support_tickets', filter],
    queryFn: async () => {
      let q = supabase
        .from('support_tickets')
        .select('*')
        .order('created_at', { ascending: false })
      if (filter !== 'all') q = q.eq('status', filter)
      const { data } = await q
      return data || []
    },
  })

  const create = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('support_tickets').insert({ ...form, status: 'open' })
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['support_tickets'] })
      setShowModal(false)
      setForm({ subject: '', description: '', category: '', priority: 'medium', raised_by: '' })
    },
  })

  const updateStatus = useMutation({
    mutationFn: async ({ id, status }) => {
      const { error } = await supabase.from('support_tickets').update({ status }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['support_tickets'] }),
  })

  const filtered = tickets.filter(t =>
    t.subject?.toLowerCase().includes(search.toLowerCase()) ||
    t.raised_by?.toLowerCase().includes(search.toLowerCase())
  )

  const counts = STATUS_LIST.reduce((acc, s) => {
    acc[s] = tickets.filter(t => t.status === s).length
    return acc
  }, {})

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Support Tickets</h1>
          <p className="text-sm text-gray-500">Track and resolve support requests</p>
        </div>
        <button onClick={() => setShowModal(true)} className="btn-primary flex items-center gap-1.5 text-sm">
          <Plus size={14} /> New Ticket
        </button>
      </div>

      <div className="flex gap-2 overflow-x-auto pb-1">
        {STATUS_LIST.map(s => (
          <div key={s} className="bg-white rounded-xl border border-gray-100 shadow-sm p-3 shrink-0 min-w-[90px] text-center">
            <p className="text-xs text-gray-500 capitalize">{s.replace('_', ' ')}</p>
            <p className="text-xl font-bold text-gray-900 mt-0.5">{counts[s] || 0}</p>
          </div>
        ))}
      </div>

      <div className="flex gap-2 items-center flex-wrap">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input className="input pl-8 w-44 text-sm" placeholder="Search tickets…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {['all', ...STATUS_LIST].map(s => (
            <button key={s} onClick={() => setFilter(s)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium capitalize transition-colors ${
                filter === s ? 'bg-teal-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}>{s.replace('_', ' ')}</button>
          ))}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">Subject</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">Category</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">Raised By</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">Priority</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">Created</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {isLoading ? (
                <tr><td colSpan={6} className="text-center py-8 text-gray-400 text-xs">Loading…</td></tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center py-10">
                    <LifeBuoy size={28} className="mx-auto text-gray-300 mb-1" />
                    <p className="text-gray-400 text-xs">No tickets found</p>
                  </td>
                </tr>
              ) : (
                filtered.map(row => (
                  <tr key={row.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900 max-w-[200px] truncate">{row.subject}</td>
                    <td className="px-4 py-3 text-xs text-gray-600 capitalize">{row.category || '—'}</td>
                    <td className="px-4 py-3 text-xs text-gray-600">{row.raised_by || '—'}</td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full capitalize ${PRIORITY_COLORS[row.priority] || PRIORITY_COLORS.medium}`}>
                        {row.priority}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">{formatDate(row.created_at)}</td>
                    <td className="px-4 py-3">
                      <select
                        value={row.status}
                        onChange={e => updateStatus.mutate({ id: row.id, status: e.target.value })}
                        className={`text-xs font-medium rounded-full px-2 py-1 border-0 cursor-pointer ${STATUS_COLORS[row.status] || 'bg-gray-100 text-gray-600'}`}
                      >
                        {STATUS_LIST.map(s => <option key={s} value={s} className="capitalize">{s.replace('_', ' ')}</option>)}
                      </select>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
            <h3 className="text-base font-semibold text-gray-900 mb-4">New Support Ticket</h3>
            <div className="space-y-3">
              <div>
                <label className="label">Subject *</label>
                <input className="input w-full mt-1" value={form.subject} onChange={e => setForm(p => ({ ...p, subject: e.target.value }))} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Category</label>
                  <select className="input w-full mt-1" value={form.category} onChange={e => setForm(p => ({ ...p, category: e.target.value }))}>
                    <option value="">Select…</option>
                    {['billing', 'technical', 'payout', 'account', 'other'].map(c => (
                      <option key={c} value={c} className="capitalize">{c}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="label">Priority</label>
                  <select className="input w-full mt-1" value={form.priority} onChange={e => setForm(p => ({ ...p, priority: e.target.value }))}>
                    {PRIORITY_LIST.map(p => <option key={p} value={p} className="capitalize">{p}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="label">Raised By</label>
                <input className="input w-full mt-1" placeholder="Name or broker ID" value={form.raised_by} onChange={e => setForm(p => ({ ...p, raised_by: e.target.value }))} />
              </div>
              <div>
                <label className="label">Description *</label>
                <textarea className="input w-full mt-1" rows={4} value={form.description} onChange={e => setForm(p => ({ ...p, description: e.target.value }))} />
              </div>
            </div>
            <div className="flex gap-2 justify-end mt-4">
              <button onClick={() => setShowModal(false)} className="btn-secondary">Cancel</button>
              <button
                onClick={() => create.mutate()}
                disabled={!form.subject || !form.description || create.isPending}
                className="btn-primary"
              >Submit Ticket</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
