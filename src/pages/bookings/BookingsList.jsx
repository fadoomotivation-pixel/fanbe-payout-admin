import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { Link } from 'react-router-dom'
import { Plus } from 'lucide-react'
import LoadingSpinner from '../../components/ui/LoadingSpinner'
import EmptyState from '../../components/ui/EmptyState'
import { formatDate, formatINR } from '../../lib/utils'
import { STAGE_COLORS } from '../../constants/enums'

export default function BookingsList() {
  const [stageFilter, setStageFilter] = useState('')

  const { data: bookings = [], isLoading } = useQuery({
    queryKey: ['bookings', stageFilter],
    queryFn: async () => {
      let q = supabase.from('bp_bookings').select('*, bp_customers(name), bp_plots(plot_no), bp_projects(name), brokers(name)').order('created_at', { ascending: false })
      if (stageFilter) q = q.eq('stage', stageFilter)
      const { data } = await q
      return data
    },
  })

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="page-title">Bookings</h1>
        <Link to="/bookings/new" className="btn-primary"><Plus size={16} />New Booking</Link>
      </div>

      <div className="flex gap-2 flex-wrap">
        {['', 'token', 'booking', 'full_payment', 'registry_done', 'cancelled'].map(s => (
          <button
            key={s}
            onClick={() => setStageFilter(s)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${stageFilter === s ? 'bg-teal-600 text-white' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'}`}
          >
            {s === '' ? 'All' : s.replace('_', ' ')}
          </button>
        ))}
      </div>

      <div className="card overflow-hidden">
        {isLoading ? <LoadingSpinner fullPage /> : bookings.length === 0 ? <EmptyState title="No bookings found" /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="bg-slate-50 border-b border-slate-200">
                {['Booking No', 'Customer', 'Project', 'Plot', 'Broker', 'Stage', 'Collected', 'Date'].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-slate-500">{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {bookings.map(b => (
                  <tr key={b.id} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium text-teal-700"><Link to={`/bookings/${b.id}`}>{b.booking_no}</Link></td>
                    <td className="px-4 py-3">{b.bp_customers?.name}</td>
                    <td className="px-4 py-3">{b.bp_projects?.name}</td>
                    <td className="px-4 py-3">{b.bp_plots?.plot_no}</td>
                    <td className="px-4 py-3 text-slate-500">{b.brokers?.name || '—'}</td>
                    <td className="px-4 py-3"><span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${STAGE_COLORS[b.stage]}`}>{b.stage}</span></td>
                    <td className="px-4 py-3">{formatINR(b.total_collected)}</td>
                    <td className="px-4 py-3 text-slate-500">{formatDate(b.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}