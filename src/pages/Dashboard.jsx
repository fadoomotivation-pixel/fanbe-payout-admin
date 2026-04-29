import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import {
  Users, Building2, Map, FileText, Banknote, TrendingUp,
  Clock, AlertCircle, ArrowDownCircle, CheckCircle2,
  IndianRupee, CalendarDays
} from 'lucide-react'
import { formatINR, formatDate } from '../lib/utils'

function StatCard({ title, value, icon: Icon, color = 'teal', sub }) {
  const colors = {
    teal:   'bg-teal-50 text-teal-600',
    blue:   'bg-blue-50 text-blue-600',
    indigo: 'bg-indigo-50 text-indigo-600',
    green:  'bg-green-50 text-green-600',
    yellow: 'bg-yellow-50 text-yellow-700',
    red:    'bg-red-50 text-red-600',
    purple: 'bg-purple-50 text-purple-600',
    orange: 'bg-orange-50 text-orange-600',
  }
  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 flex items-start gap-3">
      <div className={`p-2 rounded-lg ${colors[color] || colors.teal}`}>
        <Icon size={18} />
      </div>
      <div className="min-w-0">
        <p className="text-xs text-gray-500 font-medium">{title}</p>
        <p className="text-xl font-bold text-gray-900 mt-0.5 truncate">{value}</p>
        {sub && <p className="text-xs text-gray-400 mt-0.5">{sub}</p>}
      </div>
    </div>
  )
}

function DonutChart({ segments, size = 140, centerSub = 'total' }) {
  const r = 48
  const cx = size / 2
  const cy = size / 2
  const circumference = 2 * Math.PI * r
  const total = segments.reduce((s, seg) => s + (seg.value || 0), 0)
  if (total === 0) return (
    <div className="flex items-center justify-center" style={{ width: size, height: size }}>
      <span className="text-xs text-gray-400">No data</span>
    </div>
  )
  let offset = 0
  const slices = segments.map(seg => {
    const dash = (seg.value / total) * circumference
    const slice = { ...seg, dash, offset: circumference - offset }
    offset += dash
    return slice
  })
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#f1f5f9" strokeWidth={22} />
      {slices.map((s, i) => (
        <circle key={i} cx={cx} cy={cy} r={r} fill="none" stroke={s.color}
          strokeWidth={22}
          strokeDasharray={`${s.dash} ${circumference - s.dash}`}
          strokeDashoffset={s.offset}
          style={{ transform: 'rotate(-90deg)', transformOrigin: `${cx}px ${cy}px` }}
        />
      ))}
      <text x={cx} y={cy} textAnchor="middle" dominantBaseline="central" fill="#374151" fontSize="13" fontWeight="700">{total}</text>
      <text x={cx} y={cy + 14} textAnchor="middle" fill="#9ca3af" fontSize="9">{centerSub}</text>
    </svg>
  )
}

