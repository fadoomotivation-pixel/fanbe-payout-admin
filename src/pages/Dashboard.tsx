import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { formatINR, formatDate } from '@/lib/utils'
import { Users, Briefcase, CalendarClock, ShieldAlert, ArrowRight, Building2, Map, FileText, TrendingUp, TrendingDown, Award, Plus, UserPlus, CreditCard, Banknote, Activity } from 'lucide-react'

// One Dashboard.  The old Dashboard.jsx that lived alongside this file was being picked
// up by Vite's resolver and rendered instead — every monetary tile read ₹0 because its
// queries hit non-existent columns (e.g. bp_payments.status when the real column is
// verification_status).  Removed the .jsx and folded its useful visuals (plot donut,
// monthly tables, growth chart) into this file with the correct queries.

type Tile = { label: string; value: string; sub?: string; color?: string; href?: string; delta?: number }

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
  const [topBroker, setTopBroker] = useState<{ id: string; name: string; code: string; rank: string; earned: number } | null>(null)
  // Spend and the money left after it — the dashboard showed what came IN but never
  // what went out, so 'how are we actually doing this month' wasn't answerable here.
  const [money, setMoney] = useState({
    collectedAll: 0, collectedMonth: 0, collectedPrev: 0,
    spendAll: 0, spendMonth: 0, spendPrev: 0, advances: 0,
  })
  // Default is All time.  A month-scoped dashboard reads as a dead business in any
  // quiet month, which is what admin was looking at.
  const [moneyPeriod, setMoneyPeriod] = useState<'all' | 'month' | 'prev'>('all')
  // How many of the dashboard's queries came back broken, so zeros can be told
  // apart from 'nothing happened'.
  const [dataIssues, setDataIssues] = useState(0)
  // Set when the page loaded without a live session.  RLS on emi_installments, expenses,
  // payout_distributions and withdrawal_requests only admits the `authenticated` role, and
  // a denied SELECT comes back as an EMPTY LIST, not an error — so without this the page
  // renders a confident ₹0 everywhere and nothing looks wrong.  That is exactly the
  // "sab 0" admin reported while Analytics, opened later on a warm session, read fine.
  const [signedOut, setSignedOut] = useState(false)
  // The actual error text when loading breaks, shown on the page.  Logging it to the
  // console only meant the admin saw a wall of zeros with nothing explaining them, and
  // the cause had to be guessed at from screenshots.
  const [loadError, setLoadError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  // Bookings whose EMI has run past the 90-day lapsation window — the ones whose
  // receipts are now held back, so admin can see them without hunting.
  const [lapsed, setLapsed] = useState({ bookings: 0, amount: 0 })

  useEffect(() => {
    // Wrapped in try/finally so a single bad query (missing table, RLS error, network
    // hiccup) doesn't strand the dashboard in skeleton state forever.  Real failures
    // surface as a console error; loading always resolves so the user sees whatever
    // tiles DID succeed.
    async function load() {
      try {
      setLoadError(null)
      // Read the session first.  Every figure below depends on being `authenticated`;
      // querying without one returns empty lists that are indistinguishable from a quiet
      // month, so say so instead of drawing zeros.
      //
      // Read defensively rather than destructuring `data.session` in one go: if this call
      // ever hands back a null `data`, the nested destructure throws, and a throw this
      // early takes the entire page down with it — which is exactly the failure being
      // fixed here.  Never let the session check be the thing that blanks the dashboard.
      let session: any = null
      try {
        const res = await supabase.auth.getSession()
        session = res?.data?.session ?? null
      } catch (e: any) {
        // eslint-disable-next-line no-console
        console.error('Dashboard session check failed:', e?.message || e)
      }
      setSignedOut(!session)

      const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0,0,0,0)
      const monthStartISO = monthStart.toISOString()
      const monthStartDay = monthStartISO.slice(0, 10)
      const today = new Date().toISOString().slice(0, 10)
      const prevMonthStart = new Date(monthStart); prevMonthStart.setMonth(prevMonthStart.getMonth() - 1)
      const prevMonthStartDay = prevMonthStart.toISOString().slice(0, 10)

      const sevenDaysAgo = new Date(); sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 6); sevenDaysAgo.setHours(0,0,0,0)
      const sevenDayStart = sevenDaysAgo.toISOString().slice(0, 10)

      const ninety = new Date(); ninety.setDate(ninety.getDate() - 90)
      const ninetyDaysAgo = ninety.toISOString().slice(0, 10)

      // allSettled, NOT all.  With Promise.all a single failing query rejects the whole
      // batch, the rest of load() is skipped, and every tile keeps its initial value —
      // which is exactly the "everything reads 0" the admin saw, even though the data
      // was there.  Now a bad query costs its own tile and nothing else, and the count
      // of failures is surfaced instead of being silently swallowed.
      const settled = await Promise.allSettled([
        supabase.from('brokers').select('id', { count: 'exact', head: true }).eq('status', 'active'),
        supabase.from('bp_customers').select('id', { count: 'exact', head: true }),
        supabase.from('bp_bookings').select('id', { count: 'exact', head: true }).eq('stage', 'booking_done'),
        supabase.from('bp_projects').select('id', { count: 'exact', head: true }),
        supabase.from('bp_plots').select('id', { count: 'exact', head: true }),
        supabase.from('bp_payments').select('amount,verification_status,payment_date').eq('verification_status', 'verified'),
        supabase.from('payout_distributions').select('beneficiary_broker_id, net_payout, created_at'),
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
        supabase.from('expenses').select('amount, expense_date, broker_id, expense_heads(name)'),
        // Past the 90-day grace window -> receipts are held back on these bookings.
        supabase.from('emi_installments').select('amount, due_date, emi_schedules!inner(booking_id)').neq('status', 'paid').lt('due_date', ninetyDaysAgo),
      ])

      // Named in the same order as the queries above, so a failure says WHICH one rather
      // than leaving a silent zero to be reverse-engineered from the UI.
      const QUERY_LABELS = [
        'active brokers', 'customers', 'confirmed bookings', 'projects', 'plots',
        'payments', 'payout distributions', 'payout transactions', 'open withdrawals',
        'recent bookings', 'recent payments', 'new brokers', 'new customers',
        'plot status breakdown', 'week bookings',
        'kyc pending', 'pipeline active', 'emi overdue', 'expenses', 'lapsed emi',
      ]
      const broken = settled
        .map((r: any, i: number) => (r.status === 'rejected' || r.value?.error
          ? `${QUERY_LABELS[i] || `query ${i}`}: ${r.reason?.message || r.value?.error?.message || 'failed'}`
          : null))
        .filter(Boolean)
      if (broken.length > 0) console.error('Dashboard queries failed →', broken)
      setDataIssues(broken.length)
      const [
        brokerCount, customerCount, bookingDoneCount, projectsCount, plotsCount,
        payments, distributions, payoutTxns, openWds,
        recentBk, recentPm, newBrokersRes, newCustomersRes,
        plotsBreakdown, weekBookings,
        kycPendingQ, pipelineActiveQ, emiOverdueQ, expensesQ, lapsedQ,
      ] = settled.map((r: any) => (r.status === 'fulfilled' ? r.value : { data: null, count: 0 })) as any[]

      // Each block below owns one part of the page and carries its own try.  They used to
      // share a single one: the first line to throw left every later setState unreached, so
      // the tiles, inventory, follow-ups, money and payables all kept their initial zeros
      // and the page looked like a business with no data rather than a page with a bug.
      // Now a broken section costs only itself and names itself in the console.
      const sectionFailures: string[] = []
      const section = (label: string, fn: () => void) => {
        try { fn() } catch (e: any) {
          sectionFailures.push(label)
          // eslint-disable-next-line no-console
          console.error(`Dashboard section "${label}" failed:`, e?.message || e)
        }
      }
      // Same idea for the sums feeding those sections.  A throw while working out one
      // figure used to abort load() before a single setState ran, which is how the whole
      // page — tiles, inventory, follow-ups, money, payables — went to zero at once.  Now
      // a bad figure falls back to its zero value and says so, and every tile still fills.
      const calc = <T,>(label: string, fn: () => T, fallback: T): T => {
        try { return fn() } catch (e: any) {
          sectionFailures.push(label)
          // eslint-disable-next-line no-console
          console.error(`Dashboard figure "${label}" failed:`, e?.message || e)
          return fallback
        }
      }

      const totalRevenue     = calc('revenue total', () => (payments.data || []).reduce((s: number, p: any) => s + Number(p.amount || 0), 0), 0)
      const revenueThisMonth = calc('revenue this month', () => (payments.data || []).filter((p: any) => (p.payment_date || '') >= monthStartDay).reduce((s: number, p: any) => s + Number(p.amount || 0), 0), 0)
      const revenuePrevMonth = calc('revenue last month', () => (payments.data || [])
        .filter((p: any) => (p.payment_date || '') >= prevMonthStartDay && (p.payment_date || '') < monthStartDay)
        .reduce((s: number, p: any) => s + Number(p.amount || 0), 0), 0)
      const revenueDelta = revenuePrevMonth === 0 ? (revenueThisMonth > 0 ? 100 : 0)
        : Math.round(((revenueThisMonth - revenuePrevMonth) / Math.abs(revenuePrevMonth)) * 100)

      const earned = calc('commission earned', () => (distributions.data || []).reduce((s: number, d: any) => s + Number(d.net_payout || 0), 0), 0)
      const paidThisMonth = calc('payouts paid', () => (payoutTxns.data || [])
        .filter((t: any) => t.status === 'paid' && (t.paid_date || '') >= monthStartDay)
        .reduce((s: number, t: any) => s + Number(t.net_amount || t.amount || 0), 0), 0)
      const pending = Math.max(0, earned - paidThisMonth)
      const brokerSet = calc('broker count', () => new Set((distributions.data || []).map((d: any) => d.beneficiary_broker_id).filter(Boolean)), new Set<string>())
      const openWdCount = openWds?.count || 0

      const emiOverdueCount = calc('emi overdue count',  () => (emiOverdueQ.data || []).length, 0)
      const emiOverdueAmt   = calc('emi overdue amount', () => (emiOverdueQ.data || []).reduce((s: number, r: any) => s + Number(r.amount || 0), 0), 0)

      // ── Top broker this month — quick "who's carrying the team" snapshot.  Sums
      // payout_distributions per broker.id within the current month, then resolves the
      // winner against the newBrokers fetch first, falling back to a quick lookup so we
      // can show their name + code + rank even if they aren't in the new-this-month list.
      const monthlyByBroker = calc('top broker totals', () => {
        const m = new Map<string, number>()
        for (const d of (distributions.data || []) as any[]) {
          if (!d.beneficiary_broker_id || !d.created_at || d.created_at < monthStartISO) continue
          m.set(d.beneficiary_broker_id, (m.get(d.beneficiary_broker_id) || 0) + Number(d.net_payout || 0))
        }
        return m
      }, new Map<string, number>())
      let topBrokerOut: { id: string; name: string; code: string; rank: string; earned: number } | null = null
      if (monthlyByBroker.size > 0) {
        // Its own try: this is the only await left in the middle of the page's own
        // calculations, so a failure here must not cost the tiles below it.
        try {
          const [topId, topAmt] = Array.from(monthlyByBroker.entries()).sort((a, b) => b[1] - a[1])[0]
          const { data: bInfo } = await supabase.from('brokers').select('id, name, broker_id, rank').eq('id', topId).maybeSingle()
          if (bInfo) topBrokerOut = { id: bInfo.id, name: bInfo.name, code: bInfo.broker_id, rank: bInfo.rank, earned: topAmt }
        } catch (e: any) {
          // eslint-disable-next-line no-console
          console.error('Dashboard top-broker lookup failed:', e?.message || e)
        }
      }

      // Plot status breakdown — for the donut.  Categorise by status with friendly colours.
      const statusCounts: Record<string, number> = calc('plot status counts', () => {
        const out: Record<string, number> = {}
        for (const p of (plotsBreakdown.data || []) as any[]) {
          const k = p.status || 'unknown'
          out[k] = (out[k] || 0) + 1
        }
        return out
      }, {})
      const segColors: Record<string, string> = {
        available: '#14b8a6', token: '#f59e0b', booked: '#6366f1',
        // 'registry_done' is the terminal status in bp_plots_status_check; the old
        // 'sold' key never matched anything, so registered plots fell through to grey.
        registry_done: '#22c55e', cancelled: '#ef4444', unknown: '#94a3b8',
      }
      const segments = calc('plot donut', () => Object.entries(statusCounts).map(([k, v]) => ({ label: k, value: v, color: segColors[k] || '#94a3b8' })), [] as { label: string; value: number; color: string }[])

      // Daily growth — last 7 days bookings volume
      const growthMap: Record<string, { date: string; label: string; amount: number }> = calc('growth chart', () => {
        const out: Record<string, { date: string; label: string; amount: number }> = {}
        for (let i = 6; i >= 0; i--) {
          const d = new Date(); d.setDate(d.getDate() - i)
          const key = d.toISOString().slice(0, 10)
          out[key] = { date: key, label: d.toLocaleDateString('en-IN', { weekday: 'short' }), amount: 0 }
        }
        for (const b of (weekBookings.data || []) as any[]) {
          if (b.application_date && out[b.application_date]) out[b.application_date].amount += Number(b.total_amount || 0)
        }
        return out
      }, {})

      // Headline tiles
      section('headline tiles', () => setTiles([
        { label: 'Active Brokers',     value: String(brokerCount.count || 0), color: 'text-blue-700',     href: '/brokers' },
        { label: 'Total Customers',    value: String(customerCount.count || 0), color: 'text-gray-900',   href: '/customer-pipeline' },
        { label: 'Confirmed Bookings', value: String(bookingDoneCount.count || 0), color: 'text-emerald-700', href: '/customer-pipeline?tab=settled' },
        { label: 'Revenue (verified)', value: formatINR(totalRevenue), sub: `This month: ${formatINR(revenueThisMonth)}`, color: 'text-green-700', href: '/payments', delta: revenueDelta },
      ]))

      // Inventory row — projects + plot status, with deep links
      section('inventory', () => setInventory([
        { label: 'Total Projects',  value: String(projectsCount.count || 0), color: 'text-indigo-700', href: '/projects' },
        { label: 'Total Plots',     value: String(plotsCount.count || 0),     color: 'text-teal-700',   href: '/plots' },
        { label: 'Available Plots', value: String(statusCounts.available || 0), color: 'text-emerald-700', href: '/plots' },
        { label: 'Booked / Token',  value: String((statusCounts.booked || 0) + (statusCounts.token || 0)), color: 'text-purple-700', href: '/plots' },
      ]))

      section('follow-ups', () => setFollowUps({
        kycPending:      kycPendingQ.count || 0,
        pipelineActive:  pipelineActiveQ.count || 0,
        emiOverdue:      emiOverdueCount,
        emiOverdueAmount: emiOverdueAmt,
        openWithdrawals: openWdCount,
      }))
      // Spend split into this month vs last, plus advances outstanding (money already
      // handed to brokers, which their withdrawable balance is reduced by).
      section('money', () => {
        const exp = (expensesQ.data || []) as any[]
        const sumExp = (f: (e: any) => boolean) => exp.filter(f).reduce((acc, e) => acc + Number(e.amount || 0), 0)
        const inPrevMonth = (d: string) => d >= prevMonthStartDay && d < monthStartDay
        setMoney({
          collectedAll:   totalRevenue,
          collectedMonth: revenueThisMonth,
          collectedPrev:  revenuePrevMonth,
          spendAll:       sumExp(() => true),
          spendMonth:     sumExp(e => (e.expense_date || '') >= monthStartDay),
          spendPrev:      sumExp(e => inPrevMonth(e.expense_date || '')),
          advances:       sumExp(e => (e.expense_heads?.name || '').toLowerCase() === 'advance' && e.broker_id),
        })
      })

      section('lapsed emi', () => {
        const lapsedRows = (lapsedQ.data || []) as any[]
        setLapsed({
          bookings: new Set(lapsedRows.map(r => r.emi_schedules?.booking_id).filter(Boolean)).size,
          amount: lapsedRows.reduce((acc, r) => acc + Number(r.amount || 0), 0),
        })
      })

      section('payables',        () => setPayables({ accrued: earned, paidThisMonth, pending, brokerCount: brokerSet.size, openWdCount }))
      section('recent bookings', () => setRecentBookings(recentBk.data || []))
      section('recent payments', () => setRecentPayments(recentPm.data || []))
      section('new brokers',     () => setNewBrokers(newBrokersRes.data || []))
      section('new customers',   () => setNewCustomers(newCustomersRes.data || []))
      section('plot donut',      () => setPlotSegments(segments))
      section('growth chart',    () => setDailyGrowth(Object.values(growthMap)))
      section('top broker',      () => setTopBroker(topBrokerOut))

      // Fold any section failure into the same counter the query failures use, so the
      // banner covers "a figure could not be worked out" as well as "a query did not come back".
      if (sectionFailures.length > 0) setDataIssues(n => n + sectionFailures.length)
      } catch (e: any) {
        // Surfaced on the page, not just the console.  Zeros with no explanation are
        // indistinguishable from a quiet month, which is what made this hard to pin down.
        // eslint-disable-next-line no-console
        console.error('Dashboard load failed:', e?.message || e)
        setLoadError(e?.message ? String(e.message) : String(e))
      } finally {
        setLoading(false)
      }
    }
    load()

    // The dashboard is the landing page, so it can mount while the stored token is still
    // being refreshed.  Reads issued in that window come back empty (RLS), which is why it
    // could sit on zeros while Analytics — opened a minute later — read fine.  Re-running
    // on sign-in / token refresh means the page fills itself in instead of staying wrong
    // until someone thinks to reload.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') load()
    })
    return () => subscription.unsubscribe()
  }, [reloadKey])

  const maxGrowth = Math.max(...dailyGrowth.map(d => d.amount), 1)
  const skeleton = (n: number) => Array.from({ length: n }, () => ({ label: '…', value: '—' } as Tile))

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Dashboard</h1>
          <p className="text-sm text-gray-500">
            Operational health at a glance · {new Date().toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'short', year: 'numeric' })}
            {/* Which build this browser is actually running.  If this stamp is older than
                the last deploy, the page is a cached copy and a hard reload is the fix —
                that ambiguity cost a full round of debugging. */}
            <span className="text-[10px] text-gray-400 ml-2 font-mono" title="Build loaded in this browser">build {typeof __BUILD_STAMP__ === 'string' ? __BUILD_STAMP__ : '—'}</span>
          </p>
        </div>
        {/* Quick actions row — the things admin reaches for most often, one tap each. */}
        <div className="flex flex-wrap gap-2">
          <Link to="/bookings"    className="text-xs font-medium px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white inline-flex items-center gap-1"><Plus size={12}/>New booking</Link>
          <Link to="/brokers"     className="text-xs font-medium px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white inline-flex items-center gap-1"><UserPlus size={12}/>Add broker</Link>
          <Link to="/payments"    className="text-xs font-medium px-3 py-1.5 rounded-lg bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 inline-flex items-center gap-1"><CreditCard size={12}/>Record payment</Link>
          <Link to="/payouts"     className="text-xs font-medium px-3 py-1.5 rounded-lg bg-white border border-gray-300 hover:bg-gray-50 text-gray-700 inline-flex items-center gap-1"><Banknote size={12}/>Pay brokers</Link>
        </div>
      </div>

      {loadError && (
        <div className="flex items-start gap-2.5 rounded-xl border border-rose-300 bg-rose-50 px-4 py-3 text-sm">
          <ShieldAlert size={16} className="text-rose-600 mt-0.5 shrink-0"/>
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-rose-900">The dashboard couldn't finish loading, so the figures below are not real.</div>
            <div className="text-rose-800 text-[12px] mt-0.5 break-words">{loadError}</div>
          </div>
          <button onClick={() => setReloadKey(k => k + 1)}
            className="shrink-0 text-xs font-medium px-3 py-1.5 rounded-lg bg-rose-600 hover:bg-rose-700 text-white">
            Try again
          </button>
        </div>
      )}

      {signedOut && (
        <div className="flex items-start gap-2.5 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm">
          <ShieldAlert size={16} className="text-rose-600 mt-0.5 shrink-0"/>
          <span className="text-rose-900">
            Your session isn't active, so EMI, expense, commission and withdrawal figures can't be
            read and will show as zero. Sign in again to see the real numbers.
          </span>
        </div>
      )}

      {dataIssues > 0 && (
        <div className="flex items-start gap-2.5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm">
          <ShieldAlert size={16} className="text-amber-600 mt-0.5 shrink-0"/>
          <span className="text-amber-900">
            {dataIssues} of the dashboard's queries didn't come back, so some figures below may read low or zero.
            Reload the page; if it keeps happening the browser console has the details.
          </span>
        </div>
      )}

      {/* Receipts are held back on these bookings (90-day EMI lapsation).  Surfaced here
          because a blocked receipt is discovered at the counter otherwise. */}
      {lapsed.bookings > 0 && (
        <Link to="/customer-pipeline?tab=emi_active"
          className="flex items-start gap-2.5 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 hover:border-rose-300 transition">
          <ShieldAlert size={16} className="text-rose-600 mt-0.5 shrink-0"/>
          <div className="text-sm">
            <span className="font-semibold text-rose-900">
              {lapsed.bookings} booking{lapsed.bookings === 1 ? '' : 's'} past the 90-day EMI limit
            </span>
            <span className="text-rose-800"> · {formatINR(lapsed.amount)} in arrears. Receipts on these are held back until the dues are cleared.</span>
          </div>
        </Link>
      )}

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
          const hasDelta = typeof t.delta === 'number'
          const up = (t.delta || 0) >= 0
          const card = (
            <div key={i} className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm hover:border-gray-300 transition-colors h-full">
              <div className="flex items-start justify-between gap-2">
                <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">{t.label}</p>
                {hasDelta && (
                  <span className={`inline-flex items-center gap-0.5 text-[10px] font-semibold px-1.5 py-0.5 rounded-full shrink-0 ${
                    up ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'
                  }`}>
                    {up ? <TrendingUp size={10}/> : <TrendingDown size={10}/>}
                    {up ? '+' : ''}{t.delta}%
                  </span>
                )}
              </div>
              <p className={`text-2xl font-bold mt-1 ${t.color || 'text-gray-900'}`}>{t.value}</p>
              {t.sub && <p className="text-[11px] text-gray-400 mt-1">{t.sub}</p>}
              {hasDelta && <p className="text-[10px] text-gray-400 mt-0.5">vs last month</p>}
            </div>
          )
          return t.href ? <Link key={i} to={t.href}>{card}</Link> : card
        })}
      </div>

      {/* Money — what came in, what went out, what is left.  Collected is verified
          payments only; spend is every expense dated inside the window.  Defaults to
          All time: a month-scoped headline reads as a dead business in a quiet month. */}
      <div className="rounded-2xl border border-gray-200 bg-gradient-to-br from-slate-50 to-white p-5">
        <div className="flex items-center justify-between gap-3 mb-4 flex-wrap">
          <h2 className="text-sm font-semibold text-gray-900">Money</h2>
          <div className="flex items-center gap-2">
            <div className="inline-flex rounded-lg border border-gray-200 overflow-hidden text-xs bg-white">
              {([['all', 'All time'], ['month', 'This month'], ['prev', 'Last month']] as const).map(([v, label]) => (
                <button key={v} onClick={() => setMoneyPeriod(v)}
                  className={`px-3 py-1.5 ${moneyPeriod === v ? 'bg-gray-900 text-white' : 'text-gray-600 hover:bg-gray-50'}`}>
                  {label}
                </button>
              ))}
            </div>
            <Link to="/expenses" className="text-xs text-blue-700 hover:underline">Expenses →</Link>
          </div>
        </div>
        {(() => {
          const collected = moneyPeriod === 'all' ? money.collectedAll : moneyPeriod === 'month' ? money.collectedMonth : money.collectedPrev
          const spend     = moneyPeriod === 'all' ? money.spendAll     : moneyPeriod === 'month' ? money.spendMonth     : money.spendPrev
          const windowLabel = moneyPeriod === 'all' ? 'all time' : moneyPeriod === 'month' ? 'this month' : 'last month'
          return (
            <>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                <div>
                  <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Collected</p>
                  <p className="text-2xl font-bold text-emerald-700 mt-1">{formatINR(collected)}</p>
                  <p className="text-[11px] text-gray-400">verified payments · {windowLabel}</p>
                </div>
                <div>
                  <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Spend</p>
                  <p className="text-2xl font-bold text-rose-700 mt-1">{formatINR(spend)}</p>
                  <p className="text-[11px] text-gray-400">
                    {moneyPeriod === 'month' && money.spendPrev > 0
                      ? `${Math.abs(Math.round(((money.spendMonth - money.spendPrev) / money.spendPrev) * 100))}% ${money.spendMonth >= money.spendPrev ? 'more' : 'less'} than last month`
                      : `expenses · ${windowLabel}`}
                  </p>
                </div>
                <div>
                  <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Net</p>
                  <p className={`text-2xl font-bold mt-1 ${collected - spend >= 0 ? 'text-gray-900' : 'text-rose-700'}`}>
                    {formatINR(collected - spend)}
                  </p>
                  <p className="text-[11px] text-gray-400">collected − spend</p>
                </div>
                <div>
                  <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Advances out</p>
                  <p className="text-2xl font-bold text-amber-700 mt-1">{formatINR(money.advances)}</p>
                  <p className="text-[11px] text-gray-400">reduces broker payouts · all time</p>
                </div>
              </div>
              {collected > 0 && (
                <div className="mt-4">
                  <div className="h-2 rounded-full bg-emerald-100 overflow-hidden flex">
                    <div className="h-full bg-rose-500" style={{ width: `${Math.min(100, (spend / collected) * 100)}%` }}/>
                  </div>
                  <p className="text-[11px] text-gray-500 mt-1">
                    {Math.round((spend / collected) * 100)}% of what was collected {windowLabel} has gone back out as expenses.
                  </p>
                </div>
              )}
            </>
          )
        })()}
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

      {/* Broker Payables card + Top broker this month — payables on the left holds 4 small
          payable tiles, the right column shows who's carrying the team right now so admin
          has a name+face to associate with the "Earned (Distributed)" number. */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5 lg:col-span-2">
          <div className="flex items-start justify-between mb-3">
            <div>
              <h3 className="text-sm font-semibold text-gray-900">Broker Payables</h3>
              <p className="text-xs text-gray-500">Distributed commission vs. what you've paid out — same numbers brokers see on their dashboards.</p>
            </div>
            <Link to="/payouts" className="text-xs text-blue-600 hover:underline">Open Payouts →</Link>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <PayTile label="Earned (Distributed)" value={formatINR(payables.accrued)}        sub={`${payables.brokerCount} brokers`}        color="text-blue-700"/>
            <PayTile label="Paid (This Month)"    value={formatINR(payables.paidThisMonth)}  sub="cycle batches paid this month"            color="text-green-700"/>
            <PayTile label="Pending Payout"       value={formatINR(payables.pending)}        sub="earned − paid this month"                 color={payables.pending > 0 ? 'text-orange-700' : 'text-gray-500'}/>
            <PayTile label="Open Withdrawals"     value={String(payables.openWdCount)}        sub={<Link to="/withdrawals" className="text-blue-600 hover:underline">awaiting approval →</Link>} color="text-gray-900"/>
          </div>
        </div>

        <div className="bg-gradient-to-br from-amber-50 to-orange-50 rounded-xl border border-amber-200 shadow-sm p-5 flex flex-col">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-amber-900 inline-flex items-center gap-1.5">
              <Award size={14}/>Top broker · this month
            </h3>
            <Link to="/analytics" className="text-[11px] text-amber-800 hover:underline">all →</Link>
          </div>
          {topBroker ? (
            <Link to={`/brokers/${topBroker.id}`} className="flex flex-col gap-1.5 hover:opacity-90 transition-opacity">
              <div className="flex items-center gap-2">
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-amber-400 to-orange-500 text-white flex items-center justify-center text-base font-bold">
                  {topBroker.name.charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-semibold text-gray-900 truncate">{topBroker.name}</div>
                  <div className="text-[11px] text-amber-800 font-mono truncate">[{topBroker.code}] · {topBroker.rank || '—'}</div>
                </div>
              </div>
              <div className="mt-2 pt-2 border-t border-amber-200">
                <div className="text-[10px] uppercase tracking-wide text-amber-700 font-medium">Earned this month</div>
                <div className="text-xl font-bold text-amber-900">{formatINR(topBroker.earned)}</div>
              </div>
            </Link>
          ) : (
            <div className="text-sm text-gray-500 flex-1 flex items-center justify-center text-center">
              No commissions distributed yet this month.
            </div>
          )}
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

      {/* Recent activity — unified feed of the last bookings + payments interleaved by time
          so admin sees the live pulse of the business in one column instead of bouncing
          between two parallel tables. */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-gray-900 inline-flex items-center gap-1.5">
            <Activity size={14}/>Recent activity
          </h3>
          <Link to="/customer-pipeline" className="text-xs text-blue-600 hover:underline">view all bookings</Link>
        </div>
        {(() => {
          type Evt = { at: string; kind: 'booking' | 'payment'; href: string; title: any; sub: string; amount: number; amountColor: string }
          const evts: Evt[] = []
          for (const b of recentBookings) {
            evts.push({
              at: b.application_date || b.created_at || '',
              kind: 'booking',
              href: `/customer-pipeline?search=${encodeURIComponent(b.booking_no || '')}`,
              title: <span className="font-mono text-xs text-blue-700">{b.booking_no}</span>,
              sub: `${b.bp_customers?.name || '—'} · ${b.stage}`,
              amount: Number(b.total_amount || 0),
              amountColor: 'text-gray-900',
            })
          }
          for (const p of recentPayments) {
            evts.push({
              at: p.payment_date || p.created_at || '',
              kind: 'payment',
              href: `/customer-pipeline?search=${encodeURIComponent(p.bp_bookings?.booking_no || '')}`,
              title: <span className="font-mono text-xs text-gray-700">{p.receipt_no || '—'}</span>,
              sub: `${p.bp_bookings?.booking_no || '—'} · ${p.bp_bookings?.bp_customers?.name || '—'}`,
              amount: Number(p.amount || 0),
              amountColor: 'text-green-700',
            })
          }
          evts.sort((a, b) => (b.at || '').localeCompare(a.at || ''))
          const shown = evts.slice(0, 10)
          if (shown.length === 0) return <p className="text-sm text-gray-400">No activity yet — once bookings and payments come in they'll show here.</p>
          return (
            <div className="divide-y divide-gray-50">
              {shown.map((e, i) => (
                <Link key={i} to={e.href} className="py-2 flex items-center gap-3 hover:bg-gray-50 -mx-2 px-2 rounded">
                  <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${
                    e.kind === 'booking' ? 'bg-blue-50 text-blue-700' : 'bg-green-50 text-green-700'
                  }`}>
                    {e.kind === 'booking' ? <FileText size={13}/> : <CreditCard size={13}/>}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] uppercase tracking-wide font-semibold text-gray-500">{e.kind}</span>
                      <span className="text-gray-300">·</span>
                      {e.title}
                    </div>
                    <div className="text-xs text-gray-500 truncate">{e.sub}</div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className={`font-semibold ${e.amountColor} text-sm inline-flex items-center gap-1`}>
                      {formatINR(e.amount)}<ArrowRight size={11} className="text-gray-300"/>
                    </div>
                    <div className="text-[10px] text-gray-400">{formatDate(e.at)}</div>
                  </div>
                </Link>
              ))}
            </div>
          )
        })()}
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
