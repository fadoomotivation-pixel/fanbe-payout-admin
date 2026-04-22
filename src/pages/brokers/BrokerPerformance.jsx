import { useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import LoadingSpinner from '../../components/ui/LoadingSpinner'
import { ArrowLeft, TrendingUp, IndianRupee, BookOpen, Users } from 'lucide-react'
import { formatINR } from '../../lib/utils'

const PAYOUT_STATUS_COLORS = {
  paid: 'bg-green-100 text-green-700',
  pending: 'bg-yellow-100 text-yellow-700',
  processing: 'bg-blue-100 text-blue-700',
  cancelled: 'bg-red-100 text-red-700',
}

function KpiCard({ label, value, sub, color = 'text-slate-900', icon }) {
  return (
    <div className="card p-4">
      <div className="flex items-center gap-2 text-slate-500 text-xs mb-1">
        {icon} {label}
      </div>
      <p className={`text-2xl font-bold mt-1 ${color}`}>{value}</p>
      {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
    </div>
  )
}

function MonthBar({ month, amount, max }) {
  const pct = max > 0 ? Math.round((amount / max) * 100) : 0
  return (
    <div className="flex items-center gap-3">
      <span className="text-xs text-slate-500 w-16 shrink-0">{month}</span>
      <div className="flex-1 bg-slate-100 rounded-full h-2 overflow-hidden">
        <div
          className="h-2 rounded-full bg-teal-500 transition-all duration-500"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-xs font-medium text-slate-700 w-20 text-right">{formatINR(amount)}</span>
    </div>
  )
}

export default function BrokerPerformance() {
  const { id } = useParams()
  const [dateRange, setDateRange] = useState('all') // all | this_year | last_6m | last_3m

  const { data: broker, isLoading: brokerLoading } = useQuery({
    queryKey: ['broker', id],
    queryFn: async () => {
      const { data } = await supabase.from('brokers').select('id, name, rank, mobile, status').eq('id', id).single()
      return data
    },
  })

  const { data: payouts = [], isLoading: payoutsLoading } = useQuery({
    queryKey: ['broker-payouts-perf', id],
    queryFn: async () => {
      const { data } = await supabase
        .from('bp_payout_transactions')
        .select('id, amount, tds_amount, net_amount, payout_type, status, created_at, bp_bookings(booking_no, project_id)')
        .eq('broker_id', id)
        .order('created_at', { ascending: false })
      return data || []
    },
  })

  const { data: teamCount = 0 } = useQuery({
    queryKey: ['broker-direct-count', id],
    queryFn: async () => {
      const { count } = await supabase
        .from('brokers')
        .select('id', { count: 'exact', head: true })
        .eq('upline_broker_id', id)
      return count || 0
    },
  })

  if (brokerLoading || payoutsLoading) return <LoadingSpinner fullPage />

  // Date filter
  function filterByDate(items) {
    const now = new Date()
    return items.filter(p => {
      const d = new Date(p.created_at)
      if (dateRange === 'last_3m') return (now - d) / (1000 * 60 * 60 * 24) <= 90
      if (dateRange === 'last_6m') return (now - d) / (1000 * 60 * 60 * 24) <= 180
      if (dateRange === 'this_year') return d.getFullYear() === now.getFullYear()
      return true
    })
  }

  const filtered = filterByDate(payouts)
  const paid = filtered.filter(p => p.status === 'paid')
  const pending = filtered.filter(p => p.status === 'pending')

  const totalEarned = paid.reduce((s, p) => s + (p.net_amount || p.amount || 0), 0)
  const totalPending = pending.reduce((s, p) => s + (p.amount || 0), 0)
  const totalTds = paid.reduce((s, p) => s + (p.tds_amount || 0), 0)
  const totalGross = paid.reduce((s, p) => s + (p.amount || 0), 0)

  // Monthly breakdown (last 12 months)
  const monthlyMap = {}
  const now = new Date()
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    const label = d.toLocaleDateString('en-IN', { month: 'short', year: '2-digit' })
    monthlyMap[key] = { label, amount: 0 }
  }
  paid.forEach(p => {
    const d = new Date(p.created_at)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    if (monthlyMap[key]) monthlyMap[key].amount += p.net_amount || p.amount || 0
  })
  const monthlyData = Object.values(monthlyMap)
  const maxMonthly = Math.max(...monthlyData.map(m => m.amount), 1)

  // Payout type breakdown
  const typeMap = {}
  filtered.forEach(p => {
    if (!typeMap[p.payout_type]) typeMap[p.payout_type] = { count: 0, amount: 0 }
    typeMap[p.payout_type].count++
    typeMap[p.payout_type].amount += p.net_amount || p.amount || 0
  })
  const typeBreakdown = Object.entries(typeMap).sort((a, b) => b[1].amount - a[1].amount)

  // Recent 10
  const recent = filtered.slice(0, 10)

  const RANK_LABELS = {
    associate: 'Associate', sales_officer: 'Sales Officer', senior_sales_officer: 'Sr. Sales Officer',
    team_leader: 'Team Leader', senior_team_leader: 'Sr. Team Leader', team_manager: 'Team Manager',
    senior_team_manager: 'Sr. Team Manager', area_manager: 'Area Manager', senior_area_manager: 'Sr. Area Manager',
    regional_manager: 'Regional Manager', senior_regional_manager: 'Sr. Regional Manager',
    zonal_manager: 'Zonal Manager', national_manager: 'National Manager',
    vice_president: 'Vice President', president: 'President',
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Link to={`/brokers/${id}`} className="p-2 rounded-lg hover:bg-slate-100">
            <ArrowLeft size={16} />
          </Link>
          <div>
            <h1 className="page-title">Performance</h1>
            <p className="text-sm text-slate-500">
              {broker?.name} · {RANK_LABELS[broker?.rank] || broker?.rank}
            </p>
          </div>
        </div>

        {/* Date Range Filter */}
        <div className="flex bg-slate-100 rounded-xl p-1 gap-1">
          {[
            { key: 'all', label: 'All Time' },
            { key: 'this_year', label: 'This Year' },
            { key: 'last_6m', label: '6 Months' },
            { key: 'last_3m', label: '3 Months' },
          ].map(r => (
            <button
              key={r.key}
              onClick={() => setDateRange(r.key)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                dateRange === r.key ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>

      {/* KPI Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard
          label="Net Earned"
          value={formatINR(totalEarned)}
          sub={`${paid.length} paid transactions`}
          color="text-green-700"
          icon={<IndianRupee size={13} />}
        />
        <KpiCard
          label="Gross Payout"
          value={formatINR(totalGross)}
          sub={`TDS deducted: ${formatINR(totalTds)}`}
          color="text-slate-900"
          icon={<TrendingUp size={13} />}
        />
        <KpiCard
          label="Pending Payout"
          value={formatINR(totalPending)}
          sub={`${pending.length} transactions`}
          color="text-yellow-600"
          icon={<BookOpen size={13} />}
        />
        <KpiCard
          label="Direct Team"
          value={teamCount}
          sub="direct reports"
          color="text-teal-700"
          icon={<Users size={13} />}
        />
      </div>

      {/* Monthly Chart + Type Breakdown */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Monthly Earnings */}
        <div className="md:col-span-2 card p-5">
          <h3 className="font-semibold text-slate-800 mb-4">Monthly Earnings (Last 12 Months)</h3>
          {monthlyData.every(m => m.amount === 0) ? (
            <p className="text-sm text-slate-400 py-6 text-center">No paid transactions to chart</p>
          ) : (
            <div className="space-y-3">
              {monthlyData.map(m => (
                <MonthBar key={m.label} month={m.label} amount={m.amount} max={maxMonthly} />
              ))}
            </div>
          )}
        </div>

        {/* Payout Type Breakdown */}
        <div className="card p-5">
          <h3 className="font-semibold text-slate-800 mb-4">By Payout Type</h3>
          {typeBreakdown.length === 0 ? (
            <p className="text-sm text-slate-400 py-6 text-center">No data</p>
          ) : (
            <div className="space-y-3">
              {typeBreakdown.map(([type, info]) => (
                <div key={type}>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs text-slate-600 capitalize">{type?.replace(/_/g, ' ')}</span>
                    <span className="text-xs font-medium text-slate-700">{info.count}×</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="flex-1 bg-slate-100 rounded-full h-1.5">
                      <div
                        className="h-1.5 rounded-full bg-teal-400"
                        style={{ width: `${Math.round((info.amount / (totalEarned || 1)) * 100)}%` }}
                      />
                    </div>
                    <span className="text-xs font-semibold text-slate-800 w-20 text-right">{formatINR(info.amount)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Recent Transactions */}
      <div className="card overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100">
          <h3 className="font-semibold text-slate-800">Recent Transactions</h3>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                {['Booking', 'Type', 'Gross', 'TDS', 'Net', 'Status', 'Date'].map(h => (
                  <th key={h} className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {recent.length === 0 && (
                <tr><td colSpan="7" className="px-4 py-10 text-center text-slate-400">No transactions in selected range</td></tr>
              )}
              {recent.map(p => (
                <tr key={p.id} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-3 text-teal-700 font-medium">{p.bp_bookings?.booking_no || '—'}</td>
                  <td className="px-4 py-3 capitalize text-slate-600">{p.payout_type?.replace(/_/g, ' ')}</td>
                  <td className="px-4 py-3">{formatINR(p.amount)}</td>
                  <td className="px-4 py-3 text-red-500">-{formatINR(p.tds_amount)}</td>
                  <td className="px-4 py-3 font-semibold">{formatINR(p.net_amount || p.amount)}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                      PAYOUT_STATUS_COLORS[p.status] || 'bg-slate-100 text-slate-600'
                    }`}>{p.status}</span>
                  </td>
                  <td className="px-4 py-3 text-slate-400 text-xs">
                    {new Date(p.created_at).toLocaleDateString('en-IN')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {filtered.length > 10 && (
          <div className="px-4 py-3 border-t border-slate-100 text-center">
            <Link to={`/brokers/${id}`} className="text-xs text-teal-700 hover:text-teal-900 font-medium">
              View all {filtered.length} transactions →
            </Link>
          </div>
        )}
      </div>
    </div>
  )
}