function MiniTable({ title, rows, cols, emptyMsg = 'No data' }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm flex flex-col">
      <div className="px-4 py-3 border-b border-gray-100">
        <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
      </div>
      <div className="overflow-x-auto">
        {rows.length === 0
          ? <p className="text-center text-gray-400 text-xs py-6">{emptyMsg}</p>
          : (
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-gray-50">
                  {cols.map(c => <th key={c.key} className="text-left px-4 py-2 text-gray-500 font-medium">{c.label}</th>)}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {rows.map((row, i) => (
                  <tr key={i} className="hover:bg-gray-50">
                    {cols.map(c => (
                      <td key={c.key} className="px-4 py-2.5 text-gray-700">
                        {c.render ? c.render(row) : (row[c.key] ?? '—')}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )
        }
      </div>
    </div>
  )
}

export default function Dashboard() {
  const [loading, setLoading] = useState(true)
  const [stats, setStats] = useState({
    totalBrokers: 0, activeBrokers: 0, inactiveBrokers: 0, pendingKYC: 0,
    totalProjects: 0, totalPlots: 0, availablePlots: 0, bookedPlots: 0,
    revenueCollected: 0, pendingPayouts: 0, pendingEMI: 0,
    pendingWithdrawals: 0, totalWithdrawals: 0, monthlyWithdrawals: 0,
    income1: 0, income2: 0, income3: 0,
    bkCost: 0, bkReceipts: 0, bkPending: 0,
  })
  const [plotSegments, setPlotSegments] = useState([])
  const [teamSegments, setTeamSegments] = useState([])
  const [newBrokers, setNewBrokers] = useState([])
  const [newCustomers, setNewCustomers] = useState([])
  const [recentBookings, setRecentBookings] = useState([])
  const [pendingEMIList, setPendingEMIList] = useState([])
  const [dailyGrowth, setDailyGrowth] = useState([])

  useEffect(() => {
    async function load() {
      try {
        const now = new Date()
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
        const monthStartDate = monthStart.split('T')[0]

        const [
          brokerAll, brokerActive, brokerInactive, brokerKYC,
          projects, plots, payments, payoutsPending,
          newBrokersRes, newCustRes, recentBkRes, plotsAll, allBrokers
        ] = await Promise.all([
          supabase.from('brokers').select('id', { count: 'exact', head: true }),
          supabase.from('brokers').select('id', { count: 'exact', head: true }).eq('status', 'active'),
          supabase.from('brokers').select('id', { count: 'exact', head: true }).eq('status', 'inactive'),
          supabase.from('brokers').select('id', { count: 'exact', head: true }).eq('kyc_status', 'pending'),
          supabase.from('bp_projects').select('id', { count: 'exact', head: true }),
          supabase.from('bp_plots').select('status', { count: 'exact' }),
          supabase.from('bp_payments').select('amount').eq('status', 'paid'),
          supabase.from('bp_payout_transactions').select('amount').eq('status', 'pending'),
          supabase.from('brokers').select('id,name,rank,created_at').gte('created_at', monthStart).order('created_at', { ascending: false }).limit(8),
          supabase.from('bp_customers').select('id,name,phone,created_at').gte('created_at', monthStart).order('created_at', { ascending: false }).limit(8),
          supabase.from('bp_bookings').select('id,booking_date,total_amount,bp_customers(name),bp_plots(plot_number),bp_projects(name)').order('booking_date', { ascending: false }).limit(8),
          supabase.from('bp_plots').select('status'),
          supabase.from('brokers').select('rank,status'),
        ])

        // Plot status donut
        const statusCounts = {}
        ;(plotsAll.data || []).forEach(p => { statusCounts[p.status] = (statusCounts[p.status] || 0) + 1 })
        const segColors = { available: '#14b8a6', token: '#f59e0b', booked: '#6366f1', registry_done: '#22c55e', blocked: '#ef4444' }
        const segments = Object.entries(statusCounts).map(([k, v]) => ({ label: k, value: v, color: segColors[k] || '#94a3b8' }))

        // Team status donut
        const activeTeam = (allBrokers.data || []).filter(b => b.status === 'active').length
        const inactiveTeam = (allBrokers.data || []).filter(b => b.status !== 'active').length
        const teamSegs = [
          { label: 'Active', value: activeTeam, color: '#14b8a6' },
          { label: 'Inactive', value: inactiveTeam, color: '#ef4444' },
        ]

        const totalPlots = plots.count || 0
        const available = statusCounts.available || 0
        const booked = (statusCounts.booked || 0) + (statusCounts.token || 0)
        const revenue = (payments.data || []).reduce((s, r) => s + (Number(r.amount) || 0), 0)
        const pendingPay = (payoutsPending.data || []).reduce((s, r) => s + (Number(r.amount) || 0), 0)

        // EMI pending
        const { data: emiData } = await supabase.from('bp_bookings').select('id,balance_due,bp_customers(name),bp_projects(name),next_emi_date').gt('balance_due', 0).order('next_emi_date', { ascending: true }).limit(8)

        // Withdrawals
        const { data: wdAll } = await supabase.from('withdrawal_requests').select('amount,status,created_at')
        const pendingWD = (wdAll || []).filter(r => r.status === 'pending').reduce((s, r) => s + (Number(r.amount) || 0), 0)
        const totalWD = (wdAll || []).filter(r => r.status === 'paid').reduce((s, r) => s + (Number(r.amount) || 0), 0)
        const monthlyWD = (wdAll || []).filter(r => r.status === 'paid' && r.created_at >= monthStart).reduce((s, r) => s + (Number(r.amount) || 0), 0)

        // Income 1/2/3 from paid payout transactions
        const { data: payoutData } = await supabase.from('bp_payout_transactions').select('amount,type').eq('status', 'paid')
        const income1 = (payoutData || []).filter(p => p.type === 'on_booking').reduce((s, p) => s + (Number(p.amount) || 0), 0)
        const income2 = (payoutData || []).filter(p => ['milestone', 'registry'].includes(p.type)).reduce((s, p) => s + (Number(p.amount) || 0), 0)
        const income3 = (payoutData || []).filter(p => ['referral', 'override', 'bonus'].includes(p.type)).reduce((s, p) => s + (Number(p.amount) || 0), 0)

        // Bookings this month: Cost / Receipts / Pending
        const { data: monthBk } = await supabase.from('bp_bookings').select('total_amount,paid_amount,balance_due').gte('booking_date', monthStartDate)
        const bkCost = (monthBk || []).reduce((s, b) => s + (Number(b.total_amount) || 0), 0)
        const bkReceipts = (monthBk || []).reduce((s, b) => s + (Number(b.paid_amount) || 0), 0)
        const bkPending = (monthBk || []).reduce((s, b) => s + (Number(b.balance_due) || 0), 0)

        // Daily growth — last 30 days
        const thirtyDaysAgo = new Date()
        thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 29)
        const { data: growthData } = await supabase.from('bp_bookings').select('booking_date,total_amount').gte('booking_date', thirtyDaysAgo.toISOString().split('T')[0])
        const growthMap = {}
        for (let i = 29; i >= 0; i--) {
          const d = new Date()
          d.setDate(d.getDate() - i)
          const key = d.toISOString().split('T')[0]
          growthMap[key] = {
            date: key,
            label: (i % 7 === 0 || i === 0) ? d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : '',
            amount: 0,
          }
        }
        ;(growthData || []).forEach(b => { if (growthMap[b.booking_date]) growthMap[b.booking_date].amount += Number(b.total_amount) || 0 })

        setStats({
          totalBrokers: brokerAll.count || 0, activeBrokers: brokerActive.count || 0,
          inactiveBrokers: brokerInactive.count || 0, pendingKYC: brokerKYC.count || 0,
          totalProjects: projects.count || 0, totalPlots, availablePlots: available, bookedPlots: booked,
          revenueCollected: revenue, pendingPayouts: pendingPay,
          pendingEMI: (emiData || []).length,
          pendingWithdrawals: pendingWD, totalWithdrawals: totalWD, monthlyWithdrawals: monthlyWD,
          income1, income2, income3, bkCost, bkReceipts, bkPending,
        })
        setPlotSegments(segments)
        setTeamSegments(teamSegs)
        setNewBrokers(newBrokersRes.data || [])
        setNewCustomers(newCustRes.data || [])
        setRecentBookings(recentBkRes.data || [])
        setPendingEMIList(emiData || [])
        setDailyGrowth(Object.values(growthMap))
      } catch (e) {
        console.error('Dashboard load error', e)
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  const L = loading ? '—' : null
  const maxGrowth = Math.max(...dailyGrowth.map(d => d.amount), 1)

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-sm text-gray-500">Overview of Fanbe Group operations</p>
      </div>

      {/* Row 1 — Broker stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard title="Total Brokers" value={L ?? stats.totalBrokers} icon={Users} color="blue" />
        <StatCard title="Active Brokers" value={L ?? stats.activeBrokers} icon={CheckCircle2} color="green" />
        <StatCard title="Inactive Brokers" value={L ?? stats.inactiveBrokers} icon={Users} color="red" />
        <StatCard title="Pending KYC" value={L ?? stats.pendingKYC} icon={Clock} color="yellow" sub="needs review" />
      </div>

      {/* Row 2 — Inventory */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard title="Total Projects" value={L ?? stats.totalProjects} icon={Building2} color="indigo" />
        <StatCard title="Total Plots" value={L ?? stats.totalPlots} icon={Map} color="teal" />
        <StatCard title="Available Plots" value={L ?? stats.availablePlots} icon={Map} color="green" />
        <StatCard title="Booked / Token" value={L ?? stats.bookedPlots} icon={FileText} color="purple" />
      </div>

      {/* Row 3 — New Bookings this month widget + payout/EMI */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
          <p className="text-xs text-gray-500 font-medium mb-3 flex items-center gap-1.5">
            <CalendarDays size={13} /> New Bookings — This Month
          </p>
          <div className="grid grid-cols-3 gap-2 text-center">
            <div className="bg-blue-50 rounded-lg p-2.5">
              <p className="text-xs text-gray-500">Total Cost</p>
              <p className="text-sm font-bold text-blue-700 mt-0.5">{L ?? formatINR(stats.bkCost)}</p>
            </div>
            <div className="bg-green-50 rounded-lg p-2.5">
              <p className="text-xs text-gray-500">Receipts</p>
              <p className="text-sm font-bold text-green-700 mt-0.5">{L ?? formatINR(stats.bkReceipts)}</p>
            </div>
            <div className="bg-orange-50 rounded-lg p-2.5">
              <p className="text-xs text-gray-500">Pending</p>
              <p className="text-sm font-bold text-orange-700 mt-0.5">{L ?? formatINR(stats.bkPending)}</p>
            </div>
          </div>
        </div>
        <StatCard title="Pending Payouts" value={L ?? formatINR(stats.pendingPayouts)} icon={Banknote} color="yellow" sub="awaiting approval" />
        <StatCard title="Pending EMI" value={L ?? stats.pendingEMI} icon={AlertCircle} color="orange" sub="bookings with balance due" />
      </div>

      {/* Row 4 — Income 1/2/3 breakdown */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard title="Revenue Collected" value={L ?? formatINR(stats.revenueCollected)} icon={TrendingUp} color="green" sub="all payments received" />
        <StatCard title="Income 1 — Booking" value={L ?? formatINR(stats.income1)} icon={IndianRupee} color="teal" sub="on-booking commission" />
        <StatCard title="Income 2 — Milestone" value={L ?? formatINR(stats.income2)} icon={IndianRupee} color="blue" sub="milestone + registry" />
        <StatCard title="Income 3 — Referral" value={L ?? formatINR(stats.income3)} icon={IndianRupee} color="purple" sub="referral + override + bonus" />
      </div>

      {/* Row 5 — Withdrawals */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        <StatCard title="Pending Withdrawals" value={L ?? formatINR(stats.pendingWithdrawals)} icon={ArrowDownCircle} color="red" sub="broker requests" />
        <StatCard title="Total Withdrawals Paid" value={L ?? formatINR(stats.totalWithdrawals)} icon={ArrowDownCircle} color="orange" sub="all time" />
        <StatCard title="Monthly Withdrawals" value={L ?? formatINR(stats.monthlyWithdrawals)} icon={ArrowDownCircle} color="yellow" sub="this month" />
      </div>

      {/* Mini tables row 1 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <MiniTable title="New Agents This Month" rows={newBrokers} emptyMsg="No new agents this month"
          cols={[
            { key: 'name', label: 'Name' },
            { key: 'rank', label: 'Rank' },
            { key: 'created_at', label: 'Joined', render: r => formatDate(r.created_at) },
          ]}
        />
        <MiniTable title="New Customers This Month" rows={newCustomers} emptyMsg="No new customers this month"
          cols={[
            { key: 'name', label: 'Name' },
            { key: 'phone', label: 'Phone' },
            { key: 'created_at', label: 'Added', render: r => formatDate(r.created_at) },
          ]}
        />
      </div>

      {/* Mini tables row 2 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <MiniTable title="Recent Bookings" rows={recentBookings} emptyMsg="No bookings yet"
          cols={[
            { key: 'customer', label: 'Customer', render: r => r.bp_customers?.name || '—' },
            { key: 'plot', label: 'Plot', render: r => r.bp_plots?.plot_number || '—' },
            { key: 'total_amount', label: 'Amount', render: r => formatINR(r.total_amount) },
            { key: 'booking_date', label: 'Date', render: r => formatDate(r.booking_date) },
          ]}
        />
        <MiniTable title="Pending EMI Instalments" rows={pendingEMIList} emptyMsg="No pending EMI"
          cols={[
            { key: 'customer', label: 'Customer', render: r => r.bp_customers?.name || '—' },
            { key: 'project', label: 'Project', render: r => r.bp_projects?.name || '—' },
            { key: 'balance_due', label: 'Balance', render: r => formatINR(r.balance_due) },
            { key: 'next_emi_date', label: 'Due', render: r => r.next_emi_date ? formatDate(r.next_emi_date) : '—' },
          ]}
        />
      </div>

      {/* Chart row: Plot Status + Team Status + Business Growth */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
          <h3 className="text-sm font-semibold text-gray-900 mb-4">Plot Status</h3>
          <div className="flex items-center gap-4">
            <DonutChart segments={plotSegments} size={130} centerSub="total plots" />
            <div className="space-y-1.5">
              {plotSegments.map(s => (
                <div key={s.label} className="flex items-center gap-2 text-xs">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: s.color }} />
                  <span className="text-gray-600 capitalize">{s.label.replace('_', ' ')}</span>
                  <span className="font-semibold text-gray-900 ml-auto pl-2">{s.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
          <h3 className="text-sm font-semibold text-gray-900 mb-4">Team Status</h3>
          <div className="flex items-center gap-4">
            <DonutChart segments={teamSegments} size={130} centerSub="total agents" />
            <div className="space-y-1.5">
              {teamSegments.map(s => (
                <div key={s.label} className="flex items-center gap-2 text-xs">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: s.color }} />
                  <span className="text-gray-600">{s.label}</span>
                  <span className="font-semibold text-gray-900 ml-auto pl-2">{s.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
          <h3 className="text-sm font-semibold text-gray-900 mb-1">Business Growth</h3>
          <p className="text-xs text-gray-400 mb-3">Daily bookings — current month</p>
          <div className="flex items-end gap-0.5 h-28">
            {dailyGrowth.map((d, i) => {
              const pct = (d.amount / maxGrowth) * 100
              return (
                <div key={i} className="flex-1 flex flex-col items-center" title={`${d.date}: ${formatINR(d.amount)}`}>
                  <div
                    className={`w-full rounded-t-sm transition-all ${d.amount > 0 ? 'bg-teal-500' : 'bg-gray-100'}`}
                    style={{ height: `${Math.max(pct, 2)}%`, minHeight: 3 }}
                  />
                  {d.label && (
                    <span className="text-gray-400 mt-0.5 leading-none" style={{ fontSize: 7 }}>{d.label}</span>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
