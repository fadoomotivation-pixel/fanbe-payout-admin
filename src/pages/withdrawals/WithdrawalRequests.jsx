import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { formatINR, formatDate } from '../../lib/utils'

const STATUS_COLORS = {
  pending: 'bg-yellow-100 text-yellow-700',
  approved: 'bg-blue-100 text-blue-700',
  paid: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700',
}

export default function WithdrawalRequests() {
  const [filter, setFilter] = useState('all')
  const [actionModal, setActionModal] = useState(null)
  const [adminNote, setAdminNote] = useState('')
  const qc = useQueryClient()

  const { data = [], isLoading } = useQuery({
    queryKey: ['withdrawals', filter],
    queryFn: async () => {
      let q = supabase
        .from('withdrawal_requests')
        .select('*, brokers(name, broker_id, bp_broker_banks(bank_name, account_number, ifsc_code))')
        .order('created_at', { ascending: false })
      if (filter !== 'all') q = q.eq('status', filter)
      const { data, error } = await q
      if (error) throw error
      return data || []
    },
  })

  const mutation = useMutation({
    mutationFn: async ({ id, status }) => {
      const { error } = await supabase
        .from('withdrawal_requests')
        .update({ status, admin_note: adminNote, updated_at: new Date().toISOString() })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['withdrawals'] })
      setActionModal(null)
      setAdminNote('')
    },
  })

  const pendingCount = data.filter(r => r.status === 'pending').length
  const pendingAmt = data.filter(r => r.status === 'pending').reduce((s, r) => s + (Number(r.amount) || 0), 0)
  const approvedCount = data.filter(r => r.status === 'approved').length

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Withdrawal Requests</h1>
        <p className="text-sm text-gray-500">Broker payout withdrawal management</p>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
          <p className="text-xs text-gray-500">Pending Requests</p>
          <p className="text-2xl font-bold text-yellow-600 mt-1">{pendingCount}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
          <p className="text-xs text-gray-500">Pending Amount</p>
          <p className="text-2xl font-bold text-orange-600 mt-1">{formatINR(pendingAmt)}</p>
        </div>
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
          <p className="text-xs text-gray-500">Approved (awaiting pay)</p>
          <p className="text-2xl font-bold text-blue-600 mt-1">{approvedCount}</p>
        </div>
      </div>

      <div className="flex gap-2">
        {['all', 'pending', 'approved', 'paid', 'rejected'].map(s => (
          <button key={s} onClick={() => setFilter(s)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium capitalize transition-colors ${
              filter === s ? 'bg-teal-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}>{s}</button>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">Broker</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">Amount</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">Bank Details</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">Requested</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">Status</th>
                <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {isLoading
                ? <tr><td colSpan={6} className="text-center py-8 text-gray-400 text-xs">Loading…</td></tr>
                : data.length === 0
                ? <tr><td colSpan={6} className="text-center py-8 text-gray-400 text-xs">No withdrawal requests</td></tr>
                : data.map(row => {
                  const bank = row.brokers?.bp_broker_banks?.[0]
                  return (
                    <tr key={row.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3">
                        <p className="font-medium text-gray-900">{row.brokers?.name || '—'}</p>
                        <p className="text-xs text-gray-400">{row.brokers?.broker_id}</p>
                      </td>
                      <td className="px-4 py-3 font-semibold text-gray-900">{formatINR(row.amount)}</td>
                      <td className="px-4 py-3">
                        {bank
                          ? <div className="text-xs"><p className="font-medium text-gray-800">{bank.bank_name}</p><p className="text-gray-400">{bank.account_number} · {bank.ifsc_code}</p></div>
                          : <span className="text-xs text-gray-400">No bank on file</span>}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500">{formatDate(row.created_at)}</td>
                      <td className="px-4 py-3">
                        <span className={`text-xs px-2 py-1 rounded-full font-medium capitalize ${STATUS_COLORS[row.status] || 'bg-gray-100 text-gray-600'}`}>
                          {row.status}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1.5">
                          {row.status === 'pending' && (
                            <>
                              <button onClick={() => setActionModal({ row, action: 'approved' })} className="px-2 py-1 text-xs bg-blue-100 text-blue-700 rounded hover:bg-blue-200">Approve</button>
                              <button onClick={() => setActionModal({ row, action: 'rejected' })} className="px-2 py-1 text-xs bg-red-100 text-red-700 rounded hover:bg-red-200">Reject</button>
                            </>
                          )}
                          {row.status === 'approved' && (
                            <button onClick={() => setActionModal({ row, action: 'paid' })} className="px-2 py-1 text-xs bg-green-100 text-green-700 rounded hover:bg-green-200">Mark Paid</button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })
              }
            </tbody>
          </table>
        </div>
      </div>

      {actionModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-md mx-4">
            <h3 className="text-base font-semibold text-gray-900 mb-1 capitalize">
              {actionModal.action === 'approved' ? 'Approve' : actionModal.action === 'paid' ? 'Mark as Paid' : 'Reject'} Withdrawal
            </h3>
            <p className="text-sm text-gray-500 mb-4">{actionModal.row.brokers?.name} · {formatINR(actionModal.row.amount)}</p>
            <label className="label">Admin Note (optional)</label>
            <textarea value={adminNote} onChange={e => setAdminNote(e.target.value)} rows={2} className="input w-full mt-1 mb-4" placeholder="e.g. NEFT processed ref#…" />
            <div className="flex gap-2 justify-end">
              <button onClick={() => { setActionModal(null); setAdminNote('') }} className="btn-secondary">Cancel</button>
              <button
                onClick={() => mutation.mutate({ id: actionModal.row.id, status: actionModal.action })}
                disabled={mutation.isPending}
                className={`px-4 py-2 rounded-lg text-sm font-medium text-white ${actionModal.action === 'rejected' ? 'bg-red-600 hover:bg-red-700' : 'bg-teal-600 hover:bg-teal-700'}`}>
                {mutation.isPending ? 'Saving…' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
