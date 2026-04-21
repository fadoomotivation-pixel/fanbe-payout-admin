import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { formatINR } from '../../lib/utils'
import LoadingSpinner from '../../components/ui/LoadingSpinner'
import KpiCard from '../../components/ui/KpiCard'
import { Banknote, TrendingUp, Users, FileText } from 'lucide-react'

export default function Reports() {
  const { data, isLoading } = useQuery({
    queryKey: ['reports'],
    queryFn: async () => {
      const [payouts, bookings, brokers] = await Promise.all([
        supabase.from('bp_payout_transactions').select('*'),
        supabase.from('bp_bookings').select('*, bp_projects(name), brokers(name)'),
        supabase.from('brokers').select('id, name, broker_id'),
      ])
      return { payouts: payouts.data, bookings: bookings.data, brokers: brokers.data }
    },
  })

  if (isLoading) return <LoadingSpinner fullPage />

  const { payouts = [], bookings = [], brokers = [] } = data || {}
  const totalPaid = payouts.filter(p => p.status === 'paid').reduce((s, p) => s + (p.net_amount || 0), 0)
  const totalPending = payouts.filter(p => p.status === 'pending').reduce((s, p) => s + (p.amount || 0), 0)
  const totalTDS = payouts.filter(p => p.status === 'paid').reduce((s, p) => s + (p.tds_amount || 0), 0)

  const brokerWise = brokers.map(b => {
    const bPayouts = payouts.filter(p => p.broker_id === b.id)
    return {
      ...b,
      total: bPayouts.reduce((s, p) => s + (p.net_amount || p.amount || 0), 0),
      count: bPayouts.length,
      paid: bPayouts.filter(p => p.status === 'paid').reduce((s, p) => s + (p.net_amount || 0), 0),
    }
  }).sort((a, b) => b.total - a.total)

  return (
    <div className="space-y-6">
      <h1 className="page-title">Reports</h1>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard title="Total Paid Out" value={formatINR(totalPaid)} icon={Banknote} color="green" />
        <KpiCard title="Pending Payout" value={formatINR(totalPending)} icon={TrendingUp} color="yellow" />
        <KpiCard title="Total TDS Deducted" value={formatINR(totalTDS)} icon={FileText} color="red" />
        <KpiCard title="Active Brokers" value={brokers.length} icon={Users} color="blue" />
      </div>

      <div className="card overflow-hidden">
        <div className="p-4 border-b border-slate-200"><h2 className="section-title">Broker-wise Payout Summary</h2></div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="bg-slate-50 border-b border-slate-200">
              {['Broker', 'ID', 'Transactions', 'Paid', 'Pending', 'Total Commission'].map(h => (
                <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-slate-500">{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {brokerWise.map(b => {
                const pending = payouts.filter(p => p.broker_id === b.id && p.status === 'pending').reduce((s, p) => s + (p.amount || 0), 0)
                return (
                  <tr key={b.id} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium">{b.name}</td>
                    <td className="px-4 py-3 text-slate-500">{b.broker_id}</td>
                    <td className="px-4 py-3">{b.count}</td>
                    <td className="px-4 py-3 text-green-700 font-medium">{formatINR(b.paid)}</td>
                    <td className="px-4 py-3 text-yellow-600">{formatINR(pending)}</td>
                    <td className="px-4 py-3 font-semibold">{formatINR(b.total)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}