import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { Star, Award, TrendingUp, Users } from 'lucide-react';

interface AchieverRow {
  broker_id: string;
  broker_name: string;
  phone: string;
  rank_name: string;
  badge_color: string;
  lifetime_business: number;
  total_income: number;
  direct_team: number;
  total_team: number;
  joined_at: string;
}

const PERIODS = [
  { label: 'All Time', value: 'all' },
  { label: 'This Month', value: 'month' },
  { label: 'This Quarter', value: 'quarter' },
  { label: 'This Year', value: 'year' },
];

export default function AchieversClub() {
  const [achievers, setAchievers] = useState<AchieverRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState('all');
  const [search, setSearch] = useState('');

  useEffect(() => {
    async function fetchAchievers() {
      setLoading(true);
      // Join brokers → commission_ranks via rank matching on lifetime_business
      const { data, error } = await supabase
        .from('brokers')
        .select(`
          id,
          name,
          phone,
          lifetime_business,
          created_at,
          commission_ranks!inner(rank_name, badge_color),
          broker_incomes(amount)
        `)
        .order('lifetime_business', { ascending: false });

      if (!error && data) {
        const rows: AchieverRow[] = (data as any[]).map(b => ({
          broker_id: b.id,
          broker_name: b.name,
          phone: b.phone,
          rank_name: b.commission_ranks?.rank_name ?? '—',
          badge_color: b.commission_ranks?.badge_color ?? '#888',
          lifetime_business: b.lifetime_business ?? 0,
          total_income: (b.broker_incomes ?? []).reduce((s: number, i: any) => s + (i.amount ?? 0), 0),
          direct_team: 0,
          total_team: 0,
          joined_at: b.created_at,
        }));
        setAchievers(rows);
      }
      setLoading(false);
    }
    fetchAchievers();
  }, [period]);

  const filtered = achievers.filter(a =>
    a.broker_name.toLowerCase().includes(search.toLowerCase()) ||
    a.phone.includes(search)
  );

  const topThree = filtered.slice(0, 3);
  const rest = filtered.slice(3);

  const fmt = (n: number) => `₹${n.toLocaleString('en-IN')}`;

  const podiumOrder = topThree.length === 3
    ? [topThree[1], topThree[0], topThree[2]]
    : topThree;

  const podiumHeights = ['h-24', 'h-32', 'h-20'];
  const podiumPositions = [2, 1, 3];

  return (
    <div className="p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Star className="text-amber-500" size={28} fill="currentColor" />
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Achievers Club</h1>
            <p className="text-sm text-gray-500 mt-0.5">Top brokers ranked by lifetime business volume</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex bg-gray-100 rounded-lg p-1 gap-1">
            {PERIODS.map(p => (
              <button key={p.value}
                onClick={() => setPeriod(p.value)}
                className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  period === p.value ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
                }`}>
                {p.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Search */}
      <input
        type="text" placeholder="Search broker name or phone..."
        value={search} onChange={e => setSearch(e.target.value)}
        className="w-full mb-6 px-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
      />

      {loading ? (
        <div className="text-center py-20 text-gray-400">Loading achievers...</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20 text-gray-400">No brokers found.</div>
      ) : (
        <>
          {/* Podium — top 3 */}
          {topThree.length >= 1 && (
            <div className="mb-10">
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-6 text-center">Top Performers</h2>
              <div className="flex items-end justify-center gap-4">
                {podiumOrder.map((a, idx) => (
                  <div key={a.broker_id} className="flex flex-col items-center">
                    <div className="w-16 h-16 rounded-full flex items-center justify-center text-white text-lg font-bold mb-2 shadow-lg"
                      style={{ backgroundColor: a.badge_color }}>
                      {a.broker_name.charAt(0).toUpperCase()}
                    </div>
                    <p className="text-sm font-semibold text-gray-800 text-center w-28 truncate">{a.broker_name}</p>
                    <p className="text-xs text-gray-500 mb-1" style={{ color: a.badge_color }}>{a.rank_name}</p>
                    <p className="text-xs font-semibold text-gray-700 mb-2">{fmt(a.lifetime_business)}</p>
                    <div className={`w-24 ${podiumHeights[idx]} rounded-t-lg flex items-center justify-center text-white font-bold text-lg`}
                      style={{ backgroundColor: a.badge_color, opacity: 0.85 }}>
                      #{podiumPositions[idx]}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Full leaderboard table */}
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
              <Award size={16} className="text-amber-500" />
              <span className="text-sm font-semibold text-gray-700">Full Leaderboard</span>
              <span className="ml-auto text-xs text-gray-400">{filtered.length} brokers</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-100">
                    <th className="text-center px-4 py-3 font-semibold text-gray-600 w-12">Rank</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-600">Broker</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-600">Badge</th>
                    <th className="text-right px-4 py-3 font-semibold text-gray-600">Lifetime Business</th>
                    <th className="text-right px-4 py-3 font-semibold text-gray-600">Total Income Earned</th>
                    <th className="text-center px-4 py-3 font-semibold text-gray-600">Joined</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {filtered.map((a, i) => (
                    <tr key={a.broker_id} className={`hover:bg-gray-50 transition-colors ${
                      i < 3 ? 'bg-amber-50/40' : ''
                    }`}>
                      <td className="px-4 py-3 text-center">
                        {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : (
                          <span className="text-gray-500 font-medium tabular-nums">#{i + 1}</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold"
                            style={{ backgroundColor: a.badge_color }}>
                            {a.broker_name.charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <p className="font-medium text-gray-800">{a.broker_name}</p>
                            <p className="text-xs text-gray-400">{a.phone}</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold text-white"
                          style={{ backgroundColor: a.badge_color }}>
                          <span className="w-1.5 h-1.5 rounded-full bg-white/60" />
                          {a.rank_name}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums font-semibold text-gray-800">
                        {fmt(a.lifetime_business)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-teal-700 font-medium">
                        {fmt(a.total_income)}
                      </td>
                      <td className="px-4 py-3 text-center text-xs text-gray-400">
                        {new Date(a.joined_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
