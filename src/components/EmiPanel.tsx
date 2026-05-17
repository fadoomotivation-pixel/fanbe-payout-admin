import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/Button.tsx'
import { Input } from '@/components/ui/Input.tsx'
import { Badge } from '@/components/ui/Badge.tsx'
import { formatINR, formatDate } from '@/lib/utils'
import { CheckCircle, Calendar, Wallet, AlertTriangle, Plus, X } from 'lucide-react'
import toast from 'react-hot-toast'

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-yellow-50 text-yellow-700 border border-yellow-200',
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
        computed_status: i.status === 'paid' ? 'paid'
          : new Date(i.due_date) < new Date() ? 'overdue'
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

  const recordPayment = async (inst: any) => {
    if (!confirm(`Record payment of ${formatINR(inst.amount)} for instalment ${inst.seq}?`)) return
    const { data: rn } = await supabase.rpc('next_receipt_no')
    const receipt_no = rn || ''
    const today = new Date().toISOString().slice(0, 10)
    const { error } = await supabase.from('bp_payments').insert({
      booking_id: booking.id,
      payment_type: 'emi',
      amount: inst.amount,
      payment_mode: 'cash',
      payment_date: today,
      verification_status: 'verified',
      verified_at: new Date().toISOString(),
      receipt_no,
      instalment_no: inst.seq,
      drawn_on_bank: 'Cash',
      branch: '',
      sponsor_name: booking.upline_broker_code || '',
      is_cash_adjustment: false,
      subject_to_realisation: false,
      notes: `EMI inst ${inst.seq} — booking ${booking.booking_no || ''}`,
    })
    if (error) { toast.error(error.message); return }
    await markPaid.mutateAsync({ id: inst.id, status: 'paid' })
    toast.success(`Receipt #${receipt_no} created · instalment ${inst.seq} marked paid`)
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
            <div className="mb-3 p-3 bg-blue-50 rounded-lg text-sm text-blue-900 flex items-center justify-between">
              <div>Next due: <b>{formatDate(nextDue.due_date)}</b> · instalment <b>{nextDue.seq}</b> · <b>{formatINR(nextDue.amount)}</b></div>
              <Button size="sm" onClick={() => recordPayment(nextDue)}>Record Payment</Button>
            </div>
          )}
          <div className="max-h-72 overflow-y-auto border border-gray-100 rounded-lg">
            <table className="w-full text-xs">
              <thead className="bg-gray-50 sticky top-0"><tr>{['#','Due','Amount','Status','Action'].map(h => <th key={h} className="px-3 py-2 text-left text-gray-500">{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-gray-50">
                {instsLoading ? <tr><td colSpan={5} className="px-3 py-4 text-center text-gray-400">Loading…</td></tr>
                : allInsts.map(i => (
                  <tr key={i.id} className={i.computed_status === 'paid' ? 'opacity-60' : ''}>
                    <td className="px-3 py-2 text-gray-400">{i.seq}</td>
                    <td className="px-3 py-2"><span className={i.computed_status === 'overdue' ? 'text-red-600 font-semibold' : ''}>{formatDate(i.due_date)}</span></td>
                    <td className="px-3 py-2 font-semibold">{formatINR(i.amount)}</td>
                    <td className="px-3 py-2"><Badge label={i.computed_status} className={STATUS_COLORS[i.computed_status]} /></td>
                    <td className="px-3 py-2">
                      {i.computed_status !== 'paid'
                        ? <Button size="sm" onClick={() => recordPayment(i)}>Record</Button>
                        : <Button size="sm" variant="ghost" onClick={() => markPaid.mutate({ id: i.id, status: 'pending' })}>Undo</Button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
          )}
        </div>
      </div>
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
