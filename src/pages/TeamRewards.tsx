import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { Gift, Users, ChevronDown, ChevronRight, CheckCircle, Clock, XCircle } from 'lucide-react';

interface RewardTier {
  id: string;
  tier_name: string;
  required_direct: number;
  required_team_business: number;
  reward_amount: number;
  reward_type: 'cash' | 'gift' | 'trip';
  badge_color: string;
  is_active: boolean;
}

interface BrokerRewardStatus {
  broker_id: string;
  broker_name: string;
  phone: string;
  direct_team: number;
  team_business: number;
  eligible_tiers: string[];
  claimed_tiers: string[];
  pending_tiers: string[];
}

export default function TeamRewards() {
  const [tiers, setTiers] = useState<RewardTier[]>([]);
  const [brokerStatuses, setBrokerStatuses] = useState<BrokerRewardStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'tiers' | 'status'>('tiers');
  const [expandedBroker, setExpandedBroker] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    async function fetchData() {
      setLoading(true);

      const [tiersRes, brokersRes] = await Promise.all([
        supabase
          .from('team_reward_tiers')
          .select('*')
          .order('required_team_business', { ascending: true }),
        supabase
          .from('brokers')
          .select('id, name, phone, lifetime_business, created_at')
          .order('lifetime_business', { ascending: false })
          .limit(100),
      ]);

      if (!tiersRes.error && tiersRes.data) setTiers(tiersRes.data);

      if (!brokersRes.error && brokersRes.data) {
        // Build mock statuses — real eligibility computed server-side via payoutEngine
        const statuses: BrokerRewardStatus[] = (brokersRes.data as any[]).map(b => ({
          broker_id: b.id,
          broker_name: b.name,
          phone: b.phone,
          direct_team: 0,
          team_business: b.lifetime_business ?? 0,
          eligible_tiers: [],
          claimed_tiers: [],
          pending_tiers: [],
        }));
        setBrokerStatuses(statuses);
      }

      setLoading(false);
    }
    fetchData();
  }, []);

  const filtered = brokerStatuses.filter(b =>
    b.broker_name.toLowerCase().includes(search.toLowerCase()) ||
    b.phone.includes(search)
  );

  const fmt = (n: number) => `₹${n.toLocaleString('en-IN')}`;

  const rewardIcon = (type: string) => {
    if (type === 'trip') return '✈️';
    if (type === 'gift') return '🎁';
    return '💰';
  };

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <Gift className="text-purple-500" size={28} />
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Team Rewards</h1>
          <p className="text-sm text-gray-500 mt-0.5">Milestone-based rewards for team building performance</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-lg w-fit mb-6">
        {(['tiers', 'status'] as const).map(tab => (
          <button key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors capitalize ${
              activeTab === tab ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}>
            {tab === 'tiers' ? '🏆 Reward Tiers' : '👥 Broker Status'}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-center py-20 text-gray-400">Loading...</div>
      ) : activeTab === 'tiers' ? (
        /* ── Tiers grid ── */
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {tiers.length === 0 ? (
            <div className="col-span-3 text-center py-16 text-gray-400">
              <Gift size={40} className="mx-auto mb-3 opacity-30" />
              <p>No reward tiers configured yet.</p>
              <p className="text-xs mt-1">Add tiers via the DB migration and they'll appear here.</p>
            </div>
          ) : tiers.map(tier => (
            <div key={tier.id}
              className={`bg-white rounded-xl border p-5 shadow-sm hover:shadow-md transition-shadow ${
                tier.is_active ? 'border-gray-200' : 'border-gray-100 opacity-60'
              }`}>
              <div className="flex items-start justify-between mb-3">
                <div>
                  <span className="text-2xl">{rewardIcon(tier.reward_type)}</span>
                  <h3 className="font-semibold text-gray-900 mt-1">{tier.tier_name}</h3>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                  tier.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                }`}>
                  {tier.is_active ? 'Active' : 'Inactive'}
                </span>
              </div>

              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-500">Direct team needed</span>
                  <span className="font-semibold text-gray-800">{tier.required_direct} members</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Team business needed</span>
                  <span className="font-semibold text-gray-800">{fmt(tier.required_team_business)}</span>
                </div>
                <div className="flex justify-between border-t border-gray-100 pt-2 mt-2">
                  <span className="text-gray-500">Reward value</span>
                  <span className="font-bold text-lg" style={{ color: tier.badge_color }}>
                    {fmt(tier.reward_amount)}
                  </span>
                </div>
              </div>

              <div className="mt-3 pt-3 border-t border-gray-100">
                <div className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded-full" style={{ backgroundColor: tier.badge_color }} />
                  <span className="text-xs text-gray-400 capitalize">{tier.reward_type} reward</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : (
        /* ── Broker status tab ── */
        <>
          <input
            type="text" placeholder="Search broker..."
            value={search} onChange={e => setSearch(e.target.value)}
            className="w-full mb-4 px-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-400"
          />

          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="w-8" />
                  <th className="text-left px-4 py-3 font-semibold text-gray-600">Broker</th>
                  <th className="text-right px-4 py-3 font-semibold text-gray-600">Team Business</th>
                  <th className="text-center px-4 py-3 font-semibold text-gray-600">Eligible</th>
                  <th className="text-center px-4 py-3 font-semibold text-gray-600">Claimed</th>
                  <th className="text-center px-4 py-3 font-semibold text-gray-600">Pending</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filtered.length === 0 ? (
                  <tr><td colSpan={6} className="text-center py-12 text-gray-400">No brokers found.</td></tr>
                ) : filtered.map(b => (
                  <>
                    <tr key={b.broker_id}
                      className="hover:bg-gray-50 transition-colors cursor-pointer"
                      onClick={() => setExpandedBroker(expandedBroker === b.broker_id ? null : b.broker_id)}>
                      <td className="pl-4 py-3 text-gray-400">
                        {expandedBroker === b.broker_id
                          ? <ChevronDown size={14} />
                          : <ChevronRight size={14} />}
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-medium text-gray-800">{b.broker_name}</p>
                        <p className="text-xs text-gray-400">{b.phone}</p>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums font-medium text-gray-700">
                        {fmt(b.team_business)}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className="inline-flex items-center gap-1 text-green-600">
                          <CheckCircle size={14} />
                          {b.eligible_tiers.length}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className="inline-flex items-center gap-1 text-teal-600">
                          <CheckCircle size={14} />
                          {b.claimed_tiers.length}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className="inline-flex items-center gap-1 text-amber-500">
                          <Clock size={14} />
                          {b.pending_tiers.length}
                        </span>
                      </td>
                    </tr>
                    {expandedBroker === b.broker_id && (
                      <tr key={`${b.broker_id}-expand`}>
                        <td colSpan={6} className="px-8 py-4 bg-gray-50">
                          {tiers.length === 0 ? (
                            <p className="text-xs text-gray-400">No reward tiers configured.</p>
                          ) : (
                            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                              {tiers.map(tier => {
                                const isEligible = b.team_business >= tier.required_team_business;
                                return (
                                  <div key={tier.id}
                                    className={`p-3 rounded-lg border text-xs ${
                                      isEligible
                                        ? 'bg-green-50 border-green-200 text-green-800'
                                        : 'bg-gray-100 border-gray-200 text-gray-500'
                                    }`}>
                                    <div className="flex items-center gap-1.5 font-semibold mb-1">
                                      {rewardIcon(tier.reward_type)} {tier.tier_name}
                                    </div>
                                    <div className="flex items-center gap-1">
                                      {isEligible
                                        ? <><CheckCircle size={11} className="text-green-600" /> Eligible</>  
                                        : <><XCircle size={11} className="text-gray-400" /> {fmt(tier.required_team_business - b.team_business)} more needed</>}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
