import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { formatINR } from '@/lib/utils'

export default function Analytics() {
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let active = true
    async function load() {
      const [pay, book, inst] = await Promise.all([
        supabase.from('bp_payments').select('amount,verification_status,payment_type,payment_date'),
        supabase.from('bp_bookings').select('total_amount,plot_total_price,commission_amount,stage,application_date'),
        supabase.from('emi_installments').select('amount,status,due_date'),
      ])
      if (!active) return
      const payments = pay.data || []
      const bookings = book.data || []
      const installments = inst.data || []

      const totalRevenue = payments
        .filter(p => p.verification_status === 'verified')
        .reduce((s, p) => s + Number(p.amount || 0), 0)

      const totalPayouts = bookings
        .filter(b => b.stage === 'booking_done')
        .reduce((s, b) => s + Number(b.commission_amount || 0), 0)

      const today = new Date().toISOString().slice(0,10)
      const pendingEmi = installments
        .filter(i => i.status !== 'paid' && i.due_date <= today)
        .reduce((s, i) => s + Number(i.amount || 0), 0)

      const confirmedValue = bookings
        .filter(b => b.stage === 'booking_done')
        .reduce((s, b) => s + Number(b.total_amount || b.plot_total_price || 0), 0)

      setData({
        totalRevenue,
        totalPayouts,
        pendingEmi,
        confirmedValue,
        margin: totalRevenue - totalPayouts,
        bookingCount: bookings.filter(b => b.stage === 'booking_done').length,
      })
      setLoading(false)
    }
    load()
    return () => { active = false }
  }, [])

  const cards = data ? [
    { label: 'Confirmed Bookings Value', value: formatINR(data.confirmedValue), sub: `${data.bookingCount} bookings`, color: 'text-gray-900' },
    { label: 'Cash Received (verified)', value: formatINR(data.totalRevenue), sub: 'sum of bp_payments', color: 'text-green-600' },
    { label: 'Broker Commissions Owed', value: formatINR(data.totalPayouts), sub: 'on confirmed bookings', color: 'text-blue-600' },
    { label: 'EMI Overdue (today)', value: formatINR(data.pendingEmi), sub: 'past-due instalments', color: data.pendingEmi > 0 ? 'text-red-600' : 'text-gray-400' },
    { label: 'Net Margin', value: formatINR(data.margin), sub: 'cash − commissions', color: data.margin >= 0 ? 'text-green-600' : 'text-red-600' },
  ] : []

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Analytics</h1>
        <p className="text-sm text-gray-500">Financial summary and performance metrics</p>
      </div>
      {loading ? <div className="text-center py-16 text-gray-400">Loading…</div> : (
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
          {cards.map(c => (
            <div key={c.label} className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">{c.label}</p>
              <p className={`text-2xl font-bold mt-1 ${c.color}`}>{c.value}</p>
              <p className="text-[11px] text-gray-400 mt-1">{c.sub}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
