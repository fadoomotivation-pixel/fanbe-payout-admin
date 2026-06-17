import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { formatINR } from '@/lib/utils'
import { Star, Award, Info, Trophy, ArrowUpRight } from 'lucide-react'

// Achievers Club previously joined a `broker_incomes` table that doesn't exist and read
// `brokers.lifetime_business`, also nonexistent — every row showed ₹0 income with no
// qualification logic.  Rewired to live data: lifetime sqyd is derived from confirmed
// bookings × plot size, and income comes from payout_distributions.net_payout (the same
// source-of-truth every broker dashboard and the /payouts page reads).

interface ClubConfig {
  target_sq_yards: number
  consecutive_months: number
  allocation_per_sq_yard_inr: number
  payout_installments: number
}

interface AchieverRow {
  broker_id: string
  broker_name: string
  broker_code: string
  phone: string
  rank_name: string
  badge_color: string
  lifetime_sqyd: number       // sum of bp_plots.size_sqyd across confirmed bookings
  total_income: number         // sum of payout_distributions.net_payout
  is_qualifying: boolean       // lifetime_sqyd >= config.target_sq_yards
  joined_at: string
}

export default function AchieversClub() {
  const [achievers, setAchievers] = useState<AchieverRow[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'qualifying' | 'all'>('all')
  const [search, setSearch] = useState('')
  const [config, setConfig] = useState<ClubConfig | null>(null)

  useEffect(() => {
    supabase.from('achievers_club_config')
      .select('target_sq_yards,consecutive_months,allocation_per_sq_yard_inr,payout_installments')
      .eq('id', 1).maybeSingle()
      .then(({ data }) => { if (data) setConfig(data as ClubConfig) })
  }, [])

  useEffect(() => {
    async function load() {
      setLoading(true)
      // Pull every broker + their booking sqyd + their distributed income in four queries.
      // Aggregating in JS keeps SQL simple and avoids a custom RPC.
      const [{ data: brokers }, { data: bookings }, { data: distributions }, { data: ranks }] = await Promise.all([
        // Only MLM brokers are eligible -- the Achievers Club rewards team-building, and
        // traditional brokers don't sit in the sponsor tree.
        supabase.from('brokers').select('id, name, broker_id, phone, rank, status, created_at, sponsor_id').eq('broker_type', 'mlm'),
        supabase.from('bp_bookings').select('broker_id, bp_plots(size_sqyd)').eq('stage', 'booking_done'),
        supabase.from('payout_distributions').select('beneficiary_broker_id, net_payout'),
        supabase.from('commission_ranks').select('rank_name, badge_color'),
      ])

      // Step 1: own-booking sqyd per broker (their direct sales).
      const ownSqyd: Record<string, number> = {}
      for (const b of (bookings || []) as any[]) {
        if (!b.broker_id) continue
        ownSqyd[b.broker_id] = (ownSqyd[b.broker_id] || 0) + Number(b.bp_plots?.size_sqyd || 0)
      }

      // Step 2: build the sponsor tree (direct children of each broker).
      const directChildren: Record<string, string[]> = {}
      for (const b of (brokers || []) as any[]) {
        if (!b.sponsor_id) continue
        ;(directChildren[b.sponsor_id] ??= []).push(b.id)
      }

      // Step 3: subtree sqyd for each broker (own + every descendant's own).
      // Memoised DFS, single pass over the tree.
      const subtreeSqyd: Record<string, number> = {}
      function computeSubtree(id: string, seen: Set<string>): number {
        if (subtreeSqyd[id] != null) return subtreeSqyd[id]
        if (seen.has(id)) return 0 // cycle guard
        seen.add(id)
        let total = ownSqyd[id] || 0
        for (const childId of (directChildren[id] || [])) total += computeSubtree(childId, seen)
        subtreeSqyd[id] = total
        return total
      }
      for (const b of (brokers || []) as any[]) computeSubtree(b.id, new Set())

      // Step 4: team sqyd per broker WITH per-leg 1000-sqyd cap (admin's "1 leg
      // 1000 gaj count only" rule).  Each direct child leg contributes at most
      // 1000 sqyd to the achiever's qualifying total, plus the broker's own sales.
      const LEG_CAP = 1000
      const teamSqyd: Record<string, number> = {}
      for (const b of (brokers || []) as any[]) {
        const legs = (directChildren[b.id] || []).map(c => Math.min(subtreeSqyd[c] || 0, LEG_CAP))
        const cappedTeam = legs.reduce((s, v) => s + v, 0)
        teamSqyd[b.id] = (ownSqyd[b.id] || 0) + cappedTeam
      }

      const incomeByBroker: Record<string, number> = {}
      for (const d of (distributions || []) as any[]) {
        if (!d.beneficiary_broker_id) continue
        incomeByBroker[d.beneficiary_broker_id] = (incomeByBroker[d.beneficiary_broker_id] || 0) + Number(d.net_payout || 0)
      }

      const rankColors: Record<string, string> = {}
      for (const r of (ranks || []) as any[]) rankColors[r.rank_name] = r.badge_color || '#888'

      const target = config?.target_sq_yards ?? 3000
      const rows: AchieverRow[] = (brokers || [])
        .filter((b: any) => b.status !== 'inactive')
        .map((b: any) => {
          const sqyd = teamSqyd[b.id] || 0
          return {
            broker_id:     b.id,
            broker_name:   b.name || '—',
            broker_code:   b.broker_id || '—',
            phone:         b.phone || '',
            rank_name:     b.rank || '—',
            badge_color:   rankColors[b.rank] || '#888',
            lifetime_sqyd: sqyd,
            total_income:  incomeByBroker[b.id] || 0,
            is_qualifying: sqyd >= target,
            joined_at:     b.created_at,
          }
        })
        // Sort: qualifying first, then by income, then by sqyd
        .sort((a, b) =>
          (Number(b.is_qualifying) - Number(a.is_qualifying)) ||
          (b.total_income - a.total_income) ||
          (b.lifetime_sqyd - a.lifetime_sqyd)
        )
      setAchievers(rows)
      setLoading(false)
    }
    if (config !== undefined) load()
  }, [config])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return achievers.filter(a => {
      if (filter === 'qualifying' && !a.is_qualifying) return false
      if (!q) return true
      return a.broker_name.toLowerCase().includes(q) || a.broker_code.toLowerCase().includes(q) || a.phone.includes(q)
    })
  }, [achievers, search, filter])

  const qualifyingCount = achievers.filter(a => a.is_qualifying).length
  const topThree = filtered.slice(0, 3)
  const podiumOrder = topThree.length === 3 ? [topThree[1], topThree[0], topThree[2]] : topThree
  const podiumHeights = ['h-24', 'h-32', 'h-20']
  const podiumPositions = [2, 1, 3]

  return (
    <div className="p-3 md:p-6 max-w-6xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Star className="text-amber-500" size={28} fill="currentColor" />
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Achievers Club</h1>
            <p className="text-sm text-gray-500 mt-0.5">Brokers ranked by lifetime sales (sqyd) and distributed income</p>
          </div>
        </div>
        <div className="flex bg-gray-100 rounded-lg p-1 gap-1">
          {([
            { key: 'all',         label: `All (${achievers.length})` },
            { key: 'qualifying',  label: `Qualifying (${qualifyingCount})` },
          ] as const).map(p => (
            <button key={p.key} onClick={() => setFilter(p.key)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                filter === p.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}>
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Club rules from config */}
      {config && (
        <div className="mb-5 grid grid-cols-1 md:grid-cols-4 gap-3">
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-amber-700 flex items-center gap-1"><Info size={11}/>Target</p>
            <p className="text-sm font-bold text-gray-800 mt-1">{config.target_sq_yards.toLocaleString('en-IN')} Sq Yds</p>
            <p className="text-xs text-gray-500">team business / month for {config.consecutive_months} months</p>
          </div>
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-blue-700">Consecutive Months</p>
            <p className="text-sm font-bold text-gray-800 mt-1">{config.consecutive_months}</p>
            <p className="text-xs text-gray-500">to qualify + maintain</p>
          </div>
          <div className="bg-green-50 border border-green-200 rounded-lg p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-green-700">Allocation</p>
            <p className="text-sm font-bold text-gray-800 mt-1">₹{config.allocation_per_sq_yard_inr}/sq yd</p>
            <p className="text-xs text-gray-500">on fresh monthly sale</p>
          </div>
          <div className="bg-purple-50 border border-purple-200 rounded-lg p-3">
            <p className="text-[11px] font-semibold uppercase tracking-wider text-purple-700">Payout</p>
            <p className="text-sm font-bold text-gray-800 mt-1">{config.payout_installments} instalments</p>
            <p className="text-xs text-gray-500">equal monthly split per achiever</p>
          </div>
        </div>
      )}

      {/* Closing rule: "1 leg 1000 gaj count only" -- explained inline so admins (and
          brokers when this view ships to them) know why a leg with 4000 sqyd only
          contributes 1000 sqyd to the achiever's qualifying total. */}
      <div className="mb-5 rounded-lg border border-amber-200 bg-amber-50/50 px-4 py-3 text-sm">
        <p className="font-semibold text-amber-900 mb-1 flex items-center gap-1.5"><Info size={13}/>How qualification closes</p>
        <ul className="list-disc pl-5 text-amber-800 space-y-0.5 text-[13px]">
          <li>Need <b>{(config?.target_sq_yards ?? 3000).toLocaleString('en-IN')} sqyd</b> team business across {(config?.consecutive_months ?? 3)} consecutive months.</li>
          <li><b>1-leg cap of 1,000 sqyd</b> -- any single direct downline contributes at most 1,000 sqyd toward your target, so the team has to be balanced across legs.</li>
          <li>Your own direct sales also count toward the target.</li>
        </ul>
      </div>

      <input
        type="text" placeholder="Search broker name, code or phone..."
        value={search} onChange={e => setSearch(e.target.value)}
        className="w-full mb-6 px-4 py-2.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
      />

      {loading ? (
        <div className="text-center py-20 text-gray-400">Loading achievers…</div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-20 text-gray-400">
          {filter === 'qualifying' ? `No brokers have crossed the ${(config?.target_sq_yards ?? 3000).toLocaleString('en-IN')} sqyd threshold yet.` : 'No brokers match the search.'}
        </div>
      ) : (
        <>
          {/* Podium — top 3 */}
          {topThree.length >= 1 && (
            <div className="mb-10">
              <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wider mb-6 text-center inline-flex items-center gap-1.5 justify-center w-full">
                <Trophy size={14}/>Top performers
              </h2>
              <div className="flex items-end justify-center gap-4">
                {podiumOrder.map((a, idx) => (
                  <Link to={`/broker/dashboard?broker_id=${a.broker_id}`} key={a.broker_id} className="flex flex-col items-center hover:opacity-90">
                    <div className="w-16 h-16 rounded-full flex items-center justify-center text-white text-lg font-bold mb-2 shadow-lg"
                      style={{ backgroundColor: a.badge_color }}>
                      {a.broker_name.charAt(0).toUpperCase()}
                    </div>
                    <p className="text-sm font-semibold text-gray-800 text-center w-28 truncate">{a.broker_name}</p>
                    <p className="text-xs mb-1" style={{ color: a.badge_color }}>{a.rank_name}</p>
                    <p className="text-xs font-semibold text-gray-700 mb-2">{formatINR(a.total_income)}</p>
                    <div className={`w-24 ${podiumHeights[idx]} rounded-t-lg flex items-center justify-center text-white font-bold text-lg`}
                      style={{ backgroundColor: a.badge_color, opacity: 0.85 }}>
                      #{podiumPositions[idx]}
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          )}

          {/* Full leaderboard */}
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
            <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-2">
              <Award size={16} className="text-amber-500" />
              <span className="text-sm font-semibold text-gray-700">Full leaderboard</span>
              <span className="ml-auto text-xs text-gray-400">{filtered.length} brokers · target {config?.target_sq_yards?.toLocaleString('en-IN') ?? 3000} sqyd</span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-100">
                    <th className="text-center px-4 py-3 font-semibold text-gray-600 w-12">Rank</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-600">Broker</th>
                    <th className="text-left px-4 py-3 font-semibold text-gray-600">Badge</th>
                    <th className="text-right px-4 py-3 font-semibold text-gray-600">Team sqyd (capped/leg)</th>
                    <th className="text-right px-4 py-3 font-semibold text-gray-600">Distributed Income</th>
                    <th className="text-center px-4 py-3 font-semibold text-gray-600">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {filtered.map((a, i) => (
                    <tr key={a.broker_id} className={`hover:bg-gray-50 transition-colors ${i < 3 ? 'bg-amber-50/40' : ''}`}>
                      <td className="px-4 py-3 text-center">
                        {i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : (
                          <span className="text-gray-500 font-medium tabular-nums">#{i + 1}</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <Link to={`/broker/dashboard?broker_id=${a.broker_id}`} className="flex items-center gap-3 hover:text-blue-700">
                          <div className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold"
                            style={{ backgroundColor: a.badge_color }}>
                            {a.broker_name.charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <p className="font-medium text-gray-800 inline-flex items-center gap-1">{a.broker_name}<ArrowUpRight size={10} className="text-gray-400"/></p>
                            <p className="text-xs text-gray-400">[{a.broker_code}]{a.phone ? ` · ${a.phone}` : ''}</p>
                          </div>
                        </Link>
                      </td>
                      <td className="px-4 py-3">
                        <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold text-white"
                          style={{ backgroundColor: a.badge_color }}>
                          <span className="w-1.5 h-1.5 rounded-full bg-white/60" />
                          {a.rank_name}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums font-semibold text-gray-800">
                        <div>{a.lifetime_sqyd.toLocaleString('en-IN')}</div>
                        {/* Per-broker progress -- "how much achieved" toward 3000.
                            Bar fills the target proportionally, capped at 100%. */}
                        {(() => {
                          const target = config?.target_sq_yards ?? 3000
                          const pct = Math.min(100, Math.round((a.lifetime_sqyd / target) * 100))
                          return (
                            <div className="mt-1 w-32 ml-auto">
                              <div className="h-1.5 rounded-full bg-gray-100 overflow-hidden">
                                <div
                                  className={`h-full ${a.is_qualifying ? 'bg-emerald-500' : 'bg-amber-400'}`}
                                  style={{ width: `${pct}%` }}
                                />
                              </div>
                              <div className="text-[10px] text-gray-400 mt-0.5">{pct}% of {target.toLocaleString('en-IN')}</div>
                            </div>
                          )
                        })()}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-teal-700 font-medium">
                        {formatINR(a.total_income)}
                      </td>
                      <td className="px-4 py-3 text-center">
                        {a.is_qualifying ? (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-emerald-100 text-emerald-700">
                            <Trophy size={11}/>Qualifying
                          </span>
                        ) : (
                          <span className="text-[11px] text-gray-400">
                            {((config?.target_sq_yards ?? 3000) - a.lifetime_sqyd).toLocaleString('en-IN')} sqyd to qualify
                          </span>
                        )}
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
  )
}
