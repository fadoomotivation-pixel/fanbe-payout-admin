import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { formatINR, formatDate } from '@/lib/utils'
import { Modal } from '@/components/ui/Modal.tsx'
import toast from 'react-hot-toast'
import {
  CalendarDays, Plus, Pencil, Trash2, CheckCircle2,
  AlertTriangle, Clock, Search, RefreshCw, ChevronDown
} from 'lucide-react'

const FREQUENCIES = [
  { value: 'monthly', label: 'Monthly' },
  { value: 'quarterly', label: 'Quarterly' },
  { value: 'half_yearly', label: 'Half Yearly' },
  { value: 'annually', label: 'Annually' },
]

const STATUS_COLORS = {
  pending:    'bg-yellow-100 text-yellow-800',
  paid:       'bg-green-100  text-green-800',
  overdue:    'bg-red-100    text-red-800',
  waived:     'bg-slate-100  text-slate-600',
  bounced:    'bg-orange-100 text-orange-800',
}

const EMPTY_PLAN = {
  booking_id: '',
  frequency: 'monthly',
  installment_count: 12,
  installment_amount: '',
  interest_rate: 0,
  start_date: new Date().toISOString().split('T')[0],
  late_fee_per_day: 0,
  bounce_charge: 500,
  notes: '',
}

function addMonths(dateStr, months) {
  const d = new Date(dateStr)
  d.setMonth(d.getMonth() + months)
  return d.toISOString().split('T')[0]
}

function getIntervalMonths(freq) {
  return { monthly: 1, quarterly: 3, half_yearly: 6, annually: 12 }[freq] ?? 1
}

function generateSchedule(plan) {
  const rows = []
  const interval = getIntervalMonths(plan.frequency)
  for (let i = 0; i < plan.installment_count; i++) {
    const due_date = addMonths(plan.start_date, i * interval)
    const principal = Number(plan.installment_amount)
    const interest = +(principal * (plan.interest_rate / 100)).toFixed(2)
    rows.push({
      installment_no: i + 1,
      due_date,
      principal_amount: principal,
      interest_amount: interest,
      total_due: principal + interest,
      late_fee_per_day: Number(plan.late_fee_per_day) || 0,
      bounce_charge: Number(plan.bounce_charge) || 0,
      status: 'pending',
    })
  }
  return rows
}

