import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { formatINR, formatDate } from '@/lib/utils'
import { Users, Briefcase, CalendarClock, ShieldAlert, ArrowRight, Building2, Map, FileText, TrendingUp } from 'lucide-react'

// One Dashboard.  The old Dashboard.jsx that lived alongside this file was being picked
// up by Vite's resolver and rendered instead — every monetary tile read ₹0 because its
// queries hit non-existent columns (e.g. bp_payments.status when the real column is
// verification_status).  Removed the .jsx and folded its useful visuals (plot donut,
// monthly tables, growth chart) into this file with the correct queries.

type Tile = { label: string; value: string; sub?: string; color?: string; href?: string }

export default function Dashboard() {
  const [loading, setLoading] = useState(true)
  const [tiles, setTiles] = useState<Tile[]>([])
  const [inventory, setInventory] = useState<Tile[]>([])
  const [followUps, setFollowUps] = useState({ kycPending: 0, pipelineActive: 0, emiOverdue: 0, emiOverdueAmount: 0, openWithdrawals: 0 })
  const [payables, setPayables] = useState({ accrued: 0, paidThisMonth: 0, pending: 0, brokerCount: 0, openWdCount: 0 })
  const [recentBookings, setRecentBookings] = useState<any[]>([])
  const [recentPayments, setRecentPayments] = useState<any[]>([])
  const [newBrokers, setNewBrokers] = useState<any[]>([])
  const [newCustomers, setNewCustomers] = useState<any[]>([])
  const [plotSegments, setPlotSegments] = useState<{ label: string; value: number; color: string }[]>([])
  const [dailyGrowth, setDailyGrowth] = useState<{ date: string; label: string; amount: number }[]>([])

  useEffect(() => {
    async function load() {
      const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0,0,0,0)
      const monthStartISO = monthStart.toISOString()
      const monthStartDay = monthStartISO.slice(0, 10)
      const today = new Date().toISOString().slice(0, 10)

      const sevenDaysAgo = new Date(); sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6); sevenDaysAgo.setHours(0,0,0,0)
      const sevenDayStart = sevenDaysAgo.toISOString().slice(0, 10)

      const [
        brokerCount, customerCount, bookingDoneCount, projectsCount, plotsCount,
        payments, distributions, payoutTxns, openWds,
        recentBk, recentPm, newBrokersRes, newCustomersRes,
        plotsBreakdown, weekBookings,
        kycPendingQ, pipelineActiveQ, emiOverdueQ,
      ] = await Promise.all([
        supabase.from('brokers').select('id', { count: 'exact', head: true }).eq('status', 'active'),
        supabase.from('bp_customers').select('id', { count: 'exact', head: true }),
        supabase.from('bp_bookings').select('id', { count: 'exact', head: true }).eq('stage', 'booking_done'),
        supabase.from('bp_projects').select('id', { count: 'exact', head: true }),
        supabase.from('bp_plots').select('id', { count: 'exact', head: true }),
        supabase.from('bp_payments').select('amount,verification_status,payment_date').eq('verification_status', 'verified'),
        supabase.from('payout_distributions').select('beneficiary_broker_id, net_payout'),
        supabase.from('bp_payout_transactions').select('net_amount, amount, status, paid_date'),
        supabase.from('withdrawal_requests').select('id, status', { count: 'exact' }).in('status', ['pending', 'approved']),
        supabase.from('bp_bookings').select('id, booking_no, application_date, total_amount, stage, customer_id, bp_customers(name)').order('application_date', { ascending: false }).limit(5),
        supabase.from('bp_payments').select('id, amount, payment_type, payment_date, receipt_no, booking_id, bp_bookings(booking_no, bp_customers(name))').order('payment_date', { ascending: false }).limit(5),
        supabase.from('brokers').select('id, name, rank, broker_id, created_at').gte('created_at', monthStartISO).order('created_at', { ascending: false }).limit(6),
        supabase.from('bp_customers').select('id, name, phone, created_at').gte('created_at', monthStartISO).order('created_at', { ascending: false }).limit(6),
        supabase.from('bp_plots').select('status'),
        supabase.from('bp_bookings').select('application_date, total_amount').gte('application_date', sevenDayStart),
        supabase.from('brokers').select('id', { count: 'exact', head: true }).eq('kyc_status', 'pending'),
        supabase.from('bp_bookings').select('id', { count: 'exact', head: true }).not('stage', 'in', '(booking_done,cancelled)'),
        supabase.from('emi_installments').select('amount, status, due_date').neq('status', 'paid').lt('due_date', today),
      ])

      const totalRevenue = (payments.data || []).reduce((s, p) => s + Number(p.amount || 0), 0)
      const revenueThisMonth = (payments.data || []).filter(p => (p.payment_date || '') >= monthStartDay).reduce((s, p) => s + Number(p.amount || 0), 0)

      const earned = (distributions.data || []).reduce((s: number, d: any) => s + Number(d.net_payout || 0), 0)
      const paidThisMonth = (payoutTxns.data || [])
        .filter((t: any) => t.status === 'paid' && (t.paid_date || '') >= monthStartDay)
        .reduce((s: number, t: any) => s + Number(t.net_amount || t.amount || 0), 0)
      const pending = Math.max(0, earned - paidThisMonth)
      const brokerSet = new Set((distributions.data || []).map((d: any) => d.beneficiary_broker_id).filter(Boolean))
      const openWdCount = openWds.count || 0

      const emiOverdueCount = (emiOverdueQ.data || []).length
      const emiOverdueAmt   = (emiOverdueQ.data || []).reduce((s: number, r: any) => s + Number(r.amount || 0), 0)

      // Plot status breakdown — for the donut.  Categorise by status with friendly colours.
      const statusCounts: Record<string, number> = {}
      for (const p of (plotsBreakdown.data || []) as any[]) {
        const k = p.status || 'unknown'
        statusCounts[k] = (statusCounts[k] || 0) + 1
      }
      const segColors: Record<string, string> = {
        available: '#14b8a6', token: '#f59e0b', booked: '#6366f1',
        sold: '#22c55e', cancelled: '#ef4444', blocked: '#94a3b8', unknown: '#94a3b8',
      }
      const segments = Object.entries(statusCounts).map(([k, v]) => ({ label: k, value: v, color: segColors[k] || '#94a3b8' }))

      // Daily growth — last 7 days bookings volume
      const growthMap: Record<string, { date: string; label: string; amount: number }> = {}
      for (let i = 6; i >= 0; i--) {
        const d = new Date(); d.setDate(d.getDate() - i)
        const key = d.toISOString().slice(0, 10)
        growthMap[key] = { date: key, label: d.toLocaleDateString('en-IN', { weekday: 'short' }), amount: 0 }
      }
      for (const b of (weekBookings.data || []) as any[]) {
        if (b.application_date && growthMap[b.application_date]) growthMap[b.application_date].amount += Number(b.total_amount || 0)
      }

      // Headline tiles
      setTiles([
        { label: 'Active Brokers',     value: String(brokerCount.count || 0), color: 'text-blue-700',     href: '/brokers' },
        { label: 'Total Customers',    value: String(customerCount.count || 0), color: 'text-gray-900',   href: '/customer-pipeline' },
        { label: 'Confirmed Bookings', value: String(bookingDoneCount.count || 0), color: 'text-emerald-700', href: '/customer-pipeline?tab=settled' },
        { label: 'Revenue (verified)', value: formatINR(totalRevenue), sub: `This month: ${formatINR(revenueThisMonth)}`, color: 'text-green-700', href: '/payments' },
      ])

      // Inventory row — projects + plot status, with deep links
      const plots = plotsCount.count || 0
      setInventory([
        { label: 'Total Projects',  value: String(projectsCount.count || 0), color: 'text-indigo-700', href: '/projects' },
        { label: 'Total Plots',     value: String(plots),                    color: 'text-teal-700',   href: '/plots' },
        { label: 'Available Plots', value: String(statusCounts.available || 0), color: 'text-emerald-700', href: '/plots' },
        { label: 'Booked / Token',  value: String((statusCounts.booked || 0) + (statusCounts.token || 0)), color: 'text-purple-700', href: '/plots' },
      ])

      setFollowUps({
        kycPending:      kycPendingQ.count || 0,
        pipelineActive:  pipelineActiveQ.count || 0,
        emiOverdue:      emiOverdueCount,
        emiOverdueAmount: emiOverdueAmt,
        openWithdrawals: openWdCount,
      })
      setPayables({ accrued: earned, paidThisMonth, pending, brokerCount: brokerSet.size, openWdCount })
      setRecentBookings(recentBk.data || [])
      setRecentPayments(recentPm.data || [])
      setNewBrokers(newBrokersRes.data || [])
      setNewCustomers(newCustomersRes.data || [])
      setPlotSegments(segments)
      setDailyGrowth(Object.values(growthMap))
      setLoading(false)
    }
    load()
  }, [])

  const maxGrowth = Math.max(...dailyGrowth.map(d => d.amount), 1)
  const skeleton = (n: number) => Array.from({ length: n }, () => ({ label: '…', value: '—' } as Tile))

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-sm text-gray-500">Operational health at a glance</p>
      </div>

      {/* Follow-ups strip — coloured when there's work waiting */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <FollowUp icon={<ShieldAlert size={14}/>}   label="KYC pending"      value={String(followUps.kycPending)}      href="/kyc"                              active={followUps.kycPending > 0}      tone="amber"/>
        <FollowUp icon={<Briefcase size={14}/>}     label="Pipeline active"  value={String(followUps.pipelineActive)}   href="/customer-pipeline"                active={followUps.pipelineActive > 0}  tone="indigo"/>
        <FollowUp icon={<CalendarClock size={14}/>} label="EMI overdue"      value={String(followUps.emiOverdue)} sub={followUps.emiOverdueAmount > 0 ? formatINR(followUps.emiOverdueAmount) : undefined} href="/customer-pipeline?tab=emi_active" active={followUps.emiOverdue > 0} tone="rose"/>
        <FollowUp icon={<Users size={14}/>}         label="Open withdrawals" value={String(followUps.openWithdrawals)}  href="/withdrawals"                     active={followUps.openWithdrawals > 0} tone="blue"/>
      </div>

      {/* Headline tiles */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {(loading ? skeleton(4) : tiles).map((t, i) => {
          const card = (
            <div key={i} className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm hover:border-gray-300 transition-colors">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">{t.label}</p>
              <p className={`text-2xl font-bold mt-1 ${t.color || 'text-gray-900'}`}>{t.value}</p>
              {t.sub && <p className="text-[11px] text-gray-400 mt-1">{t.sub}</p>}
            </div>
          )
          return t.href ? <Link key={i} to={t.href}>{card}</Link> : card
        })}
      </div>

      {/* Inventory row — projects + plot status */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {(loading ? skeleton(4) : inventory).map((t, i) => {
          const icon = i === 0 ? <Building2 size={16}/> : i === 1 ? <Map size={16}/> : i === 2 ? <Map size={16}/> : <FileText size={16}/>
          const inner = (
            <div className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm hover:border-gray-300 transition-colors flex items-start gap-3">
              <div className={`p-2 rounded-lg ${t.color?.replace('text-', 'bg-').replace('-700', '-50') || 'bg-gray-50'}`}>
                <span className={t.color}>{icon}</span>
              </div>
              <div className="min-w-0">
                <p className="text-xs text-gray-500 font-medium">{t.label}</p>
                <p className={`text-xl font-bold mt-0.5 ${t.color || 'text-gray-900'}`}>{t.value}</p>
              </div>
            </div>
          )
          return t.href ? <Link key={i} to={t.href}>{inner}</Link> : inner
        })}
      </div>

      {/* Broker Payables card */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
        <div className="flex items-start justify-between mb-3">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">Broker Payables</h3>
            <p className="text-xs text-gray-500">Distributed commission vs. what you've paid out — same numbers brokers see on their dashboards.</p>
          </div>
          <Link to="/payouts" className="text-xs text-blue-600 hover:underline">Open Payouts →</Link>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <PayTile label="Earned (Distributed)" value={formatINR(payables.accrued)}        sub={`${payables.brokerCount} brokers`}        color="text-blue-700"/>
          <PayTile label="Paid (This Month)"    value={formatINR(payables.paidThisMonth)}  sub="cycle batches paid this month"            color="text-green-700"/>
          <PayTile label="Pending Payout"       value={formatINR(payables.pending)}        sub="earned − paid this month"                 color={payables.pending > 0 ? 'text-orange-700' : 'text-gray-500'}/>
          <PayTile label="Open Withdrawals"     value={String(payables.openWdCount)}        sub={<Link to="/withdrawals" className="text-blue-600 hover:underline">awaiting approval →</Link>} color="text-gray-900"/>
        </div>
      </div>

      {/* Plot status donut + 7-day growth chart */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
          <h3 className="text-sm font-semibold text-gray-900 mb-4">Plot Status</h3>
          <div className="flex items-center gap-5">
            <Donut segments={plotSegments} size={130}/>
            <div className="space-y-2 flex-1 min-w-0">
              {plotSegments.length === 0 ? (
                <div className="text-xs text-gray-400">No plots yet — add via the Plots page.</div>
              ) : plotSegments.map(s => (
                <div key={s.label} className="flex items-center gap-2 text-xs">
                  <span className="w-3 h-3 rounded-full shrink-0" style={{ background: s.color }} />
                  <span className="text-gray-600 capitalize">{s.label.replace(/_/g, ' ')}</span>
                  <span className="font-semibold text-gray-900 ml-auto tabular-nums">{s.value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-gray-900 inline-flex items-center gap-1.5"><TrendingUp size={14}/>Daily booking volume · last 7 days</h3>
            <span className="text-[11px] text-gray-400">Total: {formatINR(dailyGrowth.reduce((s, d) => s + d.amount, 0))}</span>
          </div>
          <div className="flex items-end gap-2 h-32">
            {dailyGrowth.map((d, i) => {
              const pct = maxGrowth > 0 ? (d.amount / maxGrowth) * 100 : 0
              return (
                <div key={i} className="flex-1 flex flex-col items-center gap-1">
                  <span className="text-[9px] text-gray-400">{d.amount > 0 ? formatINR(d.amount).replace('₹', '') : ''}</span>
                  <div className="w-full rounded-t-sm bg-teal-500 transition-all" style={{ height: `${Math.max(pct, 2)}%`, minHeight: 3, opacity: d.amount > 0 ? 1 : 0.2 }} />
                  <span className="text-[10px] text-gray-500">{d.label}</span>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* This-month tables */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <MiniTable title={`New Brokers This Month (${newBrokers.length})`} rows={newBrokers} emptyMsg="No new brokers this month"
          cols={[
            { label: 'Name', render: (r: any) => <Link to={`/brokers/${r.id}`} className="text-blue-700 hover:underline">{r.name}</Link> },
            { label: 'Rank', render: (r: any) => <span className="text-gray-600">{r.rank || '—'}</span> },
            { label: 'Joined', render: (r: any) => <span className="text-gray-400 text-xs">{formatDate(r.created_at)}</span> },
          ]}/>
        <MiniTable title={`New Customers This Month (${newCustomers.length})`} rows={newCustomers} emptyMsg="No new customers this month"
          cols={[
            { label: 'Name', render: (r: any) => <span className="text-gray-800">{r.name}</span> },
            { label: 'Phone', render: (r: any) => <span className="text-gray-600">{r.phone || '—'}</span> },
            { label: 'Added', render: (r: any) => <span className="text-gray-400 text-xs">{formatDate(r.created_at)}</span> },
          ]}/>
      </div>

      {/* Recent activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
          <div className="flex items-center justify-between mb-3"><h3 className="text-sm font-semibold text-gray-900">Recent Bookings</h3><Link to="/customer-pipeline" className="text-xs text-blue-600 hover:underline">view all</Link></div>
          {!recentBookings.length ? <p className="text-sm text-gray-400">No bookings yet.</p> : (
            <div className="divide-y divide-gray-50">
              {recentBookings.map(b => (
                <Link key={b.id} to={`/customer-pipeline?search=${encodeURIComponent(b.booking_no || '')}`} className="py-2 flex items-center justify-between text-sm hover:bg-gray-50 -mx-2 px-2 rounded">
                  <div>
                    <div className="font-mono text-xs text-blue-700">{b.booking_no}</div>
                    <div className="text-xs text-gray-500">{b.bp_customers?.name || '—'} · {b.stage}</div>
                  </div>
                  <div className="font-semibold inline-flex items-center gap-1">{formatINR(b.total_amount)}<ArrowRight size={11} className="text-gray-300"/></div>
                </Link>
              ))}
            </div>
          )}
        </div>

        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
          <div className="flex items-center justify-between mb-3"><h3 className="text-sm font-semibold text-gray-900">Recent Payments</h3><Link to="/payments" className="text-xs text-blue-600 hover:underline">view all</Link></div>
          {!recentPayments.length ? <p className="text-sm text-gray-400">No payments yet.</p> : (
            <div className="divide-y divide-gray-50">
              {recentPayments.map(p => (
                <Link key={p.id} to={`/customer-pipeline?search=${encodeURIComponent(p.bp_bookings?.booking_no || '')}`} className="py-2 flex items-center justify-between text-sm hover:bg-gray-50 -mx-2 px-2 rounded">
                  <div>
                    <div className="font-mono text-xs text-gray-700">{p.receipt_no || '—'}</div>
                    <div className="text-xs text-gray-500">{p.bp_bookings?.booking_no} · {p.bp_bookings?.bp_customers?.name || '—'}</div>
                  </div>
                  <div className="font-semibold text-green-700 inline-flex items-center gap-1">{formatINR(p.amount)}<ArrowRight size={11} className="text-gray-300"/></div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function FollowUp({ icon, label, value, sub, href, active, tone }: any) {
  const tones: Record<string, { bg: string; text: string; ring: string }> = {
    amber:  { bg: 'bg-amber-50',  text: 'text-amber-700',  ring: 'border-amber-200' },
    indigo: { bg: 'bg-indigo-50', text: 'text-indigo-700', ring: 'border-indigo-200' },
    rose:   { bg: 'bg-rose-50',   text: 'text-rose-700',   ring: 'border-rose-200' },
    blue:   { bg: 'bg-blue-50',   text: 'text-blue-700',   ring: 'border-blue-200' },
  }
  const t = tones[tone] || tones.blue
  const inner = (
    <div className={`rounded-xl border ${active ? `${t.ring} ${t.bg}` : 'border-gray-100 bg-white'} p-3 transition-colors hover:border-gray-300`}>
      <div className={`flex items-center gap-1.5 text-[11px] uppercase tracking-wide font-medium ${active ? t.text : 'text-gray-500'}`}>
        {icon}{label}
      </div>
      <div className={`text-xl font-bold mt-0.5 ${active ? t.text : 'text-gray-400'} tabular-nums`}>{value}</div>
      {sub && <div className={`text-[11px] mt-0.5 ${active ? t.text + ' opacity-80' : 'text-gray-400'}`}>{sub}</div>}
    </div>
  )
  return href ? <Link to={href}>{inner}</Link> : inner
}

function PayTile({ label, value, sub, color = 'text-gray-900' }: any) {
  return (
    <div className="rounded-lg bg-gray-50 border border-gray-100 p-3">
      <div className="text-[11px] text-gray-500 uppercase tracking-wide">{label}</div>
      <div className={`font-bold text-lg ${color}`}>{value}</div>
      {sub && <div className="text-[11px] text-gray-400 mt-0.5">{sub}</div>}
    </div>
  )
}

function MiniTable({ title, rows, cols, emptyMsg }: any) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm flex flex-col">
      <div className="px-4 py-3 border-b border-gray-100">
        <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
      </div>
      {rows.length === 0
        ? <p className="text-center text-gray-400 text-xs py-6">{emptyMsg}</p>
        : (
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr className="bg-gray-50">{cols.map((c: any, i: number) => <th key={i} className="text-left px-4 py-2 text-gray-500 font-medium">{c.label}</th>)}</tr></thead>
              <tbody className="divide-y divide-gray-50">
                {rows.map((row: any, i: number) => (
                  <tr key={i} className="hover:bg-gray-50">
                    {cols.map((c: any, j: number) => <td key={j} className="px-4 py-2.5">{c.render(row)}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )
      }
    </div>
  )
}

function Donut({ segments, size = 130 }: { segments: { label: string; value: number; color: string }[]; size?: number }) {
  const r = 48, cx = size/2, cy = size/2
  const circumference = 2 * Math.PI * r
  const total = segments.reduce((s, seg) => s + (seg.value || 0), 0)
  if (total === 0) return <div className="flex items-center justify-center" style={{ width: size, height: size }}><span className="text-xs text-gray-300">No plots</span></div>
  let offset = 0
  const slices = segments.map(seg => {
    const pct = seg.value / total
    const dash = pct * circumference
    const slice = { ...seg, dash, offset: circumference - offset }
    offset += dash
    return slice
  })
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#f1f5f9" strokeWidth={22} />
      {slices.map((s, i) => (
        <circle key={i} cx={cx} cy={cy} r={r} fill="none" stroke={s.color} strokeWidth={22}
          strokeDasharray={`${s.dash} ${circumference - s.dash}`}
          strokeDashoffset={s.offset}
          style={{ transform: 'rotate(-90deg)', transformOrigin: `${cx}px ${cy}px` }}/>
      ))}
      <text x={cx} y={cy} textAnchor="middle" dominantBaseline="central" fill="#374151" fontSize="13" fontWeight="700">{total}</text>
      <text x={cx} y={cy + 14} textAnchor="middle" fill="#9ca3af" fontSize="9">total plots</text>
    </svg>
  )
}
