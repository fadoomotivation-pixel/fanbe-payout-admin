import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import { StatCard } from '@/components/ui/StatCard.tsx'
import { Users, Building2, CreditCard, Banknote, TrendingUp, Clock, UserCheck, UserX, Wallet, AlertTriangle } from 'lucide-react'

type DashboardStats = {
  brokers: number
  activeBrokers: number
  inactiveBrokers: number
  projects: number
  bookings: number
  pendingPayouts: number
  totalRevenue: number
  pendingKYC: number
  monthWithdrawals: number
  pendingEmiAmount: number
}

export default function Dashboard() {
  const [stats, setStats] = useState<DashboardStats>({ brokers:0, activeBrokers:0, inactiveBrokers:0, projects:0, bookings:0, pendingPayouts:0, totalRevenue:0, pendingKYC:0, monthWithdrawals:0, pendingEmiAmount:0 })
  const [loading, setLoading] = useState(true)
  const [recentPayouts, setRecentPayouts] = useState<any[]>([])
  const [newAgents, setNewAgents] = useState<any[]>([])
  const [newCustomers, setNewCustomers] = useState<any[]>([])

  useEffect(() => {
    async function load() {
      const monthStart = new Date()
      monthStart.setDate(1)
      monthStart.setHours(0,0,0,0)
      const monthStartISO = monthStart.toISOString()

      const [
        b,
        bActive,
        bInactive,
        p,
        bk,
        py,
        kyc,
        monthPayouts,
        emiBookings,
        agentsThisMonth,
        customersThisMonth,
      ] = await Promise.all([
        supabase.from('brokers').select('id',{count:'exact',head:true}),
        supabase.from('brokers').select('id',{count:'exact',head:true}).eq('status','active'),
        supabase.from('brokers').select('id',{count:'exact',head:true}).neq('status','active'),
        supabase.from('projects').select('id',{count:'exact',head:true}),
        supabase.from('bookings').select('id',{count:'exact',head:true}),
        supabase.from('payouts').select('id,amount,status').eq('status','pending'),
        supabase.from('brokers').select('id',{count:'exact',head:true}).eq('kyc_status','pending'),
        supabase.from('payouts').select('amount').eq('status','paid').gte('created_at', monthStartISO),
        supabase.from('bp_bookings').select('id, balance_due, payment_type').eq('payment_type', 'emi').gt('balance_due', 0),
        supabase.from('brokers').select('id,name,status,created_at').gte('created_at', monthStartISO).order('created_at',{ascending:false}).limit(5),
        supabase.from('bp_customers').select('id,name,mobile,created_at').gte('created_at', monthStartISO).order('created_at',{ascending:false}).limit(5),
      ])
      const totalRevenue = await supabase.from('payments').select('amount').eq('status','paid')
      const rev = totalRevenue.data?.reduce((s:number,r:any)=>s+(Number(r.amount)||0),0)||0
      const pendingAmt = py.data?.reduce((s:number,r:any)=>s+(Number(r.amount)||0),0)||0
      const paidThisMonth = monthPayouts.data?.reduce((s:number,r:any)=>s+(Number(r.amount)||0),0)||0
      const emiPending = emiBookings.data?.reduce((s:number,r:any)=>s+(Number(r.balance_due)||0),0)||0

      setStats({
        brokers:b.count||0,
        activeBrokers:bActive.count||0,
        inactiveBrokers:bInactive.count||0,
        projects:p.count||0,
        bookings:bk.count||0,
        pendingPayouts:pendingAmt,
        totalRevenue:rev,
        pendingKYC:kyc.count||0,
        monthWithdrawals:paidThisMonth,
        pendingEmiAmount:emiPending,
      })
      setNewAgents(agentsThisMonth.data||[])
      setNewCustomers(customersThisMonth.data||[])
      const recent = await supabase.from('payouts').select('id,amount,status,created_at,broker_id,brokers(name)').order('created_at',{ascending:false}).limit(5)
      setRecentPayouts(recent.data||[])
      setLoading(false)
    }
    load()
  },[])

  const fmt = (n:number) => '₹'+n.toLocaleString('en-IN')
  const bookingMix = useMemo(() => {
    const total = stats.bookings || 1
    return {
      activePct: Math.round((stats.activeBrokers / (stats.brokers || 1)) * 100),
      inactivePct: Math.round((stats.inactiveBrokers / (stats.brokers || 1)) * 100),
      bookingPerBroker: (stats.bookings / total).toFixed(1),
    }
  }, [stats])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-sm text-gray-500">Operational intelligence for payouts, broker growth and booking health</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4">
        <StatCard title="Total Brokers" value={loading?'—':stats.brokers} icon={Users} color="blue"/>
        <StatCard title="Active Brokers" value={loading?'—':stats.activeBrokers} icon={UserCheck} color="green"/>
        <StatCard title="Inactive Brokers" value={loading?'—':stats.inactiveBrokers} icon={UserX} color="red"/>
        <StatCard title="Projects" value={loading?'—':stats.projects} icon={Building2} color="indigo"/>
        <StatCard title="Total Bookings" value={loading?'—':stats.bookings} icon={CreditCard} color="purple"/>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Pending Withdrawals" value={loading?'—':fmt(stats.pendingPayouts)} icon={Banknote} color="yellow" sub="awaiting approval"/>
        <StatCard title="Monthly Withdrawals" value={loading?'—':fmt(stats.monthWithdrawals)} icon={Wallet} color="blue" sub="paid in current month"/>
        <StatCard title="Revenue Collected" value={loading?'—':fmt(stats.totalRevenue)} icon={TrendingUp} color="green"/>
        <StatCard title="Pending EMI" value={loading?'—':fmt(stats.pendingEmiAmount)} icon={AlertTriangle} color="red" sub="total unpaid EMI due"/>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
          <h3 className="text-sm font-semibold text-gray-900 mb-3">Broker Status Split</h3>
          <div className="space-y-3 text-sm">
            <div>
              <div className="flex justify-between mb-1"><span>Active</span><span>{loading?'—':`${bookingMix.activePct}%`}</span></div>
              <div className="h-2 bg-gray-100 rounded"><div className="h-2 bg-green-500 rounded" style={{width:`${bookingMix.activePct}%`}} /></div>
            </div>
            <div>
              <div className="flex justify-between mb-1"><span>Inactive</span><span>{loading?'—':`${bookingMix.inactivePct}%`}</span></div>
              <div className="h-2 bg-gray-100 rounded"><div className="h-2 bg-red-500 rounded" style={{width:`${bookingMix.inactivePct}%`}} /></div>
            </div>
          </div>
          <p className="text-xs text-gray-500 mt-3">Pending KYC: <span className="font-semibold">{loading?'—':stats.pendingKYC}</span></p>
        </div>

        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 lg:col-span-2">
          <h3 className="text-sm font-semibold text-gray-900 mb-3">Recent Payouts</h3>
          <div className="divide-y divide-gray-50">
            {recentPayouts.length===0&&<div className="py-6 text-center text-gray-400 text-sm">{loading?'Loading…':'No payouts yet'}</div>}
            {recentPayouts.map(p=>(
              <div key={p.id} className="py-2 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-800">{(p.brokers as any)?.name||'—'}</p>
                  <p className="text-xs text-gray-400">{new Date(p.created_at).toLocaleDateString('en-IN')}</p>
                </div>
                <p className="text-sm font-semibold text-gray-900">{fmt(Number(p.amount))}</p>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <SimpleTable title="New Agents (This Month)" rows={newAgents} loading={loading} cols={["name","status","created_at"]} />
        <SimpleTable title="New Customers (This Month)" rows={newCustomers} loading={loading} cols={["name","mobile","created_at"]} />
      </div>
    </div>
  )
}

function SimpleTable({ title, rows, loading, cols }: { title: string, rows: any[], loading: boolean, cols: string[] }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4">
      <h3 className="text-sm font-semibold text-gray-900 mb-3">{title}</h3>
      {loading ? <p className="text-sm text-gray-400">Loading…</p> : rows.length === 0 ? <p className="text-sm text-gray-400">No records this month.</p> : (
        <div className="space-y-2">
          {rows.map(r => (
            <div key={r.id} className="flex justify-between text-sm border-b border-gray-50 pb-1">
              <span className="font-medium text-gray-800">{r[cols[0]] || '—'}</span>
              <span className="text-gray-500">{cols[1] === 'created_at' ? new Date(r[cols[1]]).toLocaleDateString('en-IN') : (r[cols[1]] || '—')}</span>
              <span className="text-gray-400">{new Date(r[cols[2]]).toLocaleDateString('en-IN')}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