export default function EmiSchedule() {
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [selectedBooking, setSelectedBooking] = useState(null)
  const [createOpen, setCreateOpen] = useState(false)
  const [plan, setPlan] = useState(EMPTY_PLAN)
  const [preview, setPreview] = useState([])
  const [markOpen, setMarkOpen] = useState(false)
  const [markRow, setMarkRow] = useState(null)
  const [markStatus, setMarkStatus] = useState('paid')
  const [markRef, setMarkRef] = useState('')
  const [markBounce, setMarkBounce] = useState(false)
  const [expandedBooking, setExpandedBooking] = useState(null)

  // ── Queries ───────────────────────────────────────────────────────────────
  const { data: bookings = [] } = useQuery({
    queryKey: ['emi_bookings'],
    queryFn: async () => {
      const { data } = await supabase
        .from('bp_bookings')
        .select('id, booking_no, bp_customers(name, phone), plot_total_price, total_collected')
        .order('created_at', { ascending: false })
      return data ?? []
    },
  })

  const { data: plans = [], isLoading, refetch } = useQuery({
    queryKey: ['emi_plans'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('bp_emi_plans')
        .select('*, bp_bookings(booking_no, bp_customers(name, phone))')
        .order('created_at', { ascending: false })
      if (error) throw error
      return data ?? []
    },
  })

  const { data: schedules = [] } = useQuery({
    queryKey: ['emi_schedules', expandedBooking],
    enabled: !!expandedBooking,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('bp_emi_schedule')
        .select('*')
        .eq('plan_id', expandedBooking)
        .order('installment_no', { ascending: true })
      if (error) throw error
      return data ?? []
    },
  })

  // ── Stats ─────────────────────────────────────────────────────────────────
  const { data: stats } = useQuery({
    queryKey: ['emi_stats'],
    queryFn: async () => {
      const today = new Date().toISOString().split('T')[0]
      const { data } = await supabase
        .from('bp_emi_schedule')
        .select('status, total_due, due_date')
      if (!data) return {}
      return {
        total:    data.length,
        pending:  data.filter(r => r.status === 'pending').length,
        paid:     data.filter(r => r.status === 'paid').length,
        overdue:  data.filter(r => r.status === 'pending' && r.due_date < today).length,
        dueAmt:   data.filter(r => r.status === 'pending').reduce((s, r) => s + Number(r.total_due), 0),
      }
    },
  })

  // ── Create Plan Mutation ──────────────────────────────────────────────────
  const createMutation = useMutation({
    mutationFn: async () => {
      // 1. Insert plan
      const { data: newPlan, error: pErr } = await supabase
        .from('bp_emi_plans')
        .insert({
          booking_id:         plan.booking_id,
          frequency:          plan.frequency,
          installment_count:  Number(plan.installment_count),
          installment_amount: Number(plan.installment_amount),
          interest_rate:      Number(plan.interest_rate),
          start_date:         plan.start_date,
          late_fee_per_day:   Number(plan.late_fee_per_day),
          bounce_charge:      Number(plan.bounce_charge),
          notes:              plan.notes,
          total_amount:       Number(plan.installment_amount) * Number(plan.installment_count),
        })
        .select()
        .single()
      if (pErr) throw pErr

      // 2. Insert schedule rows
      const rows = generateSchedule(plan).map(r => ({ ...r, plan_id: newPlan.id, booking_id: plan.booking_id }))
      const { error: sErr } = await supabase.from('bp_emi_schedule').insert(rows)
      if (sErr) throw sErr
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['emi_plans'] })
      qc.invalidateQueries({ queryKey: ['emi_stats'] })
      toast.success('EMI plan created & schedule generated')
      setCreateOpen(false)
      setPlan(EMPTY_PLAN)
      setPreview([])
    },
    onError: (e) => toast.error(e.message),
  })

  // ── Mark Installment Mutation ─────────────────────────────────────────────
  const markMutation = useMutation({
    mutationFn: async () => {
      const now = new Date().toISOString()
      const today = now.split('T')[0]
      const dueDate = markRow.due_date
      const daysLate = dueDate < today
        ? Math.floor((Date.now() - new Date(dueDate).getTime()) / 86400000)
        : 0
      const lateFee = daysLate * (markRow.late_fee_per_day || 0)
      const bounce = markBounce ? (markRow.bounce_charge || 0) : 0

      const { error } = await supabase
        .from('bp_emi_schedule')
        .update({
          status:            markStatus,
          paid_date:         markStatus === 'paid' ? today : null,
          payment_reference: markRef,
          days_late:         daysLate,
          late_fee_charged:  lateFee,
          bounce_charge_applied: bounce,
          updated_at:        now,
        })
        .eq('id', markRow.id)
      if (error) throw error

      // Log activity
      await supabase.from('bp_booking_activity').insert({
        booking_id: markRow.booking_id,
        action:     'emi_' + markStatus,
        description: `EMI #${markRow.installment_no} marked ${markStatus}. Ref: ${markRef || 'N/A'}. Late fee: ${formatINR(lateFee)}.`,
      })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['emi_schedules', expandedBooking] })
      qc.invalidateQueries({ queryKey: ['emi_stats'] })
      toast.success('Installment updated')
      setMarkOpen(false)
      setMarkRow(null)
      setMarkRef('')
      setMarkBounce(false)
    },
    onError: (e) => toast.error(e.message),
  })

  // ── Handlers ──────────────────────────────────────────────────────────────
  function handlePreview() {
    if (!plan.installment_amount || !plan.installment_count) return
    setPreview(generateSchedule(plan))
  }

  const filtered = plans.filter(p => {
    const q = search.toLowerCase()
    return (
      !q ||
      p.bp_bookings?.booking_no?.toLowerCase().includes(q) ||
      p.bp_bookings?.bp_customers?.name?.toLowerCase().includes(q)
    )
  })

  const today = new Date().toISOString().split('T')[0]

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5">

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="page-title flex items-center gap-2">
            <CalendarDays size={20} className="text-teal-600" /> EMI Schedule Engine
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">Configure installment plans and track collections</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => refetch()} className="btn-secondary text-sm"><RefreshCw size={14} /> Refresh</button>
          <button onClick={() => setCreateOpen(true)} className="btn-primary text-sm"><Plus size={14} /> New EMI Plan</button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          { label: 'Total Installments', value: stats?.total ?? 0, cls: 'text-slate-700' },
          { label: 'Pending',  value: stats?.pending ?? 0,  cls: 'text-yellow-600' },
          { label: 'Paid',     value: stats?.paid ?? 0,     cls: 'text-green-700' },
          { label: 'Overdue',  value: stats?.overdue ?? 0,  cls: 'text-red-600' },
          { label: 'Due Amount', value: formatINR(stats?.dueAmt ?? 0), cls: 'text-teal-700' },
        ].map(s => (
          <div key={s.label} className="card p-4">
            <p className="text-xs text-slate-400 mb-1">{s.label}</p>
            <p className={`text-xl font-bold ${s.cls}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Plans Table */}
      <div className="card p-0 overflow-hidden">
        <div className="flex items-center gap-3 p-4 border-b border-slate-100">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              className="input pl-9 text-sm"
              placeholder="Search by booking no or customer name…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
        </div>

        {isLoading ? (
          <div className="p-10 text-center text-slate-400 text-sm">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="p-14 text-center">
            <CalendarDays size={38} className="text-slate-200 mx-auto mb-3" />
            <p className="text-slate-500 text-sm">No EMI plans yet. Create one to get started.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  {['Customer','Booking','Frequency','Installments','Per EMI','Interest','Start Date','Total','Actions'].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-slate-500 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(row => (
                  <>
                    <tr key={row.id} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-800">{row.bp_bookings?.bp_customers?.name}</div>
                        <div className="text-xs text-slate-400">{row.bp_bookings?.bp_customers?.phone}</div>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-teal-700 font-semibold">{row.bp_bookings?.booking_no}</td>
                      <td className="px-4 py-3">
                        <span className="capitalize text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded-full">
                          {row.frequency?.replace('_', ' ')}
                        </span>
                      </td>
                      <td className="px-4 py-3 tabular-nums">{row.installment_count}</td>
                      <td className="px-4 py-3 font-semibold text-slate-700">{formatINR(row.installment_amount)}</td>
                      <td className="px-4 py-3 tabular-nums">{row.interest_rate ?? 0}%</td>
                      <td className="px-4 py-3 text-slate-500 text-xs">{formatDate(row.start_date)}</td>
                      <td className="px-4 py-3 font-semibold text-green-700">{formatINR(row.total_amount)}</td>
                      <td className="px-4 py-3">
                        <button
                          onClick={() => setExpandedBooking(expandedBooking === row.id ? null : row.id)}
                          className="flex items-center gap-1 text-xs text-teal-700 hover:text-teal-900 font-medium"
                        >
                          <ChevronDown size={13} className={expandedBooking === row.id ? 'rotate-180 transition-transform' : 'transition-transform'} />
                          {expandedBooking === row.id ? 'Collapse' : 'View Schedule'}
                        </button>
                      </td>
                    </tr>

                    {/* Inline Schedule Drawer */}
                    {expandedBooking === row.id && (
                      <tr key={row.id + '_schedule'}>
                        <td colSpan={9} className="bg-slate-50 px-6 py-4">
                          <div className="overflow-x-auto rounded-lg border border-slate-200">
                            <table className="w-full text-xs">
                              <thead>
                                <tr className="bg-white border-b border-slate-200">
                                  {['#','Due Date','Principal','Interest','Total Due','Late Fee/Day','Bounce','Status','Ref','Action'].map(h => (
                                    <th key={h} className="text-left px-3 py-2 text-slate-500 font-semibold whitespace-nowrap">{h}</th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {schedules.map(s => {
                                  const isOverdue = s.status === 'pending' && s.due_date < today
                                  return (
                                    <tr key={s.id} className={`border-b border-slate-100 ${isOverdue ? 'bg-red-50/40' : 'bg-white'}`}>
                                      <td className="px-3 py-2 font-semibold text-slate-700">{s.installment_no}</td>
                                      <td className={`px-3 py-2 ${isOverdue ? 'text-red-600 font-semibold' : 'text-slate-600'}`}>{formatDate(s.due_date)}</td>
                                      <td className="px-3 py-2">{formatINR(s.principal_amount)}</td>
                                      <td className="px-3 py-2 text-blue-600">{formatINR(s.interest_amount)}</td>
                                      <td className="px-3 py-2 font-semibold">{formatINR(s.total_due)}</td>
                                      <td className="px-3 py-2 text-slate-500">{formatINR(s.late_fee_per_day)}</td>
                                      <td className="px-3 py-2 text-slate-500">{formatINR(s.bounce_charge)}</td>
                                      <td className="px-3 py-2">
                                        <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold capitalize ${STATUS_COLORS[s.status] || ''}${ isOverdue && s.status === 'pending' ? ' ring-1 ring-red-300' : ''}`}>
                                          {isOverdue && s.status === 'pending' ? 'overdue' : s.status}
                                        </span>
                                      </td>
                                      <td className="px-3 py-2 font-mono text-slate-400">{s.payment_reference || '—'}</td>
                                      <td className="px-3 py-2">
                                        {s.status !== 'paid' && s.status !== 'waived' && (
                                          <button
                                            onClick={() => { setMarkRow(s); setMarkStatus('paid'); setMarkOpen(true) }}
                                            className="text-xs text-teal-700 hover:text-teal-900 font-medium flex items-center gap-1"
                                          >
                                            <CheckCircle2 size={12} /> Mark
                                          </button>
                                        )}
                                      </td>
                                    </tr>
                                  )
                                })}
                              </tbody>
                            </table>
                          </div>
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── CREATE PLAN MODAL ── */}
      <Modal open={createOpen} onClose={() => { setCreateOpen(false); setPlan(EMPTY_PLAN); setPreview([]) }} title="Create EMI Plan" size="lg">
        <div className="space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <label className="label">Booking *</label>
              <select className="input mt-1" value={plan.booking_id} onChange={e => setPlan(p => ({ ...p, booking_id: e.target.value }))}>
                <option value="">Select Booking</option>
                {bookings.map(b => (
                  <option key={b.id} value={b.id}>{b.booking_no} — {b.bp_customers?.name}</option>
                ))}
              </select>
            </div>

            <div>
              <label className="label">Frequency *</label>
              <select className="input mt-1" value={plan.frequency} onChange={e => setPlan(p => ({ ...p, frequency: e.target.value }))}>
                {FREQUENCIES.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
              </select>
            </div>

            <div>
              <label className="label">No. of Installments *</label>
              <input type="number" min={1} max={360} className="input mt-1" value={plan.installment_count}
                onChange={e => setPlan(p => ({ ...p, installment_count: e.target.value }))} />
            </div>

            <div>
              <label className="label">Per Installment Amount (₹) *</label>
              <input type="number" min={0} className="input mt-1" value={plan.installment_amount}
                onChange={e => setPlan(p => ({ ...p, installment_amount: e.target.value }))} />
            </div>

            <div>
              <label className="label">Interest Rate (% per installment)</label>
              <input type="number" min={0} step={0.1} className="input mt-1" value={plan.interest_rate}
                onChange={e => setPlan(p => ({ ...p, interest_rate: e.target.value }))} />
            </div>

            <div>
              <label className="label">Start Date *</label>
              <input type="date" className="input mt-1" value={plan.start_date}
                onChange={e => setPlan(p => ({ ...p, start_date: e.target.value }))} />
            </div>

            <div>
              <label className="label">Late Fee per Day (₹)</label>
              <input type="number" min={0} className="input mt-1" value={plan.late_fee_per_day}
                onChange={e => setPlan(p => ({ ...p, late_fee_per_day: e.target.value }))} />
            </div>

            <div>
              <label className="label">Bounce Charge (₹)</label>
              <input type="number" min={0} className="input mt-1" value={plan.bounce_charge}
                onChange={e => setPlan(p => ({ ...p, bounce_charge: e.target.value }))} />
            </div>

            <div className="sm:col-span-2">
              <label className="label">Notes</label>
              <textarea className="input mt-1" rows={2} value={plan.notes}
                onChange={e => setPlan(p => ({ ...p, notes: e.target.value }))} />
            </div>
          </div>

          {/* Preview */}
          {plan.installment_amount && plan.installment_count && (
            <div>
              <button type="button" onClick={handlePreview} className="btn-secondary text-xs">
                <CalendarDays size={13} /> Preview Schedule
              </button>
            </div>
          )}

          {preview.length > 0 && (
            <div className="max-h-56 overflow-y-auto rounded-lg border border-slate-200">
              <table className="w-full text-xs">
                <thead className="bg-slate-50 sticky top-0">
                  <tr>
                    {['#','Due Date','Principal','Interest','Total Due'].map(h => (
                      <th key={h} className="text-left px-3 py-2 text-slate-500 font-semibold">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.map(r => (
                    <tr key={r.installment_no} className="border-t border-slate-100">
                      <td className="px-3 py-1.5 font-semibold">{r.installment_no}</td>
                      <td className="px-3 py-1.5 text-slate-600">{formatDate(r.due_date)}</td>
                      <td className="px-3 py-1.5">{formatINR(r.principal_amount)}</td>
                      <td className="px-3 py-1.5 text-blue-600">{formatINR(r.interest_amount)}</td>
                      <td className="px-3 py-1.5 font-semibold">{formatINR(r.total_due)}</td>
                    </tr>
                  ))}
                  <tr className="bg-slate-50 border-t-2 border-slate-300">
                    <td colSpan={4} className="px-3 py-2 font-semibold text-right text-slate-700">Grand Total</td>
                    <td className="px-3 py-2 font-bold text-green-700">{formatINR(preview.reduce((s, r) => s + r.total_due, 0))}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          )}

          <div className="flex justify-end gap-2">
            <button className="btn-secondary" onClick={() => { setCreateOpen(false); setPlan(EMPTY_PLAN); setPreview([]) }}>Cancel</button>
            <button
              className="btn-primary"
              disabled={!plan.booking_id || !plan.installment_amount || !plan.installment_count || createMutation.isPending}
              onClick={() => createMutation.mutate()}
            >
              {createMutation.isPending ? 'Creating…' : 'Create Plan & Generate Schedule'}
            </button>
          </div>
        </div>
      </Modal>

      {/* ── MARK INSTALLMENT MODAL ── */}
      <Modal open={markOpen} onClose={() => { setMarkOpen(false); setMarkRow(null); setMarkRef('') }} title={`Mark Installment #${markRow?.installment_no}`} size="sm">
        {markRow && (
          <div className="space-y-4">
            <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-sm space-y-1">
              <div className="flex justify-between">
                <span className="text-slate-500">Due Date</span>
                <span className={markRow.due_date < today ? 'text-red-600 font-semibold' : 'font-medium'}>{formatDate(markRow.due_date)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Total Due</span>
                <span className="font-bold text-slate-800">{formatINR(markRow.total_due)}</span>
              </div>
              {markRow.due_date < today && (
                <div className="flex justify-between text-red-600">
                  <span>Days Late</span>
                  <span className="font-semibold">{Math.floor((Date.now() - new Date(markRow.due_date).getTime()) / 86400000)} days</span>
                </div>
              )}
            </div>

            <div>
              <label className="label">Update Status</label>
              <select className="input mt-1" value={markStatus} onChange={e => setMarkStatus(e.target.value)}>
                <option value="paid">Paid</option>
                <option value="waived">Waived</option>
                <option value="bounced">Bounced</option>
                <option value="pending">Revert to Pending</option>
              </select>
            </div>

            <div>
              <label className="label">Payment Reference / UTR</label>
              <input type="text" className="input mt-1" value={markRef}
                onChange={e => setMarkRef(e.target.value)}
                placeholder="UTR / Cheque No / Ref" />
            </div>

            {markStatus === 'paid' && markRow.bounce_charge > 0 && (
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input type="checkbox" checked={markBounce} onChange={e => setMarkBounce(e.target.checked)} className="rounded" />
                Apply bounce charge ({formatINR(markRow.bounce_charge)})
              </label>
            )}

            <div className="flex justify-end gap-2">
              <button className="btn-secondary" onClick={() => { setMarkOpen(false); setMarkRow(null); setMarkRef('') }}>Cancel</button>
              <button className="btn-primary" disabled={markMutation.isPending} onClick={() => markMutation.mutate()}>
                {markMutation.isPending ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
