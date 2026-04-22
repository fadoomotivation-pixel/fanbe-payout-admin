import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import LoadingSpinner from '../../components/ui/LoadingSpinner'
import { ArrowLeft, ChevronRight, ChevronDown, Shield, Users, TrendingUp } from 'lucide-react'

const RANK_LABELS = {
  associate: 'Associate', sales_officer: 'Sales Officer', senior_sales_officer: 'Sr. Sales Officer',
  team_leader: 'Team Leader', senior_team_leader: 'Sr. Team Leader', team_manager: 'Team Manager',
  senior_team_manager: 'Sr. Team Manager', area_manager: 'Area Manager', senior_area_manager: 'Sr. Area Manager',
  regional_manager: 'Regional Manager', senior_regional_manager: 'Sr. Regional Manager',
  zonal_manager: 'Zonal Manager', national_manager: 'National Manager',
  vice_president: 'Vice President', president: 'President',
}

const RANK_COLORS = {
  associate: 'bg-slate-100 text-slate-600',
  sales_officer: 'bg-blue-50 text-blue-700',
  senior_sales_officer: 'bg-blue-100 text-blue-800',
  team_leader: 'bg-indigo-100 text-indigo-700',
  senior_team_leader: 'bg-indigo-100 text-indigo-800',
  team_manager: 'bg-purple-100 text-purple-700',
  senior_team_manager: 'bg-purple-100 text-purple-800',
  area_manager: 'bg-pink-100 text-pink-700',
  senior_area_manager: 'bg-pink-100 text-pink-800',
  regional_manager: 'bg-orange-100 text-orange-700',
  senior_regional_manager: 'bg-orange-100 text-orange-800',
  zonal_manager: 'bg-amber-100 text-amber-700',
  national_manager: 'bg-yellow-100 text-yellow-800',
  vice_president: 'bg-teal-100 text-teal-700',
  president: 'bg-emerald-100 text-emerald-800',
}

