// ─────────────────────────────────────────────────────────────────────────────
// TeamRewards.tsx  —  Fanbe Group Admin
// Rank-upgrade celebration + milestone reward tracker per broker
// Rewards are one-time cash / gift incentives tied to rank achievement
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

interface TeamReward {
  id: string
  broker_id: string
  broker_name?: string
  achieved_rank_level: number
  achieved_rank_name: string
  reward_type: 'cash' | 'gift' | 'trip' | 'certificate'
  reward_amount: number
  reward_description: string
  achieved_at: string
  paid_at: string | null
  status: 'pending' | 'approved' | 'paid'
}

interface RankRewardConfig {
  level: number
  rank_name: string
  reward_type: 'cash' | 'gift' | 'trip' | 'certificate'
  reward_amount: number
  reward_description: string
}

// Reward config per rank — amounts aligned with business plan tier value
const RANK_REWARD_CONFIG: RankRewardConfig[] = [
  { level: 1,  rank_name: 'Executive',               reward_type: 'certificate', reward_amount: 0,      reward_description: 'Welcome Certificate' },
  { level: 2,  rank_name: 'Senior Executive',         reward_type: 'gift',        reward_amount: 2500,   reward_description: 'Gift Voucher ₹2,500' },
  { level: 3,  rank_name: 'Sales Officer',            reward_type: 'cash',        reward_amount: 5000,   reward_description: 'Cash Reward ₹5,000' },
  { level: 4,  rank_name: 'Senior Sales Officer',     reward_type: 'cash',        reward_amount: 10000,  reward_description: 'Cash Reward ₹10,000' },
  { level: 5,  rank_name: 'Team Manager',             reward_type: 'gift',        reward_amount: 25000,  reward_description: 'Smart Watch / Gift ₹25,000' },
  { level: 6,  rank_name: 'Senior Team Manager',      reward_type: 'cash',        reward_amount: 50000,  reward_description: 'Cash Reward ₹50,000' },
  { level: 7,  rank_name: 'Assistant Sales Manager',  reward_type: 'cash',        reward_amount: 100000, reward_description: 'Cash Reward ₹1,00,000' },
  { level: 8,  rank_name: 'Sales Manager',            reward_type: 'trip',        reward_amount: 150000, reward_description: 'Domestic Trip Package' },
  { level: 9,  rank_name: 'Senior Sales Manager',     reward_type: 'cash',        reward_amount: 200000, reward_description: 'Cash Reward ₹2,00,000' },
  { level: 10, rank_name: 'Assistant Gen Manager',    reward_type: 'trip',        reward_amount: 300000, reward_description: 'International Trip Package' },
  { level: 11, rank_name: 'Gen Manager',              reward_type: 'cash',        reward_amount: 500000, reward_description: 'Cash Reward ₹5,00,000' },
  { level: 12, rank_name: 'Senior GM',                reward_type: 'gift',        reward_amount: 750000, reward_description: 'Luxury Gift / Vehicle' },
  { level: 13, rank_name: 'Zonal Manager',            reward_type: 'cash',        reward_amount: 1000000, reward_description: 'Cash Reward ₹10,00,000' },
  { level: 14, rank_name: 'Vice President',           reward_type: 'trip',        reward_amount: 1500000, reward_description: 'International Family Trip' },
  { level: 15, rank_name: 'President',                reward_type: 'cash',        reward_amount: 2500000, reward_description: 'Cash Reward ₹25,00,000' },
]

const REWARD_ICON: Record<string, string> = {
  cash:        '💰',
  gift:        '🎁',
  trip:        '✈️',
  certificate: '📜',
}

const STATUS_STYLE: Record<string, string> = {
  pending:  'bg-yellow-100 text-yellow-800',
  approved: 'bg-blue-100 text-blue-800',
  paid:     'bg-green-100 text-green-800',
}

type Tab = 'rewards' | 'config'

