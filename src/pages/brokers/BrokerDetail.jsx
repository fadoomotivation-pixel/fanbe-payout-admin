import { useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useQuery, useMutation } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { queryClient } from '../../lib/queryClient'
import LoadingSpinner from '../../components/ui/LoadingSpinner'
import { ArrowLeft, CheckCircle, Shield, ShieldOff, Eye, EyeOff, Copy, RotateCcw, UserX, UserCheck } from 'lucide-react'
import { formatDate, formatINR } from '../../lib/utils'
import { PAYOUT_STATUS_COLORS } from '../../constants/enums'
import toast from 'react-hot-toast'

const RANK_LABELS = {
  associate: 'Associate', sales_officer: 'Sales Officer', senior_sales_officer: 'Sr. Sales Officer',
  team_leader: 'Team Leader', senior_team_leader: 'Sr. Team Leader', team_manager: 'Team Manager',
  senior_team_manager: 'Sr. Team Manager', area_manager: 'Area Manager', senior_area_manager: 'Sr. Area Manager',
  regional_manager: 'Regional Manager', senior_regional_manager: 'Sr. Regional Manager',
  zonal_manager: 'Zonal Manager', national_manager: 'National Manager',
  vice_president: 'Vice President', president: 'President',
}

function DetailRow({ label, value }) {
  return (
    <div>
      <p className="text-slate-500 text-xs mb-0.5">{label}</p>
      <p className="font-medium text-sm text-slate-900">{value || '—'}</p>
    </div>
  )
}

