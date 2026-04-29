import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Search, UserPlus, RefreshCw, MoreVertical, Shield, ShieldOff, Key, LogIn, Copy, Wallet } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import toast from 'react-hot-toast'

const RANK_LABELS = {
  associate: 'Associate', sales_officer: 'Sales Officer', senior_sales_officer: 'Sr. Sales Officer',
  team_leader: 'Team Leader', senior_team_leader: 'Sr. Team Leader', team_manager: 'Team Manager',
  senior_team_manager: 'Sr. Team Manager', area_manager: 'Area Manager', senior_area_manager: 'Sr. Area Manager',
  regional_manager: 'Regional Manager', senior_regional_manager: 'Sr. Regional Manager',
  zonal_manager: 'Zonal Manager', national_manager: 'National Manager',
  vice_president: 'Vice President', president: 'President',
}

const KYC_COLORS = { pending: 'bg-yellow-100 text-yellow-700', submitted: 'bg-blue-100 text-blue-700', verified: 'bg-green-100 text-green-700', rejected: 'bg-red-100 text-red-700' }

export default function BrokersList() {
  const [brokers, setBrokers] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState('all')
  const [filterKyc, setFilterKyc] = useState('all')
  const [filterPortal, setFilterPortal] = useState('all')
  const [actionMenu, setActionMenu] = useState(null)
  const [credModal, setCredModal] = useState(null)

  useEffect(() => { fetchBrokers() }, [])

  async function fetchBrokers() {
    setLoading(true)
    const { data } = await supabase
      .from('brokers')
      .select('id, name, mobile, phone, email, rank, status, kyc_status, portal_access, last_login, city, created_at, sponsor_id, wallet_balance, username, temp_password, broker_id')
      .order('created_at', { ascending: false })
    setBrokers(data || [])
    setLoading(false)
  }

  async function togglePortalAccess(broker) {
    const newVal = !broker.portal_access
    const { error } = await supabase.from('brokers').update({ portal_access: newVal }).eq('id', broker.id)
    if (error) { toast.error('Failed to update portal access'); return }
    toast.success(`Portal access ${newVal ? 'enabled' : 'disabled'}`)
    setBrokers(prev => prev.map(b => b.id === broker.id ? { ...b, portal_access: newVal } : b))
    setActionMenu(null)
  }

  async function toggleStatus(broker) {
    const newStatus = broker.status === 'active' ? 'inactive' : 'active'
    const { error } = await supabase.from('brokers').update({ status: newStatus }).eq('id', broker.id)
    if (error) { toast.error('Failed to update status'); return }
    toast.success(`Broker ${newStatus === 'active' ? 'activated' : 'deactivated'}`)
    setBrokers(prev => prev.map(b => b.id === broker.id ? { ...b, status: newStatus } : b))
    setActionMenu(null)
  }

  async function resetPassword(broker) {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
    const newPwd = Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
    const { error } = await supabase.from('brokers').update({ temp_password: newPwd, force_password_change: true }).eq('id', broker.id)
    if (error) { toast.error('Failed to reset password'); return }
    toast.success(`New temp password: ${newPwd}`, { duration: 10000 })
    setBrokers(prev => prev.map(b => b.id === broker.id ? { ...b, temp_password: newPwd } : b))
    setActionMenu(null)
  }

  function loginAsBroker(broker) {
    const loginUrl = `${window.location.origin.replace('admin', 'broker')}/login?broker=${broker.broker_id}`
    navigator.clipboard.writeText(loginUrl).then(() => toast.success('Login URL copied to clipboard'))
    setActionMenu(null)
  }

  const filtered = useMemo(() => {
    let list = brokers
    if (filterStatus !== 'all') list = list.filter(b => (b.status || 'active') === filterStatus)
    if (filterKyc !== 'all') list = list.filter(b => (b.kyc_status || 'pending') === filterKyc)
    if (filterPortal !== 'all') list = list.filter(b => String(b.portal_access) === filterPortal)
    if (search.trim()) {
      const q = search.toLowerCase()
      list = list.filter(b => [b.name, b.mobile, b.phone, b.email, b.city, b.rank, b.broker_id].filter(Boolean).some(v => String(v).toLowerCase().includes(q)))
    }
    return list
  }, [brokers, search, filterStatus, filterKyc, filterPortal])

  const activeCount = brokers.filter(b => (b.status || 'active') !== 'inactive').length
  const portalCount = brokers.filter(b => b.portal_access).length
  const kycCount = brokers.filter(b => b.kyc_status === 'verified').length

  return (
    <div className="space-y-6" onClick={() => setActionMenu(null)}>
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Brokers</h1>
          <p className="text-sm text-slate-500 mt-1">Manage broker accounts, portal access and commission status.</p>
        </div>
        <Link to="/brokers/new" className="btn-primary flex items-center gap-2">
          <UserPlus size={16} /> Add Broker
        </Link>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[['Total Brokers', brokers.length, 'text-slate-900'], ['Active', activeCount, 'text-green-600'], ['Portal Access', portalCount, 'text-blue-600'], ['KYC Verified', kycCount, 'text-teal-600']].map(([label, val, cls]) => (
          <div key={label} className="card p-4">
            <p className="text-xs text-slate-500">{label}</p>
            <p className={`text-2xl font-bold mt-1 ${cls}`}>{val}</p>
          </div>
        ))}
      </div>

      <div className="card p-4 flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={search} onChange={e => setSearch(e.target.value)} className="input pl-9" placeholder="Search name, mobile, city, broker ID..." />
        </div>
        <select className="input w-auto" value={filterStatus} onChange={e => setFilterStatus(e.target.value)}>
          <option value="all">All Status</option>
          <option value="active">Active</option>
          <option value="inactive">Inactive</option>
        </select>
        <select className="input w-auto" value={filterKyc} onChange={e => setFilterKyc(e.target.value)}>
          <option value="all">All KYC</option>
          <option value="pending">Pending</option>
          <option value="submitted">Submitted</option>
          <option value="verified">Verified</option>
          <option value="rejected">Rejected</option>
        </select>
        <select className="input w-auto" value={filterPortal} onChange={e => setFilterPortal(e.target.value)}>
          <option value="all">All Portal</option>
          <option value="true">Portal Active</option>
          <option value="false">No Portal</option>
        </select>
        <button onClick={fetchBrokers} className="btn-secondary p-2" title="Refresh">
          <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
        </button>
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-4 py-3 text-left font-semibold">Broker</th>
                <th className="px-4 py-3 text-left font-semibold">Mobile</th>
                <th className="px-4 py-3 text-left font-semibold">Rank</th>
                <th className="px-4 py-3 text-left font-semibold">Sponsor ID</th>
                <th className="px-4 py-3 text-left font-semibold">Wallet</th>
                <th className="px-4 py-3 text-left font-semibold">KYC</th>
                <th className="px-4 py-3 text-left font-semibold">Portal</th>
                <th className="px-4 py-3 text-left font-semibold">Status</th>
                <th className="px-4 py-3 text-left font-semibold">Last Login</th>
                <th className="px-4 py-3 text-right font-semibold">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr><td colSpan="10" className="px-4 py-10 text-center">
                  <div className="inline-block w-6 h-6 border-2 border-teal-500 border-t-transparent rounded-full animate-spin" />
                </td></tr>
              )}
              {!loading && filtered.length === 0 && (
                <tr><td colSpan="10" className="px-4 py-10 text-center text-slate-500">No brokers found.</td></tr>
              )}
              {!loading && filtered.map(broker => (
                <tr key={broker.id} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-900">{broker.name || '—'}</div>
                    <div className="text-xs text-slate-400">{broker.broker_id || broker.city || '—'}</div>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{broker.mobile || broker.phone || '—'}</td>
                  <td className="px-4 py-3">
                    <span className="text-xs bg-slate-100 text-slate-700 px-2 py-0.5 rounded-full font-medium">
                      {RANK_LABELS[broker.rank] || broker.rank || 'Associate'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-slate-500">{broker.sponsor_id || '—'}</td>
                  <td className="px-4 py-3 text-xs font-medium text-slate-700">
                    <div className="flex items-center gap-1">
                      <Wallet size={11} className="text-teal-500" />
                      ₹{Number(broker.wallet_balance || 0).toLocaleString('en-IN')}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${KYC_COLORS[broker.kyc_status] || KYC_COLORS.pending}`}>
                      {broker.kyc_status || 'Pending'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {broker.portal_access
                      ? <span className="inline-flex items-center gap-1 text-xs text-green-700 bg-green-50 px-2 py-0.5 rounded-full"><Shield size={10} /> Active</span>
                      : <span className="inline-flex items-center gap-1 text-xs text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full"><ShieldOff size={10} /> None</span>
                    }
                  </td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${(broker.status || 'active') === 'active' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                      {broker.status || 'Active'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-400 text-xs">
                    {broker.last_login ? new Date(broker.last_login).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' }) : 'Never'}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-2">
                      <Link to={`/brokers/${broker.id}`} className="text-teal-700 hover:text-teal-900 font-medium text-xs">View</Link>
                      <div className="relative" onClick={e => e.stopPropagation()}>
                        <button onClick={() => setActionMenu(actionMenu === broker.id ? null : broker.id)}
                          className="p-1 rounded hover:bg-slate-200 text-slate-500">
                          <MoreVertical size={15} />
                        </button>
                        {actionMenu === broker.id && (
                          <div className="absolute right-0 top-7 z-20 bg-white border border-slate-200 rounded-xl shadow-lg w-52 py-1 text-sm">
                            <button onClick={() => togglePortalAccess(broker)}
                              className="w-full text-left px-4 py-2 hover:bg-slate-50 flex items-center gap-2">
                              {broker.portal_access ? <ShieldOff size={13} className="text-red-500" /> : <Shield size={13} className="text-green-600" />}
                              {broker.portal_access ? 'Disable Portal' : 'Enable Portal'}
                            </button>
                            <button onClick={() => toggleStatus(broker)} className="w-full text-left px-4 py-2 hover:bg-slate-50">
                              {broker.status === 'active' ? 'Deactivate' : 'Activate'}
                            </button>
                            <button onClick={() => resetPassword(broker)}
                              className="w-full text-left px-4 py-2 hover:bg-slate-50 flex items-center gap-2">
                              <Key size={13} /> Reset Password
                            </button>
                            <button onClick={() => { setCredModal(broker); setActionMenu(null) }}
                              className="w-full text-left px-4 py-2 hover:bg-slate-50 flex items-center gap-2">
                              <Copy size={13} /> View Credentials
                            </button>
                            <button onClick={() => loginAsBroker(broker)}
                              className="w-full text-left px-4 py-2 hover:bg-slate-50 flex items-center gap-2">
                              <LogIn size={13} /> Login as Broker
                            </button>
                            <div className="border-t border-slate-100 mt-1 pt-1">
                              <Link to={`/brokers/${broker.id}`} className="block px-4 py-2 hover:bg-slate-50">Full Profile</Link>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {!loading && (
          <div className="px-4 py-3 border-t border-slate-100 text-xs text-slate-400">
            Showing {filtered.length} of {brokers.length} brokers
          </div>
        )}
      </div>

      {credModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50" onClick={() => setCredModal(null)}>
          <div className="bg-white rounded-2xl shadow-xl p-6 w-80" onClick={e => e.stopPropagation()}>
            <h3 className="font-semibold text-slate-900 mb-1">Broker Credentials</h3>
            <p className="text-xs text-slate-500 mb-4">{credModal.name} &middot; {credModal.broker_id}</p>
            <div className="space-y-3 text-sm">
              <div className="flex items-center justify-between bg-slate-50 rounded-lg px-3 py-2">
                <span className="text-slate-500 text-xs">Username</span>
                <span className="font-mono font-medium text-slate-900">{credModal.username || credModal.mobile || '—'}</span>
              </div>
              <div className="flex items-center justify-between bg-slate-50 rounded-lg px-3 py-2">
                <span className="text-slate-500 text-xs">Temp Password</span>
                <span className="font-mono font-medium text-slate-900">{credModal.temp_password || '(not set)'}</span>
              </div>
              <div className="flex items-center justify-between bg-slate-50 rounded-lg px-3 py-2">
                <span className="text-slate-500 text-xs">Mobile (login)</span>
                <span className="font-mono font-medium text-slate-900">{credModal.mobile || '—'}</span>
              </div>
            </div>
            <button onClick={() => setCredModal(null)} className="btn-secondary w-full mt-4 text-sm">Close</button>
          </div>
        </div>
      )}
    </div>
  )
}