export default function TeamRewards() {
  const [tab, setTab] = useState<Tab>('rewards')
  const [rewards, setRewards] = useState<TeamReward[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [filterStatus, setFilterStatus] = useState<string>('all')

  useEffect(() => { loadRewards() }, [])

  async function loadRewards() {
    setLoading(true)
    setError(null)
    const { data, error: err } = await supabase
      .from('team_rewards')
      .select(`
        *,
        brokers:broker_id ( full_name )
      `)
      .order('achieved_at', { ascending: false })
    if (err) { setError(err.message); setLoading(false); return }
    const enriched = (data ?? []).map((r: TeamReward & { brokers?: { full_name: string } }) => ({
      ...r,
      broker_name: r.brokers?.full_name ?? r.broker_id?.slice(0, 8) + '…',
    }))
    setRewards(enriched)
    setLoading(false)
  }

  async function updateStatus(id: string, status: 'approved' | 'paid') {
    await supabase
      .from('team_rewards')
      .update({ status, ...(status === 'paid' ? { paid_at: new Date().toISOString() } : {}) })
      .eq('id', id)
    loadRewards()
  }

  const fmtINR = (n: number) =>
    n === 0
      ? '—'
      : new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(n)

  const filtered = filterStatus === 'all'
    ? rewards
    : rewards.filter(r => r.status === filterStatus)

  const pendingCount  = rewards.filter(r => r.status === 'pending').length
  const approvedCount = rewards.filter(r => r.status === 'approved').length
  const totalPaid     = rewards.filter(r => r.status === 'paid').reduce((s, r) => s + r.reward_amount, 0)

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Team Rewards</h1>
        <p className="text-sm text-gray-500 mt-1">
          One-time rank-achievement rewards · Cash, gifts, trips & certificates
        </p>
      </div>

      {/* Summary KPIs */}
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'Pending Approval', value: pendingCount, color: 'border-yellow-300 bg-yellow-50', textColor: 'text-yellow-800' },
          { label: 'Approved (unpaid)', value: approvedCount, color: 'border-blue-300 bg-blue-50', textColor: 'text-blue-800' },
          { label: 'Total Paid Out', value: fmtINR(totalPaid), color: 'border-green-300 bg-green-50', textColor: 'text-green-800' },
        ].map(kpi => (
          <div key={kpi.label} className={`rounded-xl border-2 p-4 ${kpi.color}`}>
            <p className="text-xs text-gray-500 mb-1">{kpi.label}</p>
            <p className={`text-2xl font-bold ${kpi.textColor}`}>{kpi.value}</p>
          </div>
        ))}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 rounded-xl p-1 w-fit">
        {(['rewards', 'config'] as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              tab === t
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {t === 'rewards' ? '🏅 Broker Rewards' : '⚙️ Reward Config'}
          </button>
        ))}
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-red-700 text-sm">{error}</div>
      )}

      {/* ── Tab: Broker Rewards ─────────────────────────────────────────── */}
      {tab === 'rewards' && (
        <div className="space-y-4">
          {/* Filter */}
          <div className="flex items-center gap-3">
            <span className="text-sm text-gray-500">Filter:</span>
            {['all', 'pending', 'approved', 'paid'].map(s => (
              <button
                key={s}
                onClick={() => setFilterStatus(s)}
                className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                  filterStatus === s
                    ? 'bg-indigo-600 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </button>
            ))}
          </div>

          {loading ? (
            <div className="space-y-2">
              {[1,2,3,4].map(i => <div key={i} className="h-16 bg-gray-100 rounded-xl animate-pulse" />)}
            </div>
          ) : filtered.length === 0 ? (
            <div className="bg-gray-50 rounded-xl border-2 border-dashed border-gray-200 p-10 text-center">
              <p className="text-3xl mb-2">🏆</p>
              <p className="text-gray-500 text-sm">No rewards {filterStatus !== 'all' ? `with status "${filterStatus}"` : 'recorded yet'}</p>
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200">
                      <th className="px-4 py-3 text-left font-semibold text-gray-600">Broker</th>
                      <th className="px-4 py-3 text-left font-semibold text-gray-600">Rank Achieved</th>
                      <th className="px-4 py-3 text-left font-semibold text-gray-600">Reward</th>
                      <th className="px-4 py-3 text-right font-semibold text-gray-600">Amount</th>
                      <th className="px-4 py-3 text-center font-semibold text-gray-600">Date</th>
                      <th className="px-4 py-3 text-center font-semibold text-gray-600">Status</th>
                      <th className="px-4 py-3 text-center font-semibold text-gray-600">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {filtered.map(r => (
                      <tr key={r.id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-4 py-3 font-medium text-gray-800">{r.broker_name}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <span className="w-6 h-6 rounded-full bg-indigo-100 text-indigo-700 text-xs font-bold flex items-center justify-center">
                              {r.achieved_rank_level}
                            </span>
                            <span className="text-gray-700">{r.achieved_rank_name}</span>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <span className="mr-1.5">{REWARD_ICON[r.reward_type]}</span>
                          <span className="text-gray-600">{r.reward_description}</span>
                        </td>
                        <td className="px-4 py-3 text-right font-semibold text-gray-900">
                          {fmtINR(r.reward_amount)}
                        </td>
                        <td className="px-4 py-3 text-center text-gray-500 text-xs">
                          {new Date(r.achieved_at).toLocaleDateString('en-IN')}
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_STYLE[r.status]}`}>
                            {r.status}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <div className="flex items-center justify-center gap-2">
                            {r.status === 'pending' && (
                              <button
                                onClick={() => updateStatus(r.id, 'approved')}
                                className="text-xs px-2.5 py-1 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                              >
                                Approve
                              </button>
                            )}
                            {r.status === 'approved' && (
                              <button
                                onClick={() => updateStatus(r.id, 'paid')}
                                className="text-xs px-2.5 py-1 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
                              >
                                Mark Paid
                              </button>
                            )}
                            {r.status === 'paid' && r.paid_at && (
                              <span className="text-xs text-gray-400">
                                {new Date(r.paid_at).toLocaleDateString('en-IN')}
                              </span>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── Tab: Reward Config ───────────────────────────────────────────── */}
      {tab === 'config' && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="px-4 py-3 text-left font-semibold text-gray-600">Rank</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-600">Name</th>
                  <th className="px-4 py-3 text-center font-semibold text-gray-600">Type</th>
                  <th className="px-4 py-3 text-left font-semibold text-gray-600">Description</th>
                  <th className="px-4 py-3 text-right font-semibold text-gray-600">Value</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {RANK_REWARD_CONFIG.map(cfg => (
                  <tr key={cfg.level} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-indigo-100 text-indigo-700 text-xs font-bold">
                        {cfg.level}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-medium text-gray-800">{cfg.rank_name}</td>
                    <td className="px-4 py-3 text-center text-lg">{REWARD_ICON[cfg.reward_type]}</td>
                    <td className="px-4 py-3 text-gray-600">{cfg.reward_description}</td>
                    <td className="px-4 py-3 text-right font-semibold text-gray-900">
                      {fmtINR(cfg.reward_amount)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