export default function BrokerDetail() {
  const { id } = useParams()
  const [showPwd, setShowPwd] = useState(false)
  const [copied, setCopied] = useState(false)
  const [activeTab, setActiveTab] = useState('overview') // overview | payouts | team

  const { data: broker, isLoading } = useQuery({
    queryKey: ['broker', id],
    queryFn: async () => {
      const { data } = await supabase
        .from('brokers')
        .select('*, bp_broker_kyc(*), upline:upline_broker_id(id, name, rank)')
        .eq('id', id)
        .single()
      return data
    },
  })

  const { data: payouts = [] } = useQuery({
    queryKey: ['broker-payouts', id],
    queryFn: async () => {
      const { data } = await supabase
        .from('bp_payout_transactions')
        .select('*, bp_bookings(booking_no)')
        .eq('broker_id', id)
        .order('created_at', { ascending: false })
      return data || []
    },
  })

  const { data: teamMembers = [] } = useQuery({
    queryKey: ['broker-team', id],
    queryFn: async () => {
      const { data } = await supabase
        .from('brokers')
        .select('id, name, mobile, rank, status, portal_access, created_at')
        .eq('upline_broker_id', id)
        .order('created_at', { ascending: false })
      return data || []
    },
  })

  const approveMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('brokers').update({ status: 'active', kyc_status: 'verified' }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['broker', id] }); toast.success('Broker approved') },
  })

  const togglePortal = useMutation({
    mutationFn: async (val) => {
      const { error } = await supabase.from('brokers').update({ portal_access: val }).eq('id', id)
      if (error) throw error
    },
    onSuccess: (_, val) => {
      queryClient.invalidateQueries({ queryKey: ['broker', id] })
      toast.success(`Portal access ${val ? 'enabled' : 'disabled'}`)
    },
  })

  const toggleStatus = useMutation({
    mutationFn: async (status) => {
      const { error } = await supabase.from('brokers').update({ status }).eq('id', id)
      if (error) throw error
    },
    onSuccess: (_, status) => {
      queryClient.invalidateQueries({ queryKey: ['broker', id] })
      toast.success(`Broker ${status === 'active' ? 'activated' : 'deactivated'}`)
    },
  })

  function resetPassword() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
    const newPwd = Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
    supabase.from('brokers').update({ temp_password: newPwd, force_password_change: true }).eq('id', id)
      .then(({ error }) => {
        if (error) { toast.error('Failed'); return }
        toast.success(`New temp password: ${newPwd}`, { duration: 10000 })
        queryClient.invalidateQueries({ queryKey: ['broker', id] })
      })
  }

  function copyPassword() {
    navigator.clipboard.writeText(broker?.temp_password || '')
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  if (isLoading) return <LoadingSpinner fullPage />

  const totalPaid = payouts.filter(p => p.status === 'paid').reduce((s, p) => s + (p.net_amount || 0), 0)
  const totalPending = payouts.filter(p => p.status === 'pending').reduce((s, p) => s + (p.amount || 0), 0)

  const tabs = ['overview', 'payouts', 'team']

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link to="/brokers" className="p-2 rounded-lg hover:bg-slate-100"><ArrowLeft size={16} /></Link>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="page-title">{broker?.name}</h1>
              <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                broker?.status === 'active' ? 'bg-green-100 text-green-800' : 'bg-slate-100 text-slate-500'
              }`}>{broker?.status || 'active'}</span>
              {broker?.portal_access && (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-teal-100 text-teal-700">
                  <Shield size={10} /> Portal Active
                </span>
              )}
            </div>
            <p className="text-sm text-slate-500 mt-0.5">
              {RANK_LABELS[broker?.rank] || broker?.rank || 'Associate'}
              {broker?.mobile && ` · +91 ${broker.mobile}`}
            </p>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2 flex-wrap">
          {broker?.status !== 'active' && (
            <button onClick={() => approveMutation.mutate()} className="btn-primary flex items-center gap-1.5">
              <CheckCircle size={14} /> Approve
            </button>
          )}
          <button
            onClick={() => togglePortal.mutate(!broker?.portal_access)}
            className={`btn-secondary flex items-center gap-1.5 text-sm ${
              broker?.portal_access ? 'text-red-600 hover:bg-red-50' : 'text-green-700 hover:bg-green-50'
            }`}>
            {broker?.portal_access ? <><ShieldOff size={14} /> Disable Portal</> : <><Shield size={14} /> Enable Portal</>}
          </button>
          <button
            onClick={() => toggleStatus.mutate(broker?.status === 'active' ? 'inactive' : 'active')}
            className="btn-secondary flex items-center gap-1.5 text-sm">
            {broker?.status === 'active' ? <><UserX size={14} /> Deactivate</> : <><UserCheck size={14} /> Activate</>}
          </button>
          <button onClick={resetPassword} className="btn-secondary flex items-center gap-1.5 text-sm">
            <RotateCcw size={14} /> Reset Password
          </button>
        </div>
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="card p-4"><p className="text-xs text-slate-500">Total Paid</p><p className="text-xl font-bold text-green-700 mt-1">{formatINR(totalPaid)}</p></div>
        <div className="card p-4"><p className="text-xs text-slate-500">Pending Payout</p><p className="text-xl font-bold text-yellow-600 mt-1">{formatINR(totalPending)}</p></div>
        <div className="card p-4"><p className="text-xs text-slate-500">Transactions</p><p className="text-xl font-bold text-slate-900 mt-1">{payouts.length}</p></div>
        <div className="card p-4"><p className="text-xs text-slate-500">Team Members</p><p className="text-xl font-bold text-teal-700 mt-1">{teamMembers.length}</p></div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-slate-200">
        {tabs.map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            className={`px-4 py-2.5 text-sm font-medium capitalize transition-colors border-b-2 -mb-px ${
              activeTab === tab ? 'border-teal-600 text-teal-700' : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}>
            {tab === 'team' ? `Team (${teamMembers.length})` : tab === 'payouts' ? `Payouts (${payouts.length})` : tab}
          </button>
        ))}
      </div>

      {/* OVERVIEW TAB */}
      {activeTab === 'overview' && (
        <div className="space-y-4">
          <div className="card p-5 grid grid-cols-2 md:grid-cols-3 gap-5">
            <DetailRow label="Broker ID" value={broker?.broker_id || broker?.id?.slice(0, 8).toUpperCase()} />
            <DetailRow label="Mobile" value={broker?.mobile ? `+91 ${broker.mobile}` : broker?.phone} />
            <DetailRow label="Email" value={broker?.email} />
            <DetailRow label="Rank" value={RANK_LABELS[broker?.rank] || broker?.rank} />
            <DetailRow label="KYC Status" value={broker?.kyc_status || 'Pending'} />
            <DetailRow label="City" value={broker?.city} />
            <DetailRow label="Upline Broker" value={broker?.upline?.name ? `${broker.upline.name} (${RANK_LABELS[broker.upline.rank] || broker.upline.rank})` : null} />
            <DetailRow label="Joined" value={formatDate(broker?.created_at)} />
            <DetailRow label="Last Login" value={broker?.last_login ? formatDate(broker.last_login) : 'Never'} />
          </div>

          {/* Bank Details */}
          <div className="card p-5">
            <h3 className="font-semibold text-slate-800 mb-4">Bank Details</h3>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-5">
              <DetailRow label="Bank Name" value={broker?.bank_name} />
              <DetailRow label="Account No." value={broker?.bank_account_no} />
              <DetailRow label="IFSC" value={broker?.bank_ifsc} />
              <DetailRow label="PAN" value={broker?.pan_number || broker?.bp_broker_kyc?.[0]?.pan_no} />
              <DetailRow label="Aadhaar" value={broker?.aadhaar_number ? `XXXX XXXX ${broker.aadhaar_number.slice(-4)}` : null} />
            </div>
          </div>

          {/* Portal Credentials */}
          {broker?.temp_password && (
            <div className="card p-5">
              <h3 className="font-semibold text-slate-800 mb-3">Portal Credentials</h3>
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-center justify-between">
                <div>
                  <p className="text-xs text-amber-700 font-medium">Temp Password (not yet changed)</p>
                  <p className="font-mono font-bold text-amber-900 text-lg tracking-widest mt-1">
                    {showPwd ? broker.temp_password : '••••••••'}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => setShowPwd(v => !v)} className="text-amber-600 hover:text-amber-800 p-1.5 rounded-lg hover:bg-amber-100">
                    {showPwd ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                  <button onClick={copyPassword} className="text-amber-600 hover:text-amber-800 p-1.5 rounded-lg hover:bg-amber-100">
                    {copied ? <CheckCircle size={16} className="text-green-600" /> : <Copy size={16} />}
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* PAYOUTS TAB */}
      {activeTab === 'payouts' && (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="bg-slate-50 border-b border-slate-200">
                {['Booking', 'Type', 'Amount', 'TDS', 'Net', 'Status', 'Date'].map(h => (
                  <th key={h} className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500">{h}</th>
                ))}
              </tr></thead>
              <tbody>
                {payouts.length === 0 && <tr><td colSpan="7" className="px-4 py-10 text-center text-slate-400">No payout records</td></tr>}
                {payouts.map(p => (
                  <tr key={p.id} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="px-4 py-3 text-teal-700">{p.bp_bookings?.booking_no}</td>
                    <td className="px-4 py-3 capitalize">{p.payout_type}</td>
                    <td className="px-4 py-3">{formatINR(p.amount)}</td>
                    <td className="px-4 py-3 text-red-600">{formatINR(p.tds_amount)}</td>
                    <td className="px-4 py-3 font-medium">{formatINR(p.net_amount || p.amount)}</td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${PAYOUT_STATUS_COLORS[p.status] || 'bg-slate-100 text-slate-600'}`}>
                        {p.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-500">{formatDate(p.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* TEAM TAB */}
      {activeTab === 'team' && (
        <div className="card overflow-hidden">
          {teamMembers.length === 0 ? (
            <div className="px-4 py-12 text-center text-slate-400">
              <p className="text-3xl mb-2">👥</p>
              <p>No direct team members yet.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead><tr className="bg-slate-50 border-b border-slate-200">
                  {['Name', 'Mobile', 'Rank', 'Portal', 'Status', 'Joined', ''].map(h => (
                    <th key={h} className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500">{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {teamMembers.map(m => (
                    <tr key={m.id} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="px-4 py-3 font-medium">{m.name}</td>
                      <td className="px-4 py-3 text-slate-500">{m.mobile || '—'}</td>
                      <td className="px-4 py-3">
                        <span className="text-xs bg-slate-100 text-slate-700 px-2 py-0.5 rounded-full">
                          {RANK_LABELS[m.rank] || m.rank || 'Associate'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {m.portal_access
                          ? <span className="text-xs text-green-700">✓ Active</span>
                          : <span className="text-xs text-slate-400">None</span>}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-xs px-2 py-0.5 rounded-full ${
                          m.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'
                        }`}>{m.status || 'active'}</span>
                      </td>
                      <td className="px-4 py-3 text-slate-400 text-xs">{formatDate(m.created_at)}</td>
                      <td className="px-4 py-3 text-right">
                        <Link to={`/brokers/${m.id}`} className="text-teal-700 hover:text-teal-900 text-xs font-medium">View</Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
