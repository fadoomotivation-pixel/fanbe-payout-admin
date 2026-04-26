import { useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { queryClient } from '../../lib/queryClient'
import { formatDate, formatINR } from '../../lib/utils'
import Modal from '../../components/ui/Modal'
import LoadingSpinner from '../../components/ui/LoadingSpinner'
import toast from 'react-hot-toast'
import { CheckCircle2, XCircle, Clock, CreditCard, AlertCircle } from 'lucide-react'

const STATUS_COLORS = {
  pending: 'bg-yellow-100 text-yellow-800',
  approved: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700',
  processing: 'bg-blue-100 text-blue-700',
  paid: 'bg-teal-100 text-teal-700',
}

const TABS = ['pending', 'approved', 'processing', 'paid', 'rejected', 'all']

export default function WithdrawalReview() {
  const [tab, setTab] = useState('pending')
  const [selected, setSelected] = useState(null)
  const [actionOpen, setActionOpen] = useState(false)
  const [action, setAction] = useState('approved')
  const [remarks, setRemarks] = useState('')
  const [utrRef, setUtrRef] = useState('')

  const { data: withdrawals = [], isLoading } = useQuery({
    queryKey: ['withdrawals', tab],
    queryFn: async () => {
      let q = supabase
        .from('bp_withdrawal_requests')
        .select('*, brokers(name, broker_id, phone)')
        .order('created_at', { ascending: false })
      if (tab !== 'all') q = q.eq('status', tab)
      const { data } = await q
      return data || []
    },
  })

  const actionMutation = useMutation({
    mutationFn: async () => {
      const updates = {
        status: action,
        admin_remarks: remarks,
        reviewed_at: new Date().toISOString(),
      }
      if (action === 'paid') updates.utr_reference = utrRef
      const { error } = await supabase.from('bp_withdrawal_requests').update(updates).eq('id', selected.id)
      if (error) throw error

      if (action === 'approved' || action === 'paid') {
        await supabase.from('bp_booking_activity').insert({
          booking_id: selected.booking_id,
          action: 'withdrawal_' + action,
          description: `Withdrawal ${action} — ${formatINR(selected.amount)} for ${selected.brokers?.name}`,
        }).then(() => {})
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['withdrawals'] })
      toast.success(`Withdrawal ${action}`)
      setActionOpen(false)
      setRemarks('')
      setUtrRef('')
    },
    onError: (e) => toast.error(e.message),
  })

  const pendingTotal = withdrawals
    .filter(w => w.status === 'pending')
    .reduce((s, w) => s + Number(w.amount || 0), 0)

  if (isLoading) return <LoadingSpinner fullPage />

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-title">Withdrawal Review</h1>
          <p className="text-sm text-slate-500 mt-0.5">Approve, process and pay broker withdrawal requests</p>
        </div>
        {pendingTotal > 0 && (
          <div className="text-right">
            <p className="text-xs text-slate-500">Pending approval</p>
            <p className="text-lg font-bold text-orange-600">{formatINR(pendingTotal)}</p>
          </div>
        )}
      </div>

      <div className="flex gap-0 border-b border-slate-200 overflow-x-auto">
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2.5 text-sm font-medium capitalize whitespace-nowrap border-b-2 transition-colors ${
              tab === t ? 'border-teal-600 text-teal-700' : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}>{t}</button>
        ))}
      </div>

      {withdrawals.length === 0 ? (
        <div className="card p-12 text-center">
          <CreditCard size={40} className="text-slate-200 mx-auto mb-3" />
          <p className="text-slate-500 text-sm">No withdrawal requests in this category</p>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                {['Broker', 'Broker ID', 'Amount', 'Bank Account', 'Requested', 'Status', 'UTR', 'Actions'].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-slate-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {withdrawals.map(w => (
                <tr key={w.id} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium">{w.brokers?.name}</td>
                  <td className="px-4 py-3 text-slate-500">{w.brokers?.broker_id}</td>
                  <td className="px-4 py-3 font-semibold text-green-700">{formatINR(w.amount)}</td>
                  <td className="px-4 py-3 text-slate-500 text-xs">{w.bank_account_no || '—'}</td>
                  <td className="px-4 py-3 text-slate-400 text-xs">{formatDate(w.created_at)}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[w.status]}`}>{w.status}</span>
                  </td>
                  <td className="px-4 py-3 text-slate-500 text-xs">{w.utr_reference || '—'}</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-2">
                      {w.status === 'pending' && (
                        <>
                          <button onClick={() => { setSelected(w); setAction('approved'); setActionOpen(true) }}
                            className="p-1.5 rounded hover:bg-green-50 text-green-600" title="Approve">
                            <CheckCircle2 size={14} />
                          </button>
                          <button onClick={() => { setSelected(w); setAction('rejected'); setActionOpen(true) }}
                            className="p-1.5 rounded hover:bg-red-50 text-red-500" title="Reject">
                            <XCircle size={14} />
                          </button>
                        </>
                      )}
                      {w.status === 'approved' && (
                        <button onClick={() => { setSelected(w); setAction('paid'); setActionOpen(true) }}
                          className="text-xs text-teal-600 hover:text-teal-800 font-medium">Mark Paid</button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal open={actionOpen} onClose={() => setActionOpen(false)}
        title={action === 'approved' ? 'Approve Withdrawal' : action === 'rejected' ? 'Reject Withdrawal' : 'Mark as Paid'}
        size="sm">
        <div className="space-y-4">
          {selected && (
            <div className="bg-slate-50 rounded-lg p-3 text-sm space-y-1">
              <div className="flex justify-between"><span className="text-slate-500">Broker</span><span className="font-medium">{selected.brokers?.name}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">Amount</span><span className="font-semibold text-green-700">{formatINR(selected.amount)}</span></div>
              {selected.bank_account_no && (
                <div className="flex justify-between"><span className="text-slate-500">Account</span><span>{selected.bank_account_no}</span></div>
              )}
            </div>
          )}
          {action === 'paid' && (
            <div>
              <label className="label">UTR / Reference No *</label>
              <input className="input" value={utrRef} onChange={e => setUtrRef(e.target.value)} placeholder="NEFT/RTGS reference…" />
            </div>
          )}
          <div>
            <label className="label">Remarks {action === 'rejected' ? '*' : '(optional)'}</label>
            <textarea className="input min-h-[70px]" value={remarks} onChange={e => setRemarks(e.target.value)}
              placeholder={action === 'rejected' ? 'Reason for rejection…' : 'Internal notes…'} />
          </div>
          <div className="flex gap-3 justify-end">
            <button onClick={() => setActionOpen(false)} className="btn-secondary">Cancel</button>
            <button
              onClick={() => actionMutation.mutate()}
              disabled={actionMutation.isPending || (action === 'rejected' && !remarks) || (action === 'paid' && !utrRef)}
              className={`px-4 py-2 rounded-lg text-sm font-medium text-white ${
                action === 'approved' || action === 'paid' ? 'bg-teal-600 hover:bg-teal-700' : 'bg-red-600 hover:bg-red-700'
              }`}
            >
              {actionMutation.isPending ? 'Processing…' : 'Confirm'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
