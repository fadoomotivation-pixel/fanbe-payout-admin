import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { Trophy, Edit2, Trash2, Plus, Save, X } from 'lucide-react';

interface CommissionRank {
  id: string;
  rank_name: string;
  min_business: number;
  max_business: number | null;
  income1_pct: number;
  income2_pct: number;
  income3_pct: number;
  badge_color: string;
  is_active: boolean;
  created_at: string;
}

const DEFAULT_ROW: Omit<CommissionRank, 'id' | 'created_at'> = {
  rank_name: '',
  min_business: 0,
  max_business: null,
  income1_pct: 0,
  income2_pct: 0,
  income3_pct: 0,
  badge_color: '#01696f',
  is_active: true,
};

export default function CommissionRanks() {
  const [ranks, setRanks] = useState<CommissionRank[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editRow, setEditRow] = useState<Partial<CommissionRank>>({});
  const [adding, setAdding] = useState(false);
  const [newRow, setNewRow] = useState<Omit<CommissionRank, 'id' | 'created_at'>>(DEFAULT_ROW);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function fetchRanks() {
    setLoading(true);
    const { data, error } = await supabase
      .from('commission_ranks')
      .select('*')
      .order('min_business', { ascending: true });
    if (!error && data) setRanks(data);
    setLoading(false);
  }

  useEffect(() => { fetchRanks(); }, []);

  async function handleSaveEdit(id: string) {
    setSaving(true);
    setError(null);
    const { error } = await supabase
      .from('commission_ranks')
      .update(editRow)
      .eq('id', id);
    if (error) { setError(error.message); }
    else { setEditingId(null); setEditRow({}); await fetchRanks(); }
    setSaving(false);
  }

  async function handleAdd() {
    setSaving(true);
    setError(null);
    const { error } = await supabase
      .from('commission_ranks')
      .insert([newRow]);
    if (error) { setError(error.message); }
    else { setAdding(false); setNewRow(DEFAULT_ROW); await fetchRanks(); }
    setSaving(false);
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this rank slab?')) return;
    const { error } = await supabase.from('commission_ranks').delete().eq('id', id);
    if (!error) await fetchRanks();
  }

  const fmt = (n: number | null) =>
    n === null ? '∞' : `₹${n.toLocaleString('en-IN')}`;

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Trophy className="text-amber-500" size={28} />
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Commission Ranks</h1>
            <p className="text-sm text-gray-500 mt-0.5">Define income slabs by broker lifetime business volume</p>
          </div>
        </div>
        <button
          onClick={() => { setAdding(true); setError(null); }}
          className="flex items-center gap-2 bg-teal-600 hover:bg-teal-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          <Plus size={16} /> Add Rank
        </button>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">{error}</div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left px-4 py-3 font-semibold text-gray-600">Rank</th>
                <th className="text-right px-4 py-3 font-semibold text-gray-600">Min Business</th>
                <th className="text-right px-4 py-3 font-semibold text-gray-600">Max Business</th>
                <th className="text-right px-4 py-3 font-semibold text-gray-600">L1 Income %</th>
                <th className="text-right px-4 py-3 font-semibold text-gray-600">L2 Income %</th>
                <th className="text-right px-4 py-3 font-semibold text-gray-600">L3 Income %</th>
                <th className="text-center px-4 py-3 font-semibold text-gray-600">Badge</th>
                <th className="text-center px-4 py-3 font-semibold text-gray-600">Active</th>
                <th className="text-center px-4 py-3 font-semibold text-gray-600">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={9} className="text-center py-12 text-gray-400">Loading ranks...</td></tr>
              ) : ranks.length === 0 && !adding ? (
                <tr><td colSpan={9} className="text-center py-12 text-gray-400">No ranks configured. Add your first slab.</td></tr>
              ) : (
                ranks.map((rank) => (
                  editingId === rank.id ? (
                    <tr key={rank.id} className="bg-teal-50">
                      <td className="px-4 py-2">
                        <input className="border rounded px-2 py-1 w-32" value={editRow.rank_name ?? rank.rank_name}
                          onChange={e => setEditRow(r => ({ ...r, rank_name: e.target.value }))} />
                      </td>
                      <td className="px-4 py-2">
                        <input type="number" className="border rounded px-2 py-1 w-28 text-right"
                          value={editRow.min_business ?? rank.min_business}
                          onChange={e => setEditRow(r => ({ ...r, min_business: Number(e.target.value) }))} />
                      </td>
                      <td className="px-4 py-2">
                        <input type="number" className="border rounded px-2 py-1 w-28 text-right"
                          value={editRow.max_business ?? rank.max_business ?? ''}
                          placeholder="∞"
                          onChange={e => setEditRow(r => ({ ...r, max_business: e.target.value === '' ? null : Number(e.target.value) }))} />
                      </td>
                      {(['income1_pct', 'income2_pct', 'income3_pct'] as const).map(f => (
                        <td key={f} className="px-4 py-2">
                          <input type="number" step="0.01" className="border rounded px-2 py-1 w-20 text-right"
                            value={editRow[f] ?? (rank[f] as number)}
                            onChange={e => setEditRow(r => ({ ...r, [f]: Number(e.target.value) }))} />
                        </td>
                      ))}
                      <td className="px-4 py-2 text-center">
                        <input type="color" className="w-8 h-8 rounded cursor-pointer border-0"
                          value={editRow.badge_color ?? rank.badge_color}
                          onChange={e => setEditRow(r => ({ ...r, badge_color: e.target.value }))} />
                      </td>
                      <td className="px-4 py-2 text-center">
                        <input type="checkbox" checked={editRow.is_active ?? rank.is_active}
                          onChange={e => setEditRow(r => ({ ...r, is_active: e.target.checked }))} />
                      </td>
                      <td className="px-4 py-2">
                        <div className="flex items-center justify-center gap-2">
                          <button onClick={() => handleSaveEdit(rank.id)} disabled={saving}
                            className="p-1.5 bg-teal-600 text-white rounded hover:bg-teal-700 transition-colors">
                            <Save size={14} />
                          </button>
                          <button onClick={() => { setEditingId(null); setEditRow({}); }}
                            className="p-1.5 bg-gray-200 text-gray-600 rounded hover:bg-gray-300 transition-colors">
                            <X size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    <tr key={rank.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: rank.badge_color }} />
                          <span className="font-medium text-gray-800">{rank.rank_name}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-gray-700">{fmt(rank.min_business)}</td>
                      <td className="px-4 py-3 text-right tabular-nums text-gray-700">{fmt(rank.max_business)}</td>
                      <td className="px-4 py-3 text-right tabular-nums font-semibold text-teal-700">{rank.income1_pct}%</td>
                      <td className="px-4 py-3 text-right tabular-nums text-gray-700">{rank.income2_pct}%</td>
                      <td className="px-4 py-3 text-right tabular-nums text-gray-700">{rank.income3_pct}%</td>
                      <td className="px-4 py-3 text-center">
                        <span className="inline-block w-5 h-5 rounded-full border border-gray-200"
                          style={{ backgroundColor: rank.badge_color }} title={rank.badge_color} />
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
                          rank.is_active ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'
                        }`}>
                          {rank.is_active ? 'Active' : 'Off'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-center gap-2">
                          <button onClick={() => { setEditingId(rank.id); setEditRow({}); }}
                            className="p-1.5 text-gray-400 hover:text-teal-600 hover:bg-teal-50 rounded transition-colors">
                            <Edit2 size={14} />
                          </button>
                          <button onClick={() => handleDelete(rank.id)}
                            className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors">
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                ))
              )}

              {/* Add new row inline */}
              {adding && (
                <tr className="bg-amber-50 border-t-2 border-amber-200">
                  <td className="px-4 py-2">
                    <input className="border rounded px-2 py-1 w-32" placeholder="Rank name"
                      value={newRow.rank_name}
                      onChange={e => setNewRow(r => ({ ...r, rank_name: e.target.value }))} />
                  </td>
                  <td className="px-4 py-2">
                    <input type="number" className="border rounded px-2 py-1 w-28 text-right"
                      value={newRow.min_business}
                      onChange={e => setNewRow(r => ({ ...r, min_business: Number(e.target.value) }))} />
                  </td>
                  <td className="px-4 py-2">
                    <input type="number" className="border rounded px-2 py-1 w-28 text-right"
                      value={newRow.max_business ?? ''} placeholder="∞"
                      onChange={e => setNewRow(r => ({ ...r, max_business: e.target.value === '' ? null : Number(e.target.value) }))} />
                  </td>
                  {(['income1_pct', 'income2_pct', 'income3_pct'] as const).map(f => (
                    <td key={f} className="px-4 py-2">
                      <input type="number" step="0.01" className="border rounded px-2 py-1 w-20 text-right"
                        value={newRow[f]}
                        onChange={e => setNewRow(r => ({ ...r, [f]: Number(e.target.value) }))} />
                    </td>
                  ))}
                  <td className="px-4 py-2 text-center">
                    <input type="color" className="w-8 h-8 rounded cursor-pointer border-0"
                      value={newRow.badge_color}
                      onChange={e => setNewRow(r => ({ ...r, badge_color: e.target.value }))} />
                  </td>
                  <td className="px-4 py-2 text-center">
                    <input type="checkbox" checked={newRow.is_active}
                      onChange={e => setNewRow(r => ({ ...r, is_active: e.target.checked }))} />
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex items-center justify-center gap-2">
                      <button onClick={handleAdd} disabled={saving || !newRow.rank_name}
                        className="p-1.5 bg-amber-500 text-white rounded hover:bg-amber-600 transition-colors disabled:opacity-40">
                        <Save size={14} />
                      </button>
                      <button onClick={() => { setAdding(false); setNewRow(DEFAULT_ROW); }}
                        className="p-1.5 bg-gray-200 text-gray-600 rounded hover:bg-gray-300 transition-colors">
                        <X size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <p className="mt-4 text-xs text-gray-400">
        * L1 = direct referral income · L2 = upline level-2 · L3 = upline level-3 and above
      </p>
    </div>
  );
}
