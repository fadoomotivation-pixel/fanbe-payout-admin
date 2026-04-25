import { useParams, Link } from 'react-router-dom'
import { useQuery, useMutation } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { queryClient } from '../../lib/queryClient'
import LoadingSpinner from '../../components/ui/LoadingSpinner'
import Modal from '../../components/ui/Modal'
import {
  ArrowLeft, Plus, CreditCard, FileText, BarChart2, Clock,
  CheckCircle2, AlertCircle, ReceiptText, CalendarDays, ChevronRight
} from 'lucide-react'
import { formatDate, formatINR } from '../../lib/utils'
import { STAGE_COLORS, PAYOUT_STATUS_COLORS } from '../../constants/enums'
import { useState } from 'react'
import toast from 'react-hot-toast'

const TABS = [
  { id: 'overview',  label: 'Overview',     icon: FileText },
  { id: 'emi',       label: 'EMI Schedule', icon: CalendarDays },
  { id: 'receipts',  label: 'Receipts',     icon: ReceiptText },
  { id: 'ledger',    label: 'Ledger',       icon: BarChart2 },
  { id: 'activity',  label: 'Activity',     icon: Clock },
]

const EMI_STATUS_COLORS = {
  pending: 'bg-yellow-100 text-yellow-800',
  paid: 'bg-green-100 text-green-800',
  overdue: 'bg-red-100 text-red-800',
  waived: 'bg-slate-100 text-slate-600',
}

const PAYMENT_MODES = ['cash', 'bank_transfer', 'cheque', 'upi', 'neft', 'rtgs']

