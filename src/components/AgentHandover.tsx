// Handing one agent's customers to another, when the first one leaves.
//
// Manisha: "Sir ek agent switch ka option bhi de dena ... Koi agent chod k chala gya aur
// uska customer hum kisi aur ko assign krke krde."
//
// It could already be done one booking at a time, by opening each one and changing the
// broker. For an agent with thirty customers that is thirty forms, and the office would
// have no idea what it had just done to the commission - which is the part that matters,
// because moving a booking moves money.
//
// WHAT MOVING A BOOKING ACTUALLY DOES. bp_bookings.broker_id has a trigger on it:
// trg_booking_broker_recompute calls recompute_booking_payouts(), which deletes the
// booking's payout rows WHERE cycle_id IS NULL and builds them again for whoever the
// broker now is. So:
//
//   * Money already paid out in a cycle keeps its cycle_id, is never deleted, and stays
//     with the agent who left. Their past is not rewritten.
//   * Money earned but not yet paid out is deleted and re-credited to the new agent.
//   * Every future instalment pays the new agent.
//
// That middle line is somebody's earnings changing hands, so this screen puts the figure
// on the table in rupees before anything is written, instead of leaving it to be
// discovered in the next payout cycle.
//
// THE TRAP THIS SCREEN EXISTS TO AVOID. On a traditional sale with a team split,
// recompute_booking_payouts() pays the bp_booking_brokers rows and ignores
// bp_bookings.broker_id completely. Moving only the booking would look like it worked and
// would still pay the agent who left, on every instalment, forever. So the split row moves
// first - before the booking, because it is the booking's update that fires the recompute,
// and the rows have to already be right when it runs.
//
// UNIQUE (booking_id, broker_id) means the row cannot just be repointed when the new agent
// is already on that booking. The two shares are added together into the row they already
// have and the old row is dropped: the booking pays exactly what it paid before, one
// person now holds both shares. If that sum would pass 100% the booking is held back and
// named, because a sale paying out more than every instalment is a mistake, not a handover.
//
// WHAT THIS DOES NOT DO. It does not move the leaving agent's downline. Their team still
// sits under them in the tree, and re-parenting a whole branch is a separate decision with
// its own consequences for the differential - so it is said plainly here rather than done
// quietly.
import { useState, useMemo, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { Modal } from '@/components/ui/Modal.tsx'
import { formatINR } from '@/lib/utils'
import { Secret } from '@/lib/privacy'
import { fetchAllRows, inChunks } from '@/lib/fetchAll'
import { AlertTriangle, ArrowRight, Users } from 'lucide-react'
import toast from 'react-hot-toast'

type Booking = {
  id: string
  booking_no: string | null
  stage: string | null
  commission_mode: string | null
  total_amount: number | null
  application_date: string | null
  customer_id: string | null
  customer_name: string
  plot_no: string
}

type SplitRow = { id: string; booking_id: string; broker_id: string; commission_pct: number; position: number }

export default function AgentHandover({ open, onClose, from, brokers, onDone }: {
  open: boolean
  onClose: () => void
  /** The agent who is leaving. */
  from: any | null
  /** Every broker, for picking who takes over. */
  brokers: any[]
  onDone: () => void
}) {
  const [toId, setToId] = useState('')
  const [picked, setPicked] = useState<Record<string, boolean>>({})
  const [deactivate, setDeactivate] = useState(true)
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState<{ moved: number; failed: { booking: string; reason: string }[] } | null>(null)

  const fromId = from?.id || ''

  const { data, isLoading } = useQuery({
    queryKey: ['agent_handover', fromId],
    enabled: open && !!fromId,
    queryFn: async () => {
      // Live work only. A cancelled sale earns nobody anything — recompute returns early
      // on it — so moving one would be noise in the list and a no-op in the books.
      const rows = await fetchAllRows((f, t) => supabase
        .from('bp_bookings')
        .select('id, booking_no, stage, commission_mode, total_amount, application_date, customer_id, bp_customers(name), bp_plots(plot_no)')
        .eq('broker_id', fromId).neq('stage', 'cancelled')
        .order('id').range(f, t))

      const bookings: Booking[] = (rows as any[]).map(r => ({
        id: r.id, booking_no: r.booking_no, stage: r.stage,
        commission_mode: r.commission_mode, total_amount: r.total_amount,
        application_date: r.application_date, customer_id: r.customer_id,
        customer_name: r.bp_customers?.name || '—',
        plot_no: r.bp_plots?.plot_no || '',
      }))

      const ids = bookings.map(b => b.id)
      // EVERY split row on those bookings, not just this agent's — the rows belonging to
      // whoever takes over are what decide if a merge is needed.
      const splits = ids.length
        ? await inChunks<SplitRow>(ids, chunk => supabase
            .from('bp_booking_brokers')
            .select('id, booking_id, broker_id, commission_pct, position')
            .in('booking_id', chunk))
        : []

      // Split by whether a payout cycle has already taken it out of reach.
      const pay = await fetchAllRows((f, t) => supabase
        .from('payout_distributions')
        .select('booking_id, net_payout, cycle_id')
        .eq('beneficiary_broker_id', fromId)
        .order('id').range(f, t))

      const paidByBooking: Record<string, number> = {}
      const unpaidByBooking: Record<string, number> = {}
      for (const p of pay as any[]) {
        const bucket = p.cycle_id ? paidByBooking : unpaidByBooking
        bucket[p.booking_id] = (bucket[p.booking_id] || 0) + Number(p.net_payout || 0)
      }

      const downline = (brokers || []).filter((b: any) => b.sponsor_id === fromId)
      return { bookings, splits, paidByBooking, unpaidByBooking, downline }
    },
  })

  const bookings = data?.bookings || []
  const splits = data?.splits || []

  // Everything ticked when the list arrives: an agent who left is normally handing over
  // all of it, and unticking the odd one is less work than ticking thirty.
  useEffect(() => {
    if (!open) return
    setPicked(Object.fromEntries(bookings.map(b => [b.id, true])))
    setResult(null)
  }, [open, bookings.length, fromId])

  useEffect(() => { if (!open) { setToId(''); setResult(null) } }, [open])

  const to = brokers.find((b: any) => b.id === toId)

  /** Only the same kind of broker. The two trees are kept apart everywhere else, and a
   *  cross-type move would hand a traditional deal to someone paid off the rank ladder. */
  const candidates = useMemo(() => {
    const type = from?.broker_type || 'mlm'
    return brokers
      .filter((b: any) => b.id !== fromId)
      .filter((b: any) => (b.broker_type || 'mlm') === type)
      .filter((b: any) => (b.status || 'active') === 'active')
      .sort((a: any, b: any) => String(a.name || '').localeCompare(String(b.name || '')))
  }, [brokers, fromId, from?.broker_type])

  const chosen = bookings.filter(b => picked[b.id])

  /** What each chosen booking needs doing to its split rows, and what would go wrong. */
  const plan = useMemo(() => {
    const byBooking: Record<string, SplitRow[]> = {}
    for (const s of splits) (byBooking[s.booking_id] ||= []).push(s)

    const moves: { booking: Booking; mine?: SplitRow; theirs?: SplitRow; merged?: number }[] = []
    const blocked: { booking: Booking; reason: string }[] = []

    for (const b of chosen) {
      const rows = byBooking[b.id] || []
      const mine = rows.find(r => r.broker_id === fromId)
      const theirs = toId ? rows.find(r => r.broker_id === toId) : undefined
      if (mine && theirs) {
        const merged = Math.round((Number(mine.commission_pct) + Number(theirs.commission_pct)) * 10000) / 10000
        if (merged > 100) {
          blocked.push({ booking: b, reason: `their two shares add to ${merged}% — over 100% of each payment` })
          continue
        }
        moves.push({ booking: b, mine, theirs, merged })
      } else {
        moves.push({ booking: b, mine })
      }
    }
    return { moves, blocked, mergeCount: moves.filter(m => m.theirs).length }
  }, [chosen, splits, fromId, toId])

  const money = useMemo(() => {
    let stays = 0, movesOver = 0
    for (const b of chosen) {
      stays += data?.paidByBooking?.[b.id] || 0
      movesOver += data?.unpaidByBooking?.[b.id] || 0
    }
    return { stays, movesOver }
  }, [chosen, data])

  const run = async () => {
    if (!toId || plan.moves.length === 0) return
    setRunning(true)
    const failed: { booking: string; reason: string }[] = []
    let moved = 0

    for (const m of plan.moves) {
      const label = m.booking.booking_no || m.booking.customer_name
      try {
        // Split rows FIRST. The booking's own update is what fires the recompute, so the
        // rows have to be pointing at the new agent before that happens — otherwise the
        // engine re-credits the agent who left and the handover silently does nothing.
        if (m.mine && m.theirs) {
          const { error: e1 } = await supabase.from('bp_booking_brokers')
            .update({ commission_pct: m.merged }).eq('id', m.theirs.id)
          if (e1) throw e1
          const { error: e2 } = await supabase.from('bp_booking_brokers').delete().eq('id', m.mine.id)
          if (e2) throw e2
        } else if (m.mine) {
          const { error } = await supabase.from('bp_booking_brokers')
            .update({ broker_id: toId }).eq('id', m.mine.id)
          if (error) throw error
        }

        const { error } = await supabase.from('bp_bookings')
          .update({ broker_id: toId }).eq('id', m.booking.id)
        if (error) throw error
        moved++
      } catch (e: any) {
        failed.push({ booking: label, reason: e?.message || 'Could not move this booking' })
      }
    }

    // Only once the work is done, and only if it all landed: an agent still holding
    // bookings should not be filed as gone.
    if (deactivate && failed.length === 0 && moved > 0) {
      const { error } = await supabase.from('brokers').update({ status: 'inactive' }).eq('id', fromId)
      if (error) failed.push({ booking: from?.name || 'the agent', reason: `Bookings moved, but could not mark them inactive: ${error.message}` })
    }

    setRunning(false)
    setResult({ moved, failed })
    if (moved > 0) {
      onDone()
      toast.success(`${moved} booking${moved === 1 ? '' : 's'} handed over to ${to?.name || 'the new agent'}`)
    }
    if (failed.length > 0) toast.error(`${failed.length} could not be moved`)
  }

  if (!from) return null

  return (
    <Modal open={open} onClose={onClose} title={`Hand over ${from.name || 'this agent'}'s customers`} size="lg">
      <div className="space-y-3" data-testid="agent-handover">
        <p className="text-sm text-gray-600">
          Use this when an agent leaves. Their customers move to whoever takes over, and so does
          the commission that has not been paid out yet.
        </p>

        {isLoading && <div className="py-8 text-center text-sm text-gray-400">Loading their customers…</div>}

        {!isLoading && bookings.length === 0 && (
          <div className="py-8 text-center text-sm text-gray-500">
            {from.name} has no live bookings — there is nothing to hand over.
          </div>
        )}

        {!isLoading && bookings.length > 0 && (
          <>
            {/* Who takes over */}
            <div className="rounded-lg border border-gray-200 p-3">
              <div className="flex items-center gap-2 text-sm">
                <span className="font-medium text-gray-900">{from.name}</span>
                <span className="text-[11px] font-mono text-gray-400">[{from.broker_id || '—'}]</span>
                <ArrowRight size={14} className="text-gray-400 shrink-0"/>
                <select
                  value={toId}
                  onChange={e => setToId(e.target.value)}
                  data-testid="handover-to"
                  className="flex-1 border border-gray-300 rounded-lg px-2 py-1.5 text-sm"
                >
                  <option value="">— who takes over? —</option>
                  {candidates.map((b: any) => (
                    <option key={b.id} value={b.id}>{b.name} [{b.broker_id}]</option>
                  ))}
                </select>
              </div>
              <p className="mt-1.5 text-[11px] text-gray-500">
                Only active {(from.broker_type || 'mlm') === 'traditional' ? 'Traditional' : 'Affiliate'} agents are
                listed — the two trees are kept separate, and the database refuses a cross-type move anyway.
              </p>
            </div>

            {/* The money, before anything is written. */}
            <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-3 text-xs" data-testid="handover-money">
              <div className="font-semibold text-amber-900 mb-1.5">What happens to the commission</div>
              <div className="space-y-1">
                <div className="flex justify-between">
                  <span>Already paid out in a cycle — stays with {from.name}</span>
                  <b><Secret>{formatINR(money.stays)}</Secret></b>
                </div>
                <div className="flex justify-between text-amber-900">
                  <span>Earned but not yet paid out — moves to {to?.name || 'the new agent'}</span>
                  <b><Secret>{formatINR(money.movesOver)}</Secret></b>
                </div>
                <div className="flex justify-between text-gray-600">
                  <span>Every future instalment</span>
                  <b>{to?.name || 'the new agent'}</b>
                </div>
              </div>
              {money.movesOver > 0 && (
                <p className="mt-1.5 text-[11px] text-amber-800">
                  That middle figure is money {from.name} has earned and not been paid. Moving these
                  bookings hands it to {to?.name || 'the new agent'}. Settle it in a payout cycle first if
                  it should stay with {from.name}.
                </p>
              )}
            </div>

            {plan.mergeCount > 0 && (
              <div className="rounded-lg border border-blue-200 bg-blue-50 p-2.5 text-[11px] text-blue-900">
                On {plan.mergeCount} booking{plan.mergeCount === 1 ? '' : 's'} {to?.name} is already on the team.
                Their two shares are added together, so the booking pays exactly what it pays now — one person
                just holds both.
              </div>
            )}

            {plan.blocked.length > 0 && (
              <div className="rounded-lg border border-rose-200 bg-rose-50 p-2.5 text-[11px] text-rose-900">
                <div className="font-semibold flex items-center gap-1 mb-1"><AlertTriangle size={12}/>Held back</div>
                {plan.blocked.map(b => (
                  <div key={b.booking.id}>{b.booking.booking_no || b.booking.customer_name} — {b.reason}</div>
                ))}
                <div className="mt-1">Fix the split on these from the booking itself.</div>
              </div>
            )}

            {(data?.downline?.length || 0) > 0 && (
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-2.5 text-[11px] text-gray-700 flex items-start gap-1.5">
                <Users size={12} className="mt-0.5 shrink-0 text-gray-400"/>
                <span>
                  {from.name} still has {data!.downline.length} broker{data!.downline.length === 1 ? '' : 's'} under
                  them in the tree ({data!.downline.map((d: any) => d.name).join(', ')}). This screen does not move a
                  team — change their sponsor on each one if the whole branch should move.
                </span>
              </div>
            )}

            {/* What moves */}
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-semibold text-gray-700">
                  {chosen.length} of {bookings.length} booking{bookings.length === 1 ? '' : 's'} selected
                </span>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setPicked(Object.fromEntries(bookings.map(b => [b.id, true])))}
                    className="text-[11px] text-blue-700 hover:underline">Select all</button>
                  <button type="button" onClick={() => setPicked({})}
                    className="text-[11px] text-gray-500 hover:underline">Clear</button>
                </div>
              </div>
              <div className="border border-gray-200 rounded-lg divide-y divide-gray-100 max-h-56 overflow-y-auto">
                {bookings.map(b => (
                  <label key={b.id} className="flex items-center gap-2 px-2.5 py-1.5 text-xs cursor-pointer hover:bg-gray-50">
                    <input type="checkbox" className="rounded" checked={!!picked[b.id]}
                      onChange={e => setPicked(p => ({ ...p, [b.id]: e.target.checked }))}/>
                    <span className="font-mono text-[10px] text-gray-400 w-16 shrink-0">{b.booking_no || '—'}</span>
                    <span className="flex-1 truncate text-gray-900">{b.customer_name}</span>
                    {b.plot_no && <span className="text-[10px] text-gray-400 shrink-0">Plot {b.plot_no}</span>}
                    <span className="text-[10px] text-gray-500 shrink-0 w-20 text-right">
                      <Secret>{formatINR(Number(b.total_amount || 0))}</Secret>
                    </span>
                  </label>
                ))}
              </div>
            </div>

            <label className="flex items-center gap-2 text-xs text-gray-700 cursor-pointer">
              <input type="checkbox" className="rounded" checked={deactivate}
                onChange={e => setDeactivate(e.target.checked)}/>
              Mark {from.name} inactive once this is done — they stop appearing in the pickers, and what
              they have already been paid is kept.
            </label>

            {result && (
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-2.5 text-xs" data-testid="handover-result">
                <b>{result.moved}</b> booking{result.moved === 1 ? '' : 's'} moved to {to?.name}.
                {result.failed.length > 0 && (
                  <div className="mt-1 text-rose-700">
                    {result.failed.map((f, i) => <div key={i}>{f.booking}: {f.reason}</div>)}
                  </div>
                )}
              </div>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={onClose}
                className="text-sm px-3 py-2 rounded-lg bg-white border border-gray-300 text-gray-700 hover:bg-gray-50">
                {result ? 'Close' : 'Cancel'}
              </button>
              {!result && (
                <button type="button" onClick={run} disabled={!toId || plan.moves.length === 0 || running}
                  data-testid="handover-run"
                  className="text-sm font-medium px-3 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:bg-gray-200 disabled:text-gray-400">
                  {running ? 'Moving…' : `Hand over ${plan.moves.length} booking${plan.moves.length === 1 ? '' : 's'}`}
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}
