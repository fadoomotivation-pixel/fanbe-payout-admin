import { useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
import { Trophy, Edit2, Save, X, Users, Square, Info } from 'lucide-react';

// Schema (created by 20260501_payout_engine_v2 + 20260510_brochure_alignment):
//   level int, rank_name text unique, commission_pct numeric,
//   rank_qualification_type 'sq_yards' | 'sub_ranks',
//   min_sq_yards / max_sq_yards numeric,
//   required_sub_rank_level int, required_sub_rank_count int,
//   min_directs int, badge_color text, active bool
interface Rank {
  id: string;
  level: number;
  rank_name: string;
  commission_pct: number;
  rank_qualification_type: 'sq_yards' | 'direct_sq_yards' | 'sub_ranks';
  min_sq_yards: number;
  max_sq_yards: number | null;
  required_sub_rank_level: number | null;
  required_sub_rank_count: number | null;
  min_directs: number;
  badge_color: string;
  active: boolean;
}

const QUALIFY_TYPES = [
  { value: 'direct_sq_yards', label: 'Sq Yards (direct sales only — entry)' },
  { value: 'sq_yards',        label: 'Sq Yards (team volume)' },
  { value: 'sub_ranks',       label: 'Sub-rank count (3 of rank N)' },
] as const;

export default function CommissionRanks() {
  const [ranks, setRanks] = useState<Rank[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Partial<Rank>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function fetchRanks() {
    setLoading(true);
    const { data, error } = await supabase
      .from('commission_ranks')
      .select('id,level,rank_name,commission_pct,rank_qualification_type,min_sq_yards,max_sq_yards,required_sub_rank_level,required_sub_rank_count,min_directs,badge_color,active')
      .order('level', { ascending: true });
    if (error) setError(error.message);
    else setRanks((data ?? []) as Rank[]);
    setLoading(false);
  }
  useEffect(() => { fetchRanks(); }, []);

  const ranksByLevel = useMemo(() => {
    const m = new Map<number, Rank>();
    ranks.forEach(r => m.set(r.level, r));
    return m;
  }, [ranks]);

  function startEdit(r: Rank) {
    setEditingId(r.id);
    setDraft({ ...r });
    setError(null);
  }

  async function saveEdit() {
    if (!editingId) return;
    setSaving(true);
    setError(null);
    const patch: Partial<Rank> = { ...draft };
    // sq_yards (team) and direct_sq_yards (R1's direct-only count) both use the
    // min/max sqyd columns; only sub_ranks needs the required_sub_rank_* fields.
    if (patch.rank_qualification_type === 'sq_yards' || patch.rank_qualification_type === 'direct_sq_yards') {
      patch.required_sub_rank_level = null;
      patch.required_sub_rank_count = null;
    } else if (patch.rank_qualification_type === 'sub_ranks') {
      patch.min_sq_yards = 0;
      patch.max_sq_yards = null;
    }
    const { error } = await supabase
      .from('commission_ranks')
      .update(patch)
      .eq('id', editingId);
    if (error) setError(error.message);
    else { setEditingId(null); setDraft({}); await fetchRanks(); }
    setSaving(false);
  }

  function describeQualification(r: Rank): string {
    if (r.rank_qualification_type === 'sq_yards' || r.rank_qualification_type === 'direct_sq_yards') {
      const min = r.min_sq_yards;
      const max = r.max_sq_yards;
      const range = max ? `${min}–${max}` : `${min}+`;
      const scope = r.rank_qualification_type === 'direct_sq_yards' ? ' direct' : ' team';
      const directs = r.min_directs > 0 ? ` · min ${r.min_directs} direct` : '';
      return `${range} Sq Yds${scope}${directs}`;
    }
    const subRank = r.required_sub_rank_level
      ? (ranksByLevel.get(r.required_sub_rank_level)?.rank_name ?? `Rank ${r.required_sub_rank_level}`)
      : '—';
    return `${r.required_sub_rank_count ?? 3} × ${subRank}`;
  }

  return (
    <div className="p-3 md:p-6 max-w-7xl mx-auto">
      <div className="flex items-center gap-3 mb-2">
        <Trophy className="text-amber-500" size={28} />
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Commission Ranks</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            15-rank ladder per Fanbe Group Business Plan · 5% → 12% commission slabs
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2 mb-4">
        <span className="inline-flex items-center gap-1.5 text-xs bg-amber-50 border border-amber-200 text-amber-700 rounded-lg px-3 py-1.5">
          <Square size={11} /> Rank 1: 0–100 sqyd direct (any leg)
        </span>
        <span className="inline-flex items-center gap-1.5 text-xs bg-blue-50 border border-blue-200 text-blue-700 rounded-lg px-3 py-1.5">
          <Square size={11} /> Ranks 2–5: team sqyd (direct + indirect both count)
        </span>
        <span className="inline-flex items-center gap-1.5 text-xs bg-purple-50 border border-purple-200 text-purple-700 rounded-lg px-3 py-1.5">
          <Users size={11} /> Ranks 6–15: 3 brokers of the previous rank
        </span>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{error}</div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200 text-xs">
              <th className="text-center px-3 py-3 font-semibold text-gray-600 w-14">Rank</th>
              <th className="text-left   px-4 py-3 font-semibold text-gray-600">Name</th>
              <th className="text-right  px-4 py-3 font-semibold text-gray-600">Commission %</th>
              <th className="text-left   px-4 py-3 font-semibold text-gray-600">Qualification Type</th>
              <th className="text-left   px-4 py-3 font-semibold text-gray-600">Qualification Detail</th>
              <th className="text-center px-4 py-3 font-semibold text-gray-600">Active</th>
              <th className="text-center px-4 py-3 font-semibold text-gray-600 w-20">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {loading ? (
              <tr><td colSpan={7} className="text-center py-12 text-gray-400">Loading ranks…</td></tr>
            ) : ranks.length === 0 ? (
              <tr><td colSpan={7} className="text-center py-12 text-gray-400">No ranks. Run migration to seed.</td></tr>
            ) : ranks.map(r => editingId === r.id ? (
              <tr key={r.id} className="bg-teal-50/60">
                <td className="px-3 py-2 text-center font-semibold text-gray-700">{r.level}</td>
                <td className="px-4 py-2">
                  <input className="border rounded px-2 py-1 w-44"
                    value={draft.rank_name ?? ''}
                    onChange={e => setDraft(d => ({ ...d, rank_name: e.target.value }))} />
                </td>
                <td className="px-4 py-2 text-right">
                  <input type="number" step="0.1" className="border rounded px-2 py-1 w-20 text-right"
                    value={draft.commission_pct ?? 0}
                    onChange={e => setDraft(d => ({ ...d, commission_pct: Number(e.target.value) }))} />
                </td>
                <td className="px-4 py-2">
                  <select className="border rounded px-2 py-1"
                    value={draft.rank_qualification_type ?? 'sq_yards'}
                    onChange={e => setDraft(d => ({ ...d, rank_qualification_type: e.target.value as Rank['rank_qualification_type'] }))}>
                    {QUALIFY_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </td>
                <td className="px-4 py-2">
                  {draft.rank_qualification_type === 'sub_ranks' ? (
                    <div className="flex items-center gap-1.5">
                      <input type="number" className="border rounded px-2 py-1 w-14 text-right"
                        value={draft.required_sub_rank_count ?? 3}
                        onChange={e => setDraft(d => ({ ...d, required_sub_rank_count: Number(e.target.value) }))} />
                      <span className="text-gray-500 text-xs">×</span>
                      <select className="border rounded px-2 py-1"
                        value={draft.required_sub_rank_level ?? ''}
                        onChange={e => setDraft(d => ({ ...d, required_sub_rank_level: e.target.value ? Number(e.target.value) : null }))}>
                        <option value="">— rank —</option>
                        {ranks.filter(x => x.level < r.level).map(x =>
                          <option key={x.level} value={x.level}>L{x.level} {x.rank_name}</option>)}
                      </select>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <input type="number" className="border rounded px-2 py-1 w-20 text-right"
                        value={draft.min_sq_yards ?? 0}
                        onChange={e => setDraft(d => ({ ...d, min_sq_yards: Number(e.target.value) }))}
                        placeholder="min" />
                      <span className="text-gray-400">–</span>
                      <input type="number" className="border rounded px-2 py-1 w-20 text-right"
                        value={draft.max_sq_yards ?? ''}
                        placeholder="∞"
                        onChange={e => setDraft(d => ({ ...d, max_sq_yards: e.target.value === '' ? null : Number(e.target.value) }))} />
                      <span className="text-xs text-gray-500 ml-2">directs</span>
                      <input type="number" className="border rounded px-2 py-1 w-14 text-right"
                        value={draft.min_directs ?? 0}
                        onChange={e => setDraft(d => ({ ...d, min_directs: Number(e.target.value) }))} />
                    </div>
                  )}
                </td>
                <td className="px-4 py-2 text-center">
                  <input type="checkbox" checked={draft.active ?? true}
                    onChange={e => setDraft(d => ({ ...d, active: e.target.checked }))} />
                </td>
                <td className="px-4 py-2">
                  <div className="flex items-center justify-center gap-2">
                    <button onClick={saveEdit} disabled={saving}
                      className="p-1.5 bg-teal-600 text-white rounded hover:bg-teal-700 transition-colors disabled:opacity-50">
                      <Save size={14} />
                    </button>
                    <button onClick={() => { setEditingId(null); setDraft({}); }}
                      className="p-1.5 bg-gray-200 text-gray-600 rounded hover:bg-gray-300 transition-colors">
                      <X size={14} />
                    </button>
                  </div>
                </td>
              </tr>
            ) : (
              <tr key={r.id} className="hover:bg-gray-50 transition-colors">
                <td className="px-3 py-3 text-center">
                  <span className="inline-flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold text-white"
                    style={{ backgroundColor: r.badge_color || '#475569' }}>
                    {r.level}
                  </span>
                </td>
                <td className="px-4 py-3 font-medium text-gray-800">{r.rank_name}</td>
                <td className="px-4 py-3 text-right tabular-nums font-semibold text-teal-700">
                  {Number(r.commission_pct).toFixed(1)}%
                </td>
                <td className="px-4 py-3">
                  {(() => {
                    const t = r.rank_qualification_type
                    const style = t === 'direct_sq_yards' ? 'bg-amber-50 text-amber-700 border border-amber-200'
                                : t === 'sq_yards'        ? 'bg-blue-50 text-blue-700 border border-blue-200'
                                                          : 'bg-purple-50 text-purple-700 border border-purple-200'
                    const label = t === 'direct_sq_yards' ? 'Direct Sq Yards'
                                : t === 'sq_yards'        ? 'Team Sq Yards'
                                                          : 'Sub-ranks'
                    return (
                      <span className={`inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-full font-medium ${style}`}>
                        {t === 'sub_ranks' ? <Users size={11}/> : <Square size={11}/>}
                        {label}
                      </span>
                    )
                  })()}
                </td>
                <td className="px-4 py-3 text-gray-700 tabular-nums text-xs">
                  {describeQualification(r)}
                </td>
                <td className="px-4 py-3 text-center">
                  <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                    r.active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                  }`}>{r.active ? 'Active' : 'Off'}</span>
                </td>
                <td className="px-4 py-3 text-center">
                  <button onClick={() => startEdit(r)}
                    className="p-1.5 text-gray-400 hover:text-teal-600 hover:bg-teal-50 rounded transition-colors">
                    <Edit2 size={14} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-4 text-xs text-gray-400">
        * Commission % is the rank's own slab. Actual payout to upline is computed on a
        differential basis (this rank − downline rank) by the payout engine.
      </p>
    </div>
  );
}
