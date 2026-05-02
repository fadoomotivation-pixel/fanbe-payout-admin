import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { LogOut, Users, Wallet, Award, TrendingUp, ArrowUpRight, AlertCircle, ChevronRight } from 'lucide-react'
import toast from 'react-hot-toast'

function formatINR(n: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n || 0)
}
function formatDate(d: any) { return d ? new Date(d).toLocaleDateString('en-IN') : '—' }

export default function BrokerDashboard() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [broker, setBroker] = useState<any>(null)
  const [downline, setDownline] = useState<any[]>([])
  const [payouts, setPayouts] = useState<any[]>([])
  const [withdrawals, setWithdrawals] = useState<any[]>([])
  const [customers, setCustomers] = useState<any[]>([])
  const [expandedCust, setExpandedCust] = useState<string|null>(null)

  useEffect(() => { (async () => {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) { navigate('/broker/login'); return }
    const { data: b, error } = await supabase
      .from('brokers')
      .select('*, sponsor:sponsor_id(id,name,broker_id,rank)')
      .eq('auth_user_id', user.id).maybeSingle()
    if (error || !b) { toast.error('Broker profile not linked'); await supabase.auth.signOut(); navigate('/broker/login'); return }
    setBroker(b)

    const { data: dl } = await supabase.from('brokers').select('id,name,broker_id,rank,phone').eq('sponsor_id', b.id)
    setDownline(dl || [])
    const { data: po } = await supabase.from('payout_distributions').select('*').eq('beneficiary_broker_id', b.id).order('created_at', { ascending: false }).limit(10)
    setPayouts(po || [])
    const { data: wd } = await supabase.from('withdrawal_requests').select('*').eq('broker_id', b.id).order('created_at', { ascending: false }).limit(10)
    setWithdrawals(wd || [])

    // My customers — derived from bookings where I'm the broker
    const { data: bookings } = await supabase
      .from('bp_bookings')
      .select('id, booking_no, customer_id, total_amount, booking_amount, stage, scheme_name, bp_customers(id,customer_code,name,phone,father_or_husband_name), bp_plots(plot_no,size_sqyd), bp_projects(name)')
      .eq('broker_id', b.id)
      .order('created_at', { ascending: false })
    const grouped: Record<string, any> = {}
    for (const bk of (bookings || []) as any[]) {
      const cid = bk.customer_id; if (!cid) continue
      if (!grouped[cid]) grouped[cid] = {
        customer: bk.bp_customers, bookings: [], totalCost: 0, totalPaid: 0, outstanding: 0,
        overdueCount: 0, nextDue: null,
      }
      grouped[cid].bookings.push(bk)
      grouped[cid].totalCost += Number(bk.total_amount || 0)
    }
    // Fetch payments + EMI for each booking once
    const allBookingIds = (bookings || []).map((bk: any) => bk.id)
    if (allBookingIds.length) {
      const [{ data: payments }, { data: scheds }] = await Promise.all([
        supabase.from('bp_payments').select('booking_id, amount, verification_status').in('booking_id', allBookingIds),
        supabase.from('emi_schedules').select('id, booking_id').in('booking_id', allBookingIds),
      ])
      const schedIds = (scheds || []).map((s: any) => s.id)
      const { data: insts } = schedIds.length
        ? await supabase.from('emi_installments').select('schedule_id, due_date, amount, status').in('schedule_id', schedIds)
        : { data: [] }
      // index payment paid amount per booking
      for (const p of (payments || []) as any[]) {
        const bk = (bookings || []).find((x: any) => x.id === p.booking_id) as any
        if (!bk) continue
        if (p.verification_status === 'verified') grouped[bk.customer_id].totalPaid += Number(p.amount || 0)
      }
      // overdue / next-due per customer
      const schedToBooking: Record<string, string> = {}
      for (const s of (scheds || []) as any[]) schedToBooking[s.id] = s.booking_id
      for (const i of (insts || []) as any[]) {
        const bid = schedToBooking[i.schedule_id]; if (!bid) continue
        const bk = (bookings || []).find((x: any) => x.id === bid) as any; if (!bk) continue
        const cid = bk.customer_id
        if (i.status !== 'paid' && new Date(i.due_date) < new Date()) grouped[cid].overdueCount++
        if (i.status !== 'paid') {
          const nd = grouped[cid].nextDue
          if (!nd || i.due_date < nd.due_date) grouped[cid].nextDue = i
        }
      }
    }
    Object.values(grouped).forEach((g: any) => g.outstanding = Math.max(0, g.totalCost - g.totalPaid))
    setCustomers(Object.values(grouped))
    setLoading(false)
  })() }, [navigate])

  const logout = async () => { await supabase.auth.signOut(); navigate('/broker/login') }

  if (loading) return <div className="min-h-screen flex items-center justify-center"><div className="w-8 h-8 border-2 border-emerald-600 border-t-transparent rounded-full animate-spin"/></div>

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-emerald-600 text-white">
        <div className="max-w-5xl mx-auto px-6 py-4 flex items-center justify-between">
          <div>
            <div className="text-xs opacity-80">Broker Portal</div>
            <div className="font-bold text-lg">{broker?.name} <span className="font-mono text-xs opacity-80">[{broker?.broker_id}]</span></div>
          </div>
          <button onClick={logout} className="flex items-center gap-1 text-sm bg-white/10 hover:bg-white/20 rounded-lg px-3 py-1.5"><LogOut size={14}/>Logout</button>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-6 py-6 space-y-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Stat icon={Award}      label="Rank"             value={<span className="capitalize">{broker?.rank || '—'}</span>} />
          <Stat icon={Wallet}     label="Wallet Balance"   value={formatINR(broker?.wallet_balance)} />
          <Stat icon={TrendingUp} label="Lifetime Business" value={formatINR(broker?.lifetime_business)} />
          <Stat icon={Users}      label="Direct Team"      value={String(downline.length)} />
        </div>

        {broker?.kyc_status !== 'approved' && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3">
            <AlertCircle size={18} className="text-amber-600 mt-0.5"/>
            <div className="text-sm text-amber-900">
              <b>KYC {broker?.kyc_status || 'pending'}</b> — payouts will release after admin approves your KYC.
            </div>
          </div>
        )}

        <Section title="My sponsor (upline)">
          {broker?.sponsor ? (
            <div className="flex items-center justify-between">
              <div><div className="font-semibold">{broker.sponsor.name}</div><div className="text-xs text-gray-500 font-mono">[{broker.sponsor.broker_id}] · {broker.sponsor.rank}</div></div>
              <ArrowUpRight size={18} className="text-emerald-600"/>
            </div>
          ) : <p className="text-sm text-gray-500">You are at the top of your tree — no sponsor.</p>}
        </Section>

        <Section title={`My Customers (${customers.length})`}>
          {customers.length === 0 ? <p className="text-sm text-gray-500">No customers attached to your bookings yet.</p> : (
            <div className="divide-y divide-gray-100">
              {customers.map((g: any) => {
                const open = expandedCust === g.customer.id
                return (
                  <div key={g.customer.id}>
                    <button onClick={() => setExpandedCust(open ? null : g.customer.id)} className="w-full text-left py-3 flex items-center justify-between hover:bg-gray-50 rounded-lg px-2">
                      <div>
                        <div className="font-mono text-[11px] text-gray-500">{g.customer.customer_code || '—'}</div>
                        <div className="font-semibold text-sm">{g.customer.name}</div>
                        <div className="text-xs text-gray-500">{g.customer.phone}{g.customer.father_or_husband_name ? ` · S/o ${g.customer.father_or_husband_name}` : ''}</div>
                      </div>
                      <div className="text-right">
                        <div className="text-xs text-gray-500">Cost / Paid</div>
                        <div className="text-sm font-semibold">{formatINR(g.totalCost)} <span className="text-green-700">· {formatINR(g.totalPaid)}</span></div>
                        {g.overdueCount > 0 && <div className="text-[10px] text-red-700 font-semibold">{g.overdueCount} overdue</div>}
                        {g.nextDue && g.overdueCount === 0 && <div className="text-[10px] text-amber-700">Next due {formatDate(g.nextDue.due_date)}</div>}
                      </div>
                      <ChevronRight size={14} className={`ml-2 text-gray-400 transition-transform ${open ? 'rotate-90' : ''}`}/>
                    </button>
                    {open && (
                      <div className="px-2 pb-3 space-y-2">
                        {g.bookings.map((b: any) => (
                          <div key={b.id} className="bg-gray-50 rounded-lg p-3 text-xs">
                            <div className="flex items-center justify-between">
                              <div>
                                <div className="font-mono text-blue-700 font-semibold">{b.booking_no}</div>
                                <div>{b.scheme_name || b.bp_projects?.name || '—'} · Plot {b.bp_plots?.plot_no || '—'} ({b.bp_plots?.size_sqyd || '—'} sq)</div>
                                <div className="text-gray-500">Stage: <span className="capitalize">{b.stage?.replace(/_/g,' ')}</span> · Booking amt {formatINR(b.booking_amount)}</div>
                              </div>
                              <div className="text-right font-semibold text-green-700">{formatINR(b.total_amount)}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </Section>

        <Section title={`My direct team (${downline.length})`}>
          {downline.length === 0 ? <p className="text-sm text-gray-500">No direct downline yet.</p> : (
            <div className="divide-y divide-gray-100">
              {downline.map(d => (
                <div key={d.id} className="py-2 flex items-center justify-between">
                  <div><div className="font-medium text-sm">{d.name}</div><div className="text-xs text-gray-500 font-mono">[{d.broker_id}] · {d.rank}</div></div>
                  <div className="text-xs text-gray-400">{d.phone}</div>
                </div>
              ))}
            </div>
          )}
        </Section>

        <Section title="Recent payouts">
          {payouts.length === 0 ? <p className="text-sm text-gray-500">No payouts yet.</p> : (
            <table className="w-full text-sm">
              <thead className="text-xs text-gray-500 uppercase"><tr><th className="text-left py-2">Date</th><th className="text-left">Type</th><th className="text-left">Level</th><th className="text-right">Gross</th><th className="text-right">Net</th></tr></thead>
              <tbody className="divide-y divide-gray-100">
                {payouts.map(p => (
                  <tr key={p.id}>
                    <td className="py-2 text-xs">{formatDate(p.created_at)}</td>
                    <td className="text-xs capitalize">{p.income_type}</td>
                    <td className="text-xs">L{p.level}</td>
                    <td className="text-right text-xs">{formatINR(p.gross_payout)}</td>
                    <td className="text-right font-semibold text-emerald-700">{formatINR(p.net_payout)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Section>

        <Section title="Withdrawal requests">
          {withdrawals.length === 0 ? <p className="text-sm text-gray-500">No withdrawal requests yet.</p> : (
            <div className="divide-y divide-gray-100">
              {withdrawals.map(w => (
                <div key={w.id} className="py-2 flex items-center justify-between text-sm">
                  <div><div className="font-medium">{formatINR(w.amount)} → Net {formatINR(w.net_amount)}</div><div className="text-xs text-gray-500">{formatDate(w.created_at)} · {w.bank_name || ''}</div></div>
                  <span className={`text-xs px-2 py-0.5 rounded-full capitalize ${w.status === 'paid' ? 'bg-green-100 text-green-700' : w.status === 'rejected' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>{w.status}</span>
                </div>
              ))}
            </div>
          )}
        </Section>
      </main>
    </div>
  )
}

function Stat({ icon: Icon, label, value }: any) {
  return (
    <div className="bg-white rounded-xl p-4 border border-gray-100 shadow-sm">
      <div className="flex items-center gap-2 text-xs text-gray-500"><Icon size={14}/>{label}</div>
      <div className="text-xl font-bold mt-1 text-gray-900">{value}</div>
    </div>
  )
}
function Section({ title, children }: any) {
  return (
    <section className="bg-white rounded-xl p-5 border border-gray-100 shadow-sm">
      <h3 className="text-sm font-semibold text-gray-700 mb-3">{title}</h3>
      {children}
    </section>
  )
}
