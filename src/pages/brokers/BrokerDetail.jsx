import { useParams, Link } from 'react-router-dom'
import { useQuery, useMutation } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { queryClient } from '../../lib/queryClient'
import LoadingSpinner from '../../components/ui/LoadingSpinner'
import { ArrowLeft, CheckCircle } from 'lucide-react'
import { formatDate, formatINR } from '../../lib/utils'
import { PAYOUT_STATUS_COLORS } from '../../constants/enums'
import toast from 'react-hot-toast'

export default function BrokerDetail() {
  const { id } = useParams()

  const { data: broker, isLoading } = useQuery({
    queryKey: ['broker', id],
    queryFn: async () => {
      const { data } = await supabase.from('brokers').select('*, bp_broker_kyc(*)').eq('id', id).single()
      return data
    },
  })

  const { data: payouts = [] } = useQuery({
    queryKey: ['broker-payouts', id],
    queryFn: async () => {
      const { data } = await supabase.from('bp_payout_transactions').select('*, bp_bookings(booking_no)').eq('broker_id', id).order('created_at', { ascending: false })
      return data
    },
  })

  const approveMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('brokers').update({ status: 'active', kyc_status: 'verified' }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['broker', id] })
      toast.success('Broker approved')
    },
  })

  if (isLoading) return <LoadingSpinner fullPage />

  const totalPaid = payouts.filter(p => p.status === 'paid').reduce((s, p) => s + (p.net_amount || 0), 0)
  const totalPending = payouts.filter(p => p.status === 'pending').reduce((s, p) => s + (p.amount || 0), 0)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link to="/brokers" className="p-2 rounded-lg hover:bg-slate-100"><ArrowLeft size={16} /></Link>
          <h1 className="page-title">{broker?.name}</h1>
          <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${broker?.status === 'active' ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'}`}>{broker?.status}</span>
        </div>
        {broker?.status !== 'active' && (
          <button onClick={() => approveMutation.mutate()} className="btn-primary"><CheckCircle size={15} />Approve Broker</button>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <div className="card p-4"><p className="text-xs text-slate-500">Total Paid</p><p className="text-xl font-bold text-green-700 mt-1">{formatINR(totalPaid)}</p></div>
        <div className="card p-4"><p className="text-xs text-slate-500">Pending Payout</p><p className="text-xl font-bold text-yellow-600 mt-1">{formatINR(totalPending)}</p></div>
        <div className="card p-4"><p className="text-xs text-slate-500">Total Transactions</p><p className="text-xl font-bold text-slate-900 mt-1">{payouts.length}</p></div>
      </div>

      <div className="card p-5 grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
        <div><p className="text-slate-500 text-xs">Broker ID</p><p className="font-medium mt-0.5">{broker?.broker_id}</p></div>
        <div><p className="text-slate-500 text-xs">Phone</p><p className="font-medium mt-0.5">{broker?.phone}</p></div>
        <div><p className="text-slate-500 text-xs">Email</p><p className="font-medium mt-0.5">{broker?.email || '—'}</p></div>
        <div><p className="text-slate-500 text-xs">KYC Status</p><p className="font-medium mt-0.5">{broker?.kyc_status || 'pending'}</p></div>
        <div><p className="text-slate-500 text-xs">PAN</p><p className="font-medium mt-0.5">{broker?.bp_broker_kyc?.[0]?.pan_no || '—'}</p></div>
        <div><p className="text-slate-500 text-xs">Joined</p><p className="font-medium mt-0.5">{formatDate(broker?.created_at)}</p></div>
      </div>

      <div className="card overflow-hidden">
        <div className="p-4 border-b border-slate-200"><h2 className="section-title">Payout History</h2></div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="bg-slate-50 border-b border-slate-200">
              {['Booking', 'Type', 'Amount', 'TDS', 'Net', 'Status', 'Date'].map(h => (
                <th key={h} className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500">{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {payouts.map(p => (
                <tr key={p.id} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-3 text-teal-700">{p.bp_bookings?.booking_no}</td>
                  <td className="px-4 py-3 capitalize">{p.payout_type}</td>
                  <td className="px-4 py-3">{formatINR(p.amount)}</td>
                  <td className="px-4 py-3 text-red-600">{formatINR(p.tds_amount)}</td>
                  <td className="px-4 py-3 font-medium">{formatINR(p.net_amount || p.amount)}</td>
                  <td className="px-4 py-3"><span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${PAYOUT_STATUS_COLORS[p.status]}`}>{p.status}</span></td>
                  <td className="px-4 py-3 text-slate-500">{formatDate(p.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}