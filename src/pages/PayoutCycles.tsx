import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/Button.tsx'
import { Badge } from '@/components/ui/Badge.tsx'
import { formatINR, formatDate, PAYOUT_STATUS_COLORS } from '@/lib/utils'
import { loadPayoutConfig, type PayoutConfig } from '@/lib/payoutEngine'
import { logClosure, getCurrentUserId } from '@/lib/closure'
import { ClosureDialog } from '@/components/ClosureDialog'
import { CalendarRange, Lock, Unlock, TrendingUp, Users, IndianRupee, Banknote, ChevronRight, ExternalLink } from 'lucide-react'
import toast from 'react-hot-toast'

const STATUS_COLORS: Record<string, string> = {
  open:     'bg-amber-50 text-amber-700 border border-amber-200',
  closed:   'bg-slate-100 text-slate-800 border border-slate-300',
  settled:  'bg-emerald-50 text-emerald-700 border border-emerald-200',
  reopened: 'bg-blue-50 text-blue-700 border border-blue-200',
}

// Per-distribution row used to build the cycle close preview.  These are real, already-distributed
// MLM commissions from `payout_distributions` — NOT the promised `bp_bookings.commission_amount`,
// which would over-state by the unpaid portion of every booking and double-deduct TDS at close time.
type DistributionRow = {
  id: string
  broker_id: string
  broker_name: string
  broker_code: string
  booking_id: string | null
  gross_payout: number
  tds_amount: number
  admin_charge: number
  net_payout: number
  created_at: string | null
}

