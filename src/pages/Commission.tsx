import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { Table } from '@/components/ui/Table.tsx'
import { formatINR, formatDate } from '@/lib/utils'

export default function Commission() {
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['commission_ledger'],
    queryFn: async () => {
      const { data, error } = await supabase.from('bp_commission_ledger').select('*,brokers(name,broker_id),bp_bookings(booking_no)').order('created_at', { ascending: false })
      if (error) throw error; return data
    },
  })

  const cols = [
    { header: 'Broker', render: (r: any) => <div><div className="font-medium">{r.brokers?.name}</div><div className="text-xs text-gray-400">{r.brokers?.broker_id}</div></div> },
    { header: 'Booking', render: (r: any) => <span className="text-xs">{r.bp_bookings?.booking_no || '—'}</span> },
    { header: 'Type', render: (r: any) => <span className="capitalize text-xs">{r.entry_type}</span> },
    { header: 'Amount', render: (r: any) => <span className="font-semibold">{formatINR(r.amount)}</span> },
    { header: 'Balance', render: (r: any) => <span className={`font-semibold ${r.running_balance >= 0 ? 'text-green-700' : 'text-red-600'}`}>{formatINR(r.running_balance)}</span> },
    { header: 'Date', render: (r: any) => formatDate(r.created_at) },
    { header: 'Ref', key: 'reference_id' },
  ]

  return (
    <div>
      <div className="mb-6"><h1 className="text-xl font-bold text-gray-900">Commission Ledger</h1><p className="text-sm text-gray-500">Broker commission credit/debit records</p></div>
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm">
        <Table columns={cols} data={rows} loading={isLoading} />
      </div>
    </div>
  )
}