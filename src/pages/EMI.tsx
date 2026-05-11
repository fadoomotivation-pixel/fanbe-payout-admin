import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/Button.tsx'
import { Input, Select } from '@/components/ui/Input.tsx'
import { Badge } from '@/components/ui/Badge.tsx'
import { Modal } from '@/components/ui/Modal.tsx'
import { formatINR, formatDate } from '@/lib/utils'
import { generateEmiSchedule, type EmiFrequency, type InterestMethod } from '@/lib/emiEngine'
import { Plus, CheckCircle, CalendarDays, TrendingUp, Clock, Info, Trash2, Pencil } from 'lucide-react'
import toast from 'react-hot-toast'

const INSTALLMENT_STATUS_COLORS: Record<string,string> = {
  pending: 'bg-yellow-50 text-yellow-700 border border-yellow-200',
  paid:    'bg-green-50 text-green-700 border border-green-200',
  overdue: 'bg-red-50 text-red-700 border border-red-200',
  waived:  'bg-gray-100 text-gray-500 border border-gray-200',
}

const CALC_EMPTY = { booking_id:'', principal:'', freq:'monthly' as EmiFrequency, n:'12', rate:'0', method:'flat' as InterestMethod, start: new Date().toISOString().slice(0,10) }

export default function EMI() {
  const qc = useQueryClient()
  const [calcOpen, setCalcOpen] = useState(false)
  const [calc, setCalc]         = useState<any>(CALC_EMPTY)
  const [selectedSched, setSelectedSched] = useState<string | null>(null)
  const [editInst, setEditInst] = useState<any | null>(null)
  const [editSched, setEditSched] = useState<any | null>(null)
  const setC = (k: string, v: any) => setCalc((p: any) => ({ ...p, [k]: v }))

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

  const { data: globalInsts = [] } = useQuery({
    queryKey: ['emi_all_insts'],
    queryFn: async () => {
      const { data, error } = await supabase.from('emi_installments').select('id, schedule_id, due_date, amount, status')
      if (error) throw error
      return data
    },
  })

  const { data: bookings = [] } = useQuery({
    queryKey: ['emi_bookings_picker'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('bp_bookings')
        .select('id, booking_no, plot_total_price, booking_amount, bp_customers(name, phone)')
        .order('created_at', { ascending: false })
      if (error) throw error
      return data
    },
  })

  const { data: installments = [], isLoading: instLoading } = useQuery({
    queryKey: ['emi_installments', selectedSched],
    enabled: !!selectedSched,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('emi_installments').select('*').eq('schedule_id', selectedSched!).order('seq', { ascending: true })
      if (error) throw error
      return data.map((i: any) => ({
        ...i,
        computed_status: i.status === 'paid' ? 'paid' : (new Date(i.due_date) < new Date() ? 'overdue' : 'pending'),
      }))
    },
  })

  const saveSchedule = useMutation({
    mutationFn: async () => {
      if (!calc.booking_id || !preview) throw new Error('Booking + principal required')
      const { data, error } = await supabase.from('emi_schedules').insert({
        booking_id: calc.booking_id, frequency: calc.freq, start_date: calc.start,
        num_installments: Number(calc.n), principal: Number(calc.principal),
        interest_rate_pct: Number(calc.rate) || 0, interest_method: calc.method,
        total_payable: preview.totalPayable,
      }).select('id').single()
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
      qc.invalidateQueries({ queryKey: ['emi_all_insts'] })
      toast.success('EMI schedule created')
      setCalcOpen(false); setCalc(CALC_EMPTY); setSelectedSched(id)
    },
    onError: (e: any) => toast.error(e.message),
  })

  const markInstallment = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await supabase.from('emi_installments').update({ status, paid_at: status === 'paid' ? new Date().toISOString() : null }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['emi_installments', selectedSched] }); qc.invalidateQueries({ queryKey: ['emi_all_insts'] }); toast.success('Installment updated') },
    onError: (e: any) => toast.error(e.message),
  })

  const markAllPaid = useMutation({
    mutationFn: async () => {
      const pendingIds = (installments as any[]).filter((i: any) => i.computed_status !== 'paid' && i.computed_status !== 'waived').map((i: any) => i.id)
      if (!pendingIds.length) throw new Error('No pending installments')
      const { error } = await supabase.from('emi_installments').update({ status: 'paid', paid_at: new Date().toISOString() }).in('id', pendingIds)
      if (error) throw error
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['emi_installments', selectedSched] }); qc.invalidateQueries({ queryKey: ['emi_all_insts'] }); toast.success('All installments marked paid') },
    onError: (e: any) => toast.error(e.message),
  })

  const saveInst = useMutation({
    mutationFn: async (payload: any) => {
      const { error } = await supabase.from('emi_installments').update({
        due_date: payload.due_date,
        amount: Number(payload.amount) || 0,
        principal_component: Number(payload.principal_component) || 0,
        interest_component: Number(payload.interest_component) || 0,
        status: payload.status,
      }).eq('id', payload.id)
      if (error) throw error
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['emi_installments', selectedSched] }); qc.invalidateQueries({ queryKey: ['emi_all_insts'] }); toast.success('Instalment updated'); setEditInst(null) },
    onError: (e: any) => toast.error(e.message),
  })

  const deleteInst = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('emi_installments').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['emi_installments', selectedSched] }); qc.invalidateQueries({ queryKey: ['emi_all_insts'] }); toast.success('Instalment deleted') },
    onError: (e: any) => toast.error(e.message),
  })

  const saveSched = useMutation({
    mutationFn: async (payload: any) => {
      const { error } = await supabase.from('emi_schedules').update({
        frequency: payload.frequency,
        start_date: payload.start_date,
        num_installments: Number(payload.num_installments) || 0,
        principal: Number(payload.principal) || 0,
        total_payable: Number(payload.total_payable) || 0,
        interest_rate_pct: Number(payload.interest_rate_pct) || 0,
      }).eq('id', payload.id)
      if (error) throw error
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['emi_schedules'] }); toast.success('Schedule updated'); setEditSched(null) },
    onError: (e: any) => toast.error(e.message),
  })

  const deleteSched = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('emi_schedules').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['emi_schedules'] })
      qc.invalidateQueries({ queryKey: ['emi_all_insts'] })
      toast.success('Schedule deleted')
      setSelectedSched(null)
    },
    onError: (e: any) => toast.error(e.message),
  })

  const activeSched = (schedules as any[]).find((s: any) => s.id === selectedSched)
  const activeBooking = (bookings as any[]).find((b: any) => b.id === calc.booking_id)
  const principalSuggest = activeBooking ? Math.max(0, Number(activeBooking.plot_total_price || 0) - Number(activeBooking.booking_amount || 0)) : 0

  const today = new Date()
  const allOverdue = (globalInsts as any[]).filter((i: any) => i.status !== 'paid' && new Date(i.due_date) < today)
  const allDueSoon = (globalInsts as any[]).filter((i: any) => i.status !== 'paid' && new Date(i.due_date) >= today && (new Date(i.due_date).getTime() - today.getTime()) < 7 * 86400000)
  const overdueAmt = allOverdue.reduce((s: number, i: any) => s + Number(i.amount || 0), 0)

  const paidCount    = (installments as any[]).filter((i: any) => i.computed_status === 'paid').length
  const overdueCount = (installments as any[]).filter((i: any) => i.computed_status === 'overdue').length
  const pendingCount = (installments as any[]).filter((i: any) => i.computed_status === 'pending').length
  const paidAmount   = (installments as any[]).filter((i: any) => i.computed_status === 'paid').reduce((s: number, i: any) => s + Number(i.amount), 0)

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <div>
          <h1 className="text-xl font-bold text-gray-900">EMI Schedule</h1>
          <p className="text-sm text-gray-500">Master view of every booking on an instalment plan</p>
        </div>
        <Button onClick={() => setCalcOpen(true)}><Plus size={14} />New EMI Schedule</Button>
      </div>

      <div className="mb-5 p-3 bg-blue-50 border border-blue-200 rounded-xl text-sm text-blue-900 flex items-start gap-2">
        <Info size={16} className="mt-0.5 shrink-0"/>
        <div>
          <div className="font-semibold">What is this page?</div>
          <div className="text-xs mt-0.5">
            Edit any instalment (due date, amount, status), delete instalments, edit or delete the whole schedule. For a single booking shortcut, use the <b>EMI</b> button in <Link to="/bookings" className="underline">Bookings</Link>.
          </div>
          {(allOverdue.length > 0 || allDueSoon.length > 0) && (
            <div className="mt-2 flex gap-3 text-xs">
              {allOverdue.length > 0 && <span className="px-2 py-0.5 rounded-full bg-red-100 text-red-700 font-semibold">{allOverdue.length} overdue · {formatINR(overdueAmt)}</span>}
              {allDueSoon.length > 0 && <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-semibold">{allDueSoon.length} due in next 7 days</span>}
            </div>
          )}
        </div>
      </div>

      <div className="grid grid-cols-12 gap-6">
        <div className="col-span-4 bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100">
            <span className="text-sm font-semibold text-gray-700">All Schedules ({(schedules as any[]).length})</span>
          </div>
          {schedLoading ? (
            <div className="p-6 text-center text-sm text-gray-400">Loading…</div>
          ) : (schedules as any[]).length === 0 ? (
            <div className="p-6 text-center text-sm text-gray-400">No schedules yet.</div>
          ) : (
            <div className="divide-y divide-gray-50 max-h-[600px] overflow-y-auto">
              {(schedules as any[]).map((s: any) => (
                <button key={s.id} onClick={() => setSelectedSched(s.id)}
                  className={`w-full text-left px-4 py-3 hover:bg-gray-50 transition-colors ${selectedSched === s.id ? 'bg-blue-50 border-l-2 border-blue-500' : ''}`}>
                  <div className="font-medium text-sm text-gray-900">{s.bp_bookings?.booking_no || s.booking_id?.slice(0,8)}</div>
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

        <div className="col-span-8">
          {!selectedSched ? (
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm flex items-center justify-center h-48">
              <p className="text-gray-400 text-sm">Select a schedule on the left to view instalments</p>
            </div>
          ) : (
            <div className="space-y-4">
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

              <div className="flex justify-end gap-2">
                {activeSched && (
                  <Button size="sm" variant="secondary" onClick={() => setEditSched({ ...activeSched })}>
                    <Pencil size={13} />Edit Schedule
                  </Button>
                )}
                <Button size="sm" variant="secondary" onClick={() => markAllPaid.mutate()} loading={markAllPaid.isPending} disabled={pendingCount + overdueCount === 0}>
                  <CheckCircle size={13} />Mark All Paid
                </Button>
                {activeSched && (
                  <Button size="sm" variant="secondary"
                    onClick={() => { if (confirm('Delete this entire EMI schedule and all its instalments? This cannot be undone.')) deleteSched.mutate(activeSched.id) }}
                    loading={deleteSched.isPending}>
                    <Trash2 size={13} />Delete Schedule
                  </Button>
                )}
              </div>

              <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b border-gray-100">
                    <tr>{['#','Due Date','EMI Amount','Principal','Interest','Status','Action'].map(h => (<th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500">{h}</th>))}</tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {instLoading ? (
                      <tr><td colSpan={7} className="text-center py-8 text-gray-400 text-sm">Loading…</td></tr>
                    ) : (installments as any[]).map((i: any) => (
                      <tr key={i.id} className={i.computed_status === 'paid' ? 'opacity-60' : ''}>
                        <td className="px-4 py-3 text-gray-500 text-xs">{i.seq}</td>
                        <td className="px-4 py-3"><span className={`text-sm ${i.computed_status === 'overdue' ? 'text-red-600 font-semibold' : 'text-gray-700'}`}>{formatDate(i.due_date)}</span></td>
                        <td className="px-4 py-3 font-semibold text-gray-900">{formatINR(i.amount)}</td>
                        <td className="px-4 py-3 text-gray-600">{formatINR(i.principal_component)}</td>
                        <td className="px-4 py-3 text-gray-600">{formatINR(i.interest_component)}</td>
                        <td className="px-4 py-3">
                          <Badge label={i.computed_status} className={INSTALLMENT_STATUS_COLORS[i.computed_status] || 'bg-gray-100 text-gray-600'} />
                          {i.paid_at && <div className="text-xs text-gray-400 mt-0.5">{formatDate(i.paid_at)}</div>}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex gap-1 flex-wrap">
                            {i.computed_status !== 'paid' && i.computed_status !== 'waived' ? (
                              <Button size="sm" onClick={() => markInstallment.mutate({ id: i.id, status: 'paid' })} loading={markInstallment.isPending}>
                                <CheckCircle size={12} />Paid
                              </Button>
                            ) : i.computed_status === 'paid' ? (
                              <Button size="sm" variant="ghost" onClick={() => markInstallment.mutate({ id: i.id, status: 'pending' })}>Undo</Button>
                            ) : null}
                            <Button size="sm" variant="ghost" onClick={() => setEditInst({ ...i })}><Pencil size={12} />Edit</Button>
                            <Button size="sm" variant="ghost"
                              onClick={() => { if (confirm(`Delete instalment #${i.seq}?`)) deleteInst.mutate(i.id) }}>
                              <Trash2 size={12} />
                            </Button>
                          </div>
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

      <Modal open={calcOpen} onClose={() => setCalcOpen(false)} title="New EMI Schedule">
        <div className="grid grid-cols-2 gap-4">
          <Select label="Booking" value={calc.booking_id}
            onChange={(e: any) => {
              const id = e.target.value
              setC('booking_id', id)
              const b = (bookings as any[]).find((x: any) => x.id === id)
              if (b) setC('principal', String(Math.max(0, Number(b.plot_total_price || 0) - Number(b.booking_amount || 0))))
            }} className="col-span-2">
            <option value="">Select booking</option>
            {(bookings as any[]).map((b: any) => (
              <option key={b.id} value={b.id}>{b.booking_no} — {b.bp_customers?.name} ({b.bp_customers?.phone})</option>
            ))}
          </Select>
          {activeBooking && (
            <div className="col-span-2 text-xs text-gray-500">
              Principal suggestion: <b className="text-gray-900">{formatINR(principalSuggest)}</b>
            </div>
          )}
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

        {preview && (
          <div className="mt-4">
            <div className="grid grid-cols-3 gap-3 mb-3">
              <div className="bg-gray-50 rounded-lg p-3 text-center"><div className="text-xs text-gray-500">Per Instalment</div><div className="font-bold text-gray-900">{formatINR(preview.installmentAmount)}</div></div>
              <div className="bg-gray-50 rounded-lg p-3 text-center"><div className="text-xs text-gray-500">Total Interest</div><div className="font-bold text-gray-900">{formatINR(preview.totalInterest)}</div></div>
              <div className="bg-green-50 rounded-lg p-3 text-center"><div className="text-xs text-gray-500">Total Payable</div><div className="font-bold text-green-700">{formatINR(preview.totalPayable)}</div></div>
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2 mt-6">
          <Button variant="secondary" onClick={() => setCalcOpen(false)}>Cancel</Button>
          <Button onClick={() => saveSchedule.mutate()} loading={saveSchedule.isPending} disabled={!preview || !calc.booking_id}>Save Schedule</Button>
        </div>
      </Modal>

      <Modal open={!!editInst} onClose={() => setEditInst(null)} title={`Edit Instalment #${editInst?.seq ?? ''}`}>
        {editInst && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Input label="Due Date" type="date" value={editInst.due_date} onChange={(e: any) => setEditInst({ ...editInst, due_date: e.target.value })} />
              <Input label="Amount (₹)" type="number" value={editInst.amount} onChange={(e: any) => setEditInst({ ...editInst, amount: e.target.value })} />
              <Input label="Principal Component (₹)" type="number" value={editInst.principal_component ?? ''} onChange={(e: any) => setEditInst({ ...editInst, principal_component: e.target.value })} />
              <Input label="Interest Component (₹)" type="number" value={editInst.interest_component ?? 0} onChange={(e: any) => setEditInst({ ...editInst, interest_component: e.target.value })} />
              <Select label="Status" value={editInst.status} onChange={(e: any) => setEditInst({ ...editInst, status: e.target.value })}>
                <option value="pending">pending</option>
                <option value="paid">paid</option>
                <option value="waived">waived</option>
              </Select>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" onClick={() => setEditInst(null)}>Cancel</Button>
              <Button onClick={() => saveInst.mutate(editInst)} loading={saveInst.isPending}>Save</Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={!!editSched} onClose={() => setEditSched(null)} title="Edit EMI Schedule">
        {editSched && (
          <div className="space-y-3">
            <div className="text-xs text-gray-500">Changes here apply to the schedule meta only. Edit individual instalments in the rows below.</div>
            <div className="grid grid-cols-2 gap-3">
              <Select label="Frequency" value={editSched.frequency} onChange={(e: any) => setEditSched({ ...editSched, frequency: e.target.value })}>
                {(['monthly','quarterly','half_yearly','annual']).map(f => <option key={f} value={f}>{f.replace(/_/g,' ')}</option>)}
              </Select>
              <Input label="Start Date" type="date" value={editSched.start_date} onChange={(e: any) => setEditSched({ ...editSched, start_date: e.target.value })} />
              <Input label="# Installments" type="number" value={editSched.num_installments} onChange={(e: any) => setEditSched({ ...editSched, num_installments: e.target.value })} />
              <Input label="Interest Rate (%)" type="number" step="0.01" value={editSched.interest_rate_pct ?? 0} onChange={(e: any) => setEditSched({ ...editSched, interest_rate_pct: e.target.value })} />
              <Input label="Principal (₹)" type="number" value={editSched.principal} onChange={(e: any) => setEditSched({ ...editSched, principal: e.target.value })} />
              <Input label="Total Payable (₹)" type="number" value={editSched.total_payable} onChange={(e: any) => setEditSched({ ...editSched, total_payable: e.target.value })} />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" onClick={() => setEditSched(null)}>Cancel</Button>
              <Button onClick={() => saveSched.mutate(editSched)} loading={saveSched.isPending}>Save</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
