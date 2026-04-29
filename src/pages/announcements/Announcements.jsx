import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { formatDate } from '../../lib/utils'
import { Plus, Megaphone, Trash2 } from 'lucide-react'

const AUDIENCE_OPTIONS = ['all', 'brokers', 'staff', 'managers']
const PRIORITY_COLORS = {
  normal: 'bg-gray-100 text-gray-700',
  important: 'bg-yellow-100 text-yellow-700',
  urgent: 'bg-red-100 text-red-700',
}

export default function Announcements() {
  const [showModal, setShowModal] = useState(false)
  const [form, setForm] = useState({ title: '', body: '', audience: 'all', priority: 'normal' })
  const qc = useQueryClient()

  const { data: announcements = [], isLoading } = useQuery({
    queryKey: ['announcements'],
    queryFn: async () => {
      const { data } = await supabase
        .from('announcements')
        .select('*')
        .order('created_at', { ascending: false })
      return data || []
    },
  })

  const create = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('announcements').insert(form)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['announcements'] })
      setShowModal(false)
      setForm({ title: '', body: '', audience: 'all', priority: 'normal' })
    },
  })

  const remove = useMutation({
    mutationFn: async (id) => {
      const { error } = await supabase.from('announcements').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['announcements'] }),
  })

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Announcements</h1>
          <p className="text-sm text-gray-500">Broadcast messages to brokers and staff</p>
        </div>
        <button onClick={() => setShowModal(true)} className="btn-primary flex items-center gap-1.5 text-sm">
          <Plus size={14} /> New Announcement
        </button>
      </div>

      <div className="space-y-3">
        {isLoading ? (
          <div className="text-center py-12 text-gray-400 text-sm">Loading…</div>
        ) : announcements.length === 0 ? (
          <div className="text-center py-12">
            <Megaphone size={32} className="mx-auto text-gray-300 mb-2" />
            <p className="text-gray-400 text-sm">No announcements yet</p>
          </div>
        ) : (
          announcements.map(row => (
            <div key={row.id} className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <h3 className="font-semibold text-gray-900 text-sm">{row.title}</h3>
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full capitalize ${PRIORITY_COLORS[row.priority] || PRIORITY_COLORS.normal}`}>
                      {row.priority}
                    </span>
                    <span className="text-xs bg-teal-50 text-teal-700 font-medium px-2 py-0.5 rounded-full capitalize">
                      {row.audience}
                    </span>
                  </div>
                  <p className="text-sm text-gray-600 whitespace-pre-wrap">{row.body}</p>
                  <p className="text-xs text-gray-400 mt-2">{formatDate(row.created_at)}</p>
                </div>
                <button
                  onClick={() => remove.mutate(row.id)}
                  className="text-gray-400 hover:text-red-500 transition-colors p-1 shrink-0"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-lg mx-4">
            <h3 className="text-base font-semibold text-gray-900 mb-4">New Announcement</h3>
            <div className="space-y-3">
              <div>
                <label className="label">Title *</label>
                <input className="input w-full mt-1" value={form.title} onChange={e => setForm(p => ({ ...p, title: e.target.value }))} />
              </div>
              <div>
                <label className="label">Message *</label>
                <textarea className="input w-full mt-1" rows={4} value={form.body} onChange={e => setForm(p => ({ ...p, body: e.target.value }))} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="label">Audience</label>
                  <select className="input w-full mt-1" value={form.audience} onChange={e => setForm(p => ({ ...p, audience: e.target.value }))}>
                    {AUDIENCE_OPTIONS.map(a => <option key={a} value={a} className="capitalize">{a}</option>)}
                  </select>
                </div>
                <div>
                  <label className="label">Priority</label>
                  <select className="input w-full mt-1" value={form.priority} onChange={e => setForm(p => ({ ...p, priority: e.target.value }))}>
                    {['normal', 'important', 'urgent'].map(p => <option key={p} value={p} className="capitalize">{p}</option>)}
                  </select>
                </div>
              </div>
            </div>
            <div className="flex gap-2 justify-end mt-4">
              <button onClick={() => setShowModal(false)} className="btn-secondary">Cancel</button>
              <button
                onClick={() => create.mutate()}
                disabled={!form.title || !form.body || create.isPending}
                className="btn-primary"
              >Publish</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
