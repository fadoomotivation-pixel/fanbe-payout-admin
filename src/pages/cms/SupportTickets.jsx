import { useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { queryClient } from '../../lib/queryClient'
import { formatDate } from '../../lib/utils'
import Modal from '../../components/ui/Modal'
import LoadingSpinner from '../../components/ui/LoadingSpinner'
import toast from 'react-hot-toast'
import { MessageSquare, CheckCircle2, Clock, AlertCircle, ChevronDown, Send } from 'lucide-react'

const STATUS_COLORS = {
  open: 'bg-yellow-100 text-yellow-800',
  in_progress: 'bg-blue-100 text-blue-700',
  resolved: 'bg-green-100 text-green-700',
  closed: 'bg-slate-100 text-slate-500',
}

const PRIORITY_COLORS = {
  low: 'bg-slate-100 text-slate-500',
  medium: 'bg-yellow-100 text-yellow-700',
  high: 'bg-orange-100 text-orange-700',
  urgent: 'bg-red-100 text-red-700',
}

const TABS = ['open', 'in_progress', 'resolved', 'closed', 'all']

export default function SupportTickets() {
  const [tab, setTab] = useState('open')
  const [selected, setSelected] = useState(null)
  const [detailOpen, setDetailOpen] = useState(false)
  const [reply, setReply] = useState('')
  const [statusUpdate, setStatusUpdate] = useState('')

  const { data: tickets = [], isLoading } = useQuery({
    queryKey: ['support-tickets', tab],
    queryFn: async () => {
      let q = supabase
        .from('bp_support_tickets')
        .select('*, brokers(name, broker_id), bp_customers(name)')
        .order('created_at', { ascending: false })
      if (tab !== 'all') q = q.eq('status', tab)
      const { data } = await q
      return data || []
    },
  })

  const { data: replies = [] } = useQuery({
    queryKey: ['ticket-replies', selected?.id],
    enabled: !!selected?.id,
    queryFn: async () => {
      const { data } = await supabase.from('bp_ticket_replies').select('*').eq('ticket_id', selected.id).order('created_at')
      return data || []
    },
  })

  const replyMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('bp_ticket_replies').insert({
        ticket_id: selected.id,
        body: reply,
        sender_role: 'admin',
      })
      if (error) throw error
      if (statusUpdate) {
        await supabase.from('bp_support_tickets').update({ status: statusUpdate, updated_at: new Date().toISOString() }).eq('id', selected.id)
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['ticket-replies', selected.id] })
      queryClient.invalidateQueries({ queryKey: ['support-tickets'] })
      toast.success('Reply sent')
      setReply('')
      setStatusUpdate('')
    },
    onError: (e) => toast.error(e.message),
  })

  const openCount = tickets.filter(t => t.status === 'open').length

  if (isLoading) return <LoadingSpinner fullPage />

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-title">Support Tickets</h1>
          <p className="text-sm text-slate-500 mt-0.5">Manage broker &amp; customer support requests</p>
        </div>
        {openCount > 0 && (
          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-yellow-100 text-yellow-800 text-sm font-semibold">
            <Clock size={14} />{openCount} open
          </span>
        )}
      </div>

      <div className="flex gap-0 border-b border-slate-200 overflow-x-auto">
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2.5 text-sm font-medium capitalize whitespace-nowrap border-b-2 transition-colors ${
              tab === t ? 'border-teal-600 text-teal-700' : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}>{t.replace('_', ' ')}</button>
        ))}
      </div>

      {tickets.length === 0 ? (
        <div className="card p-12 text-center">
          <MessageSquare size={40} className="text-slate-200 mx-auto mb-3" />
          <p className="text-slate-500 text-sm">No tickets in this category</p>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                {['Ticket ID', 'Subject', 'From', 'Type', 'Priority', 'Status', 'Created', 'Action'].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-slate-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {tickets.map(t => (
                <tr key={t.id} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-3 font-mono text-xs text-slate-500">{t.ticket_no || `#${t.id.slice(0,8)}`}</td>
                  <td className="px-4 py-3 font-medium max-w-[200px] truncate">{t.subject}</td>
                  <td className="px-4 py-3 text-slate-500">
                    {t.brokers?.name || t.bp_customers?.name || 'Unknown'}
                  </td>
                  <td className="px-4 py-3 capitalize text-slate-500">{t.ticket_type || 'general'}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${PRIORITY_COLORS[t.priority || 'low']}`}>
                      {t.priority || 'low'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[t.status]}`}>
                      {t.status.replace('_', ' ')}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-400 text-xs">{formatDate(t.created_at)}</td>
                  <td className="px-4 py-3">
                    <button onClick={() => { setSelected(t); setDetailOpen(true) }}
                      className="text-xs text-teal-600 hover:text-teal-800 font-medium">Reply</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={detailOpen} onClose={() => { setDetailOpen(false); setSelected(null) }}
        title={selected ? `Ticket: ${selected.subject}` : ''} size="lg">
        {selected && (
          <div className="space-y-4">
            <div className="flex gap-2 flex-wrap">
              <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[selected.status]}`}>{selected.status.replace('_', ' ')}</span>
              <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${PRIORITY_COLORS[selected.priority || 'low']}`}>{selected.priority || 'low'}</span>
              <span className="text-xs text-slate-500">From: {selected.brokers?.name || selected.bp_customers?.name}</span>
            </div>

            <div className="bg-slate-50 rounded-lg p-3">
              <p className="text-xs text-slate-400 mb-1">Original Message</p>
              <p className="text-sm text-slate-700 whitespace-pre-line">{selected.description}</p>
            </div>

            {/* Thread */}
            {replies.length > 0 && (
              <div className="space-y-2 max-h-48 overflow-y-auto">
                {replies.map(r => (
                  <div key={r.id} className={`rounded-lg p-3 text-sm ${
                    r.sender_role === 'admin' ? 'bg-teal-50 ml-8' : 'bg-white border border-slate-200 mr-8'
                  }`}>
                    <p className="text-xs text-slate-400 mb-1">{r.sender_role === 'admin' ? 'Admin' : 'User'} · {formatDate(r.created_at)}</p>
                    <p className="text-slate-700 whitespace-pre-line">{r.body}</p>
                  </div>
                ))}
              </div>
            )}

            <div className="border-t border-slate-200 pt-4 space-y-3">
              <textarea className="input min-h-[80px]" value={reply}
                onChange={e => setReply(e.target.value)} placeholder="Type your reply…" />
              <div className="flex items-center gap-3 justify-between">
                <div>
                  <label className="label inline mr-2">Update status:</label>
                  <select className="input w-auto inline-block" value={statusUpdate}
                    onChange={e => setStatusUpdate(e.target.value)}>
                    <option value="">No change</option>
                    {Object.keys(STATUS_COLORS).map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
                  </select>
                </div>
                <button onClick={() => replyMutation.mutate()} disabled={!reply || replyMutation.isPending}
                  className="btn-primary text-sm flex items-center gap-1.5">
                  <Send size={13} />{replyMutation.isPending ? 'Sending…' : 'Send Reply'}
                </button>
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
