import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { formatINR, formatDate } from '@/lib/utils'
import { distributePaymentCommission } from '@/lib/payoutEngine'
import { Modal } from '@/components/ui/Modal.tsx'
import toast from 'react-hot-toast'
import {
  CheckCircle2, XCircle, Clock, Search,
  ClipboardCheck, ReceiptText, AlertCircle, RefreshCw
} from 'lucide-react'

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-800',
  approved: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700',
}

const PAYMENT_MODES = ['cash','neft','rtgs','imps','upi','cheque','dd']
const PAYMENT_TYPES = ['token','booking','emi','full_payment','miscellaneous']

function StatCard({ label, value, color, icon }: { label: string; value: any; color: string; icon: React.ReactNode }) {
  return (
    <div className="card p-4 flex items-start gap-3">
      <div className={`mt-0.5 ${color}`}>{icon}</div>
      <div>
        <p className="text-xs text-slate-500">{label}</p>
        <p className={`text-xl font-bold mt-0.5 ${color}`}>{value}</p>
      </div>
    </div>
  )
}

const EMPTY_FORM = {
  booking_id: '', payment_type: 'token', amount: '',
  payment_mode: 'cash', utr_ref: '',
  payment_date: new Date().toISOString().split('T')[0],
  submitted_by: '', notes: ''
}

