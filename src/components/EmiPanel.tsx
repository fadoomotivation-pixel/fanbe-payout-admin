import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/Button.tsx'
import { Input } from '@/components/ui/Input.tsx'
import { Badge } from '@/components/ui/Badge.tsx'
import { formatINR, formatDate } from '@/lib/utils'
import { distributePaymentCommission } from '@/lib/payoutEngine'
import { printPaymentReceipt } from '@/lib/printTemplates'
import { CheckCircle, Calendar, Wallet, AlertTriangle, Plus, X, IndianRupee, ArrowUpRight, ArrowDownRight } from 'lucide-react'
import toast from 'react-hot-toast'

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-yellow-50 text-yellow-700 border border-yellow-200',
  partial: 'bg-blue-50 text-blue-700 border border-blue-200',
  paid:    'bg-green-50 text-green-700 border border-green-200',
  overdue: 'bg-red-50 text-red-700 border border-red-200',
  waived:  'bg-gray-100 text-gray-500 border border-gray-200',
}

export default function EmiPanel({ booking, open, onClose }: { booking: any; open: boolean; onClose: () => void }) {
  const qc = useQueryClient()
  const [creating, setCreating] = useState(false)
  const [n, setN] = useState('12')
  const [freq, setFreq] = useState<'monthly'|'quarterly'|'half_yearly'|'annual'>('monthly')
  const [start, setStart] = useState(new Date().toISOString().slice(0,10))

  // Existing schedule for this booking
  const { data: sched, isLoading: schedLoading } = useQuery({
    queryKey: ['emi_sched_for_booking', booking?.id],
    enabled: !!booking?.id && open,
    queryFn: async () => {
      const { data, error } = await supabase.from('emi_schedules').select('*').eq('booking_id', booking.id).maybeSingle()
      if (error) throw error
      return data
    },
  })

  const { data: insts = [], isLoading: instsLoading } = useQuery({
    queryKey: ['emi_insts_for_booking', sched?.id],
    enabled: !!sched?.id,
    queryFn: async () => {
      const { data, error } = await supabase.from('emi_installments').select('*').eq('schedule_id', sched.id).order('seq', { ascending: true })
      if (error) throw error
      return data.map((i: any) => ({
        ...i,
        computed_status: i.status === 'paid'    ? 'paid'
          : i.status === 'partial'              ? 'partial'
          : new Date(i.due_date) < new Date()   ? 'overdue'
          : 'pending',
      }))
    },
  })

  // EMI instalments are excluded from this sum so re-creating the schedule doesn't compound principal.
  const { data: paidSoFar = 0 } = useQuery({
    queryKey: ['booking_paid_non_emi', booking?.id],
    enabled: !!booking?.id && open,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('bp_payments')
        .select('amount, payment_type')
        .eq('booking_id', booking.id)
        .eq('verification_status', 'verified')
      if (error) throw error
      return (data || [])
        .filter((p: any) => p.payment_type !== 'emi')
        .reduce((s: number, p: any) => s + Number(p.amount || 0), 0)
    },
  })

  const principalSuggest = Math.max(0, Number(booking?.total_amount || 0) - Number(paidSoFar || 0))

  const createSched = useMutation({
    mutationFn: async () => {
      if (!booking?.id) throw new Error('No booking')
      const principal = principalSuggest
      const num = Math.max(1, Number(n) || 1)
      const amt = Math.round(principal / num)
      const { data, error } = await supabase.from('emi_schedules').insert({
        booking_id: booking.id,
        frequency: freq, start_date: start,
        num_installments: num, principal, total_payable: principal,
        interest_rate_pct: 0, interest_method: 'flat',
      }).select('id').single()
      if (error || !data) throw error || new Error('Insert failed')
      const offset = freq === 'monthly' ? 1 : freq === 'quarterly' ? 3 : freq === 'half_yearly' ? 6 : 12
      const startD = new Date(start)
      const rows = Array.from({ length: num }, (_, i) => {
        const d = new Date(startD)
        d.setMonth(d.getMonth() + offset * (i + 1))
        return {
          schedule_id: data.id, seq: i + 1, due_date: d.toISOString().slice(0,10),
          amount: amt, principal_component: amt, interest_component: 0, status: 'pending',
        }
      })
      const { error: e2 } = await supabase.from('emi_installments').insert(rows)
      if (e2) throw e2
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['emi_sched_for_booking', booking.id] }); toast.success('EMI schedule created'); setCreating(false) },
    onError: (e: any) => toast.error(e.message),
  })

  const markPaid = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await supabase.from('emi_installments').update({ status, paid_at: status === 'paid' ? new Date().toISOString() : null }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['emi_insts_for_booking', sched?.id] }),
    onError: (e: any) => toast.error(e.message),
  })

  /**
   * Flexible EMI payment: customer can pay any amount (over, exact, or partial).
   * Walks pending/partial installments in due-date order and applies the payment:
   *  - covers an installment fully → status='paid', paid_amount=amount
   *  - covers part of an installment → status='partial', paid_amount cumulative
   *  - excess after last installment → stored as advance (recorded but unallocated)
   * Inserts ONE bp_payments row for the actual amount, plus per-payment MLM distribution.
   */
  const applyPayment = async ({
    amount, mode = 'cash', date = new Date().toISOString().slice(0,10),
    utr = '', drawnOn = '', branch = '', notes = '',
  }: { amount: number; mode?: string; date?: string; utr?: string; drawnOn?: string; branch?: string; notes?: string }) => {
    const incoming = Number(amount) || 0
    if (incoming <= 0) { toast.error('Enter an amount greater than zero'); return }

    const { data: rn } = await supabase.rpc('next_receipt_no')
    const receipt_no = rn || ''

    // Order: by seq (oldest first). Apply against pending/partial installments.
    const queue = (allInsts as any[])
      .filter(i => i.status !== 'paid')
      .sort((a, b) => (a.seq || 0) - (b.seq || 0))

    const firstSeq = queue[0]?.seq
    const allocations: { id: string; seq: number; alreadyPaid: number; apply: number; willClose: boolean }[] = []
    let remaining = incoming
    for (const inst of queue) {
      if (remaining <= 0) break
      const due = Number(inst.amount) - Number(inst.paid_amount || 0)
      if (due <= 0) continue
      const apply = Math.min(remaining, due)
      allocations.push({ id: inst.id, seq: inst.seq, alreadyPaid: Number(inst.paid_amount || 0), apply, willClose: apply >= due })
      remaining -= apply
    }
    const advance = remaining // unallocated after all instalments are settled
    const closes = allocations.filter(a => a.willClose).length

    // Insert ONE payment row for the full incoming amount
    const { data: payment, error: pErr } = await supabase.from('bp_payments').insert({
      booking_id: booking.id,
      payment_type: 'emi',
      amount: incoming,
      payment_mode: mode,
      payment_date: date,
      verification_status: 'verified',
      verified_at: new Date().toISOString(),
      receipt_no,
      instalment_no: firstSeq || null,
      utr_ref: utr || null,
      drawn_on_bank: drawnOn || (mode === 'cash' ? 'Cash' : null),
      branch: branch || null,
      sponsor_name: booking.upline_broker_code || '',
      is_cash_adjustment: false,
      subject_to_realisation: false,
      notes: notes || `EMI payment · ${closes} closed${advance > 0 ? ` · ₹${advance} advance` : ''}`,
    }).select('*').single()
    if (pErr) { toast.error(pErr.message); return }

    // Update each allocated installment
    for (const a of allocations) {
      const newPaid = a.alreadyPaid + a.apply
      const newStatus = a.willClose ? 'paid' : 'partial'
      const patch: any = { status: newStatus, paid_amount: newPaid }
      if (a.willClose) { patch.paid_at = new Date().toISOString(); patch.payment_id = payment.id }
      await supabase.from('emi_installments').update(patch).eq('id', a.id)
    }

    // Per-payment MLM distribution
    const rows = await distributePaymentCommission({
      bookingId: booking.id,
      paymentId: payment.id,
      amount: incoming,
    })

    qc.invalidateQueries({ queryKey: ['emi_insts_for_booking', sched?.id] })
    qc.invalidateQueries({ queryKey: ['booking_paid_non_emi', booking.id] })
    qc.invalidateQueries({ queryKey: ['commission_ledger'] })
    qc.invalidateQueries({ queryKey: ['payouts'] })

    if (closes > 0 && advance > 0) {
      toast.success(`Receipt #${receipt_no} · ${closes} instalment${closes !== 1 ? 's' : ''} closed · ${formatINR(advance)} advance${rows.length ? ` · MLM × ${rows.length}` : ''} · printing`)
    } else if (closes > 0) {
      toast.success(`Receipt #${receipt_no} · ${closes} instalment${closes !== 1 ? 's' : ''} closed${rows.length ? ` · MLM × ${rows.length}` : ''} · printing`)
    } else if (allocations.length > 0) {
      toast.success(`Receipt #${receipt_no} · partial payment recorded${rows.length ? ` · MLM × ${rows.length}` : ''} · printing`)
    } else {
      toast.success(`Receipt #${receipt_no} · ${formatINR(advance)} advance${rows.length ? ` · MLM × ${rows.length}` : ''} · printing`)
    }

    // Print A4 customer + office receipt
    if (payment) {
      printPaymentReceipt(payment, {
        customer: booking.bp_customers,
        booking,
        project:  booking.bp_projects,
        plot:     booking.bp_plots,
      })
    }
  }

  // Modal-driven flexible-amount entry. Triggered from a single "Record Payment" CTA.
  const [payOpen, setPayOpen] = useState(false)
  const [payForm, setPayForm] = useState<any>({ amount: '', mode: 'cash', date: new Date().toISOString().slice(0,10), utr: '', drawn_on: '', branch: '', notes: '' })
  const openPay = (preset?: number) => { setPayForm({ amount: preset != null ? String(preset) : '', mode: 'cash', date: new Date().toISOString().slice(0,10), utr: '', drawn_on: '', branch: '', notes: '' }); setPayOpen(true) }
  const submitPay = async () => {
    await applyPayment({ amount: Number(payForm.amount), mode: payForm.mode, date: payForm.date, utr: payForm.utr, drawnOn: payForm.drawn_on, branch: payForm.branch, notes: payForm.notes })
    setPayOpen(false)
  }

  // Stats
  const allInsts = insts as any[]
  const paid = allInsts.filter((i: any) => i.computed_status === 'paid')
  const overdue = allInsts.filter((i: any) => i.computed_status === 'overdue')
  const pending = allInsts.filter((i: any) => i.computed_status === 'pending')
  const paidAmount = paid.reduce((s: number, i: any) => s + Number(i.amount), 0)
  const outstanding = allInsts.reduce((s: number, i: any) => s + Number(i.amount), 0) - paidAmount
  const nextDue = pending.concat(overdue).sort((a: any, b: any) => a.due_date.localeCompare(b.due_date))[0]

  useEffect(() => { if (!open) setCreating(false) }, [open])

  // Bottom-sheet transition: keep the panel mounted briefly after close so the slide-down animation can play.
  const [visible, setVisible] = useState(false)
  const [rendered, setRendered] = useState(false)
  useEffect(() => {
    if (open) {
      setRendered(true)
      const id = requestAnimationFrame(() => setVisible(true))
      document.body.style.overflow = 'hidden'
      return () => { cancelAnimationFrame(id); document.body.style.overflow = '' }
    }
    setVisible(false)
    const t = setTimeout(() => setRendered(false), 220)
    return () => clearTimeout(t)
  }, [open])

  const close = () => { setVisible(false); setTimeout(onClose, 200) }

  if (!rendered) return null

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <div
        className={`absolute inset-0 bg-black/50 backdrop-blur-sm transition-opacity duration-200 ${visible ? 'opacity-100' : 'opacity-0'}`}
        onClick={close}
      />
      <div
        className={`relative w-full bg-white rounded-t-3xl shadow-2xl flex flex-col max-h-[90vh] transform transition-transform duration-200 ease-out ${visible ? 'translate-y-0' : 'translate-y-full'}`}
        role="dialog"
        aria-modal="true"
      >
        <div className="flex justify-center pt-2.5 pb-1.5">
          <div className="w-12 h-1.5 bg-gray-300 rounded-full"/>
        </div>
        <div className="flex items-center justify-between px-6 pb-3 border-b border-gray-100">
          <h2 className="text-base font-semibold text-gray-900">EMI Schedule — {booking?.booking_no || ''}</h2>
          <button onClick={close} className="p-1.5 rounded-lg hover:bg-gray-100"><X size={16}/></button>
        </div>
        <div className="overflow-y-auto flex-1 px-6 py-5">
          {schedLoading ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : !sched ? (
        creating ? (
          <div>
            <p className="text-xs text-gray-500 mb-3">No EMI schedule yet. Generating from booking total minus booking amount.</p>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="text-xs text-gray-500">Principal (auto)</label><div className="px-3 py-2 rounded-lg bg-gray-50 text-sm font-semibold">{formatINR(principalSuggest)}</div></div>
              <div><label className="text-xs text-gray-500">Per Instalment (preview)</label><div className="px-3 py-2 rounded-lg bg-green-50 text-sm font-semibold text-green-700">{formatINR(Math.round(principalSuggest / (Number(n) || 1)))}</div></div>
              <Input label="Number of Instalments" type="number" value={n} onChange={(e:any)=>setN(e.target.value)} />
              <div><label className="text-xs text-gray-500">Frequency</label><select value={freq} onChange={e=>setFreq(e.target.value as any)} className="w-full mt-1 border border-gray-200 rounded-lg px-3 py-2 text-sm"><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option><option value="half_yearly">Half-Yearly</option><option value="annual">Annual</option></select></div>
              <Input label="Start Date" type="date" value={start} onChange={(e:any)=>setStart(e.target.value)} />
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <Button variant="secondary" onClick={() => setCreating(false)}>Cancel</Button>
              <Button onClick={() => createSched.mutate()} loading={createSched.isPending} disabled={principalSuggest <= 0}>Create Schedule</Button>
            </div>
          </div>
        ) : (
          <div className="text-center py-8">
            <p className="text-sm text-gray-500 mb-3">No EMI schedule for this booking yet.</p>
            <Button onClick={() => setCreating(true)}><Plus size={14}/>Create EMI Schedule</Button>
          </div>
        )
      ) : (
        <div>
          <div className="grid grid-cols-4 gap-3 mb-4">
            <Stat icon={<Wallet size={14}/>}        label="Total Payable" value={formatINR(sched.total_payable)} />
            <Stat icon={<CheckCircle size={14}/>}    label="Paid"          value={`${paid.length} · ${formatINR(paidAmount)}`} color="text-green-700" />
            <Stat icon={<Calendar size={14}/>}       label="Outstanding"   value={formatINR(outstanding)} color="text-amber-700" />
            <Stat icon={<AlertTriangle size={14}/>}  label="Overdue"       value={`${overdue.length} inst.`} color="text-red-700" />
          </div>
          {nextDue && (
            <div className="mb-3 p-3 bg-blue-50 rounded-lg text-sm text-blue-900 flex items-center justify-between flex-wrap gap-2">
              <div>
                Next due: <b>{formatDate(nextDue.due_date)}</b> · instalment <b>{nextDue.seq}</b> · scheduled <b>{formatINR(nextDue.amount)}</b>
                {Number(nextDue.paid_amount || 0) > 0 && <span className="ml-2 text-blue-700">· {formatINR(nextDue.paid_amount)} paid so far</span>}
              </div>
              <div className="flex gap-2">
                <Button size="sm" variant="secondary" onClick={() => openPay(nextDue.amount - Number(nextDue.paid_amount || 0))}>Pay scheduled</Button>
                <Button size="sm" onClick={() => openPay()}>Record any amount</Button>
              </div>
            </div>
          )}
          <div className="max-h-72 overflow-y-auto border border-gray-100 rounded-lg">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 sticky top-0"><tr>{['#','Due','Scheduled','Paid','Status','Action'].map(h => <th key={h} className="px-3 py-2 text-left text-gray-500">{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-gray-50">
                {instsLoading ? <tr><td colSpan={6} className="px-3 py-4 text-center text-gray-400">Loading…</td></tr>
                : allInsts.map(i => {
                  const paid = Number(i.paid_amount || 0)
                  const due  = Number(i.amount) - paid
                  return (
                    <tr key={i.id} className={i.computed_status === 'paid' ? 'opacity-60' : ''}>
                      <td className="px-3 py-2 text-gray-400">{i.seq}</td>
                      <td className="px-3 py-2"><span className={i.computed_status === 'overdue' ? 'text-red-600 font-semibold' : ''}>{formatDate(i.due_date)}</span></td>
                      <td className="px-3 py-2 font-semibold">{formatINR(i.amount)}</td>
                      <td className="px-3 py-2">
                        {paid > 0 ? <span className="text-blue-700 font-semibold">{formatINR(paid)}{due > 0 && <span className="text-gray-400 font-normal"> / {formatINR(i.amount)}</span>}</span> : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-3 py-2"><Badge label={i.computed_status} className={STATUS_COLORS[i.computed_status]} /></td>
                      <td className="px-3 py-2">
                        {i.computed_status !== 'paid'
                          ? <Button size="sm" onClick={() => openPay(due)}>Record</Button>
                          : <Button size="sm" variant="ghost" onClick={() => markPaid.mutate({ id: i.id, status: 'pending' })}>Undo</Button>}
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
      </div>

      {/* ── Flexible Record Payment Modal ───────────────────────────── */}
      {payOpen && (
        <div className="fixed inset-0 z-[60] flex items-end md:items-center justify-center bg-black/60 px-3" onClick={() => setPayOpen(false)}>
          <div onClick={e => e.stopPropagation()} className="bg-white rounded-2xl max-w-md w-full p-5 space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold">Record EMI payment</h3>
                <p className="text-xs text-gray-500">Enter the actual amount the customer paid. We'll apply it across due instalments in order.</p>
              </div>
              <button onClick={() => setPayOpen(false)} className="text-gray-400 hover:text-gray-700"><X size={16}/></button>
            </div>

            {nextDue && (
              <div className="bg-blue-50 border border-blue-100 rounded-lg p-3 text-xs">
                <div className="flex justify-between mb-1"><span className="text-gray-500">Next instalment scheduled</span><b className="text-blue-800">{formatINR(nextDue.amount)}</b></div>
                <div className="flex justify-between"><span className="text-gray-500">Outstanding (all instalments)</span><b className="text-amber-700">{formatINR(outstanding)}</b></div>
              </div>
            )}

            <div>
              <label className="text-xs font-semibold text-gray-700 mb-1 block">Amount paid (₹)</label>
              <input type="number" autoFocus value={payForm.amount} onChange={e => setPayForm((p: any) => ({ ...p, amount: e.target.value }))}
                placeholder="0" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-blue-400"/>
              {nextDue && Number(payForm.amount) > 0 && (
                <div className="mt-2 text-[11px] flex items-center gap-1">
                  {Number(payForm.amount) > Number(nextDue.amount) - Number(nextDue.paid_amount || 0)
                    ? <span className="text-emerald-700 inline-flex items-center gap-1"><ArrowUpRight size={11}/>Overpaid — excess will roll forward to future instalments / advance</span>
                    : Number(payForm.amount) < Number(nextDue.amount) - Number(nextDue.paid_amount || 0)
                      ? <span className="text-amber-700 inline-flex items-center gap-1"><ArrowDownRight size={11}/>Underpaid — instalment will be marked partial</span>
                      : <span className="text-blue-700 inline-flex items-center gap-1"><IndianRupee size={11}/>Exact scheduled amount</span>}
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-gray-700 mb-1 block">Mode</label>
                <select value={payForm.mode} onChange={e => setPayForm((p: any) => ({ ...p, mode: e.target.value }))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm">
                  {['cash','neft','rtgs','imps','upi','cheque','dd'].map(m => <option key={m} value={m}>{m.toUpperCase()}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-700 mb-1 block">Date</label>
                <input type="date" value={payForm.date} onChange={e => setPayForm((p: any) => ({ ...p, date: e.target.value }))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"/>
              </div>
              <div className="col-span-2">
                <label className="text-xs font-semibold text-gray-700 mb-1 block">UTR / Reference</label>
                <input value={payForm.utr} onChange={e => setPayForm((p: any) => ({ ...p, utr: e.target.value }))} placeholder="paste from bank receipt" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"/>
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-700 mb-1 block">Drawn on (bank)</label>
                <input value={payForm.drawn_on} onChange={e => setPayForm((p: any) => ({ ...p, drawn_on: e.target.value }))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"/>
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-700 mb-1 block">Branch</label>
                <input value={payForm.branch} onChange={e => setPayForm((p: any) => ({ ...p, branch: e.target.value }))} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"/>
              </div>
              <div className="col-span-2">
                <label className="text-xs font-semibold text-gray-700 mb-1 block">Notes</label>
                <input value={payForm.notes} onChange={e => setPayForm((p: any) => ({ ...p, notes: e.target.value }))} placeholder="e.g. customer paid partial due to financial reasons" className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm"/>
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" onClick={() => setPayOpen(false)}>Cancel</Button>
              <Button onClick={submitPay} disabled={!Number(payForm.amount)}>Record &amp; distribute MLM</Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function Stat({ icon, label, value, color = 'text-gray-900' }: any) {
  return (
    <div className="bg-white rounded-lg border border-gray-100 p-2.5">
      <div className="flex items-center gap-1.5 text-gray-400 text-xs mb-0.5">{icon}{label}</div>
      <div className={`font-semibold text-sm ${color}`}>{value}</div>
    </div>
  )
}
