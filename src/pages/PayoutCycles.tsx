import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { Table } from '@/components/ui/Table.tsx'
import { Button } from '@/components/ui/Button.tsx'
import { Badge } from '@/components/ui/Badge.tsx'
import { formatINR, formatDate } from '@/lib/utils'
import { loadPayoutConfig, type PayoutConfig } from '@/lib/payoutEngine'
import { logClosure, getCurrentUserId, monthRange } from '@/lib/closure'
import { ClosureDialog } from '@/components/ClosureDialog'
import { CalendarRange, Lock, Unlock, TrendingUp, Users, IndianRupee, Banknote } from 'lucide-react'
import toast from 'react-hot-toast'

const STATUS_COLORS: Record<string, string> = {
  open:     'bg-amber-50 text-amber-700 border border-amber-200',
  closed:   'bg-slate-100 text-slate-800 border border-slate-300',
  settled:  'bg-emerald-50 text-emerald-700 border border-emerald-200',
  reopened: 'bg-blue-50 text-blue-700 border border-blue-200',
}

type CommissionRow = {
  booking_id: string
  broker_id: string | null
  broker_name: string
  broker_code: string
  total_amount: number
  commission_amount: number
  application_date: string | null
  closed_at: string | null
}

export default function PayoutCycles() {
  const qc = useQueryClient()
  const [closureFor, setClosureFor] = useState<{ cycle: any; action: 'close' | 'reopen' } | null>(null)
  const [showPreview, setShowPreview] = useState(false)

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

  // Current month's eligible bookings (closed bookings with commission, not yet attached to any cycle)
  const currentMonth = useMemo(() => monthRange(new Date()), [])

  const { data: pendingCommissions = [] } = useQuery<CommissionRow[]>({
    queryKey: ['cycle_pending_commissions', currentMonth.start, currentMonth.end],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('bp_bookings')
        .select('id, broker_id, commission_amount, total_amount, application_date, closed_at, stage, brokers(name, broker_id)')
        .eq('stage', 'booking_done')
        .gte('application_date', currentMonth.start)
        .lte('application_date', currentMonth.end)
      if (error) throw error
      return (data || []).map((b: any) => ({
        booking_id:        b.id,
        broker_id:         b.broker_id,
        broker_name:       b.brokers?.name || '—',
        broker_code:       b.brokers?.broker_id || '—',
        total_amount:      Number(b.total_amount || 0),
        commission_amount: Number(b.commission_amount || 0),
        application_date:  b.application_date,
        closed_at:         b.closed_at,
      }))
    },
  })

  // Aggregate per broker for the close-period preview.
  const perBroker = useMemo(() => {
    const map = new Map<string, { broker_id: string; broker_name: string; broker_code: string; gross: number; bookings: number }>()
    for (const r of pendingCommissions) {
      if (!r.broker_id || r.commission_amount <= 0) continue
      const cur = map.get(r.broker_id) || { broker_id: r.broker_id, broker_name: r.broker_name, broker_code: r.broker_code, gross: 0, bookings: 0 }
      cur.gross += r.commission_amount
      cur.bookings += 1
      map.set(r.broker_id, cur)
    }
    return Array.from(map.values()).sort((a, b) => b.gross - a.gross)
  }, [pendingCommissions])

  const totals = useMemo(() => {
    const gross = perBroker.reduce((s, r) => s + r.gross, 0)
    const tds   = Math.round(gross * tdsPct / 100)
    const admin = Math.round(gross * adminPct / 100)
    return { gross, tds, admin, net: Math.max(0, gross - tds - admin), brokers: perBroker.length, bookings: pendingCommissions.length }
  }, [perBroker, pendingCommissions.length, tdsPct, adminPct])

  const openCycle = (cycles as any[]).find(c => c.status === 'open' || c.status === 'reopened')

  const closeCycle = useMutation({
    mutationFn: async ({ reason }: { reason: string }) => {
      if (perBroker.length === 0) throw new Error('Nothing to close — no eligible commissions in this period')
      const userId = await getCurrentUserId()

      // Upsert cycle row
      const { data: cycle, error: cErr } = await supabase
        .from('payout_cycles')
        .upsert({
          period_label:    currentMonth.label,
          period_start:    currentMonth.start,
          period_end:      currentMonth.end,
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
        }, { onConflict: 'period_start,period_end' })
        .select()
        .single()
      if (cErr || !cycle) throw cErr || new Error('Failed to create cycle')

      // Generate one payout transaction per broker
      const tx = perBroker.map(b => {
        const tds   = Math.round(b.gross * tdsPct / 100)
        const admin = Math.round(b.gross * adminPct / 100)
        const net   = Math.max(0, b.gross - tds - admin)
        return {
          broker_id:      b.broker_id,
          cycle_id:       cycle.id,
          payout_type:    'cycle',
          amount:         b.gross,
          tds_amount:     tds,
          admin_charge:   admin,
          net_amount:     net,
          status:         'pending',
          notes:          `Cycle ${currentMonth.label} — ${b.bookings} booking${b.bookings !== 1 ? 's' : ''}`,
        }
      })
      if (tx.length > 0) {
        const { error: txErr } = await supabase.from('bp_payout_transactions').insert(tx)
        if (txErr) throw txErr
      }

      await logClosure({
        entityType: 'cycle',
        entityId:   cycle.id,
        action:     'closed',
        reason,
        metadata: { period: currentMonth.label, brokers: totals.brokers, gross: totals.gross, net: totals.net },
      })
      return cycle
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['payout_cycles'] })
      qc.invalidateQueries({ queryKey: ['cycle_pending_commissions'] })
      qc.invalidateQueries({ queryKey: ['payouts'] })
      toast.success('Payout cycle closed and batch generated')
      setClosureFor(null)
      setShowPreview(false)
    },
    onError: (e: any) => toast.error(e.message),
  })

  const reopenCycle = useMutation({
    mutationFn: async ({ cycle, reason }: { cycle: any; reason: string }) => {
      if (!reason) throw new Error('Reopen reason is required')
      const userId = await getCurrentUserId()

      // Delete pending transactions for this cycle so the period can be reclosed cleanly
      await supabase.from('bp_payout_transactions').delete().eq('cycle_id', cycle.id).eq('status', 'pending')

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
      qc.invalidateQueries({ queryKey: ['payouts'] })
      toast.success('Cycle reopened — pending payouts cleared')
      setClosureFor(null)
    },
    onError: (e: any) => toast.error(e.message),
  })

  const cols = [
    { header: 'Period', render: (r: any) => (
      <div>
        <div className="font-semibold">{r.period_label}</div>
        <div className="text-[11px] text-gray-400">{formatDate(r.period_start)} → {formatDate(r.period_end)}</div>
      </div>
    )},
    { header: 'Bookings', render: (r: any) => <span className="text-sm">{r.total_bookings || 0}</span> },
    { header: 'Brokers',  render: (r: any) => <span className="text-sm">{r.total_brokers || 0}</span> },
    { header: 'Gross',    render: (r: any) => <span className="font-semibold">{formatINR(r.total_gross)}</span> },
    { header: 'TDS',      render: (r: any) => <span className="text-rose-700">{formatINR(r.total_tds)}</span> },
    { header: 'Admin',    render: (r: any) => <span className="text-amber-700">{formatINR(r.total_admin)}</span> },
    { header: 'Net Payable', render: (r: any) => <span className="font-bold text-emerald-700">{formatINR(r.total_net)}</span> },
    { header: 'Status',   render: (r: any) => <Badge label={r.status} className={STATUS_COLORS[r.status] || 'bg-gray-100 text-gray-700'} /> },
    { header: 'Closed', render: (r: any) => r.closed_at ? <span className="text-xs text-gray-500">{formatDate(r.closed_at)}</span> : <span className="text-xs text-gray-300">—</span> },
    { header: '', render: (r: any) => {
      if (r.status === 'closed' || r.status === 'settled') {
        return <Button size="sm" variant="secondary" onClick={() => setClosureFor({ cycle: r, action: 'reopen' })}><Unlock size={12}/>Reopen</Button>
      }
      return null
    }},
  ]

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
        <div className="flex items-start justify-between mb-4">
          <div>
            <div className="text-xs font-semibold text-indigo-600 uppercase tracking-wider mb-1">Current Open Period</div>
            <div className="text-lg font-bold text-gray-900">{currentMonth.label}</div>
            <div className="text-xs text-gray-500">{formatDate(currentMonth.start)} → {formatDate(currentMonth.end)}</div>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => setShowPreview(s => !s)}>{showPreview ? 'Hide preview' : 'Preview totals'}</Button>
            <Button onClick={() => setClosureFor({ cycle: { ...currentMonth }, action: 'close' })} disabled={totals.bookings === 0}>
              <Lock size={14}/>Close period
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
          <Stat icon={<TrendingUp size={14}/>}   label="Eligible bookings" value={String(totals.bookings)} />
          <Stat icon={<Users size={14}/>}        label="Brokers"           value={String(totals.brokers)} />
          <Stat icon={<IndianRupee size={14}/>}  label="Gross commission"  value={formatINR(totals.gross)} accent="text-gray-900" />
          <Stat icon={<IndianRupee size={14}/>}  label={`TDS (${tdsPct}%)`} value={formatINR(totals.tds)} accent="text-rose-700" />
          <Stat icon={<IndianRupee size={14}/>}  label={`Admin (${adminPct}%)`} value={formatINR(totals.admin)} accent="text-amber-700" />
          <Stat icon={<Banknote size={14}/>}     label="Net payable"       value={formatINR(totals.net)} accent="text-emerald-700" />
        </div>

        {totals.bookings === 0 && (
          <div className="mt-4 text-xs text-gray-500">No bookings with commission in this period yet. Mark bookings as <b>Booking Done</b> and assign a broker so they're picked up here.</div>
        )}

        {showPreview && perBroker.length > 0 && (
          <div className="mt-4 bg-white rounded-xl border border-indigo-100 overflow-hidden">
            <div className="px-4 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide border-b border-gray-100">Per-broker breakdown ({perBroker.length})</div>
            <div className="max-h-72 overflow-y-auto">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 sticky top-0">
                  <tr>{['Broker','Code','Bookings','Gross','TDS','Admin','Net'].map(h => <th key={h} className="px-3 py-2 text-left text-gray-500 font-semibold">{h}</th>)}</tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {perBroker.map(b => {
                    const tds   = Math.round(b.gross * tdsPct / 100)
                    const admin = Math.round(b.gross * adminPct / 100)
                    const net   = Math.max(0, b.gross - tds - admin)
                    return (
                      <tr key={b.broker_id}>
                        <td className="px-3 py-2 font-medium">{b.broker_name}</td>
                        <td className="px-3 py-2 font-mono text-gray-500">{b.broker_code}</td>
                        <td className="px-3 py-2">{b.bookings}</td>
                        <td className="px-3 py-2 font-semibold">{formatINR(b.gross)}</td>
                        <td className="px-3 py-2 text-rose-700">{formatINR(tds)}</td>
                        <td className="px-3 py-2 text-amber-700">{formatINR(admin)}</td>
                        <td className="px-3 py-2 font-bold text-emerald-700">{formatINR(net)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm">
        <div className="px-4 py-3 border-b border-gray-100 text-sm font-semibold text-gray-700">Closed cycles</div>
        <Table columns={cols} data={cycles} loading={isLoading} />
      </div>

      <ClosureDialog
        open={!!closureFor}
        action={closureFor?.action === 'reopen' ? 'reopen' : 'close'}
        entityLabel={`payout cycle ${closureFor?.cycle?.period_label || ''}`}
        description={
          closureFor?.action === 'close'
            ? `Closing freezes commissions earned in ${currentMonth.label}. A pending payout transaction will be generated for each of the ${totals.brokers} broker${totals.brokers !== 1 ? 's' : ''} with TDS + admin deducted (Net: ${formatINR(totals.net)}).`
            : 'Reopening clears all pending transactions generated by this cycle close. Brokers will see their wallets reset to pre-close state.'
        }
        warning={closureFor?.action === 'close' && openCycle ? `Previous "open" cycle ${openCycle.period_label} still exists. Closing this period creates a new closed cycle for ${currentMonth.label}.` : undefined}
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
