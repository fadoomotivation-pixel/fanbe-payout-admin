import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams, Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import {
  LogOut, Users, Wallet, Award, TrendingUp, ArrowUpRight, AlertCircle,
  ChevronRight, EyeOff, BarChart3, Coins, Receipt, CalendarDays, Send,
  ShieldCheck, Crown, Phone, MessageCircle, Edit3, Building, Settings as Cog,
  Activity, CheckCircle2, XCircle, Lock, Unlock, Banknote, FileText, Printer,
  UserPlus, Loader2, Upload, FileCheck2, Clock, MapPin, Calendar, Hash,
} from 'lucide-react'
import { printPaymentReceipt } from '@/lib/printTemplates'
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

type Tab = 'overview' | 'customers' | 'team' | 'payouts' | 'withdrawals' | 'activity' | 'admin'

export default function BrokerDashboard() {
  const navigate = useNavigate()
  const [search] = useSearchParams()
  const shadowBrokerId = search.get('broker_id')

  const [loading, setLoading] = useState(true)
  const [broker, setBroker] = useState<any>(null)
  const [ranks, setRanks] = useState<any[]>([])
  const [downline, setDownline] = useState<any[]>([])
  const [downlineEarnings, setDownlineEarnings] = useState<Record<string, number>>({})
  const [downlineCustomers, setDownlineCustomers] = useState<Record<string, { id: string; name: string; code: string }[]>>({})
  const [payouts, setPayouts] = useState<any[]>([])
  const [withdrawals, setWithdrawals] = useState<any[]>([])
  const [cycleTxns, setCycleTxns] = useState<any[]>([])
  // Advances taken by this broker (Expense under the "Advance" head) reduce what
  // they can withdraw — mirrors payoutEngine.loadBrokerWallets so the broker's own
  // dashboard shows the same 'available' as the admin /withdrawals gate.
  const [advanceTotal, setAdvanceTotal] = useState(0)
  const [bookings, setBookings] = useState<any[]>([])
  const [customers, setCustomers] = useState<any[]>([])
  const [expandedCust, setExpandedCust] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('overview')
  const [adminShadow, setAdminShadow] = useState(false)
  const [wdModal, setWdModal] = useState(false)
  const [wdAmount, setWdAmount] = useState('')
  const [wdSubmitting, setWdSubmitting] = useState(false)
  // ── Admin shadow modals ──
  const [profileModal, setProfileModal] = useState(false)
  const [bankModal, setBankModal]       = useState(false)
  const [kycModal, setKycModal]         = useState<{ mode: 'approve' | 'reject' } | null>(null)
  const [profileForm, setProfileForm]   = useState<any>({})
  const [bankForm, setBankForm]         = useState<any>({})
  const [kycReason, setKycReason]       = useState('')
  const [savingProfile, setSavingProfile] = useState(false)
  const [savingBank, setSavingBank]       = useState(false)
  const [savingKyc, setSavingKyc]         = useState(false)
  // ── Broker self-KYC upload (admin-side equivalent lives at /kyc).  Until now the
  // "Complete KYC" CTA in the hero pointed nowhere — admin saw "0/0 docs" on the
  // review page because brokers had no way to actually submit anything.
  const [kycDocsModal, setKycDocsModal] = useState(false)
  const [myKycDocs,    setMyKycDocs]    = useState<any[]>([])
  const [uploadingDoc, setUploadingDoc] = useState<string | null>(null)
  // ── Multi-level team ──
  const [expandedTeam, setExpandedTeam] = useState<Set<string>>(new Set())
  const [subTeams, setSubTeams]         = useState<Record<string, any[]>>({})
  const [activity, setActivity]         = useState<any[]>([])
  // Filter chips at the top of the Activity tab — admin can narrow a busy timeline to
  // just commissions, just withdrawals, or just bookings without scrolling.
  const [activityFilter, setActivityFilter] = useState<'all' | 'payouts' | 'withdrawals' | 'bookings'>('all')
  const [payoutOpen, setPayoutOpen]     = useState<Record<string, boolean>>({})

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

    const [rk, dl, po, wd, bk, cycleTx, kyc, adv] = await Promise.all([
      supabase.from('commission_ranks').select('*').eq('active', true).order('level', { ascending: true }),
      supabase.from('brokers').select('id, name, broker_id, rank, phone, status').eq('sponsor_id', b.id),
      supabase.from('payout_distributions').select('*, bp_bookings(booking_no, bp_customers(name), bp_plots(plot_no))').eq('beneficiary_broker_id', b.id).order('created_at', { ascending: false }).limit(200),
      supabase.from('withdrawal_requests').select('*').eq('broker_id', b.id).order('created_at', { ascending: false }).limit(20),
      supabase
        .from('bp_bookings')
        .select('id, booking_no, customer_id, plot_total_price, total_amount, booking_amount, commission_amount, stage, scheme_name, application_date, closed_at, created_at, bp_customers(id,customer_code,name,phone,email,address,father_or_husband_name,pan,dob), bp_plots(plot_no,size_sqyd,sector,block), bp_projects(id,name,location)')
        .eq('broker_id', b.id)
        .order('created_at', { ascending: false }),
      // Cycle-batch payouts for this broker — must count toward "paid out" and reduce "available"
      // so the broker can't withdraw money admin already paid via a Payout Cycle batch.
      supabase.from('bp_payout_transactions').select('id, net_amount, amount, status, paid_date, payout_type, utr_ref, cycle_id, created_at').eq('broker_id', b.id),
      // Broker's own KYC docs — feeds the upload modal so they can see what's already been
      // submitted and verified by admin without having to ask.
      supabase.from('bp_broker_kyc').select('*').eq('broker_id', b.id).order('created_at', { ascending: false }),
      // Advances given to this broker (Expense under the "Advance" head).
      supabase.from('expenses').select('amount, expense_heads(name)').eq('broker_id', b.id),
    ])
    setRanks(rk.data || [])
    setDownline(dl.data || [])
    setPayouts(po.data || [])
    setWithdrawals(wd.data || [])
    setCycleTxns(cycleTx.data || [])
    setBookings(bk.data || [])
    setMyKycDocs(kyc.data || [])
    setAdvanceTotal((adv.data || []).reduce((s: number, e: any) =>
      s + ((e.expense_heads?.name || '').toLowerCase() === 'advance' ? Number(e.amount || 0) : 0), 0))

    // Downline earnings (their commissions)
    const dlIds = (dl.data || []).map((d: any) => d.id)
    // Always fetch customers for the broker being viewed too, not just their downline.
    // Otherwise the org chart shows NIDHI under Nisha in /team-tree but NOT in Nisha's own
    // dashboard team tab — the two views must agree.
    const customerLookupIds = [b.id, ...dlIds]
    if (customerLookupIds.length) {
      const [{ data: dlDist }, { data: dlBk }, { data: linkedBrokers }] = await Promise.all([
        dlIds.length
          ? supabase
              .from('payout_distributions')
              .select('beneficiary_broker_id, net_payout')
              .in('beneficiary_broker_id', dlIds)
          : Promise.resolve({ data: [] as any[] }),
        supabase
          .from('bp_bookings')
          .select('broker_id, customer_id, bp_customers(id, name, customer_code, phone)')
          .in('broker_id', customerLookupIds)
          .not('customer_id', 'is', null),
        // Dedupe customers that are also brokers (auto-promote target).  Same 3-signal
        // approach as the /team-tree page: customer_id link, broker_id == customer_code,
        // or exact phone match.  Without this the team mini-tree on the broker dashboard
        // shows the same person twice (once as a broker card, once as a "Make broker"
        // customer leaf) -- "uneducated people think they have two bookings."
        supabase
          .from('brokers')
          .select('customer_id, broker_id, phone'),
      ])
      const earnedMap: Record<string, number> = {}
      for (const d of (dlDist || []) as any[]) {
        if (!d.beneficiary_broker_id) continue
        earnedMap[d.beneficiary_broker_id] = (earnedMap[d.beneficiary_broker_id] || 0) + Number(d.net_payout || 0)
      }
      const isBrokerCustId = new Set<string>()
      const brokerCodes    = new Set<string>()
      const brokerPhones   = new Set<string>()
      for (const r of (linkedBrokers || []) as any[]) {
        if (r.customer_id) isBrokerCustId.add(r.customer_id)
        if (r.broker_id)   brokerCodes.add(String(r.broker_id))
        if (r.phone)       brokerPhones.add(String(r.phone).trim())
      }
      const seen: Record<string, Set<string>> = {}
      const custMap: Record<string, { id: string; name: string; code: string }[]> = {}
      for (const r of (dlBk || []) as any[]) {
        const cust = r.bp_customers
        if (!cust) continue
        // Skip customers that are already a broker (any of the 3 signals).
        if (isBrokerCustId.has(r.customer_id)) continue
        if (cust.customer_code && brokerCodes.has(String(cust.customer_code))) continue
        if (cust.phone && brokerPhones.has(String(cust.phone).trim())) continue
        const s = (seen[r.broker_id] ??= new Set())
        if (s.has(r.customer_id)) continue
        s.add(r.customer_id)
        ;(custMap[r.broker_id] ??= []).push({
          id:   cust.id,
          name: cust.name || '—',
          code: cust.customer_code || '',
        })
      }
      setDownlineEarnings(earnedMap)
      setDownlineCustomers(custMap)
    }

    // Group bookings by customer + aggregate paid/overdue.  Per booking we ALSO keep the
    // full payments list and EMI schedule so the customers tab can render minute details
    // (payment-by-payment receipts, EMI seq-by-seq dues) without re-fetching.
    const grouped: Record<string, any> = {}
    for (const r of (bk.data || []) as any[]) {
      const cid = r.customer_id; if (!cid) continue
      if (!grouped[cid]) grouped[cid] = { customer: r.bp_customers, bookings: [], totalCost: 0, totalPaid: 0, outstanding: 0, overdueCount: 0, nextDue: null }
      // payments / emi populated below
      r.payments = []
      r.emi = []
      r.totalPaid = 0
      r.outstanding = Number(r.total_amount || r.plot_total_price || 0)
      grouped[cid].bookings.push(r)
      grouped[cid].totalCost += Number(r.total_amount || r.plot_total_price || 0)
    }
    const allBookingIds = (bk.data || []).map((x: any) => x.id)
    if (allBookingIds.length) {
      const [{ data: payments }, { data: scheds }] = await Promise.all([
        // Need the full payment row (not just amount) so we can print receipts and show UTR,
        // payment_type, mode, instalment_no, etc. in the customers tab.
        supabase.from('bp_payments').select('id, booking_id, payment_type, amount, payment_mode, utr_ref, payment_date, receipt_no, instalment_no, drawn_on_bank, branch, sponsor_name, rupees_in_words, verification_status, created_at, print_count').in('booking_id', allBookingIds).order('payment_date', { ascending: false }),
        supabase.from('emi_schedules').select('id, booking_id').in('booking_id', allBookingIds),
      ])
      const bookingsById: Record<string, any> = {}
      for (const r of (bk.data || []) as any[]) bookingsById[r.id] = r
      for (const p of (payments || []) as any[]) {
        const row = bookingsById[p.booking_id]; if (!row) continue
        row.payments.push(p)
        if (p.verification_status === 'verified') {
          row.totalPaid += Number(p.amount || 0)
          grouped[row.customer_id].totalPaid += Number(p.amount || 0)
        }
      }
      const schedIds = (scheds || []).map((s: any) => s.id)
      if (schedIds.length) {
        const { data: insts } = await supabase.from('emi_installments').select('id, schedule_id, due_date, amount, paid_amount, status, seq').in('schedule_id', schedIds).order('seq', { ascending: true })
        const schedToBooking: Record<string, string> = {}
        for (const s of (scheds || []) as any[]) schedToBooking[s.id] = s.booking_id
        for (const i of (insts || []) as any[]) {
          const bid = schedToBooking[i.schedule_id]; if (!bid) continue
          const row = bookingsById[bid]; if (!row) continue
          row.emi.push(i)
          const cid = row.customer_id
          if (i.status !== 'paid' && new Date(i.due_date) < new Date()) grouped[cid].overdueCount++
          if (i.status !== 'paid') {
            const nd = grouped[cid].nextDue
            if (!nd || i.due_date < nd.due_date) grouped[cid].nextDue = { ...i, booking_no: row.booking_no, customer_name: row.bp_customers?.name, customer_phone: row.bp_customers?.phone, customer_id: cid }
          }
        }
      }
      for (const r of (bk.data || []) as any[]) r.outstanding = Math.max(0, Number(r.total_amount || r.plot_total_price || 0) - r.totalPaid)
    }
    Object.values(grouped).forEach((g: any) => g.outstanding = Math.max(0, g.totalCost - g.totalPaid))
    setCustomers(Object.values(grouped))

    // ── Activity timeline: merge events from bookings, withdrawals, payouts, closure_audit ──
    const events: any[] = []
    for (const bb of (bk.data || []) as any[]) {
      if (bb.created_at) events.push({ at: bb.created_at, kind: 'booking_created', title: `Booking ${bb.booking_no} created`, sub: `${bb.bp_customers?.name || '—'} · Plot ${bb.bp_plots?.plot_no || '—'}`, icon: 'booking', amount: bb.total_amount || bb.plot_total_price })
      if (bb.closed_at) events.push({ at: bb.closed_at, kind: 'booking_closed', title: `Booking ${bb.booking_no} closed`, sub: `${bb.bp_customers?.name || '—'} · Plot ${bb.bp_plots?.plot_no || '—'}`, icon: 'lock', amount: bb.total_amount || bb.plot_total_price })
    }
    for (const w of (wd.data || []) as any[]) {
      if (w.created_at) events.push({ at: w.created_at, kind: 'withdrawal_requested', title: 'Withdrawal requested', sub: w.bank_name || '—', icon: 'send', amount: w.amount, status: w.status })
      if (w.paid_at)    events.push({ at: w.paid_at,    kind: 'withdrawal_paid',      title: 'Withdrawal paid',     sub: `UTR ${w.utr || '—'}`, icon: 'check', amount: w.net_amount || w.amount })
      if (w.closed_at)  events.push({ at: w.closed_at,  kind: 'withdrawal_closed',    title: 'Withdrawal closed',   sub: w.bank_name || '—',    icon: 'lock', amount: w.net_amount || w.amount })
    }
    for (const p of (po.data || []) as any[]) {
      if (!p.created_at) continue
      // Earlier this title was `Payout L${p.level || '?'}` — when level is 0 (direct/self),
      // 0 is falsy so it rendered "L?".  And "L1 / differential" still told the admin
      // nothing about WHICH deal the credit came from.  Use a friendly label per income
      // type and surface the booking + customer + plot so the event is self-explaining.
      const bookingNo = p.bp_bookings?.booking_no
      const customer  = p.bp_bookings?.bp_customers?.name
      const plotNo    = p.bp_bookings?.bp_plots?.plot_no
      const lvl       = Number(p.level ?? 0)
      const title     =
        p.income_type === 'direct' || lvl === 0
          ? 'Direct commission'
          : `Upline differential · L${lvl}`
      const rate      = Number(p.differential_pct ?? p.rate_pct ?? 0)
      const parts     = [
        bookingNo ? bookingNo : null,
        customer  ? customer  : null,
        plotNo    ? `Plot ${plotNo}` : null,
        rate > 0  ? `${rate}%` : null,
      ].filter(Boolean)
      events.push({
        at: p.created_at,
        kind: lvl === 0 ? 'payout_direct' : 'payout_upline',
        title,
        sub: parts.join(' · ') || '—',
        icon: 'coins',
        amount: p.net_payout,
      })
    }
    events.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    setActivity(events.slice(0, 40))

    setLoading(false)
  })() }, [navigate, shadowBrokerId])

  // ── Derived stats ─────────────────────────────────────────────────
  // Earnings use the deferred-commission model: only money actually distributed via per-payment MLM
  // counts as "earned" — NOT the full booking.commission_amount (which is just the promised total).
  // This makes "Available" reflect what the broker can really withdraw today.
  const stats = useMemo(() => {
    const confirmed = bookings.filter((b: any) => b.stage === 'booking_done')

    // Actually-distributed commission for this broker
    const totalEarned = (payouts || []).reduce((s: number, p: any) => s + Number(p.net_payout || 0), 0)

    // This-month slice of distributed commission
    const year = new Date().getFullYear(); const month = new Date().getMonth()
    const earnedThisMonth = (payouts || [])
      .filter((p: any) => p.created_at && new Date(p.created_at).getFullYear() === year && new Date(p.created_at).getMonth() === month)
      .reduce((s: number, p: any) => s + Number(p.net_payout || 0), 0)

    // Promised lifetime commission (booking.commission_amount) — shown as separate forecast figure, not spendable
    const promisedTotal = confirmed.reduce((s: number, b: any) => s + Number(b.commission_amount || 0), 0)
    const promisedPending = Math.max(0, promisedTotal - totalEarned)

    // "Paid out" + "pending" both pool the two payout channels — self-initiated withdrawals
    // AND admin-initiated cycle-batch transactions — so available balance never double-counts.
    const wdPaid     = withdrawals.filter((w: any) => w.status === 'paid' || w.status === 'closed').reduce((s: number, w: any) => s + Number(w.net_amount || w.amount || 0), 0)
    // Net (not gross) for pending too — see payoutEngine.loadBrokerWallets for the
    // full reasoning.  Mixing gross/net across statuses makes Available swing by the TDS
    // portion as a withdrawal flips between pending and paid.
    const wdPending  = withdrawals.filter((w: any) => w.status === 'pending' || w.status === 'approved').reduce((s: number, w: any) => s + Number(w.net_amount || w.amount || 0), 0)
    const cyPaid     = (cycleTxns || []).filter((t: any) => t.status === 'paid').reduce((s: number, t: any) => s + Number(t.net_amount || t.amount || 0), 0)
    const cyPending  = (cycleTxns || []).filter((t: any) => t.status === 'pending' || t.status === 'approved').reduce((s: number, t: any) => s + Number(t.net_amount || t.amount || 0), 0)
    const paidOut    = wdPaid + cyPaid
    const pending    = wdPending + cyPending
    // Advances (money already handed to the broker up front) reduce what's withdrawable.
    const availableBalance = Math.max(0, totalEarned - paidOut - pending - advanceTotal)
    const totalVolume = confirmed.reduce((s: number, b: any) => s + Number(b.total_amount || b.plot_total_price || 0), 0)
    const teamVolume = Object.values(downlineEarnings).reduce((s, v) => s + v, 0)
    return { totalEarned, earnedThisMonth, paidOut, availableBalance, totalVolume, teamVolume, confirmedCount: confirmed.length, promisedTotal, promisedPending }
  }, [bookings, withdrawals, downlineEarnings, payouts, cycleTxns, advanceTotal])

  // Last 6 months earnings bar chart.  MUST use the same source as the "Earned (distributed)"
  // hero card — payout_distributions — so the chart total equals the hero number.  Previously
  // this summed bookings.commission_amount (the *promised* total), so a broker who'd been
  // promised ₹4.5L but only had ₹27k actually distributed saw two wildly different numbers
  // on the same screen.  Money pages can't disagree with themselves.
  const monthlyEarnings = useMemo(() => {
    const out: { key: string; label: string; value: number }[] = []
    const now = new Date()
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      out.push({ key: monthKey(d), label: shortMonth(monthKey(d)), value: 0 })
    }
    for (const p of payouts) {
      if (!p.created_at) continue
      const k = monthKey(new Date(p.created_at))
      const slot = out.find(o => o.key === k); if (!slot) continue
      slot.value += Number(p.net_payout || 0)
    }
    return out
  }, [payouts])
  const maxMonthly = Math.max(1, ...monthlyEarnings.map(m => m.value))

  // Upcoming + overdue EMIs across ALL of this broker's bookings.  Lets them see at a
  // glance which customers to nudge today — chronologically ordered, with overdue items
  // floated to the top.  Drives a new "Chase customers" section on the overview tab.
  const upcomingEmis = useMemo(() => {
    const todayStr = new Date().toISOString().slice(0, 10)
    const horizon = new Date(); horizon.setDate(horizon.getDate() + 30)
    const horizonStr = horizon.toISOString().slice(0, 10)
    const out: any[] = []
    for (const g of customers) {
      for (const b of g.bookings) {
        for (const e of (b.emi || [])) {
          if (e.status === 'paid') continue
          if ((e.due_date || '') > horizonStr) continue
          const overdue = (e.due_date || '') < todayStr
          out.push({
            ...e,
            booking_no: b.booking_no,
            customer_id: g.customer.id,
            customer_name: g.customer.name,
            customer_phone: g.customer.phone,
            project: b.bp_projects?.name,
            plot: b.bp_plots?.plot_no,
            overdue,
            daysDelta: Math.round((new Date(e.due_date).getTime() - new Date(todayStr).getTime()) / (1000 * 60 * 60 * 24)),
            outstandingForRow: Math.max(0, Number(e.amount || 0) - Number(e.paid_amount || 0)),
          })
        }
      }
    }
    out.sort((a, b) => (a.due_date || '').localeCompare(b.due_date || ''))
    return out
  }, [customers])

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

  // ── Admin shadow actions ─────────────────────────────────────────
  const openProfile = () => {
    setProfileForm({
      name: broker?.name || '', phone: broker?.phone || '', email: broker?.email || '',
      pan_no: broker?.pan_no || '', aadhaar_no: broker?.aadhaar_no || '',
      rank: broker?.rank || '', status: broker?.status || 'active',
      tds_applicable: !!broker?.tds_applicable, kyc_status: broker?.kyc_status || 'pending',
      date_of_joining: broker?.date_of_joining || '',
    })
    setProfileModal(true)
  }
  const openBank = () => {
    setBankForm({
      bank_name: broker?.bank_name || '', account_no: broker?.account_no || '',
      ifsc: broker?.ifsc || '', account_holder: broker?.account_holder || broker?.name || '',
    })
    setBankModal(true)
  }

  const saveProfile = async () => {
    if (!broker) return
    setSavingProfile(true)
    const { error } = await supabase.from('brokers').update({
      ...profileForm,
      date_of_joining: profileForm.date_of_joining || null,
      updated_at: new Date().toISOString(),
    }).eq('id', broker.id)
    setSavingProfile(false)
    if (error) return toast.error(error.message)
    setBroker({ ...broker, ...profileForm })
    setProfileModal(false)
    toast.success('Profile updated')
  }

  const saveBank = async () => {
    if (!broker) return
    setSavingBank(true)
    const { error } = await supabase.from('brokers').update({
      ...bankForm, updated_at: new Date().toISOString(),
    }).eq('id', broker.id)
    setSavingBank(false)
    if (error) return toast.error(error.message)
    setBroker({ ...broker, ...bankForm })
    setBankModal(false)
    toast.success('Bank details updated')
  }

  const submitKyc = async () => {
    if (!broker || !kycModal) return
    const mode = kycModal.mode
    if (mode === 'reject' && !kycReason.trim()) return toast.error('Reason required to reject')
    setSavingKyc(true)
    const { data: { user } } = await supabase.auth.getUser()
    const newStatus = mode === 'approve' ? 'approved' : 'rejected'
    const { error } = await supabase.from('brokers').update({
      kyc_status: newStatus,
      kyc_reviewed_at: new Date().toISOString(),
      kyc_reviewed_by: user?.id || null,
      updated_at: new Date().toISOString(),
    }).eq('id', broker.id)
    setSavingKyc(false)
    if (error) return toast.error(error.message)
    setBroker({ ...broker, kyc_status: newStatus })
    setKycModal(null); setKycReason('')
    toast.success(`KYC ${newStatus}`)
  }

  // Print an A4 broker earnings statement: profile + per-booking distributions + withdrawals
  const printStatement = () => {
    const fmt = (n: number) => '₹' + Number(n || 0).toLocaleString('en-IN')
    const rows = (payouts as any[]).map((p: any) => `<tr>
      <td>${p.created_at ? new Date(p.created_at).toLocaleDateString('en-IN') : '—'}</td>
      <td>${p.bp_bookings?.booking_no || '—'}</td>
      <td>${p.income_type || '—'}</td>
      <td>${p.level === 0 ? 'Self' : 'L' + p.level}</td>
      <td style="text-align:right">${fmt(p.gross_payout)}</td>
      <td style="text-align:right">${fmt(p.net_payout)}</td>
    </tr>`).join('')
    const wdRows = (withdrawals as any[]).map((w: any) => `<tr>
      <td>${w.created_at ? new Date(w.created_at).toLocaleDateString('en-IN') : '—'}</td>
      <td>${(w.status || '').toUpperCase()}</td>
      <td>${w.utr || '—'}</td>
      <td style="text-align:right">${fmt(w.net_amount || w.amount)}</td>
    </tr>`).join('')
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Statement — ${broker?.name}</title>
    <style>@page{size:A4 portrait;margin:14mm}*{box-sizing:border-box}body{font-family:'Helvetica Neue',Arial,sans-serif;color:#0f172a;font-size:12px}
    .toolbar{position:fixed;top:0;left:0;right:0;display:flex;gap:10px;justify-content:center;padding:10px;background:#0f172a;z-index:9}
    .toolbar button{font:600 13px 'Helvetica Neue';padding:9px 18px;border-radius:8px;border:0;cursor:pointer}.toolbar .pr{background:#16a34a;color:#fff}.toolbar .cl{background:#334155;color:#e2e8f0}
    h1{font-size:18px;margin:0}.muted{color:#64748b;font-size:11px}.kpis{display:flex;gap:16px;margin:14px 0;flex-wrap:wrap}
    .kpi{border:1px solid #cbd5e1;border-radius:8px;padding:8px 14px}.kpi b{display:block;font-size:16px}
    table{width:100%;border-collapse:collapse;margin-top:8px;font-size:11px}th{background:#f1f5f9;text-align:left;padding:5px 6px;border-bottom:1px solid #cbd5e1}td{padding:5px 6px;border-bottom:1px dotted #e2e8f0}
    h3{margin:16px 0 4px;font-size:13px}@media print{.toolbar,.sp{display:none!important}}</style></head>
    <body>
    <div class="toolbar"><button class="pr" onclick="window.print()">🖨 Print statement</button><button class="cl" onclick="window.close()">Close</button></div>
    <div class="sp" style="height:46px"></div>
    <h1>FANBE GROUP — Broker Statement</h1>
    <div class="muted">${broker?.name} · [${broker?.broker_id}] · ${broker?.rank || ''} · KYC ${broker?.kyc_status || 'pending'} · Generated ${new Date().toLocaleString('en-IN')}</div>
    <div class="kpis">
      <div class="kpi"><span class="muted">Earned (distributed)</span><b>${fmt(stats.totalEarned)}</b></div>
      <div class="kpi"><span class="muted">Promised pending</span><b>${fmt(stats.promisedPending)}</b></div>
      <div class="kpi"><span class="muted">Paid out</span><b>${fmt(stats.paidOut)}</b></div>
      <div class="kpi"><span class="muted">Available</span><b>${fmt(stats.availableBalance)}</b></div>
    </div>
    <h3>Commission distributions (${payouts.length})</h3>
    <table><thead><tr><th>Date</th><th>Booking</th><th>Type</th><th>Level</th><th style="text-align:right">Gross</th><th style="text-align:right">Net</th></tr></thead>
    <tbody>${rows || '<tr><td colspan=6 style="text-align:center;color:#94a3b8">No commissions yet</td></tr>'}</tbody></table>
    <h3>Withdrawals (${withdrawals.length})</h3>
    <table><thead><tr><th>Date</th><th>Status</th><th>UTR</th><th style="text-align:right">Net</th></tr></thead>
    <tbody>${wdRows || '<tr><td colspan=4 style="text-align:center;color:#94a3b8">No withdrawals yet</td></tr>'}</tbody></table>
    <script>window.onload=()=>setTimeout(()=>window.print(),300)</script>
    </body></html>`
    const w = window.open('', '_blank', 'width=820,height=1100')
    if (w) { w.document.write(html); w.document.close() }
  }

  // ── L2 team expansion ────────────────────────────────────────────
  // One-click promote a customer to a broker, sponsored by whichever broker brought
  // them in.  Mirrors the same flow on /team-tree so admin gets the action wherever
  // they're already looking at the customer leaf.
  const [promoting, setPromoting] = useState(false)
  const promoteCustomerToBroker = async (customerId: string, sponsorId: string) => {
    setPromoting(true)
    try {
      const [{ data: cust }, { data: ranks }, { data: existing }] = await Promise.all([
        supabase.from('bp_customers').select('id, name, phone, email').eq('id', customerId).single(),
        supabase.from('commission_ranks').select('rank_name, level').eq('active', true).order('level', { ascending: true }).limit(1),
        supabase.from('brokers').select('broker_id').ilike('broker_id', 'FNB-%').order('broker_id', { ascending: false }).limit(1),
      ])
      if (!cust) throw new Error('Customer not found')
      let nextNum = 6000
      const lastCode = (existing as any[])?.[0]?.broker_id || ''
      const m = lastCode.match(/(\d+)\s*$/)
      if (m) nextNum = Number(m[1]) + 1
      const broker_id = `FNB-${String(nextNum).padStart(5, '0')}`
      const rank = (ranks as any[])?.[0]?.rank_name || null
      const { error } = await supabase.from('brokers').insert({
        broker_id,
        name:        (cust as any).name,
        phone:       (cust as any).phone || null,
        email:       (cust as any).email || null,
        sponsor_id:  sponsorId,
        rank,
        status:      'active',
        kyc_status:  'pending',
      })
      if (error) throw error
      toast.success(`Promoted to broker · ${broker_id}`)
      // Refresh downline + customer maps so the new broker shows up immediately.
      const { data: dl } = await supabase.from('brokers').select('id, name, broker_id, rank, phone, status').eq('sponsor_id', broker?.id || sponsorId)
      if (dl) setDownline(dl)
    } catch (e: any) {
      toast.error(e.message || 'Failed to promote')
    } finally {
      setPromoting(false)
    }
  }

  const toggleTeam = async (id: string) => {
    const next = new Set(expandedTeam)
    if (next.has(id)) { next.delete(id); setExpandedTeam(next); return }
    next.add(id); setExpandedTeam(next)
    if (!subTeams[id]) {
      const { data } = await supabase.from('brokers').select('id, name, broker_id, rank, phone').eq('sponsor_id', id)
      setSubTeams(prev => ({ ...prev, [id]: data || [] }))
    }
  }

  // ── KYC document upload (broker → admin) ───────────────────────────
  // Drop a file into Supabase Storage under `documents/kyc/{broker_id}/...`, then create a
  // bp_broker_kyc row so the admin's KYC review page picks it up.  Re-upload of the same
  // doc_type replaces (or rather adds a new row — admin can verify the latest).
  const uploadKycDoc = async (docType: string, docLabel: string, file: File) => {
    if (adminShadow) { toast.error('Shadow mode is read-only'); return }
    if (!broker?.id) return
    setUploadingDoc(docType)
    try {
      const ext  = (file.name.split('.').pop() || 'bin').toLowerCase()
      const path = `kyc/${broker.id}/${docType}-${Date.now()}.${ext}`
      const { error: upErr } = await supabase.storage.from('documents').upload(path, file, { cacheControl: '3600', upsert: false })
      if (upErr) throw upErr
      const { data: pub } = supabase.storage.from('documents').getPublicUrl(path)
      const { error: insErr } = await supabase.from('bp_broker_kyc').insert({
        broker_id: broker.id,
        doc_type:  docType,
        doc_label: docLabel,
        file_url:  pub.publicUrl,
        file_name: file.name,
        verified:  false,
      })
      if (insErr) throw insErr
      // If broker had been rejected, flip back to pending so admin sees the resubmission.
      if (broker.kyc_status === 'rejected') {
        await supabase.from('brokers').update({ kyc_status: 'pending' }).eq('id', broker.id)
        setBroker({ ...broker, kyc_status: 'pending' })
      }
      const { data: refreshed } = await supabase.from('bp_broker_kyc').select('*').eq('broker_id', broker.id).order('created_at', { ascending: false })
      setMyKycDocs(refreshed || [])
      toast.success(`${docLabel} uploaded — admin will review`)
    } catch (e: any) {
      toast.error(e.message || 'Upload failed')
    } finally {
      setUploadingDoc(null)
    }
  }

  const submitWithdrawal = async () => {
    if (adminShadow) { toast.error('Shadow mode is read-only'); return }
    const amount = Number(wdAmount) || 0
    if (amount <= 0) { toast.error('Enter an amount'); return }
    if (amount > stats.availableBalance) { toast.error('Amount exceeds available balance'); return }
    if (!broker?.bank_name || !broker?.account_no) { toast.error('Bank details missing — ask admin to update your profile'); return }
    // KYC gate — the soft warning at the top of the portal isn't enough.  Until admin
    // approves KYC the broker cannot submit a withdrawal request.  Matches the matching
    // gate on the admin side (Withdrawals.tsx Mark Paid).
    if (broker.kyc_status !== 'approved') { toast.error(`KYC ${broker.kyc_status || 'pending'} — payouts are held until admin approves your KYC.`); return }
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
            <Hero icon={<Coins size={14}/>}     label="Earned (distributed)" value={formatINR(stats.totalEarned)}    sub={stats.promisedPending > 0 ? `+${formatINR(stats.promisedPending)} promised, awaiting customer payments` : `${stats.confirmedCount} confirmed`}/>
            <Hero icon={<CalendarDays size={14}/>} label="This Month"     value={formatINR(stats.earnedThisMonth)} sub="distributed this month"/>
            <Hero icon={<Wallet size={14}/>}    label="Available"        value={formatINR(stats.availableBalance)} sub="ready to withdraw" highlight/>
            <Hero icon={<Send size={14}/>}      label="Paid Out"         value={formatINR(stats.paidOut)}         sub="lifetime"/>
          </div>

          {!adminShadow && (
            <div className="mt-4 flex flex-wrap gap-2">
              <button onClick={() => setWdModal(true)} disabled={stats.availableBalance <= 0} className="inline-flex items-center gap-1.5 bg-white text-emerald-700 text-sm font-semibold px-4 py-2 rounded-lg hover:bg-white/90 disabled:opacity-50 disabled:cursor-not-allowed">
                <Send size={14}/>Request Withdrawal
              </button>
              {broker?.kyc_status !== 'approved' && (
                <button onClick={() => setKycDocsModal(true)} className="inline-flex items-center gap-1.5 bg-white/10 text-white text-sm px-4 py-2 rounded-lg hover:bg-white/20">
                  <ShieldCheck size={14}/>{broker?.kyc_status === 'rejected' ? 'Re-submit KYC' : 'Complete KYC'}
                </button>
              )}
            </div>
          )}
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-6 space-y-6">
        {broker?.kyc_status !== 'approved' && !adminShadow && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3">
            <AlertCircle size={18} className="text-amber-600 mt-0.5 shrink-0"/>
            <div className="flex-1">
              <div className="text-sm text-amber-900">
                <b>KYC {broker?.kyc_status || 'pending'}</b> — payouts will be released after admin approves your KYC.
                {myKycDocs.length === 0 && ' Upload your documents to get started.'}
                {myKycDocs.length > 0 && ` ${myKycDocs.filter(d => d.verified).length}/${myKycDocs.length} documents verified by admin.`}
              </div>
            </div>
            <button onClick={() => setKycDocsModal(true)} className="shrink-0 text-xs font-semibold bg-amber-600 hover:bg-amber-700 text-white px-3 py-1.5 rounded-lg inline-flex items-center gap-1">
              <Upload size={12}/>{myKycDocs.length === 0 ? 'Upload docs' : 'Manage docs'}
            </button>
          </div>
        )}
        {broker?.kyc_status !== 'approved' && adminShadow && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3">
            <AlertCircle size={18} className="text-amber-600 mt-0.5"/>
            <div className="text-sm text-amber-900">
              <b>KYC {broker?.kyc_status || 'pending'}</b> — {myKycDocs.length} document{myKycDocs.length === 1 ? '' : 's'} on file
              {myKycDocs.length > 0 && `, ${myKycDocs.filter(d => d.verified).length} verified`}. Review via <Link to="/kyc" className="underline font-semibold">/kyc</Link>.
            </div>
          </div>
        )}

        {/* Admin shadow control bar */}
        {adminShadow && (
          <div className="bg-white border border-amber-200 rounded-xl p-4 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-amber-900 inline-flex items-center gap-1.5">
                <Cog size={14}/>Admin shadow controls
              </h3>
              <span className="text-[10px] text-gray-400">Acts on broker {broker?.broker_id}</span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              <button onClick={openProfile} className="px-3 py-2 text-xs rounded-lg border border-gray-200 hover:border-amber-300 hover:bg-amber-50 inline-flex items-center gap-2">
                <Edit3 size={13} className="text-amber-600"/>
                <span className="font-medium">Edit profile</span>
              </button>
              <button onClick={openBank} className="px-3 py-2 text-xs rounded-lg border border-gray-200 hover:border-amber-300 hover:bg-amber-50 inline-flex items-center gap-2">
                <Building size={13} className="text-amber-600"/>
                <span className="font-medium">Bank details</span>
              </button>
              {broker?.kyc_status === 'pending' ? (
                <>
                  <button onClick={() => setKycModal({ mode: 'approve' })} className="px-3 py-2 text-xs rounded-lg border border-emerald-200 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 inline-flex items-center gap-2">
                    <CheckCircle2 size={13}/>Approve KYC
                  </button>
                  <button onClick={() => setKycModal({ mode: 'reject' })} className="px-3 py-2 text-xs rounded-lg border border-rose-200 bg-rose-50 hover:bg-rose-100 text-rose-800 inline-flex items-center gap-2">
                    <XCircle size={13}/>Reject KYC
                  </button>
                </>
              ) : (
                <div className={`px-3 py-2 text-xs rounded-lg inline-flex items-center gap-2 ${broker?.kyc_status === 'approved' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-rose-50 text-rose-800 border border-rose-200'}`}>
                  <ShieldCheck size={13}/>KYC {broker?.kyc_status} {broker?.kyc_reviewed_at && `· ${formatDate(broker.kyc_reviewed_at)}`}
                </div>
              )}
              <button onClick={printStatement}
                className="px-3 py-2 text-xs rounded-lg border border-gray-200 hover:border-amber-300 hover:bg-amber-50 inline-flex items-center gap-2">
                <Printer size={13} className="text-amber-600"/>
                <span className="font-medium">Print statement</span>
              </button>
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
            { key: 'activity',    label: `Activity (${activity.length})`,       icon: Activity },
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
              {/* Was per-booking with b.commission_amount (the PROMISED total — e.g. ₹90,300
                  on a booking even though only a slice has actually been distributed).
                  Switched to per-distribution rows from payout_distributions so each line
                  is a real cash credit the broker received, matching the Earned hero card. */}
              {payouts.length === 0 ? (
                <p className="text-sm text-gray-500">No commissions distributed yet.</p>
              ) : (
                <div className="divide-y divide-gray-100 text-sm">
                  {payouts.slice(0,5).map((p: any) => {
                    const lvl = Number(p.level ?? 0)
                    const label = p.income_type === 'direct' || lvl === 0 ? 'Direct' : `Upline L${lvl}`
                    return (
                      <div key={p.id} className="py-2 flex items-center justify-between">
                        <div>
                          <div className="font-mono text-xs text-blue-700">{p.bp_bookings?.booking_no || '—'}</div>
                          <div className="text-xs text-gray-500">{p.bp_bookings?.bp_customers?.name || '—'} · {label}</div>
                        </div>
                        <div className="text-right">
                          <div className="font-semibold text-emerald-700">{formatINR(p.net_payout)}</div>
                          <div className="text-[10px] text-gray-400">{formatDate(p.created_at)}</div>
                        </div>
                      </div>
                    )
                  })}
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

            {/* Chase customers — the broker's collection inbox.  Lists EMIs that are overdue
                or due in the next 30 days, with one-tap Call / WhatsApp actions so the
                broker can nudge customers from the same place they see what's pending. */}
            <Section
              title={`Chase customers · ${upcomingEmis.length}`}
              icon={<AlertCircle size={14}/>}
              right={upcomingEmis.length > 0 ? <span className="text-[11px] text-gray-400">{upcomingEmis.filter(e => e.overdue).length} overdue · {upcomingEmis.filter(e => !e.overdue).length} due ≤30d</span> : undefined}
            >
              {upcomingEmis.length === 0 ? (
                <p className="text-sm text-gray-500">No EMIs overdue or due in the next 30 days. Nice.</p>
              ) : (
                <div className="divide-y divide-gray-100 -mx-2">
                  {upcomingEmis.slice(0, 8).map((e: any) => {
                    const msg = encodeURIComponent(`Hi ${e.customer_name || ''}, this is a reminder for EMI #${e.seq} of ₹${Number(e.outstandingForRow).toLocaleString('en-IN')} on booking ${e.booking_no}${e.overdue ? ' which is overdue' : ` due on ${new Date(e.due_date).toLocaleDateString('en-IN')}`}. Please arrange the payment at the earliest. — Fanbe Group`)
                    const cleanPhone = (e.customer_phone || '').replace(/[^0-9]/g, '')
                    return (
                      <div key={e.id} className="px-2 py-2.5 flex items-center gap-3">
                        <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${e.overdue ? 'bg-rose-50 text-rose-700' : 'bg-amber-50 text-amber-700'}`}>
                          <Calendar size={14}/>
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="text-sm font-semibold text-gray-900 truncate">{e.customer_name || '—'}</div>
                          <div className="text-[11px] text-gray-500 truncate">
                            <span className="font-mono text-blue-700">{e.booking_no}</span> · EMI #{e.seq}
                            {e.project && ` · ${e.project}`}
                            {e.plot && ` · Plot ${e.plot}`}
                          </div>
                        </div>
                        <div className="text-right shrink-0">
                          <div className={`text-sm font-bold ${e.overdue ? 'text-rose-700' : 'text-gray-900'}`}>{formatINR(e.outstandingForRow)}</div>
                          <div className="text-[10px] text-gray-500">
                            {e.overdue
                              ? `Overdue ${Math.abs(e.daysDelta)}d · due ${new Date(e.due_date).toLocaleDateString('en-IN')}`
                              : e.daysDelta === 0 ? 'Due today' : `Due in ${e.daysDelta}d`}
                          </div>
                        </div>
                        {cleanPhone && (
                          <div className="flex gap-1 shrink-0">
                            <a href={`tel:${cleanPhone}`} className="w-7 h-7 rounded-full bg-blue-50 hover:bg-blue-100 text-blue-700 flex items-center justify-center" title="Call customer">
                              <Phone size={12}/>
                            </a>
                            <a href={`https://wa.me/${cleanPhone}?text=${msg}`} target="_blank" rel="noreferrer" className="w-7 h-7 rounded-full bg-emerald-50 hover:bg-emerald-100 text-emerald-700 flex items-center justify-center" title="WhatsApp reminder">
                              <MessageCircle size={12}/>
                            </a>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
              {upcomingEmis.length > 8 && (
                <button onClick={() => setTab('customers')} className="mt-2 text-xs text-blue-600 hover:underline">See all in Customers tab →</button>
              )}
            </Section>
          </div>
        )}

        {tab === 'customers' && (
          <Section title={`My Customers (${customers.length})`}>
            {customers.length === 0 ? <p className="text-sm text-gray-500">No customers attached to your bookings yet.</p> : (
              <div className="space-y-2">
                {customers.map((g: any) => (
                  <CustomerCard
                    key={g.customer.id}
                    group={g}
                    expanded={expandedCust === g.customer.id}
                    onToggle={() => setExpandedCust(expandedCust === g.customer.id ? null : g.customer.id)}
                    broker={broker}
                  />
                ))}
              </div>
            )}
          </Section>
        )}

        {tab === 'team' && (
          <Section
            title={`Team · ${downline.length} direct`}
            right={
              <Link to={`/team-tree?root=${broker?.id || ''}`}
                className="text-xs px-2.5 py-1 rounded-full bg-gray-900 text-white hover:bg-black inline-flex items-center gap-1">
                Open full tree <ArrowUpRight size={11}/>
              </Link>
            }
          >
            {downline.length === 0 ? (
              <p className="text-sm text-gray-500">No direct downline yet.</p>
            ) : (
              // Wrapper scrolls horizontally for wide trees on phones.  The root broker
              // (the one being viewed) is rendered at the top; their direct downline fans
              // out beneath, and any deeper level lazy-loads on click via toggleTeam.
              <div className="overflow-x-auto -mx-5 px-5 py-2">
                <div className="inline-flex justify-center w-full min-w-fit">
                  <TeamOrgNode
                    broker={broker}
                    isRoot
                    initialChildren={downline}
                    subTeams={subTeams}
                    expandedTeam={expandedTeam}
                    downlineEarnings={downlineEarnings}
                    downlineCustomers={downlineCustomers}
                    onToggle={toggleTeam}
                    onPromote={promoteCustomerToBroker}
                    isPromoting={promoting}
                  />
                </div>
              </div>
            )}
            <div className="mt-3 text-[11px] text-gray-400">Tap any card to load and expand its sub-team. Tap again to collapse.</div>
          </Section>
        )}

        {tab === 'activity' && (() => {
          // Filter by chip selection.  Counts are computed from the full event list so the
          // chip labels show how many events are in each bucket regardless of current filter.
          const counts = {
            all:         activity.length,
            payouts:     activity.filter(e => e.kind === 'payout_direct' || e.kind === 'payout_upline').length,
            withdrawals: activity.filter(e => e.kind?.startsWith('withdrawal_')).length,
            bookings:    activity.filter(e => e.kind?.startsWith('booking_')).length,
          }
          const shown = activity.filter(e => {
            if (activityFilter === 'all') return true
            if (activityFilter === 'payouts')     return e.kind === 'payout_direct' || e.kind === 'payout_upline'
            if (activityFilter === 'withdrawals') return e.kind?.startsWith('withdrawal_')
            if (activityFilter === 'bookings')    return e.kind?.startsWith('booking_')
            return true
          })
          return (
            <Section title="Activity timeline" icon={<Activity size={14}/>}>
              {/* Filter chips */}
              <div className="flex flex-wrap gap-1.5 mb-3">
                {([
                  { key: 'all',         label: 'All',         count: counts.all },
                  { key: 'payouts',     label: 'Commissions', count: counts.payouts },
                  { key: 'withdrawals', label: 'Withdrawals', count: counts.withdrawals },
                  { key: 'bookings',    label: 'Bookings',    count: counts.bookings },
                ] as const).map(c => (
                  <button key={c.key} onClick={() => setActivityFilter(c.key)}
                    className={`text-xs px-3 py-1 rounded-full border transition ${
                      activityFilter === c.key
                        ? 'bg-gray-900 text-white border-gray-900'
                        : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
                    }`}>
                    {c.label} <span className={`ml-1 text-[10px] ${activityFilter === c.key ? 'opacity-70' : 'text-gray-400'}`}>{c.count}</span>
                  </button>
                ))}
              </div>

              {shown.length === 0 ? (
                <p className="text-sm text-gray-500">{activity.length === 0 ? 'No activity yet.' : 'No events in this view.'}</p>
              ) : (
                <div className="divide-y divide-gray-100">
                  {shown.map((e, i) => {
                    const Ic =
                      e.icon === 'booking' ? FileText :
                      e.icon === 'lock'    ? Lock :
                      e.icon === 'send'    ? Send :
                      e.icon === 'check'   ? CheckCircle2 :
                      e.icon === 'coins'   ? Coins :
                                             Activity
                    const tint =
                      e.kind === 'booking_created'      ? 'bg-blue-50 text-blue-700' :
                      e.kind === 'booking_closed'       ? 'bg-slate-100 text-slate-700' :
                      e.kind === 'withdrawal_requested' ? 'bg-amber-50 text-amber-700' :
                      e.kind === 'withdrawal_paid'      ? 'bg-emerald-50 text-emerald-700' :
                      e.kind === 'withdrawal_closed'    ? 'bg-slate-100 text-slate-700' :
                      e.kind === 'payout_direct'        ? 'bg-emerald-50 text-emerald-700' :
                      e.kind === 'payout_upline'        ? 'bg-indigo-50 text-indigo-700' :
                                                          'bg-gray-50 text-gray-700'
                    return (
                      <div key={i} className="py-2.5 flex items-start gap-3">
                        <div className={`w-7 h-7 rounded-full flex items-center justify-center ${tint} shrink-0`}><Ic size={13}/></div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-gray-900">{e.title}</div>
                          <div className="text-xs text-gray-500 truncate">{e.sub}</div>
                        </div>
                        <div className="text-right shrink-0">
                          {e.amount != null && <div className="text-sm font-semibold text-gray-900">{formatINR(e.amount)}</div>}
                          <div className="text-[10px] text-gray-400">{formatDate(e.at)}</div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </Section>
          )
        })()}

        {tab === 'payouts' && (
          <Section title="Payout history" right={
            payouts.length > 0 ? (
              <div className="text-xs text-gray-500">
                <b className="text-emerald-700">{formatINR(payouts.reduce((s: number, p: any) => s + Number(p.net_payout || 0), 0))}</b> net across {payouts.length} entries
              </div>
            ) : null
          }>
            {payouts.length === 0 ? <p className="text-sm text-gray-500">No payouts yet.</p> : (() => {
              // Group by booking_id so the admin sees per-deal totals (direct + each upline level), not a confusing fragment list.
              const groups: Record<string, any[]> = {}
              for (const p of payouts as any[]) {
                const k = p.booking_id || 'no-booking'
                if (!groups[k]) groups[k] = []
                groups[k].push(p)
              }
              const orderedKeys = Object.keys(groups).sort((a, b) => {
                const da = Math.max(...groups[a].map((r: any) => new Date(r.created_at).getTime()))
                const db = Math.max(...groups[b].map((r: any) => new Date(r.created_at).getTime()))
                return db - da
              })
              return (
                <div className="space-y-3">
                  {orderedKeys.map(k => {
                    const rows = groups[k]
                    const first = rows[0]
                    const bk = first.bp_bookings
                    const sumGross = rows.reduce((s, r) => s + Number(r.gross_payout || 0), 0)
                    const sumNet   = rows.reduce((s, r) => s + Number(r.net_payout || 0), 0)
                    const sumTds   = rows.reduce((s, r) => s + Number(r.tds_amount || 0), 0)
                    const sumAdmin = rows.reduce((s, r) => s + Number(r.admin_charge || 0), 0)
                    const open = !!(payoutOpen[k])
                    return (
                      <div key={k} className="rounded-xl border border-gray-200 bg-white">
                        <button onClick={() => setPayoutOpen((s: any) => ({ ...s, [k]: !s[k] }))}
                          className="w-full text-left px-4 py-3 flex items-center justify-between hover:bg-gray-50">
                          <div className="flex items-center gap-3 min-w-0">
                            <ChevronRight size={14} className={`text-gray-400 shrink-0 transition-transform ${open ? 'rotate-90' : ''}`}/>
                            <div className="min-w-0">
                              <div className="font-mono text-sm font-semibold text-blue-700 truncate">{bk?.booking_no || 'Other'}</div>
                              <div className="text-xs text-gray-500 truncate">
                                {bk?.bp_customers?.name || 'No customer'}{bk?.bp_plots?.plot_no ? ` · Plot ${bk.bp_plots.plot_no}` : ''} · {rows.length} payment{rows.length !== 1 ? 's' : ''}
                              </div>
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            <div className="text-sm font-bold text-emerald-700">{formatINR(sumNet)}</div>
                            <div className="text-[10px] text-gray-400">gross {formatINR(sumGross)} · −TDS {formatINR(sumTds)} · −adm {formatINR(sumAdmin)}</div>
                          </div>
                        </button>
                        {open && (
                          <div className="border-t border-gray-100 overflow-x-auto">
                            <table className="w-full text-xs">
                              <thead className="bg-gray-50 text-gray-500"><tr>{['Date','Type','Level','Rate','Base','Gross','TDS','Admin','Net'].map(h => <th key={h} className="px-3 py-2 text-left">{h}</th>)}</tr></thead>
                              <tbody className="divide-y divide-gray-50">
                                {rows.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()).map(p => (
                                  <tr key={p.id}>
                                    <td className="px-3 py-1.5 whitespace-nowrap">{formatDate(p.created_at)}</td>
                                    <td className="px-3 py-1.5 capitalize">{p.income_type}</td>
                                    <td className="px-3 py-1.5">{p.level === 0 ? 'Self' : `L${p.level} upline`}</td>
                                    <td className="px-3 py-1.5">{p.differential_pct || p.rate_pct || 0}%</td>
                                    <td className="px-3 py-1.5">{formatINR(p.base_amount)}</td>
                                    <td className="px-3 py-1.5">{formatINR(p.gross_payout)}</td>
                                    <td className="px-3 py-1.5 text-rose-600">−{formatINR(p.tds_amount || 0)}</td>
                                    <td className="px-3 py-1.5 text-amber-700">−{formatINR(p.admin_charge || 0)}</td>
                                    <td className="px-3 py-1.5 font-semibold text-emerald-700">{formatINR(p.net_payout)}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )
            })()}
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

      {kycDocsModal && broker && (
        <KycDocsModal
          docs={myKycDocs}
          status={broker.kyc_status || 'pending'}
          uploading={uploadingDoc}
          onClose={() => setKycDocsModal(false)}
          onUpload={uploadKycDoc}
        />
      )}

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

      {/* ── Admin: Edit Profile Modal ─────────────────────────────── */}
      {profileModal && (
        <AdminModal title="Edit broker profile" subtitle={`Modifying ${broker?.name}`} onClose={() => setProfileModal(false)}>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Name"><input value={profileForm.name || ''} onChange={e => setProfileForm((p: any) => ({ ...p, name: e.target.value }))} className={fld}/></Field>
            <Field label="Phone"><input value={profileForm.phone || ''} onChange={e => setProfileForm((p: any) => ({ ...p, phone: e.target.value }))} className={fld}/></Field>
            <Field label="Email"><input value={profileForm.email || ''} onChange={e => setProfileForm((p: any) => ({ ...p, email: e.target.value }))} className={fld}/></Field>
            <Field label="Date of joining"><input type="date" value={profileForm.date_of_joining || ''} onChange={e => setProfileForm((p: any) => ({ ...p, date_of_joining: e.target.value }))} className={fld}/></Field>
            <Field label="PAN"><input value={profileForm.pan_no || ''} onChange={e => setProfileForm((p: any) => ({ ...p, pan_no: e.target.value.toUpperCase() }))} className={fld}/></Field>
            <Field label="Aadhaar"><input value={profileForm.aadhaar_no || ''} onChange={e => setProfileForm((p: any) => ({ ...p, aadhaar_no: e.target.value }))} className={fld}/></Field>
            <Field label="Rank">
              <select value={profileForm.rank || ''} onChange={e => setProfileForm((p: any) => ({ ...p, rank: e.target.value }))} className={fld}>
                {ranks.map((r: any) => <option key={r.id} value={r.rank_name}>{r.rank_name}</option>)}
              </select>
            </Field>
            <Field label="Status">
              <select value={profileForm.status || 'active'} onChange={e => setProfileForm((p: any) => ({ ...p, status: e.target.value }))} className={fld}>
                {['active','inactive','suspended','blacklisted'].map(s => <option key={s} value={s} className="capitalize">{s}</option>)}
              </select>
            </Field>
            <Field label="KYC status">
              <select value={profileForm.kyc_status || 'pending'} onChange={e => setProfileForm((p: any) => ({ ...p, kyc_status: e.target.value }))} className={fld}>
                {['pending','approved','rejected','re_review'].map(s => <option key={s} value={s} className="capitalize">{s.replace(/_/g,' ')}</option>)}
              </select>
            </Field>
            <label className="text-xs text-gray-600 flex items-center gap-2 mt-5">
              <input type="checkbox" checked={!!profileForm.tds_applicable} onChange={e => setProfileForm((p: any) => ({ ...p, tds_applicable: e.target.checked }))}/>
              TDS applicable (5%) on payouts
            </label>
          </div>
          <div className="flex justify-end gap-2 mt-5">
            <button onClick={() => setProfileModal(false)} className="px-4 py-2 rounded-lg border border-gray-200 text-sm">Cancel</button>
            <button onClick={saveProfile} disabled={savingProfile} className="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-sm font-semibold disabled:opacity-50">
              {savingProfile ? 'Saving…' : 'Save profile'}
            </button>
          </div>
        </AdminModal>
      )}

      {/* ── Admin: Bank Details Modal ─────────────────────────────── */}
      {bankModal && (
        <AdminModal title="Bank details" subtitle="Used for withdrawal payouts" onClose={() => setBankModal(false)}>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Bank name"><input value={bankForm.bank_name || ''} onChange={e => setBankForm((p: any) => ({ ...p, bank_name: e.target.value }))} className={fld}/></Field>
            <Field label="Account holder"><input value={bankForm.account_holder || ''} onChange={e => setBankForm((p: any) => ({ ...p, account_holder: e.target.value }))} className={fld}/></Field>
            <Field label="Account number"><input value={bankForm.account_no || ''} onChange={e => setBankForm((p: any) => ({ ...p, account_no: e.target.value }))} className={fld}/></Field>
            <Field label="IFSC"><input value={bankForm.ifsc || ''} onChange={e => setBankForm((p: any) => ({ ...p, ifsc: e.target.value.toUpperCase() }))} className={fld}/></Field>
          </div>
          <div className="flex justify-end gap-2 mt-5">
            <button onClick={() => setBankModal(false)} className="px-4 py-2 rounded-lg border border-gray-200 text-sm">Cancel</button>
            <button onClick={saveBank} disabled={savingBank} className="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-sm font-semibold disabled:opacity-50">
              {savingBank ? 'Saving…' : 'Save bank'}
            </button>
          </div>
        </AdminModal>
      )}

      {/* ── Admin: KYC Approve/Reject Modal ───────────────────────── */}
      {kycModal && (
        <AdminModal
          title={kycModal.mode === 'approve' ? 'Approve KYC' : 'Reject KYC'}
          subtitle={`Acting on broker ${broker?.broker_id}`}
          onClose={() => { setKycModal(null); setKycReason('') }}
        >
          <div className={`rounded-lg p-3 text-sm flex items-start gap-2 ${kycModal.mode === 'approve' ? 'bg-emerald-50 text-emerald-900 border border-emerald-200' : 'bg-rose-50 text-rose-900 border border-rose-200'}`}>
            {kycModal.mode === 'approve' ? <CheckCircle2 size={16} className="mt-0.5"/> : <XCircle size={16} className="mt-0.5"/>}
            <div>{kycModal.mode === 'approve' ? 'The broker can request withdrawals once KYC is approved.' : 'Reject — the broker stays on hold for payouts.'}</div>
          </div>
          {kycModal.mode === 'reject' && (
            <div className="mt-3">
              <label className="text-xs text-gray-500 block mb-1">Reason (required)</label>
              <textarea value={kycReason} onChange={e => setKycReason(e.target.value)} rows={3} className={`${fld} resize-none`}/>
            </div>
          )}
          <div className="flex justify-end gap-2 mt-5">
            <button onClick={() => { setKycModal(null); setKycReason('') }} className="px-4 py-2 rounded-lg border border-gray-200 text-sm">Cancel</button>
            <button onClick={submitKyc} disabled={savingKyc} className={`px-4 py-2 rounded-lg text-white text-sm font-semibold disabled:opacity-50 ${kycModal.mode === 'approve' ? 'bg-emerald-600 hover:bg-emerald-700' : 'bg-rose-600 hover:bg-rose-700'}`}>
              {savingKyc ? 'Saving…' : kycModal.mode === 'approve' ? 'Approve KYC' : 'Reject KYC'}
            </button>
          </div>
        </AdminModal>
      )}
    </div>
  )
}

const fld = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400'

function Field({ label, children }: any) {
  return (
    <div>
      <label className="text-xs text-gray-500 block mb-1">{label}</label>
      {children}
    </div>
  )
}

function AdminModal({ title, subtitle, onClose, children }: any) {
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 px-4" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="bg-white rounded-2xl max-w-lg w-full p-5 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-2">
          <div>
            <h3 className="text-lg font-bold text-gray-900">{title}</h3>
            {subtitle && <p className="text-xs text-gray-500">{subtitle}</p>}
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-xl leading-none">✕</button>
        </div>
        {children}
      </div>
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

// Rich per-customer detail card.  Used in the Customers tab so the broker can drill from
// "5 customers" headline into the minute details: profile, every booking, every payment
// receipt (with print), the EMI schedule (with print on paid rows), and outreach buttons.
function CustomerCard({ group, expanded, onToggle, broker }: { group: any; expanded: boolean; onToggle: () => void; broker: any }) {
  const g = group
  const c = g.customer
  const cleanPhone = (c?.phone || '').replace(/[^0-9]/g, '')
  const collectionPct = g.totalCost > 0 ? Math.round((g.totalPaid / g.totalCost) * 100) : 0
  // Pre-build a generic WhatsApp template the broker can fire off — overridable per row in
  // the chase section, but the customer-level one says "hi, here's where you stand".
  const generalMsg = encodeURIComponent(
    `Hi ${c?.name || ''}, hope you're well.  Here's your latest account snapshot from Fanbe Group:\n` +
    `• Bookings: ${g.bookings.length}\n` +
    `• Total cost: ₹${Number(g.totalCost).toLocaleString('en-IN')}\n` +
    `• Paid so far: ₹${Number(g.totalPaid).toLocaleString('en-IN')} (${collectionPct}%)\n` +
    `• Outstanding: ₹${Number(g.outstanding).toLocaleString('en-IN')}\n` +
    (g.overdueCount > 0 ? `• ${g.overdueCount} EMI${g.overdueCount === 1 ? '' : 's'} overdue — please clear at your earliest.\n` : '') +
    `\nFor any questions feel free to reach out. — ${broker?.name || 'Your broker'}`
  )

  return (
    <div className="border border-gray-100 rounded-xl overflow-hidden">
      <button onClick={onToggle} className="w-full text-left px-3 py-3 flex items-center gap-3 hover:bg-gray-50">
        <div className="w-9 h-9 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 text-white flex items-center justify-center text-sm font-bold shrink-0">
          {(c?.name || '?').charAt(0).toUpperCase()}
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-mono text-[11px] text-gray-500">{c?.customer_code || '—'}</div>
          <div className="font-semibold text-sm text-gray-900 truncate">{c?.name || '—'}</div>
          <div className="text-[11px] text-gray-500 truncate">
            {c?.phone || '—'}{c?.father_or_husband_name ? ` · S/o ${c.father_or_husband_name}` : ''}
            {g.bookings.length > 1 ? ` · ${g.bookings.length} bookings` : ''}
          </div>
        </div>
        <div className="text-right shrink-0">
          <div className="text-xs text-gray-500">Cost / Paid</div>
          <div className="text-sm font-semibold text-gray-900">{formatINR(g.totalCost)} <span className="text-emerald-700">· {formatINR(g.totalPaid)}</span></div>
          <div className="text-[10px]">
            {g.overdueCount > 0 ? <span className="text-rose-700 font-semibold">{g.overdueCount} overdue</span>
             : g.nextDue ? <span className="text-amber-700">Next {formatDate(g.nextDue.due_date)}</span>
             : <span className="text-gray-400">{collectionPct}% collected</span>}
          </div>
        </div>
        <ChevronRight size={14} className={`ml-1 text-gray-400 transition-transform ${expanded ? 'rotate-90' : ''}`}/>
      </button>

      {expanded && (
        <div className="bg-gray-50/60 border-t border-gray-100">
          {/* Customer profile + outreach */}
          <div className="px-3 py-3 grid grid-cols-1 md:grid-cols-3 gap-2 text-[11px]">
            <DetailField label="Phone"   value={c?.phone || '—'}/>
            <DetailField label="Email"   value={c?.email || '—'}/>
            <DetailField label="PAN"     value={c?.pan || '—'}/>
            <DetailField label="DOB"     value={c?.dob ? formatDate(c.dob) : '—'}/>
            <DetailField label="Father / Husband" value={c?.father_or_husband_name || '—'}/>
            <DetailField label="Address" value={c?.address || '—'} wide/>
          </div>

          {cleanPhone && (
            <div className="px-3 pb-3 flex flex-wrap gap-2">
              <a href={`tel:${cleanPhone}`} className="inline-flex items-center gap-1 text-xs font-medium px-3 py-1.5 rounded-full bg-blue-600 hover:bg-blue-700 text-white">
                <Phone size={12}/>Call {c?.name?.split(' ')[0] || ''}
              </a>
              <a href={`https://wa.me/${cleanPhone}?text=${generalMsg}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-medium px-3 py-1.5 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white">
                <MessageCircle size={12}/>WhatsApp statement
              </a>
            </div>
          )}

          {/* Per booking — full payment ledger + EMI schedule */}
          <div className="px-3 pb-3 space-y-3">
            {g.bookings.map((b: any) => (
              <BookingDetail key={b.id} booking={b} customer={c} broker={broker}/>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function DetailField({ label, value, wide }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={`bg-white rounded-md border border-gray-100 px-2.5 py-1.5 ${wide ? 'md:col-span-3' : ''}`}>
      <div className="text-[9px] uppercase tracking-wide text-gray-400">{label}</div>
      <div className="text-xs text-gray-800 truncate" title={value}>{value}</div>
    </div>
  )
}

// One booking row inside the customer card — shows plot info, money breakdown, payments
// list (each printable), and the EMI schedule (each instalment printable if paid).
function BookingDetail({ booking, customer, broker }: { booking: any; customer: any; broker: any }) {
  const b = booking
  const paidPct = (Number(b.total_amount || b.plot_total_price) || 0) > 0
    ? Math.round((b.totalPaid / Number(b.total_amount || b.plot_total_price)) * 100)
    : 0
  // For the print helper we synthesize lightweight ctx objects (customer / booking / project
  // / plot) the way printPaymentReceipt expects.  Each payment row reuses this ctx with
  // its own payment record.
  const ctx = {
    customer,
    booking: { booking_no: b.booking_no, application_date: b.application_date, total_amount: b.total_amount, plot_total_price: b.plot_total_price, booking_amount: b.booking_amount, broker },
    project: b.bp_projects,
    plot: b.bp_plots,
  }
  const sortedEmi = [...(b.emi || [])].sort((a, b) => (a.seq || 0) - (b.seq || 0))
  const paidPayments = (b.payments || []).filter((p: any) => p.verification_status === 'verified')

  return (
    <div className="bg-white rounded-lg border border-gray-100 p-3 space-y-2.5">
      {/* Booking header */}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="font-mono text-sm text-blue-700 font-semibold">{b.booking_no}</div>
          <div className="text-xs text-gray-700">
            {b.bp_projects?.name || b.scheme_name || '—'}
            {b.bp_plots?.plot_no && ` · Plot ${b.bp_plots.plot_no}`}
            {b.bp_plots?.size_sqyd && ` · ${b.bp_plots.size_sqyd} sq.yd`}
            {b.bp_plots?.sector && ` · Sector ${b.bp_plots.sector}`}
          </div>
          {(b.bp_projects?.location || b.application_date) && (
            <div className="text-[10px] text-gray-500 mt-0.5 inline-flex items-center gap-2">
              {b.bp_projects?.location && <span className="inline-flex items-center gap-0.5"><MapPin size={9}/>{b.bp_projects.location}</span>}
              {b.application_date && <span className="inline-flex items-center gap-0.5"><Calendar size={9}/>Applied {formatDate(b.application_date)}</span>}
            </div>
          )}
        </div>
        <span className={`text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full ${
          b.stage === 'booking_done' ? 'bg-emerald-50 text-emerald-700'
          : b.stage === 'cancelled' ? 'bg-rose-50 text-rose-700'
          : 'bg-amber-50 text-amber-700'
        }`}>{(b.stage || '').replace(/_/g, ' ')}</span>
      </div>

      {/* Money breakdown */}
      <div className="grid grid-cols-4 gap-1.5 text-[10px]">
        <MoneyTile label="Plot cost"     value={formatINR(b.total_amount || b.plot_total_price || 0)}/>
        <MoneyTile label="Paid"          value={formatINR(b.totalPaid || 0)} tone="emerald"/>
        <MoneyTile label="Outstanding"   value={formatINR(b.outstanding || 0)} tone={b.outstanding > 0 ? 'amber' : 'gray'}/>
        <MoneyTile label="My commission" value={formatINR(b.commission_amount || 0)} tone="blue"/>
      </div>
      <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div className="h-full bg-gradient-to-r from-emerald-500 to-emerald-400" style={{ width: `${Math.min(100, paidPct)}%` }}/>
      </div>
      <div className="text-[10px] text-gray-500 text-right">{paidPct}% paid</div>

      {/* Payments ledger */}
      {paidPayments.length > 0 && (
        <div>
          <div className="text-[11px] font-semibold text-gray-700 mb-1.5 inline-flex items-center gap-1"><Receipt size={11}/>Payments ({paidPayments.length})</div>
          <div className="overflow-x-auto -mx-3">
            <table className="w-full text-[11px] min-w-[500px]">
              <thead>
                <tr className="text-left text-gray-500 border-b border-gray-100">
                  <th className="px-3 py-1.5 font-medium">Receipt</th>
                  <th className="py-1.5 font-medium">Type</th>
                  <th className="py-1.5 font-medium">Date</th>
                  <th className="py-1.5 font-medium">Mode</th>
                  <th className="py-1.5 font-medium">UTR / Ref</th>
                  <th className="py-1.5 font-medium text-right">Amount</th>
                  <th className="px-3 py-1.5 font-medium text-right">Receipt</th>
                </tr>
              </thead>
              <tbody>
                {paidPayments.map((p: any) => (
                  <tr key={p.id} className="border-b border-gray-50 last:border-0">
                    <td className="px-3 py-1.5 font-mono text-gray-700">{p.receipt_no || '—'}</td>
                    <td className="py-1.5 capitalize">{(p.payment_type || '').replace(/_/g, ' ')}{p.instalment_no ? ` #${p.instalment_no}` : ''}</td>
                    <td className="py-1.5 text-gray-600">{formatDate(p.payment_date)}</td>
                    <td className="py-1.5 uppercase text-gray-600">{p.payment_mode || '—'}</td>
                    <td className="py-1.5 font-mono text-[10px] text-gray-600 truncate max-w-[110px]" title={p.utr_ref || ''}>{p.utr_ref || '—'}</td>
                    <td className="py-1.5 text-right font-semibold text-emerald-700">{formatINR(p.amount)}</td>
                    <td className="px-3 py-1.5 text-right">
                      <button
                        onClick={() => printPaymentReceipt(p, ctx)}
                        className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-md bg-blue-50 text-blue-700 hover:bg-blue-100"
                        title="Print receipt"
                      >
                        <Printer size={9}/>Print
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* EMI schedule */}
      {sortedEmi.length > 0 && (
        <div>
          <div className="text-[11px] font-semibold text-gray-700 mb-1.5 inline-flex items-center gap-1"><CalendarDays size={11}/>EMI schedule ({sortedEmi.length})</div>
          <div className="overflow-x-auto -mx-3">
            <table className="w-full text-[11px] min-w-[480px]">
              <thead>
                <tr className="text-left text-gray-500 border-b border-gray-100">
                  <th className="px-3 py-1.5 font-medium">#</th>
                  <th className="py-1.5 font-medium">Due date</th>
                  <th className="py-1.5 font-medium text-right">Amount</th>
                  <th className="py-1.5 font-medium text-right">Paid</th>
                  <th className="py-1.5 font-medium">Status</th>
                  <th className="px-3 py-1.5 font-medium text-right">Receipt</th>
                </tr>
              </thead>
              <tbody>
                {sortedEmi.map((i: any) => {
                  const todayStr = new Date().toISOString().slice(0, 10)
                  const isOverdue = i.status !== 'paid' && (i.due_date || '') < todayStr
                  // Find the receipt for this instalment (payment with instalment_no === seq)
                  const receipt = (b.payments || []).find((p: any) => Number(p.instalment_no) === Number(i.seq) && p.verification_status === 'verified')
                  return (
                    <tr key={i.id} className="border-b border-gray-50 last:border-0">
                      <td className="px-3 py-1.5 font-mono text-gray-700">{i.seq}</td>
                      <td className="py-1.5 text-gray-600">{formatDate(i.due_date)}</td>
                      <td className="py-1.5 text-right text-gray-700">{formatINR(i.amount)}</td>
                      <td className="py-1.5 text-right text-emerald-700">{formatINR(i.paid_amount || 0)}</td>
                      <td className="py-1.5">
                        <span className={`text-[10px] uppercase tracking-wide font-medium px-1.5 py-0.5 rounded ${
                          i.status === 'paid' ? 'bg-emerald-50 text-emerald-700'
                          : isOverdue ? 'bg-rose-50 text-rose-700'
                          : i.status === 'partial' ? 'bg-amber-50 text-amber-700'
                          : 'bg-gray-100 text-gray-600'
                        }`}>
                          {isOverdue && i.status !== 'paid' ? 'overdue' : (i.status || 'pending')}
                        </span>
                      </td>
                      <td className="px-3 py-1.5 text-right">
                        {receipt ? (
                          <button
                            onClick={() => printPaymentReceipt(receipt, ctx)}
                            className="inline-flex items-center gap-1 text-[10px] px-2 py-0.5 rounded-md bg-blue-50 text-blue-700 hover:bg-blue-100"
                            title="Print EMI receipt"
                          >
                            <Printer size={9}/>Print
                          </button>
                        ) : (
                          <span className="text-[10px] text-gray-300">—</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

function MoneyTile({ label, value, tone = 'gray' }: { label: string; value: string; tone?: 'gray' | 'emerald' | 'amber' | 'blue' }) {
  const tones = {
    gray:    'text-gray-900',
    emerald: 'text-emerald-700',
    amber:   'text-amber-700',
    blue:    'text-blue-700',
  } as const
  return (
    <div className="bg-gray-50 rounded-md px-2 py-1.5">
      <div className="text-[9px] uppercase tracking-wide text-gray-400">{label}</div>
      <div className={`text-xs font-bold tabular-nums ${tones[tone]}`}>{value}</div>
    </div>
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

// Recursive org-chart node for the team tab.  The root broker is the dashboard owner;
// its direct downline is pre-loaded.  Deeper levels lazy-load via onToggle (which fetches
// brokers where sponsor_id = id and caches the result in subTeams).  Visual skeleton
// matches /team-tree: vertical descender → horizontal sibling bar → risers into each child.
function TeamOrgNode({ broker, isRoot, initialChildren, subTeams, expandedTeam, downlineEarnings, downlineCustomers, onToggle, onPromote, isPromoting }: any) {
  if (!broker) return null
  const customerList = (downlineCustomers?.[broker.id] || []) as { id: string; name: string; code: string }[]
  const subBrokersLoaded: any[] = isRoot ? (initialChildren || []) : (subTeams[broker.id] || [])
  const isExpanded = isRoot || expandedTeam.has(broker.id)
  const hasSubBrokers = Array.isArray(subBrokersLoaded) && subBrokersLoaded.length > 0
  const hasCustomers  = customerList.length > 0
  const showChildren  = isExpanded && (hasSubBrokers || hasCustomers)

  // Merge sub-brokers + customers into one ordered children list so Nidhi shows up as a
  // tree leaf under Nisha, alongside Anjana / Rohit, instead of buried in a popover.
  type Child = { kind: 'broker'; key: string; data: any } | { kind: 'customer'; key: string; data: { id: string; name: string; code: string } }
  const combined: Child[] = [
    ...subBrokersLoaded.map((b: any) => ({ kind: 'broker' as const, key: b.id, data: b })),
    ...customerList.map(c => ({ kind: 'customer' as const, key: `c-${c.id}`, data: c })),
  ]

  return (
    <div className="flex flex-col items-center">
      <TeamNodeCard broker={broker} isRoot={isRoot} isExpanded={isExpanded}
        earned={downlineEarnings[broker.id] || 0}
        customers={customerList}
        loaded={isRoot ? true : Array.isArray(subTeams[broker.id])}
        childCount={hasSubBrokers ? subBrokersLoaded.length : 0}
        onToggle={() => !isRoot && onToggle(broker.id)}
      />

      {showChildren && (
        <>
          <div className="w-px h-6 bg-gray-300" />
          <div className="flex items-start">
            {combined.map((c, i) => {
              const isFirst = i === 0
              const isLast  = i === combined.length - 1
              const isOnly  = combined.length === 1
              return (
                <div key={c.key} className="relative flex flex-col items-center px-3 pt-6">
                  {!isOnly && !isFirst && <div className="absolute top-0 left-0 right-1/2 h-px bg-gray-300" />}
                  {!isOnly && !isLast  && <div className="absolute top-0 left-1/2 right-0 h-px bg-gray-300" />}
                  <div className="absolute top-0 left-1/2 -translate-x-1/2 w-px h-6 bg-gray-300" />
                  {c.kind === 'broker' ? (
                    <TeamOrgNode broker={c.data} initialChildren={null} subTeams={subTeams}
                      expandedTeam={expandedTeam} downlineEarnings={downlineEarnings} downlineCustomers={downlineCustomers} onToggle={onToggle}
                      onPromote={onPromote} isPromoting={isPromoting}/>
                  ) : (
                    <CustomerLeaf customer={c.data} sponsorBrokerId={broker.id} onPromote={onPromote} isPromoting={isPromoting}/>
                  )}
                </div>
              )
            })}
          </div>
        </>
      )}

      {/* Show "no sub-team" hint when expanded but the lazy fetch returned zero.  Was
          referencing the old `childrenLoaded` name and silently never rendering, which is
          why admin tapping a leaf broker saw no feedback and reported "blank page". */}
      {!isRoot && isExpanded && Array.isArray(subBrokersLoaded) && subBrokersLoaded.length === 0 && customerList.length === 0 && (
        <div className="mt-3 text-[10px] text-gray-400 italic">no sub-team</div>
      )}
    </div>
  )
}

// Terminal leaf node for a customer.  Identical footprint to TeamNodeCard so the org chart
// stays aligned, but visually distinct (amber + dashed + "CUSTOMER" badge) so customers
// can't be confused with brokers.  Card body links to the customer's history; the
// "Make broker" action sits at the bottom and promotes the customer under the same sponsor.
function CustomerLeaf({ customer, sponsorBrokerId, onPromote, isPromoting }: {
  customer: { id: string; name: string; code: string }
  sponsorBrokerId?: string
  onPromote?: (customerId: string, sponsorId: string) => void
  isPromoting?: boolean
}) {
  const [confirming, setConfirming] = useState(false)
  return (
    <div className="w-[150px] sm:w-[170px] rounded-2xl border-2 border-dashed border-amber-200 bg-amber-50/40 px-3 py-3 shadow-sm hover:border-amber-300 hover:bg-amber-50 transition flex flex-col items-center">
      <Link
        to={`/customer-pipeline?customer=${customer.id}`}
        onClick={e => e.stopPropagation()}
        className="flex flex-col items-center w-full"
      >
        <div className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-semibold mb-1.5 bg-gradient-to-br from-amber-400 to-orange-500 text-white">
          {(customer.name || '?').charAt(0).toUpperCase()}
        </div>
        <div className="text-[13px] font-semibold text-gray-900 truncate max-w-full text-center">{customer.name || '—'}</div>
        <div className="text-[10px] font-mono text-gray-400 mt-0.5">[{customer.code || '—'}]</div>
        <span className="mt-1 text-[10px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-medium">CUSTOMER</span>
      </Link>

      {onPromote && sponsorBrokerId && (
        <div className="mt-2 pt-2 w-full border-t border-amber-100">
          {confirming ? (
            <div className="flex gap-1">
              <button
                onClick={e => { e.stopPropagation(); onPromote(customer.id, sponsorBrokerId); setConfirming(false) }}
                disabled={isPromoting}
                className="flex-1 text-[10px] py-1 rounded-full bg-emerald-600 text-white font-medium hover:bg-emerald-700 disabled:opacity-50 inline-flex items-center justify-center gap-0.5"
              >
                {isPromoting ? <Loader2 size={10} className="animate-spin"/> : 'Yes'}
              </button>
              <button
                onClick={e => { e.stopPropagation(); setConfirming(false) }}
                className="flex-1 text-[10px] py-1 rounded-full bg-gray-100 text-gray-600 font-medium hover:bg-gray-200"
              >
                No
              </button>
            </div>
          ) : (
            <button
              onClick={e => { e.stopPropagation(); setConfirming(true) }}
              className="w-full text-[10px] py-1 rounded-full bg-white border border-amber-300 text-amber-800 font-medium hover:bg-amber-100 inline-flex items-center justify-center gap-1"
              title="Promote this customer to a broker under the same sponsor"
            >
              <UserPlus size={10}/>Make broker
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function TeamNodeCard({ broker, isRoot, isExpanded, earned, customers = [], loaded, childCount, onToggle }: any) {
  const clickable = !isRoot
  const customerCount = customers.length
  return (
    <div
      onClick={clickable ? onToggle : undefined}
      className={`relative w-[150px] sm:w-[170px] rounded-2xl border bg-white px-3 py-3 shadow-sm transition
        border-gray-200 hover:border-gray-300
        ${clickable ? 'cursor-pointer active:scale-[0.98]' : ''}`}
    >
      <div className="flex flex-col items-center">
        <div className={`shrink-0 w-10 h-10 rounded-full flex items-center justify-center text-sm font-semibold mb-1.5
          ${isRoot ? 'bg-gray-900 text-white'
          : broker.status === 'active' ? 'bg-gradient-to-br from-blue-500 to-indigo-600 text-white'
          : 'bg-gray-100 text-gray-400'}`}>
          {(broker.name || '?').charAt(0).toUpperCase()}
        </div>
        {/* Name is plain text — the entire card is the click target for expand/collapse, and a
            card click must never navigate to another broker's portal (privacy boundary). */}
        <div className="text-[13px] font-semibold text-gray-900 truncate max-w-full text-center">
          {broker.name || '—'}
        </div>
        <div className="text-[10px] font-mono text-gray-400 mt-0.5">[{broker.broker_id}]</div>
        {broker.rank && (
          <span className="mt-1 text-[10px] px-2 py-0.5 rounded-full bg-slate-100 text-slate-700 font-medium truncate max-w-full">{broker.rank}</span>
        )}
      </div>

      {(isRoot || customerCount > 0) && (
        <div className="mt-2 flex items-center justify-center gap-1 flex-wrap">
          {isRoot && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-900 text-white">You</span>}
          {customerCount > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-100 font-medium inline-flex items-center gap-0.5">
              <Users size={9}/>{customerCount}
            </span>
          )}
        </div>
      )}

      <div className="mt-2 pt-2 border-t border-gray-100 text-[11px] text-gray-500 space-y-1">
        {/* Phone / WA links removed from the compact team card on purpose: their tap
            targets sit on top of the card body and admin reported "tap to load opens a
            blank page" when their finger landed on the tel: link instead of the card.
            Contact details still available on the broker dashboard. */}
        {!isRoot && earned > 0 && (
          <div className="text-center font-semibold text-emerald-700 tabular-nums">{formatINR(earned)}<span className="text-[9px] text-gray-400 font-normal ml-1">earned</span></div>
        )}
        {clickable && (
          <div className="flex items-center justify-center gap-1 text-gray-400">
            {!loaded
              ? <><ChevronRight size={11}/><span className="text-[10px]">tap to load</span></>
              : childCount === 0
                ? <span className="text-[10px] italic">no sub-team</span>
                : <>
                    <ChevronRight size={11} className={`transition-transform ${isExpanded ? 'rotate-90' : ''}`}/>
                    <span className="text-[10px]">{childCount} direct</span>
                  </>}
          </div>
        )}
      </div>
    </div>
  )
}

// ── KYC document upload modal (broker side) ──────────────────────────────────
// The matching admin view lives at /kyc — admin sees the same `bp_broker_kyc` rows this
// modal writes, and can Verify / Reject each one.  Required-doc list mirrors the DOC_LABEL
// map in src/pages/KYC.tsx so doc_type strings line up with what admin expects to see.
const REQUIRED_DOCS: { type: string; label: string; hint: string }[] = [
  { type: 'aadhaar', label: 'Aadhaar',          hint: 'Clear photo of front + back, or PDF' },
  { type: 'pan',     label: 'PAN card',         hint: 'Photo or PDF of your PAN card' },
  { type: 'photo',   label: 'Passport photo',   hint: 'Recent passport-size photo, JPG/PNG' },
  { type: 'bank_passbook', label: 'Bank passbook / Cancelled cheque', hint: 'For payouts — name, account no., IFSC visible' },
  { type: 'address_proof', label: 'Address proof', hint: 'Utility bill, rent agreement, or passport' },
]

function KycDocsModal({ docs, status, uploading, onClose, onUpload }: {
  docs: any[]
  status: string
  uploading: string | null
  onClose: () => void
  onUpload: (docType: string, docLabel: string, file: File) => void | Promise<void>
}) {
  // Latest-per-type so re-uploads show the new copy, but keep the array unique by doc_type.
  const latestByType = new Map<string, any>()
  for (const d of docs) {
    if (!latestByType.has(d.doc_type)) latestByType.set(d.doc_type, d)
  }
  const verifiedCount = docs.filter(d => d.verified).length
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 px-4 py-6 overflow-y-auto" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="bg-white rounded-2xl max-w-2xl w-full p-5 my-auto">
        <div className="flex items-center justify-between mb-2">
          <div>
            <h3 className="text-lg font-bold text-gray-900 inline-flex items-center gap-2"><ShieldCheck size={18} className="text-amber-600"/>KYC documents</h3>
            <p className="text-xs text-gray-500 mt-0.5">Upload your identity, photo, and bank proof. Admin will verify each one.</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-700 text-lg">✕</button>
        </div>

        <div className={`rounded-lg p-3 text-xs flex items-center gap-2 mb-4 ${
          status === 'approved' ? 'bg-emerald-50 text-emerald-900 border border-emerald-200'
          : status === 'rejected' ? 'bg-rose-50 text-rose-900 border border-rose-200'
          : 'bg-amber-50 text-amber-900 border border-amber-200'
        }`}>
          {status === 'approved' ? <CheckCircle2 size={14}/> : status === 'rejected' ? <XCircle size={14}/> : <Clock size={14}/>}
          <span>
            Status: <b className="capitalize">{status}</b> · {docs.length} document{docs.length === 1 ? '' : 's'} on file
            {docs.length > 0 && ` · ${verifiedCount} verified by admin`}.
          </span>
        </div>

        <div className="space-y-2.5">
          {REQUIRED_DOCS.map(d => {
            const existing = latestByType.get(d.type)
            const isUploading = uploading === d.type
            return (
              <div key={d.type} className={`rounded-xl border p-3 flex items-start gap-3 ${
                existing?.verified ? 'border-emerald-200 bg-emerald-50/40'
                : existing ? 'border-amber-200 bg-amber-50/40'
                : 'border-gray-200 bg-white'
              }`}>
                <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${
                  existing?.verified ? 'bg-emerald-100 text-emerald-700'
                  : existing ? 'bg-amber-100 text-amber-700'
                  : 'bg-gray-100 text-gray-500'
                }`}>
                  {existing?.verified ? <FileCheck2 size={16}/> : <FileText size={16}/>}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-gray-900">{d.label}</div>
                  <div className="text-[11px] text-gray-500">{d.hint}</div>
                  {existing && (
                    <div className="mt-1 text-[11px] text-gray-600 inline-flex items-center gap-1.5">
                      {existing.verified ? (
                        <span className="inline-flex items-center gap-0.5 text-emerald-700"><CheckCircle2 size={11}/>Verified by admin</span>
                      ) : (
                        <span className="inline-flex items-center gap-0.5 text-amber-700"><Clock size={11}/>Awaiting verification</span>
                      )}
                      {existing.file_url && <a href={existing.file_url} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline truncate max-w-[180px]">{existing.file_name || 'View'}</a>}
                      {existing.notes && <span className="text-rose-700">· {existing.notes}</span>}
                    </div>
                  )}
                </div>
                <label className={`shrink-0 text-xs font-medium px-3 py-1.5 rounded-lg cursor-pointer inline-flex items-center gap-1 ${
                  isUploading ? 'bg-gray-100 text-gray-400 cursor-wait'
                  : existing ? 'bg-white border border-gray-300 text-gray-700 hover:bg-gray-50'
                  : 'bg-emerald-600 text-white hover:bg-emerald-700'
                }`}>
                  {isUploading ? <Loader2 size={12} className="animate-spin"/> : <Upload size={12}/>}
                  {isUploading ? 'Uploading…' : existing ? 'Replace' : 'Upload'}
                  <input
                    type="file"
                    accept="image/*,application/pdf"
                    className="hidden"
                    disabled={!!uploading}
                    onChange={e => {
                      const f = e.target.files?.[0]
                      if (f) onUpload(d.type, d.label, f)
                      e.target.value = ''
                    }}
                  />
                </label>
              </div>
            )
          })}
        </div>

        <div className="mt-5 pt-4 border-t border-gray-100 flex items-center justify-between text-[11px] text-gray-500">
          <span>Files go directly to admin. Aadhaar / PAN images are stored privately.</span>
          <button onClick={onClose} className="text-blue-600 hover:underline font-medium">Done</button>
        </div>
      </div>
    </div>
  )
}

