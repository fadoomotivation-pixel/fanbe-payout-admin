import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams, Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import {
  LogOut, Users, Wallet, Award, TrendingUp, ArrowUpRight, AlertCircle,
  ChevronRight, EyeOff, BarChart3, Coins, Receipt, CalendarDays, Send,
  ShieldCheck, Crown,
} from 'lucide-react'
import toast from 'react-hot-toast'

function formatINR(n: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n || 0)
}
function formatDate(d: any) { return d ? new Date(d).toLocaleDateString('en-IN') : '—' }
function monthKey(d: Date) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2,'0')}` }
function shortMonth(key: string) {
  const [, m] = key.split('-')
  return ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][Number(m) - 1] || key
}

type Tab = 'overview' | 'customers' | 'team' | 'payouts' | 'withdrawals'

export default function BrokerDashboard() {
  const navigate = useNavigate()
  const [search] = useSearchParams()
  const shadowBrokerId = search.get('broker_id')

  const [loading, setLoading] = useState(true)
  const [broker, setBroker] = useState<any>(null)
  const [ranks, setRanks] = useState<any[]>([])
  const [downline, setDownline] = useState<any[]>([])
  const [downlineEarnings, setDownlineEarnings] = useState<Record<string, number>>({})
  const [payouts, setPayouts] = useState<any[]>([])
  const [withdrawals, setWithdrawals] = useState<any[]>([])
  const [bookings, setBookings] = useState<any[]>([])
  const [customers, setCustomers] = useState<any[]>([])
  const [expandedCust, setExpandedCust] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('overview')
  const [adminShadow, setAdminShadow] = useState(false)
  const [wdModal, setWdModal] = useState(false)
  const [wdAmount, setWdAmount] = useState('')
  const [wdSubmitting, setWdSubmitting] = useState(false)

  useEffect(() => { (async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { navigate('/broker/login'); return }

    let b: any = null
    if (shadowBrokerId) {
      const { data: adminRow } = await supabase.from('app_users').select('id, role_id, active').eq('auth_user_id', user.id).maybeSingle()
      if (!adminRow?.active) { toast.error('Admin access required for shadow mode'); navigate('/broker/login'); return }
      const { data: target } = await supabase
        .from('brokers').select('*, sponsor:sponsor_id(id,name,broker_id,rank)')
        .eq('id', shadowBrokerId).maybeSingle()
      if (!target) { toast.error('Broker not found'); navigate('/brokers'); return }
      b = target; setAdminShadow(true)
    } else {
      const { data: ownBroker } = await supabase
        .from('brokers').select('*, sponsor:sponsor_id(id,name,broker_id,rank)')
        .eq('auth_user_id', user.id).maybeSingle()
      if (!ownBroker) { toast.error('Broker profile not linked to this login'); await supabase.auth.signOut(); navigate('/broker/login'); return }
      b = ownBroker
    }
    setBroker(b)

    const [rk, dl, po, wd, bk] = await Promise.all([
      supabase.from('commission_ranks').select('*').eq('active', true).order('level', { ascending: true }),
      supabase.from('brokers').select('id, name, broker_id, rank, phone, status').eq('sponsor_id', b.id),
      supabase.from('payout_distributions').select('*').eq('beneficiary_broker_id', b.id).order('created_at', { ascending: false }).limit(30),
      supabase.from('withdrawal_requests').select('*').eq('broker_id', b.id).order('created_at', { ascending: false }).limit(20),
      supabase
        .from('bp_bookings')
        .select('id, booking_no, customer_id, plot_total_price, total_amount, booking_amount, commission_amount, stage, scheme_name, application_date, bp_customers(id,customer_code,name,phone,father_or_husband_name), bp_plots(plot_no,size_sqyd), bp_projects(name)')
        .eq('broker_id', b.id)
        .order('created_at', { ascending: false }),
    ])
    setRanks(rk.data || [])
    setDownline(dl.data || [])
    setPayouts(po.data || [])
    setWithdrawals(wd.data || [])
    setBookings(bk.data || [])

    // Downline earnings (their commissions)
    const dlIds = (dl.data || []).map((d: any) => d.id)
    if (dlIds.length) {
      const { data: dlBk } = await supabase
        .from('bp_bookings')
        .select('broker_id, commission_amount, stage')
        .in('broker_id', dlIds)
        .eq('stage', 'booking_done')
      const map: Record<string, number> = {}
      for (const r of dlBk || []) {
        if (!r.broker_id) continue
        map[r.broker_id] = (map[r.broker_id] || 0) + Number(r.commission_amount || 0)
      }
      setDownlineEarnings(map)
    }

    // Group bookings by customer + aggregate paid/overdue
    const grouped: Record<string, any> = {}
    for (const r of (bk.data || []) as any[]) {
      const cid = r.customer_id; if (!cid) continue
      if (!grouped[cid]) grouped[cid] = { customer: r.bp_customers, bookings: [], totalCost: 0, totalPaid: 0, outstanding: 0, overdueCount: 0, nextDue: null }
      grouped[cid].bookings.push(r)
      grouped[cid].totalCost += Number(r.total_amount || r.plot_total_price || 0)
    }
    const allBookingIds = (bk.data || []).map((x: any) => x.id)
    if (allBookingIds.length) {
      const [{ data: payments }, { data: scheds }] = await Promise.all([
        supabase.from('bp_payments').select('booking_id, amount').in('booking_id', allBookingIds).eq('verification_status', 'verified'),
        supabase.from('emi_schedules').select('id, booking_id').in('booking_id', allBookingIds),
      ])
      for (const p of (payments || []) as any[]) {
        const row = (bk.data || []).find((x: any) => x.id === p.booking_id) as any
        if (!row) continue
        grouped[row.customer_id].totalPaid += Number(p.amount || 0)
      }
      const schedIds = (scheds || []).map((s: any) => s.id)
      if (schedIds.length) {
        const { data: insts } = await supabase.from('emi_installments').select('schedule_id, due_date, amount, status, seq').in('schedule_id', schedIds)
        const schedToBooking: Record<string, string> = {}
        for (const s of (scheds || []) as any[]) schedToBooking[s.id] = s.booking_id
        for (const i of (insts || []) as any[]) {
          const bid = schedToBooking[i.schedule_id]; if (!bid) continue
          const row = (bk.data || []).find((x: any) => x.id === bid) as any; if (!row) continue
          const cid = row.customer_id
          if (i.status !== 'paid' && new Date(i.due_date) < new Date()) grouped[cid].overdueCount++
          if (i.status !== 'paid') {
            const nd = grouped[cid].nextDue
            if (!nd || i.due_date < nd.due_date) grouped[cid].nextDue = i
          }
        }
      }
    }
    Object.values(grouped).forEach((g: any) => g.outstanding = Math.max(0, g.totalCost - g.totalPaid))
    setCustomers(Object.values(grouped))
    setLoading(false)
  })() }, [navigate, shadowBrokerId])

  // ── Derived stats ─────────────────────────────────────────────────
  const stats = useMemo(() => {
    const confirmed = bookings.filter((b: any) => b.stage === 'booking_done')
    const totalEarned = confirmed.reduce((s: number, b: any) => s + Number(b.commission_amount || 0), 0)
    const year = new Date().getFullYear(); const month = new Date().getMonth()
    const earnedThisMonth = confirmed
      .filter((b: any) => b.application_date && new Date(b.application_date).getFullYear() === year && new Date(b.application_date).getMonth() === month)
      .reduce((s: number, b: any) => s + Number(b.commission_amount || 0), 0)
    const paidOut = withdrawals.filter((w: any) => w.status === 'paid').reduce((s: number, w: any) => s + Number(w.net_amount || w.amount || 0), 0)
    const pendingWithdrawals = withdrawals.filter((w: any) => w.status === 'pending' || w.status === 'approved').reduce((s: number, w: any) => s + Number(w.amount || 0), 0)
    const availableBalance = Math.max(0, totalEarned - paidOut - pendingWithdrawals)
    const totalVolume = confirmed.reduce((s: number, b: any) => s + Number(b.total_amount || b.plot_total_price || 0), 0)
    const teamVolume = Object.values(downlineEarnings).reduce((s, v) => s + v, 0)
    return { totalEarned, earnedThisMonth, paidOut, availableBalance, totalVolume, teamVolume, confirmedCount: confirmed.length }
  }, [bookings, withdrawals, downlineEarnings])

  // Last 6 months earnings bar chart
  const monthlyEarnings = useMemo(() => {
    const out: { key: string; label: string; value: number }[] = []
    const now = new Date()
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      out.push({ key: monthKey(d), label: shortMonth(monthKey(d)), value: 0 })
    }
    for (const b of bookings) {
      if (b.stage !== 'booking_done' || !b.application_date) continue
      const k = monthKey(new Date(b.application_date))
      const slot = out.find(o => o.key === k); if (!slot) continue
      slot.value += Number(b.commission_amount || 0)
    }
    return out
  }, [bookings])
  const maxMonthly = Math.max(1, ...monthlyEarnings.map(m => m.value))

  // Rank progression
  const rankProgress = useMemo(() => {
    if (!broker?.rank || !ranks.length) return null
    const sorted = [...ranks].sort((a: any, b: any) => (a.level || 0) - (b.level || 0))
    const current = sorted.find((r: any) => r.rank_name === broker.rank)
    if (!current) return null
    const next = sorted.find((r: any) => (r.level || 0) > (current.level || 0))
    if (!next) return { current, next: null, progress: 100, hint: 'You are at the top rank.' }
    let progress = 0; let hint = ''
    if (next.rank_qualification_type === 'sales' || next.min_sq_yards) {
      const need = Number(next.min_sq_yards || 0)
      const have = Number(broker.total_sqyd || 0)
      progress = need > 0 ? Math.min(100, Math.round((have / need) * 100)) : 0
      hint = `${have} / ${need} sq.yd to reach ${next.rank_name}`
    } else if (next.required_sub_rank_level != null) {
      const sublevel = next.required_sub_rank_level
      const subRankName = sorted.find((r: any) => r.level === sublevel)?.rank_name
      const need = Number(next.required_sub_rank_count || 0)
      const have = downline.filter((d: any) => d.rank === subRankName).length
      progress = need > 0 ? Math.min(100, Math.round((have / need) * 100)) : 0
      hint = `${have} / ${need} ${subRankName || 'sub-rank'} downline to reach ${next.rank_name}`
    } else {
      hint = `Next rank: ${next.rank_name}`
    }
    return { current, next, progress, hint }
  }, [broker, ranks, downline])

  const tdsPct = broker?.tds_applicable ? 5 : 0
  const wdNet = Math.max(0, (Number(wdAmount) || 0) * (1 - tdsPct / 100))

  const submitWithdrawal = async () => {
    if (adminShadow) { toast.error('Shadow mode is read-only'); return }
    const amount = Number(wdAmount) || 0
    if (amount <= 0) { toast.error('Enter an amount'); return }
    if (amount > stats.availableBalance) { toast.error('Amount exceeds available balance'); return }
    if (!broker?.bank_name || !broker?.account_no) { toast.error('Bank details missing — ask admin to update your profile'); return }
    setWdSubmitting(true)
    const { error } = await supabase.from('withdrawal_requests').insert({
      broker_id: broker.id,
      amount,
      net_amount: Math.round(wdNet),
      tds_pct: tdsPct,
      status: 'pending',
      bank_name: broker.bank_name,
      account_no: broker.account_no,
      ifsc: broker.ifsc,
      account_holder: broker.account_holder || broker.name,
    })
    setWdSubmitting(false)
    if (error) { toast.error(error.message); return }
    toast.success('Withdrawal request submitted')
    setWdModal(false); setWdAmount('')
    const { data: wd } = await supabase.from('withdrawal_requests').select('*').eq('broker_id', broker.id).order('created_at', { ascending: false }).limit(20)
    setWithdrawals(wd || [])
  }

  const logout = async () => {
    if (adminShadow) { navigate('/brokers'); return }
    await supabase.auth.signOut(); navigate('/broker/login')
  }

  if (loading) return <div className="min-h-screen flex items-center justify-center"><div className="w-8 h-8 border-2 border-emerald-600 border-t-transparent rounded-full animate-spin"/></div>

  return (
    <div className="min-h-screen bg-gray-50">
      {adminShadow && (
        <div className="bg-amber-500 text-white text-xs font-medium">
          <div className="max-w-5xl mx-auto px-6 py-2 flex items-center justify-between">
            <span className="flex items-center gap-2"><EyeOff size={13}/>Admin shadow mode — viewing this broker's portal. No data is being modified.</span>
            <Link to="/brokers" className="underline">Exit shadow mode →</Link>
          </div>
        </div>
      )}

      <header className="bg-gradient-to-r from-emerald-600 to-emerald-700 text-white">
        <div className="max-w-5xl mx-auto px-6 py-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <div className="text-xs opacity-80">Broker Portal</div>
              <div className="font-bold text-2xl">{broker?.name} <span className="font-mono text-xs opacity-80">[{broker?.broker_id}]</span></div>
              <div className="text-xs opacity-80 mt-1 flex items-center gap-2 flex-wrap">
                <span className="inline-flex items-center gap-1"><Crown size={12}/>{broker?.rank || '—'}</span>
                <span className="opacity-50">·</span>
                <span className="inline-flex items-center gap-1"><ShieldCheck size={12}/>KYC: {broker?.kyc_status || 'pending'}</span>
                {broker?.sponsor && <><span className="opacity-50">·</span><span>Sponsor: {broker.sponsor.name}</span></>}
              </div>
            </div>
            <button onClick={logout} className="flex items-center gap-1 text-sm bg-white/10 hover:bg-white/20 rounded-lg px-3 py-1.5"><LogOut size={14}/>{adminShadow ? 'Exit shadow' : 'Logout'}</button>
          </div>

          {/* Earnings hero */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-2">
            <Hero icon={<Coins size={14}/>}     label="Total Earned"     value={formatINR(stats.totalEarned)}     sub={`${stats.confirmedCount} confirmed`}/>
            <Hero icon={<CalendarDays size={14}/>} label="This Month"     value={formatINR(stats.earnedThisMonth)} sub="commission earned"/>
            <Hero icon={<Wallet size={14}/>}    label="Available"        value={formatINR(stats.availableBalance)} sub="ready to withdraw" highlight/>
            <Hero icon={<Send size={14}/>}      label="Paid Out"         value={formatINR(stats.paidOut)}         sub="lifetime"/>
          </div>

          {!adminShadow && (
            <div className="mt-4 flex flex-wrap gap-2">
              <button onClick={() => setWdModal(true)} disabled={stats.availableBalance <= 0} className="inline-flex items-center gap-1.5 bg-white text-emerald-700 text-sm font-semibold px-4 py-2 rounded-lg hover:bg-white/90 disabled:opacity-50 disabled:cursor-not-allowed">
                <Send size={14}/>Request Withdrawal
              </button>
              {broker?.kyc_status !== 'approved' && (
                <Link to="#" className="inline-flex items-center gap-1.5 bg-white/10 text-white text-sm px-4 py-2 rounded-lg hover:bg-white/20">
                  <ShieldCheck size={14}/>Complete KYC
                </Link>
              )}
            </div>
          )}
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-6 space-y-6">
        {broker?.kyc_status !== 'approved' && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3">
            <AlertCircle size={18} className="text-amber-600 mt-0.5"/>
            <div className="text-sm text-amber-900">
              <b>KYC {broker?.kyc_status || 'pending'}</b> — payouts will be released after admin approves your KYC.
            </div>
          </div>
        )}

        {/* Tab bar */}
        <div className="flex gap-2 border-b border-gray-200 overflow-x-auto">
          {([
            { key: 'overview',    label: 'Overview',         icon: BarChart3 },
            { key: 'customers',   label: `Customers (${customers.length})`,    icon: Users },
            { key: 'team',        label: `Team (${downline.length})`,           icon: Users },
            { key: 'payouts',     label: `Payouts (${payouts.length})`,         icon: Receipt },
            { key: 'withdrawals', label: `Withdrawals (${withdrawals.length})`, icon: Send },
          ] as { key: Tab; label: string; icon: any }[]).map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px inline-flex items-center gap-1.5 whitespace-nowrap ${tab === t.key ? 'border-emerald-600 text-emerald-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
              <t.icon size={13}/>{t.label}
            </button>
          ))}
        </div>

        {tab === 'overview' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <Section title="Last 6 months · commission earned" icon={<BarChart3 size={14}/>}>
              <div className="flex items-end justify-between gap-2 h-32 mt-2">
                {monthlyEarnings.map(m => (
                  <div key={m.key} className="flex-1 flex flex-col items-center gap-1">
                    <div className="w-full bg-emerald-100 rounded-t" style={{ height: `${(m.value / maxMonthly) * 100}%`, minHeight: '4px' }}>
                      <div className="w-full h-full bg-emerald-500 rounded-t" style={{ opacity: m.value > 0 ? 1 : 0.2 }}/>
                    </div>
                    <div className="text-[10px] text-gray-500">{m.label}</div>
                  </div>
                ))}
              </div>
              <div className="text-[11px] text-gray-400 mt-2">Hover/tap a bar to read the amount on your phone. Total this period: <b>{formatINR(monthlyEarnings.reduce((s, m) => s + m.value, 0))}</b></div>
            </Section>

            <Section title="Rank progress" icon={<Crown size={14}/>}>
              {rankProgress ? (
                <div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-semibold text-gray-900">{rankProgress.current.rank_name}</span>
                    {rankProgress.next && <span className="text-xs text-gray-500">→ {rankProgress.next.rank_name}</span>}
                  </div>
                  <div className="mt-2 h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full bg-emerald-500" style={{ width: `${rankProgress.progress}%` }}/>
                  </div>
                  <div className="text-xs text-gray-500 mt-2">{rankProgress.hint}</div>
                  <div className="text-[11px] text-gray-400 mt-1">Your commission rate: <b>{rankProgress.current.commission_pct || 0}%</b>{rankProgress.next ? ` → ${rankProgress.next.commission_pct || 0}% at ${rankProgress.next.rank_name}` : ''}</div>
                </div>
              ) : <p className="text-sm text-gray-500">Rank info not available.</p>}
            </Section>

            <Section title="Sales volume" icon={<TrendingUp size={14}/>}>
              <div className="space-y-3 text-sm">
                <div className="flex items-center justify-between"><span className="text-gray-500">My personal volume</span><b>{formatINR(stats.totalVolume)}</b></div>
                <div className="flex items-center justify-between"><span className="text-gray-500">My team's commission</span><b>{formatINR(stats.teamVolume)}</b></div>
                <div className="flex items-center justify-between"><span className="text-gray-500">Total Sq.Yd sold</span><b>{broker?.total_sqyd || 0}</b></div>
              </div>
            </Section>

            <Section title="My sponsor (upline)" icon={<ArrowUpRight size={14}/>}>
              {broker?.sponsor ? (
                <div className="flex items-center justify-between">
                  <div>
                    <div className="font-semibold">{broker.sponsor.name}</div>
                    <div className="text-xs text-gray-500 font-mono">[{broker.sponsor.broker_id}] · {broker.sponsor.rank}</div>
                  </div>
                  <ArrowUpRight size={18} className="text-emerald-600"/>
                </div>
              ) : <p className="text-sm text-gray-500">You are at the top of your tree — no sponsor.</p>}
            </Section>

            <Section title="Recent commissions" icon={<Coins size={14}/>}>
              {bookings.filter((b:any) => b.stage === 'booking_done').slice(0,5).length === 0 ? (
                <p className="text-sm text-gray-500">No confirmed commissions yet.</p>
              ) : (
                <div className="divide-y divide-gray-100 text-sm">
                  {bookings.filter((b:any) => b.stage === 'booking_done').slice(0,5).map((b: any) => (
                    <div key={b.id} className="py-2 flex items-center justify-between">
                      <div>
                        <div className="font-mono text-xs text-blue-700">{b.booking_no}</div>
                        <div className="text-xs text-gray-500">{b.bp_customers?.name} · {b.scheme_name || b.bp_projects?.name || '—'}</div>
                      </div>
                      <div className="text-right">
                        <div className="font-semibold text-emerald-700">{formatINR(b.commission_amount)}</div>
                        <div className="text-[10px] text-gray-400">{formatDate(b.application_date)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </Section>

            <Section title="Latest withdrawal" icon={<Send size={14}/>}>
              {withdrawals.length === 0 ? (
                <p className="text-sm text-gray-500">No withdrawal history yet.</p>
              ) : (() => {
                const w = withdrawals[0]
                return (
                  <div className="text-sm space-y-1">
                    <div className="flex justify-between"><span className="text-gray-500">Amount</span><b>{formatINR(w.amount)}</b></div>
                    <div className="flex justify-between"><span className="text-gray-500">Net after TDS</span><b className="text-emerald-700">{formatINR(w.net_amount || w.amount)}</b></div>
                    <div className="flex justify-between"><span className="text-gray-500">Status</span><WdBadge status={w.status}/></div>
                    <div className="flex justify-between"><span className="text-gray-500">Requested</span><span>{formatDate(w.created_at)}</span></div>
                  </div>
                )
              })()}
            </Section>
          </div>
        )}

        {tab === 'customers' && (
          <Section title={`My Customers (${customers.length})`}>
            {customers.length === 0 ? <p className="text-sm text-gray-500">No customers attached to your bookings yet.</p> : (
              <div className="divide-y divide-gray-100">
                {customers.map((g: any) => {
                  const open = expandedCust === g.customer.id
                  return (
                    <div key={g.customer.id}>
                      <button onClick={() => setExpandedCust(open ? null : g.customer.id)} className="w-full text-left py-3 flex items-center justify-between hover:bg-gray-50 rounded-lg px-2">
                        <div>
                          <div className="font-mono text-[11px] text-gray-500">{g.customer.customer_code || '—'}</div>
                          <div className="font-semibold text-sm">{g.customer.name}</div>
                          <div className="text-xs text-gray-500">{g.customer.phone}{g.customer.father_or_husband_name ? ` · S/o ${g.customer.father_or_husband_name}` : ''}</div>
                        </div>
                        <div className="text-right">
                          <div className="text-xs text-gray-500">Cost / Paid</div>
                          <div className="text-sm font-semibold">{formatINR(g.totalCost)} <span className="text-green-700">· {formatINR(g.totalPaid)}</span></div>
                          {g.overdueCount > 0 && <div className="text-[10px] text-red-700 font-semibold">{g.overdueCount} overdue</div>}
                          {g.nextDue && g.overdueCount === 0 && <div className="text-[10px] text-amber-700">Next due {formatDate(g.nextDue.due_date)}</div>}
                        </div>
                        <ChevronRight size={14} className={`ml-2 text-gray-400 transition-transform ${open ? 'rotate-90' : ''}`}/>
                      </button>
                      {open && (
                        <div className="px-2 pb-3 space-y-2">
                          {g.bookings.map((b: any) => (
                            <div key={b.id} className="bg-gray-50 rounded-lg p-3 text-xs">
                              <div className="flex items-center justify-between">
                                <div>
                                  <div className="font-mono text-blue-700 font-semibold">{b.booking_no}</div>
                                  <div>{b.scheme_name || b.bp_projects?.name || '—'} · Plot {b.bp_plots?.plot_no || '—'} ({b.bp_plots?.size_sqyd || '—'} sq)</div>
                                  <div className="text-gray-500">Stage: <span className="capitalize">{b.stage?.replace(/_/g,' ')}</span> · Booking amt {formatINR(b.booking_amount)}</div>
                                </div>
                                <div className="text-right">
                                  <div className="font-semibold text-green-700">{formatINR(b.total_amount || b.plot_total_price)}</div>
                                  <div className="text-[10px] text-emerald-700">Comm {formatINR(b.commission_amount || 0)}</div>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </Section>
        )}

        {tab === 'team' && (
          <Section title={`My direct team (${downline.length})`}>
            {downline.length === 0 ? <p className="text-sm text-gray-500">No direct downline yet.</p> : (
              <div className="divide-y divide-gray-100">
                {downline.map(d => (
                  <div key={d.id} className="py-2 flex items-center justify-between">
                    <div>
                      <div className="font-medium text-sm">{d.name}</div>
                      <div className="text-xs text-gray-500 font-mono">[{d.broker_id}] · {d.rank}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-sm font-semibold text-emerald-700">{formatINR(downlineEarnings[d.id] || 0)}</div>
                      <div className="text-[10px] text-gray-400">their earned · {d.phone}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Section>
        )}

        {tab === 'payouts' && (
          <Section title="Payout history">
            {payouts.length === 0 ? <p className="text-sm text-gray-500">No payouts yet.</p> : (
              <table className="w-full text-sm">
                <thead className="text-xs text-gray-500 uppercase"><tr><th className="text-left py-2">Date</th><th className="text-left">Type</th><th className="text-left">Level</th><th className="text-right">Gross</th><th className="text-right">Net</th></tr></thead>
                <tbody className="divide-y divide-gray-100">
                  {payouts.map(p => (
                    <tr key={p.id}>
                      <td className="py-2 text-xs">{formatDate(p.created_at)}</td>
                      <td className="text-xs capitalize">{p.income_type}</td>
                      <td className="text-xs">L{p.level}</td>
                      <td className="text-right text-xs">{formatINR(p.gross_payout)}</td>
                      <td className="text-right font-semibold text-emerald-700">{formatINR(p.net_payout)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Section>
        )}

        {tab === 'withdrawals' && (
          <Section title="Withdrawal requests" right={!adminShadow && <button onClick={() => setWdModal(true)} disabled={stats.availableBalance <= 0} className="text-xs px-3 py-1.5 rounded bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-50">+ New request</button>}>
            {withdrawals.length === 0 ? <p className="text-sm text-gray-500">No withdrawal requests yet.</p> : (
              <div className="divide-y divide-gray-100">
                {withdrawals.map(w => (
                  <div key={w.id} className="py-3 flex items-center justify-between text-sm">
                    <div>
                      <div className="font-medium">{formatINR(w.amount)} <span className="text-xs text-gray-500">→ net {formatINR(w.net_amount || w.amount)}</span></div>
                      <div className="text-xs text-gray-500">{formatDate(w.created_at)} · {w.bank_name || '—'} {w.account_no ? `· ${w.account_no.slice(-4)}` : ''}</div>
                    </div>
                    <WdBadge status={w.status}/>
                  </div>
                ))}
              </div>
            )}
          </Section>
        )}
      </main>

      {wdModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 px-4" onClick={() => setWdModal(false)}>
          <div onClick={e => e.stopPropagation()} className="bg-white rounded-2xl max-w-md w-full p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-lg font-bold text-gray-900">Request a withdrawal</h3>
              <button onClick={() => setWdModal(false)} className="text-gray-400 hover:text-gray-700">✕</button>
            </div>
            <div className="text-xs bg-emerald-50 border border-emerald-200 rounded-lg p-3 text-emerald-900">
              Available balance: <b>{formatINR(stats.availableBalance)}</b>
              {tdsPct > 0 && <div className="mt-0.5">TDS applicable @ <b>{tdsPct}%</b> will be deducted.</div>}
            </div>
            <div>
              <label className="text-xs text-gray-500 block mb-1">Amount (₹)</label>
              <input type="number" value={wdAmount} onChange={e => setWdAmount(e.target.value)} placeholder="0" max={stats.availableBalance}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"/>
            </div>
            <div className="text-xs space-y-1 text-gray-600">
              <div className="flex justify-between"><span>Gross</span><b>{formatINR(Number(wdAmount) || 0)}</b></div>
              <div className="flex justify-between"><span>TDS ({tdsPct}%)</span><b className="text-red-600">−{formatINR((Number(wdAmount) || 0) * tdsPct / 100)}</b></div>
              <div className="flex justify-between pt-1 border-t border-gray-100"><span>You'll receive</span><b className="text-emerald-700">{formatINR(wdNet)}</b></div>
            </div>
            <div className="text-xs bg-gray-50 rounded-lg p-3">
              <div className="text-gray-500 mb-1">Credit to:</div>
              {broker?.bank_name ? (
                <div>{broker.bank_name} · {broker.account_no ? `••${broker.account_no.slice(-4)}` : 'no a/c on file'} · {broker.ifsc || 'no IFSC'}</div>
              ) : <div className="text-red-600">No bank details on file — contact admin.</div>}
            </div>
            <div className="flex justify-end gap-2">
              <button onClick={() => setWdModal(false)} className="px-4 py-2 rounded-lg border border-gray-200 text-sm">Cancel</button>
              <button onClick={submitWithdrawal} disabled={wdSubmitting || !broker?.bank_name} className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-sm font-semibold">
                {wdSubmitting ? 'Submitting…' : 'Submit Request'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Hero({ icon, label, value, sub, highlight }: any) {
  return (
    <div className={`rounded-xl p-3 ${highlight ? 'bg-white text-emerald-700' : 'bg-white/10 text-white'}`}>
      <div className={`flex items-center gap-1.5 text-xs ${highlight ? 'text-emerald-600' : 'opacity-80'}`}>{icon}{label}</div>
      <div className="font-bold text-xl mt-0.5">{value}</div>
      {sub && <div className={`text-[11px] mt-0.5 ${highlight ? 'text-emerald-500' : 'opacity-70'}`}>{sub}</div>}
    </div>
  )
}

function Section({ title, icon, right, children }: any) {
  return (
    <section className="bg-white rounded-xl p-5 border border-gray-100 shadow-sm">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-semibold text-gray-700 inline-flex items-center gap-1.5">{icon}{title}</h3>
        {right}
      </div>
      {children}
    </section>
  )
}

function WdBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    pending:  'bg-amber-100 text-amber-700',
    approved: 'bg-blue-100 text-blue-700',
    paid:     'bg-green-100 text-green-700',
    rejected: 'bg-red-100 text-red-700',
    on_hold:  'bg-gray-100 text-gray-700',
  }
  return <span className={`text-xs px-2 py-0.5 rounded-full capitalize ${map[status] || 'bg-gray-100 text-gray-600'}`}>{status?.replace(/_/g,' ')}</span>
}
