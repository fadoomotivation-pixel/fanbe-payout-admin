import { useParams, Link } from 'react-router-dom'
import { useQuery, useMutation } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { queryClient } from '../../lib/queryClient'
import LoadingSpinner from '../../components/ui/LoadingSpinner'
import { ArrowLeft, Plus } from 'lucide-react'
import { formatDate, formatINR } from '../../lib/utils'
import { STAGE_COLORS, PAYOUT_STATUS_COLORS } from '../../constants/enums'
import Modal from '../../components/ui/Modal'
import { useState } from 'react'
import toast from 'react-hot-toast'

export default function BookingDetail() {
  const { id } = useParams()
  const [stageOpen, setStageOpen] = useState(false)
  const [newStage, setNewStage] = useState('')
  const [payoutOpen, setPayoutOpen] = useState(false)
  const [payoutForm, setPayoutForm] = useState({ payout_type: 'token', amount: '', tds_applicable: true })

  const { data: booking, isLoading } = useQuery({
    queryKey: ['booking', id],
    queryFn: async () => {
      const { data } = await supabase.from('bp_bookings')
        .select('*, bp_customers(name, phone), bp_plots(plot_no, area_sqyd), bp_projects(name), brokers(name, broker_id)')
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

  const stageMutation = useMutation({
    mutationFn: async () => {
      const updates = { stage: newStage, updated_at: new Date().toISOString() }
      if (newStage === 'token') updates.token_amount = booking.token_amount
      if (newStage === 'booking') updates.booking_amount = booking.booking_amount
      if (newStage === 'full_payment') updates.full_payment_amount = booking.full_payment_amount
      const { error } = await supabase.from('bp_bookings').update(updates).eq('id', id)
      if (error) throw error
      await supabase.from('bp_plots').update({ status: newStage === 'registry_done' ? 'registry_done' : newStage === 'full_payment' ? 'booked' : newStage }).eq('id', booking.plot_id)
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['booking', id] }); toast.success('Stage updated'); setStageOpen(false) }
  })

  const payoutMutation = useMutation({
    mutationFn: async () => {
      const tdsRate = 0.05
      const amount = parseFloat(payoutForm.amount)
      const tds = payoutForm.tds_applicable ? Math.round(amount * tdsRate) : 0
      const { error } = await supabase.from('bp_payout_transactions').insert({
        booking_id: id,
        broker_id: booking.broker_id,
        payout_type: payoutForm.payout_type,
        amount,
        tds_amount: tds,
        net_amount: amount - tds,
        status: 'pending',
      })
      if (error) throw error
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['booking-payouts', id] }); toast.success('Payout created'); setPayoutOpen(false) }
  })

  if (isLoading) return <LoadingSpinner fullPage />

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link to="/bookings" className="p-2 rounded-lg hover:bg-slate-100"><ArrowLeft size={16} /></Link>
          <h1 className="page-title">{booking?.booking_no}</h1>
          <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${STAGE_COLORS[booking?.stage]}`}>{booking?.stage}</span>
        </div>
        <div className="flex gap-2">
          {booking?.broker_id && <button onClick={() => setPayoutOpen(true)} className="btn-secondary"><Plus size={14} />Add Payout</button>}
          <button onClick={() => setStageOpen(true)} className="btn-primary">Update Stage</button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="card p-5 space-y-3 text-sm">
          <h2 className="section-title">Booking Info</h2>
          <div className="grid grid-cols-2 gap-3">
            <div><p className="text-slate-500 text-xs">Customer</p><p className="font-medium mt-0.5">{booking?.bp_customers?.name}</p></div>
            <div><p className="text-slate-500 text-xs">Phone</p><p className="font-medium mt-0.5">{booking?.bp_customers?.phone}</p></div>
            <div><p className="text-slate-500 text-xs">Project</p><p className="font-medium mt-0.5">{booking?.bp_projects?.name}</p></div>
            <div><p className="text-slate-500 text-xs">Plot No</p><p className="font-medium mt-0.5">{booking?.bp_plots?.plot_no}</p></div>
            <div><p className="text-slate-500 text-xs">Area</p><p className="font-medium mt-0.5">{booking?.bp_plots?.area_sqyd} SqYd</p></div>
            <div><p className="text-slate-500 text-xs">Broker</p><p className="font-medium mt-0.5">{booking?.brokers?.name || '\u2014'}</p></div>
          </div>
        </div>
        <div className="card p-5 space-y-3 text-sm">
          <h2 className="section-title">Payment Summary</h2>
          <div className="grid grid-cols-2 gap-3">
            <div><p className="text-slate-500 text-xs">Token Amount</p><p className="font-medium mt-0.5">{formatINR(booking?.token_amount)}</p></div>
            <div><p className="text-slate-500 text-xs">Booking Amount</p><p className="font-medium mt-0.5">{formatINR(booking?.booking_amount)}</p></div>
            <div><p className="text-slate-500 text-xs">Full Payment</p><p className="font-medium mt-0.5">{formatINR(booking?.full_payment_amount)}</p></div>
            <div><p className="text-slate-500 text-xs">Total Collected</p><p className="font-semibold text-green-700 mt-0.5">{formatINR(booking?.total_collected)}</p></div>
          </div>
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="p-4 border-b border-slate-200"><h2 className="section-title">Payout Transactions</h2></div>
        {payouts.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-400">No payouts yet</div>
        ) : (
          <table className="w-full text-sm">
            <thead><tr className="bg-slate-50 border-b border-slate-200">
              {['Type','Gross','TDS','Net','Status','Date'].map(h => (
                <th key={h} className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500">{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {payouts.map(p => (
                <tr key={p.id} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-3 capitalize">{p.payout_type}</td>
                  <td className="px-4 py-3">{formatINR(p.amount)}</td>
                  <td className="px-4 py-3 text-red-600">{formatINR(p.tds_amount)}</td>
                  <td className="px-4 py-3 font-medium text-green-700">{formatINR(p.net_amount)}</td>
                  <td className="px-4 py-3"><span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${PAYOUT_STATUS_COLORS[p.status]}`}>{p.status}</span></td>
                  <td className="px-4 py-3 text-slate-500">{formatDate(p.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <Modal open={stageOpen} onClose={() => setStageOpen(false)} title="Update Booking Stage" size="sm">
        <div className="space-y-4">
          <div>
            <label className="label">New Stage</label>
            <select className="input" value={newStage} onChange={e => setNewStage(e.target.value)}>
              <option value="">Select stage</option>
              {['token','booking','full_payment','registry_done','cancelled'].map(s => (
                <option key={s} value={s}>{s.replace('_', ' ')}</option>
              ))}
            </select>
          </div>
          <div className="flex gap-3 justify-end">
            <button onClick={() => setStageOpen(false)} className="btn-secondary">Cancel</button>
            <button onClick={() => stageMutation.mutate()} disabled={!newStage || stageMutation.isPending} className="btn-primary">Update</button>
          </div>
        </div>
      </Modal>

      <Modal open={payoutOpen} onClose={() => setPayoutOpen(false)} title="Create Payout" size="sm">
        <div className="space-y-4">
          <div>
            <label className="label">Payout Stage</label>
            <select className="input" value={payoutForm.payout_type} onChange={e => setPayoutForm(f => ({ ...f, payout_type: e.target.value }))}>
              {['token','booking','full_payment','registry_done'].map(s => (
                <option key={s} value={s}>{s.replace('_', ' ')}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Commission Amount (&#8377;)</label>
            <input type="number" className="input" value={payoutForm.amount} onChange={e => setPayoutForm(f => ({ ...f, amount: e.target.value }))} />
          </div>
          <div className="flex items-center gap-2">
            <input type="checkbox" id="tds2" checked={payoutForm.tds_applicable} onChange={e => setPayoutForm(f => ({ ...f, tds_applicable: e.target.checked }))} />
            <label htmlFor="tds2" className="text-sm text-slate-700">Apply 5% TDS</label>
          </div>
          {payoutForm.amount && (
            <div className="bg-slate-50 rounded-lg p-3 text-sm space-y-1">
              <div className="flex justify-between"><span className="text-slate-500">Gross</span><span>{formatINR(parseFloat(payoutForm.amount))}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">TDS (5%)</span><span className="text-red-600">- {formatINR(payoutForm.tds_applicable ? Math.round(parseFloat(payoutForm.amount) * 0.05) : 0)}</span></div>
              <div className="flex justify-between font-semibold"><span>Net Payout</span><span className="text-green-700">{formatINR(parseFloat(payoutForm.amount) - (payoutForm.tds_applicable ? Math.round(parseFloat(payoutForm.amount) * 0.05) : 0))}</span></div>
            </div>
          )}
          <div className="flex gap-3 justify-end">
            <button onClick={() => setPayoutOpen(false)} className="btn-secondary">Cancel</button>
            <button onClick={() => payoutMutation.mutate()} disabled={!payoutForm.amount || payoutMutation.isPending} className="btn-primary">Create Payout</button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
