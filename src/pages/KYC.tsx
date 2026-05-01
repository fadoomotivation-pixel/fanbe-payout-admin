import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { Table } from '@/components/ui/Table.tsx'
import { Button } from '@/components/ui/Button.tsx'
import { Badge } from '@/components/ui/Badge.tsx'
import { Modal } from '@/components/ui/Modal.tsx'
import { formatDate } from '@/lib/utils'
import { Eye, CheckCircle, XCircle, User, FileText, CreditCard } from 'lucide-react'
import toast from 'react-hot-toast'

const STATUS_COLORS: Record<string, string> = {
  pending:  'bg-yellow-50 text-yellow-700 border border-yellow-200',
  verified: 'bg-green-50 text-green-700 border border-green-200',
  rejected: 'bg-red-50 text-red-700 border border-red-200',
}

const DOC_ICON: Record<string, any> = {
  aadhar_card: <CreditCard size={14} className="inline mr-1" />,
  pan_card:    <FileText size={14} className="inline mr-1" />,
  bank_passbook: <FileText size={14} className="inline mr-1" />,
}

export default function KYC() {
  const qc = useQueryClient()
  const [preview, setPreview] = useState<any>(null)

  const { data: docs = [], isLoading } = useQuery({
    queryKey: ['kyc_docs'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('broker_kyc_documents')
        .select('*,brokers(name,broker_id,phone,email)')
        .order('uploaded_at', { ascending: false })
      if (error) throw error
      return data
    },
  })

  const updateStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await supabase
        .from('broker_kyc_documents')
        .update({ verification_status: status, verified_at: new Date().toISOString() })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['kyc_docs'] })
      toast.success(`KYC ${vars.status === 'verified' ? 'approved ✓' : 'rejected ✗'}`)
      setPreview(null)
    },
    onError: (e: any) => toast.error(e.message),
  })

  // Stats
  const total    = docs.length
  const pending  = docs.filter((d: any) => d.verification_status === 'pending').length
  const verified = docs.filter((d: any) => d.verification_status === 'verified').length
  const rejected = docs.filter((d: any) => d.verification_status === 'rejected').length

  const cols = [
    {
      header: 'Agent',
      render: (r: any) => (
        <div>
          <div className="font-medium text-gray-900 flex items-center gap-1">
            <User size={13} className="text-gray-400" />{r.brokers?.name}
          </div>
          <div className="text-xs text-gray-400">{r.brokers?.broker_id}</div>
        </div>
      ),
    },
    {
      header: 'Document',
      render: (r: any) => (
        <span className="capitalize text-sm">
          {DOC_ICON[r.document_type] ?? <FileText size={14} className="inline mr-1" />}
          {r.document_type?.replace(/_/g, ' ')}
        </span>
      ),
    },
    { header: 'Doc Number', render: (r: any) => <span className="font-mono text-xs">{r.document_number || '—'}</span> },
    { header: 'Uploaded', render: (r: any) => formatDate(r.uploaded_at) },
    {
      header: 'Status',
      render: (r: any) => (
        <Badge label={r.verification_status} className={STATUS_COLORS[r.verification_status] || 'bg-gray-100 text-gray-600'} />
      ),
    },
    {
      header: 'Actions',
      render: (r: any) => (
        <div className="flex gap-1">
          <Button size="sm" variant="ghost" onClick={() => setPreview(r)}>
            <Eye size={13} />View
          </Button>
          {r.verification_status !== 'verified' && (
            <Button
              size="sm"
              onClick={() => updateStatus.mutate({ id: r.id, status: 'verified' })}
              loading={updateStatus.isPending}
            >
              <CheckCircle size={13} />Approve
            </Button>
          )}
          {r.verification_status !== 'rejected' && (
            <Button
              size="sm"
              variant="danger"
              onClick={() => updateStatus.mutate({ id: r.id, status: 'rejected' })}
              loading={updateStatus.isPending}
            >
              <XCircle size={13} />Reject
            </Button>
          )}
        </div>
      ),
    },
  ]

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-xl font-bold text-gray-900">KYC Verification</h1>
        <p className="text-sm text-gray-500">Review and verify agent identity documents</p>
      </div>

      {/* Stats bar */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Total',    value: total,    color: 'text-gray-700',   bg: 'bg-gray-50' },
          { label: 'Pending',  value: pending,  color: 'text-yellow-700', bg: 'bg-yellow-50' },
          { label: 'Approved', value: verified, color: 'text-green-700',  bg: 'bg-green-50' },
          { label: 'Rejected', value: rejected, color: 'text-red-700',    bg: 'bg-red-50' },
        ].map(s => (
          <div key={s.label} className={`${s.bg} rounded-xl p-4 border border-gray-100`}>
            <div className={`text-2xl font-bold ${s.color}`}>{s.value}</div>
            <div className="text-xs text-gray-500 mt-1">{s.label}</div>
          </div>
        ))}
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm">
        <Table columns={cols} data={docs} loading={isLoading} />
      </div>

      {/* Preview / Detail Modal */}
      <Modal open={!!preview} onClose={() => setPreview(null)} title="KYC Document Detail">
        {preview && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="col-span-2 flex items-center gap-3 p-3 bg-gray-50 rounded-lg">
                <div className="w-9 h-9 rounded-full bg-blue-100 flex items-center justify-center">
                  <User size={18} className="text-blue-600" />
                </div>
                <div>
                  <div className="font-semibold text-gray-900">{preview.brokers?.name}</div>
                  <div className="text-xs text-gray-500">{preview.brokers?.broker_id} · {preview.brokers?.phone}</div>
                </div>
                <Badge
                  label={preview.verification_status}
                  className={`ml-auto ${STATUS_COLORS[preview.verification_status]}`}
                />
              </div>
              <div className="p-3 bg-gray-50 rounded-lg">
                <div className="text-xs text-gray-400 mb-1">Document Type</div>
                <div className="font-medium capitalize">{preview.document_type?.replace(/_/g,' ')}</div>
              </div>
              <div className="p-3 bg-gray-50 rounded-lg">
                <div className="text-xs text-gray-400 mb-1">Document Number</div>
                <div className="font-mono font-medium">{preview.document_number || '—'}</div>
              </div>
              <div className="p-3 bg-gray-50 rounded-lg">
                <div className="text-xs text-gray-400 mb-1">Uploaded At</div>
                <div className="font-medium">{formatDate(preview.uploaded_at)}</div>
              </div>
              <div className="p-3 bg-gray-50 rounded-lg">
                <div className="text-xs text-gray-400 mb-1">Verified At</div>
                <div className="font-medium">{preview.verified_at ? formatDate(preview.verified_at) : '—'}</div>
              </div>
              {preview.file_url && (
                <div className="col-span-2">
                  <a
                    href={preview.file_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 text-blue-600 hover:underline text-sm"
                  >
                    <FileText size={14} /> View Uploaded File
                  </a>
                </div>
              )}
            </div>
            {preview.verification_status === 'pending' && (
              <div className="flex gap-2 pt-2">
                <Button
                  className="flex-1"
                  onClick={() => updateStatus.mutate({ id: preview.id, status: 'verified' })}
                  loading={updateStatus.isPending}
                >
                  <CheckCircle size={14} /> Approve KYC
                </Button>
                <Button
                  variant="danger"
                  className="flex-1"
                  onClick={() => updateStatus.mutate({ id: preview.id, status: 'rejected' })}
                  loading={updateStatus.isPending}
                >
                  <XCircle size={14} /> Reject KYC
                </Button>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  )
}
