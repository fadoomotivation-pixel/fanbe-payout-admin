import { useMemo, useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { formatINR } from '@/lib/utils'
import {
  Network, ChevronRight, ChevronDown, Search, Users, TrendingUp, Crown,
  ShieldCheck, AlertCircle, Phone, MessageCircle, Layers, GitBranch,
} from 'lucide-react'

type Broker = {
  id: string
  name: string | null
  broker_id: string | null
  rank: string | null
  phone: string | null
  email: string | null
  status: string | null
  kyc_status: string | null
  sponsor_id: string | null
  created_at: string | null
}

type Stat = { earned: number; rows: number }

const RANK_COLORS: Record<string, string> = {
  // common ranks; gracefully falls back for anything not listed
  'Associate':           'bg-slate-100 text-slate-700',
  'Sales Executive':     'bg-blue-50 text-blue-700',
  'Sales Officer':       'bg-blue-100 text-blue-800',
  'Assistant Manager':   'bg-indigo-100 text-indigo-700',
  'Assistant Gen Manager':'bg-indigo-200 text-indigo-800',
  'Manager':             'bg-purple-100 text-purple-700',
  'Senior Manager':      'bg-purple-200 text-purple-800',
  'Gen Manager':         'bg-pink-100 text-pink-700',
  'Area Manager':        'bg-orange-100 text-orange-700',
  'Regional Manager':    'bg-amber-100 text-amber-700',
  'Zonal Manager':       'bg-yellow-100 text-yellow-800',
  'Director':            'bg-emerald-100 text-emerald-800',
}
const rankCls = (r: string | null) => (r && RANK_COLORS[r]) || 'bg-slate-100 text-slate-600'

export default function BrokerTree() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [rootId, setRootIdState] = useState<string>(searchParams.get('root') || '')
  const setRootId = (id: string) => {
    setRootIdState(id)
    const next = new URLSearchParams(searchParams)
    if (id) next.set('root', id); else next.delete('root')
    setSearchParams(next, { replace: true })
  }
  const [search, setSearch]   = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [showAll, setShowAll]   = useState(false)

  // Keep state in sync if URL param changes (e.g. arrived from BrokerDashboard team tab)
  useEffect(() => {
    const urlRoot = searchParams.get('root') || ''
    if (urlRoot !== rootId) setRootIdState(urlRoot)
  }, [searchParams])

  const { data: brokers = [], isLoading } = useQuery({
    queryKey: ['team_tree_brokers'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('brokers')
        .select('id, name, broker_id, rank, phone, email, status, kyc_status, sponsor_id, created_at')
        .order('name')
      if (error) throw error
      return (data || []) as Broker[]
    },
  })

  // Earnings per broker — sum of net_payout from payout_distributions
  const { data: earningsByBroker = {} } = useQuery<Record<string, Stat>>({
    queryKey: ['team_tree_earnings'],
    queryFn: async () => {
      const { data } = await supabase
        .from('payout_distributions')
        .select('beneficiary_broker_id, net_payout')
      const m: Record<string, Stat> = {}
      for (const d of (data || [])) {
        const k = (d as any).beneficiary_broker_id
        if (!k) continue
        if (!m[k]) m[k] = { earned: 0, rows: 0 }
        m[k].earned += Number((d as any).net_payout || 0)
        m[k].rows += 1
      }
      return m
    },
  })

  // Build parent → children map + subtree size
  const tree = useMemo(() => {
    const byId = new Map<string, Broker>()
    const childrenOf = new Map<string, Broker[]>()
    for (const b of brokers) {
      byId.set(b.id, b)
      const arr = childrenOf.get(b.sponsor_id || '__root__') || []
      arr.push(b)
      childrenOf.set(b.sponsor_id || '__root__', arr)
    }
    // sort children by name
    for (const arr of childrenOf.values()) arr.sort((a, b) => (a.name || '').localeCompare(b.name || ''))

    // subtree size (BFS)
    const subtreeSize: Record<string, number> = {}
    function size(id: string): number {
      if (subtreeSize[id] != null) return subtreeSize[id]
      const ch = childrenOf.get(id) || []
      let s = 0
      for (const c of ch) s += 1 + size(c.id)
      subtreeSize[id] = s
      return s
    }
    for (const b of brokers) size(b.id)
    return { byId, childrenOf, subtreeSize }
  }, [brokers])

  // Aggregate earnings recursively for each broker (own + subtree)
  const aggregateEarnings = useMemo(() => {
    const cache: Record<string, number> = {}
    const compute = (id: string): number => {
      if (cache[id] != null) return cache[id]
      const ch = tree.childrenOf.get(id) || []
      let total = earningsByBroker[id]?.earned || 0
      for (const c of ch) total += compute(c.id)
      cache[id] = total
      return total
    }
    for (const b of brokers) compute(b.id)
    return cache
  }, [brokers, tree, earningsByBroker])

  // Filter: when rootId set, only that subtree; else show all real roots
  const visibleRoots = useMemo(() => {
    if (rootId) {
      const b = tree.byId.get(rootId)
      return b ? [b] : []
    }
    return tree.childrenOf.get('__root__') || []
  }, [rootId, tree])

  // KPIs
  const kpi = useMemo(() => {
    const inScope = (() => {
      if (!rootId) return brokers
      const out: Broker[] = []
      const walk = (id: string) => {
        const b = tree.byId.get(id); if (!b) return
        out.push(b)
        const ch = tree.childrenOf.get(id) || []
        for (const c of ch) walk(c.id)
      }
      walk(rootId)
      return out
    })()
    const active   = inScope.filter(b => b.status === 'active').length
    const verified = inScope.filter(b => b.kyc_status === 'approved').length
    const totalEarned = inScope.reduce((s, b) => s + (earningsByBroker[b.id]?.earned || 0), 0)
    const directOfRoot = rootId
      ? (tree.childrenOf.get(rootId)?.length || 0)
      : (tree.childrenOf.get('__root__')?.length || 0)
    return { total: inScope.length, active, verified, totalEarned, directOfRoot }
  }, [rootId, tree, brokers, earningsByBroker])

  // Search: auto-expand path to matches
  const matchedIds = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return new Set<string>()
    const found = new Set<string>()
    for (const b of brokers) {
      const hay = `${b.name || ''} ${b.broker_id || ''} ${b.phone || ''}`.toLowerCase()
      if (hay.includes(q)) found.add(b.id)
    }
    return found
  }, [search, brokers])

  // When search matches, expand ancestors of every match
  const effectiveExpanded = useMemo(() => {
    if (matchedIds.size === 0) return expanded
    const out = new Set(expanded)
    for (const id of matchedIds) {
      let cur = tree.byId.get(id)?.sponsor_id
      let safety = 30
      while (cur && safety-- > 0) {
        out.add(cur)
        cur = tree.byId.get(cur)?.sponsor_id || null
      }
    }
    return out
  }, [matchedIds, expanded, tree])

  const toggleNode = (id: string) => setExpanded(prev => {
    const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n
  })

  const expandAll = () => setExpanded(new Set(brokers.map(b => b.id)))
  const collapseAll = () => setExpanded(new Set())

  return (
    <div className="p-4 md:p-8 space-y-6 max-w-6xl mx-auto">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold text-gray-900 tracking-tight">Team Network</h1>
        <p className="text-sm text-gray-500 mt-1">Your MLM downline · {brokers.length} brokers · pick a root or browse all.</p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi icon={<Users size={16}/>}        label="Brokers in scope" value={String(kpi.total)}/>
        <Kpi icon={<GitBranch size={16}/>}    label="Direct under root" value={String(kpi.directOfRoot)}/>
        <Kpi icon={<ShieldCheck size={16}/>}  label="KYC approved"     value={String(kpi.verified)}/>
        <Kpi icon={<TrendingUp size={16}/>}   label="Total earned"     value={formatINR(kpi.totalEarned)}/>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[220px]">
          <Search size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-400"/>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Find a broker by name, code or phone"
            className="w-full pl-10 pr-3 py-2.5 text-sm bg-white border border-gray-200 rounded-full focus:outline-none focus:border-gray-900 transition"/>
        </div>
        <select value={rootId} onChange={e => setRootId(e.target.value)}
          className="bg-white border border-gray-200 rounded-full px-3 py-2.5 text-sm focus:outline-none focus:border-gray-900 min-w-[180px]">
          <option value="">▶ All roots</option>
          {brokers.filter(b => !b.sponsor_id).map(b => (
            <option key={b.id} value={b.id}>{b.name} ({tree.subtreeSize[b.id] || 0} team)</option>
          ))}
          <optgroup label="—— or pick any broker as root ——">
            {brokers.filter(b => !!b.sponsor_id).map(b => (
              <option key={b.id} value={b.id}>{b.name} ({tree.subtreeSize[b.id] || 0} team)</option>
            ))}
          </optgroup>
        </select>
        <button onClick={expandAll}
          className="px-3 py-2.5 text-sm rounded-full bg-white border border-gray-200 text-gray-700 hover:border-gray-300">
          Expand all
        </button>
        <button onClick={collapseAll}
          className="px-3 py-2.5 text-sm rounded-full bg-white border border-gray-200 text-gray-700 hover:border-gray-300">
          Collapse
        </button>
      </div>

      {/* Tree */}
      <div className="bg-white rounded-2xl border border-gray-200 shadow-[0_1px_2px_rgba(0,0,0,0.02)] p-4 md:p-6">
        {isLoading && <div className="py-12 text-center text-sm text-gray-400">Loading network…</div>}
        {!isLoading && visibleRoots.length === 0 && (
          <div className="py-12 text-center text-sm text-gray-400">
            {rootId ? 'Broker not found in tree.' : 'No brokers yet — add some to see the network.'}
          </div>
        )}
        <div className="space-y-1">
          {visibleRoots.map(b => (
            <Node
              key={b.id} broker={b} depth={0} isRoot
              tree={tree}
              expanded={effectiveExpanded}
              earnings={earningsByBroker}
              aggregateEarnings={aggregateEarnings}
              matchedIds={matchedIds}
              onToggle={toggleNode}
              showAll={showAll}
            />
          ))}
        </div>

        {!showAll && brokers.length > 30 && (
          <div className="mt-4 text-center">
            <button onClick={() => setShowAll(true)} className="text-sm text-blue-700 hover:underline">Render deeper branches…</button>
          </div>
        )}
      </div>

      <div className="text-[11px] text-gray-400">
        Tip: pick any broker as the "root" to see only their subtree. Search auto-expands the path to every match.
      </div>
    </div>
  )
}

