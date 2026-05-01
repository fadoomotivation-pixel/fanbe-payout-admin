// ─────────────────────────────────────────────────────────────────────────────
// CommissionRanks.tsx  —  Fanbe Group Admin
// Shows all 15 rank slabs with sq-yard / sub-rank qualification,
// differential commission %, and live broker count at each rank.
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

interface RankSlab {
  id: string
  rank_name: string
  level: number
  commission_pct: number
  rank_qualification_type: 'sq_yards' | 'sub_ranks'
  min_sq_yards: number
  max_sq_yards: number | null
  required_sub_rank_level: number | null
  required_sub_rank_count: number | null
  active: boolean
}

interface RankWithStats extends RankSlab {
  broker_count: number
  differential_pct: number  // commission_pct - prev_rank_pct
}

const RANK_BADGE_COLORS: Record<number, string> = {
  1:  'bg-gray-100 text-gray-700',
  2:  'bg-gray-200 text-gray-800',
  3:  'bg-green-100 text-green-700',
  4:  'bg-green-200 text-green-800',
  5:  'bg-teal-100 text-teal-700',
  6:  'bg-teal-200 text-teal-800',
  7:  'bg-blue-100 text-blue-700',
  8:  'bg-blue-200 text-blue-800',
  9:  'bg-indigo-100 text-indigo-700',
  10: 'bg-indigo-200 text-indigo-800',
  11: 'bg-purple-100 text-purple-700',
  12: 'bg-purple-200 text-purple-800',
  13: 'bg-orange-100 text-orange-700',
  14: 'bg-orange-200 text-orange-800',
  15: 'bg-yellow-200 text-yellow-900',
}

