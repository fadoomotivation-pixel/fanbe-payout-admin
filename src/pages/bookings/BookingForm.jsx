import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { useNavigate, Link } from 'react-router-dom'
import { useQuery, useMutation } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { queryClient } from '../../lib/queryClient'
import toast from 'react-hot-toast'
import { ArrowLeft } from 'lucide-react'

const schema = z.object({
  project_id: z.string().min(1, 'Required'),
  plot_id: z.string().min(1, 'Required'),
  customer_id: z.string().min(1, 'Required'),
  broker_id: z.string().optional(),
  token_amount: z.coerce.number().min(0),
  booking_amount: z.coerce.number().min(0),
  full_payment_amount: z.coerce.number().min(0),
  total_collected: z.coerce.number().min(0),
  stage: z.string().min(1),
  notes: z.string().optional(),
})

export default function BookingForm() {
  const navigate = useNavigate()
  const { register, handleSubmit, watch, formState: { errors } } = useForm({
    resolver: zodResolver(schema),
    defaultValues: { stage: 'token', token_amount: 0, booking_amount: 0, full_payment_amount: 0, total_collected: 0 }
  })
  const projectId = watch('project_id')

  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: async () => { const { data } = await supabase.from('bp_projects').select('id, name'); return data }
  })

  const { data: plots = [] } = useQuery({
    queryKey: ['available-plots', projectId],
    queryFn: async () => {
      if (!projectId) return []
      const { data } = await supabase.from('bp_plots').select('id, plot_no, area_sqyd').eq('project_id', projectId).eq('status', 'available')
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

  const generateBookingNo = () => `BK-${Date.now().toString().slice(-8)}`

  const mutation = useMutation({
    mutationFn: async (values) => {
      const bookingNo = generateBookingNo()
      const { data: booking, error } = await supabase.from('bp_bookings').insert({ ...values, booking_no: bookingNo }).select().single()
      if (error) throw error
      await supabase.from('bp_plots').update({ status: values.stage === 'token' ? 'token' : 'booked' }).eq('id', values.plot_id)
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

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-center gap-3">
        <Link to="/bookings" className="p-2 rounded-lg hover:bg-slate-100"><ArrowLeft size={16} /></Link>
        <h1 className="page-title">New Booking</h1>
      </div>
      <div className="card p-6">
        <form onSubmit={handleSubmit(d => mutation.mutate(d))} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Project *</label>
              <select className="input" {...register('project_id')}>
                <option value="">Select project</option>
                {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
              {errors.project_id && <p className="text-xs text-red-500 mt-1">{errors.project_id.message}</p>}
            </div>
            <div>
              <label className="label">Plot *</label>
              <select className="input" {...register('plot_id')} disabled={!projectId}>
                <option value="">Select plot</option>
                {plots.map(p => <option key={p.id} value={p.id}>{p.plot_no} ({p.area_sqyd} SqYd)</option>)}
              </select>
              {errors.plot_id && <p className="text-xs text-red-500 mt-1">{errors.plot_id.message}</p>}
            </div>
            <div>
              <label className="label">Customer *</label>
              <select className="input" {...register('customer_id')}>
                <option value="">Select customer</option>
                {customers.map(c => <option key={c.id} value={c.id}>{c.name} — {c.phone}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Broker</label>
              <select className="input" {...register('broker_id')}>
                <option value="">No broker (direct)</option>
                {brokers.map(b => <option key={b.id} value={b.id}>{b.name} ({b.broker_id})</option>)}
              </select>
            </div>
            <div>
              <label className="label">Stage *</label>
              <select className="input" {...register('stage')}>
                {['token','booking','full_payment'].map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
              </select>
            </div>
            <div><label className="label">Token Amount (&#8377;)</label><input type="number" className="input" {...register('token_amount')} /></div>
            <div><label className="label">Booking Amount (&#8377;)</label><input type="number" className="input" {...register('booking_amount')} /></div>
            <div><label className="label">Full Payment Amount (&#8377;)</label><input type="number" className="input" {...register('full_payment_amount')} /></div>
            <div><label className="label">Total Collected (&#8377;) *</label><input type="number" className="input" {...register('total_collected')} /></div>
          </div>
          <div><label className="label">Notes</label><textarea className="input min-h-[80px]" {...register('notes')} /></div>
          <div className="flex gap-3 pt-2">
            <button type="submit" disabled={mutation.isPending} className="btn-primary">{mutation.isPending ? 'Creating...' : 'Create Booking'}</button>
            <Link to="/bookings" className="btn-secondary">Cancel</Link>
          </div>
        </form>
      </div>
    </div>
  )
}
