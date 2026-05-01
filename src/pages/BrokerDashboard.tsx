import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { LogOut, Users, Wallet, Award, TrendingUp, ArrowUpRight, AlertCircle } from 'lucide-react'
import toast from 'react-hot-toast'

function formatINR(n: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n || 0)
}

export default function BrokerDashboard() {
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [broker, setBroker] = useState<any>(null)
  const [downline, setDownline] = useState<any[]>([])
  const [payouts, setPayouts] = useState<any[]>([])
  const [withdrawals, setWithdrawals] = useState<any[]>([])

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
          <Stat icon={Award}    label="Rank"             value={<span className="capitalize">{broker?.rank || '—'}</span>} />
          <Stat icon={Wallet}   label="Wallet Balance"   value={formatINR(broker?.wallet_balance)} />
          <Stat icon={TrendingUp} label="Lifetime Business" value={formatINR(broker?.lifetime_business)} />
          <Stat icon={Users}    label="Direct Team"      value={String(downline.length)} />
        </div>

        {broker?.kyc_status !== 'approved' && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-start gap-3">
            <AlertCircle size={18} className="text-amber-600 mt-0.5"/>
            <div className="text-sm text-amber-900">
              <b>KYC {broker?.kyc_status || 'pending'}</b> — payouts will release after admin approves your KYC. Submit Aadhaar, PAN and bank documents to your sponsor.
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
                    <td className="py-2 text-xs">{new Date(p.created_at).toLocaleDateString('en-IN')}</td>
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
                  <div><div className="font-medium">{formatINR(w.amount)} → Net {formatINR(w.net_amount)}</div><div className="text-xs text-gray-500">{new Date(w.created_at).toLocaleDateString('en-IN')} · {w.bank_name || ''}</div></div>
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
