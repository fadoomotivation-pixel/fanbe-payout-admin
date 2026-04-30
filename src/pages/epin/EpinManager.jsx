import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { formatDate } from '@/lib/utils'
import { Modal } from '@/components/ui/Modal.tsx'
import toast from 'react-hot-toast'
import {
  KeyRound, Plus, Copy, Search, RefreshCw,
  CheckCircle2, XCircle, Clock, ShieldCheck
} from 'lucide-react'

const STATUS_COLORS = {
  unused:  'bg-green-100  text-green-800',
  used:    'bg-slate-100  text-slate-600',
  expired: 'bg-red-100    text-red-700',
  revoked: 'bg-orange-100 text-orange-800',
}

const STATUS_ICONS = {
  unused:  <Clock size={12} />,
  used:    <CheckCircle2 size={12} />,
  expired: <XCircle size={12} />,
  revoked: <ShieldCheck size={12} />,
}

function generateCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  return Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
}

export default function EpinManager() {
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [createOpen, setCreateOpen] = useState(false)
  const [bulkCount, setBulkCount] = useState(10)
  const [expiryDate, setExpiryDate] = useState('')
  const [notes, setNotes] = useState('')
  const [revokeTarget, setRevokeTarget] = useState(null)

  // ── Queries ───────────────────────────────────────────────────────────────
  const { data: epins = [], isLoading, refetch } = useQuery({
    queryKey: ['epins', statusFilter],
    queryFn: async () => {
      let q = supabase
        .from('bp_epins')
        .select('*, bp_users:used_by(full_name, phone)')
        .order('created_at', { ascending: false })
      if (statusFilter !== 'all') q = q.eq('status', statusFilter)
      const { data, error } = await q
      if (error) throw error
      return data ?? []
    },
  })

  const { data: stats } = useQuery({
    queryKey: ['epin_stats'],
    queryFn: async () => {
      const { data } = await supabase.from('bp_epins').select('status')
      if (!data) return {}
      return {
        total:   data.length,
        unused:  data.filter(r => r.status === 'unused').length,
        used:    data.filter(r => r.status === 'used').length,
        expired: data.filter(r => r.status === 'expired').length,
        revoked: data.filter(r => r.status === 'revoked').length,
      }
    },
  })

  // ── Mutations ─────────────────────────────────────────────────────────────
  const createMutation = useMutation({
    mutationFn: async () => {
      const rows = Array.from({ length: Number(bulkCount) }, () => ({
        code:        generateCode(),
        status:      'unused',
        expiry_date: expiryDate || null,
        notes:       notes || null,
      }))
      const { error } = await supabase.from('bp_epins').insert(rows)
      if (error) throw error
      return rows.length
    },
    onSuccess: (count) => {
      qc.invalidateQueries({ queryKey: ['epins'] })
      qc.invalidateQueries({ queryKey: ['epin_stats'] })
      toast.success(`${count} E-Pin${count > 1 ? 's' : ''} generated`)
      setCreateOpen(false)
      setBulkCount(10)
      setExpiryDate('')
      setNotes('')
    },
    onError: (e) => toast.error(e.message),
  })

  const revokeMutation = useMutation({
    mutationFn: async (id) => {
      const { error } = await supabase.from('bp_epins').update({ status: 'revoked', updated_at: new Date().toISOString() }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['epins'] })
      qc.invalidateQueries({ queryKey: ['epin_stats'] })
      toast.success('E-Pin revoked')
      setRevokeTarget(null)
    },
    onError: (e) => toast.error(e.message),
  })

  // ── Helpers ───────────────────────────────────────────────────────────────
  function copyCode(code) {
    navigator.clipboard.writeText(code).then(() => toast.success('Code copied!'))
  }

  const filtered = epins.filter(r => {
    const q = search.toLowerCase()
    return (
      !q ||
      r.code?.toLowerCase().includes(q) ||
      r.bp_users?.full_name?.toLowerCase().includes(q) ||
      r.bp_users?.phone?.toLowerCase().includes(q)
    )
  })

  const TABS = [
    { label: 'All',     value: 'all',     count: stats?.total },
    { label: 'Unused',  value: 'unused',  count: stats?.unused },
    { label: 'Used',    value: 'used',    count: stats?.used },
    { label: 'Expired', value: 'expired', count: stats?.expired },
    { label: 'Revoked', value: 'revoked', count: stats?.revoked },
  ]

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-5">

      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="page-title flex items-center gap-2">
            <KeyRound size={20} className="text-teal-600" /> E-Pin / Registration Code Manager
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">Generate and manage unique registration codes for broker onboarding</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => refetch()} className="btn-secondary text-sm"><RefreshCw size={14} /> Refresh</button>
          <button onClick={() => setCreateOpen(true)} className="btn-primary text-sm"><Plus size={14} /> Generate E-Pins</button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {[
          { label: 'Total',   value: stats?.total   ?? 0, cls: 'text-slate-700' },
          { label: 'Unused',  value: stats?.unused  ?? 0, cls: 'text-green-700' },
          { label: 'Used',    value: stats?.used    ?? 0, cls: 'text-slate-600' },
          { label: 'Expired', value: stats?.expired ?? 0, cls: 'text-red-600' },
          { label: 'Revoked', value: stats?.revoked ?? 0, cls: 'text-orange-700' },
        ].map(s => (
          <div key={s.label} className="card p-4">
            <p className="text-xs text-slate-400 mb-1">{s.label}</p>
            <p className={`text-xl font-bold ${s.cls}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {/* Table Card */}
      <div className="card p-0 overflow-hidden">

        {/* Tabs */}
        <div className="flex border-b border-slate-200 overflow-x-auto">
          {TABS.map(t => (
            <button
              key={t.value}
              onClick={() => setStatusFilter(t.value)}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                statusFilter === t.value
                  ? 'border-teal-600 text-teal-700'
                  : 'border-transparent text-slate-500 hover:text-slate-700'
              }`}
            >
              {t.label}
              {t.count !== undefined && t.count > 0 && (
                <span className="ml-1 bg-slate-100 text-slate-600 text-xs font-semibold px-1.5 py-0.5 rounded-full">
                  {t.count}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Search */}
        <div className="p-4 border-b border-slate-100">
          <div className="relative max-w-sm">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              className="input pl-9 text-sm"
              placeholder="Search by code or user name…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
        </div>

        {/* Table */}
        {isLoading ? (
          <div className="p-10 text-center text-slate-400 text-sm">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="p-14 text-center">
            <KeyRound size={38} className="text-slate-200 mx-auto mb-3" />
            <p className="text-slate-500 text-sm">No E-Pins found. Generate some to get started.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  {['Code','Status','Generated On','Expiry','Used By','Used At','Notes','Actions'].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-slate-500 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(row => (
                  <tr key={row.id} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-teal-700 tracking-widest text-sm">{row.code}</span>
                        <button
                          onClick={() => copyCode(row.code)}
                          className="text-slate-400 hover:text-teal-600 transition-colors"
                          title="Copy code"
                        >
                          <Copy size={13} />
                        </button>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold capitalize ${STATUS_COLORS[row.status] || ''}`}>
                        {STATUS_ICONS[row.status]}
                        {row.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-500 text-xs">{formatDate(row.created_at)}</td>
                    <td className="px-4 py-3 text-slate-500 text-xs">
                      {row.expiry_date ? (
                        <span className={row.expiry_date < new Date().toISOString().split('T')[0] ? 'text-red-500 font-semibold' : ''}>
                          {formatDate(row.expiry_date)}
                        </span>
                      ) : '—'}
                    </td>
                    <td className="px-4 py-3">
                      {row.bp_users ? (
                        <div>
                          <div className="font-medium text-slate-800 text-xs">{row.bp_users.full_name}</div>
                          <div className="text-slate-400 text-xs">{row.bp_users.phone}</div>
                        </div>
                      ) : '—'}
                    </td>
                    <td className="px-4 py-3 text-slate-500 text-xs">{row.used_at ? formatDate(row.used_at) : '—'}</td>
                    <td className="px-4 py-3 text-slate-500 text-xs max-w-[120px] truncate" title={row.notes}>{row.notes || '—'}</td>
                    <td className="px-4 py-3">
                      {row.status === 'unused' && (
                        <button
                          onClick={() => setRevokeTarget(row)}
                          className="text-xs text-red-600 hover:text-red-800 font-medium flex items-center gap-1 transition-colors"
                        >
                          <XCircle size={12} /> Revoke
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── GENERATE E-PINS MODAL ── */}
      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Generate E-Pins" size="sm">
        <div className="space-y-4">
          <div>
            <label className="label">Number of Codes to Generate *</label>
            <input
              type="number"
              min={1}
              max={500}
              className="input mt-1"
              value={bulkCount}
              onChange={e => setBulkCount(e.target.value)}
            />
            <p className="text-xs text-slate-400 mt-1">Each code is unique 8-character alphanumeric. Max 500 per batch.</p>
          </div>
          <div>
            <label className="label">Expiry Date (optional)</label>
            <input
              type="date"
              className="input mt-1"
              value={expiryDate}
              onChange={e => setExpiryDate(e.target.value)}
              min={new Date().toISOString().split('T')[0]}
            />
          </div>
          <div>
            <label className="label">Notes (optional)</label>
            <input type="text" className="input mt-1" value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="e.g. Batch for May 2026 camp" />
          </div>
          <div className="flex justify-end gap-2">
            <button className="btn-secondary" onClick={() => setCreateOpen(false)}>Cancel</button>
            <button
              className="btn-primary"
              disabled={!bulkCount || bulkCount < 1 || createMutation.isPending}
              onClick={() => createMutation.mutate()}
            >
              {createMutation.isPending ? 'Generating…' : `Generate ${bulkCount} Pin${bulkCount > 1 ? 's' : ''}`}
            </button>
          </div>
        </div>
      </Modal>

      {/* ── REVOKE CONFIRM MODAL ── */}
      <Modal open={!!revokeTarget} onClose={() => setRevokeTarget(null)} title="Revoke E-Pin" size="sm">
        {revokeTarget && (
          <div className="space-y-4">
            <div className="bg-orange-50 border border-orange-200 rounded-lg p-4 text-sm">
              <p className="font-semibold text-orange-800 font-mono tracking-widest text-lg">{revokeTarget.code}</p>
              <p className="text-slate-500 mt-1 text-xs">Generated on {formatDate(revokeTarget.created_at)}</p>
            </div>
            <p className="text-sm text-slate-600">
              Revoking this code will prevent anyone from using it for registration. This action cannot be undone.
            </p>
            <div className="flex justify-end gap-2">
              <button className="btn-secondary" onClick={() => setRevokeTarget(null)}>Cancel</button>
              <button
                className="btn-primary !bg-orange-600 hover:!bg-orange-700 !border-orange-600"
                disabled={revokeMutation.isPending}
                onClick={() => revokeMutation.mutate(revokeTarget.id)}
              >
                {revokeMutation.isPending ? 'Revoking…' : 'Confirm Revoke'}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
