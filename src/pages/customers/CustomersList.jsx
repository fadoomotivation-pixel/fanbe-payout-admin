import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { Link } from 'react-router-dom'
import LoadingSpinner from '../../components/ui/LoadingSpinner'
import EmptyState from '../../components/ui/EmptyState'
import { formatDate } from '../../lib/utils'

export default function CustomersList() {
  const { data: customers = [], isLoading } = useQuery({
    queryKey: ['customers'],
    queryFn: async () => {
      const { data } = await supabase.from('bp_customers').select('*').order('created_at', { ascending: false })
      return data
    },
  })

  if (isLoading) return <LoadingSpinner fullPage />

  return (
    <div className="space-y-4">
      <h1 className="page-title">Customers</h1>
      <div className="card overflow-hidden">
        {customers.length === 0 ? <EmptyState title="No customers found" /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="bg-slate-50 border-b border-slate-200">
                {['Name', 'Phone', 'Email', 'PAN', 'Aadhaar', 'Added'].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-slate-500">{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {customers.map(c => (
                  <tr key={c.id} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium text-teal-700"><Link to={`/customers/${c.id}`}>{c.name}</Link></td>
                    <td className="px-4 py-3 text-slate-500">{c.phone}</td>
                    <td className="px-4 py-3 text-slate-500">{c.email || '—'}</td>
                    <td className="px-4 py-3 text-slate-500">{c.pan_no || '—'}</td>
                    <td className="px-4 py-3 text-slate-500">{c.aadhaar_no || '—'}</td>
                    <td className="px-4 py-3 text-slate-500">{formatDate(c.created_at)}</td>
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