// ── Node ────────────────────────────────────────────────────────────────────
function Node({ broker, depth, isRoot, tree, expanded, earnings, aggregateEarnings, matchedIds, onToggle, showAll }: any) {
  const children: Broker[] = tree.childrenOf.get(broker.id) || []
  const hasChildren = children.length > 0
  const isOpen = expanded.has(broker.id)
  const subtree = tree.subtreeSize[broker.id] || 0
  const ownEarned = earnings[broker.id]?.earned || 0
  const teamEarned = (aggregateEarnings[broker.id] || 0) - ownEarned
  const isMatched = matchedIds.has(broker.id)

  return (
    <div className={depth > 0 ? 'pl-5 md:pl-7 relative' : ''}>
      {depth > 0 && <div className="absolute left-0 top-0 bottom-0 w-px bg-gray-200"/>}
      {depth > 0 && <div className="absolute left-0 top-7 h-px w-5 md:w-7 bg-gray-200"/>}

      <div className={`flex items-center gap-3 py-3 pr-2 rounded-xl ${isMatched ? 'bg-amber-50 ring-1 ring-amber-200' : 'hover:bg-gray-50/60'}`}>
        {/* expand toggle */}
        <button onClick={() => hasChildren && onToggle(broker.id)}
          className={`shrink-0 w-6 h-6 flex items-center justify-center rounded-md ${hasChildren ? 'text-gray-600 hover:bg-gray-100' : 'text-transparent'}`}>
          {hasChildren && (isOpen ? <ChevronDown size={14}/> : <ChevronRight size={14}/>)}
        </button>

        {/* avatar */}
        <div className={`shrink-0 w-9 h-9 rounded-full flex items-center justify-center text-xs font-semibold ${
          isRoot ? 'bg-gray-900 text-white'
          : broker.status === 'active' ? 'bg-gray-100 text-gray-900'
          : 'bg-gray-50 text-gray-400'
        }`}>
          {(broker.name || '?').charAt(0).toUpperCase()}
        </div>

        {/* info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5 flex-wrap">
            <Link to={`/broker/dashboard?broker_id=${broker.id}`} className="text-sm font-semibold text-gray-900 hover:text-blue-700 truncate">
              {broker.name || '—'}
            </Link>
            <span className="text-[10px] font-mono text-gray-400">[{broker.broker_id}]</span>
            {broker.rank && (
              <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${rankCls(broker.rank)}`}>{broker.rank}</span>
            )}
            {isRoot && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-900 text-white">Root</span>}
            {broker.kyc_status !== 'approved' && (
              <span className="text-[10px] text-amber-700 inline-flex items-center gap-0.5"><AlertCircle size={10}/>KYC {broker.kyc_status || 'pending'}</span>
            )}
            {broker.status !== 'active' && (
              <span className="text-[10px] text-gray-400 italic">{broker.status || 'inactive'}</span>
            )}
          </div>
          <div className="text-[11px] text-gray-400 mt-0.5 flex items-center gap-2 flex-wrap">
            {broker.phone && (
              <>
                <a href={`tel:${broker.phone}`} className="hover:text-blue-700 inline-flex items-center gap-0.5"><Phone size={9}/>{broker.phone}</a>
                <a href={`https://wa.me/${String(broker.phone).replace(/[^\d]/g,'')}`} target="_blank" rel="noreferrer" className="text-emerald-700 hover:underline inline-flex items-center gap-0.5"><MessageCircle size={9}/>WA</a>
              </>
            )}
            {hasChildren && (
              <span className="inline-flex items-center gap-0.5">
                <Layers size={9}/>{children.length} direct · {subtree} team
              </span>
            )}
          </div>
        </div>

        {/* earnings + chevron */}
        <div className="shrink-0 text-right">
          {ownEarned > 0 && <div className="text-[12px] font-semibold text-emerald-700 tabular-nums">{formatINR(ownEarned)}</div>}
          {teamEarned > 0 && <div className="text-[10px] text-gray-500 tabular-nums">team · {formatINR(teamEarned)}</div>}
        </div>
      </div>

      {/* children */}
      {hasChildren && isOpen && (
        <div className={depth > 8 && !showAll ? 'opacity-60 italic text-[11px] text-gray-400 pl-5 py-2' : ''}>
          {depth > 8 && !showAll ? (
            <span>+ {children.length} more — collapsed for clarity</span>
          ) : children.map((c: Broker) => (
            <Node key={c.id} broker={c} depth={depth + 1} tree={tree} expanded={expanded} earnings={earnings} aggregateEarnings={aggregateEarnings} matchedIds={matchedIds} onToggle={onToggle} showAll={showAll}/>
          ))}
        </div>
      )}
    </div>
  )
}

function Kpi({ icon, label, value }: any) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white px-4 py-3.5">
      <div className="flex items-center gap-1.5 text-gray-500 mb-1 text-[11px] uppercase tracking-wider">{icon}{label}</div>
      <div className="text-2xl font-bold text-gray-900 tabular-nums">{value}</div>
    </div>
  )
}
