import { useParams, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import LoadingSpinner from '../../components/ui/LoadingSpinner'
import { ArrowLeft } from 'lucide-react'
import { formatDate, formatINR } from '../../lib/utils'
import { STAGE_COLORS } from '../../constants/enums'

export default function CustomerDetail() {
  const { id } = useParams()

  const { data: customer, isLoading } = useQuery({
    queryKey: ['customer', id],
    queryFn: async () => {
      const { data } = await supabase.from('bp_customers').select('*').eq('id', id).single()
      return data
    },
  })

  const { data: bookings = [] } = useQuery({
    queryKey: ['customer-bookings', id],
    queryFn: async () => {
      const { data } = await supabase.from('bp_bookings').select('*, bp_plots(plot_no), bp_projects(name)').eq('customer_id', id)
      return data
    },
  })

  if (isLoading) return <LoadingSpinner fullPage />

  return (
    <div className="space-y-6 max-w-3xl">
      <div className="flex items-center gap-3">
        <Link to="/customers" className="p-2 rounded-lg hover:bg-slate-100"><ArrowLeft size={16} /></Link>
        <h1 className="page-title">{customer?.name}</h1>
      </div>

      <div className="card p-5 grid grid-cols-2 gap-4 text-sm">
        <div><p className="text-slate-500 text-xs">Phone</p><p className="font-medium mt-0.5">{customer?.phone}</p></div>
        <div><p className="text-slate-500 text-xs">Email</p><p className="font-medium mt-0.5">{customer?.email || '—'}</p></div>
        <div><p className="text-slate-500 text-xs">PAN</p><p className="font-medium mt-0.5">{customer?.pan_no || '—'}</p></div>
        <div><p className="text-slate-500 text-xs">Aadhaar</p><p className="font-medium mt-0.5">{customer?.aadhaar_no || '—'}</p></div>
        <div className="col-span-2"><p className="text-slate-500 text-xs">Address</p><p className="font-medium mt-0.5">{customer?.address || '—'}</p></div>
      </div>

      <div className="card overflow-hidden">
        <div className="p-4 border-b border-slate-200"><h2 className="section-title">Bookings ({bookings.length})</h2></div>
        <table className="w-full text-sm">
          <thead><tr className="bg-slate-50 border-b border-slate-200">
            {['Booking No', 'Project', 'Plot', 'Stage', 'Collected', 'Date'].map(h => (
              <th key={h} className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500">{h}</th>
            ))}
          </tr></thead>
          <tbody>
            {bookings.map(b => (
              <tr key={b.id} className="border-b border-slate-100 hover:bg-slate-50">
                <td className="px-4 py-3 text-teal-700 font-medium"><Link to={`/bookings/${b.id}`}>{b.booking_no}</Link></td>
                <td className="px-4 py-3">{b.bp_projects?.name}</td>
                <td className="px-4 py-3">{b.bp_plots?.plot_no}</td>
                <td className="px-4 py-3"><span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${STAGE_COLORS[b.stage]}`}>{b.stage}</span></td>
                <td className="px-4 py-3">{formatINR(b.total_collected)}</td>
                <td className="px-4 py-3 text-slate-500">{formatDate(b.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}