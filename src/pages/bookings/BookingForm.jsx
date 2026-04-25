import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useNavigate, Link } from 'react-router-dom'
import { useQuery, useMutation } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { queryClient } from '../../lib/queryClient'
import toast from 'react-hot-toast'
import { ArrowLeft, Calculator, CreditCard, Banknote, Info } from 'lucide-react'
import { useState, useEffect } from 'react'
import { formatINR } from '../../lib/utils'

const schema = z.object({
  project_id: z.string().min(1, 'Required'),
  plot_id: z.string().min(1, 'Required'),
  customer_id: z.string().min(1, 'Required'),
  broker_id: z.string().optional(),
  plot_total_price: z.coerce.number().min(1, 'Required'),
  stage: z.string().min(1),
  payment_type: z.enum(['lumpsum', 'emi', 'partial']),
  token_amount: z.coerce.number().min(0).default(0),
  token_date: z.string().optional(),
  booking_amount: z.coerce.number().min(0).default(0),
  booking_date: z.string().optional(),
  full_payment_amount: z.coerce.number().min(0).default(0),
  full_payment_date: z.string().optional(),
  total_collected: z.coerce.number().min(0).default(0),
  // EMI fields
  emi_months: z.coerce.number().min(1).optional(),
  emi_amount: z.coerce.number().min(0).optional(),
  emi_start_date: z.string().optional(),
  emi_day_of_month: z.coerce.number().min(1).max(31).optional(),
  // Partial fields
  balance_due: z.coerce.number().min(0).default(0),
  notes: z.string().optional(),
})

const PAYMENT_TYPES = [
  { value: 'lumpsum', label: 'Lumpsum', icon: Banknote, desc: 'Full payment in one go' },
  { value: 'emi', label: 'EMI', icon: CreditCard, desc: 'Monthly instalments' },
  { value: 'partial', label: 'Partial', icon: Calculator, desc: 'Flexible partial payments' },
]

const today = new Date().toISOString().split('T')[0]

