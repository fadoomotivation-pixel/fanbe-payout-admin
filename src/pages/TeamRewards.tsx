import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { Gift, ChevronDown, ChevronRight, CheckCircle, Clock, XCircle, Info, ArrowUpRight } from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface RewardTier {
  id: string;
  tier_name: string;
  required_units: number;       // 1 unit = 50 sq yards
  required_sq_yards: number;    // = required_units × 50
  reward_description: string;
  reward_value_inr: number;
  reward_type: 'cash' | 'gift' | 'trip';
  max_team_pct: number;         // PDF rule: max 33% from one team counted
  min_payment_pct: number;      // PDF rule: reward only when plot payment >= 50%
  badge_color: string;
  is_active: boolean;
}

interface BrokerRow {
  id: string;
  name: string;
  phone: string;
  lifetime_business: number;    // sq yards (raw from DB)
  direct_count: number;         // direct team member count
}

interface BrokerRewardStatus {
  broker: BrokerRow;
  // PDF rule: max 33% of any single sub-team's business is counted
  effective_business: number;
  tiers: {
    tier: RewardTier;
    // eligibility flags
    businessMet: boolean;
    paymentGateMet: boolean;    // placeholder — real check server-side
    isEligible: boolean;
    shortfall: number;          // sq yards still needed
  }[];
}

// ─── Constants ────────────────────────────────────────────────────────────────

const UNIT_SQ_YARDS = 50; // 1 unit = 50 sq yards (1 unit = 50 sq yards by default; configurable)
const MAX_TEAM_PCT  = 33; // max 33% from one team sub-branch counts

// ─── Helpers ─────────────────────────────────────────────────────────────────

const fmt = (n: number) =>
  n >= 10_000_000 ? `₹${(n / 10_000_000).toFixed(2)} Cr`
  : n >= 100_000  ? `₹${(n / 100_000).toFixed(1)} L`
  : `₹${n.toLocaleString('en-IN')}`;

const sqYardFmt = (n: number) =>
  n >= 100_000 ? `${(n / 100_000).toFixed(1)}L sqyd`
  : `${n.toLocaleString('en-IN')} sqyd`;

const rewardIcon = (type: string) =>
  type === 'trip' ? '✈️' : type === 'gift' ? '🎁' : '💰';

/**
 * Apply 33% cap rule (PDF page 13):
 * If a single sub-team contributes more than 33% of the broker's total team
 * business, only 33% of that sub-team's business is counted.
 *
 * Since we don't have per-leg breakdown from the brokers table,
 * we expose the field and flag it clearly in the UI. The actual cap
 * is enforced server-side via payout engine / DB function.
 * For the UI, we show a conservative estimate: 67% of raw lifetime_business
 * if the broker has fewer than 3 direct legs (worst case one leg dominates).
 */