export default function PaymentQueue() {
  const qc = useQueryClient()
  const [statusFilter, setStatusFilter] = useState<string>('pending')
  const [search, setSearch] = useState('')
  const [modeFilter, setModeFilter] = useState('')
  const [approveOpen, setApproveOpen] = useState(false)
  const [rejectOpen, setRejectOpen] = useState(false)
  const [selected, setSelected] = useState<any>(null)
  const [rejectReason, setRejectReason] = useState('')
  const [submitOpen, setSubmitOpen] = useState(false)
  const [form, setForm] = useState<any>(EMPTY_FORM)

  // ── Queries ──────────────────────────────────────────────────────────────
  const { data: queue = [], isLoading, refetch } = useQuery({
    queryKey: ['payment-queue', statusFilter],
    queryFn: async () => {
      let q = supabase
        .from('bp_payment_queue')
        .select('*, bp_bookings(booking_no, bp_customers(name, phone))')
        .order('created_at', { ascending: false })
      if (statusFilter !== 'all') q = q.eq('status', statusFilter)
      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  const { data: bookings = [] } = useQuery({
    queryKey: ['bookings_list'],
    queryFn: async () => {
      const { data } = await supabase
        .from('bp_bookings')
        .select('id, booking_no, bp_customers(name)')
      return data ?? []
    },
  })

  const { data: stats } = useQuery({
    queryKey: ['payment-queue-stats'],
    queryFn: async () => {
      const today = new Date().toISOString().split('T')[0]
      const { data } = await supabase.from('bp_payment_queue').select('status, amount, approved_at')
      if (!data) return { pending: 0, pendingAmt: 0, approvedToday: 0, rejectedToday: 0 }
      return {
        pending: data.filter(r => r.status === 'pending').length,
        pendingAmt: data.filter(r => r.status === 'pending').reduce((s, r) => s + Number(r.amount), 0),
        approvedToday: data.filter(r => r.status === 'approved' && r.approved_at?.startsWith(today)).length,
        rejectedToday: data.filter(r => r.status === 'rejected' && r.approved_at?.startsWith(today)).length,
      }
    },
  })

  // ── Mutations ─────────────────────────────────────────────────────────────
  const submitMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('bp_payment_queue').insert({
        ...form, amount: Number(form.amount), status: 'pending',
      })
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['payment-queue'] })
      qc.invalidateQueries({ queryKey: ['payment-queue-stats'] })
      toast.success('Payment submitted for approval')
      setSubmitOpen(false)
      setForm(EMPTY_FORM)
    },
    onError: (e: any) => toast.error(e.message),
  })

  const approveMutation = useMutation({
    mutationFn: async (item: any) => {
      const receiptNo = `RCP-${Date.now().toString().slice(-8)}`
      const now = new Date().toISOString()

      // 1. Mark queue entry approved
      const { error: qErr } = await supabase
        .from('bp_payment_queue')
        .update({ status: 'approved', receipt_no: receiptNo, approved_at: now, updated_at: now })
        .eq('id', item.id)
      if (qErr) throw qErr

      // 2. Generate receipt in bp_booking_receipts
      const { error: rErr } = await supabase.from('bp_booking_receipts').insert({
        booking_id: item.booking_id,
        receipt_no: receiptNo,
        amount: item.amount,
        payment_mode: item.payment_mode,
        reference_no: item.utr_ref,
        receipt_date: item.payment_date || now.split('T')[0],
        remarks: `Auto-approved from Payment Queue. ${item.notes || ''}`.trim(),
      })
      if (rErr) throw rErr

      // 3. Update booking totals + sync plot status if a deposit-style payment closes the deal
      const { data: bk } = await supabase
        .from('bp_bookings')
        .select('id, total_collected, plot_total_price, full_payment_amount, plot_id, stage, total_amount')
        .eq('id', item.booking_id).single()
      let stageAdvanced = false
      if (bk) {
        const newTotal = (bk.total_collected || 0) + Number(item.amount)
        const plotTotal = bk.plot_total_price || bk.full_payment_amount || bk.total_amount || 0
        // Auto-advance to booking_done when this payment is the booking deposit / full payment
        // or when accumulated collection matches the plot total.
        const promoteToBookingDone = (
          (item.payment_type === 'booking' || item.payment_type === 'full_payment')
          && bk.stage === 'token_received'
        ) || (plotTotal > 0 && newTotal >= plotTotal && bk.stage === 'token_received')
        const patch: any = {
          total_collected: newTotal,
          balance_due: Math.max(0, plotTotal - newTotal),
          updated_at: now,
        }
        if (promoteToBookingDone) { patch.stage = 'booking_done'; stageAdvanced = true }
        await supabase.from('bp_bookings').update(patch).eq('id', item.booking_id)
        // Plot status sync: tokenAdvance / bookingDone → booked. Hold for sold until manual close.
        if (bk.plot_id) {
          const newStage = stageAdvanced ? 'booking_done' : bk.stage
          const plotStatus = newStage === 'booking_done' ? 'booked' : newStage === 'token_received' ? 'token' : 'available'
          await supabase.from('bp_plots').update({ status: plotStatus }).eq('id', bk.plot_id)
        }
      }

      // 4. Mirror to bp_payments so it shows in the unified ledger + triggers MLM
      const { data: payment } = await supabase.from('bp_payments').insert({
        booking_id: item.booking_id,
        payment_type: item.payment_type,
        amount: item.amount,
        payment_mode: item.payment_mode,
        utr_ref: item.utr_ref,
        payment_date: item.payment_date || now.split('T')[0],
        receipt_no: receiptNo,
        verification_status: 'verified',
        verified_at: now,
        notes: `Approved via Payment Queue. ${item.notes || ''}`.trim(),
      }).select('id').single()

      // 5. Per-payment MLM distribution (deferred-commission model)
      let distributed = 0
      if (payment?.id && Number(item.amount) > 0) {
        const rows = await distributePaymentCommission({
          bookingId: item.booking_id, paymentId: payment.id, amount: Number(item.amount),
        })
        distributed = rows.length
      }

      // 6. Log activity
      await supabase.from('bp_booking_activity').insert({
        booking_id: item.booking_id,
        action: 'payment_approved',
        description: `Payment of ${formatINR(item.amount)} approved via queue. Receipt ${receiptNo}${stageAdvanced ? ' · stage → Booking Done' : ''}${distributed ? ` · MLM × ${distributed}` : ''}.`,
      })
      return { receiptNo, distributed, stageAdvanced }
    },
    onSuccess: ({ receiptNo, distributed, stageAdvanced }: any) => {
      qc.invalidateQueries({ queryKey: ['payment-queue'] })
      qc.invalidateQueries({ queryKey: ['payment-queue-stats'] })
      qc.invalidateQueries({ queryKey: ['booking-receipts'] })
      qc.invalidateQueries({ queryKey: ['payments'] })
      qc.invalidateQueries({ queryKey: ['payments_by_booking'] })
      qc.invalidateQueries({ queryKey: ['bookings'] })
      qc.invalidateQueries({ queryKey: ['plots'] })
      qc.invalidateQueries({ queryKey: ['plots_avail'] })
      qc.invalidateQueries({ queryKey: ['payouts'] })
      qc.invalidateQueries({ queryKey: ['commission_ledger'] })
      toast.success(`Receipt ${receiptNo}${stageAdvanced ? ' · stage advanced' : ''}${distributed ? ` · MLM × ${distributed}` : ''}`)
      setApproveOpen(false)
      setSelected(null)
    },
    onError: (e: any) => toast.error(e.message),
  })

  const rejectMutation = useMutation({
    mutationFn: async () => {
      const now = new Date().toISOString()
      const { error } = await supabase.from('bp_payment_queue').update({
        status: 'rejected', reject_reason: rejectReason,
        approved_at: now, updated_at: now,
      }).eq('id', selected.id)
      if (error) throw error
      await supabase.from('bp_booking_activity').insert({
        booking_id: selected.booking_id,
        action: 'payment_rejected',
        description: `Payment of ${formatINR(selected.amount)} rejected. Reason: ${rejectReason}`,
      })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['payment-queue'] })
      qc.invalidateQueries({ queryKey: ['payment-queue-stats'] })
      toast.error('Payment rejected')
      setRejectOpen(false)
      setSelected(null)
      setRejectReason('')
    },
    onError: (e: any) => toast.error(e.message),
  })

  // ── Derived data ──────────────────────────────────────────────────────────
  const filtered = queue.filter((r: any) => {
    const q = search.toLowerCase()
    const matchSearch =
      !q ||
      r.bp_bookings?.booking_no?.toLowerCase().includes(q) ||
      r.bp_bookings?.bp_customers?.name?.toLowerCase().includes(q) ||
      r.utr_ref?.toLowerCase().includes(q)
    const matchMode = !modeFilter || r.payment_mode === modeFilter
    return matchSearch && matchMode
  })

  const TABS = [
    { label: 'Pending', value: 'pending', count: stats?.pending },
    { label: 'Approved', value: 'approved' },
    { label: 'Rejected', value: 'rejected' },
    { label: 'All', value: 'all' },
  ]

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5">

      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="page-title flex items-center gap-2">
            <ClipboardCheck size={20} className="text-teal-600" />
            Payment Confirmation Queue
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">Review and approve incoming payment submissions</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => { refetch(); qc.invalidateQueries({ queryKey: ['payment-queue-stats'] }) }} className="btn-secondary text-sm">
            <RefreshCw size={14} /> Refresh
          </button>
          <button onClick={() => setSubmitOpen(true)} className="btn-primary text-sm">
            + Submit Payment
          </button>
        </div>
      </div>

      {/* ── Stats ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Pending Approvals" value={stats?.pending ?? 0} color="text-yellow-600" icon={<Clock size={18} />} />
        <StatCard label="Pending Amount" value={formatINR(stats?.pendingAmt ?? 0)} color="text-yellow-700" icon={<ReceiptText size={18} />} />
        <StatCard label="Approved Today" value={stats?.approvedToday ?? 0} color="text-green-700" icon={<CheckCircle2 size={18} />} />
        <StatCard label="Rejected Today" value={stats?.rejectedToday ?? 0} color="text-red-600" icon={<XCircle size={18} />} />
      </div>

      {/* ── Main Card ── */}
      <div className="card p-0 overflow-hidden">

        {/* Tabs */}
        <div className="flex border-b border-slate-200 overflow-x-auto">
          {TABS.map(t => (
            <button
              key={t.value}
              onClick={() => setStatusFilter(t.value)}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                statusFilter === t.value
                  ? 'border-teal-600 text-teal-700'
                  : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              {t.label}
              {t.count !== undefined && (
                <span className="ml-1 bg-yellow-100 text-yellow-800 text-xs font-semibold px-1.5 py-0.5 rounded-full">
                  {t.count}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Search + Mode Filter */}
        <div className="flex flex-col sm:flex-row gap-3 p-4 border-b border-slate-100">
          <div className="relative flex-1">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search by booking no, customer name or UTR ref…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="input pl-9 text-sm"
            />
          </div>
          <select
            value={modeFilter}
            onChange={e => setModeFilter(e.target.value)}
            className="input text-sm w-auto"
          >
            <option value="">All Modes</option>
            {PAYMENT_MODES.map(m => <option key={m} value={m}>{m.toUpperCase()}</option>)}
          </select>
        </div>

        {/* Table / Empty State */}
        {isLoading ? (
          <div className="p-10 text-center text-slate-400 text-sm">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="p-14 text-center">
            <ClipboardCheck size={38} className="text-slate-200 mx-auto mb-3" />
            <p className="text-slate-500 text-sm font-medium">
              {statusFilter === 'pending' ? 'All caught up! No pending payments.' : 'No records found.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  {['Customer','Booking No','Type','Amount','Mode','UTR / Ref','Date','Status','Actions'].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-slate-500 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((row: any) => (
                  <tr key={row.id} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-800">{row.bp_bookings?.bp_customers?.name || '—'}</div>
                      <div className="text-xs text-slate-400">{row.bp_bookings?.bp_customers?.phone}</div>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-teal-700 font-semibold">
                      {row.bp_bookings?.booking_no || row.booking_id?.slice(0, 8) + '…'}
                    </td>
                    <td className="px-4 py-3">
                      <span className="capitalize text-xs bg-slate-100 text-slate-700 px-2 py-0.5 rounded-full">
                        {row.payment_type?.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-semibold text-green-700 whitespace-nowrap">{formatINR(row.amount)}</td>
                    <td className="px-4 py-3">
                      <span className="uppercase text-xs font-medium text-slate-600">{row.payment_mode}</span>
                    </td>
                    <td className="px-4 py-3 text-slate-500 text-xs font-mono">{row.utr_ref || '—'}</td>
                    <td className="px-4 py-3 text-slate-500 text-xs whitespace-nowrap">{formatDate(row.payment_date || row.created_at)}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold capitalize ${STATUS_COLORS[row.status] || ''}`}>
                        {row.status}
                      </span>
                      {row.status === 'approved' && row.receipt_no && (
                        <div className="text-xs text-teal-600 mt-0.5 font-mono">{row.receipt_no}</div>
                      )}
                      {row.status === 'rejected' && row.reject_reason && (
                        <div className="text-xs text-red-500 mt-0.5 truncate max-w-[110px]" title={row.reject_reason}>
                          {row.reject_reason}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {row.status === 'pending' ? (
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => { setSelected(row); setApproveOpen(true) }}
                            className="flex items-center gap-1 text-xs text-green-700 hover:text-green-900 font-medium transition-colors"
                          >
                            <CheckCircle2 size={13} /> Approve
                          </button>
                          <span className="text-slate-300">|</span>
                          <button
                            onClick={() => { setSelected(row); setRejectOpen(true) }}
                            className="flex items-center gap-1 text-xs text-red-600 hover:text-red-800 font-medium transition-colors"
                          >
                            <XCircle size={13} /> Reject
                          </button>
                        </div>
                      ) : (
                        <span className="text-xs text-slate-400 whitespace-nowrap">{formatDate(row.approved_at)}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ─── APPROVE MODAL ─── */}
      <Modal open={approveOpen} onClose={() => { setApproveOpen(false); setSelected(null) }} title="Approve Payment" size="sm">
        {selected && (
          <div className="space-y-4">
            <div className="bg-green-50 border border-green-200 rounded-lg p-4 space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-500">Customer</span>
                <span className="font-medium">{selected.bp_bookings?.bp_customers?.name}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Booking</span>
                <span className="font-medium font-mono text-teal-700">{selected.bp_bookings?.booking_no}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Payment Type</span>
                <span className="capitalize">{selected.payment_type?.replace('_', ' ')}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Amount</span>
                <span className="font-bold text-green-700 text-base">{formatINR(selected.amount)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Mode</span>
                <span className="uppercase font-medium">{selected.payment_mode}</span>
              </div>
              {selected.utr_ref && (
                <div className="flex justify-between">
                  <span className="text-slate-500">UTR / Ref</span>
                  <span className="font-mono text-xs">{selected.utr_ref}</span>
                </div>
              )}
              {selected.notes && (
                <div className="flex justify-between gap-4">
                  <span className="text-slate-500">Notes</span>
                  <span className="text-right text-xs text-slate-600">{selected.notes}</span>
                </div>
              )}
            </div>
            <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-700 flex items-start gap-2">
              <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
              Approving will auto-generate a receipt and update this booking's collected amount.
            </div>
            <div className="flex gap-3 justify-end">
              <button onClick={() => { setApproveOpen(false); setSelected(null) }} className="btn-secondary">Cancel</button>
              <button
                onClick={() => approveMutation.mutate(selected)}
                disabled={approveMutation.isPending}
                className="btn-primary !bg-green-600 hover:!bg-green-700 !border-green-600 flex items-center gap-1.5"
              >
                <CheckCircle2 size={14} />
                {approveMutation.isPending ? 'Approving…' : 'Confirm Approve'}
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* ─── REJECT MODAL ─── */}
      <Modal open={rejectOpen} onClose={() => { setRejectOpen(false); setSelected(null); setRejectReason('') }} title="Reject Payment" size="sm">
        {selected && (
          <div className="space-y-4">
            <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm space-y-1">
              <p className="font-medium text-red-800">
                {selected.bp_bookings?.bp_customers?.name} — {formatINR(selected.amount)}
              </p>
              <p className="text-slate-500 text-xs">
                {selected.bp_bookings?.booking_no} · {selected.payment_mode?.toUpperCase()} · {selected.utr_ref || 'No UTR'}
              </p>
            </div>
            <div>
              <label className="label">Rejection Reason *</label>
              <textarea
                className="input mt-1"
                rows={3}
                placeholder="e.g. UTR mismatch, amount incorrect, duplicate submission…"
                value={rejectReason}
                onChange={e => setRejectReason(e.target.value)}
              />
            </div>
            <div className="flex gap-3 justify-end">
              <button onClick={() => { setRejectOpen(false); setSelected(null); setRejectReason('') }} className="btn-secondary">Cancel</button>
              <button
                onClick={() => rejectMutation.mutate()}
                disabled={!rejectReason.trim() || rejectMutation.isPending}
                className="btn-primary !bg-red-600 hover:!bg-red-700 !border-red-600 flex items-center gap-1.5"
              >
                <XCircle size={14} />
                {rejectMutation.isPending ? 'Rejecting…' : 'Confirm Reject'}
              </button>
            </div>
          </div>
        )}
      </Modal>

      {/* ─── SUBMIT PAYMENT MODAL ─── */}
      <Modal open={submitOpen} onClose={() => setSubmitOpen(false)} title="Submit Payment for Approval">
        <div className="grid grid-cols-2 gap-4">
          <div className="col-span-2">
            <label className="label">Booking *</label>
            <select className="input mt-1" value={form.booking_id} onChange={e => setForm((p: any) => ({ ...p, booking_id: e.target.value }))}>
              <option value="">Select Booking</option>
              {(bookings as any[]).map((b: any) => (
                <option key={b.id} value={b.id}>{b.booking_no} — {b.bp_customers?.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Payment Type *</label>
            <select className="input mt-1" value={form.payment_type} onChange={e => setForm((p: any) => ({ ...p, payment_type: e.target.value }))}>
              {PAYMENT_TYPES.map(t => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Amount (₹) *</label>
            <input type="number" className="input mt-1" value={form.amount} onChange={e => setForm((p: any) => ({ ...p, amount: e.target.value }))} />
          </div>
          <div>
            <label className="label">Payment Mode *</label>
            <select className="input mt-1" value={form.payment_mode} onChange={e => setForm((p: any) => ({ ...p, payment_mode: e.target.value }))}>
              {PAYMENT_MODES.map(m => <option key={m} value={m}>{m.toUpperCase()}</option>)}
            </select>
          </div>
          <div>
            <label className="label">UTR / Ref No</label>
            <input type="text" className="input mt-1" value={form.utr_ref} onChange={e => setForm((p: any) => ({ ...p, utr_ref: e.target.value }))} />
          </div>
          <div>
            <label className="label">Payment Date *</label>
            <input type="date" className="input mt-1" value={form.payment_date} onChange={e => setForm((p: any) => ({ ...p, payment_date: e.target.value }))} />
          </div>
          <div>
            <label className="label">Submitted By</label>
            <input type="text" className="input mt-1" value={form.submitted_by} onChange={e => setForm((p: any) => ({ ...p, submitted_by: e.target.value }))} placeholder="Staff name" />
          </div>
          <div className="col-span-2">
            <label className="label">Notes</label>
            <textarea className="input mt-1" rows={2} value={form.notes} onChange={e => setForm((p: any) => ({ ...p, notes: e.target.value }))} />
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-6">
          <button className="btn-secondary" onClick={() => setSubmitOpen(false)}>Cancel</button>
          <button
            className="btn-primary"
            disabled={!form.booking_id || !form.amount || submitMutation.isPending}
            onClick={() => submitMutation.mutate()}
          >
            {submitMutation.isPending ? 'Submitting…' : 'Submit for Approval'}
          </button>
        </div>
      </Modal>
    </div>
  )
}
