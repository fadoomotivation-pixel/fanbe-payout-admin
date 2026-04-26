import { useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { queryClient } from '../lib/queryClient'
import { formatDate } from '../lib/utils'
import LoadingSpinner from '../components/ui/LoadingSpinner'
import Modal from '../components/ui/Modal'
import toast from 'react-hot-toast'
import { CheckCircle2, XCircle, Eye, FileText, User, Clock } from 'lucide-react'

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-800',
  approved: 'bg-green-100 text-green-800',
  rejected: 'bg-red-100 text-red-800',
  resubmit: 'bg-orange-100 text-orange-800',
}

const TABS = ['pending', 'approved', 'rejected', 'all']

export default function KYC() {
  const [tab, setTab] = useState('pending')
  const [selected, setSelected] = useState<any>(null)
  const [viewOpen, setViewOpen] = useState(false)
  const [actionOpen, setActionOpen] = useState(false)
  const [action, setAction] = useState<'approved' | 'rejected' | 'resubmit'>('approved')
  const [remarks, setRemarks] = useState('')

  const { data: records = [], isLoading } = useQuery({
    queryKey: ['kyc', tab],
    queryFn: async () => {
      let q = supabase
        .from('bp_broker_kyc')
        .select('*, brokers(name, broker_id, phone, email)')
        .order('submitted_at', { ascending: false })
      if (tab !== 'all') q = q.eq('status', tab)
      const { data } = await q
      return data || []
    },
  })

  const actionMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('bp_broker_kyc')
        .update({
          status: action,
          reviewed_at: new Date().toISOString(),
          reviewer_remarks: remarks,
        })
        .eq('id', selected.id)
      if (error) throw error
      await supabase.from('brokers').update({ kyc_status: action }).eq('id', selected.broker_id)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['kyc'] })
      toast.success(`KYC ${action}`)
      setActionOpen(false)
      setRemarks('')
    },
    onError: (e: any) => toast.error(e.message),
  })

  const pending = records.filter((r: any) => r.status === 'pending').length

  if (isLoading) return <LoadingSpinner fullPage />

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="page-title">KYC Review Queue</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Broker document verification &amp; approval
          </p>
        </div>
        {pending > 0 && (
          <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-yellow-100 text-yellow-800 text-sm font-semibold">
            <Clock size={14} />{pending} pending review
          </span>
        )}
      </div>

      {/* Tab bar */}
      <div className="flex gap-0 border-b border-slate-200 overflow-x-auto">
        {TABS.map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2.5 text-sm font-medium capitalize whitespace-nowrap border-b-2 transition-colors ${
              tab === t
                ? 'border-teal-600 text-teal-700'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {records.length === 0 ? (
        <div className="card p-12 text-center">
          <FileText size={40} className="text-slate-200 mx-auto mb-3" />
          <p className="text-slate-500 text-sm">No KYC submissions in this category</p>
        </div>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                {['Broker', 'Broker ID', 'Doc Type', 'Submitted', 'Status', 'Actions'].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-slate-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {records.map((r: any) => (
                <tr key={r.id} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 rounded-full bg-teal-100 flex items-center justify-center">
                        <User size={14} className="text-teal-700" />
                      </div>
                      <div>
                        <p className="font-medium">{r.brokers?.name}</p>
                        <p className="text-xs text-slate-400">{r.brokers?.phone}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-slate-500">{r.brokers?.broker_id}</td>
                  <td className="px-4 py-3">
                    <span className="capitalize">{(r.doc_type || 'aadhaar').replace('_', ' ')}</span>
                  </td>
                  <td className="px-4 py-3 text-slate-500">{formatDate(r.submitted_at)}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[r.status]}`}>
                      {r.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => { setSelected(r); setViewOpen(true) }}
                        className="p-1.5 rounded hover:bg-slate-100 text-slate-500" title="View docs"
                      >
                        <Eye size={14} />
                      </button>
                      {r.status === 'pending' && (
                        <>
                          <button
                            onClick={() => { setSelected(r); setAction('approved'); setActionOpen(true) }}
                            className="p-1.5 rounded hover:bg-green-50 text-green-600" title="Approve"
                          >
                            <CheckCircle2 size={14} />
                          </button>
                          <button
                            onClick={() => { setSelected(r); setAction('rejected'); setActionOpen(true) }}
                            className="p-1.5 rounded hover:bg-red-50 text-red-500" title="Reject"
                          >
                            <XCircle size={14} />
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Document Viewer Modal */}
      <Modal open={viewOpen} onClose={() => setViewOpen(false)} title="KYC Documents" size="lg">
        {selected && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div><span className="text-slate-500">Broker:</span> <span className="font-medium ml-1">{selected.brokers?.name}</span></div>
              <div><span className="text-slate-500">ID:</span> <span className="font-medium ml-1">{selected.brokers?.broker_id}</span></div>
              <div><span className="text-slate-500">Doc Type:</span> <span className="font-medium ml-1 capitalize">{(selected.doc_type || 'aadhaar').replace('_', ' ')}</span></div>
              <div><span className="text-slate-500">Submitted:</span> <span className="font-medium ml-1">{formatDate(selected.submitted_at)}</span></div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {(selected.doc_urls || []).map((url: string, i: number) => (
                <div key={i} className="border border-slate-200 rounded-lg overflow-hidden">
                  {url.match(/\.(jpg|jpeg|png|webp)/i) ? (
                    <img src={url} alt={`doc-${i}`} className="w-full h-48 object-cover" />
                  ) : (
                    <div className="h-48 flex flex-col items-center justify-center bg-slate-50 gap-2">
                      <FileText size={28} className="text-slate-300" />
                      <a href={url} target="_blank" rel="noopener noreferrer"
                        className="text-xs text-teal-600 hover:underline">
                        Open Document {i + 1}
                      </a>
                    </div>
                  )}
                </div>
              ))}
              {(!selected.doc_urls || selected.doc_urls.length === 0) && (
                <div className="sm:col-span-2 h-40 flex items-center justify-center bg-slate-50 rounded-lg">
                  <p className="text-sm text-slate-400">No documents uploaded</p>
                </div>
              )}
            </div>
            {selected.reviewer_remarks && (
              <div className="bg-slate-50 rounded-lg p-3 text-sm">
                <p className="text-slate-500 text-xs mb-1">Reviewer remarks</p>
                <p className="text-slate-700">{selected.reviewer_remarks}</p>
              </div>
            )}
            {selected.status === 'pending' && (
              <div className="flex gap-2 justify-end pt-2">
                <button onClick={() => { setAction('resubmit'); setActionOpen(true); setViewOpen(false) }}
                  className="btn-secondary text-sm">Request Resubmit</button>
                <button onClick={() => { setAction('rejected'); setActionOpen(true); setViewOpen(false) }}
                  className="bg-red-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-red-700">Reject</button>
                <button onClick={() => { setAction('approved'); setActionOpen(true); setViewOpen(false) }}
                  className="btn-primary text-sm">Approve</button>
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* Action Confirm Modal */}
      <Modal
        open={actionOpen}
        onClose={() => setActionOpen(false)}
        title={`${action === 'approved' ? 'Approve' : action === 'rejected' ? 'Reject' : 'Request Resubmit'} KYC`}
        size="sm"
      >
        <div className="space-y-4">
          <p className="text-sm text-slate-600">
            {action === 'approved'
              ? `Approve KYC for ${selected?.brokers?.name}? This will mark the broker as KYC verified.`
              : action === 'rejected'
              ? `Reject KYC for ${selected?.brokers?.name}? The broker will be notified.`
              : `Request document resubmission from ${selected?.brokers?.name}.`}
          </p>
          <div>
            <label className="label">Remarks {action !== 'approved' ? '*' : '(optional)'}</label>
            <textarea
              className="input min-h-[80px]"
              value={remarks}
              onChange={e => setRemarks(e.target.value)}
              placeholder={action === 'approved' ? 'All documents verified' : 'Reason for rejection / resubmission...'}
            />
          </div>
          <div className="flex gap-3 justify-end">
            <button onClick={() => setActionOpen(false)} className="btn-secondary">Cancel</button>
            <button
              onClick={() => actionMutation.mutate()}
              disabled={actionMutation.isPending || (action !== 'approved' && !remarks)}
              className={`px-4 py-2 rounded-lg text-sm font-medium text-white transition-colors ${
                action === 'approved' ? 'bg-teal-600 hover:bg-teal-700' : 'bg-red-600 hover:bg-red-700'
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
