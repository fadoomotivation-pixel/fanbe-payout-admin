import { useMemo, useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { formatINR } from '@/lib/utils'
import toast from 'react-hot-toast'
import {
  ChevronRight, ChevronDown, Search, Users, TrendingUp,
  ShieldCheck, AlertCircle, Phone, MessageCircle, Layers, GitBranch, User, UserPlus, Loader2,
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
  'Associate':              'bg-slate-100 text-slate-700',
  'Sales Executive':        'bg-blue-50 text-blue-700',
  'Sales Officer':          'bg-blue-100 text-blue-800',
  'Assistant Manager':      'bg-indigo-100 text-indigo-700',
  'Assistant Gen Manager':  'bg-indigo-200 text-indigo-800',
  'Manager':                'bg-purple-100 text-purple-700',
  'Senior Manager':         'bg-purple-200 text-purple-800',
  'Gen Manager':            'bg-pink-100 text-pink-700',
  'Area Manager':           'bg-orange-100 text-orange-700',
  'Regional Manager':       'bg-amber-100 text-amber-700',
  'Zonal Manager':          'bg-yellow-100 text-yellow-800',
  'Director':               'bg-emerald-100 text-emerald-800',
  'President':              'bg-emerald-200 text-emerald-900',
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
  const [search, setSearch] = useState('')
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())

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

  // Customers per broker — full list, not just a count, so each card can pop open and
  // show the actual names ("Nisha brought Nidhi") instead of an opaque "1 customer" pill.
  const { data: customersByBroker = {} } = useQuery<Record<string, { id: string; name: string; code: string }[]>>({
    queryKey: ['team_tree_customers_full'],
    queryFn: async () => {
      const { data } = await supabase
        .from('bp_bookings')
        .select('broker_id, customer_id, bp_customers(id, name, customer_code)')
        .not('broker_id', 'is', null)
        .not('customer_id', 'is', null)
      const seen: Record<string, Set<string>> = {}
      const out: Record<string, { id: string; name: string; code: string }[]> = {}
      for (const r of (data || []) as any[]) {
        if (!r.bp_customers) continue
        const set = (seen[r.broker_id] ??= new Set())
        if (set.has(r.customer_id)) continue
        set.add(r.customer_id)
        ;(out[r.broker_id] ??= []).push({
          id:   r.bp_customers.id,
          name: r.bp_customers.name || '—',
          code: r.bp_customers.customer_code || '',
        })
      }
      return out
    },
  })

  const qc = useQueryClient()

  // One-click promote: turn an existing customer into a broker sponsored by whichever broker
  // brought them in.  Derives the new broker_id from the highest existing FNB-NNNNN code and
  // seeds with the lowest active commission rank.  Admin can refine rank / contact later.
  const promoteToBroker = useMutation({
    mutationFn: async ({ customerId, sponsorId }: { customerId: string; sponsorId: string }) => {
      const [{ data: cust }, { data: ranks }, { data: existing }] = await Promise.all([
        supabase.from('bp_customers').select('id, name, phone, email').eq('id', customerId).single(),
        supabase.from('commission_ranks').select('rank_name, level').eq('active', true).order('level', { ascending: true }).limit(1),
        supabase.from('brokers').select('broker_id').ilike('broker_id', 'FNB-%').order('broker_id', { ascending: false }).limit(1),
      ])
      if (!cust) throw new Error('Customer not found')
      let nextNum = 6000
      const lastCode = existing?.[0]?.broker_id || ''
      const m = lastCode.match(/(\d+)\s*$/)
      if (m) nextNum = Number(m[1]) + 1
      const broker_id = `FNB-${String(nextNum).padStart(5, '0')}`
      const rank = ranks?.[0]?.rank_name || null
      const { error } = await supabase.from('brokers').insert({
        broker_id,
        name:        cust.name,
        phone:       cust.phone || null,
        email:       cust.email || null,
        sponsor_id:  sponsorId,
        rank,
        status:      'active',
        kyc_status:  'pending',
      })
      if (error) throw error
      return broker_id
    },
    onSuccess: (code) => {
      toast.success(`Promoted to broker · ${code}`)
      qc.invalidateQueries({ queryKey: ['team_tree_brokers'] })
      qc.invalidateQueries({ queryKey: ['team_tree_customers_full'] })
    },
    onError: (e: any) => toast.error(e.message),
  })

  const tree = useMemo(() => {
    const byId = new Map<string, Broker>()
    const childrenOf = new Map<string, Broker[]>()
    for (const b of brokers) {
      byId.set(b.id, b)
      const arr = childrenOf.get(b.sponsor_id || '__root__') || []
      arr.push(b)
      childrenOf.set(b.sponsor_id || '__root__', arr)
    }
    for (const arr of childrenOf.values()) arr.sort((a, b) => (a.name || '').localeCompare(b.name || ''))

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

  const visibleRoots = useMemo(() => {
    if (rootId) {
      const b = tree.byId.get(rootId)
      return b ? [b] : []
    }
    return tree.childrenOf.get('__root__') || []
  }, [rootId, tree])

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

  // When searching, force-expand the ancestor path of every match so it stays visible.
  const forceOpenIds = useMemo(() => {
    if (matchedIds.size === 0) return new Set<string>()
    const out = new Set<string>()
    for (const id of matchedIds) {
      let cur = tree.byId.get(id)?.sponsor_id
      let safety = 30
      while (cur && safety-- > 0) {
        out.add(cur)
        cur = tree.byId.get(cur)?.sponsor_id || null
      }
    }
    return out
  }, [matchedIds, tree])

  const toggleNode = (id: string) => setCollapsed(prev => {
    const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n
  })
  const expandAll = () => setCollapsed(new Set())
  const collapseAll = () => {
    // Collapse every node that has children, leaving only the root visible.
    const out = new Set<string>()
    for (const b of brokers) {
      const ch = tree.childrenOf.get(b.id) || []
      if (ch.length > 0) out.add(b.id)
    }
    setCollapsed(out)
  }

  return (
    <div className="p-4 md:p-8 space-y-6 max-w-7xl mx-auto">
      <div>
        <h1 className="text-2xl md:text-3xl font-bold text-gray-900 tracking-tight">Team Network</h1>
        <p className="text-sm text-gray-500 mt-1">Your MLM downline · {brokers.length} brokers · top-down org chart.</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi icon={<Users size={16}/>}        label="Brokers in scope" value={String(kpi.total)}/>
        <Kpi icon={<GitBranch size={16}/>}    label="Direct under root" value={String(kpi.directOfRoot)}/>
        <Kpi icon={<ShieldCheck size={16}/>}  label="KYC approved"     value={String(kpi.verified)}/>
        <Kpi icon={<TrendingUp size={16}/>}   label="Total earned"     value={formatINR(kpi.totalEarned)}/>
      </div>

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

      <div className="bg-white rounded-2xl border border-gray-200 shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
        {isLoading && <div className="py-16 text-center text-sm text-gray-400">Loading network…</div>}
        {!isLoading && visibleRoots.length === 0 && (
          <div className="py-16 text-center text-sm text-gray-400">
            {rootId ? 'Broker not found in tree.' : 'No brokers yet — add some to see the network.'}
          </div>
        )}
        {!isLoading && visibleRoots.length > 0 && (
          // Horizontal scroll so wide trees don't break the layout on mobile.
          <div className="overflow-x-auto p-6">
            <div className="inline-flex gap-8 mx-auto min-w-full justify-center">
              {visibleRoots.map(b => (
                <OrgNode
                  key={b.id} broker={b} isRoot
                  tree={tree}
                  collapsed={collapsed}
                  forceOpenIds={forceOpenIds}
                  earnings={earningsByBroker}
                  customers={customersByBroker}
                  aggregateEarnings={aggregateEarnings}
                  matchedIds={matchedIds}
                  onToggle={toggleNode}
                  onPromote={(customerId: string, sponsorId: string) => promoteToBroker.mutate({ customerId, sponsorId })}
                  isPromoting={promoteToBroker.isPending}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="text-[11px] text-gray-400">
        Tip: tap any node to collapse its children. Pick a broker as the "root" above to focus on a single subtree. Search auto-expands the path to every match.
      </div>
    </div>
  )
}

// ── Org-chart node ─────────────────────────────────────────────────────────
// Renders the broker card, then below it a flex row of child OrgNodes connected by
// a top-down org-chart skeleton (vertical descender → horizontal sibling bar → vertical
// risers to each child).  The horizontal bar is composed of two half-borders on each
// child's top so it naturally spans only between the first and last child without any
// JS measurement.
function OrgNode({ broker, isRoot, tree, collapsed, forceOpenIds, earnings, customers, aggregateEarnings, matchedIds, onToggle, onPromote, isPromoting }: any) {
  const subBrokers: Broker[] = tree.childrenOf.get(broker.id) || []
  const customerList: { id: string; name: string; code: string }[] = customers?.[broker.id] || []
  const hasSubBrokers = subBrokers.length > 0
  const hasCustomers  = customerList.length > 0
  const hasChildren   = hasSubBrokers || hasCustomers
  const isCollapsed = collapsed.has(broker.id) && !forceOpenIds.has(broker.id)
  const showChildren = hasChildren && !isCollapsed
  const subtree = tree.subtreeSize[broker.id] || 0
  const ownEarned = earnings[broker.id]?.earned || 0
  const teamEarned = (aggregateEarnings[broker.id] || 0) - ownEarned
  const isMatched = matchedIds.has(broker.id)

  // Combine sub-brokers + customers into a single ordered child list so they share
  // the org chart's sibling bar and risers — Nidhi appears under Nisha exactly like
  // Anjana / Rohit do, just styled as a customer leaf instead of a broker recursive node.
  type Child = { kind: 'broker'; key: string; data: Broker } | { kind: 'customer'; key: string; data: { id: string; name: string; code: string } }
  const combined: Child[] = [
    ...subBrokers.map(b => ({ kind: 'broker' as const, key: b.id, data: b })),
    ...customerList.map(c => ({ kind: 'customer' as const, key: `c-${c.id}`, data: c })),
  ]

  return (
    <div className="flex flex-col items-center">
      <NodeCard
        broker={broker}
        isRoot={isRoot}
        isMatched={isMatched}
        hasChildren={hasChildren}
        isCollapsed={isCollapsed && !forceOpenIds.has(broker.id)}
        directCount={subBrokers.length}
        subtree={subtree}
        ownEarned={ownEarned}
        teamEarned={teamEarned}
        customers={customerList}
        onToggle={() => hasChildren && onToggle(broker.id)}
      />

      {showChildren && (
        <>
          <div className="w-px h-6 bg-gray-300" />
          <div className="flex items-start">
            {combined.map((c, i) => {
              const isFirst = i === 0
              const isLast  = i === combined.length - 1
              const isOnly  = combined.length === 1
              return (
                <div key={c.key} className="relative flex flex-col items-center px-3 pt-6">
                  {!isOnly && !isFirst && <div className="absolute top-0 left-0 right-1/2 h-px bg-gray-300" />}
                  {!isOnly && !isLast  && <div className="absolute top-0 left-1/2 right-0 h-px bg-gray-300" />}
                  <div className="absolute top-0 left-1/2 -translate-x-1/2 w-px h-6 bg-gray-300" />
                  {c.kind === 'broker' ? (
                    <OrgNode
                      broker={c.data} tree={tree} collapsed={collapsed} forceOpenIds={forceOpenIds}
                      earnings={earnings} customers={customers} aggregateEarnings={aggregateEarnings}
                      matchedIds={matchedIds} onToggle={onToggle}
                      onPromote={onPromote} isPromoting={isPromoting}
                    />
                  ) : (
                    <CustomerLeaf customer={c.data} sponsorBrokerId={broker.id} onPromote={onPromote} isPromoting={isPromoting}/>
                  )}
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

// Terminal leaf node for a customer.  Same footprint as a broker NodeCard so the org
// chart stays aligned, but visually distinct (amber + "CUSTOMER" badge + dashed border)
// so admin can tell brokers from customers at a glance.  Clicking jumps to the
// customer's history page.
function CustomerLeaf({ customer, sponsorBrokerId, onPromote, isPromoting }: {
  customer: { id: string; name: string; code: string }
  sponsorBrokerId?: string
  onPromote?: (customerId: string, sponsorId: string) => void
  isPromoting?: boolean
}) {
  // Inline confirm: tap once → "Confirm?" with Yes/No.  Avoids a heavyweight modal for
  // an action that's already adjacent to the customer's card.
  const [confirming, setConfirming] = useState(false)
  return (
    <div className="w-[180px] sm:w-[200px] rounded-2xl border-2 border-dashed border-amber-200 bg-amber-50/40 px-3 py-3 shadow-sm hover:border-amber-300 hover:bg-amber-50 transition flex flex-col items-center">
      <Link
        to={`/customer-history?customer=${customer.id}`}
        onClick={e => e.stopPropagation()}
        className="flex flex-col items-center w-full"
      >
        <div className="w-12 h-12 rounded-full flex items-center justify-center text-base font-semibold mb-2 bg-gradient-to-br from-amber-400 to-orange-500 text-white">
          {(customer.name || '?').charAt(0).toUpperCase()}
        </div>
        <div className="text-sm font-semibold text-gray-900 truncate max-w-full text-center">{customer.name || '—'}</div>
        <div className="text-[10px] font-mono text-gray-400 mt-0.5">[{customer.code || '—'}]</div>
        <span className="mt-1 text-[10px] px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 font-medium">CUSTOMER</span>
      </Link>

      {onPromote && sponsorBrokerId && (
        <div className="mt-2 pt-2 w-full border-t border-amber-100">
          {confirming ? (
            <div className="flex gap-1">
              <button
                onClick={e => { e.stopPropagation(); onPromote(customer.id, sponsorBrokerId); setConfirming(false) }}
                disabled={isPromoting}
                className="flex-1 text-[10px] py-1 rounded-full bg-emerald-600 text-white font-medium hover:bg-emerald-700 disabled:opacity-50 inline-flex items-center justify-center gap-0.5"
              >
                {isPromoting ? <Loader2 size={10} className="animate-spin"/> : 'Yes'}
              </button>
              <button
                onClick={e => { e.stopPropagation(); setConfirming(false) }}
                className="flex-1 text-[10px] py-1 rounded-full bg-gray-100 text-gray-600 font-medium hover:bg-gray-200"
              >
                No
              </button>
            </div>
          ) : (
            <button
              onClick={e => { e.stopPropagation(); setConfirming(true) }}
              className="w-full text-[10px] py-1 rounded-full bg-white border border-amber-300 text-amber-800 font-medium hover:bg-amber-100 inline-flex items-center justify-center gap-1"
              title="Promote this customer to a broker under the same sponsor"
            >
              <UserPlus size={10}/>Make broker
            </button>
          )}
        </div>
      )}
    </div>
  )
}

function NodeCard({ broker, isRoot, isMatched, hasChildren, isCollapsed, directCount, subtree, ownEarned, teamEarned, customers = [], onToggle }: any) {
  // Customers now render as actual tree leaves when the broker is expanded — the pill is
  // a simple count badge again.  Tapping anywhere on the card (including the pill) toggles
  // the children, so Nisha tapped → reveals sub-brokers AND Nidhi as sibling leaves.
  const customerCount = customers.length
  return (
    <div
      onClick={hasChildren ? onToggle : undefined}
      className={`relative w-[180px] sm:w-[200px] rounded-2xl border bg-white px-3 py-3 shadow-sm transition
        ${isMatched ? 'border-amber-300 ring-2 ring-amber-200' : 'border-gray-200 hover:border-gray-300'}
        ${hasChildren ? 'cursor-pointer' : ''}`}
    >
      {/* avatar */}
      <div className="flex flex-col items-center">
        <div className={`shrink-0 w-12 h-12 rounded-full flex items-center justify-center text-base font-semibold mb-2
          ${isRoot ? 'bg-gray-900 text-white'
          : broker.status === 'active' ? 'bg-gradient-to-br from-blue-500 to-indigo-600 text-white'
          : 'bg-gray-100 text-gray-400'}`}>
          {broker.name ? broker.name.charAt(0).toUpperCase() : <User size={18}/>}
        </div>
        {/* Name is plain text — the entire card is the click target for expand/collapse, and a
            card click must never navigate to another broker's portal (privacy boundary). */}
        <div className="text-sm font-semibold text-gray-900 truncate max-w-full text-center">
          {broker.name || '—'}
        </div>
        <div className="text-[10px] font-mono text-gray-400 mt-0.5">[{broker.broker_id}]</div>
        {broker.rank && (
          <span className={`mt-1 text-[10px] px-2 py-0.5 rounded-full font-medium ${rankCls(broker.rank)}`}>{broker.rank}</span>
        )}
      </div>

      {/* badges row */}
      <div className="mt-2 flex items-center justify-center gap-1 flex-wrap text-[10px]">
        {isRoot && <span className="px-1.5 py-0.5 rounded-full bg-gray-900 text-white">Root</span>}
        {customerCount > 0 && (
          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-100 font-medium">
            <Users size={9}/>{customerCount} {customerCount === 1 ? 'customer' : 'customers'}
          </span>
        )}
        {broker.kyc_status !== 'approved' && (
          <span className="text-amber-700 inline-flex items-center gap-0.5"><AlertCircle size={9}/>KYC</span>
        )}
        {broker.status && broker.status !== 'active' && (
          <span className="text-gray-400 italic">{broker.status}</span>
        )}
      </div>

      {/* contact + earnings */}
      <div className="mt-2 pt-2 border-t border-gray-100 text-[11px] text-gray-500 space-y-1">
        {broker.phone && (
          <div className="flex items-center justify-center gap-2">
            <a href={`tel:${broker.phone}`} onClick={e => e.stopPropagation()} className="inline-flex items-center gap-0.5 hover:text-blue-700"><Phone size={10}/>{broker.phone}</a>
            <a href={`https://wa.me/${String(broker.phone).replace(/[^\d]/g,'')}`} target="_blank" rel="noreferrer" onClick={e => e.stopPropagation()} className="inline-flex items-center gap-0.5 text-emerald-700 hover:underline"><MessageCircle size={10}/>WA</a>
          </div>
        )}
        {(ownEarned > 0 || teamEarned > 0) && (
          <div className="flex items-center justify-center gap-2 tabular-nums">
            {ownEarned > 0 && <span className="font-semibold text-emerald-700">{formatINR(ownEarned)}</span>}
            {teamEarned > 0 && <span className="text-gray-400">+ team {formatINR(teamEarned)}</span>}
          </div>
        )}
        {hasChildren && (
          <div className="flex items-center justify-center gap-1 text-gray-400">
            <Layers size={9}/>
            {directCount > 0 && <span>{directCount} direct · {subtree} total</span>}
            {directCount === 0 && customerCount > 0 && <span>{customerCount} {customerCount === 1 ? 'customer' : 'customers'}</span>}
            {isCollapsed
              ? <ChevronRight size={11} className="text-gray-500"/>
              : <ChevronDown  size={11} className="text-gray-500"/>}
          </div>
        )}
      </div>
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