export default function BookingDetail() {
  const { id } = useParams()
  const [tab, setTab] = useState('overview')

  const [stageOpen, setStageOpen] = useState(false)
  const [newStage, setNewStage] = useState('')

  const [payoutOpen, setPayoutOpen] = useState(false)
  const [payoutForm, setPayoutForm] = useState({ payout_type: 'token', amount: '', tds_applicable: true })

  const [receiptOpen, setReceiptOpen] = useState(false)
  const [receiptForm, setReceiptForm] = useState({
    amount: '', payment_mode: 'cash', reference_no: '',
    receipt_date: new Date().toISOString().split('T')[0], remarks: ''
  })

  const [emiPayOpen, setEmiPayOpen] = useState(false)
  const [selectedEmi, setSelectedEmi] = useState(null)
  const [emiPayForm, setEmiPayForm] = useState({
    paid_amount: '', paid_date: new Date().toISOString().split('T')[0],
    payment_mode: 'cash', reference_no: ''
  })

  const [generateEmiOpen, setGenerateEmiOpen] = useState(false)

  const { data: booking, isLoading } = useQuery({
    queryKey: ['booking', id],
    queryFn: async () => {
      const { data } = await supabase.from('bp_bookings')
        .select('*, bp_customers(name, phone, email), bp_plots(plot_no, area_sqyd, sector, rate_per_sqyd, total_price), bp_projects(name), brokers(name, broker_id)')
        .eq('id', id).single()
      return data
    }
  })

  const { data: payouts = [] } = useQuery({
    queryKey: ['booking-payouts', id],
    queryFn: async () => {
      const { data } = await supabase.from('bp_payout_transactions').select('*').eq('booking_id', id).order('created_at', { ascending: false })
      return data
    }
  })

  const { data: receipts = [] } = useQuery({
    queryKey: ['booking-receipts', id],
    queryFn: async () => {
      const { data } = await supabase.from('bp_booking_receipts').select('*').eq('booking_id', id).order('receipt_date', { ascending: false })
      return data
    }
  })

  const { data: emiSchedule = [] } = useQuery({
    queryKey: ['emi-schedule', id],
    queryFn: async () => {
      const { data } = await supabase.from('bp_emi_schedule').select('*').eq('booking_id', id).order('instalment_no')
      return data
    }
  })

  const { data: activity = [] } = useQuery({
    queryKey: ['booking-activity', id],
    queryFn: async () => {
      const { data } = await supabase.from('bp_booking_activity').select('*').eq('booking_id', id).order('performed_at', { ascending: false })
      return data
    }
  })

  const stageMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('bp_bookings').update({ stage: newStage, updated_at: new Date().toISOString() }).eq('id', id)
      if (error) throw error
      const plotStatus = newStage === 'registry_done' ? 'registry_done' : newStage === 'cancelled' ? 'available' : newStage === 'full_payment' ? 'booked' : newStage
      await supabase.from('bp_plots').update({ status: plotStatus }).eq('id', booking.plot_id)
      await supabase.from('bp_booking_activity').insert({ booking_id: id, action: 'stage_changed', description: `Stage changed from ${booking.stage} to ${newStage}`, old_value: booking.stage, new_value: newStage })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['booking', id] })
      queryClient.invalidateQueries({ queryKey: ['booking-activity', id] })
      toast.success('Stage updated')
      setStageOpen(false)
    },
    onError: e => toast.error(e.message)
  })

  const payoutMutation = useMutation({
    mutationFn: async () => {
      const amount = parseFloat(payoutForm.amount)
      const tds = payoutForm.tds_applicable ? Math.round(amount * 0.05) : 0
      const { error } = await supabase.from('bp_payout_transactions').insert({
        booking_id: id, broker_id: booking.broker_id,
        payout_type: payoutForm.payout_type, amount, tds_amount: tds,
        net_amount: amount - tds, status: 'pending'
      })
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['booking-payouts', id] })
      toast.success('Payout created')
      setPayoutOpen(false)
      setPayoutForm({ payout_type: 'token', amount: '', tds_applicable: true })
    },
    onError: e => toast.error(e.message)
  })

  const receiptMutation = useMutation({
    mutationFn: async () => {
      const receiptNo = `RCP-${Date.now().toString().slice(-8)}`
      const amt = parseFloat(receiptForm.amount)
      const { error: rErr } = await supabase.from('bp_booking_receipts').insert({
        booking_id: id, receipt_no: receiptNo, amount: amt,
        payment_mode: receiptForm.payment_mode, reference_no: receiptForm.reference_no,
        receipt_date: receiptForm.receipt_date, remarks: receiptForm.remarks
      })
      if (rErr) throw rErr
      const newTotal = (booking.total_collected || 0) + amt
      const plotTotal = booking.plot_total_price || booking.full_payment_amount || 0
      await supabase.from('bp_bookings').update({
        total_collected: newTotal,
        balance_due: plotTotal - newTotal,
        updated_at: new Date().toISOString()
      }).eq('id', id)
      await supabase.from('bp_booking_activity').insert({
        booking_id: id, action: 'receipt_added',
        description: `Receipt ${receiptNo} of ${formatINR(amt)} via ${receiptForm.payment_mode}`
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['booking-receipts', id] })
      queryClient.invalidateQueries({ queryKey: ['booking', id] })
      queryClient.invalidateQueries({ queryKey: ['booking-activity', id] })
      toast.success('Receipt added')
      setReceiptOpen(false)
      setReceiptForm({ amount: '', payment_mode: 'cash', reference_no: '', receipt_date: new Date().toISOString().split('T')[0], remarks: '' })
    },
    onError: e => toast.error(e.message)
  })

  const generateEmiMutation = useMutation({
    mutationFn: async () => {
      if (!booking.emi_months || !booking.emi_amount || !booking.emi_start_date)
        throw new Error('EMI details not set on booking')
      const rows = []
      const start = new Date(booking.emi_start_date)
      const day = booking.emi_day_of_month || start.getDate()
      for (let i = 0; i < booking.emi_months; i++) {
        const due = new Date(start.getFullYear(), start.getMonth() + i, day)
        rows.push({
          booking_id: id, instalment_no: i + 1,
          due_date: due.toISOString().split('T')[0],
          amount: booking.emi_amount, status: 'pending'
        })
      }
      const { error } = await supabase.from('bp_emi_schedule').insert(rows)
      if (error) throw error
      await supabase.from('bp_booking_activity').insert({
        booking_id: id, action: 'emi_generated',
        description: `Generated ${booking.emi_months} EMI instalments of ${formatINR(booking.emi_amount)} each`
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['emi-schedule', id] })
      queryClient.invalidateQueries({ queryKey: ['booking-activity', id] })
      toast.success('EMI schedule generated')
      setGenerateEmiOpen(false)
    },
    onError: e => toast.error(e.message)
  })

  const markEmiPaidMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('bp_emi_schedule').update({
        status: 'paid', paid_date: emiPayForm.paid_date,
        paid_amount: parseFloat(emiPayForm.paid_amount),
        updated_at: new Date().toISOString()
      }).eq('id', selectedEmi.id)
      if (error) throw error
      await supabase.from('bp_booking_activity').insert({
        booking_id: id, action: 'emi_paid',
        description: `EMI #${selectedEmi.instalment_no} marked paid — ${formatINR(parseFloat(emiPayForm.paid_amount))}`
      })
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['emi-schedule', id] })
      queryClient.invalidateQueries({ queryKey: ['booking-activity', id] })
      toast.success('EMI marked as paid')
      setEmiPayOpen(false)
    },
    onError: e => toast.error(e.message)
  })

  const totalPaid = receipts.reduce((s, r) => s + Number(r.amount), 0)
  const plotTotal = booking?.plot_total_price || booking?.full_payment_amount || 0
  const balance = plotTotal - totalPaid
  const paidEmiCount = emiSchedule.filter(e => e.status === 'paid').length
  const overdueCount = emiSchedule.filter(e => e.status !== 'paid' && new Date(e.due_date) < new Date()).length
  const progressPct = plotTotal > 0 ? Math.min(100, Math.round((totalPaid / plotTotal) * 100)) : 0

  if (isLoading) return <LoadingSpinner fullPage />

  return (
    <div className="space-y-0">

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-5">
        <div className="flex items-center gap-3">
          <Link to="/bookings" className="p-2 rounded-lg hover:bg-slate-100 transition-colors">
            <ArrowLeft size={16} />
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="page-title">{booking?.booking_no}</h1>
              <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-semibold ${STAGE_COLORS[booking?.stage]}`}>
                {booking?.stage?.replace('_', ' ')}
              </span>
              {booking?.payment_type === 'emi' && (
                <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-semibold bg-purple-100 text-purple-700">EMI</span>
              )}
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              {booking?.bp_projects?.name} · Plot {booking?.bp_plots?.plot_no} · {booking?.bp_customers?.name}
            </p>
          </div>
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={() => setReceiptOpen(true)} className="btn-secondary text-sm">
            <Plus size={14} />Add Receipt
          </button>
          {booking?.broker_id && (
            <button onClick={() => setPayoutOpen(true)} className="btn-secondary text-sm">
              <CreditCard size={14} />Add Payout
            </button>
          )}
          <button onClick={() => setStageOpen(true)} className="btn-primary text-sm">Update Stage</button>
        </div>
      </div>

      {/* Progress */}
      <div className="card p-4 mb-4">
        <div className="flex items-center justify-between text-sm mb-2">
          <span className="text-slate-500">Payment Progress</span>
          <span className="font-semibold">
            {formatINR(totalPaid)}{' '}
            <span className="text-slate-400 font-normal">/ {formatINR(plotTotal)}</span>
          </span>
        </div>
        <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-teal-500 rounded-full transition-all duration-500"
            style={{ width: `${progressPct}%` }}
          />
        </div>
        <div className="flex justify-between text-xs text-slate-400 mt-1.5">
          <span>{progressPct}% collected</span>
          <span>Balance: {formatINR(balance > 0 ? balance : 0)}</span>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-0 border-b border-slate-200 mb-5 overflow-x-auto">
        {TABS.map(t => {
          const Icon = t.icon
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                tab === t.id
                  ? 'border-teal-600 text-teal-700'
                  : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              <Icon size={14} />{t.label}
            </button>
          )
        })}
      </div>

      {/* ═══════════ OVERVIEW ═══════════ */}
      {tab === 'overview' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="card p-5 space-y-3 text-sm">
            <h2 className="section-title">Customer & Plot</h2>
            <InfoRow label="Customer" value={booking?.bp_customers?.name} />
            <InfoRow label="Phone" value={booking?.bp_customers?.phone} />
            <InfoRow label="Email" value={booking?.bp_customers?.email} />
            <InfoRow label="Project" value={booking?.bp_projects?.name} />
            <InfoRow label="Plot No" value={booking?.bp_plots?.plot_no} />
            <InfoRow label="Area" value={booking?.bp_plots?.area_sqyd ? `${booking.bp_plots.area_sqyd} SqYd` : '—'} />
            <InfoRow label="Sector" value={booking?.bp_plots?.sector} />
            <InfoRow label="Broker" value={booking?.brokers ? `${booking.brokers.name} (${booking.brokers.broker_id})` : 'Direct'} />
          </div>
          <div className="card p-5 space-y-3 text-sm">
            <h2 className="section-title">Payment Details</h2>
            <InfoRow label="Plot Total" value={formatINR(booking?.plot_total_price)} strong />
            <InfoRow label="Token Amount" value={formatINR(booking?.token_amount)} />
            <InfoRow label="Token Date" value={formatDate(booking?.token_date)} />
            <InfoRow label="Booking Amount" value={formatINR(booking?.booking_amount)} />
            <InfoRow label="Full Payment" value={formatINR(booking?.full_payment_amount)} />
            <InfoRow label="Total Collected" value={formatINR(totalPaid)} valueClass="text-green-700 font-semibold" />
            <InfoRow
              label="Balance Due"
              value={formatINR(balance > 0 ? balance : 0)}
              valueClass={balance > 0 ? 'text-red-600 font-semibold' : 'text-green-700'}
            />
            <InfoRow label="Payment Type" value={booking?.payment_type || 'lumpsum'} />
            {booking?.payment_type === 'emi' && (
              <>
                <InfoRow label="EMI Months" value={booking?.emi_months} />
                <InfoRow label="EMI Amount" value={formatINR(booking?.emi_amount)} />
                <InfoRow label="EMI Start" value={formatDate(booking?.emi_start_date)} />
              </>
            )}
          </div>
          {booking?.notes && (
            <div className="card p-5 md:col-span-2">
              <h2 className="section-title mb-2">Notes</h2>
              <p className="text-sm text-slate-600">{booking.notes}</p>
            </div>
          )}
        </div>
      )}

      {/* ═══════════ EMI SCHEDULE ═══════════ */}
      {tab === 'emi' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex gap-3 text-sm">
              <span className="text-slate-500">{paidEmiCount} paid</span>
              {overdueCount > 0 && <span className="text-red-600 font-medium">{overdueCount} overdue</span>}
              <span className="text-slate-500">{emiSchedule.length - paidEmiCount} pending</span>
            </div>
            {emiSchedule.length === 0 && booking?.payment_type === 'emi' && (
              <button onClick={() => setGenerateEmiOpen(true)} className="btn-primary text-sm">
                <Plus size={14} />Generate Schedule
              </button>
            )}
          </div>
          {emiSchedule.length === 0 ? (
            <div className="card p-10 text-center">
              <CalendarDays size={36} className="text-slate-300 mx-auto mb-3" />
              <p className="text-slate-500 text-sm">
                {booking?.payment_type === 'emi'
                  ? 'No EMI schedule yet. Click "Generate Schedule" to create instalments.'
                  : 'This booking is not on an EMI plan.'}
              </p>
            </div>
          ) : (
            <div className="card overflow-hidden">
              <table className="w-full text-sm">
                <thead><tr className="bg-slate-50 border-b border-slate-200">
                  {['#', 'Due Date', 'Amount', 'Status', 'Paid Date', 'Paid Amount', 'Action'].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-slate-500">{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {emiSchedule.map(e => {
                    const isOverdue = e.status !== 'paid' && new Date(e.due_date) < new Date()
                    return (
                      <tr key={e.id} className={`border-b border-slate-100 hover:bg-slate-50 ${isOverdue ? 'bg-red-50' : ''}`}>
                        <td className="px-4 py-3 font-medium">{e.instalment_no}</td>
                        <td className="px-4 py-3">
                          <span className={isOverdue ? 'text-red-600 font-medium' : ''}>{formatDate(e.due_date)}</span>
                        </td>
                        <td className="px-4 py-3">{formatINR(e.amount)}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${EMI_STATUS_COLORS[isOverdue ? 'overdue' : e.status]}`}>
                            {isOverdue ? 'overdue' : e.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-slate-500">{formatDate(e.paid_date)}</td>
                        <td className="px-4 py-3">{e.paid_amount ? formatINR(e.paid_amount) : '—'}</td>
                        <td className="px-4 py-3">
                          {e.status !== 'paid' && (
                            <button
                              onClick={() => {
                                setSelectedEmi(e)
                                setEmiPayForm({ paid_amount: e.amount, paid_date: new Date().toISOString().split('T')[0], payment_mode: 'cash', reference_no: '' })
                                setEmiPayOpen(true)
                              }}
                              className="text-xs text-teal-600 hover:text-teal-800 font-medium flex items-center gap-1"
                            >
                              <CheckCircle2 size={13} />Mark Paid
                            </button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ═══════════ RECEIPTS ═══════════ */}
      {tab === 'receipts' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm text-slate-500">
              {receipts.length} receipt{receipts.length !== 1 ? 's' : ''} · Total:{' '}
              <span className="font-semibold text-green-700">{formatINR(totalPaid)}</span>
            </p>
            <button onClick={() => setReceiptOpen(true)} className="btn-primary text-sm">
              <Plus size={14} />Add Receipt
            </button>
          </div>
          {receipts.length === 0 ? (
            <div className="card p-10 text-center">
              <ReceiptText size={36} className="text-slate-300 mx-auto mb-3" />
              <p className="text-slate-500 text-sm">No receipts recorded yet.</p>
            </div>
          ) : (
            <div className="card overflow-hidden">
              <table className="w-full text-sm">
                <thead><tr className="bg-slate-50 border-b border-slate-200">
                  {['Receipt No', 'Date', 'Amount', 'Mode', 'Reference', 'Remarks'].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-slate-500">{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {receipts.map(r => (
                    <tr key={r.id} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="px-4 py-3 font-medium text-teal-700">{r.receipt_no}</td>
                      <td className="px-4 py-3">{formatDate(r.receipt_date)}</td>
                      <td className="px-4 py-3 font-semibold text-green-700">{formatINR(r.amount)}</td>
                      <td className="px-4 py-3">
                        <span className="inline-flex px-2 py-0.5 rounded-full text-xs bg-slate-100 text-slate-700 capitalize">
                          {r.payment_mode.replace('_', ' ')}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-500">{r.reference_no || '—'}</td>
                      <td className="px-4 py-3 text-slate-500">{r.remarks || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ═══════════ LEDGER ═══════════ */}
      {tab === 'ledger' && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <LedgerCard label="Plot Value" value={formatINR(plotTotal)} color="text-slate-700" />
            <LedgerCard label="Collected" value={formatINR(totalPaid)} color="text-green-700" />
            <LedgerCard label="Balance" value={formatINR(balance > 0 ? balance : 0)} color={balance > 0 ? 'text-red-600' : 'text-green-700'} />
            <LedgerCard label="Broker Payouts" value={formatINR(payouts.reduce((s, p) => s + Number(p.net_amount || 0), 0))} color="text-blue-700" />
          </div>

          <div className="card overflow-hidden">
            <div className="p-4 border-b border-slate-200"><h3 className="font-semibold text-sm">Transactions Ledger</h3></div>
            <table className="w-full text-sm">
              <thead><tr className="bg-slate-50 border-b border-slate-200">
                {['Date', 'Type', 'Description', 'Credit', 'Debit', 'Running Balance'].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-slate-500">{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {[
                  ...receipts.map(r => ({ date: r.receipt_date, type: 'receipt', desc: `${r.receipt_no} · ${r.payment_mode.replace('_', ' ')}`, credit: r.amount, debit: null })),
                  ...payouts.map(p => ({ date: p.created_at, type: 'payout', desc: `Broker payout (${p.payout_type})`, credit: null, debit: p.net_amount }))
                ]
                  .sort((a, b) => new Date(a.date) - new Date(b.date))
                  .reduce((acc, row) => {
                    const prev = acc.length > 0 ? acc[acc.length - 1].running : 0
                    acc.push({ ...row, running: prev + (Number(row.credit) || 0) - (Number(row.debit) || 0) })
                    return acc
                  }, [])
                  .map((row, i) => (
                    <tr key={i} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="px-4 py-3 text-slate-500">{formatDate(row.date)}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                          row.type === 'receipt' ? 'bg-green-100 text-green-700' : 'bg-orange-100 text-orange-700'
                        }`}>{row.type}</span>
                      </td>
                      <td className="px-4 py-3 text-slate-700">{row.desc}</td>
                      <td className="px-4 py-3 text-green-700 font-medium">{row.credit ? formatINR(row.credit) : '—'}</td>
                      <td className="px-4 py-3 text-red-600">{row.debit ? formatINR(row.debit) : '—'}</td>
                      <td className="px-4 py-3 font-semibold">{formatINR(row.running)}</td>
                    </tr>
                  ))
                }
              </tbody>
            </table>
            {receipts.length === 0 && payouts.length === 0 && (
              <div className="p-8 text-center text-sm text-slate-400">No transactions yet</div>
            )}
          </div>

          {payouts.length > 0 && (
            <div className="card overflow-hidden">
              <div className="p-4 border-b border-slate-200"><h3 className="font-semibold text-sm">Broker Payout Breakdown</h3></div>
              <table className="w-full text-sm">
                <thead><tr className="bg-slate-50 border-b border-slate-200">
                  {['Type', 'Gross', 'TDS', 'Net', 'Status', 'Date'].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-slate-500">{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {payouts.map(p => (
                    <tr key={p.id} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="px-4 py-3 capitalize">{p.payout_type}</td>
                      <td className="px-4 py-3">{formatINR(p.amount)}</td>
                      <td className="px-4 py-3 text-red-600">{formatINR(p.tds_amount)}</td>
                      <td className="px-4 py-3 font-medium text-green-700">{formatINR(p.net_amount)}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${PAYOUT_STATUS_COLORS[p.status]}`}>{p.status}</span>
                      </td>
                      <td className="px-4 py-3 text-slate-500">{formatDate(p.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ═══════════ ACTIVITY ═══════════ */}
      {tab === 'activity' && (
        <div>
          {activity.length === 0 ? (
            <div className="card p-10 text-center">
              <Clock size={36} className="text-slate-300 mx-auto mb-3" />
              <p className="text-slate-500 text-sm">No activity recorded yet.</p>
            </div>
          ) : (
            <div className="card divide-y divide-slate-100">
              {activity.map(a => (
                <div key={a.id} className="flex items-start gap-3 px-4 py-3">
                  <div className="mt-0.5 flex-shrink-0">
                    {a.action === 'stage_changed' ? <ChevronRight size={15} className="text-blue-500" /> :
                     a.action === 'receipt_added' ? <ReceiptText size={15} className="text-green-500" /> :
                     a.action === 'emi_paid' ? <CheckCircle2 size={15} className="text-teal-500" /> :
                     a.action === 'emi_generated' ? <CalendarDays size={15} className="text-purple-500" /> :
                     <AlertCircle size={15} className="text-slate-400" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-slate-700">{a.description || a.action}</p>
                    {(a.old_value || a.new_value) && (
                      <p className="text-xs text-slate-400 mt-0.5">{a.old_value} → {a.new_value}</p>
                    )}
                  </div>
                  <span className="text-xs text-slate-400 whitespace-nowrap">{formatDate(a.performed_at)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ═══════════ MODALS ═══════════ */}

      <Modal open={stageOpen} onClose={() => setStageOpen(false)} title="Update Booking Stage" size="sm">
        <div className="space-y-4">
          <div>
            <label className="label">Current Stage</label>
            <p className="text-sm font-medium mt-1 capitalize">{booking?.stage?.replace('_', ' ')}</p>
          </div>
          <div>
            <label className="label">New Stage</label>
            <select className="input" value={newStage} onChange={e => setNewStage(e.target.value)}>
              <option value="">Select stage</option>
              {['token', 'booking', 'full_payment', 'registry_done', 'cancelled'].map(s => (
                <option key={s} value={s}>{s.replace('_', ' ')}</option>
              ))}
            </select>
          </div>
          <div className="flex gap-3 justify-end">
            <button onClick={() => setStageOpen(false)} className="btn-secondary">Cancel</button>
            <button onClick={() => stageMutation.mutate()} disabled={!newStage || stageMutation.isPending} className="btn-primary">
              {stageMutation.isPending ? 'Updating…' : 'Update'}
            </button>
          </div>
        </div>
      </Modal>

      <Modal open={receiptOpen} onClose={() => setReceiptOpen(false)} title="Add Payment Receipt" size="sm">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Amount (₹) *</label>
              <input type="number" className="input" value={receiptForm.amount}
                onChange={e => setReceiptForm(f => ({ ...f, amount: e.target.value }))} placeholder="0" />
            </div>
            <div>
              <label className="label">Receipt Date *</label>
              <input type="date" className="input" value={receiptForm.receipt_date}
                onChange={e => setReceiptForm(f => ({ ...f, receipt_date: e.target.value }))} />
            </div>
            <div>
              <label className="label">Payment Mode *</label>
              <select className="input" value={receiptForm.payment_mode}
                onChange={e => setReceiptForm(f => ({ ...f, payment_mode: e.target.value }))}>
                {PAYMENT_MODES.map(m => <option key={m} value={m}>{m.replace('_', ' ').toUpperCase()}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Reference / UTR</label>
              <input type="text" className="input" value={receiptForm.reference_no}
                onChange={e => setReceiptForm(f => ({ ...f, reference_no: e.target.value }))} placeholder="Optional" />
            </div>
          </div>
          <div>
            <label className="label">Remarks</label>
            <textarea className="input min-h-[60px]" value={receiptForm.remarks}
              onChange={e => setReceiptForm(f => ({ ...f, remarks: e.target.value }))} />
          </div>
          {receiptForm.amount && (
            <div className="bg-teal-50 border border-teal-100 rounded-lg p-3 text-sm space-y-1">
              <div className="flex justify-between">
                <span className="text-slate-500">This receipt</span>
                <span className="font-semibold text-green-700">{formatINR(parseFloat(receiptForm.amount))}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">New total collected</span>
                <span className="font-semibold">{formatINR((booking?.total_collected || 0) + parseFloat(receiptForm.amount))}</span>
              </div>
            </div>
          )}
          <div className="flex gap-3 justify-end">
            <button onClick={() => setReceiptOpen(false)} className="btn-secondary">Cancel</button>
            <button onClick={() => receiptMutation.mutate()} disabled={!receiptForm.amount || receiptMutation.isPending} className="btn-primary">
              {receiptMutation.isPending ? 'Saving…' : 'Add Receipt'}
            </button>
          </div>
        </div>
      </Modal>

      <Modal open={payoutOpen} onClose={() => setPayoutOpen(false)} title="Create Broker Payout" size="sm">
        <div className="space-y-4">
          <div>
            <label className="label">Payout Stage</label>
            <select className="input" value={payoutForm.payout_type}
              onChange={e => setPayoutForm(f => ({ ...f, payout_type: e.target.value }))}>
              {['token', 'booking', 'full_payment', 'registry_done'].map(s => (
                <option key={s} value={s}>{s.replace('_', ' ')}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Commission Amount (₹)</label>
            <input type="number" className="input" value={payoutForm.amount}
              onChange={e => setPayoutForm(f => ({ ...f, amount: e.target.value }))} />
          </div>
          <div className="flex items-center gap-2">
            <input type="checkbox" id="tds" checked={payoutForm.tds_applicable}
              onChange={e => setPayoutForm(f => ({ ...f, tds_applicable: e.target.checked }))} />
            <label htmlFor="tds" className="text-sm text-slate-700">Apply 5% TDS</label>
          </div>
          {payoutForm.amount && (
            <div className="bg-slate-50 rounded-lg p-3 text-sm space-y-1">
              <div className="flex justify-between"><span className="text-slate-500">Gross</span><span>{formatINR(parseFloat(payoutForm.amount))}</span></div>
              <div className="flex justify-between">
                <span className="text-slate-500">TDS (5%)</span>
                <span className="text-red-600">- {formatINR(payoutForm.tds_applicable ? Math.round(parseFloat(payoutForm.amount) * 0.05) : 0)}</span>
              </div>
              <div className="flex justify-between font-semibold border-t border-slate-200 pt-1 mt-1">
                <span>Net Payout</span>
                <span className="text-green-700">
                  {formatINR(parseFloat(payoutForm.amount) - (payoutForm.tds_applicable ? Math.round(parseFloat(payoutForm.amount) * 0.05) : 0))}
                </span>
              </div>
            </div>
          )}
          <div className="flex gap-3 justify-end">
            <button onClick={() => setPayoutOpen(false)} className="btn-secondary">Cancel</button>
            <button onClick={() => payoutMutation.mutate()} disabled={!payoutForm.amount || payoutMutation.isPending} className="btn-primary">
              {payoutMutation.isPending ? 'Creating…' : 'Create Payout'}
            </button>
          </div>
        </div>
      </Modal>

      <Modal open={generateEmiOpen} onClose={() => setGenerateEmiOpen(false)} title="Generate EMI Schedule" size="sm">
        <div className="space-y-4">
          {booking?.emi_months ? (
            <>
              <div className="bg-slate-50 rounded-lg p-4 space-y-2 text-sm">
                <InfoRow label="EMI Months" value={booking.emi_months} />
                <InfoRow label="Monthly Amount" value={formatINR(booking.emi_amount)} />
                <InfoRow label="Start Date" value={formatDate(booking.emi_start_date)} />
                <InfoRow label="Day of Month" value={booking.emi_day_of_month || new Date(booking.emi_start_date).getDate()} />
              </div>
              <p className="text-xs text-slate-500">
                This will generate {booking.emi_months} instalment rows. Mark them paid individually as payments come in.
              </p>
              <div className="flex gap-3 justify-end">
                <button onClick={() => setGenerateEmiOpen(false)} className="btn-secondary">Cancel</button>
                <button onClick={() => generateEmiMutation.mutate()} disabled={generateEmiMutation.isPending} className="btn-primary">
                  {generateEmiMutation.isPending ? 'Generating…' : 'Generate'}
                </button>
              </div>
            </>
          ) : (
            <p className="text-sm text-slate-500 text-center py-4">
              EMI details (months, amount, start date) must be set on the booking first.
            </p>
          )}
        </div>
      </Modal>

      <Modal open={emiPayOpen} onClose={() => setEmiPayOpen(false)} title={`Mark EMI #${selectedEmi?.instalment_no} as Paid`} size="sm">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Paid Amount (₹)</label>
              <input type="number" className="input" value={emiPayForm.paid_amount}
                onChange={e => setEmiPayForm(f => ({ ...f, paid_amount: e.target.value }))} />
            </div>
            <div>
              <label className="label">Paid Date</label>
              <input type="date" className="input" value={emiPayForm.paid_date}
                onChange={e => setEmiPayForm(f => ({ ...f, paid_date: e.target.value }))} />
            </div>
            <div>
              <label className="label">Payment Mode</label>
              <select className="input" value={emiPayForm.payment_mode}
                onChange={e => setEmiPayForm(f => ({ ...f, payment_mode: e.target.value }))}>
                {PAYMENT_MODES.map(m => <option key={m} value={m}>{m.toUpperCase()}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Reference</label>
              <input type="text" className="input" value={emiPayForm.reference_no}
                onChange={e => setEmiPayForm(f => ({ ...f, reference_no: e.target.value }))} placeholder="Optional" />
            </div>
          </div>
          <div className="flex gap-3 justify-end">
            <button onClick={() => setEmiPayOpen(false)} className="btn-secondary">Cancel</button>
            <button onClick={() => markEmiPaidMutation.mutate()} disabled={!emiPayForm.paid_amount || markEmiPaidMutation.isPending} className="btn-primary">
              {markEmiPaidMutation.isPending ? 'Saving…' : 'Mark Paid'}
            </button>
          </div>
        </div>
      </Modal>

    </div>
  )
}

function InfoRow({ label, value, strong, valueClass }) {
  return (
    <div className="flex justify-between items-start">
      <span className="text-slate-500 text-xs shrink-0 pt-0.5">{label}</span>
      <span className={`text-right text-sm ml-4 ${strong ? 'font-semibold' : ''} ${valueClass || ''}`}>
        {value ?? '—'}
      </span>
    </div>
  )
}

function LedgerCard({ label, value, color }) {
  return (
    <div className="card p-4">
      <p className="text-xs text-slate-500 mb-1">{label}</p>
      <p className={`text-lg font-bold ${color}`}>{value}</p>
    </div>
  )
}
