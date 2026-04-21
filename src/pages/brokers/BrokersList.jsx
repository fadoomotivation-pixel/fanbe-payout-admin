import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Search, UserCheck } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import Badge from '../../components/ui/Badge'
import KpiCard from '../../components/ui/KpiCard'

const currency = (v) => `₹${Number(v || 0).toLocaleString('en-IN')}`

export default function BrokersList() {
  const [brokers, setBrokers] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  useEffect(() => {
    fetchBrokers()
  }, [])

  async function fetchBrokers() {
    setLoading(true)
    const { data } = await supabase.from('brokers').select('*').order('created_at', { ascending: false })
    setBrokers(data || [])
    setLoading(false)
  }

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim()
    if (!q) return brokers
    return brokers.filter((b) => Object.values(b || {}).filter(Boolean).some((v) => String(v).toLowerCase().includes(q)))
  }, [brokers, search])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">Brokers</h1>
        <p className="text-sm text-slate-500 mt-1">Monitor broker performance, commission status and reward eligibility.</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <KpiCard title="Total Brokers" value={brokers.length} icon={UserCheck} />
        <KpiCard title="Active Brokers" value={brokers.filter((b) => String(b.status || '').toLowerCase() !== 'inactive').length} color="green" />
        <KpiCard title="Payout Ready" value={brokers.filter((b) => String(b.kyc_status || '').toLowerCase() === 'approved').length} color="blue" />
      </div>

      <div className="card p-4">
        <div className="relative max-w-md">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} className="input pl-9" placeholder="Search broker, phone, city..." />
        </div>
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-4 py-3 text-left font-semibold">Broker</th>
                <th className="px-4 py-3 text-left font-semibold">Contact</th>
                <th className="px-4 py-3 text-left font-semibold">KYC</th>
                <th className="px-4 py-3 text-left font-semibold">Status</th>
                <th className="px-4 py-3 text-right font-semibold">Action</th>
              </tr>
            </thead>
            <tbody>
              {!loading && filtered.length === 0 && <tr><td colSpan="5" className="px-4 py-10 text-center text-slate-500">No brokers found.</td></tr>}
              {filtered.map((broker) => (
                <tr key={broker.id} className="border-t border-slate-100">
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-900">{broker.name || broker.broker_name || 'Unnamed Broker'}</div>
                    <div className="text-xs text-slate-500">{broker.city || broker.company_name || '—'}</div>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{broker.phone || broker.mobile || '—'}</td>
                  <td className="px-4 py-3"><Badge color={String(broker.kyc_status || '').toLowerCase() === 'approved' ? 'green' : 'yellow'}>{broker.kyc_status || 'Pending'}</Badge></td>
                  <td className="px-4 py-3"><Badge color={String(broker.status || '').toLowerCase() === 'active' ? 'green' : 'gray'}>{broker.status || 'Active'}</Badge></td>
                  <td className="px-4 py-3 text-right"><Link to={`/brokers/${broker.id}`} className="text-teal-700 hover:text-teal-800 font-medium">View</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