// Recursive tree node component
function BrokerNode({ broker, allBrokers, depth = 0, expanded, onToggle }) {
  const children = allBrokers.filter(b => b.upline_broker_id === broker.id)
  const hasChildren = children.length > 0
  const isExpanded = expanded[broker.id]

  return (
    <div className={depth > 0 ? 'ml-6 border-l-2 border-slate-100 pl-4' : ''}>
      <div
        className={`group flex items-center gap-3 py-2.5 px-3 rounded-xl transition-colors cursor-pointer ${
          hasChildren ? 'hover:bg-slate-50' : 'hover:bg-slate-50/60'
        }`}
        onClick={() => hasChildren && onToggle(broker.id)}
      >
        {/* Expand toggle */}
        <div className={`w-5 h-5 flex items-center justify-center shrink-0 transition-transform ${
          hasChildren ? 'text-slate-400' : 'text-transparent'
        }`}>
          {hasChildren ? (
            isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />
          ) : <span className="w-3.5 h-0.5 bg-slate-200 block rounded" />}
        </div>

        {/* Avatar */}
        <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold shrink-0 ${
          broker.status === 'active' ? 'bg-teal-600 text-white' : 'bg-slate-300 text-slate-600'
        }`}>
          {broker.name?.charAt(0).toUpperCase()}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-medium text-sm text-slate-800 truncate">{broker.name}</span>
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
              RANK_COLORS[broker.rank] || 'bg-slate-100 text-slate-600'
            }`}>
              {RANK_LABELS[broker.rank] || broker.rank || 'Associate'}
            </span>
            {broker.portal_access && (
              <span className="text-xs text-teal-600 flex items-center gap-0.5"><Shield size={10} /> Portal</span>
            )}
            {broker.status !== 'active' && (
              <span className="text-xs text-slate-400 italic">Inactive</span>
            )}
          </div>
          <p className="text-xs text-slate-400 mt-0.5">
            {broker.mobile ? `+91 ${broker.mobile}` : ''}
            {hasChildren ? ` · ${children.length} direct report${children.length > 1 ? 's' : ''}` : ''}
          </p>
        </div>

        {/* Action */}
        <Link
          to={`/brokers/${broker.id}`}
          onClick={e => e.stopPropagation()}
          className="text-xs text-teal-700 hover:text-teal-900 font-medium opacity-0 group-hover:opacity-100 transition-opacity shrink-0 px-2 py-1 rounded-lg hover:bg-teal-50"
        >
          View
        </Link>
      </div>

      {/* Children */}
      {hasChildren && isExpanded && (
        <div className="mt-0.5">
          {children.map(child => (
            <BrokerNode
              key={child.id}
              broker={child}
              allBrokers={allBrokers}
              depth={depth + 1}
              expanded={expanded}
              onToggle={onToggle}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export default function BrokerTeam() {
  const { id } = useParams()
  const [expanded, setExpanded] = useState({})
  const [viewMode, setViewMode] = useState('tree') // tree | flat
  const [rankFilter, setRankFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')

  // Fetch root broker
  const { data: broker, isLoading: brokerLoading } = useQuery({
    queryKey: ['broker', id],
    queryFn: async () => {
      const { data } = await supabase.from('brokers').select('*').eq('id', id).single()
      return data
    },
  })

  // Fetch ALL brokers in tree (recursive via multiple fetches)
  const { data: allBrokers = [], isLoading: treeLoading } = useQuery({
    queryKey: ['broker-full-tree', id],
    queryFn: async () => {
      // BFS to fetch all descendants
      const visited = new Set()
      const result = []
      const queue = [id]

      while (queue.length > 0) {
        const batch = queue.splice(0, 50)
        const { data } = await supabase
          .from('brokers')
          .select('id, name, mobile, rank, status, portal_access, upline_broker_id, created_at')
          .in('upline_broker_id', batch)

        if (data && data.length > 0) {
          for (const b of data) {
            if (!visited.has(b.id)) {
              visited.add(b.id)
              result.push(b)
              queue.push(b.id)
            }
          }
        }
      }
      return result
    },
    enabled: !!id,
  })

  // Auto-expand first level on load
  useEffect(() => {
    if (allBrokers.length > 0 && broker) {
      const direct = allBrokers.filter(b => b.upline_broker_id === id)
      const firstLevel = {}
      direct.forEach(b => { firstLevel[b.id] = false })
      setExpanded({ [id]: true, ...firstLevel })
    }
  }, [allBrokers.length, id, broker])

  function toggleNode(nodeId) {
    setExpanded(prev => ({ ...prev, [nodeId]: !prev[nodeId] }))
  }

  function expandAll() {
    const all = {}
    allBrokers.forEach(b => { all[b.id] = true })
    all[id] = true
    setExpanded(all)
  }

  function collapseAll() {
    setExpanded({ [id]: true })
  }

  if (brokerLoading || treeLoading) return <LoadingSpinner fullPage />

  const totalTeam = allBrokers.length
  const activeCount = allBrokers.filter(b => b.status === 'active').length
  const portalCount = allBrokers.filter(b => b.portal_access).length
  const directCount = allBrokers.filter(b => b.upline_broker_id === id).length

  // Flat filtered view
  const flatFiltered = allBrokers.filter(b => {
    if (rankFilter && b.rank !== rankFilter) return false
    if (statusFilter && b.status !== statusFilter) return false
    return true
  })

  const uniqueRanks = [...new Set(allBrokers.map(b => b.rank).filter(Boolean))]

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3">
          <Link to={`/brokers/${id}`} className="p-2 rounded-lg hover:bg-slate-100">
            <ArrowLeft size={16} />
          </Link>
          <div>
            <h1 className="page-title">Team Network</h1>
            <p className="text-sm text-slate-500">{broker?.name} · Full downline tree</p>
          </div>
        </div>

        {/* View Toggle */}
        <div className="flex items-center gap-2">
          <div className="flex bg-slate-100 rounded-xl p-1 gap-1">
            {['tree', 'flat'].map(mode => (
              <button
                key={mode}
                onClick={() => setViewMode(mode)}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg capitalize transition-colors ${
                  viewMode === mode ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                {mode === 'tree' ? '🌳 Tree' : '📋 List'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="card p-4">
          <div className="flex items-center gap-2 text-slate-500 text-xs mb-1"><Users size={13} /> Total Network</div>
          <p className="text-2xl font-bold text-slate-900">{totalTeam}</p>
        </div>
        <div className="card p-4">
          <div className="flex items-center gap-2 text-slate-500 text-xs mb-1"><TrendingUp size={13} /> Direct Reports</div>
          <p className="text-2xl font-bold text-teal-700">{directCount}</p>
        </div>
        <div className="card p-4">
          <div className="flex items-center gap-2 text-slate-500 text-xs mb-1">✅ Active Members</div>
          <p className="text-2xl font-bold text-green-700">{activeCount}</p>
        </div>
        <div className="card p-4">
          <div className="flex items-center gap-2 text-slate-500 text-xs mb-1"><Shield size={13} /> Portal Access</div>
          <p className="text-2xl font-bold text-blue-700">{portalCount}</p>
        </div>
      </div>

      {/* Tree View */}
      {viewMode === 'tree' && (
        <div className="card p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-slate-800">Downline Hierarchy</h2>
            <div className="flex gap-2">
              <button onClick={expandAll} className="text-xs text-teal-700 hover:text-teal-900 px-2 py-1 rounded-lg hover:bg-teal-50">Expand All</button>
              <button onClick={collapseAll} className="text-xs text-slate-500 hover:text-slate-700 px-2 py-1 rounded-lg hover:bg-slate-100">Collapse</button>
            </div>
          </div>

          {totalTeam === 0 ? (
            <div className="py-12 text-center text-slate-400">
              <p className="text-3xl mb-2">🌱</p>
              <p className="text-sm">No downline team members yet.</p>
            </div>
          ) : (
            <div>
              {/* Root broker */}
              <div className="flex items-center gap-3 py-2.5 px-3 mb-1">
                <div className="w-5 h-5 shrink-0" />
                <div className="w-8 h-8 rounded-full bg-teal-700 text-white flex items-center justify-center text-xs font-bold shrink-0">
                  {broker?.name?.charAt(0).toUpperCase()}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-sm text-slate-900">{broker?.name}</span>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      RANK_COLORS[broker?.rank] || 'bg-slate-100 text-slate-600'
                    }`}>{RANK_LABELS[broker?.rank] || broker?.rank || 'Associate'}</span>
                    <span className="text-xs text-teal-600 font-medium">(Root)</span>
                  </div>
                </div>
              </div>

              {/* Children */}
              <div className="ml-5 border-l-2 border-teal-200 pl-4">
                {allBrokers
                  .filter(b => b.upline_broker_id === id)
                  .map(child => (
                    <BrokerNode
                      key={child.id}
                      broker={child}
                      allBrokers={allBrokers}
                      depth={1}
                      expanded={expanded}
                      onToggle={toggleNode}
                    />
                  ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Flat List View */}
      {viewMode === 'flat' && (
        <div className="card overflow-hidden">
          {/* Filters */}
          <div className="flex flex-wrap items-center gap-3 p-4 border-b border-slate-100">
            <select
              value={rankFilter}
              onChange={e => setRankFilter(e.target.value)}
              className="input text-sm py-1.5"
            >
              <option value="">All Ranks</option>
              {uniqueRanks.map(r => (
                <option key={r} value={r}>{RANK_LABELS[r] || r}</option>
              ))}
            </select>
            <select
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value)}
              className="input text-sm py-1.5"
            >
              <option value="">All Status</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
            <span className="text-xs text-slate-400 ml-auto">{flatFiltered.length} of {totalTeam} members</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  {['Name', 'Mobile', 'Rank', 'Upline', 'Portal', 'Status', 'Joined', ''].map(h => (
                    <th key={h} className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {flatFiltered.length === 0 && (
                  <tr><td colSpan="8" className="px-4 py-10 text-center text-slate-400">No members match the filters</td></tr>
                )}
                {flatFiltered.map(m => {
                  const upline = allBrokers.find(b => b.id === m.upline_broker_id)
                  return (
                    <tr key={m.id} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                            m.status === 'active' ? 'bg-teal-600 text-white' : 'bg-slate-300 text-slate-600'
                          }`}>{m.name?.charAt(0).toUpperCase()}</div>
                          <span className="font-medium text-slate-800">{m.name}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-slate-500">{m.mobile ? `+91 ${m.mobile}` : '—'}</td>
                      <td className="px-4 py-3">
                        <span className={`text-xs px-2 py-0.5 rounded-full ${
                          RANK_COLORS[m.rank] || 'bg-slate-100 text-slate-600'
                        }`}>{RANK_LABELS[m.rank] || m.rank || 'Associate'}</span>
                      </td>
                      <td className="px-4 py-3 text-slate-500 text-xs">
                        {upline?.name || (m.upline_broker_id === id ? broker?.name : '—')}
                      </td>
                      <td className="px-4 py-3">
                        {m.portal_access
                          ? <span className="text-xs text-teal-600 flex items-center gap-1"><Shield size={10} /> On</span>
                          : <span className="text-xs text-slate-400">—</span>}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-xs px-2 py-0.5 rounded-full ${
                          m.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'
                        }`}>{m.status || 'active'}</span>
                      </td>
                      <td className="px-4 py-3 text-slate-400 text-xs">
                        {m.created_at ? new Date(m.created_at).toLocaleDateString('en-IN') : '—'}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Link to={`/brokers/${m.id}`} className="text-xs text-teal-700 hover:text-teal-900 font-medium">View</Link>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
