import { useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { queryClient } from '../../lib/queryClient'
import toast from 'react-hot-toast'
import { Info, Pencil, Check, X, Clock } from 'lucide-react'

const DEFAULT_RANKS = [
  { rank_level: 1,  title: 'Executive',       commission_pct: 5.0,  qualification: '100 sq yd personal + 1 direct' },
  { rank_level: 2,  title: 'Senior Executive',      commission_pct: 5.5,  qualification: '500 sq yd team' },
  { rank_level: 3,  title: 'Sales Officer',         commission_pct: 6.0,  qualification: '750 sq yd team' },
  { rank_level: 4,  title: 'Senior Sales Officer',  commission_pct: 6.5,  qualification: '1250 sq yd team' },
  { rank_level: 5,  title: 'Team Manager',          commission_pct: 7.0,  qualification: '2000 sq yd team' },
  { rank_level: 6,  title: 'Senior Team Manager',   commission_pct: 7.5,  qualification: '3 Senior Sales Officers in direct team' },
  { rank_level: 7,  title: 'Asst. Sales Manager',   commission_pct: 8.0,  qualification: '3 Team Managers in direct team' },
  { rank_level: 8,  title: 'Sales Manager',         commission_pct: 8.5,  qualification: '3 Senior Team Managers in direct team' },
  { rank_level: 9,  title: 'Senior Sales Manager',  commission_pct: 9.0,  qualification: '3 Asst. Sales Managers in direct team' },
  { rank_level: 10, title: 'Asst. Gen Manager',     commission_pct: 9.5,  qualification: '3 Sales Managers in direct team' },
  { rank_level: 11, title: 'Gen Manager',           commission_pct: 10.0, qualification: '3 Senior Sales Managers in direct team' },
  { rank_level: 12, title: 'Senior GM',             commission_pct: 10.5, qualification: '3 Asst. Gen Managers in direct team' },
  { rank_level: 13, title: 'Zonal Manager',         commission_pct: 11.0, qualification: '3 Gen Managers in direct team' },
  { rank_level: 14, title: 'Vice President',        commission_pct: 11.5, qualification: '3 Senior GMs in direct team' },
  { rank_level: 15, title: 'President',             commission_pct: 12.0, qualification: '3 Zonal Managers in direct team' },
]

const DEFAULT_CONFIG = {
  grace_period_days: 90,
  booking_amount_minimum: 50000,
  payout_distribution_day: 1,
  tds_threshold: 20000,
  tds_rate: 5,
  achievers_pool_rate: 100,
  achievers_target_sqyd: 3000,
  achievers_streak_months: 3,
}

const CONFIG_META = [
  { key: 'grace_period_days',        label: 'Grace Period (days)',               hint: 'Days before installment payout lapses',         type: 'number', min: 1,   max: 365  },
  { key: 'booking_amount_minimum',   label: 'Booking Amount Minimum (₹)',        hint: 'Minimum deposit to activate commission',         type: 'number', min: 0              },
  { key: 'payout_distribution_day',  label: 'Payout Distribution Day',           hint: 'Day of month payouts are disbursed',             type: 'number', min: 1,   max: 28   },
  { key: 'tds_threshold',            label: 'TDS Threshold (₹)',                 hint: 'TDS deducted above this annual payout',          type: 'number', min: 0              },
  { key: 'tds_rate',                 label: 'TDS Rate (%)',                       hint: 'Percentage deducted as TDS',                    type: 'number', min: 0,   max: 100  },
  { key: 'achievers_pool_rate',      label: 'Achievers Club Pool Rate (₹/sq yd)',hint: 'Per sq yard allocated to pool',                  type: 'number', min: 0              },
  { key: 'achievers_target_sqyd',    label: 'Achievers Club Target (sq yd)',      hint: 'Monthly team target for qualification',          type: 'number', min: 0              },
  { key: 'achievers_streak_months',  label: 'Achievers Club Streak (months)',     hint: 'Consecutive months needed',                     type: 'number', min: 1,   max: 12  },
]

function RankBadge({ level }) {
  return (
    <span className="inline-flex items-center justify-center w-7 h-7 rounded-full bg-teal-100 text-teal-800 text-xs font-bold">
      {level}
    </span>
  )
}

export default function CommissionRules() {
  // ── Rank Rules ────────────────────────────────────────────
  const { data: rankRules = [], isLoading: ranksLoading } = useQuery({
    queryKey: ['rank-rules'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('rank_rules')
        .select('*')
        .order('rank_level')
      if (error || !data?.length) return DEFAULT_RANKS
      return data
    },
  })

  const [editingRank, setEditingRank] = useState(null) // rank_level number
  const [editPct, setEditPct] = useState('')

  const saveRank = useMutation({
    mutationFn: async ({ rank_level, title, old_pct, new_pct }) => {
      const { error } = await supabase
        .from('rank_rules')
        .upsert({ rank_level, commission_pct: new_pct, updated_at: new Date().toISOString() }, { onConflict: 'rank_level' })
      if (error) throw error
      await supabase.from('commission_audit_log').insert({
        table_name: 'rank_rules',
        rank_level,
        old_value: String(old_pct),
        new_value: String(new_pct),
        changed_at: new Date().toISOString(),
      })
    },
    onSuccess: (_, { rank_level, new_pct }) => {
      queryClient.invalidateQueries({ queryKey: ['rank-rules'] })
      queryClient.invalidateQueries({ queryKey: ['commission-audit-log'] })
      toast.success(`Rank ${rank_level} commission updated to ${new_pct}%`)
      setEditingRank(null)
    },
    onError: () => toast.error('Failed to save rank rule'),
  })

  function startEdit(row) {
    setEditingRank(row.rank_level)
    setEditPct(String(row.commission_pct))
  }
  function cancelEdit() { setEditingRank(null) }
  function confirmEdit(row) {
    const val = parseFloat(editPct)
    if (isNaN(val) || val < 0 || val > 20) { toast.error('Enter a value between 0 and 20'); return }
    saveRank.mutate({ rank_level: row.rank_level, title: row.title, old_pct: row.commission_pct, new_pct: val })
  }

  // ── Payout Config ─────────────────────────────────────────
  const { data: configRows = [] } = useQuery({
    queryKey: ['payout-config'],
    queryFn: async () => {
      const { data } = await supabase.from('payout_config').select('*')
      return data || []
    },
  })

  function getConfigVal(key) {
    const row = configRows.find(r => r.key === key)
    return row ? row.value : String(DEFAULT_CONFIG[key] ?? '')
  }

  const [configDraft, setConfigDraft] = useState({})
  function draftVal(key) {
    return key in configDraft ? configDraft[key] : getConfigVal(key)
  }

  const saveConfig = useMutation({
    mutationFn: async () => {
      const upserts = CONFIG_META.map(({ key }) => ({
        key,
        value: String(draftVal(key)),
        updated_at: new Date().toISOString(),
      }))
      for (const u of upserts) {
        const { error } = await supabase
          .from('payout_config')
          .upsert(u, { onConflict: 'key' })
        if (error) throw error
        const old = getConfigVal(u.key)
        if (old !== u.value) {
          await supabase.from('commission_audit_log').insert({
            table_name: 'payout_config',
            config_key: u.key,
            old_value: old,
            new_value: u.value,
            changed_at: new Date().toISOString(),
          })
        }
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payout-config'] })
      queryClient.invalidateQueries({ queryKey: ['commission-audit-log'] })
      setConfigDraft({})
      toast.success('Payout rules saved')
    },
    onError: () => toast.error('Failed to save payout rules'),
  })

  // ── Audit Log ─────────────────────────────────────────────
  const { data: auditLog = [] } = useQuery({
    queryKey: ['commission-audit-log'],
    queryFn: async () => {
      const { data } = await supabase
        .from('commission_audit_log')
        .select('*')
        .order('changed_at', { ascending: false })
        .limit(20)
      return data || []
    },
  })

  const formatDT = (s) => s ? new Date(s).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—'

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="page-title">Commission Rules</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Configure rank slabs and payout rules that drive all commission calculations
        </p>
      </div>

      {/* Two-column layout */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 items-start">

        {/* ── SECTION 1: Rank Slab Table ── */}
        <div className="card overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100">
            <h2 className="font-semibold text-slate-800">Commission Rank Slabs</h2>
            <p className="text-xs text-slate-400 mt-0.5">Click Edit on any row to update the commission %</p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-500 w-10">#</th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-500">Title</th>
                  <th className="px-4 py-2.5 text-right text-xs font-semibold text-slate-500">Comm %</th>
                  <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-500 hidden lg:table-cell">Qualification</th>
                  <th className="px-4 py-2.5 w-24 text-xs font-semibold text-slate-500">Action</th>
                </tr>
              </thead>
              <tbody>
                {ranksLoading
                  ? Array.from({ length: 5 }).map((_, i) => (
                      <tr key={i} className="border-b border-slate-100">
                        {[1,2,3,4,5].map(j => (
                          <td key={j} className="px-4 py-3">
                            <div className="skeleton skeleton-text rounded" />
                          </td>
                        ))}
                      </tr>
                    ))
                  : rankRules.map((row) => {
                    const isEditing = editingRank === row.rank_level
                    return (
                      <tr key={row.rank_level} className={`border-b border-slate-100 transition-colors ${isEditing ? 'bg-teal-50' : 'hover:bg-slate-50'}`}>
                        <td className="px-4 py-2.5"><RankBadge level={row.rank_level} /></td>
                        <td className="px-4 py-2.5 font-medium text-slate-800">{row.title}</td>
                        <td className="px-4 py-2.5 text-right">
                          {isEditing ? (
                            <input
                              type="number"
                              step="0.5"
                              min="0"
                              max="20"
                              value={editPct}
                              onChange={e => setEditPct(e.target.value)}
                              className="input w-20 text-right py-1 text-sm"
                              autoFocus
                            />
                          ) : (
                            <span className="font-semibold text-teal-700">{row.commission_pct}%</span>
                          )}
                        </td>
                        <td className="px-4 py-2.5 text-xs text-slate-400 hidden lg:table-cell">{row.qualification}</td>
                        <td className="px-4 py-2.5">
                          {isEditing ? (
                            <div className="flex items-center gap-1">
                              <button
                                onClick={() => confirmEdit(row)}
                                disabled={saveRank.isPending}
                                className="p-1.5 rounded-lg bg-teal-100 text-teal-700 hover:bg-teal-200 disabled:opacity-50"
                              >
                                <Check size={13} />
                              </button>
                              <button
                                onClick={cancelEdit}
                                className="p-1.5 rounded-lg bg-slate-100 text-slate-500 hover:bg-slate-200"
                              >
                                <X size={13} />
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => startEdit(row)}
                              className="flex items-center gap-1 text-xs text-slate-500 hover:text-teal-700 px-2 py-1 rounded hover:bg-teal-50"
                            >
                              <Pencil size={11} /> Edit
                            </button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
              </tbody>
            </table>
          </div>

          {/* Differential info box */}
          <div className="mx-4 my-4 flex gap-3 bg-blue-50 border border-blue-100 rounded-xl p-3">
            <Info size={15} className="text-blue-500 shrink-0 mt-0.5" />
            <p className="text-xs text-blue-700 leading-relaxed">
              <strong>Differential Payout:</strong> Payouts are calculated on a differential basis.
              Each upline earns only the <em>difference</em> between their slab and their direct downline's slab.
              Equal or higher-rank uplines receive no differential payout.
            </p>
          </div>
        </div>

        {/* ── SECTION 2: Payout Rules Config ── */}
        <div className="card overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-100">
            <h2 className="font-semibold text-slate-800">Payout Rules Configuration</h2>
            <p className="text-xs text-slate-400 mt-0.5">Global settings applied to all commission calculations</p>
          </div>

          <div className="divide-y divide-slate-100">
            {CONFIG_META.map(({ key, label, hint, type, min, max }) => (
              <div key={key} className="flex items-center justify-between px-5 py-3.5 gap-4">
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-slate-700">{label}</p>
                  <p className="text-xs text-slate-400 mt-0.5">{hint}</p>
                </div>
                <input
                  type={type}
                  min={min}
                  max={max}
                  value={draftVal(key)}
                  onChange={e => setConfigDraft(d => ({ ...d, [key]: e.target.value }))}
                  className="input w-28 text-right py-1.5 text-sm"
                />
              </div>
            ))}
          </div>

          <div className="px-5 py-4 border-t border-slate-100 bg-slate-50">
            <button
              onClick={() => saveConfig.mutate()}
              disabled={saveConfig.isPending || Object.keys(configDraft).length === 0}
              className="btn-primary w-full disabled:opacity-50"
            >
              {saveConfig.isPending ? 'Saving…' : 'Save Payout Rules'}
            </button>
          </div>
        </div>
      </div>

      {/* ── SECTION 3: Audit Log ── */}
      <div className="card overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-2">
          <Clock size={15} className="text-slate-400" />
          <h2 className="font-semibold text-slate-800">Change History</h2>
          <span className="ml-auto text-xs text-slate-400">Last 20 changes</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-500">What Changed</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-500">Old Value</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-500">New Value</th>
                <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-500">When</th>
              </tr>
            </thead>
            <tbody>
              {auditLog.length === 0 ? (
                <tr>
                  <td colSpan="4" className="px-4 py-10 text-center text-slate-400 text-sm">
                    No changes recorded yet.
                  </td>
                </tr>
              ) : auditLog.map((log) => (
                <tr key={log.id} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-3 text-slate-700">
                    {log.table_name === 'rank_rules'
                      ? `Rank ${log.rank_level} commission %`
                      : log.config_key?.replace(/_/g, ' ')}
                  </td>
                  <td className="px-4 py-3 text-red-500 line-through">{log.old_value}</td>
                  <td className="px-4 py-3 text-green-700 font-semibold">{log.new_value}</td>
                  <td className="px-4 py-3 text-slate-400 text-xs whitespace-nowrap">{formatDT(log.changed_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
