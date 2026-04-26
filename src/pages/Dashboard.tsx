import { useQuery } from '@tanstack/react-query'
import { supabase } from '../lib/supabase'
import { formatINR } from '../lib/utils'
import { Link } from 'react-router-dom'
import {
  TrendingUp, Users, Home, CreditCard, Clock,
  AlertCircle, CheckCircle2, BarChart2, ArrowRight, FileText
} from 'lucide-react'

function KpiCard({ label, value, sub, icon: Icon, color = 'text-teal-700', link }: any) {
  const inner = (
    <div className="card p-5 flex items-start gap-4 hover:shadow-md transition-shadow">
      <div className={`p-2.5 rounded-xl bg-slate-100 ${color}`}>
        <Icon size={20} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs text-slate-500 font-medium">{label}</p>
        <p className={`text-2xl font-bold mt-0.5 ${color}`}>{value ?? '…'}</p>
        {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
      </div>
    </div>
  )
  return link ? <Link to={link}>{inner}</Link> : <div>{inner}</div>
}

export default function Dashboard() {
  const { data: stats } = useQuery({
    queryKey: ['dashboard-stats'],
    queryFn: async () => {
      const [bookingsRes, plotsRes, brokersRes, payoutsRes, kycRes, withdrawRes, receiptsRes, ticketsRes] = await Promise.all([
        supabase.from('bp_bookings').select('id, stage, total_collected, balance_due, created_at').order('created_at', { ascending: false }),
        supabase.from('bp_plots').select('id, status, total_price'),
        supabase.from('brokers').select('id, kyc_status, is_active'),
        supabase.from('bp_payout_transactions').select('id, status, net_amount').eq('status', 'pending'),
        supabase.from('bp_broker_kyc').select('id, status').eq('status', 'pending'),
        supabase.from('bp_withdrawal_requests').select('id, status, amount').eq('status', 'pending'),
        supabase.from('bp_booking_receipts').select('amount, created_at').gte('created_at', new Date(Date.now() - 30 * 86400000).toISOString()),
        supabase.from('bp_support_tickets').select('id, status').eq('status', 'open'),
      ])

      const bookings = bookingsRes.data || []
      const plots = plotsRes.data || []
      const brokers = brokersRes.data || []
      const pendingPayouts = payoutsRes.data || []
      const pendingKyc = kycRes.data || []
      const pendingWithdrawals = withdrawRes.data || []
      const receipts30d = receiptsRes.data || []
      const openTickets = ticketsRes.data || []

      const totalBookings = bookings.length
      const activeBookings = bookings.filter(b => !['cancelled'].includes(b.stage)).length
      const totalCollected = bookings.reduce((s, b) => s + Number(b.total_collected || 0), 0)
      const totalBalance = bookings.reduce((s, b) => s + Number(b.balance_due || 0), 0)
      const availablePlots = plots.filter(p => p.status === 'available').length
      const inventoryValue = plots.filter(p => p.status === 'available').reduce((s, p) => s + Number(p.total_price || 0), 0)
      const activeBrokers = brokers.filter(b => b.is_active).length
      const pendingPayoutTotal = pendingPayouts.reduce((s, p) => s + Number(p.net_amount || 0), 0)
      const pendingWithdrawTotal = pendingWithdrawals.reduce((s, w) => s + Number(w.amount || 0), 0)
      const collected30d = receipts30d.reduce((s, r) => s + Number(r.amount || 0), 0)

      const recentBookings = bookings.slice(0, 5)

      return {
        totalBookings, activeBookings, totalCollected, totalBalance,
        availablePlots, inventoryValue, activeBrokers,
        pendingPayoutTotal, pendingPayouts: pendingPayouts.length,
        pendingKyc: pendingKyc.length,
        pendingWithdrawTotal, pendingWithdrawals: pendingWithdrawals.length,
        collected30d,
        openTickets: openTickets.length,
        recentBookings,
      }
    },
    staleTime: 60_000,
  })

  const s = stats

  return (
    <div className="space-y-6">
      <div>
        <h1 className="page-title">Dashboard</h1>
        <p className="text-sm text-slate-500 mt-0.5">Fanbe Group Admin Overview</p>
      </div>

      {/* ── Admin KPIs ── */}
      <div>
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Bookings &amp; Collections</p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KpiCard label="Total Bookings" value={s?.totalBookings} icon={FileText} link="/bookings" />
          <KpiCard label="Total Collected" value={formatINR(s?.totalCollected)} icon={TrendingUp} color="text-green-700" link="/bookings" />
          <KpiCard label="Balance Due" value={formatINR(s?.totalBalance)} icon={AlertCircle} color="text-red-600" />
          <KpiCard label="Collected (30d)" value={formatINR(s?.collected30d)} sub="Last 30 days" icon={BarChart2} color="text-blue-700" />
        </div>
      </div>

      <div>
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Inventory &amp; Brokers</p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <KpiCard label="Available Plots" value={s?.availablePlots} icon={Home} link="/inventory" />
          <KpiCard label="Inventory Value" value={formatINR(s?.inventoryValue)} icon={TrendingUp} color="text-teal-700" link="/inventory/pricing" />
          <KpiCard label="Active Brokers" value={s?.activeBrokers} icon={Users} color="text-indigo-700" link="/brokers" />
          <KpiCard label="Open Tickets" value={s?.openTickets} icon={AlertCircle} color={s?.openTickets > 0 ? 'text-orange-600' : 'text-slate-500'} link="/support" />
        </div>
      </div>

      {/* ── Finance Widgets ── */}
      <div>
        <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-3">Finance Actions Required</p>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <Link to="/payouts" className="card p-4 flex items-center gap-3 hover:shadow-md transition-shadow">
            <div className="p-2.5 rounded-xl bg-orange-100">
              <CreditCard size={18} className="text-orange-600" />
            </div>
            <div>
              <p className="text-xs text-slate-500">Pending Payouts</p>
              <p className="font-bold text-orange-600">{s?.pendingPayouts ?? 0} · {formatINR(s?.pendingPayoutTotal)}</p>
            </div>
            <ArrowRight size={14} className="ml-auto text-slate-400" />
          </Link>

          <Link to="/withdrawals" className="card p-4 flex items-center gap-3 hover:shadow-md transition-shadow">
            <div className="p-2.5 rounded-xl bg-yellow-100">
              <Clock size={18} className="text-yellow-600" />
            </div>
            <div>
              <p className="text-xs text-slate-500">Withdrawal Requests</p>
              <p className="font-bold text-yellow-700">{s?.pendingWithdrawals ?? 0} · {formatINR(s?.pendingWithdrawTotal)}</p>
            </div>
            <ArrowRight size={14} className="ml-auto text-slate-400" />
          </Link>

          <Link to="/kyc" className="card p-4 flex items-center gap-3 hover:shadow-md transition-shadow">
            <div className="p-2.5 rounded-xl bg-purple-100">
              <CheckCircle2 size={18} className="text-purple-600" />
            </div>
            <div>
              <p className="text-xs text-slate-500">KYC Pending Review</p>
              <p className="font-bold text-purple-700">{s?.pendingKyc ?? 0} submissions</p>
            </div>
            <ArrowRight size={14} className="ml-auto text-slate-400" />
          </Link>
        </div>
      </div>

      {/* ── Recent Bookings ── */}
      {s?.recentBookings?.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider">Recent Bookings</p>
            <Link to="/bookings" className="text-xs text-teal-600 hover:text-teal-800 font-medium flex items-center gap-1">
              View all <ArrowRight size={12} />
            </Link>
          </div>
          <div className="card overflow-hidden">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  {['Booking No', 'Stage', 'Collected', 'Balance'].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-slate-500">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {s.recentBookings.map((b: any) => (
                  <tr key={b.id} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <Link to={`/bookings/${b.id}`} className="font-medium text-teal-700 hover:underline">
                        {b.booking_no || b.id.slice(0, 8)}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex px-2 py-0.5 rounded-full text-xs bg-slate-100 text-slate-600 capitalize">
                        {b.stage?.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-green-700 font-medium">{formatINR(b.total_collected)}</td>
                    <td className="px-4 py-3">
                      <span className={Number(b.balance_due) > 0 ? 'text-red-600 font-medium' : 'text-slate-400'}>
                        {formatINR(b.balance_due)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
