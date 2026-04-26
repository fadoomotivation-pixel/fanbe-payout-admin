import { useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { queryClient } from '../../lib/queryClient'
import { formatDate } from '../../lib/utils'
import Modal from '../../components/ui/Modal'
import LoadingSpinner from '../../components/ui/LoadingSpinner'
import toast from 'react-hot-toast'
import { Plus, Edit2, Trash2, Megaphone, Pin } from 'lucide-react'

const AUDIENCE = ['all', 'brokers', 'customers', 'admin']
const TYPE_COLORS = {
  info: 'bg-blue-100 text-blue-700',
  warning: 'bg-yellow-100 text-yellow-800',
  success: 'bg-green-100 text-green-700',
  urgent: 'bg-red-100 text-red-700',
}

export default function Announcements() {
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState({ title: '', body: '', type: 'info', audience: 'all', pinned: false, expires_at: '' })
  const [deleteId, setDeleteId] = useState(null)

  const { data: announcements = [], isLoading } = useQuery({
    queryKey: ['announcements'],
    queryFn: async () => {
      const { data } = await supabase.from('bp_announcements').select('*').order('pinned', { ascending: false }).order('created_at', { ascending: false })
      return data || []
    },
  })

  const resetForm = () => setForm({ title: '', body: '', type: 'info', audience: 'all', pinned: false, expires_at: '' })

  const saveMutation = useMutation({
    mutationFn: async () => {
      if (editing) {
        const { error } = await supabase.from('bp_announcements').update({ ...form, updated_at: new Date().toISOString() }).eq('id', editing.id)
        if (error) throw error
      } else {
        const { error } = await supabase.from('bp_announcements').insert({ ...form })
        if (error) throw error
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['announcements'] })
      toast.success(editing ? 'Announcement updated' : 'Announcement published')
      setOpen(false)
      setEditing(null)
      resetForm()
    },
    onError: (e) => toast.error(e.message),
  })

  const deleteMutation = useMutation({
    mutationFn: async (id) => {
      const { error } = await supabase.from('bp_announcements').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['announcements'] })
      toast.success('Deleted')
      setDeleteId(null)
    },
    onError: (e) => toast.error(e.message),
  })

  const openEdit = (a) => {
    setEditing(a)
    setForm({ title: a.title, body: a.body, type: a.type, audience: a.audience, pinned: a.pinned, expires_at: a.expires_at || '' })
    setOpen(true)
  }

  if (isLoading) return <LoadingSpinner fullPage />

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-title">Announcements</h1>
          <p className="text-sm text-slate-500 mt-0.5">Publish notices to brokers, customers or admins</p>
        </div>
        <button onClick={() => { setEditing(null); resetForm(); setOpen(true) }} className="btn-primary text-sm">
          <Plus size={14} />New Announcement
        </button>
      </div>

      {announcements.length === 0 ? (
        <div className="card p-12 text-center">
          <Megaphone size={40} className="text-slate-200 mx-auto mb-3" />
          <p className="text-slate-500 text-sm">No announcements yet. Publish your first one.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {announcements.map(a => {
            const isExpired = a.expires_at && new Date(a.expires_at) < new Date()
            return (
              <div key={a.id} className={`card p-4 ${isExpired ? 'opacity-50' : ''}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      {a.pinned && <Pin size={13} className="text-teal-600" />}
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${TYPE_COLORS[a.type]}`}>{a.type}</span>
                      <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded-full capitalize">{a.audience}</span>
                      {isExpired && <span className="text-xs text-red-500">Expired</span>}
                    </div>
                    <h3 className="font-semibold text-slate-800">{a.title}</h3>
                    <p className="text-sm text-slate-600 mt-1 whitespace-pre-line">{a.body}</p>
                    <p className="text-xs text-slate-400 mt-2">
                      Published {formatDate(a.created_at)}
                      {a.expires_at && ` · Expires ${formatDate(a.expires_at)}`}
                    </p>
                  </div>
                  <div className="flex gap-1.5 shrink-0">
                    <button onClick={() => openEdit(a)} className="p-1.5 rounded hover:bg-slate-100 text-slate-500">
                      <Edit2 size={13} />
                    </button>
                    <button onClick={() => setDeleteId(a.id)} className="p-1.5 rounded hover:bg-red-50 text-red-500">
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <Modal open={open} onClose={() => { setOpen(false); setEditing(null); resetForm() }}
        title={editing ? 'Edit Announcement' : 'New Announcement'} size="md">
        <div className="space-y-4">
          <div>
            <label className="label">Title *</label>
            <input className="input" value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="Announcement title" />
          </div>
          <div>
            <label className="label">Body *</label>
            <textarea className="input min-h-[100px]" value={form.body} onChange={e => setForm(f => ({ ...f, body: e.target.value }))} placeholder="Announcement content…" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Type</label>
              <select className="input" value={form.type} onChange={e => setForm(f => ({ ...f, type: e.target.value }))}>
                {Object.keys(TYPE_COLORS).map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Audience</label>
              <select className="input" value={form.audience} onChange={e => setForm(f => ({ ...f, audience: e.target.value }))}>
                {AUDIENCE.map(a => <option key={a} value={a}>{a}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Expires At (optional)</label>
              <input type="date" className="input" value={form.expires_at} onChange={e => setForm(f => ({ ...f, expires_at: e.target.value }))} />
            </div>
            <div className="flex items-center gap-2 pt-6">
              <input type="checkbox" id="pinned" checked={form.pinned} onChange={e => setForm(f => ({ ...f, pinned: e.target.checked }))} />
              <label htmlFor="pinned" className="text-sm text-slate-700">Pin to top</label>
            </div>
          </div>
          <div className="flex gap-3 justify-end">
            <button onClick={() => { setOpen(false); resetForm() }} className="btn-secondary">Cancel</button>
            <button onClick={() => saveMutation.mutate()} disabled={!form.title || !form.body || saveMutation.isPending} className="btn-primary">
              {saveMutation.isPending ? 'Saving…' : editing ? 'Update' : 'Publish'}
            </button>
          </div>
        </div>
      </Modal>

      <Modal open={!!deleteId} onClose={() => setDeleteId(null)} title="Delete Announcement" size="sm">
        <p className="text-sm text-slate-600 mb-4">Are you sure you want to delete this announcement? This cannot be undone.</p>
        <div className="flex gap-3 justify-end">
          <button onClick={() => setDeleteId(null)} className="btn-secondary">Cancel</button>
          <button onClick={() => deleteMutation.mutate(deleteId)} disabled={deleteMutation.isPending}
            className="bg-red-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-red-700">
            {deleteMutation.isPending ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </Modal>
    </div>
  )
}
