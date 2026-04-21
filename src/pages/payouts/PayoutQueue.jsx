import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import KpiCard from '../../components/ui/KpiCard'
import { Banknote, Clock3, CircleDollarSign } from 'lucide-react'

const currency = (v) => `₹${Number(v || 0).toLocaleString('en-IN')}`

export default function PayoutQueue() {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetchRows()
  }, [])

  async function fetchRows() {
    setLoading(true)
    const { data } = await supabase
      .from('bp_payout_transactions')
      .select('*')
      .order('created_at', { ascending: false })
    setRows(data || [])
    setLoading(false)
  }

  const total = rows.reduce((sum, row) => sum + Number(row.amount || 0), 0)
  const pending = rows.filter((r) => String(r.status || '').toLowerCase() !== 'paid')
  const paid = rows.filter((r) => String(r.status || '').toLowerCase() === 'paid')

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Payout Queue</h1>
        <p className="text-sm text-slate-500 mt-1">Review commission disbursement requests and reward-linked broker payouts.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <KpiCard title="Pending Transactions" value={pending.length} icon={Clock3} color="yellow" />
        <KpiCard title="Paid Transactions" value={paid.length} icon={Banknote} color="green" />
        <KpiCard title="Total Queue Value" value={currency(total)} icon={CircleDollarSign} color="teal" />
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-4 py-3 text-left font-semibold">Reference</th>
                <th className="px-4 py-3 text-left font-semibold">Broker</th>
                <th className="px-4 py-3 text-left font-semibold">Type</th>
                <th className="px-4 py-3 text-left font-semibold">Amount</th>
                <th className="px-4 py-3 text-left font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {!loading && rows.length === 0 && <tr><td colSpan="5" className="px-4 py-10 text-center text-slate-500">No payout transactions available.</td></tr>}
              {rows.map((row) => (
                <tr key={row.id} className="border-t border-slate-100">
                  <td className="px-4 py-3 text-slate-700">{row.reference_no || row.id}</td>
                  <td className="px-4 py-3 text-slate-700">{row.broker_name || row.broker_id || '—'}</td>
                  <td className="px-4 py-3 text-slate-700">{row.transaction_type || 'Commission'}</td>
                  <td className="px-4 py-3 text-slate-700">{currency(row.amount)}</td>
                  <td className="px-4 py-3 text-slate-700">{row.status || 'Pending'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