function applyCapRule(broker: BrokerRow): number {
  // If ≥3 direct members, assume balanced teams → no cap impact
  if (broker.direct_count >= 3) return broker.lifetime_business;
  // Conservative: at most 33% from each leg, so cap at 33% × direct_count
  const maxCounted = (broker.lifetime_business * (MAX_TEAM_PCT * Math.max(broker.direct_count, 1))) / 100;
  return Math.min(broker.lifetime_business, maxCounted);
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function TeamRewards() {
  const [tiers, setTiers] = useState<RewardTier[]>([]);
  const [statuses, setStatuses] = useState<BrokerRewardStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'tiers' | 'status'>('tiers');
  const [expandedBroker, setExpandedBroker] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    async function fetchData() {
      setLoading(true);

      // brokers.lifetime_business and direct_count don't exist as columns.  Derive both:
      //   - lifetime sqyd = sum of bp_plots.size_sqyd across this broker's confirmed bookings
      //   - direct count   = number of brokers sponsored by this broker
      const [tiersRes, brokersRes, bookingsRes, downlineRes] = await Promise.all([
        supabase
          .from('team_reward_tiers')
          .select('*')
          .eq('is_active', true)
          .order('required_sq_yards', { ascending: true }),
        supabase
          .from('brokers')
          .select('id, name, phone, sponsor_id')
          .neq('status', 'inactive')
          .limit(500),
        supabase
          .from('bp_bookings')
          .select('broker_id, bp_plots(size_sqyd)')
          .eq('stage', 'booking_done'),
        supabase.from('brokers').select('sponsor_id').not('sponsor_id', 'is', null),
      ]);

      const sqydByBroker: Record<string, number> = {};
      for (const b of (bookingsRes.data || []) as any[]) {
        if (!b.broker_id) continue;
        sqydByBroker[b.broker_id] = (sqydByBroker[b.broker_id] || 0) + Number(b.bp_plots?.size_sqyd || 0);
      }
      const directCountByBroker: Record<string, number> = {};
      for (const d of (downlineRes.data || []) as any[]) {
        if (!d.sponsor_id) continue;
        directCountByBroker[d.sponsor_id] = (directCountByBroker[d.sponsor_id] || 0) + 1;
      }

      const loadedTiers: RewardTier[] = tiersRes.data ?? [];
      setTiers(loadedTiers);

      if (!brokersRes.error && brokersRes.data) {
        const built: BrokerRewardStatus[] = (brokersRes.data as any[]).map(b => {
          const broker: BrokerRow = {
            id: b.id,
            name: b.name,
            phone: b.phone,
            lifetime_business: sqydByBroker[b.id] || 0,
            direct_count: directCountByBroker[b.id] || 0,
          };

          // Apply 33% cap rule per PDF
          const effective = applyCapRule(broker);

          return {
            broker,
            effective_business: effective,
            tiers: loadedTiers.map(tier => {
              const businessMet = effective >= tier.required_sq_yards;
              // payment_gate_met: fetched from broker_reward_claims in a real impl;
              // here we default to false so UI shows pending state honestly
              const paymentGateMet = false;
              return {
                tier,
                businessMet,
                paymentGateMet,
                isEligible: businessMet && paymentGateMet,
                shortfall: Math.max(0, tier.required_sq_yards - effective),
              };
            }),
          };
        });
        // Sort: highest effective business first; brokers with zero sqyd drift to bottom.
        built.sort((a, b) => b.effective_business - a.effective_business);
        setStatuses(built);
      }

      setLoading(false);
    }
    fetchData();
  }, []);

  const filtered = statuses.filter(s =>
    s.broker.name.toLowerCase().includes(search.toLowerCase()) ||
    s.broker.phone.includes(search)
  );

  return (
    <div className="p-3 md:p-6 max-w-6xl mx-auto">

      {/* Header */}
      <div className="flex items-center gap-3 mb-2">
        <Gift className="text-purple-500" size={28} />
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Team Rewards</h1>
          <p className="text-sm text-gray-500 mt-0.5">Milestone rewards · 1 Unit = 50 Sq Yards</p>
        </div>
      </div>

      {/* PDF Rules banner */}
      <div className="flex flex-wrap gap-3 mb-6">
        <div className="flex items-center gap-1.5 text-xs bg-amber-50 border border-amber-200 text-amber-700 rounded-lg px-3 py-1.5">
          <Info size={12} />
          <span><strong>33% Cap:</strong> Max 33% of any single team leg counted toward threshold</span>
        </div>
        <div className="flex items-center gap-1.5 text-xs bg-blue-50 border border-blue-200 text-blue-700 rounded-lg px-3 py-1.5">
          <Info size={12} />
          <span><strong>50% Payment Gate:</strong> Reward disbursed only after each member's plot is 50% paid</span>
        </div>
        <div className="flex items-center gap-1.5 text-xs bg-green-50 border border-green-200 text-green-700 rounded-lg px-3 py-1.5">
          <Info size={12} />
          <span><strong>Vehicles:</strong> Base model, ex-showroom price only</span>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-lg w-fit mb-6">
        {(['tiers', 'status'] as const).map(tab => (
          <button key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === tab ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}>
            {tab === 'tiers' ? '🏆 Reward Tiers' : '👥 Broker Status'}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20 gap-3 text-gray-400">
          <div className="w-5 h-5 border-2 border-purple-400 border-t-transparent rounded-full animate-spin" />
          Loading...
        </div>
      ) : activeTab === 'tiers' ? (

        /* ── Tiers grid ── */
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {tiers.length === 0 ? (
            <div className="col-span-4 text-center py-16 text-gray-400">
              <Gift size={40} className="mx-auto mb-3 opacity-30" />
              <p>No reward tiers configured yet.</p>
            </div>
          ) : tiers.map((tier, idx) => (
            <div key={tier.id}
              className={`bg-white rounded-xl border p-5 shadow-sm hover:shadow-md transition-shadow relative overflow-hidden ${
                tier.is_active ? 'border-gray-200' : 'border-gray-100 opacity-60'
              }`}>

              {/* rank badge */}
              <div className="absolute top-3 right-3 w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-bold"
                style={{ backgroundColor: tier.badge_color }}>
                {idx + 1}
              </div>

              <div className="mb-3">
                <span className="text-3xl">{rewardIcon(tier.reward_type)}</span>
                <h3 className="font-semibold text-gray-900 mt-2 text-sm leading-tight">{tier.tier_name}</h3>
                <p className="text-xs text-gray-400 mt-0.5">{tier.reward_description}</p>
              </div>

              <div className="space-y-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-gray-500">Units required</span>
                  <span className="font-semibold text-gray-800">{tier.required_units.toLocaleString('en-IN')} units</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Sq Yards</span>
                  <span className="font-semibold text-gray-800">{sqYardFmt(tier.required_sq_yards)}</span>
                </div>
                <div className="flex justify-between pt-2 border-t border-gray-100">
                  <span className="text-gray-500">Reward value</span>
                  <span className="font-bold text-sm" style={{ color: tier.badge_color }}>
                    {fmt(tier.reward_value_inr)}
                  </span>
                </div>
              </div>

              {/* Rules pills */}
              <div className="flex flex-wrap gap-1 mt-3 pt-3 border-t border-gray-100">
                <span className="text-[10px] bg-amber-50 text-amber-600 border border-amber-100 rounded px-1.5 py-0.5">
                  Max {tier.max_team_pct}% per leg
                </span>
                <span className="text-[10px] bg-blue-50 text-blue-600 border border-blue-100 rounded px-1.5 py-0.5">
                  {tier.min_payment_pct}% payment gate
                </span>
              </div>
            </div>
          ))}
        </div>

      ) : (

        /* ── Broker Status tab ── */
        <>
          <input
            type="text" placeholder="Search broker name or phone..."
            value={search} onChange={e => setSearch(e.target.value)}
            className="w-full mb-4 px-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-purple-400"
          />

          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100 text-xs">
                  <th className="w-8" />
                  <th className="text-left px-4 py-3 font-semibold text-gray-600">Broker</th>
                  <th className="text-right px-4 py-3 font-semibold text-gray-600">Raw Business</th>
                  <th className="text-right px-4 py-3 font-semibold text-gray-600">
                    <span className="flex items-center justify-end gap-1">
                      Effective <span className="text-amber-500">(33% cap)</span>
                    </span>
                  </th>
                  <th className="text-center px-4 py-3 font-semibold text-gray-600">Tiers Met</th>
                  <th className="text-center px-4 py-3 font-semibold text-gray-600">Payment Gate</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filtered.length === 0 ? (
                  <tr><td colSpan={6} className="text-center py-12 text-gray-400">No brokers found.</td></tr>
                ) : filtered.map(s => (
                  <>
                    <tr key={s.broker.id}
                      className="hover:bg-gray-50 transition-colors cursor-pointer"
                      onClick={() => setExpandedBroker(expandedBroker === s.broker.id ? null : s.broker.id)}>
                      <td className="pl-4 py-3 text-gray-400">
                        {expandedBroker === s.broker.id
                          ? <ChevronDown size={14} />
                          : <ChevronRight size={14} />}
                      </td>
                      <td className="px-4 py-3">
                        <Link to={`/broker/dashboard?broker_id=${s.broker.id}`} className="hover:text-blue-700 inline-block">
                          <p className="font-medium text-gray-800 inline-flex items-center gap-1">{s.broker.name}<ArrowUpRight size={10} className="text-gray-400"/></p>
                          <p className="text-xs text-gray-400">{s.broker.phone}{s.broker.direct_count > 0 ? ` · ${s.broker.direct_count} direct` : ''}</p>
                        </Link>
                      </td>
                      {/* Raw business */}
                      <td className="px-4 py-3 text-right tabular-nums text-gray-500 text-xs">
                        {sqYardFmt(s.broker.lifetime_business)}
                      </td>
                      {/* Effective after 33% cap */}
                      <td className="px-4 py-3 text-right tabular-nums font-semibold text-gray-800">
                        {sqYardFmt(s.effective_business)}
                        {s.effective_business < s.broker.lifetime_business && (
                          <span className="ml-1 text-[10px] text-amber-500">capped</span>
                        )}
                      </td>
                      {/* Tiers where business threshold is met */}
                      <td className="px-4 py-3 text-center">
                        <span className="inline-flex items-center gap-1 text-green-600 font-medium">
                          <CheckCircle size={13} />
                          {s.tiers.filter(t => t.businessMet).length} / {tiers.length}
                        </span>
                      </td>
                      {/* 50% payment gate — pending by default until server confirms */}
                      <td className="px-4 py-3 text-center">
                        <span className="inline-flex items-center gap-1 text-amber-500 text-xs">
                          <Clock size={13} />
                          Pending verify
                        </span>
                      </td>
                    </tr>

                    {/* Expanded tier breakdown */}
                    {expandedBroker === s.broker.id && (
                      <tr key={`${s.broker.id}-expand`}>
                        <td colSpan={6} className="px-8 py-5 bg-gray-50">
                          <p className="text-xs text-gray-500 mb-3 font-medium uppercase tracking-wide">Tier Eligibility Breakdown</p>
                          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                            {s.tiers.map(t => {
                              const status = !t.businessMet ? 'not_met'
                                : !t.paymentGateMet ? 'payment_pending'
                                : 'eligible';
                              return (
                                <div key={t.tier.id}
                                  className={`p-3 rounded-lg border text-xs ${
                                    status === 'eligible'
                                      ? 'bg-green-50 border-green-200 text-green-800'
                                      : status === 'payment_pending'
                                      ? 'bg-amber-50 border-amber-200 text-amber-800'
                                      : 'bg-gray-100 border-gray-200 text-gray-500'
                                  }`}>
                                  <div className="flex items-center gap-1.5 font-semibold mb-1.5">
                                    {rewardIcon(t.tier.reward_type)}
                                    <span>{t.tier.tier_name}</span>
                                  </div>
                                  <div className="text-[10px] text-gray-400 mb-1">
                                    {t.tier.required_units.toLocaleString('en-IN')} units · {sqYardFmt(t.tier.required_sq_yards)}
                                  </div>
                                  <div className="flex items-center gap-1">
                                    {status === 'eligible' && (
                                      <><CheckCircle size={11} className="text-green-600" /> Fully eligible</>
                                    )}
                                    {status === 'payment_pending' && (
                                      <><Clock size={11} className="text-amber-500" /> Business ✓ · Awaiting 50% payment</>  
                                    )}
                                    {status === 'not_met' && (
                                      <><XCircle size={11} className="text-gray-400" /> {sqYardFmt(t.shortfall)} more needed</>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
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
