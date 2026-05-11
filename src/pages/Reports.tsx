import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import { formatINR } from '@/lib/utils'

type Tab = 'payments' | 'commissions' | 'emi_due'

export default function Reports() {
  const [rows, setRows] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<Tab>('payments')

  useEffect(() => {
    setLoading(true)
    const run = async () => {
      if (tab === 'payments') {
        const { data } = await supabase
          .from('bp_payments')
          .select('id, amount, payment_type, payment_mode, verification_status, payment_date, receipt_no, bp_bookings(booking_no, bp_customers(name))')
          .order('payment_date', { ascending: false })
          .limit(100)
        setRows(data || [])
      } else if (tab === 'commissions') {
        const { data } = await supabase
          .from('bp_bookings')
          .select('id, booking_no, total_amount, commission_amount, commission_rate, stage, application_date, brokers(name, broker_id)')
          .eq('stage', 'booking_done')
          .order('application_date', { ascending: false })
          .limit(100)
        setRows(data || [])
      } else {
        const today = new Date().toISOString().slice(0,10)
        const { data } = await supabase
          .from('emi_installments')
          .select('id, seq, due_date, amount, status, emi_schedules(bp_bookings(booking_no, bp_customers(name)))')
          .neq('status', 'paid')
          .lte('due_date', today)
          .order('due_date', { ascending: true })
          .limit(100)
        setRows(data || [])
      }
      setLoading(false)
    }
    run()
  }, [tab])

  const exportCsv = () => {
    if (!rows.length) return
    const flat = rows.map(r => {
      if (tab === 'payments') return {
        receipt_no: r.receipt_no || '', booking: r.bp_bookings?.booking_no || '',
        customer: r.bp_bookings?.bp_customers?.name || '',
        amount: r.amount, type: r.payment_type, mode: r.payment_mode,
        status: r.verification_status, date: r.payment_date,
      }
      if (tab === 'commissions') return {
        booking: r.booking_no, broker: r.brokers?.name || '',
        broker_id: r.brokers?.broker_id || '',
        total: r.total_amount, commission_pct: r.commission_rate,
        commission_amount: r.commission_amount, date: r.application_date,
      }
      return {
        booking: r.emi_schedules?.bp_bookings?.booking_no || '',
        customer: r.emi_schedules?.bp_bookings?.bp_customers?.name || '',
        seq: r.seq, amount: r.amount, due_date: r.due_date, status: r.status,
      }
    })
    const headers = Object.keys(flat[0])
    const csv = [headers.join(','), ...flat.map(r => headers.map(h => JSON.stringify((r as any)[h] ?? '')).join(','))].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `${tab}-${new Date().toISOString().slice(0,10)}.csv`; a.click()
    URL.revokeObjectURL(url)
  }

  const tabs: { key: Tab; label: string }[] = [
    { key: 'payments',    label: 'Payments Received' },
    { key: 'commissions', label: 'Broker Commissions' },
    { key: 'emi_due',     label: 'EMI Due / Overdue' },
  ]

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Reports</h1>
          <p className="text-sm text-gray-500">Export and review transactions</p>
        </div>
        <button onClick={exportCsv} disabled={!rows.length} className="px-4 py-2 rounded-lg text-sm font-medium bg-gray-900 text-white disabled:bg-gray-300">Export CSV</button>
      </div>

      <div className="flex gap-2">
        {tabs.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${tab === t.key ? 'bg-blue-600 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="bg-gray-50 border-y border-gray-100">
              {tab === 'payments' && ['Receipt', 'Booking', 'Customer', 'Type', 'Mode', 'Amount', 'Status', 'Date'].map(h => <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">{h}</th>)}
              {tab === 'commissions' && ['Booking', 'Broker', 'Total Value', '%', 'Commission', 'Date'].map(h => <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">{h}</th>)}
              {tab === 'emi_due' && ['Booking', 'Customer', '#', 'Amount', 'Due', 'Status'].map(h => <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">{h}</th>)}
            </tr></thead>
            <tbody className="divide-y divide-gray-50">
              {loading ? <tr><td colSpan={8} className="py-12 text-center text-gray-400">Loading…</td></tr>
              : !rows.length ? <tr><td colSpan={8} className="py-12 text-center text-gray-400">No records</td></tr>
              : rows.map((r: any) => (
                <tr key={r.id} className="hover:bg-blue-50/30">
                  {tab === 'payments' && (<>
                    <td className="px-4 py-3 font-mono text-xs text-gray-500">{r.receipt_no || '—'}</td>
                    <td className="px-4 py-3 text-gray-700">{r.bp_bookings?.booking_no || '—'}</td>
                    <td className="px-4 py-3 text-gray-700">{r.bp_bookings?.bp_customers?.name || '—'}</td>
                    <td className="px-4 py-3 text-gray-700 uppercase text-xs">{r.payment_type}</td>
                    <td className="px-4 py-3 text-gray-700 uppercase text-xs">{r.payment_mode}</td>
                    <td className="px-4 py-3 font-semibold">{formatINR(r.amount)}</td>
                    <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${r.verification_status === 'verified' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>{r.verification_status}</span></td>
                    <td className="px-4 py-3 text-gray-400 text-xs">{r.payment_date}</td>
                  </>)}
                  {tab === 'commissions' && (<>
                    <td className="px-4 py-3 text-gray-700">{r.booking_no}</td>
                    <td className="px-4 py-3 text-gray-700">{r.brokers?.name || '—'} <span className="text-xs text-gray-400">[{r.brokers?.broker_id || '—'}]</span></td>
                    <td className="px-4 py-3">{formatINR(r.total_amount)}</td>
                    <td className="px-4 py-3 text-gray-600">{r.commission_rate || 0}%</td>
                    <td className="px-4 py-3 font-semibold text-blue-700">{formatINR(r.commission_amount || 0)}</td>
                    <td className="px-4 py-3 text-gray-400 text-xs">{r.application_date}</td>
                  </>)}
                  {tab === 'emi_due' && (<>
                    <td className="px-4 py-3 text-gray-700">{r.emi_schedules?.bp_bookings?.booking_no || '—'}</td>
                    <td className="px-4 py-3 text-gray-700">{r.emi_schedules?.bp_bookings?.bp_customers?.name || '—'}</td>
                    <td className="px-4 py-3 text-gray-500">{r.seq}</td>
                    <td className="px-4 py-3 font-semibold">{formatINR(r.amount)}</td>
                    <td className="px-4 py-3 text-red-600 font-semibold text-xs">{r.due_date}</td>
                    <td className="px-4 py-3"><span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">{r.status}</span></td>
                  </>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
