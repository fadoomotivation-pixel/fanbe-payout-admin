import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { Table } from '@/components/ui/Table.tsx'
import { Button } from '@/components/ui/Button.tsx'
import { Badge } from '@/components/ui/Badge.tsx'
import { KYC_COLORS, formatDate } from '@/lib/utils'
import toast from 'react-hot-toast'

export default function KYC() {
  const qc = useQueryClient()
  const { data: docs = [], isLoading } = useQuery({
    queryKey: ['kyc_docs'],
    queryFn: async () => {
      const { data, error } = await supabase.from('broker_kyc_documents').select('*,brokers(name,broker_id)').order('uploaded_at', { ascending: false })
      if (error) throw error; return data
    },
  })

  const updateStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await supabase.from('broker_kyc_documents').update({ verification_status: status, verified_at: new Date().toISOString() }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['kyc_docs'] }); toast.success('KYC status updated') },
    onError: (e: any) => toast.error(e.message),
  })

  const cols = [
    { header: 'Broker', render: (r: any) => <div><div className="font-medium">{r.brokers?.name}</div><div className="text-xs text-gray-400">{r.brokers?.broker_id}</div></div> },
    { header: 'Doc Type', render: (r: any) => <span className="capitalize">{r.document_type?.replace(/_/g,' ')}</span> },
    { header: 'Uploaded', render: (r: any) => formatDate(r.uploaded_at) },
    { header: 'Status', render: (r: any) => <Badge label={r.verification_status} className={KYC_COLORS[r.verification_status] || 'bg-gray-100 text-gray-600'} /> },
    {
      header: 'Action', render: (r: any) => (
        <div className="flex gap-1">
          {r.verification_status !== 'verified' && (
            <Button size="sm" onClick={() => updateStatus.mutate({ id: r.id, status: 'verified' })}>Verify</Button>
          )}
          {r.verification_status !== 'rejected' && (
            <Button size="sm" variant="secondary" onClick={() => updateStatus.mutate({ id: r.id, status: 'rejected' })}>Reject</Button>
          )}
        </div>
      )
    },
  ]

  return (
    <div>
      <div className="mb-6"><h1 className="text-xl font-bold text-gray-900">KYC Documents</h1><p className="text-sm text-gray-500">Review and verify broker documents</p></div>
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm">
        <Table columns={cols} data={docs} loading={isLoading} />
      </div>
    </div>
  )
}