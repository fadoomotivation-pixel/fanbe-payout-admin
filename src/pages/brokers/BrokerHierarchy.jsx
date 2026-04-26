import { useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { queryClient } from '../../lib/queryClient'
import { formatDate, formatINR } from '../../lib/utils'
import LoadingSpinner from '../../components/ui/LoadingSpinner'
import Modal from '../../components/ui/Modal'
import toast from 'react-hot-toast'
import {
  Users, ChevronDown, ChevronRight, Award, AlertCircle,
  CheckCircle2, CreditCard, Eye, Search
} from 'lucide-react'

const PAYOUT_READINESS = {
  ready: 'bg-green-100 text-green-700',
  pending_kyc: 'bg-yellow-100 text-yellow-800',
  pending_bank: 'bg-orange-100 text-orange-700',
  blocked: 'bg-red-100 text-red-700',
}

function BrokerNode({ broker, depth = 0 }) {
  const [open, setOpen] = useState(depth === 0)

  const hasChildren = broker.children && broker.children.length > 0
  const readiness = broker.kyc_status === 'approved' && broker.bank_verified
    ? 'ready'
    : broker.kyc_status !== 'approved'
    ? 'pending_kyc'
    : 'pending_bank'

  return (
    <div className={`${depth > 0 ? 'ml-6 border-l border-slate-200 pl-4' : ''}`}>
      <div className="flex items-center gap-2 py-2.5 group">
        <button
          onClick={() => setOpen(o => !o)}
          className={`p-0.5 rounded text-slate-400 ${!hasChildren ? 'invisible' : 'hover:bg-slate-100'}`}
        >
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </button>
        <div className="flex items-center gap-3 flex-1 min-w-0">
          <div className="w-8 h-8 rounded-full bg-teal-100 flex items-center justify-center shrink-0">
            <span className="text-xs font-bold text-teal-700">{broker.name?.[0]?.toUpperCase()}</span>
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-slate-800 truncate">{broker.name}</p>
            <p className="text-xs text-slate-400">{broker.broker_id} · {broker.phone}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className={`hidden sm:inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${PAYOUT_READINESS[readiness]}`}>
            {readiness.replace('_', ' ')}
          </span>
          {broker.total_bookings !== undefined && (
            <span className="text-xs text-slate-500">{broker.total_bookings} bookings</span>
          )}
          {broker.pending_payout > 0 && (
            <span className="text-xs font-semibold text-orange-600">{formatINR(broker.pending_payout)} pending</span>
          )}
        </div>
      </div>
      {open && hasChildren && (
        <div>
          {broker.children.map((child) => (
            <BrokerNode key={child.id} broker={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  )
}

function buildTree(brokers) {
  const map = {}
  brokers.forEach(b => { map[b.id] = { ...b, children: [] } })
  const roots = []
  brokers.forEach(b => {
    if (b.sponsor_id && map[b.sponsor_id]) {
      map[b.sponsor_id].children.push(map[b.id])
    } else {
      roots.push(map[b.id])
    }
  })
  return roots
}

export default function BrokerHierarchy() {
  const [search, setSearch] = useState('')
  const [impersonateOpen, setImpersonateOpen] = useState(false)
  const [selectedBroker, setSelectedBroker] = useState(null)
  const [impersonateReason, setImpersonateReason] = useState('')
  const [viewMode, setViewMode] = useState('tree') // tree | table

  const { data: brokers = [], isLoading } = useQuery({
    queryKey: ['brokers-hierarchy'],
    queryFn: async () => {
      const { data } = await supabase
        .from('brokers')
        .select('id, name, broker_id, phone, email, sponsor_id, kyc_status, bank_verified, is_active, created_at')
        .order('created_at', { ascending: true })
      // Fetch booking counts & pending payouts
      const { data: payouts } = await supabase
        .from('bp_payout_transactions')
        .select('broker_id, net_amount, status')
        .eq('status', 'pending')
      const payoutMap = {}
      ;(payouts || []).forEach(p => {
        payoutMap[p.broker_id] = (payoutMap[p.broker_id] || 0) + Number(p.net_amount || 0)
      })
      return (data || []).map(b => ({
        ...b,
        pending_payout: payoutMap[b.id] || 0,
      }))
    },
  })

  const impersonateMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('bp_impersonation_log').insert({
        broker_id: selectedBroker.id,
        reason: impersonateReason,
        performed_at: new Date().toISOString(),
      })
      if (error) throw error
    },
    onSuccess: () => {
      toast.success(`Impersonation session logged for ${selectedBroker.name}`)
      setImpersonateOpen(false)
      setImpersonateReason('')
    },
    onError: (e) => toast.error(e.message),
  })

  const filtered = search
    ? brokers.filter(b =>
        b.name?.toLowerCase().includes(search.toLowerCase()) ||
        b.broker_id?.toLowerCase().includes(search.toLowerCase())
      )
    : brokers

  const tree = buildTree(filtered)

  const readyCount = brokers.filter(b => b.kyc_status === 'approved' && b.bank_verified).length
  const pendingKyc = brokers.filter(b => b.kyc_status !== 'approved').length
  const totalPendingPayout = brokers.reduce((s, b) => s + b.pending_payout, 0)

  if (isLoading) return <LoadingSpinner fullPage />

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="page-title">Broker Hierarchy</h1>
          <p className="text-sm text-slate-500 mt-0.5">Sponsor tree, payout readiness &amp; impersonation</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setViewMode(v => v === 'tree' ? 'table' : 'tree')}
            className="btn-secondary text-sm"
          >
            {viewMode === 'tree' ? 'Table View' : 'Tree View'}
          </button>
        </div>
      </div>

      {/* KPI Strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { label: 'Total Brokers', value: brokers.length, icon: Users, color: 'text-slate-700' },
          { label: 'Payout Ready', value: readyCount, icon: CheckCircle2, color: 'text-green-700' },
          { label: 'Pending KYC', value: pendingKyc, icon: AlertCircle, color: 'text-yellow-700' },
          { label: 'Pending Payouts', value: formatINR(totalPendingPayout), icon: CreditCard, color: 'text-orange-600' },
        ].map(({ label, value, icon: Icon, color }) => (
          <div key={label} className="card p-4 flex items-center gap-3">
            <Icon size={20} className={color} />
            <div>
              <p className="text-xs text-slate-500">{label}</p>
              <p className={`text-lg font-bold ${color}`}>{value}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Search */}
      <div className="relative">
        <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          type="text"
          className="input pl-9"
          placeholder="Search broker name or ID…"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
      </div>

      {viewMode === 'tree' ? (
        <div className="card p-4">
          <p className="text-xs text-slate-400 mb-3 font-medium">SPONSOR TREE</p>
          {tree.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-8">No brokers found</p>
          ) : (
            tree.map(b => <BrokerNode key={b.id} broker={b} depth={0} />)
          )}
        </div>
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                {['Broker', 'Broker ID', 'Sponsor', 'KYC', 'Bank', 'Pending Payout', 'Actions'].map(h => (
                  <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-slate-500">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map(b => {
                const sponsor = brokers.find(x => x.id === b.sponsor_id)
                return (
                  <tr key={b.id} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium">{b.name}</td>
                    <td className="px-4 py-3 text-slate-500">{b.broker_id}</td>
                    <td className="px-4 py-3 text-slate-500">{sponsor?.name || '—'}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                        b.kyc_status === 'approved' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'
                      }`}>{b.kyc_status || 'pending'}</span>
                    </td>
                    <td className="px-4 py-3">
                      {b.bank_verified
                        ? <CheckCircle2 size={14} className="text-green-500" />
                        : <AlertCircle size={14} className="text-yellow-500" />}
                    </td>
                    <td className="px-4 py-3">
                      <span className={b.pending_payout > 0 ? 'text-orange-600 font-medium' : 'text-slate-400'}>
                        {b.pending_payout > 0 ? formatINR(b.pending_payout) : '—'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => { setSelectedBroker(b); setImpersonateOpen(true) }}
                        className="flex items-center gap-1 text-xs text-purple-600 hover:text-purple-800 font-medium"
                      >
                        <Eye size={13} />Impersonate
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Impersonate Modal */}
      <Modal open={impersonateOpen} onClose={() => setImpersonateOpen(false)} title="Impersonate Broker" size="sm">
        <div className="space-y-4">
          <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-3">
            <p className="text-sm text-yellow-800">
              <strong>⚠ Admin Action:</strong> You are about to log an impersonation session for{' '}
              <strong>{selectedBroker?.name}</strong> ({selectedBroker?.broker_id}).
              This action is logged for audit purposes.
            </p>
          </div>
          <div>
            <label className="label">Reason for impersonation *</label>
            <textarea
              className="input min-h-[80px]"
              value={impersonateReason}
              onChange={e => setImpersonateReason(e.target.value)}
              placeholder="e.g. Assisting broker with payout query, troubleshooting login issue…"
            />
          </div>
          <div className="flex gap-3 justify-end">
            <button onClick={() => setImpersonateOpen(false)} className="btn-secondary">Cancel</button>
            <button
              onClick={() => impersonateMutation.mutate()}
              disabled={!impersonateReason || impersonateMutation.isPending}
              className="bg-purple-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-purple-700"
            >
              {impersonateMutation.isPending ? 'Logging…' : 'Log & Proceed'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
