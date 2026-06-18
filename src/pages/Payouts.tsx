import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/Button.tsx'
import { Input, Select, Textarea } from '@/components/ui/Input.tsx'
import { Modal } from '@/components/ui/Modal.tsx'
import { Badge } from '@/components/ui/Badge.tsx'
import { formatINR, formatDate, PAYOUT_STATUS_COLORS } from '@/lib/utils'
import { ArrowUpRight, ArrowDownRight, ChevronRight, Search, ExternalLink, AlertCircle, Download } from 'lucide-react'
import { findUtrConflict, utrConflictMessage } from '@/lib/utr'
import toast from 'react-hot-toast'

/**
 * Admin Broker Payouts dashboard.
 * One page, two complementary views over the same broker money-out data:
 *   - Per Broker: rollup (earned / approved / paid / owed) with expandable transactions + earnings ledger
 *   - Activity Log: flat chronological feed with running per-broker balance + CSV export (the old /commission page)
 * Data sources:
 *   - payout_distributions: per-payment MLM commission as customer pays (credits)
 *   - bp_payout_transactions: cycle-generated broker payout requests (manageable)
 *   - withdrawal_requests: broker self-initiated payouts (debits when paid)
 */

const LEDGER_KIND_META: Record<string, { label: string; color: string }> = {
  commission_earned: { label: 'Commission earned', color: 'bg-emerald-50 text-emerald-700 border border-emerald-200' },
  payout_paid:       { label: 'Payout paid',       color: 'bg-indigo-50 text-indigo-700 border border-indigo-200' },
  withdrawal_paid:   { label: 'Withdrawal paid',   color: 'bg-blue-50 text-blue-700 border border-blue-200' },
}
type LedgerEntry = {
  id: string
  at: string
  broker_id: string
  kind: 'commission_earned' | 'payout_paid' | 'withdrawal_paid'
  direction: 'credit' | 'debit'
  amount: number
  ref: string
  detail?: string
  booking_no?: string
  // For commission_earned only: lets us render the math ("5% of ₹1,100 = ₹46.75 net")
  income_type?: string
  level?: number
  base_amount?: number
  rate_pct?: number
  gross_payout?: number
}
export default function Payouts() {
  const qc = useQueryClient()
  // Sidebar can deep-link to ?view=activity to land on the commission ledger
  // directly (the "show me the magic" view).  URL is the source of truth so
  // tabs / browser back jumps keep things sane.
  const [searchParams, setSearchParams] = useSearchParams()
  const urlView = (searchParams.get('view') === 'activity' ? 'activity' : 'per_broker') as 'per_broker' | 'activity'
  const [view, setViewState] = useState<'per_broker' | 'activity'>(urlView)
  const setView = (v: 'per_broker' | 'activity') => {
    setViewState(v)
    const next = new URLSearchParams(searchParams)
    if (v === 'activity') next.set('view', 'activity'); else next.delete('view')
    setSearchParams(next, { replace: true })
  }
  const [statusF, setStatusF] = useState('')
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  // Default sort = most owed first.  Action-only ON by default so admin lands on
  // their actual queue, not the full broker list.
  const [sortBy, setSortBy] = useState<'earned' | 'owed' | 'paid' | 'pending'>('owed')
  const [actionOnly, setActionOnly] = useState(true)
  const [ledgerKind, setLedgerKind] = useState('')
  const [ledgerFrom, setLedgerFrom] = useState('')
  const [ledgerTo, setLedgerTo] = useState('')

  // ── Queries ──────────────────────────────────────────────────────
  const { data: distributions = [], isLoading: distLoading } = useQuery({
    queryKey: ['payout_distributions_all'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('payout_distributions')
        .select('id, beneficiary_broker_id, booking_id, level, income_type, base_amount, rate_pct, differential_pct, upline_rank_pct, gross_payout, tds_amount, admin_charge, net_payout, created_at, status, bp_bookings(booking_no)')
        .order('created_at', { ascending: false })
        .limit(2000)
      if (error) throw error
      return data || []
    },
  })

  const { data: txns = [], isLoading: txnLoading } = useQuery({
    queryKey: ['bp_payout_transactions_all', statusF],
    queryFn: async () => {
      let q = supabase.from('bp_payout_transactions')
        .select('*, brokers(name, broker_id, pan_no, tds_applicable), bp_bookings(booking_no)')
        .order('created_at', { ascending: false })
      if (statusF) q = q.eq('status', statusF)
      const { data, error } = await q
      if (error) throw error
      return data || []
    },
  })

  const { data: brokers = [] } = useQuery({
    queryKey: ['brokers_lite_payouts'],
    queryFn: async () => {
      const { data } = await supabase.from('brokers').select('id, name, broker_id, rank, kyc_status, pan_no, tds_applicable').order('name')
      return data || []
    },
  })

  // All withdrawal_requests, every status.  Needed by both views: the activity ledger
  // (paid debits) and the per-broker rollup ("owed" balance considers paid + pending).
  const { data: allWithdrawals = [] } = useQuery({
    queryKey: ['withdrawals_for_payouts'],
    queryFn: async () => {
      const { data } = await supabase
        .from('withdrawal_requests')
        .select('id, broker_id, net_amount, amount, paid_at, created_at, status, utr')
      return data || []
    },
  })
  const paidWithdrawals = useMemo(() => (allWithdrawals as any[]).filter(w => w.status === 'paid'), [allWithdrawals])

  const update = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: any }) => {
      const { error } = await supabase.from('bp_payout_transactions').update({ ...data, updated_at: new Date().toISOString() }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['bp_payout_transactions_all'] })
      qc.invalidateQueries({ queryKey: ['payout_distributions_all'] })
      qc.invalidateQueries({ queryKey: ['payouts'] })
      toast.success('Payout updated')
    },
    onError: (e: any) => toast.error(e.message),
  })

  // ── Aggregate per broker ────────────────────────────────────────
  const aggregated = useMemo(() => {
    const map = new Map<string, any>()
    const brokerLookup: Record<string, any> = {}
    for (const b of (brokers as any[])) brokerLookup[b.id] = b

    // Distributions = earnings
    for (const d of (distributions as any[])) {
      const k = d.beneficiary_broker_id
      if (!k) continue
      if (!map.has(k)) {
        const b = brokerLookup[k]
        map.set(k, { broker_id: k, broker: b, earned: 0, paid: 0, pending_payout: 0, approved_payout: 0, txns: [] as any[], distributions: [] as any[] })
      }
      const row = map.get(k)
      row.earned += Number(d.net_payout || 0)
      row.distributions.push(d)
    }

    // Transactions = cycle-batch payouts
    for (const t of (txns as any[])) {
      const k = t.broker_id
      if (!k) continue
      if (!map.has(k)) {
        const b = brokerLookup[k]
        map.set(k, { broker_id: k, broker: b || t.brokers, earned: 0, paid: 0, pending_payout: 0, approved_payout: 0, txns: [] as any[], distributions: [] as any[], withdrawals: [] as any[] })
      }
      const row = map.get(k)
      row.txns.push(t)
      const net = Number(t.net_amount || t.amount || 0)
      if (t.status === 'paid')     row.paid += net
      else if (t.status === 'approved') row.approved_payout += net
      else if (t.status === 'pending')  row.pending_payout += net
    }

    // Withdrawal_requests = broker self-initiated payouts.  Treated as the same kind of
    // debit as a cycle-batch txn so the "owed" balance can't be double-spent.
    for (const w of (allWithdrawals as any[])) {
      const k = w.broker_id
      if (!k) continue
      if (!map.has(k)) {
        const b = brokerLookup[k]
        map.set(k, { broker_id: k, broker: b, earned: 0, paid: 0, pending_payout: 0, approved_payout: 0, txns: [] as any[], distributions: [] as any[], withdrawals: [] as any[] })
      }
      const row = map.get(k)
      row.withdrawals = row.withdrawals || []
      row.withdrawals.push(w)
      const net = Number(w.net_amount || w.amount || 0)
      if (w.status === 'paid' || w.status === 'closed') row.paid += net
      else if (w.status === 'approved')                row.approved_payout += net
      else if (w.status === 'pending')                 row.pending_payout += net
    }

    return Array.from(map.values())
      .map(r => ({ ...r, balance: Math.max(0, r.earned - r.paid - r.approved_payout - r.pending_payout) }))
      .sort((a, b) => (b.earned + b.paid) - (a.earned + a.paid))
  }, [distributions, txns, allWithdrawals, brokers])

  // ── KPIs ────────────────────────────────────────────────────────
  const kpis = useMemo(() => {
    const totalEarned = aggregated.reduce((s, r) => s + r.earned, 0)
    const totalPaid   = aggregated.reduce((s, r) => s + r.paid, 0)
    const totalPending = aggregated.reduce((s, r) => s + r.pending_payout, 0)
    const totalApproved = aggregated.reduce((s, r) => s + r.approved_payout, 0)
    return { totalEarned, totalPaid, totalPending, totalApproved, brokerCount: aggregated.length }
  }, [aggregated])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    let rows = aggregated
    if (q) {
      rows = rows.filter(r =>
        (r.broker?.name || '').toLowerCase().includes(q) ||
        (r.broker?.broker_id || '').toLowerCase().includes(q)
      )
    }
    // "Action needed" = broker has pending or approved txn waiting on admin,
    // or is over-allocated (commitments > earnings).  Hides everything settled
    // so admin sees only their actual queue.
    if (actionOnly) {
      rows = rows.filter(r => {
        const committed = r.paid + r.approved_payout + r.pending_payout
        const overAllocated = committed > r.earned + 0.01
        return r.pending_payout > 0 || r.approved_payout > 0 || overAllocated
      })
    }
    // Sort by admin's chosen axis.  Default is "owed" so the brokers admin most
    // needs to act on float to the top.
    const sorted = [...rows]
    sorted.sort((a: any, b: any) => {
      switch (sortBy) {
        case 'owed':    return b.balance - a.balance
        case 'earned':  return b.earned  - a.earned
        case 'paid':    return b.paid    - a.paid
        case 'pending': return (b.pending_payout + b.approved_payout) - (a.pending_payout + a.approved_payout)
        default:        return 0
      }
    })
    return sorted
  }, [aggregated, search, sortBy, actionOnly])

  // ── Manage transaction modal ────────────────────────────────────
  const [selected, setSelected] = useState<any>(null)
  const [modal, setModal] = useState(false)
  const [form, setForm] = useState<any>({ status:'', payment_mode:'', utr_ref:'', paid_date:'', rejection_reason:'', notes:'', tds_amount:'', net_amount:'' })
  const openTxn = (r: any) => {
    setSelected(r)
    setForm({
      status: r.status, payment_mode: r.payment_mode || '', utr_ref: r.utr_ref || '',
      paid_date: r.paid_date || '', rejection_reason: r.rejection_reason || '', notes: r.notes || '',
      tds_amount: r.tds_amount || '', net_amount: r.net_amount || ''
    })
    setModal(true)
  }
  const save = async () => {
    // UTR uniqueness — if the admin set a UTR (or changed it), make sure it's not already in
    // use elsewhere.  Excluding this row so editing a saved record doesn't false-positive
    // on its own current UTR.
    const trimmedUtr = (form.utr_ref || '').trim()
    if (trimmedUtr) {
      const conflict = await findUtrConflict(trimmedUtr, { payoutTxn: selected.id })
      if (conflict) { toast.error(utrConflictMessage(conflict)); return }
    }
    await update.mutateAsync({
      id: selected.id,
      data: { ...form, utr_ref: trimmedUtr || null, tds_amount: form.tds_amount ? Number(form.tds_amount) : null, net_amount: form.net_amount ? Number(form.net_amount) : null }
    })
    setModal(false)
  }
  const set = (k: string, v: any) => setForm((p: any) => ({ ...p, [k]: v }))

  const toggleExpand = (id: string) => setExpanded(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })

  // ── Activity-log view (the old /commission page, now folded into here) ──────────
  const brokerLookup = useMemo(() => {
    const m: Record<string, { name: string; code: string }> = {}
    for (const b of (brokers as any[])) m[b.id] = { name: b.name, code: b.broker_id }
    return m
  }, [brokers])

  const ledgerEntries = useMemo<LedgerEntry[]>(() => {
    const list: LedgerEntry[] = []
    for (const d of (distributions as any[])) {
      const amt = Number(d.net_payout || 0)
      if (!d.beneficiary_broker_id || amt <= 0) continue
      const bookingNo = d.bp_bookings?.booking_no || '—'
      list.push({
        id: `pd-${d.id}`,
        at: d.created_at || new Date().toISOString(),
        broker_id: d.beneficiary_broker_id,
        kind: 'commission_earned',
        direction: 'credit',
        amount: amt,
        ref: bookingNo,
        booking_no: bookingNo,
        detail: `${d.income_type || 'direct'} · ${d.level === 0 ? 'self' : `L${d.level} upline`}`,
        income_type:  d.income_type || 'direct',
        level:        Number(d.level || 0),
        base_amount:  Number(d.base_amount || 0),
        rate_pct:     Number(d.rate_pct || d.differential_pct || 0),
        gross_payout: Number(d.gross_payout || 0),
      })
    }
    for (const t of (txns as any[])) {
      if (t.status !== 'paid') continue
      const amt = Number(t.net_amount || t.amount || 0)
      if (!t.broker_id || amt <= 0) continue
      list.push({
        id: `po-${t.id}`,
        at: t.paid_date || t.updated_at || t.created_at || new Date().toISOString(),
        broker_id: t.broker_id,
        kind: 'payout_paid',
        direction: 'debit',
        amount: amt,
        ref: t.utr_ref || `cycle payout`,
        detail: t.payout_type || 'cycle',
      })
    }
    for (const w of (paidWithdrawals as any[])) {
      const amt = Number(w.net_amount || w.amount || 0)
      if (!w.broker_id || amt <= 0) continue
      list.push({
        id: `wd-${w.id}`,
        at: w.paid_at || new Date().toISOString(),
        broker_id: w.broker_id,
        kind: 'withdrawal_paid',
        direction: 'debit',
        amount: amt,
        ref: w.utr ? `UTR ${w.utr}` : 'withdrawal',
        detail: 'self-initiated',
      })
    }
    list.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())
    return list
  }, [distributions, txns, paidWithdrawals])

  const ledgerFiltered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return ledgerEntries.filter(e => {
      if (ledgerKind && e.kind !== ledgerKind) return false
      if (ledgerFrom && e.at.slice(0, 10) < ledgerFrom) return false
      if (ledgerTo   && e.at.slice(0, 10) > ledgerTo)   return false
      if (q) {
        const meta = brokerLookup[e.broker_id]
        const hay = `${meta?.name || ''} ${meta?.code || ''} ${e.ref || ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [ledgerEntries, ledgerKind, ledgerFrom, ledgerTo, search, brokerLookup])

  const ledgerRowsWithBalance = useMemo(() => {
    const perBroker: Record<string, number> = {}
    const balanceById: Record<string, number> = {}
    for (const e of ledgerEntries) {
      perBroker[e.broker_id] = (perBroker[e.broker_id] || 0) + (e.direction === 'credit' ? e.amount : -e.amount)
      balanceById[e.id] = perBroker[e.broker_id]
    }
    return ledgerFiltered
      .map(e => ({
        ...e,
        broker_name: brokerLookup[e.broker_id]?.name || '—',
        broker_code: brokerLookup[e.broker_id]?.code || '—',
        balance: balanceById[e.id],
      }))
      .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
  }, [ledgerEntries, ledgerFiltered, brokerLookup])

  const ledgerTotals = useMemo(() => {
    let credit = 0, debit = 0
    for (const e of ledgerFiltered) (e.direction === 'credit' ? credit += e.amount : debit += e.amount)
    return { credit, debit, balance: credit - debit, brokers: new Set(ledgerFiltered.map(e => e.broker_id)).size }
  }, [ledgerFiltered])

  const exportLedgerCSV = () => {
    if (ledgerRowsWithBalance.length === 0) return
    const headers = ['Date','Broker','Code','Type','Direction','Amount','Running Balance','Reference','Detail']
    const lines = ledgerRowsWithBalance.map(r => [
      r.at.slice(0,10), r.broker_name, r.broker_code, LEDGER_KIND_META[r.kind]?.label || r.kind,
      r.direction, r.amount, r.balance, r.ref, r.detail || '',
    ])
    const csv = [headers, ...lines].map(r => r.map(c => {
      const s = String(c ?? '')
      return /[",\n]/.test(s) ? `"${s.replace(/"/g,'""')}"` : s
    }).join(',')).join('\r\n')
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `broker-ledger-${new Date().toISOString().slice(0,10)}.csv`; a.click()
    URL.revokeObjectURL(url)
  }

  const clearLedgerFilters = () => { setSearch(''); setLedgerKind(''); setLedgerFrom(''); setLedgerTo('') }
  const ledgerFiltersActive = !!(search || ledgerKind || ledgerFrom || ledgerTo)

  // Live counts of admin's two recurring actions so the CTAs read as "you have N to do"
  // rather than "click here to maybe find work".
  const pendingWdCount = (allWithdrawals as any[]).filter(w => w.status === 'pending' || w.status === 'approved').length
  const unbatchedEarnings = aggregated.reduce((s: number, r: any) => s + (r.earned - r.paid - r.approved_payout - r.pending_payout), 0)

  const owedTotal = aggregated.reduce((s, r) => s + r.balance, 0)
  const owedBrokerCount = aggregated.filter(r => r.balance > 0).length
  const allCaughtUp = owedTotal === 0 && unbatchedEarnings === 0 && pendingWdCount === 0

  return (
    <div className="p-3 md:p-6 space-y-6 max-w-4xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 tracking-tight">Pay brokers</h1>
        <p className="text-sm text-gray-500 mt-1">
          {kpis.brokerCount} earning · {formatINR(kpis.totalEarned)} earned · {formatINR(kpis.totalPaid)} paid
        </p>
      </div>

      {/* The hero.  One number, one action.  Everything else is detail behind
          progressive disclosure.  This is the answer to "what do I need to do?" */}
      <div className="rounded-3xl bg-white border border-gray-200 shadow-[0_1px_3px_rgba(0,0,0,0.04)] px-6 sm:px-10 py-10 text-center">
        {allCaughtUp ? (
          <>
            <div className="text-5xl mb-3">✓</div>
            <div className="text-lg font-semibold text-gray-900">All caught up</div>
            <div className="text-sm text-gray-500 mt-1">Nothing owed, nothing pending.</div>
          </>
        ) : (
          <>
            <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-[0.18em] mb-3">Owed to brokers</div>
            <div className="text-5xl sm:text-6xl font-bold text-gray-900 tabular-nums tracking-tight">{formatINR(owedTotal)}</div>
            <div className="text-sm text-gray-500 mt-3">
              {owedBrokerCount > 0 ? `across ${owedBrokerCount} broker${owedBrokerCount === 1 ? '' : 's'}` : 'queued for payout'}
            </div>

            {/* Primary action — only one, the one admin needs most. */}
            {unbatchedEarnings > 0 && (
              <Link to="/payout-cycles"
                className="mt-7 inline-flex items-center gap-2 px-6 py-3 rounded-full bg-gray-900 text-white text-sm font-semibold hover:bg-black active:scale-[0.98] shadow-sm transition">
                Settle {formatINR(unbatchedEarnings)} in pending earnings
              </Link>
            )}

            {/* Secondary — quieter link, not a button.  Only appears if there's a queue. */}
            {pendingWdCount > 0 && (
              <div className="mt-4 text-sm">
                <Link to="/withdrawals" className="text-blue-600 hover:underline">
                  {pendingWdCount} withdrawal request{pendingWdCount === 1 ? '' : 's'} waiting →
                </Link>
              </div>
            )}
          </>
        )}
      </div>

      {/* Filters — shared search + per-view extras */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400"/>
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder={view === 'per_broker' ? 'Search broker…' : 'Search broker, code, ref…'}
            className="w-full pl-9 pr-3 py-2 text-sm bg-white border border-gray-200 rounded-full focus:outline-none focus:border-gray-400"/>
        </div>
        {view === 'per_broker' && (
          <>
            <select value={sortBy} onChange={e => setSortBy(e.target.value as any)} className="bg-white border border-gray-200 rounded-full px-3 py-2 text-sm focus:outline-none focus:border-gray-400">
              <option value="owed">Most owed</option>
              <option value="pending">In flight</option>
              <option value="earned">Earned</option>
              <option value="paid">Paid</option>
            </select>
            <button
              onClick={() => setActionOnly(a => !a)}
              className={`text-xs px-3 py-2 rounded-full border transition ${
                actionOnly ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
              }`}
              title="Show only brokers with pending or approved payouts admin needs to act on"
            >
              {actionOnly ? 'Showing: action needed' : 'Show: all brokers'}
            </button>
          </>
        )}
        {view === 'activity' && (
          <>
            <select value={ledgerKind} onChange={e => setLedgerKind(e.target.value)} className="border border-gray-200 rounded-lg px-2 py-2 text-sm focus:outline-none">
              <option value="">All Types</option>
              <option value="commission_earned">Commission earned</option>
              <option value="payout_paid">Payout paid</option>
              <option value="withdrawal_paid">Withdrawal paid</option>
            </select>
            <input type="date" value={ledgerFrom} onChange={e => setLedgerFrom(e.target.value)} className="border border-gray-200 rounded-lg px-2 py-2 text-sm focus:outline-none"/>
            <input type="date" value={ledgerTo}   onChange={e => setLedgerTo(e.target.value)}   className="border border-gray-200 rounded-lg px-2 py-2 text-sm focus:outline-none"/>
            {ledgerFiltersActive && (
              <button onClick={clearLedgerFilters} className="text-xs text-gray-500 hover:text-gray-800 underline">Clear filters</button>
            )}
          </>
        )}
        <div className="text-xs text-gray-500 ml-auto">
          {view === 'per_broker' ? `${filtered.length} brokers` : `${ledgerRowsWithBalance.length} entries · net ${formatINR(ledgerTotals.balance)}`}
        </div>
      </div>

      {/* Activity Log view — flat chronological ledger */}
      {view === 'activity' && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          {(distLoading || txnLoading) ? (
            <div className="py-10 text-center text-sm text-gray-400">Loading activity…</div>
          ) : ledgerRowsWithBalance.length === 0 ? (
            <div className="py-10 text-center text-sm text-gray-400">No activity in this range.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 text-gray-500">
                  <tr>{['Date','Broker','How earned','Math','From booking','Net','Running balance'].map(h => <th key={h} className="px-3 py-2 text-left whitespace-nowrap">{h}</th>)}</tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {ledgerRowsWithBalance.map(r => {
                    const m = LEDGER_KIND_META[r.kind]
                    // Explicit chip + math hint for commission rows.  Other ledger
                    // events (payout paid, withdrawal paid) reuse the generic Badge.
                    const incomeBadge = (() => {
                      if (r.kind !== 'commission_earned') return <Badge label={m?.label || r.kind} className={m?.color || 'bg-gray-100 text-gray-700'}/>
                      const it = r.income_type || 'direct'
                      const lvl = r.level ?? 0
                      const map: Record<string, { label: string; cls: string }> = {
                        direct:             { label: 'Direct sale',           cls: 'bg-emerald-50 text-emerald-700 border border-emerald-200' },
                        differential:       { label: `L${lvl} upline differential`, cls: 'bg-blue-50 text-blue-700 border border-blue-200' },
                        traditional_direct: { label: 'Traditional direct',     cls: 'bg-amber-50 text-amber-700 border border-amber-200' },
                        traditional_split:  { label: `Traditional split (pos ${lvl + 1})`, cls: 'bg-amber-50 text-amber-700 border border-amber-200' },
                        income1:            { label: 'Income 1', cls: 'bg-purple-50 text-purple-700 border border-purple-200' },
                        income2:            { label: 'Income 2', cls: 'bg-purple-50 text-purple-700 border border-purple-200' },
                        income3:            { label: 'Income 3', cls: 'bg-purple-50 text-purple-700 border border-purple-200' },
                      }
                      const cfg = map[it] || { label: it, cls: 'bg-gray-100 text-gray-700' }
                      return <Badge label={cfg.label} className={cfg.cls}/>
                    })()
                    const math = (() => {
                      if (r.kind !== 'commission_earned') return r.detail || ''
                      const base = Number(r.base_amount || 0)
                      const pct  = Number(r.rate_pct || 0)
                      const gross= Number(r.gross_payout || 0)
                      if (base > 0 && pct > 0) return `${pct}% × ${formatINR(base)} = ${formatINR(gross)} gross`
                      return r.detail || ''
                    })()
                    return (
                      <tr key={r.id}>
                        <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{formatDate(r.at)}</td>
                        <td className="px-3 py-2">
                          <Link to={`/broker/dashboard?broker_id=${r.broker_id}`} className="font-medium text-sm text-blue-700 hover:underline">{r.broker_name}</Link>
                          <div className="text-[10px] text-gray-400 font-mono">[{r.broker_code}]</div>
                        </td>
                        <td className="px-3 py-2">{incomeBadge}</td>
                        <td className="px-3 py-2 text-[11px] text-gray-600 whitespace-nowrap">{math}</td>
                        <td className="px-3 py-2">
                          {r.booking_no && r.booking_no !== '—'
                            ? <Link to={`/bookings?search=${r.booking_no}`} className="text-xs font-mono text-blue-700 hover:underline">{r.ref}</Link>
                            : <span className="text-xs font-mono text-gray-600">{r.ref}</span>}
                        </td>
                        <td className="px-3 py-2">
                          <span className={`font-semibold inline-flex items-center gap-1 ${r.direction === 'credit' ? 'text-emerald-700' : 'text-rose-700'}`}>
                            {r.direction === 'credit' ? <ArrowUpRight size={12}/> : <ArrowDownRight size={12}/>}
                            {r.direction === 'credit' ? '+' : '−'}{formatINR(r.amount)}
                          </span>
                        </td>
                        <td className="px-3 py-2 font-bold tabular-nums">{formatINR(r.balance)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Broker-grouped list */}
      {view === 'per_broker' && (
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm divide-y divide-gray-100">
        {(distLoading || txnLoading) && <div className="py-10 text-center text-sm text-gray-400">Loading…</div>}
        {!distLoading && !txnLoading && filtered.length === 0 && (
          <div className="py-10 text-center text-sm text-gray-400">No broker payouts to show.</div>
        )}
        {filtered.map(r => {
          const open = expanded.has(r.broker_id)
          const b = r.broker
          return (
            <div key={r.broker_id}>
              <button onClick={() => toggleExpand(r.broker_id)} className="w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-gray-50">
                <ChevronRight size={14} className={`text-gray-400 shrink-0 transition-transform ${open ? 'rotate-90' : ''}`}/>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-gray-900 truncate">{b?.name || '—'}</div>
                  <div className="text-xs text-gray-500 truncate">
                    <span className="font-mono">[{b?.broker_id || r.broker_id.slice(0,8)}]</span>
                    {b?.rank && <span> · {b.rank}</span>}
                    {b?.kyc_status && b.kyc_status !== 'approved' && <span className="ml-2 text-amber-700">KYC {b.kyc_status}</span>}
                  </div>
                </div>
                {(() => {
                  // Coordination check across both settlement paths.  If total committed
                  // (paid + pending across cycles + withdrawals) exceeds earned, the broker
                  // is over-allocated — admin should review before paying anything else.
                  const committed = r.paid + r.approved_payout + r.pending_payout
                  const overAllocated = committed > r.earned + 0.01
                  const overBy = committed - r.earned
                  return (
                    <>
                      <div className="text-right shrink-0 hidden sm:block">
                        <div className="text-[10px] text-gray-400">Earned</div>
                        <div className="font-bold text-emerald-700">{formatINR(r.earned)}</div>
                      </div>
                      <div className="text-right shrink-0 hidden sm:block">
                        <div className="text-[10px] text-gray-400">Paid</div>
                        <div className="font-bold text-blue-700">{formatINR(r.paid)}</div>
                      </div>
                      <div className="text-right shrink-0">
                        <div className="text-[10px] text-gray-400 inline-flex items-center gap-0.5">
                          Owed
                          {overAllocated && (
                            <span title={`Over-allocated by ${formatINR(overBy)} — cycle + withdrawal commitments exceed earnings. Resolve before paying out.`}>
                              <AlertCircle size={11} className="text-rose-600 ml-0.5"/>
                            </span>
                          )}
                        </div>
                        <div className={`font-bold ${overAllocated ? 'text-rose-700' : r.balance > 0 ? 'text-rose-700' : 'text-gray-400'}`}>{formatINR(r.balance)}</div>
                      </div>
                    </>
                  )
                })()}
                {/* Inline quick-pay.  If this broker has any txn in pending/approved
                    status, surface a "Pay" button on the row so admin doesn't have to
                    expand → scroll → find the txn → tap manage.  Picks the most
                    urgent: approved first (already signed off), then pending. */}
                {(() => {
                  const nextTxn = [...(r.txns as any[])].find(t => t.status === 'approved') || (r.txns as any[]).find(t => t.status === 'pending')
                  if (!nextTxn) return null
                  return (
                    <button
                      onClick={e => { e.stopPropagation(); openTxn(nextTxn) }}
                      className="ml-2 inline-flex items-center gap-1 text-xs px-3 py-1 rounded-md bg-emerald-600 text-white hover:bg-emerald-700 font-semibold"
                      title={`Pay this broker's ${nextTxn.status} cycle payout`}
                    >
                      Pay {formatINR(nextTxn.net_amount || nextTxn.amount || 0)}
                    </button>
                  )
                })()}
                <Link to={`/broker/dashboard?broker_id=${r.broker_id}`}
                  onClick={e => e.stopPropagation()}
                  className="ml-2 inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md border border-gray-200 hover:bg-gray-50">
                  <ExternalLink size={11}/>Portal
                </Link>
              </button>

              {open && (
                <div className="bg-gray-50/60 px-12 py-4 border-t border-gray-100 space-y-4">
                  {/* Pending txns */}
                  <div>
                    <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Payout transactions ({r.txns.length})</div>
                    {r.txns.length === 0 ? (
                      <div className="rounded-lg border border-dashed border-gray-300 bg-white py-4 text-center text-xs text-gray-400">No payout transactions yet. Close a Payout Cycle to generate one.</div>
                    ) : (
                      <div className="bg-white rounded-lg border border-gray-200 overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead className="bg-gray-50 text-gray-500">
                            <tr>{['Created','Type','Booking','Gross','TDS','Net','Status','UTR','Paid Date','Action'].map(h => <th key={h} className="px-3 py-2 text-left">{h}</th>)}</tr>
                          </thead>
                          <tbody className="divide-y divide-gray-50">
                            {r.txns.map((t: any) => (
                              <tr key={t.id}>
                                <td className="px-3 py-2 whitespace-nowrap">{formatDate(t.created_at)}</td>
                                <td className="px-3 py-2 capitalize">{t.payout_type || '—'}</td>
                                <td className="px-3 py-2 font-mono text-blue-700">{t.bp_bookings?.booking_no || '—'}</td>
                                <td className="px-3 py-2">{formatINR(t.amount)}</td>
                                <td className="px-3 py-2 text-rose-600">−{formatINR(t.tds_amount || 0)}</td>
                                <td className="px-3 py-2 font-semibold text-emerald-700">{formatINR(t.net_amount || 0)}</td>
                                <td className="px-3 py-2"><Badge label={t.status} className={PAYOUT_STATUS_COLORS[t.status] || 'bg-gray-100 text-gray-700'}/></td>
                                <td className="px-3 py-2 font-mono">{t.utr_ref || '—'}</td>
                                <td className="px-3 py-2">{t.paid_date ? formatDate(t.paid_date) : '—'}</td>
                                <td className="px-3 py-2">
                                  <Button size="sm" variant="ghost" onClick={() => openTxn(t)}>Manage</Button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>

                  {/* Distributions = per-payment earnings ledger */}
                  <div>
                    <div className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-2">Earnings ledger ({r.distributions.length} entries · {formatINR(r.earned)} net)</div>
                    {r.distributions.length === 0 ? (
                      <div className="rounded-lg border border-dashed border-gray-300 bg-white py-4 text-center text-xs text-gray-400">No commissions earned yet. MLM distributions appear here as customers pay.</div>
                    ) : (
                      <div className="bg-white rounded-lg border border-gray-200 overflow-x-auto max-h-80 overflow-y-auto">
                        <table className="w-full text-xs">
                          <thead className="bg-gray-50 text-gray-500 sticky top-0">
                            <tr>{['Date','Booking','Type','Level','Gross','TDS','Admin','Net'].map(h => <th key={h} className="px-3 py-2 text-left">{h}</th>)}</tr>
                          </thead>
                          <tbody className="divide-y divide-gray-50">
                            {r.distributions.slice(0, 100).map((d: any) => (
                              <tr key={d.id}>
                                <td className="px-3 py-1.5 whitespace-nowrap">{formatDate(d.created_at)}</td>
                                <td className="px-3 py-1.5 font-mono text-blue-700">{d.bp_bookings?.booking_no || '—'}</td>
                                <td className="px-3 py-1.5 capitalize">{d.income_type}</td>
                                <td className="px-3 py-1.5">{d.level === 0 ? 'Self' : `L${d.level}`}</td>
                                <td className="px-3 py-1.5">{formatINR(d.gross_payout)}</td>
                                <td className="px-3 py-1.5 text-rose-600">−{formatINR(d.tds_amount || 0)}</td>
                                <td className="px-3 py-1.5 text-amber-700">−{formatINR(d.admin_charge || 0)}</td>
                                <td className="px-3 py-1.5 font-semibold text-emerald-700">{formatINR(d.net_payout)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        {r.distributions.length > 100 && (
                          <div className="px-3 py-2 text-[10px] text-gray-400 bg-gray-50">… and {r.distributions.length - 100} more</div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
      )}

      {/* Activity log access — quiet footer link, not a top-of-page toggle.  Admin who
          wants the ledger gets here; everyone else doesn't see ledger-related clutter. */}
      <div className="text-center pt-2">
        <button
          onClick={() => setView(view === 'activity' ? 'per_broker' : 'activity')}
          className="text-xs text-gray-500 hover:text-gray-900 inline-flex items-center gap-1"
        >
          {view === 'activity' ? '← Back to broker list' : 'View full ledger history →'}
        </button>
        {view === 'activity' && ledgerRowsWithBalance.length > 0 && (
          <button
            onClick={exportLedgerCSV}
            className="text-xs text-gray-500 hover:text-gray-900 inline-flex items-center gap-1 ml-4"
          >
            <Download size={12}/>Export CSV
          </button>
        )}
      </div>

      {/* Manage transaction modal */}
      <Modal open={modal} onClose={() => setModal(false)} title="Manage Payout Transaction">
        {selected && (
          <div className="space-y-4">
            <div className="bg-blue-50 rounded-lg p-4 text-sm grid grid-cols-2 gap-2">
              <div><span className="text-gray-500">Broker:</span> <strong>{selected.brokers?.name}</strong></div>
              <div><span className="text-gray-500">Gross:</span> <strong>{formatINR(selected.amount)}</strong></div>
              <div><span className="text-gray-500">PAN:</span> {selected.brokers?.pan_no || '—'}</div>
              <div><span className="text-gray-500">TDS applicable:</span> {selected.brokers?.tds_applicable ? 'Yes' : 'No'}</div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Select label="Status" value={form.status} onChange={(e: any) => set('status', e.target.value)}>
                {['pending','approved','paid','rejected','hold'].map(s => <option key={s} value={s}>{s}</option>)}
              </Select>
              <Select label="Payment Mode" value={form.payment_mode} onChange={(e: any) => set('payment_mode', e.target.value)}>
                <option value="">Select</option>
                {['neft','rtgs','imps','upi','cheque'].map(m => <option key={m} value={m}>{m.toUpperCase()}</option>)}
              </Select>
              <Input label="UTR / Ref No" value={form.utr_ref} onChange={(e: any) => set('utr_ref', e.target.value)} />
              <Input label="Paid Date" type="date" value={form.paid_date} onChange={(e: any) => set('paid_date', e.target.value)} />
              <Input label="TDS Amount (₹)" type="number" value={form.tds_amount} onChange={(e: any) => set('tds_amount', e.target.value)} />
              <Input label="Net Amount (₹)" type="number" value={form.net_amount} onChange={(e: any) => set('net_amount', e.target.value)} />
              <Textarea label="Notes" value={form.notes} onChange={(e: any) => set('notes', e.target.value)} className="col-span-2" rows={2} />
            </div>
          </div>
        )}
        <div className="flex justify-end gap-2 mt-6">
          <Button variant="secondary" onClick={() => setModal(false)}>Cancel</Button>
          <Button onClick={save} loading={update.isPending}>Update</Button>
        </div>
      </Modal>
    </div>
  )
}

function Kpi({ icon, label, value, sub, tint, href, onClick }: any) {
  const interactive = !!(href || onClick)
  const body = (
    <div className={`rounded-xl border p-3 ${tint} ${interactive ? 'hover:shadow-sm hover:brightness-[1.02] active:scale-[0.98] cursor-pointer transition' : ''}`}>
      <div className="flex items-center justify-between mb-0.5">
        {icon}<div className="text-base md:text-lg font-bold">{value}</div>
      </div>
      <div className="text-xs text-gray-500">{label}</div>
      {sub && <div className="text-[10px] text-gray-400">{sub}</div>}
    </div>
  )
  if (href) return <Link to={href}>{body}</Link>
  if (onClick) return <button type="button" onClick={onClick} className="text-left w-full">{body}</button>
  return body
}
