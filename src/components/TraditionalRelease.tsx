// Traditional commission that can be handed over today, booking by booking.
//
// Manisha, asked who should be allowed to release: "commission bante hi highlight ho jana
// chahiye." So this is not a report anyone has to go looking for — it opens with the
// money that is due right now, in rupees, at the top.
//
// It is deliberately NOT the payout cycle. A cycle is a period: everything earned between
// two dates, batched, closed once a month. Admin was explicit that traditional does not
// work that way — "isme monthly basis pe nahi hoyega, person by person hoyega". A
// traditional booking becomes payable the moment the customer's money crosses an agreed
// mark, whenever that happens, and it is paid on its own.
//
// The arithmetic lives in lib/tradRelease.ts and is tested there. This screen's whole job
// is to put it in front of somebody with the figures that explain it: what came in, what
// the plot is worth before discount, which slab that reaches, and what is still to come
// before the next one.
//
// Nothing here writes a commission row. recompute_booking_payouts() remains the only
// thing that decides what anybody earns; this only decides when it is handed over.
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { fetchAllRows, inChunks } from '@/lib/fetchAll'
import { formatINR } from '@/lib/utils'
import { Secret } from '@/lib/privacy'
import { downloadCsv } from '@/lib/download'
import { buildReleasePlan, DEFAULT_RELEASE_SLABS, type ReleaseSlab, type ReleasePlan } from '@/lib/tradRelease'
import { Search, Download, AlertTriangle, ChevronRight } from 'lucide-react'

type BookingRow = {
  id: string
  booking_no: string | null
  customer: string
  plan: ReleasePlan
  brokerNames: Record<string, string>
}