export default function CommissionRanks() {
  const [ranks, setRanks] = useState<RankWithStats[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    loadRanks()
  }, [])

  async function loadRanks() {
    setLoading(true)
    setError(null)
    try {
      // 1. Load all active rank slabs
      const { data: slabs, error: slabErr } = await supabase
        .from('commission_ranks')
        .select('*')
        .eq('active', true)
        .order('level', { ascending: true })
      if (slabErr) throw slabErr

      // 2. Load broker counts per rank level
      const { data: stats, error: statsErr } = await supabase
        .from('broker_rank_stats')
        .select('current_rank_level')
      if (statsErr) throw statsErr

      const countMap: Record<number, number> = {}
      for (const s of stats ?? []) {
        countMap[s.current_rank_level] = (countMap[s.current_rank_level] ?? 0) + 1
      }

      // 3. Compute differential %: this rank % - prev rank %
      const enriched: RankWithStats[] = (slabs ?? []).map((slab, idx, arr) => ({
        ...slab,
        broker_count: countMap[slab.level] ?? 0,
        differential_pct:
          idx === 0
            ? slab.commission_pct                       // R1: earns full %
            : parseFloat(
                (slab.commission_pct - arr[idx - 1].commission_pct).toFixed(3),
              ),
      }))

      setRanks(enriched)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to load ranks')
    } finally {
      setLoading(false)
    }
  }

  function qualificationLabel(r: RankSlab): string {
    if (r.rank_qualification_type === 'sq_yards') {
      const min = r.min_sq_yards.toLocaleString('en-IN')
      const max = r.max_sq_yards ? r.max_sq_yards.toLocaleString('en-IN') : '∞'
      return `${min} – ${max} sq.yd (team)` 
    }
    return `${r.required_sub_rank_count ?? 0}× Rank-${r.required_sub_rank_level} in team`
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-indigo-600" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-6">
        <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-red-700">
          <p className="font-medium">Error loading ranks</p>
          <p className="text-sm mt-1">{error}</p>
          <button
            onClick={loadRanks}
            className="mt-3 text-sm underline hover:no-underline"
          >
            Retry
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Commission Ranks</h1>
          <p className="text-sm text-gray-500 mt-1">
            15 rank slabs · Differential payout model · Deposited-amount basis
          </p>
        </div>
        <button
          onClick={loadRanks}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          Refresh
        </button>
      </div>

      {/* Legend */}
      <div className="flex gap-6 text-xs text-gray-500">
        <div className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-sm bg-teal-100 border border-teal-300" />
          Ranks 1–5: Sq. Yards qualification
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-sm bg-indigo-100 border border-indigo-300" />
          Ranks 6–15: Downline count qualification
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="px-4 py-3 text-left font-semibold text-gray-600 w-8">#</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-600">Rank Name</th>
                <th className="px-4 py-3 text-center font-semibold text-gray-600">Qualification Type</th>
                <th className="px-4 py-3 text-left font-semibold text-gray-600">Qualification Criteria</th>
                <th className="px-4 py-3 text-right font-semibold text-gray-600">Commission %</th>
                <th className="px-4 py-3 text-right font-semibold text-gray-600">Differential %</th>
                <th className="px-4 py-3 text-right font-semibold text-gray-600">Active Brokers</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {ranks.map((rank, idx) => {
                const isSqYards = rank.rank_qualification_type === 'sq_yards'
                const rowBg = isSqYards
                  ? 'hover:bg-teal-50'
                  : 'hover:bg-indigo-50'

                return (
                  <tr key={rank.id} className={`transition-colors ${rowBg}`}>
                    {/* Level */}
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold ${
                          RANK_BADGE_COLORS[rank.level] ?? 'bg-gray-100 text-gray-700'
                        }`}
                      >
                        {rank.level}
                      </span>
                    </td>

                    {/* Rank Name */}
                    <td className="px-4 py-3">
                      <span className="font-medium text-gray-900">{rank.rank_name}</span>
                      {rank.level === 15 && (
                        <span className="ml-2 text-xs bg-yellow-100 text-yellow-800 px-1.5 py-0.5 rounded font-medium">
                          TOP
                        </span>
                      )}
                    </td>

                    {/* Qualification Type */}
                    <td className="px-4 py-3 text-center">
                      {isSqYards ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-teal-100 text-teal-700">
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                              d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
                          </svg>
                          Sq. Yards
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-indigo-100 text-indigo-700">
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                              d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
                          </svg>
                          Downline Count
                        </span>
                      )}
                    </td>

                    {/* Qualification Criteria */}
                    <td className="px-4 py-3 text-gray-600">
                      {qualificationLabel(rank)}
                    </td>

                    {/* Commission % */}
                    <td className="px-4 py-3 text-right">
                      <span className="font-semibold text-gray-900">
                        {rank.commission_pct.toFixed(1)}%
                      </span>
                    </td>

                    {/* Differential % */}
                    <td className="px-4 py-3 text-right">
                      {idx === 0 ? (
                        <span className="text-xs text-gray-400 italic">Full (direct)</span>
                      ) : (
                        <span
                          className={`font-semibold ${
                            rank.differential_pct > 0
                              ? 'text-emerald-600'
                              : 'text-gray-400'
                          }`}
                        >
                          +{rank.differential_pct.toFixed(1)}%
                        </span>
                      )}
                    </td>

                    {/* Active Brokers */}
                    <td className="px-4 py-3 text-right">
                      <span
                        className={`inline-flex items-center justify-center min-w-[2rem] px-2 py-0.5 rounded-full text-xs font-semibold ${
                          rank.broker_count > 0
                            ? 'bg-indigo-50 text-indigo-700'
                            : 'bg-gray-100 text-gray-400'
                        }`}
                      >
                        {rank.broker_count}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Info box */}
      <div className="rounded-lg bg-amber-50 border border-amber-200 p-4 text-sm text-amber-800">
        <p className="font-semibold mb-1">⚡ Differential Payout Rule</p>
        <p>
          Each upline broker earns only the <strong>difference</strong> between their commission % and
          the immediate downline's commission %. Equal or lower rank = ₹0 upline payout.
          Payout is calculated only on <strong>deposited (approved payment) amount</strong>,
          not the total plot cost.
        </p>
      </div>
    </div>
  )
}
