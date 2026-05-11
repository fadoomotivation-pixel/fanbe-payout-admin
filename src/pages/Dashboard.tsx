import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { formatINR } from '@/lib/utils'

type Row = { label: string; value: string; sub?: string; color?: string; href?: string }

export default function Dashboard() {
  const [loading, setLoading] = useState(true)
  const [tiles, setTiles] = useState<Row[]>([])
  const [payables, setPayables] = useState<{ accrued: number; paidThisMonth: number; pending: number; brokerCount: number }>({ accrued:0, paidThisMonth:0, pending:0, brokerCount:0 })
  const [recentBookings, setRecentBookings] = useState<any[]>([])
  const [recentPayments, setRecentPayments] = useState<any[]>([])

  useEffect(() => {
    async function load() {
      const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0,0,0,0)
      const monthStartISO = monthStart.toISOString()

      const [bookingCount, customerCount, brokerCount, payments, bookings, recentBk, recentPm] = await Promise.all([
        supabase.from('bp_bookings').select('id', { count: 'exact', head: true }).eq('stage', 'booking_done'),
        supabase.from('bp_customers').select('id', { count: 'exact', head: true }),
        supabase.from('brokers').select('id', { count: 'exact', head: true }).eq('status', 'active'),
        supabase.from('bp_payments').select('amount,verification_status,payment_date').eq('verification_status', 'verified'),
        supabase.from('bp_bookings').select('broker_id, commission_amount, stage, application_date'),
        supabase.from('bp_bookings').select('id, booking_no, application_date, total_amount, stage, bp_customers(name)').order('application_date', { ascending: false }).limit(5),
        supabase.from('bp_payments').select('id, amount, payment_type, payment_date, receipt_no, bp_bookings(booking_no, bp_customers(name))').order('payment_date', { ascending: false }).limit(5),
      ])

      const totalRevenue = (payments.data || []).reduce((s, p) => s + Number(p.amount || 0), 0)
      const revenueThisMonth = (payments.data || []).filter(p => (p.payment_date || '') >= monthStartISO.slice(0,10)).reduce((s, p) => s + Number(p.amount || 0), 0)

      const confirmed = (bookings.data || []).filter(b => b.stage === 'booking_done')
      const accrued = confirmed.reduce((s, b) => s + Number(b.commission_amount || 0), 0)
      // Approximate "paid out" — if you have a payouts table, swap this for it.
      const paidThisMonth = 0
      const pending = Math.max(0, accrued - paidThisMonth)
      const brokerSet = new Set(confirmed.filter(b => Number(b.commission_amount || 0) > 0).map(b => b.broker_id).filter(Boolean))

      setTiles([
        { label: 'Active Brokers',    value: String(brokerCount.count || 0), color: 'text-blue-700', href: '/brokers' },
        { label: 'Total Customers',   value: String(customerCount.count || 0), color: 'text-gray-900', href: '/members' },
        { label: 'Confirmed Bookings',value: String(bookingCount.count || 0), color: 'text-emerald-700', href: '/bookings' },
        { label: 'Revenue (verified)',value: formatINR(totalRevenue), sub: `This month: ${formatINR(revenueThisMonth)}`, color: 'text-green-700', href: '/payments' },
      ])
      setPayables({ accrued, paidThisMonth, pending, brokerCount: brokerSet.size })
      setRecentBookings(recentBk.data || [])
      setRecentPayments(recentPm.data || [])
      setLoading(false)
    }
    load()
  }, [])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-sm text-gray-500">Operational health at a glance</p>
      </div>

      {/* Headline tiles */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {(loading ? Array.from({length:4}, () => ({label:'…', value:'—'})) : tiles).map((t: any, i) => {
          const card = (
            <div key={i} className="bg-white rounded-xl border border-gray-100 p-5 shadow-sm hover:border-gray-300 transition-colors">
              <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">{t.label}</p>
              <p className={`text-2xl font-bold mt-1 ${t.color || 'text-gray-900'}`}>{t.value}</p>
              {t.sub && <p className="text-[11px] text-gray-400 mt-1">{t.sub}</p>}
            </div>
          )
          return t.href ? <Link key={i} to={t.href}>{card}</Link> : card
        })}
      </div>

      {/* Broker Payables card */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
        <div className="flex items-start justify-between mb-3">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">Broker Payables</h3>
            <p className="text-xs text-gray-500">Commission earned on confirmed bookings vs. what you've paid out.</p>
          </div>
          <Link to="/payouts" className="text-xs text-blue-600 hover:underline">Open Payouts →</Link>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          <PayTile label="Accrued (Total Owed)" value={formatINR(payables.accrued)}        sub={`${payables.brokerCount} brokers`} color="text-blue-700"/>
          <PayTile label="Paid (This Month)"    value={formatINR(payables.paidThisMonth)}  sub="from Payouts table"                color="text-green-700"/>
          <PayTile label="Pending Payout"       value={formatINR(payables.pending)}        sub="accrued − paid"                    color={payables.pending > 0 ? 'text-orange-700' : 'text-gray-500'}/>
          <PayTile label="Open Withdrawals"     value="—"                                  sub={<Link to="/withdrawals" className="text-blue-600 hover:underline">view →</Link>} color="text-gray-900"/>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
          <div className="flex items-center justify-between mb-3"><h3 className="text-sm font-semibold text-gray-900">Recent Bookings</h3><Link to="/bookings" className="text-xs text-blue-600 hover:underline">view all</Link></div>
          {!recentBookings.length ? <p className="text-sm text-gray-400">No bookings yet.</p> : (
            <div className="divide-y divide-gray-50">
              {recentBookings.map(b => (
                <div key={b.id} className="py-2 flex items-center justify-between text-sm">
                  <div>
                    <div className="font-mono text-xs text-blue-700">{b.booking_no}</div>
                    <div className="text-xs text-gray-500">{b.bp_customers?.name || '—'} · {b.stage}</div>
                  </div>
                  <div className="font-semibold">{formatINR(b.total_amount)}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
          <div className="flex items-center justify-between mb-3"><h3 className="text-sm font-semibold text-gray-900">Recent Payments</h3><Link to="/payments" className="text-xs text-blue-600 hover:underline">view all</Link></div>
          {!recentPayments.length ? <p className="text-sm text-gray-400">No payments yet.</p> : (
            <div className="divide-y divide-gray-50">
              {recentPayments.map(p => (
                <div key={p.id} className="py-2 flex items-center justify-between text-sm">
                  <div>
                    <div className="font-mono text-xs text-gray-700">{p.receipt_no || '—'}</div>
                    <div className="text-xs text-gray-500">{p.bp_bookings?.booking_no} · {p.bp_bookings?.bp_customers?.name || '—'}</div>
                  </div>
                  <div className="font-semibold text-green-700">{formatINR(p.amount)}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function PayTile({ label, value, sub, color = 'text-gray-900' }: any) {
  return (
    <div className="rounded-lg bg-gray-50 border border-gray-100 p-3">
      <div className="text-[11px] text-gray-500 uppercase tracking-wide">{label}</div>
      <div className={`font-bold text-lg ${color}`}>{value}</div>
      {sub && <div className="text-[11px] text-gray-400 mt-0.5">{sub}</div>}
    </div>
  )
}
