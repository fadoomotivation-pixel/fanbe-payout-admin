import { useParams, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { Badge } from '@/components/ui/Badge.tsx'
import { Table } from '@/components/ui/Table.tsx'
import { formatINR, formatDate } from '@/lib/utils'
import { ArrowLeft, Users, TrendingUp, Wallet, Award } from 'lucide-react'

export default function BrokerProfile() {
  const { id } = useParams()

  const { data: broker } = useQuery({
    queryKey: ['broker', id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('brokers')
        .select('*, sponsor:sponsor_id(id,name,broker_id,rank)')
        .eq('id', id!)
        .single()
      if (error) throw error
      return data
    },
  })

  const { data: bookings = [] } = useQuery({
    queryKey: ['broker_bookings', id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('bp_bookings')
        .select('id, booking_no, total_amount, commission_amount, commission_rate, stage, application_date, bp_customers(name)')
        .eq('broker_id', id!)
        .order('application_date', { ascending: false })
      if (error) throw error
      return data
    },
  })

  const { data: downline = [] } = useQuery({
    queryKey: ['broker_downline', id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('brokers')
        .select('id, name, broker_id, rank, status')
        .eq('sponsor_id', id!)
      if (error) throw error
      return data
    },
  })

  // Distributed commissions for this broker — same source the broker's own dashboard reads.
  // We don't sum bp_bookings.commission_amount because that's the promised lifetime commission
  // (over-states earnings by the unpaid portion of every booking).
  const { data: distributions = [] } = useQuery({
    queryKey: ['broker_distributions', id],
    enabled: !!id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('payout_distributions')
        .select('net_payout, created_at')
        .eq('beneficiary_broker_id', id!)
      if (error) throw error
      return data || []
    },
  })

  const { data: rank } = useQuery({
    queryKey: ['broker_rank', broker?.rank],
    enabled: !!broker?.rank,
    queryFn: async () => {
      const { data } = await supabase
        .from('commission_ranks')
        .select('*')
        .eq('rank_name', broker!.rank)
        .maybeSingle()
      return data
    },
  })

  const confirmed   = (bookings as any[]).filter((b: any) => b.stage === 'booking_done')
  const earnedTotal = (distributions as any[]).reduce((s: number, d: any) => s + Number(d.net_payout || 0), 0)
  const currentYear = new Date().getFullYear()
  const earnedYTD   = (distributions as any[])
    .filter((d: any) => d.created_at && new Date(d.created_at).getFullYear() === currentYear)
    .reduce((s: number, d: any) => s + Number(d.net_payout || 0), 0)
  const totalVolume = confirmed.reduce((s: number, b: any) => s + Number(b.total_amount || 0), 0)

  if (!broker) return <div className="p-8 text-center text-gray-400 text-sm">Loading broker…</div>

  return (
    <div className="space-y-6">
      <Link to="/brokers" className="text-gray-500 hover:text-gray-900 inline-flex items-center gap-1 text-sm">
        <ArrowLeft size={14}/>Back to Brokers
      </Link>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">{broker.name}</h1>
            <div className="text-sm text-gray-500 mt-1">
              <span className="font-mono bg-gray-100 px-2 py-0.5 rounded text-xs">{broker.broker_id}</span>
              {broker.phone && ` · ${broker.phone}`}
              {broker.email && ` · ${broker.email}`}
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Badge label={broker.rank || '—'} className="bg-blue-100 text-blue-700"/>
              <Badge label={broker.status || 'unknown'} className={broker.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}/>
              {broker.kyc_status && <Badge label={`KYC: ${broker.kyc_status}`} className="bg-gray-100 text-gray-700"/>}
              {rank?.commission_pct != null && <Badge label={`${rank.commission_pct}% commission`} className="bg-amber-100 text-amber-700"/>}
            </div>
            {broker.sponsor && (
              <div className="mt-3 text-xs text-gray-500">
                Sponsor: <Link to={`/brokers/${broker.sponsor.id}`} className="text-blue-600 hover:underline">{broker.sponsor.name}</Link> [{broker.sponsor.broker_id}]
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatTile icon={<Wallet size={16}/>}     label="Earned (Distributed)" value={formatINR(earnedTotal)} sub={`${distributions.length} MLM credits · ${confirmed.length} confirmed bookings`} color="text-green-700"/>
        <StatTile icon={<TrendingUp size={16}/>} label="Earned YTD"           value={formatINR(earnedYTD)}                                                                                       color="text-blue-700"/>
        <StatTile icon={<Award size={16}/>}      label="Sales Volume"    value={formatINR(totalVolume)} sub="confirmed booking value"                  color="text-gray-900"/>
        <StatTile icon={<Users size={16}/>}      label="Direct Downline" value={String(downline.length)} sub={`rank ${broker.rank || '—'}`}             color="text-purple-700"/>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 text-sm font-semibold text-gray-700">Bookings ({bookings.length})</div>
        <Table
          columns={[
            { header: 'Booking No', render: (r: any) => <span className="font-mono text-xs font-semibold text-blue-700">{r.booking_no}</span> },
            { header: 'Customer',   render: (r: any) => r.bp_customers?.name || '—' },
            { header: 'Stage',      render: (r: any) => <Badge label={r.stage} className="bg-gray-100 text-gray-700"/> },
            { header: 'Total Value',render: (r: any) => formatINR(r.total_amount) },
            { header: '%',          render: (r: any) => `${r.commission_rate || 0}%` },
            { header: 'Commission', render: (r: any) => <span className="font-semibold text-blue-700">{formatINR(r.commission_amount || 0)}</span> },
            { header: 'Date',       render: (r: any) => <span className="text-xs text-gray-500">{formatDate(r.application_date)}</span> },
          ]}
          data={bookings}
        />
      </div>

      {downline.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 text-sm font-semibold text-gray-700">Direct Downline ({downline.length})</div>
          <Table
            columns={[
              { header: 'Broker ID', render: (r: any) => <span className="font-mono text-xs">{r.broker_id}</span> },
              { header: 'Name',      render: (r: any) => <Link to={`/brokers/${r.id}`} className="text-blue-600 hover:underline">{r.name}</Link> },
              { header: 'Rank',      render: (r: any) => r.rank },
              { header: 'Status',    render: (r: any) => <Badge label={r.status} className={r.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}/> },
            ]}
            data={downline}
          />
        </div>
      )}
    </div>
  )
}

function StatTile({ icon, label, value, sub, color = 'text-gray-900' }: any) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-4 shadow-sm">
      <div className="flex items-center gap-2 text-gray-400 mb-1">{icon}<span className="text-xs">{label}</span></div>
      <div className={`text-xl font-bold ${color}`}>{value}</div>
      {sub && <div className="text-[11px] text-gray-400 mt-0.5">{sub}</div>}
    </div>
  )
}