export default function TraditionalRelease() {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  const [onlyDue, setOnlyDue] = useState(true)

  const { data, isLoading } = useQuery({
    queryKey: ['traditional_release'],
    refetchOnWindowFocus: true,
    queryFn: async () => {
      // The agreed table lives in settings so the office can change it without a developer.
      const { data: cfg } = await supabase.from('app_settings').select('value').eq('key', 'payout_config').maybeSingle()
      const v: any = cfg?.value || {}
      const slabs: ReleaseSlab[] = Array.isArray(v.traditional_release_slabs) && v.traditional_release_slabs.length
        ? v.traditional_release_slabs : DEFAULT_RELEASE_SLABS
      const tdsPct = Number(v.tds_pct ?? 5)
      const adminPct = Number(v.admin_charge_pct ?? 10)

      const bookings = await fetchAllRows((f, t) => supabase
        .from('bp_bookings')
        .select('id, booking_no, broker_id, total_amount, discount_amount, commission_mode, traditional_commission_pct, traditional_commission_per_sqyd, size_sqyd, stage, bp_customers(name)')
        .eq('commission_mode', 'traditional').neq('stage', 'cancelled')
        .order('id').range(f, t))

      const ids = (bookings as any[]).map(b => b.id)
      if (ids.length === 0) return { rows: [] as BookingRow[], slabs }

      const [splits, dists, txns, brokers] = await Promise.all([
        inChunks<any>(ids, c => supabase.from('bp_booking_brokers').select('booking_id, broker_id, commission_pct').in('booking_id', c)),
        inChunks<any>(ids, c => supabase.from('payout_distributions').select('booking_id, beneficiary_broker_id, net_payout').in('booking_id', c)),
        inChunks<any>(ids, c => supabase.from('bp_payout_transactions').select('booking_id, broker_id, net_amount, amount, status').in('booking_id', c)),
        fetchAllRows((f, t) => supabase.from('brokers').select('id, name, broker_id').order('id').range(f, t)),
      ])
      // Verified money only. Commission is computed on verified payments, so anything
      // else would move the collected % without moving a rupee of commission.
      const pays = await inChunks<any>(ids, c => supabase
        .from('bp_payments').select('booking_id, amount, verification_status').in('booking_id', c))

      const brokerName = new Map((brokers as any[]).map(b => [b.id, `${b.name}${b.broker_id ? ` [${b.broker_id}]` : ''}`]))
      const collected = new Map<string, number>()
      for (const p of pays) {
        if ((p.verification_status || '') !== 'verified') continue
        collected.set(p.booking_id, (collected.get(p.booking_id) || 0) + Number(p.amount || 0))
      }
      const creditedBy = new Map<string, number>()
      for (const d of dists) {
        const k = `${d.booking_id}|${d.beneficiary_broker_id}`
        creditedBy.set(k, (creditedBy.get(k) || 0) + Number(d.net_payout || 0))
      }
      const releasedBy = new Map<string, number>()
      for (const t of txns) {
        if (!t.booking_id || !t.broker_id) continue
        // Rejected lines were never handed over, so they do not count against what is due.
        if (t.status === 'rejected' || t.status === 'cancelled') continue
        const k = `${t.booking_id}|${t.broker_id}`
        releasedBy.set(k, (releasedBy.get(k) || 0) + Number(t.net_amount || t.amount || 0))
      }
      const splitBy = new Map<string, any[]>()
      for (const s of splits) {
        const arr = splitBy.get(s.booking_id) || []; arr.push(s); splitBy.set(s.booking_id, arr)
      }

      const rows: BookingRow[] = []
      for (const b of bookings as any[]) {
        const team = splitBy.get(b.id) || []
        // No team rows means the engine pays the booking's own broker at its own rate —
        // the same figure, expressed one row instead of several.
        const shares = team.length > 0
          ? team.map((s: any) => ({ broker_id: s.broker_id, commission_pct: Number(s.commission_pct || 0) }))
          : (b.broker_id ? [{ broker_id: b.broker_id, commission_pct: effectivePct(b) }] : [])
        if (shares.length === 0) continue

        const plan = buildReleasePlan({
          money: {
            total: Number(b.total_amount || 0),
            discount: Number(b.discount_amount || 0),
            collected: collected.get(b.id) || 0,
          },
          shares: shares.map(s => ({
            ...s,
            credited: creditedBy.get(`${b.id}|${s.broker_id}`) || 0,
            released: releasedBy.get(`${b.id}|${s.broker_id}`) || 0,
          })),
          slabs, tdsPct, adminPct,
        })
        rows.push({
          id: b.id,
          booking_no: b.booking_no,
          customer: b.bp_customers?.name || '—',
          plan,
          brokerNames: Object.fromEntries(shares.map(s => [s.broker_id, brokerName.get(s.broker_id) || '—'])),
        })
      }
      rows.sort((a, b) => b.plan.totalReleasable - a.plan.totalReleasable)
      return { rows, slabs }
    },
  })

  const rows = data?.rows || []
  const slabs = data?.slabs || DEFAULT_RELEASE_SLABS
  const dueTotal = rows.reduce((s, r) => s + r.plan.totalReleasable, 0)
  const advanceTotal = rows.reduce((s, r) => s + r.plan.totalAdvance, 0)
  const dueCount = rows.filter(r => r.plan.totalReleasable > 0).length

  const list = useMemo(() => {
    const n = q.trim().toLowerCase()
    return rows
      .filter(r => !onlyDue || r.plan.totalReleasable > 0)
      .filter(r => !n || (r.booking_no || '').toLowerCase().includes(n)
        || r.customer.toLowerCase().includes(n)
        || Object.values(r.brokerNames).some(x => x.toLowerCase().includes(n)))
  }, [rows, q, onlyDue])

  const exportCsv = () => downloadCsv('traditional-release', [
    ['Booking', 'Customer', 'Broker', 'Full price', 'Collected', 'Collected %', 'Slab %', 'Full commission', 'Entitled', 'Already released', 'Releasable now', 'Advance outstanding'],
    ...list.flatMap(r => r.plan.lines.map(l => [
      r.booking_no || '', r.customer, r.brokerNames[l.broker_id] || '',
      r.plan.fullPrice, r.plan.collected, r.plan.collectedPct, r.plan.entitledPct,
      l.fullCommission, l.entitled, l.released, l.releasable, l.advanceOutstanding,
    ])),
  ])

  if (isLoading) return <div className="py-12 text-center text-sm text-gray-400">Working out what is payable…</div>

  return (
    <div className="space-y-3" data-testid="traditional-release">
      {/* The money that is due, first thing, in rupees. */}
      <div className={`rounded-xl border p-4 ${dueTotal > 0 ? 'border-emerald-300 bg-emerald-50' : 'border-gray-200 bg-white'}`}>
        <div className="text-lg font-semibold text-gray-900">
          {dueTotal > 0
            ? <><Secret>{formatINR(dueTotal)}</Secret> ready to release</>
            : 'Nothing is due for release right now'}
        </div>
        <p className="text-xs text-gray-600 mt-1">
          {dueTotal > 0
            ? <>Across <b>{dueCount}</b> booking{dueCount === 1 ? '' : 's'} that have crossed an agreed mark. </>
            : <>Traditional commission is released when the customer's money crosses an agreed mark — not on a monthly cycle. </>}
          Current rule: {slabs.map((s, i) => (
            <span key={i}>{i > 0 && ', '}<b>{s.collectedPct}%</b> collected → <b>{s.releasePct}%</b> of commission</span>
          ))}. Below {slabs[0]?.collectedPct ?? 25}%, nothing.
        </p>
        {advanceTotal > 0 && (
          <p className="mt-2 text-xs bg-amber-50 border border-amber-300 text-amber-900 rounded px-2 py-1.5 inline-flex items-start gap-1.5">
            <AlertTriangle size={12} className="mt-0.5 shrink-0"/>
            <span>
              <b><Secret>{formatINR(advanceTotal)}</Secret></b> has been handed over ahead of what has been earned.
              That is how the rule works — half the commission at a quarter collected — and it comes back
              out of the same brokers' later commission automatically. Shown so it is never a surprise.
            </span>
          </p>
        )}
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400"/>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Booking, customer or broker…"
            className="w-full border border-gray-200 rounded-lg pl-8 pr-3 py-1.5 text-sm"/>
        </div>
        <label className="flex items-center gap-1.5 text-xs text-gray-700 cursor-pointer">
          <input type="checkbox" className="rounded" checked={onlyDue} onChange={e => setOnlyDue(e.target.checked)}/>
          Only what is due now
        </label>
        <span className="text-xs text-gray-500">{list.length} booking{list.length === 1 ? '' : 's'}</span>
        <button onClick={exportCsv} disabled={list.length === 0}
          className="ml-auto inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-40">
          <Download size={13}/>Export
        </button>
      </div>

      {list.length === 0 ? (
        <div className="py-12 text-center text-sm text-gray-500">
          {onlyDue ? 'No traditional booking has crossed its mark yet. Untick the box to see them all.'
                   : 'No traditional booking has a commission set on it.'}
        </div>
      ) : (
        <div className="space-y-2">
          {list.map(r => {
            const p = r.plan
            const isOpen = open === r.id
            return (
              <div key={r.id} className={`rounded-xl border ${p.totalReleasable > 0 ? 'border-emerald-200' : 'border-gray-200'} bg-white overflow-hidden`}>
                <button onClick={() => setOpen(isOpen ? null : r.id)}
                  className="w-full text-left px-4 py-3 hover:bg-gray-50 flex items-center gap-3">
                  <ChevronRight size={14} className={`shrink-0 text-gray-400 transition ${isOpen ? 'rotate-90' : ''}`}/>
                  <div className="min-w-0 flex-1">
                    <div className="font-medium text-gray-900 truncate">
                      {r.customer} <span className="text-[11px] font-mono text-gray-400">{r.booking_no || ''}</span>
                    </div>
                    <div className="text-[11px] text-gray-500">
                      <Secret>{formatINR(p.collected)}</Secret> of <Secret>{formatINR(p.fullPrice)}</Secret> in
                      {' '}· <b>{p.collectedPct}%</b> collected
                      {' '}· unlocks <b>{p.entitledPct}%</b> of commission
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className={`text-sm font-semibold ${p.totalReleasable > 0 ? 'text-emerald-700' : 'text-gray-400'}`}>
                      {p.totalReleasable > 0 ? <Secret>{formatINR(p.totalReleasable)}</Secret> : '—'}
                    </div>
                    <div className="text-[10px] text-gray-400">releasable</div>
                  </div>
                </button>

                {isOpen && (
                  <div className="px-4 pb-3 border-t border-gray-100 pt-2">
                    {p.nextSlab && (
                      <p className="text-[11px] text-gray-600 mb-2">
                        Another <b><Secret>{formatINR(p.nextSlab.shortfall)}</Secret></b> from the customer takes this
                        to <b>{p.nextSlab.collectedPct}%</b>, which releases <b>{p.nextSlab.releasePct}%</b> of the commission.
                      </p>
                    )}
                    <table className="w-full text-[11px]">
                      <thead>
                        <tr className="text-gray-500 text-left">
                          <th className="font-medium pb-1">Who</th>
                          <th className="font-medium pb-1 text-right">Full commission</th>
                          <th className="font-medium pb-1 text-right">Unlocked</th>
                          <th className="font-medium pb-1 text-right">Earned so far</th>
                          <th className="font-medium pb-1 text-right">Already given</th>
                          <th className="font-medium pb-1 text-right">Releasable</th>
                        </tr>
                      </thead>
                      <tbody>
                        {p.lines.map(l => (
                          <tr key={l.broker_id} className="border-t border-gray-100">
                            <td className="py-1 pr-2 text-gray-900">{r.brokerNames[l.broker_id] || '—'}</td>
                            <td className="py-1 text-right font-mono text-gray-600"><Secret>{formatINR(l.fullCommission)}</Secret></td>
                            <td className="py-1 text-right font-mono text-gray-600"><Secret>{formatINR(l.entitled)}</Secret></td>
                            <td className="py-1 text-right font-mono text-gray-500"><Secret>{formatINR(l.credited)}</Secret></td>
                            <td className="py-1 text-right font-mono text-gray-500"><Secret>{formatINR(l.released)}</Secret></td>
                            <td className={`py-1 text-right font-mono font-semibold ${l.releasable > 0 ? 'text-emerald-700' : 'text-gray-400'}`}>
                              {l.releasable > 0 ? <Secret>{formatINR(l.releasable)}</Secret> : '—'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <p className="mt-2 text-[10px] text-gray-500">
                      "Earned so far" is what the engine has credited as the money came in. "Unlocked" is what the
                      agreed rule allows today. The gap between them is the advance, and later instalments close it.
                      {' '}<Link to="/payout-terms" className="text-blue-600 hover:underline">Change the rule</Link>
                    </p>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

/** The booking's own rate as a percentage, however the office typed it. */
function effectivePct(b: any): number {
  const pct = Number(b.traditional_commission_pct)
  if (pct > 0) return pct
  const psy = Number(b.traditional_commission_per_sqyd)
  const size = Number(b.size_sqyd)
  const total = Number(b.total_amount)
  if (psy > 0 && size > 0 && total > 0) return Math.round((psy * size / total) * 100 * 10000) / 10000
  return 0
}
