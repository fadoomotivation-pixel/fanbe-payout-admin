import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/Button.tsx'
import { Input, Select } from '@/components/ui/Input.tsx'
import { Badge } from '@/components/ui/Badge.tsx'
import { Modal } from '@/components/ui/Modal.tsx'
import { formatINR, formatDate } from '@/lib/utils'
import { generateEmiSchedule, type EmiFrequency, type InterestMethod } from '@/lib/emiEngine'
import { Plus, CheckCircle, CalendarDays, TrendingUp, Clock } from 'lucide-react'
import toast from 'react-hot-toast'

const INSTALLMENT_STATUS_COLORS: Record<string,string> = {
  pending:    'bg-yellow-50 text-yellow-700 border border-yellow-200',
  paid:       'bg-green-50 text-green-700 border border-green-200',
  overdue:    'bg-red-50 text-red-700 border border-red-200',
  waived:     'bg-gray-100 text-gray-500 border border-gray-200',
}

const CALC_EMPTY = { booking_id:'', principal:'', freq:'monthly' as EmiFrequency, n:'12', rate:'0', method:'flat' as InterestMethod, start: new Date().toISOString().slice(0,10) }

export default function EMI() {
  const qc = useQueryClient()
  const [calcOpen, setCalcOpen] = useState(false)
  const [calc, setCalc]         = useState<any>(CALC_EMPTY)
  const [selectedSched, setSelectedSched] = useState<string | null>(null)
  const setC = (k: string, v: any) => setCalc((p: any) => ({ ...p, [k]: v }))

  // Preview schedule
  const preview = calc.principal && Number(calc.principal) > 0
    ? generateEmiSchedule({
        principal: Number(calc.principal),
        numInstallments: Number(calc.n) || 1,
        startDate: calc.start,
        frequency: calc.freq,
        interestRatePct: Number(calc.rate) || 0,
        interestMethod: calc.method,
      })
    : null

  // All schedules
  const { data: schedules = [], isLoading: schedLoading } = useQuery({
    queryKey: ['emi_schedules'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('emi_schedules')
        .select('*,bp_bookings(booking_no,bp_customers(name))')
        .order('created_at', { ascending: false })
      if (error) throw error
      return data
    },
  })

  // Installments for selected schedule
  const { data: installments = [], isLoading: instLoading } = useQuery({
    queryKey: ['emi_installments', selectedSched],
    enabled: !!selectedSched,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('emi_installments')
        .select('*')
        .eq('schedule_id', selectedSched!)
        .order('seq', { ascending: true })
      if (error) throw error
      // Auto-mark overdue
      return data.map((i: any) => ({
        ...i,
        computed_status: i.status || (new Date(i.due_date) < new Date() && i.status !== 'paid' ? 'overdue' : 'pending'),
      }))
    },
  })

  // Save new schedule
  const saveSchedule = useMutation({
    mutationFn: async () => {
      if (!calc.booking_id || !preview) throw new Error('Booking ID + principal required')
      const { data, error } = await supabase
        .from('emi_schedules')
        .insert({
          booking_id: calc.booking_id,
          frequency: calc.freq,
          start_date: calc.start,
          num_installments: Number(calc.n),
          principal: Number(calc.principal),
          interest_rate_pct: Number(calc.rate) || 0,
          interest_method: calc.method,
          total_payable: preview.totalPayable,
        })
        .select('id').single()
      if (error || !data) throw error || new Error('Insert failed')
      const rows = preview.installments.map((i: any) => ({
        schedule_id: data.id, seq: i.seq, due_date: i.dueDate,
        amount: i.amount, principal_component: i.principalComponent,
        interest_component: i.interestComponent, status: 'pending',
      }))
      const { error: e2 } = await supabase.from('emi_installments').insert(rows)
      if (e2) throw e2
      return data.id
    },
    onSuccess: (id) => {
      qc.invalidateQueries({ queryKey: ['emi_schedules'] })
      toast.success('EMI schedule created')
      setCalcOpen(false)
      setCalc(CALC_EMPTY)
      setSelectedSched(id)
    },
    onError: (e: any) => toast.error(e.message),
  })

  // Mark installment paid / pending
  const markInstallment = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await supabase
        .from('emi_installments')
        .update({ status, paid_at: status === 'paid' ? new Date().toISOString() : null })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['emi_installments', selectedSched] }); toast.success('Installment updated') },
    onError: (e: any) => toast.error(e.message),
  })

  // Bulk mark all pending as paid
  const markAllPaid = useMutation({
    mutationFn: async () => {
      const pendingIds = (installments as any[]).filter((i: any) => i.computed_status !== 'paid' && i.computed_status !== 'waived').map((i: any) => i.id)
      if (!pendingIds.length) throw new Error('No pending installments')
      const { error } = await supabase
        .from('emi_installments')
        .update({ status: 'paid', paid_at: new Date().toISOString() })
        .in('id', pendingIds)
      if (error) throw error
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['emi_installments', selectedSched] }); toast.success('All installments marked paid') },
    onError: (e: any) => toast.error(e.message),
  })

  // Selected schedule object
  const activeSched = (schedules as any[]).find((s: any) => s.id === selectedSched)

  // Stats for active schedule
  const paidCount    = (installments as any[]).filter((i: any) => i.computed_status === 'paid').length
  const overdueCount = (installments as any[]).filter((i: any) => i.computed_status === 'overdue').length
  const pendingCount = (installments as any[]).filter((i: any) => i.computed_status === 'pending').length
  const paidAmount   = (installments as any[]).filter((i: any) => i.computed_status === 'paid').reduce((s: number, i: any) => s + Number(i.amount), 0)

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900">EMI Schedules</h1>
          <p className="text-sm text-gray-500">Manage instalment plans per booking</p>
        </div>
        <Button onClick={() => setCalcOpen(true)}><Plus size={14} />New EMI Schedule</Button>
      </div>

      <div className="grid grid-cols-12 gap-6">
        {/* Left: Schedule list */}
        <div className="col-span-4 bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100">
            <span className="text-sm font-semibold text-gray-700">All Schedules ({(schedules as any[]).length})</span>
          </div>
          {schedLoading ? (
            <div className="p-6 text-center text-sm text-gray-400">Loading…</div>
          ) : (schedules as any[]).length === 0 ? (
            <div className="p-6 text-center text-sm text-gray-400">No schedules yet</div>
          ) : (
            <div className="divide-y divide-gray-50 max-h-[600px] overflow-y-auto">
              {(schedules as any[]).map((s: any) => (
                <button
                  key={s.id}
                  onClick={() => setSelectedSched(s.id)}
                  className={`w-full text-left px-4 py-3 hover:bg-gray-50 transition-colors ${
                    selectedSched === s.id ? 'bg-blue-50 border-l-2 border-blue-500' : ''
                  }`}
                >
                  <div className="font-medium text-sm text-gray-900">
                    {s.bp_bookings?.booking_no || s.booking_id?.slice(0,8)}
                  </div>
                  <div className="text-xs text-gray-500">{s.bp_bookings?.bp_customers?.name}</div>
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-xs font-semibold text-green-700">{formatINR(s.total_payable)}</span>
                    <span className="text-xs text-gray-400">· {s.num_installments} inst. · {s.frequency}</span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Right: Installment detail */}
        <div className="col-span-8">
          {!selectedSched ? (
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm flex items-center justify-center h-48">
              <p className="text-gray-400 text-sm">Select a schedule to view installments</p>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Schedule summary */}
              {activeSched && (
                <div className="grid grid-cols-4 gap-3">
                  {[
                    { icon: <TrendingUp size={16}/>, label: 'Total Payable', value: formatINR(activeSched.total_payable), color: 'text-gray-900' },
                    { icon: <CheckCircle size={16}/>, label: 'Paid', value: `${paidCount} inst. · ${formatINR(paidAmount)}`, color: 'text-green-700' },
                    { icon: <Clock size={16}/>, label: 'Pending', value: `${pendingCount} inst.`, color: 'text-yellow-700' },
                    { icon: <CalendarDays size={16}/>, label: 'Overdue', value: `${overdueCount} inst.`, color: 'text-red-700' },
                  ].map(s => (
                    <div key={s.label} className="bg-white rounded-xl border border-gray-100 p-3 shadow-sm">
                      <div className="flex items-center gap-2 text-gray-400 mb-1">{s.icon}<span className="text-xs">{s.label}</span></div>
                      <div className={`font-semibold text-sm ${s.color}`}>{s.value}</div>
                    </div>
                  ))}
                </div>
              )}

              {/* Bulk action */}
              <div className="flex justify-end">
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => markAllPaid.mutate()}
                  loading={markAllPaid.isPending}
                  disabled={pendingCount + overdueCount === 0}
                >
                  <CheckCircle size={13} />Mark All Paid
                </Button>
              </div>

              {/* Installment table */}
              <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b border-gray-100">
                    <tr>
                      {['#','Due Date','EMI Amount','Principal','Interest','Status','Action'].map(h => (
                        <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {instLoading ? (
                      <tr><td colSpan={7} className="text-center py-8 text-gray-400 text-sm">Loading…</td></tr>
                    ) : (installments as any[]).map((i: any) => (
                      <tr key={i.id} className={i.computed_status === 'paid' ? 'opacity-60' : ''}>
                        <td className="px-4 py-3 text-gray-500 text-xs">{i.seq}</td>
                        <td className="px-4 py-3">
                          <span className={`text-sm ${i.computed_status === 'overdue' ? 'text-red-600 font-semibold' : 'text-gray-700'}`}>
                            {formatDate(i.due_date)}
                          </span>
                        </td>
                        <td className="px-4 py-3 font-semibold text-gray-900">{formatINR(i.amount)}</td>
                        <td className="px-4 py-3 text-gray-600">{formatINR(i.principal_component)}</td>
                        <td className="px-4 py-3 text-gray-600">{formatINR(i.interest_component)}</td>
                        <td className="px-4 py-3">
                          <Badge
                            label={i.computed_status}
                            className={INSTALLMENT_STATUS_COLORS[i.computed_status] || 'bg-gray-100 text-gray-600'}
                          />
                          {i.paid_at && <div className="text-xs text-gray-400 mt-0.5">{formatDate(i.paid_at)}</div>}
                        </td>
                        <td className="px-4 py-3">
                          {i.computed_status !== 'paid' && i.computed_status !== 'waived' ? (
                            <Button
                              size="sm"
                              onClick={() => markInstallment.mutate({ id: i.id, status: 'paid' })}
                              loading={markInstallment.isPending}
                            >
                              <CheckCircle size={12} />Mark Paid
                            </Button>
                          ) : i.computed_status === 'paid' ? (
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => markInstallment.mutate({ id: i.id, status: 'pending' })}
                            >
                              Undo
                            </Button>
                          ) : null}
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

      {/* New Schedule Modal */}
      <Modal open={calcOpen} onClose={() => setCalcOpen(false)} title="New EMI Schedule">
        <div className="grid grid-cols-2 gap-4">
          <Input label="Booking ID" value={calc.booking_id} onChange={(e: any) => setC('booking_id', e.target.value)} className="col-span-2" placeholder="Paste booking UUID" />
          <Input label="Principal (₹)" type="number" value={calc.principal} onChange={(e: any) => setC('principal', e.target.value)} />
          <Input label="# Installments" type="number" value={calc.n} onChange={(e: any) => setC('n', e.target.value)} />
          <Select label="Frequency" value={calc.freq} onChange={(e: any) => setC('freq', e.target.value)}>
            {(['monthly','quarterly','half_yearly','annual'] as EmiFrequency[]).map(f => <option key={f} value={f}>{f.replace(/_/g,' ')}</option>)}
          </Select>
          <Input label="Interest Rate (%)" type="number" step="0.01" value={calc.rate} onChange={(e: any) => setC('rate', e.target.value)} />
          <Select label="Interest Method" value={calc.method} onChange={(e: any) => setC('method', e.target.value)}>
            <option value="flat">Flat Rate</option>
            <option value="reducing">Reducing Balance</option>
          </Select>
          <Input label="Start Date" type="date" value={calc.start} onChange={(e: any) => setC('start', e.target.value)} />
        </div>

        {/* Live preview */}
        {preview && (
          <div className="mt-4">
            <div className="grid grid-cols-3 gap-3 mb-3">
              <div className="bg-gray-50 rounded-lg p-3 text-center">
                <div className="text-xs text-gray-500">Per Instalment</div>
                <div className="font-bold text-gray-900">{formatINR(preview.installmentAmount)}</div>
              </div>
              <div className="bg-gray-50 rounded-lg p-3 text-center">
                <div className="text-xs text-gray-500">Total Interest</div>
                <div className="font-bold text-gray-900">{formatINR(preview.totalInterest)}</div>
              </div>
              <div className="bg-green-50 rounded-lg p-3 text-center">
                <div className="text-xs text-gray-500">Total Payable</div>
                <div className="font-bold text-green-700">{formatINR(preview.totalPayable)}</div>
              </div>
            </div>
            <div className="max-h-52 overflow-y-auto border border-gray-100 rounded-lg">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 sticky top-0">
                  <tr>{['#','Due Date','EMI','Principal','Interest'].map(h => <th key={h} className="px-3 py-2 text-left text-gray-500">{h}</th>)}</tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {preview.installments.map((i: any) => (
                    <tr key={i.seq}>
                      <td className="px-3 py-2 text-gray-400">{i.seq}</td>
                      <td className="px-3 py-2">{i.dueDate}</td>
                      <td className="px-3 py-2 font-semibold">{formatINR(i.amount)}</td>
                      <td className="px-3 py-2 text-gray-600">{formatINR(i.principalComponent)}</td>
                      <td className="px-3 py-2 text-gray-600">{formatINR(i.interestComponent)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2 mt-6">
          <Button variant="secondary" onClick={() => setCalcOpen(false)}>Cancel</Button>
          <Button onClick={() => saveSchedule.mutate()} loading={saveSchedule.isPending} disabled={!preview}>
            Save Schedule
          </Button>
        </div>
      </Modal>
    </div>
  )
}
