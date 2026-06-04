import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { formatINR } from '@/lib/utils'
import {
  TrendingUp, TrendingDown, Coins, Wallet,
  Banknote, AlertCircle, Receipt, Activity, Award, Building2,
} from 'lucide-react'

// Financial summary view.  Was previously just 5 KPI cards floating on an empty page —
// not enough for an admin to understand where the business is leaking, who's carrying
// it, or how this month compares to last.  Now: KPI strip with deltas, 6-month revenue
// trend, booking funnel, top brokers + top projects breakdowns.

const monthKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
const monthLabel = (k: string) => {
  const m = Number(k.split('-')[1])
  return ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][m - 1] || k
}
const pct = (num: number, den: number) => den > 0 ? Math.round((num / den) * 100) : 0
const delta = (cur: number, prev: number) => {
  if (prev === 0) return cur > 0 ? 100 : 0
  return Math.round(((cur - prev) / Math.abs(prev)) * 100)
}

export default function Analytics() {
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<any>(null)

  useEffect(() => {
    let active = true
    async function load() {
      const now = new Date()
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
      const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1)
      const sixMonthsAgo = new Date(now.getFullYear(), now.getMonth() - 5, 1)
      const monthStartISO = monthStart.toISOString().slice(0, 10)
      const prevMonthStartISO = prevMonthStart.toISOString().slice(0, 10)
      const sixMonthsAgoISO = sixMonthsAgo.toISOString().slice(0, 10)
      const today = now.toISOString().slice(0, 10)

      const [pay, book, inst, dist, inq, brk, proj] = await Promise.all([
        supabase.from('bp_payments').select('amount,verification_status,payment_type,payment_date'),
        supabase.from('bp_bookings').select('id,total_amount,plot_total_price,commission_amount,stage,application_date,project_id'),
        supabase.from('emi_installments').select('amount,status,due_date'),
        // Per-payment MLM distributions — the actually-paid commission.  Broker info is joined
        // in-memory below (against the brokers fetch) to avoid relying on a PostgREST FK embed
        // that may not be defined for this column.
        supabase.from('payout_distributions').select('net_payout, created_at, beneficiary_broker_id'),
        supabase.from('inquiries').select('status, created_at'),
        supabase.from('brokers').select('id, name, broker_id, rank, status'),
        supabase.from('bp_projects').select('id, name'),
      ])

      if (!active) return

      const payments = pay.data || []
      const bookings = book.data || []
      const installments = inst.data || []
      const distributions = (dist.data || []) as any[]
      const inquiries = inq.data || []
      const brokers = brk.data || []
      const projects = proj.data || []

      // ── Money totals ──
      const verifiedPayments = payments.filter(p => p.verification_status === 'verified')
      const totalRevenue = verifiedPayments.reduce((s, p) => s + Number(p.amount || 0), 0)
      const revenueThisMonth = verifiedPayments
        .filter(p => (p.payment_date || '') >= monthStartISO)
        .reduce((s, p) => s + Number(p.amount || 0), 0)
      const revenuePrevMonth = verifiedPayments
        .filter(p => (p.payment_date || '') >= prevMonthStartISO && (p.payment_date || '') < monthStartISO)
        .reduce((s, p) => s + Number(p.amount || 0), 0)

      const confirmed = bookings.filter(b => b.stage === 'booking_done')
      const confirmedValue = confirmed.reduce((s, b) => s + Number(b.total_amount || b.plot_total_price || 0), 0)
      const confirmedThisMonth = confirmed.filter(b => (b.application_date || '') >= monthStartISO)
      const confirmedPrevMonth = confirmed.filter(b => (b.application_date || '') >= prevMonthStartISO && (b.application_date || '') < monthStartISO)
      const bookingsThisMonthValue = confirmedThisMonth.reduce((s, b) => s + Number(b.total_amount || b.plot_total_price || 0), 0)
      const bookingsPrevMonthValue = confirmedPrevMonth.reduce((s, b) => s + Number(b.total_amount || b.plot_total_price || 0), 0)
      const avgTicket = confirmed.length > 0 ? confirmedValue / confirmed.length : 0

      const totalPayouts = distributions.reduce((s, d) => s + Number(d.net_payout || 0), 0)
      const payoutsThisMonth = distributions
        .filter(d => (d.created_at || '') >= monthStartISO)
        .reduce((s, d) => s + Number(d.net_payout || 0), 0)
      const payoutsPrevMonth = distributions
        .filter(d => (d.created_at || '') >= prevMonthStartISO && (d.created_at || '') < monthStartISO)
        .reduce((s, d) => s + Number(d.net_payout || 0), 0)

      const pendingEmi = installments
        .filter(i => i.status !== 'paid' && i.due_date <= today)
        .reduce((s, i) => s + Number(i.amount || 0), 0)
      const pendingEmiCount = installments.filter(i => i.status !== 'paid' && i.due_date <= today).length

      const outstanding = Math.max(0, confirmedValue - totalRevenue)
      const collectionRate = pct(totalRevenue, confirmedValue)
      const commissionRate = pct(totalPayouts, totalRevenue)
      const margin = totalRevenue - totalPayouts
      const marginPct = totalRevenue > 0 ? Math.round((margin / totalRevenue) * 100) : 0

      // ── 6-month revenue trend ──
      const monthsBucket: { key: string; label: string; revenue: number; bookings: number }[] = []
      for (let i = 5; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
        monthsBucket.push({ key: monthKey(d), label: monthLabel(monthKey(d)), revenue: 0, bookings: 0 })
      }
      for (const p of verifiedPayments) {
        if (!p.payment_date || p.payment_date < sixMonthsAgoISO) continue
        const k = monthKey(new Date(p.payment_date))
        const slot = monthsBucket.find(m => m.key === k)
        if (slot) slot.revenue += Number(p.amount || 0)
      }
      for (const b of confirmed) {
        if (!b.application_date || b.application_date < sixMonthsAgoISO) continue
        const k = monthKey(new Date(b.application_date))
        const slot = monthsBucket.find(m => m.key === k)
        if (slot) slot.bookings += 1
      }

      // ── Booking funnel ──
      const funnel = {
        inquiriesTotal: inquiries.length,
        inquiriesNew:   inquiries.filter((i: any) => i.status === 'new').length,
        inquiriesQualified: inquiries.filter((i: any) => ['qualified', 'contacted'].includes(i.status)).length,
        inquiriesConverted: inquiries.filter((i: any) => i.status === 'converted').length,
        bookingsActive:  bookings.filter(b => !['booking_done', 'cancelled'].includes(b.stage)).length,
        bookingsConfirmed: confirmed.length,
        bookingsCancelled: bookings.filter(b => b.stage === 'cancelled').length,
      }

      // ── Top brokers (by commission distributed THIS MONTH) ──
      const brokerInfoById = new Map(brokers.map((b: any) => [b.id, b]))
      const brokerEarnings = new Map<string, { id: string; name: string; code: string; rank: string; earned: number; ytdEarned: number }>()
      for (const d of distributions) {
        const bid = d.beneficiary_broker_id
        if (!bid) continue
        const info: any = brokerInfoById.get(bid) || {}
        const cur = brokerEarnings.get(bid) || { id: bid, name: info.name || '—', code: info.broker_id || '—', rank: info.rank || '—', earned: 0, ytdEarned: 0 }
        cur.ytdEarned += Number(d.net_payout || 0)
        if ((d.created_at || '') >= monthStartISO) cur.earned += Number(d.net_payout || 0)
        brokerEarnings.set(bid, cur)
      }
      const topBrokers = Array.from(brokerEarnings.values())
        .sort((a, b) => b.earned - a.earned || b.ytdEarned - a.ytdEarned)
        .slice(0, 5)

      // ── Top projects (by confirmed bookings value) ──
      const projectStats = new Map<string, { id: string; name: string; bookings: number; value: number }>()
      const projectNameById = new Map(projects.map((p: any) => [p.id, p.name]))
      for (const b of confirmed) {
        const pid = b.project_id || 'unknown'
        const cur = projectStats.get(pid) || { id: pid, name: projectNameById.get(pid) || 'Unassigned', bookings: 0, value: 0 }
        cur.bookings += 1
        cur.value += Number(b.total_amount || b.plot_total_price || 0)
        projectStats.set(pid, cur)
      }
      const topProjects = Array.from(projectStats.values())
        .sort((a, b) => b.value - a.value)
        .slice(0, 5)

      setData({
        totals: {
          confirmedValue, totalRevenue, totalPayouts, outstanding, margin, pendingEmi,
          avgTicket, collectionRate, commissionRate, marginPct, pendingEmiCount,
          confirmedCount: confirmed.length,
          activeBrokers: brokers.filter((b: any) => b.status === 'active').length,
        },
        deltas: {
          revenue: delta(revenueThisMonth, revenuePrevMonth),
          bookingsValue: delta(bookingsThisMonthValue, bookingsPrevMonthValue),
          bookingsCount: delta(confirmedThisMonth.length, confirmedPrevMonth.length),
          commissions: delta(payoutsThisMonth, payoutsPrevMonth),
          revenueThisMonth, revenuePrevMonth, payoutsThisMonth,
          bookingsThisMonthCount: confirmedThisMonth.length,
        },
        monthsBucket,
        funnel,
        topBrokers,
        topProjects,
      })
      setLoading(false)
    }
    load()
    return () => { active = false }
  }, [])

  if (loading || !data) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Analytics</h1>
          <p className="text-sm text-gray-500">Financial summary and performance metrics</p>
        </div>
        <div className="text-center py-16 text-gray-400">Loading…</div>
      </div>
    )
  }

  const { totals, deltas, monthsBucket, funnel, topBrokers, topProjects } = data
  const maxRevenue = Math.max(1, ...monthsBucket.map((m: any) => m.revenue))
  const maxBookings = Math.max(1, ...monthsBucket.map((m: any) => m.bookings))

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Analytics</h1>
        <p className="text-sm text-gray-500">Financial summary and performance metrics</p>
      </div>

      {/* ── Hero KPIs ── */}
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <KpiCard
          icon={<Receipt size={14}/>}
          label="Confirmed Bookings"
          value={formatINR(totals.confirmedValue)}
          sub={`${totals.confirmedCount} bookings · avg ${formatINR(totals.avgTicket)}`}
          delta={deltas.bookingsValue}
          deltaSub={`${deltas.bookingsThisMonthCount} this month`}
        />
        <KpiCard
          icon={<Wallet size={14}/>}
          label="Cash Received"
          value={formatINR(totals.totalRevenue)}
          sub={`${totals.collectionRate}% of confirmed value collected`}
          tone="emerald"
          delta={deltas.revenue}
          deltaSub={`${formatINR(deltas.revenueThisMonth)} this month`}
        />
        <KpiCard
          icon={<AlertCircle size={14}/>}
          label="Outstanding Receivables"
          value={formatINR(totals.outstanding)}
          sub={`${100 - totals.collectionRate}% still due from customers`}
          tone={totals.outstanding > 0 ? 'orange' : 'gray'}
        />
        <KpiCard
          icon={<Coins size={14}/>}
          label="Broker Commissions"
          value={formatINR(totals.totalPayouts)}
          sub={`${totals.commissionRate}% of cash received · distributed via MLM`}
          tone="blue"
          delta={deltas.commissions}
          deltaSub={`${formatINR(deltas.payoutsThisMonth)} this month`}
        />
        <KpiCard
          icon={<Banknote size={14}/>}
          label="Net Margin"
          value={formatINR(totals.margin)}
          sub={`${totals.marginPct}% margin · cash − commissions`}
          tone={totals.margin >= 0 ? 'emerald' : 'rose'}
        />
        <KpiCard
          icon={<AlertCircle size={14}/>}
          label="EMI Overdue (today)"
          value={formatINR(totals.pendingEmi)}
          sub={`${totals.pendingEmiCount} past-due instalments`}
          tone={totals.pendingEmi > 0 ? 'rose' : 'gray'}
          href={totals.pendingEmiCount > 0 ? '/customer-pipeline?tab=emi_active' : undefined}
        />
      </div>

      {/* ── 6-month revenue + bookings trend ── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 lg:col-span-2">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-gray-900 inline-flex items-center gap-1.5">
              <TrendingUp size={14}/>Revenue · last 6 months
            </h3>
            <span className="text-[11px] text-gray-400">verified cash received</span>
          </div>
          <div className="flex items-end gap-3 h-40">
            {monthsBucket.map((m: any, i: number) => {
              const h = (m.revenue / maxRevenue) * 100
              return (
                <div key={i} className="flex-1 flex flex-col items-center gap-1.5 min-w-0">
                  <span className="text-[9px] text-gray-500 tabular-nums">
                    {m.revenue > 0 ? formatINR(m.revenue).replace('₹', '') : ''}
                  </span>
                  <div
                    className="w-full rounded-t-md bg-gradient-to-t from-emerald-600 to-emerald-400 transition-all"
                    style={{ height: `${Math.max(h, 2)}%`, minHeight: 4, opacity: m.revenue > 0 ? 1 : 0.2 }}
                    title={`${m.label}: ${formatINR(m.revenue)}`}
                  />
                  <span className="text-[10px] text-gray-500">{m.label}</span>
                </div>
              )
            })}
          </div>
        </div>

        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-gray-900 inline-flex items-center gap-1.5">
              <Activity size={14}/>Bookings · last 6 months
            </h3>
          </div>
          <div className="flex items-end gap-2 h-40">
            {monthsBucket.map((m: any, i: number) => {
              const h = (m.bookings / maxBookings) * 100
              return (
                <div key={i} className="flex-1 flex flex-col items-center gap-1.5 min-w-0">
                  <span className="text-[9px] text-gray-500 tabular-nums">{m.bookings > 0 ? m.bookings : ''}</span>
                  <div
                    className="w-full rounded-t-md bg-indigo-500 transition-all"
                    style={{ height: `${Math.max(h, 2)}%`, minHeight: 4, opacity: m.bookings > 0 ? 1 : 0.2 }}
                    title={`${m.label}: ${m.bookings} bookings`}
                  />
                  <span className="text-[10px] text-gray-500">{m.label}</span>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* ── Funnel + leaderboards ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Funnel */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
          <h3 className="text-sm font-semibold text-gray-900 mb-3">Sales funnel</h3>
          <p className="text-[11px] text-gray-400 mb-4">Where leads are at every stage — taps deep-link to the working list.</p>
          <FunnelBar label="Inquiries"        count={funnel.inquiriesTotal}     of={funnel.inquiriesTotal} color="bg-amber-500"   href="/inquiries"/>
          <FunnelBar label="Qualified"        count={funnel.inquiriesQualified} of={funnel.inquiriesTotal} color="bg-orange-500"  href="/inquiries"/>
          <FunnelBar label="Active bookings"  count={funnel.bookingsActive}     of={funnel.inquiriesTotal} color="bg-indigo-500"  href="/customer-pipeline"/>
          <FunnelBar label="Confirmed"        count={funnel.bookingsConfirmed}  of={funnel.inquiriesTotal} color="bg-emerald-500" href="/customer-pipeline?tab=settled"/>
          {funnel.bookingsCancelled > 0 && (
            <FunnelBar label="Cancelled" count={funnel.bookingsCancelled} of={funnel.inquiriesTotal} color="bg-rose-400" href="/customer-pipeline"/>
          )}
          <div className="mt-4 pt-3 border-t border-gray-100 grid grid-cols-2 gap-2 text-[11px]">
            <div className="flex items-center justify-between">
              <span className="text-gray-500">Lead → confirmed</span>
              <b className="text-gray-900">{pct(funnel.bookingsConfirmed, funnel.inquiriesTotal)}%</b>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-gray-500">Active in pipeline</span>
              <b className="text-gray-900">{funnel.bookingsActive}</b>
            </div>
          </div>
        </div>

        {/* Top brokers this month */}
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-gray-900 inline-flex items-center gap-1.5">
              <Award size={14}/>Top brokers · this month
            </h3>
            <Link to="/brokers" className="text-[11px] text-blue-600 hover:underline">view all →</Link>
          </div>
          {topBrokers.length === 0 ? (
            <p className="text-sm text-gray-400 py-6 text-center">No commissions distributed yet.</p>
          ) : (
            <div className="divide-y divide-gray-50">
              {topBrokers.map((b: any, i: number) => (
                <Link
                  key={b.id}
                  to={`/brokers/${b.id}`}
                  className="py-2.5 flex items-center gap-3 hover:bg-gray-50 -mx-2 px-2 rounded"
                >
                  <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
                    i === 0 ? 'bg-amber-100 text-amber-700' : i === 1 ? 'bg-gray-100 text-gray-700' : i === 2 ? 'bg-orange-100 text-orange-700' : 'bg-blue-50 text-blue-700'
                  }`}>
                    {i + 1}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-gray-900 truncate">{b.name}</div>
                    <div className="text-[11px] text-gray-500 font-mono">[{b.code}] · {b.rank}</div>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-semibold text-emerald-700">{formatINR(b.earned)}</div>
                    <div className="text-[10px] text-gray-400">{formatINR(b.ytdEarned)} lifetime</div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Top projects ── */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-900 inline-flex items-center gap-1.5">
            <Building2 size={14}/>Top projects · by confirmed bookings
          </h3>
          <Link to="/projects" className="text-[11px] text-blue-600 hover:underline">view all →</Link>
        </div>
        {topProjects.length === 0 ? (
          <p className="text-sm text-gray-400 py-6 text-center">No confirmed bookings yet.</p>
        ) : (
          <div className="space-y-2.5">
            {topProjects.map((p: any) => {
              const share = pct(p.value, totals.confirmedValue)
              return (
                <div key={p.id}>
                  <div className="flex items-center justify-between text-sm mb-1">
                    <span className="font-medium text-gray-800 truncate">{p.name}</span>
                    <span className="text-gray-500 text-xs tabular-nums">
                      <b className="text-gray-900">{formatINR(p.value)}</b> · {p.bookings} bookings · {share}%
                    </span>
                  </div>
                  <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full bg-gradient-to-r from-indigo-500 to-purple-500" style={{ width: `${share}%` }}/>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

// ── Components ────────────────────────────────────────────────────────────

function KpiCard({ icon, label, value, sub, tone = 'gray', delta, deltaSub, href }: {
  icon: any; label: string; value: string; sub?: string; tone?: string
  delta?: number; deltaSub?: string; href?: string
}) {
  const tones: Record<string, { ring: string; text: string; iconBg: string }> = {
    gray:    { ring: 'border-gray-100',    text: 'text-gray-900',    iconBg: 'bg-gray-100 text-gray-600' },
    emerald: { ring: 'border-emerald-100', text: 'text-emerald-700', iconBg: 'bg-emerald-50 text-emerald-700' },
    blue:    { ring: 'border-blue-100',    text: 'text-blue-700',    iconBg: 'bg-blue-50 text-blue-700' },
    orange:  { ring: 'border-orange-100',  text: 'text-orange-700',  iconBg: 'bg-orange-50 text-orange-700' },
    rose:    { ring: 'border-rose-100',    text: 'text-rose-700',    iconBg: 'bg-rose-50 text-rose-700' },
  }
  const t = tones[tone] || tones.gray
  const showDelta = typeof delta === 'number'
  const up = (delta || 0) >= 0

  const inner = (
    <div className={`bg-white rounded-xl border ${t.ring} p-4 shadow-sm hover:border-gray-300 transition-colors h-full`}>
      <div className="flex items-start justify-between">
        <div className={`p-1.5 rounded-lg ${t.iconBg}`}>{icon}</div>
        {showDelta && (
          <span className={`inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
            up ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'
          }`}>
            {up ? <TrendingUp size={10}/> : <TrendingDown size={10}/>}
            {up ? '+' : ''}{delta}%
          </span>
        )}
      </div>
      <p className="text-[11px] font-medium text-gray-500 uppercase tracking-wide mt-2.5">{label}</p>
      <p className={`text-xl font-bold mt-0.5 ${t.text}`}>{value}</p>
      {sub && <p className="text-[11px] text-gray-400 mt-1">{sub}</p>}
      {showDelta && deltaSub && <p className="text-[10px] text-gray-400 mt-0.5">{deltaSub}</p>}
    </div>
  )
  return href ? <Link to={href}>{inner}</Link> : inner
}

function FunnelBar({ label, count, of, color, href }: { label: string; count: number; of: number; color: string; href?: string }) {
  const p = of > 0 ? Math.round((count / of) * 100) : 0
  const inner = (
    <div className="py-1.5">
      <div className="flex items-center justify-between text-xs mb-1">
        <span className="text-gray-700 font-medium">{label}</span>
        <span className="text-gray-500 tabular-nums"><b className="text-gray-900">{count}</b>{of > 0 && ` · ${p}%`}</span>
      </div>
      <div className="h-2.5 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full ${color} transition-all`} style={{ width: `${Math.max(p, count > 0 ? 6 : 0)}%` }}/>
      </div>
    </div>
  )
  return href ? <Link to={href} className="block hover:bg-gray-50 -mx-2 px-2 rounded transition-colors">{inner}</Link> : inner
}