export default function PayoutCycles() {
  const qc = useQueryClient()
  const [closureFor, setClosureFor] = useState<{ cycle: any; action: 'close' | 'reopen' } | null>(null)
  const [showPreview, setShowPreview] = useState(false)
  // On-demand closing — admin closes whatever's currently unbatched, anytime.
  // No more month-anchor: a "cycle" is any settlement run, not a calendar boundary.
  // Optional slice mode lets admin limit the close to a custom date range.
  const [sliceMode, setSliceMode] = useState<'all' | 'range'>('all')
  const [sliceFrom, setSliceFrom] = useState<string>('')
  const [sliceTo,   setSliceTo]   = useState<string>('')
  // Filter for past cycles (e.g. only those containing a specific broker)
  const [brokerFilter, setBrokerFilter] = useState<string>('')
  // Expanded closed-cycle rows
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const { data: cfg } = useQuery<PayoutConfig>({ queryKey: ['payout_config'], queryFn: loadPayoutConfig })
  const tdsPct   = cfg?.tds_pct ?? 0
  const adminPct = cfg?.admin_charge_pct ?? 0

  const { data: cycles = [], isLoading } = useQuery({
    queryKey: ['payout_cycles'],
    queryFn: async () => {
      const { data, error } = await supabase.from('payout_cycles').select('*').order('period_start', { ascending: false })
      if (error) throw error
      return data
    },
  })

  const { data: brokers = [] } = useQuery({
    queryKey: ['payout_cycles_brokers_lite'],
    queryFn: async () => {
      const { data } = await supabase.from('brokers').select('id, name, broker_id').order('name')
      return data || []
    },
  })

  // Eligible distributions = ones not yet in any cycle (cycle_id IS NULL).  Optionally
  // sliced by a date range so admin can settle just a slice (e.g. last week's earnings).
  const { data: pendingCommissions = [] } = useQuery<DistributionRow[]>({
    queryKey: ['cycle_pending_distributions', sliceMode, sliceFrom, sliceTo],
    queryFn: async () => {
      let q = supabase
        .from('payout_distributions')
        .select('id, beneficiary_broker_id, booking_id, gross_payout, tds_amount, admin_charge, net_payout, created_at, brokers!payout_distributions_beneficiary_broker_id_fkey(name, broker_id)')
        .is('cycle_id', null)
      if (sliceMode === 'range' && sliceFrom) q = q.gte('created_at', sliceFrom)
      if (sliceMode === 'range' && sliceTo)   q = q.lte('created_at', `${sliceTo}T23:59:59.999Z`)
      const { data, error } = await q
      if (error) throw error
      return (data || []).map((d: any) => ({
        id:           d.id,
        broker_id:    d.beneficiary_broker_id,
        broker_name:  d.brokers?.name || '—',
        broker_code:  d.brokers?.broker_id || '—',
        booking_id:   d.booking_id,
        gross_payout: Number(d.gross_payout || 0),
        tds_amount:   Number(d.tds_amount   || 0),
        admin_charge: Number(d.admin_charge || 0),
        net_payout:   Number(d.net_payout   || 0),
        created_at:   d.created_at,
      }))
    },
  })

  // Aggregate per broker for the close-period preview.  Sums already-deducted figures from each
  // distribution row — no re-calculation of TDS/admin (avoiding the double-deduction the old
  // bp_bookings.commission_amount path had at close time).
  const perBroker = useMemo(() => {
    const map = new Map<string, { broker_id: string; broker_name: string; broker_code: string; gross: number; tds: number; admin: number; net: number; bookings: Set<string>; distributions: number }>()
    for (const r of pendingCommissions) {
      if (!r.broker_id || r.net_payout <= 0) continue
      const cur = map.get(r.broker_id) || { broker_id: r.broker_id, broker_name: r.broker_name, broker_code: r.broker_code, gross: 0, tds: 0, admin: 0, net: 0, bookings: new Set<string>(), distributions: 0 }
      cur.gross += r.gross_payout
      cur.tds   += r.tds_amount
      cur.admin += r.admin_charge
      cur.net   += r.net_payout
      cur.distributions += 1
      if (r.booking_id) cur.bookings.add(r.booking_id)
      map.set(r.broker_id, cur)
    }
    return Array.from(map.values())
      .map(b => ({ ...b, bookings: b.bookings.size }))
      .sort((a, b) => b.net - a.net)
  }, [pendingCommissions])

  const totals = useMemo(() => {
    const gross = perBroker.reduce((s, r) => s + r.gross, 0)
    const tds   = perBroker.reduce((s, r) => s + r.tds,   0)
    const admin = perBroker.reduce((s, r) => s + r.admin, 0)
    const net   = perBroker.reduce((s, r) => s + r.net,   0)
    const bookingSet = new Set<string>()
    for (const r of pendingCommissions) if (r.booking_id) bookingSet.add(r.booking_id)
    return { gross, tds, admin, net, brokers: perBroker.length, bookings: bookingSet.size, distributions: pendingCommissions.length }
  }, [perBroker, pendingCommissions])

  const closeCycle = useMutation({
    mutationFn: async ({ reason }: { reason: string }) => {
      if (perBroker.length === 0) throw new Error('Nothing to close — no unbatched commission distributions')
      const userId = await getCurrentUserId()

      // Period = the actual span of distributions being closed, not a calendar boundary.
      // Label "Settlement · {timestamp}" or "Range {from} → {to}" when admin sliced.
      const dates = pendingCommissions.map(p => p.created_at).filter(Boolean).sort()
      const periodStart = sliceMode === 'range' && sliceFrom ? sliceFrom : (dates[0] || new Date().toISOString()).slice(0, 10)
      const periodEnd   = sliceMode === 'range' && sliceTo   ? sliceTo   : (dates[dates.length - 1] || new Date().toISOString()).slice(0, 10)
      const periodLabel = sliceMode === 'range'
        ? `Range · ${periodStart} → ${periodEnd}`
        : `Settlement · ${new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}`

      const { data: cycle, error: cErr } = await supabase
        .from('payout_cycles')
        .insert({
          period_label:    periodLabel,
          period_start:    periodStart,
          period_end:      periodEnd,
          status:          'closed',
          total_bookings:  totals.bookings,
          total_brokers:   totals.brokers,
          total_gross:     totals.gross,
          total_tds:       totals.tds,
          total_admin:     totals.admin,
          total_net:       totals.net,
          closed_at:       new Date().toISOString(),
          closed_by:       userId,
          closure_notes:   reason || null,
          updated_at:      new Date().toISOString(),
        })
        .select()
        .single()
      if (cErr || !cycle) throw cErr || new Error('Failed to create cycle')

      // Stamp every distribution we're closing with the new cycle.id so they don't get
      // double-batched on the next close.  This is what makes the "all unbatched" model safe.
      const distIds = pendingCommissions.map(p => p.id)
      if (distIds.length > 0) {
        const { error: updErr } = await supabase
          .from('payout_distributions')
          .update({ cycle_id: cycle.id })
          .in('id', distIds)
        if (updErr) throw updErr
      }

      // One payout transaction per broker — already-net figures, no re-deduction.
      const tx = perBroker.map(b => ({
        broker_id:      b.broker_id,
        cycle_id:       cycle.id,
        payout_type:    'cycle',
        amount:         b.gross,
        tds_amount:     b.tds,
        admin_charge:   b.admin,
        net_amount:     b.net,
        status:         'pending',
        notes:          `${periodLabel} — ${b.distributions} distribution${b.distributions !== 1 ? 's' : ''} across ${b.bookings} booking${b.bookings !== 1 ? 's' : ''}`,
      }))
      if (tx.length > 0) {
        const { error: txErr } = await supabase.from('bp_payout_transactions').insert(tx)
        if (txErr) throw txErr
      }

      await logClosure({
        entityType: 'cycle',
        entityId:   cycle.id,
        action:     'closed',
        reason,
        metadata: { period: periodLabel, brokers: totals.brokers, gross: totals.gross, net: totals.net, distributions: distIds.length },
      })
      return cycle
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['payout_cycles'] })
      qc.invalidateQueries({ queryKey: ['cycle_pending_distributions'] })
      qc.invalidateQueries({ queryKey: ['cycle_txns_all'] })
      qc.invalidateQueries({ queryKey: ['payouts'] })
      toast.success('Settlement closed — payout transactions generated')
      setClosureFor(null)
      setShowPreview(false)
    },
    onError: (e: any) => toast.error(e.message),
  })

  const reopenCycle = useMutation({
    mutationFn: async ({ cycle, reason }: { cycle: any; reason: string }) => {
      if (!reason) throw new Error('Reopen reason is required')
      const userId = await getCurrentUserId()

      // Delete pending transactions AND unstamp the distributions so they go back into
      // the "unbatched" pool and can be included in the next close.
      await supabase.from('bp_payout_transactions').delete().eq('cycle_id', cycle.id).eq('status', 'pending')
      await supabase.from('payout_distributions').update({ cycle_id: null }).eq('cycle_id', cycle.id)

      const { error } = await supabase.from('payout_cycles').update({
        status: 'reopened',
        reopened_at: new Date().toISOString(),
        reopened_by: userId,
        reopen_reason: reason,
        closed_at: null,
        updated_at: new Date().toISOString(),
      }).eq('id', cycle.id)
      if (error) throw error

      await logClosure({ entityType: 'cycle', entityId: cycle.id, action: 'reopened', reason, metadata: { period: cycle.period_label } })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['payout_cycles'] })
      qc.invalidateQueries({ queryKey: ['cycle_pending_distributions'] })
      qc.invalidateQueries({ queryKey: ['cycle_txns_all'] })
      qc.invalidateQueries({ queryKey: ['payouts'] })
      toast.success('Cycle reopened — distributions returned to the unbatched pool')
      setClosureFor(null)
    },
    onError: (e: any) => toast.error(e.message),
  })

  // Load every cycle-generated transaction across all cycles in one round-trip; partition
  // per-cycle in memory.  Cheap even at 100s of cycles, avoids N+1 queries on row-expand.
  const { data: allCycleTxns = [] } = useQuery({
    queryKey: ['cycle_txns_all'],
    queryFn: async () => {
      const { data } = await supabase.from('bp_payout_transactions')
        .select('id, cycle_id, broker_id, amount, tds_amount, admin_charge, net_amount, status, payout_type, utr_ref, paid_date, created_at, brokers(name, broker_id)')
        .eq('payout_type', 'cycle')
        .order('created_at', { ascending: false })
      return data || []
    },
  })

  const txnsByCycle = useMemo(() => {
    const m: Record<string, any[]> = {}
    for (const t of allCycleTxns as any[]) {
      if (!t.cycle_id) continue
      ;(m[t.cycle_id] ??= []).push(t)
    }
    return m
  }, [allCycleTxns])

  const cyclesWithStatus = useMemo(() => {
    return (cycles as any[]).map((c: any) => {
      const ts = txnsByCycle[c.id] || []
      const paidCount    = ts.filter((t: any) => t.status === 'paid').length
      const pendingCount = ts.filter((t: any) => t.status === 'pending').length
      const approvedCount = ts.filter((t: any) => t.status === 'approved').length
      return { ...c, ts, paidCount, pendingCount, approvedCount, totalCount: ts.length }
    }).filter((c: any) => {
      if (!brokerFilter) return true
      return (c.ts as any[]).some(t => t.broker_id === brokerFilter)
    })
  }, [cycles, txnsByCycle, brokerFilter])

  const toggleExpand = (id: string) => setExpanded(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-indigo-50 rounded-lg"><CalendarRange size={20} className="text-indigo-600"/></div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">Payout Cycles</h1>
            <p className="text-sm text-gray-500">Monthly broker payout closing · TDS {tdsPct}% · Admin {adminPct}%</p>
          </div>
        </div>
      </div>

      <div className="bg-gradient-to-br from-indigo-50 to-blue-50 border border-indigo-100 rounded-2xl p-5 mb-6">
        <div className="flex items-start justify-between mb-4 flex-wrap gap-3">
          <div>
            <div className="text-xs font-semibold text-indigo-600 uppercase tracking-wider mb-1">Pending settlement</div>
            <div className="text-lg font-bold text-gray-900">
              {totals.distributions === 0
                ? 'Nothing to close · all commissions are batched'
                : `${totals.distributions} distribution${totals.distributions === 1 ? '' : 's'} ready to close`}
            </div>
            <div className="text-xs text-gray-500 mt-0.5">
              Real-time MLM commissions accumulate here until you settle them.  Close whenever
              you're ready to issue the bank transfers — no monthly schedule required.
            </div>
            {/* Optional slice — narrow the close to a specific date range */}
            <div className="mt-2 flex items-center gap-2 text-xs flex-wrap">
              <span className="text-gray-500">Scope:</span>
              <div className="inline-flex bg-white rounded-full border border-indigo-200 p-0.5">
                <button onClick={() => setSliceMode('all')}
                  className={`px-3 py-0.5 rounded-full transition ${sliceMode === 'all' ? 'bg-indigo-600 text-white font-semibold' : 'text-gray-600'}`}>All unbatched</button>
                <button onClick={() => setSliceMode('range')}
                  className={`px-3 py-0.5 rounded-full transition ${sliceMode === 'range' ? 'bg-indigo-600 text-white font-semibold' : 'text-gray-600'}`}>Date range</button>
              </div>
              {sliceMode === 'range' && (
                <>
                  <input type="date" value={sliceFrom} onChange={e => setSliceFrom(e.target.value)}
                    className="bg-white border border-indigo-200 rounded-lg px-2 py-1 text-xs focus:outline-none focus:border-indigo-400"/>
                  <span className="text-gray-400">→</span>
                  <input type="date" value={sliceTo} onChange={e => setSliceTo(e.target.value)}
                    className="bg-white border border-indigo-200 rounded-lg px-2 py-1 text-xs focus:outline-none focus:border-indigo-400"/>
                </>
              )}
            </div>
          </div>
          <div className="flex gap-2 self-end">
            <Button variant="secondary" onClick={() => setShowPreview(s => !s)} disabled={totals.distributions === 0}>{showPreview ? 'Hide preview' : 'Preview totals'}</Button>
            <Button onClick={() => setClosureFor({ cycle: { period_label: 'New settlement' }, action: 'close' })} disabled={totals.distributions === 0}>
              <Lock size={14}/>Close now
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
          <Stat icon={<TrendingUp size={14}/>}   label={`Distributions`}   value={String(totals.distributions)} />
          <Stat icon={<Users size={14}/>}        label="Brokers"           value={String(totals.brokers)} />
          <Stat icon={<IndianRupee size={14}/>}  label="Gross commission"  value={formatINR(totals.gross)} accent="text-gray-900" />
          <Stat icon={<IndianRupee size={14}/>}  label={`TDS (${tdsPct}%)`} value={formatINR(totals.tds)} accent="text-rose-700" />
          <Stat icon={<IndianRupee size={14}/>}  label={`Admin (${adminPct}%)`} value={formatINR(totals.admin)} accent="text-amber-700" />
          <Stat icon={<Banknote size={14}/>}     label="Net payable"       value={formatINR(totals.net)} accent="text-emerald-700" />
        </div>

        {totals.distributions === 0 && (
          <div className="mt-4 text-xs text-gray-500">
            {sliceMode === 'range'
              ? 'No unbatched distributions in this date range.'
              : 'All commissions have been batched into closed cycles. New distributions land here automatically when customers pay.'}
          </div>
        )}

        {showPreview && perBroker.length > 0 && (
          <div className="mt-4 bg-white rounded-xl border border-indigo-100 overflow-hidden">
            <div className="px-4 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide border-b border-gray-100">Per-broker breakdown ({perBroker.length})</div>
            <div className="max-h-72 overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 sticky top-0">
                  <tr>{['Broker','Code','Distributions','Bookings','Gross','TDS','Admin','Net'].map(h => <th key={h} className="px-3 py-2 text-left text-gray-500 font-semibold">{h}</th>)}</tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {perBroker.map(b => (
                    <tr key={b.broker_id}>
                      <td className="px-3 py-2 font-medium">{b.broker_name}</td>
                      <td className="px-3 py-2 font-mono text-gray-500">{b.broker_code}</td>
                      <td className="px-3 py-2">{b.distributions}</td>
                      <td className="px-3 py-2">{b.bookings}</td>
                      <td className="px-3 py-2 font-semibold">{formatINR(b.gross)}</td>
                      <td className="px-3 py-2 text-rose-700">{formatINR(b.tds)}</td>
                      <td className="px-3 py-2 text-amber-700">{formatINR(b.admin)}</td>
                      <td className="px-3 py-2 font-bold text-emerald-700">{formatINR(b.net)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between gap-2 flex-wrap">
          <div className="text-sm font-semibold text-gray-700">Closed cycles ({cyclesWithStatus.length})</div>
          <select value={brokerFilter} onChange={e => setBrokerFilter(e.target.value)}
            className="bg-white border border-gray-200 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:border-gray-400">
            <option value="">Filter by broker — all</option>
            {(brokers as any[]).map((b: any) => <option key={b.id} value={b.id}>{b.name} [{b.broker_id}]</option>)}
          </select>
        </div>

        {isLoading && <div className="py-10 text-center text-sm text-gray-400">Loading cycles…</div>}
        {!isLoading && cyclesWithStatus.length === 0 && (
          <div className="py-10 text-center text-sm text-gray-400">{brokerFilter ? 'No cycles contain that broker yet.' : 'No closed cycles yet. Use Close period above to create the first one.'}</div>
        )}

        <div className="divide-y divide-gray-100">
          {cyclesWithStatus.map((r: any) => {
            const open = expanded.has(r.id)
            return (
              <div key={r.id}>
                <button onClick={() => toggleExpand(r.id)} className="w-full text-left px-4 py-3 flex items-center gap-3 hover:bg-gray-50">
                  <ChevronRight size={14} className={`text-gray-400 shrink-0 transition-transform ${open ? 'rotate-90' : ''}`}/>
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-gray-900">{r.period_label}</div>
                    <div className="text-[11px] text-gray-400">{formatDate(r.period_start)} → {formatDate(r.period_end)} · closed {r.closed_at ? formatDate(r.closed_at) : '—'}</div>
                  </div>
                  <div className="hidden sm:flex flex-col items-end shrink-0">
                    <div className="text-[10px] text-gray-400">Net payable</div>
                    <div className="font-bold text-emerald-700 tabular-nums">{formatINR(r.total_net)}</div>
                  </div>
                  <div className="flex flex-col items-end shrink-0 text-[11px] tabular-nums">
                    <span className="text-emerald-700">{r.paidCount} paid</span>
                    {r.approvedCount > 0 && <span className="text-amber-700">{r.approvedCount} approved</span>}
                    {r.pendingCount > 0 && <span className="text-orange-700">{r.pendingCount} pending</span>}
                    <span className="text-gray-400">{r.totalCount} txn{r.totalCount === 1 ? '' : 's'}</span>
                  </div>
                  <Badge label={r.status} className={STATUS_COLORS[r.status] || 'bg-gray-100 text-gray-700'} />
                  {(r.status === 'closed' || r.status === 'settled') && (
                    <Button size="sm" variant="secondary" onClick={(e: any) => { e.stopPropagation(); setClosureFor({ cycle: r, action: 'reopen' }) }}><Unlock size={12}/>Reopen</Button>
                  )}
                </button>

                {open && (
                  <div className="bg-gray-50/60 px-12 py-4 border-t border-gray-100 space-y-3">
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                      <Stat icon={<Users size={13}/>}        label="Brokers"  value={String(r.total_brokers || 0)} />
                      <Stat icon={<IndianRupee size={13}/>}  label="Gross"    value={formatINR(r.total_gross)} accent="text-gray-900"/>
                      <Stat icon={<IndianRupee size={13}/>}  label="TDS"      value={formatINR(r.total_tds)}   accent="text-rose-700"/>
                      <Stat icon={<IndianRupee size={13}/>}  label="Admin"    value={formatINR(r.total_admin)} accent="text-amber-700"/>
                    </div>

                    {r.ts.length === 0 ? (
                      <div className="text-xs text-gray-400 italic">No payout transactions on this cycle yet.</div>
                    ) : (
                      <div className="bg-white rounded-lg border border-gray-200 overflow-x-auto">
                        <table className="w-full text-xs">
                          <thead className="bg-gray-50 text-gray-500"><tr>{['Broker','Code','Gross','TDS','Admin','Net','Status','UTR','Paid date','Manage'].map(h => <th key={h} className="px-3 py-2 text-left">{h}</th>)}</tr></thead>
                          <tbody className="divide-y divide-gray-50">
                            {(r.ts as any[]).filter(t => !brokerFilter || t.broker_id === brokerFilter).map((t: any) => (
                              <tr key={t.id}>
                                <td className="px-3 py-2 font-medium">{t.brokers?.name || '—'}</td>
                                <td className="px-3 py-2 font-mono text-gray-500">{t.brokers?.broker_id || '—'}</td>
                                <td className="px-3 py-2">{formatINR(t.amount)}</td>
                                <td className="px-3 py-2 text-rose-600">−{formatINR(t.tds_amount || 0)}</td>
                                <td className="px-3 py-2 text-amber-700">−{formatINR(t.admin_charge || 0)}</td>
                                <td className="px-3 py-2 font-semibold text-emerald-700">{formatINR(t.net_amount || 0)}</td>
                                <td className="px-3 py-2"><Badge label={t.status} className={PAYOUT_STATUS_COLORS[t.status] || 'bg-gray-100 text-gray-700'}/></td>
                                <td className="px-3 py-2 font-mono">{t.utr_ref || '—'}</td>
                                <td className="px-3 py-2">{t.paid_date ? formatDate(t.paid_date) : '—'}</td>
                                <td className="px-3 py-2">
                                  <Link to={`/payouts?broker=${t.broker_id}`} className="text-xs text-blue-700 hover:underline inline-flex items-center gap-0.5">
                                    Open <ExternalLink size={10}/>
                                  </Link>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      <ClosureDialog
        open={!!closureFor}
        action={closureFor?.action === 'reopen' ? 'reopen' : 'close'}
        entityLabel={`payout cycle ${closureFor?.cycle?.period_label || ''}`}
        description={
          closureFor?.action === 'close'
            ? `Closing freezes the ${totals.distributions} distribution${totals.distributions !== 1 ? 's' : ''} ${sliceMode === 'range' ? `in the selected range` : 'currently unbatched'} into a settlement.  ${totals.brokers} broker${totals.brokers !== 1 ? 's' : ''} will get a pending payout transaction with the already-deducted figures (Net payable: ${formatINR(totals.net)}).`
            : 'Reopening clears all pending transactions generated by this cycle close. Brokers will see their wallets reset to pre-close state.'
        }
        warning={undefined}
        reasonRequired={closureFor?.action === 'reopen'}
        onClose={() => setClosureFor(null)}
        onConfirm={async (reason) => {
          if (!closureFor) return
          if (closureFor.action === 'close') await closeCycle.mutateAsync({ reason })
          else await reopenCycle.mutateAsync({ cycle: closureFor.cycle, reason })
        }}
        submitting={closeCycle.isPending || reopenCycle.isPending}
      />
    </div>
  )
}

function Stat({ icon, label, value, accent = 'text-gray-900' }: any) {
  return (
    <div className="bg-white rounded-xl border border-indigo-100 px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-gray-500 text-[11px] mb-0.5">{icon}<span className="truncate">{label}</span></div>
      <div className={`font-bold text-sm ${accent}`}>{value}</div>
    </div>
  )
}