export default function BookingForm() {
  const navigate = useNavigate()
  const [showEmiCalc, setShowEmiCalc] = useState(false)

  const { register, handleSubmit, watch, setValue, control, formState: { errors } } = useForm({
    resolver: zodResolver(schema),
    defaultValues: {
      stage: 'token', payment_type: 'lumpsum',
      token_amount: 0, booking_amount: 0, full_payment_amount: 0,
      total_collected: 0, balance_due: 0,
      emi_months: 12, emi_day_of_month: 5,
      token_date: today, booking_date: today,
    }
  })

  const projectId = watch('project_id')
  const paymentType = watch('payment_type')
  const plotTotal = watch('plot_total_price')
  const emiMonths = watch('emi_months')
  const tokenAmt = watch('token_amount')
  const bookingAmt = watch('booking_amount')
  const fullPayAmt = watch('full_payment_amount')

  // Auto-calc EMI amount when plot_total or emi_months changes
  useEffect(() => {
    if (paymentType === 'emi' && plotTotal > 0 && emiMonths > 0) {
      const downPayment = (tokenAmt || 0) + (bookingAmt || 0)
      const remaining = plotTotal - downPayment
      if (remaining > 0) {
        setValue('emi_amount', Math.ceil(remaining / emiMonths))
      }
    }
  }, [plotTotal, emiMonths, paymentType, tokenAmt, bookingAmt, setValue])

  // Auto-calc total_collected
  useEffect(() => {
    const total = (tokenAmt || 0) + (bookingAmt || 0) + (fullPayAmt || 0)
    setValue('total_collected', total)
    if (plotTotal > 0) setValue('balance_due', Math.max(0, plotTotal - total))
  }, [tokenAmt, bookingAmt, fullPayAmt, plotTotal, setValue])

  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: async () => { const { data } = await supabase.from('bp_projects').select('id, name'); return data }
  })

  const { data: plots = [] } = useQuery({
    queryKey: ['available-plots', projectId],
    queryFn: async () => {
      if (!projectId) return []
      const { data } = await supabase.from('bp_plots').select('id, plot_no, area_sqyd, rate_per_sqyd, total_price').eq('project_id', projectId).eq('status', 'available')
      return data
    },
    enabled: !!projectId
  })

  const { data: customers = [] } = useQuery({
    queryKey: ['customers'],
    queryFn: async () => { const { data } = await supabase.from('bp_customers').select('id, name, phone').order('name'); return data }
  })

  const { data: brokers = [] } = useQuery({
    queryKey: ['brokers'],
    queryFn: async () => { const { data } = await supabase.from('brokers').select('id, name, broker_id').eq('status', 'active'); return data }
  })

  const selectedPlot = plots.find(p => p.id === watch('plot_id'))

  const handlePlotChange = (e) => {
    const plot = plots.find(p => p.id === e.target.value)
    if (plot?.total_price) setValue('plot_total_price', plot.total_price)
  }

  const generateBookingNo = () => `BK-${Date.now().toString().slice(-8)}`

  const mutation = useMutation({
    mutationFn: async (values) => {
      const bookingNo = generateBookingNo()
      const payload = {
        ...values,
        booking_no: bookingNo,
        broker_id: values.broker_id || null,
        emi_months: values.payment_type === 'emi' ? values.emi_months : null,
        emi_amount: values.payment_type === 'emi' ? values.emi_amount : null,
        emi_start_date: values.payment_type === 'emi' ? values.emi_start_date : null,
        emi_day_of_month: values.payment_type === 'emi' ? values.emi_day_of_month : null,
      }
      const { data: booking, error } = await supabase.from('bp_bookings').insert(payload).select().single()
      if (error) throw error
      const plotStatus = values.stage === 'token' ? 'token' : 'booked'
      await supabase.from('bp_plots').update({ status: plotStatus }).eq('id', values.plot_id)
      await supabase.from('bp_booking_activity').insert({
        booking_id: booking.id, action: 'booking_created',
        description: `Booking created — ${values.payment_type} | Stage: ${values.stage} | Collected: ${formatINR(values.total_collected)}`
      })
      return booking
    },
    onSuccess: (booking) => {
      queryClient.invalidateQueries({ queryKey: ['bookings'] })
      queryClient.invalidateQueries({ queryKey: ['plots'] })
      toast.success('Booking created successfully')
      navigate(`/bookings/${booking.id}`)
    },
    onError: (e) => toast.error(e.message)
  })

  const totalCollected = watch('total_collected')
  const balanceDue = watch('balance_due')
  const emiAmount = watch('emi_amount')

  return (
    <div className="max-w-3xl space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link to="/bookings" className="p-2 rounded-lg hover:bg-slate-100"><ArrowLeft size={16} /></Link>
        <div>
          <h1 className="page-title">New Booking</h1>
          <p className="text-xs text-slate-500 mt-0.5">Record a new plot booking with payment details</p>
        </div>
      </div>

      <form onSubmit={handleSubmit(d => mutation.mutate(d))} className="space-y-5">

        {/* ── Section 1: Core Details ── */}
        <div className="card p-5 space-y-4">
          <h2 className="section-title">Booking Details</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="label">Project *</label>
              <select className="input" {...register('project_id')}>
                <option value="">Select project</option>
                {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              {errors.project_id && <p className="field-error">{errors.project_id.message}</p>}
            </div>
            <div>
              <label className="label">Plot *</label>
              <select className="input" {...register('plot_id', { onChange: handlePlotChange })} disabled={!projectId}>
                <option value="">Select plot</option>
                {plots.map(p => <option key={p.id} value={p.id}>{p.plot_no} · {p.area_sqyd} SqYd{p.total_price ? ` · ${formatINR(p.total_price)}` : ''}</option>)}
              </select>
              {errors.plot_id && <p className="field-error">{errors.plot_id.message}</p>}
            </div>
            <div>
              <label className="label">Customer *</label>
              <select className="input" {...register('customer_id')}>
                <option value="">Select customer</option>
                {customers.map(c => <option key={c.id} value={c.id}>{c.name} — {c.phone}</option>)}
              </select>
              {errors.customer_id && <p className="field-error">{errors.customer_id.message}</p>}
            </div>
            <div>
              <label className="label">Broker</label>
              <select className="input" {...register('broker_id')}>
                <option value="">No broker (direct)</option>
                {brokers.map(b => <option key={b.id} value={b.id}>{b.name} ({b.broker_id})</option>)}
              </select>
            </div>
            <div>
              <label className="label">Plot Total Price (₹) *</label>
              <input type="number" className="input" {...register('plot_total_price')} placeholder="Auto-filled from plot" />
              {errors.plot_total_price && <p className="field-error">{errors.plot_total_price.message}</p>}
            </div>
            <div>
              <label className="label">Booking Stage *</label>
              <select className="input" {...register('stage')}>
                {['token','booking','full_payment'].map(s => <option key={s} value={s}>{s.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase())}</option>)}
              </select>
            </div>
          </div>
        </div>

        {/* ── Section 2: Payment Type ── */}
        <div className="card p-5 space-y-4">
          <h2 className="section-title">Payment Type</h2>
          <div className="grid grid-cols-3 gap-3">
            {PAYMENT_TYPES.map(({ value, label, icon: Icon, desc }) => (
              <label
                key={value}
                className={`flex flex-col items-center gap-1.5 p-3 rounded-xl border-2 cursor-pointer transition-all ${
                  paymentType === value
                    ? 'border-teal-600 bg-teal-50 text-teal-700'
                    : 'border-slate-200 hover:border-slate-300 text-slate-600'
                }`}
              >
                <input type="radio" value={value} {...register('payment_type')} className="sr-only" />
                <Icon size={20} />
                <span className="text-sm font-semibold">{label}</span>
                <span className="text-xs text-center text-slate-400">{desc}</span>
              </label>
            ))}
          </div>
        </div>

        {/* ── Section 3: Payment Amounts ── */}
        <div className="card p-5 space-y-4">
          <h2 className="section-title">Payment Amounts</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="label">Token Amount (₹)</label>
              <input type="number" className="input" {...register('token_amount')} placeholder="0" />
            </div>
            <div>
              <label className="label">Token Date</label>
              <input type="date" className="input" {...register('token_date')} />
            </div>
            <div>
              <label className="label">Booking Amount (₹)</label>
              <input type="number" className="input" {...register('booking_amount')} placeholder="0" />
            </div>
            <div>
              <label className="label">Booking Date</label>
              <input type="date" className="input" {...register('booking_date')} />
            </div>
            {(paymentType === 'lumpsum' || paymentType === 'partial') && (
              <>
                <div>
                  <label className="label">Full / Additional Payment (₹)</label>
                  <input type="number" className="input" {...register('full_payment_amount')} placeholder="0" />
                </div>
                <div>
                  <label className="label">Full Payment Date</label>
                  <input type="date" className="input" {...register('full_payment_date')} />
                </div>
              </>
            )}
          </div>

          {/* Auto-calc summary */}
          {plotTotal > 0 && (
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 grid grid-cols-3 gap-4 text-center">
              <div>
                <p className="text-xs text-slate-500 mb-1">Plot Value</p>
                <p className="text-sm font-bold text-slate-700">{formatINR(plotTotal)}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500 mb-1">Collected</p>
                <p className="text-sm font-bold text-green-700">{formatINR(totalCollected)}</p>
              </div>
              <div>
                <p className="text-xs text-slate-500 mb-1">Balance</p>
                <p className={`text-sm font-bold ${balanceDue > 0 ? 'text-red-600' : 'text-green-700'}`}>{formatINR(balanceDue)}</p>
              </div>
            </div>
          )}
        </div>

        {/* ── Section 4: EMI Setup (conditional) ── */}
        {paymentType === 'emi' && (
          <div className="card p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="section-title">EMI Setup</h2>
              <button
                type="button"
                onClick={() => setShowEmiCalc(p => !p)}
                className="text-xs text-teal-600 hover:text-teal-800 flex items-center gap-1 font-medium"
              >
                <Calculator size={13} />{showEmiCalc ? 'Hide' : 'Show'} Calculator
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="label">Number of EMI Months *</label>
                <input type="number" className="input" {...register('emi_months')} min={1} max={120} placeholder="e.g. 24" />
                {errors.emi_months && <p className="field-error">{errors.emi_months.message}</p>}
              </div>
              <div>
                <label className="label">Monthly EMI Amount (₹)</label>
                <input type="number" className="input" {...register('emi_amount')} placeholder="Auto-calculated" />
                <p className="text-xs text-slate-400 mt-1">Auto-calculated. You can override.</p>
              </div>
              <div>
                <label className="label">EMI Start Date *</label>
                <input type="date" className="input" {...register('emi_start_date')} />
                {errors.emi_start_date && <p className="field-error">{errors.emi_start_date.message}</p>}
              </div>
              <div>
                <label className="label">EMI Day of Month</label>
                <input type="number" className="input" {...register('emi_day_of_month')} min={1} max={31} placeholder="e.g. 5" />
                <p className="text-xs text-slate-400 mt-1">Day on which EMI is due each month.</p>
              </div>
            </div>

            {/* EMI Calculator breakdown */}
            {showEmiCalc && plotTotal > 0 && emiMonths > 0 && (
              <div className="bg-teal-50 border border-teal-100 rounded-xl p-4 space-y-3">
                <p className="text-xs font-semibold text-teal-700 uppercase tracking-wide">EMI Breakdown</p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
                  <div>
                    <p className="text-xs text-slate-500">Plot Total</p>
                    <p className="text-sm font-bold text-slate-700">{formatINR(plotTotal)}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">Down Payment</p>
                    <p className="text-sm font-bold text-slate-700">{formatINR((tokenAmt || 0) + (bookingAmt || 0))}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">EMI Principal</p>
                    <p className="text-sm font-bold text-slate-700">{formatINR(Math.max(0, plotTotal - (tokenAmt || 0) - (bookingAmt || 0)))}</p>
                  </div>
                  <div>
                    <p className="text-xs text-slate-500">Monthly EMI</p>
                    <p className="text-sm font-bold text-teal-700">{emiAmount ? formatINR(emiAmount) : '—'}</p>
                  </div>
                </div>
                <div className="flex items-start gap-2 text-xs text-teal-600 bg-white rounded-lg p-2 border border-teal-100">
                  <Info size={12} className="mt-0.5 shrink-0" />
                  <span>The EMI schedule will be generated from BookingDetail after saving. Go to the <strong>EMI Schedule</strong> tab to create and manage instalments.</span>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── Section 5: Notes ── */}
        <div className="card p-5">
          <label className="label">Notes</label>
          <textarea className="input min-h-[80px] mt-1" {...register('notes')} placeholder="Any additional notes about this booking…" />
        </div>

        {/* Actions */}
        <div className="flex gap-3 pb-4">
          <button type="submit" disabled={mutation.isPending} className="btn-primary">
            {mutation.isPending ? 'Creating…' : 'Create Booking'}
          </button>
          <Link to="/bookings" className="btn-secondary">Cancel</Link>
        </div>

      </form>
    </div>
  )
}
