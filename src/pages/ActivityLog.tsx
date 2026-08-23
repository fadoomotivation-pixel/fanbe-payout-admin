import { useMemo, useState, useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import {
  History, Search, Plus, Pencil, Trash2, User, Map, Users, BookOpen,
  CreditCard, Receipt, Landmark, Wallet, ShieldCheck, ChevronDown,
} from 'lucide-react'

// Admin's audit trail — "koi admin ka employee agar kuch misuse kare to track rahe".
//
// The entries are written by database triggers (see 20260823_activity_log.sql), not by this
// page or any other page.  Nothing here can add to the log, and the table grants no INSERT,
// UPDATE or DELETE to a logged-in user, so what is shown cannot be edited away by the person
// who did it.  This screen only reads.

const PAGE_SIZE = 200
const SEARCH_DEBOUNCE_MS = 300

const ENTITY_META: Record<string, { icon: any; label: string; tint: string }> = {
  customer:   { icon: User,        label: 'Customer',   tint: 'bg-indigo-50 text-indigo-700 border-indigo-100' },
  plot:       { icon: Map,         label: 'Plot',       tint: 'bg-teal-50 text-teal-700 border-teal-100' },
  broker:     { icon: Users,       label: 'Broker',     tint: 'bg-emerald-50 text-emerald-700 border-emerald-100' },
  booking:    { icon: BookOpen,    label: 'Booking',    tint: 'bg-blue-50 text-blue-700 border-blue-100' },
  payment:    { icon: CreditCard,  label: 'Payment',    tint: 'bg-green-50 text-green-700 border-green-100' },
  expense:    { icon: Receipt,     label: 'Expense',    tint: 'bg-amber-50 text-amber-700 border-amber-100' },
  cheque:     { icon: Landmark,    label: 'Cheque',     tint: 'bg-purple-50 text-purple-700 border-purple-100' },
  withdrawal: { icon: Wallet,      label: 'Withdrawal', tint: 'bg-rose-50 text-rose-700 border-rose-100' },
}

const ACTION_META: Record<string, { icon: any; label: string; cls: string; dot: string }> = {
  created: { icon: Plus,   label: 'Added',   cls: 'bg-emerald-50 text-emerald-700 border-emerald-200', dot: 'bg-emerald-500' },
  updated: { icon: Pencil, label: 'Changed', cls: 'bg-blue-50 text-blue-700 border-blue-200',          dot: 'bg-blue-500' },
  deleted: { icon: Trash2, label: 'Deleted', cls: 'bg-rose-50 text-rose-700 border-rose-200',          dot: 'bg-rose-500' },
}

// Field names as an admin would say them, so the log doesn't read like a table definition.
const FIELD_LABELS: Record<string, string> = {
  phone: 'phone', alt_phone: 'alternate phone', name: 'name', email: 'email',
  pan: 'PAN', pan_no: 'PAN', aadhaar: 'Aadhaar', address: 'address',
  customer_code: 'customer code', father_or_husband_name: 'father / husband',
  status: 'status', plot_no: 'plot no', price_per_sqyd: 'rate per sqyd',
  total_price: 'total price', project_id: 'project', size_sqyd: 'size',
  kyc_status: 'KYC status', rank: 'rank', sponsor_id: 'sponsor', broker_id: 'broker code',
  stage: 'stage', plot_id: 'plot', customer_id: 'customer', total_amount: 'total amount',
  booking_no: 'booking no', legacy_booking_no: 'old register no',
  commission_mode: 'commission mode', traditional_commission_pct: 'commission %',
  amount: 'amount', verification_status: 'verification', payment_date: 'payment date',
  receipt_no: 'receipt no', utr_ref: 'UTR', payment_mode: 'mode',
  head_id: 'expense head', expense_date: 'expense date',
  cheque_no: 'cheque no', cleared_on: 'cleared on', bounce_reason: 'bounce reason',
  net_amount: 'net amount',
}

const fieldName = (k: string) => FIELD_LABELS[k] || k.replace(/_/g, ' ')
const shortVal = (v: any) => {
  if (v === null || v === undefined || v === '') return '(blank)'
  const s = String(v)
  return s.length > 60 ? s.slice(0, 60) + '…' : s
}

function relativeTime(iso: string) {
  const then = new Date(iso).getTime()
  const mins = Math.floor((Date.now() - then) / 60000)
  if (mins < 1)    return 'just now'
  if (mins < 60)   return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24)    return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 30)   return `${days}d ago`
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

const fullTime = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })

export default function ActivityLog() {
  const [page, setPage] = useState(0)
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [entity, setEntity] = useState('')
  const [action, setAction] = useState('')
  const [actor, setActor] = useState('')
  const [expanded, setExpanded] = useState<Set<number>>(new Set())

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [search])

  useEffect(() => { setPage(0) }, [debouncedSearch, entity, action, actor])

  const { data, isLoading, error } = useQuery({
    queryKey: ['activity_log', page, debouncedSearch, entity, action, actor],
    queryFn: async () => {
      let q = supabase
        .from('bp_activity_log')
        .select('id, at, actor_email, action, entity, entity_id, label, summary, changes, table_name', { count: 'exact' })
        .order('at', { ascending: false })
      if (entity) q = q.eq('entity', entity)
      if (action) q = q.eq('action', action)
      if (actor)  q = q.eq('actor_email', actor)
      if (debouncedSearch) q = q.or(`summary.ilike.%${debouncedSearch}%,label.ilike.%${debouncedSearch}%,actor_email.ilike.%${debouncedSearch}%`)
      q = q.range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1)
      const { data, error, count } = await q
      if (error) throw error
      return { rows: data || [], total: count || 0 }
    },
  })

  // Who has been active — powers the "filter by person" dropdown, which is the first thing
  // you reach for when a specific employee is the question.
  const { data: actors = [] } = useQuery<string[]>({
    queryKey: ['activity_actors'],
    queryFn: async () => {
      const { data } = await supabase
        .from('bp_activity_log')
        .select('actor_email')
        .not('actor_email', 'is', null)
        .order('at', { ascending: false })
        .limit(2000)
      return Array.from(new Set((data || []).map((r: any) => r.actor_email).filter(Boolean)))
    },
  })

  const rows = data?.rows ?? []
  const total = data?.total ?? 0
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const anyFilter = !!(debouncedSearch || entity || action || actor)

  const toggle = (id: number) => setExpanded(prev => {
    const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n
  })

  // Group by calendar day so a long list stays readable while scrolling.
  const grouped = useMemo(() => {
    const out: { day: string; items: any[] }[] = []
    for (const r of rows) {
      const day = new Date(r.at).toLocaleDateString('en-IN', { weekday: 'long', day: '2-digit', month: 'short', year: 'numeric' })
      const last = out[out.length - 1]
      if (last && last.day === day) last.items.push(r)
      else out.push({ day, items: [r] })
    }
    return out
  }, [rows])

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-gray-100 rounded-lg"><History size={20} className="text-gray-700"/></div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">Activity Log</h1>
            <p className="text-sm text-gray-500">
              Who changed what, and when · {total.toLocaleString('en-IN')} entr{total === 1 ? 'y' : 'ies'}
            </p>
          </div>
        </div>
        <div className="inline-flex items-center gap-1.5 text-[11px] text-gray-600 bg-gray-50 border border-gray-200 rounded-full px-3 py-1.5">
          <ShieldCheck size={12} className="text-emerald-600"/>
          Recorded by the database · cannot be edited or deleted from the app
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-gray-200 p-3 flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[220px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"/>
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search name, plot no, receipt, person…"
            className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:border-gray-900"/>
        </div>
        <select value={entity} onChange={e => setEntity(e.target.value)}
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-900">
          <option value="">All types</option>
          {Object.entries(ENTITY_META).map(([k, m]) => <option key={k} value={k}>{m.label}</option>)}
        </select>
        <select value={action} onChange={e => setAction(e.target.value)}
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-900">
          <option value="">All actions</option>
          <option value="created">Added</option>
          <option value="updated">Changed</option>
          <option value="deleted">Deleted</option>
        </select>
        <select value={actor} onChange={e => setActor(e.target.value)}
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-gray-900 max-w-[220px]">
          <option value="">Everyone</option>
          {actors.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
        {anyFilter && (
          <button onClick={() => { setSearch(''); setEntity(''); setAction(''); setActor('') }}
            className="text-xs text-gray-500 hover:text-gray-900 underline">Clear</button>
        )}
      </div>

      {error && (
        <div className="rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">
          Couldn't load the activity log: {(error as any)?.message || 'unknown error'}
        </div>
      )}

      {/* Entries */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {isLoading && <div className="py-12 text-center text-sm text-gray-400">Loading…</div>}

        {!isLoading && rows.length === 0 && (
          <div className="py-14 text-center px-6">
            <History size={28} className="mx-auto text-gray-300 mb-2"/>
            <p className="text-sm text-gray-500">
              {anyFilter
                ? 'Nothing matches these filters.'
                : 'No activity recorded yet. Entries appear here as soon as anyone adds, changes or deletes a record.'}
            </p>
          </div>
        )}

        {grouped.map(group => (
          <div key={group.day}>
            <div className="px-4 py-2 bg-gray-50 border-y border-gray-100 text-[11px] font-semibold text-gray-500 uppercase tracking-wide sticky top-0 z-10">
              {group.day}
            </div>
            <div className="divide-y divide-gray-50">
              {group.items.map((r: any) => {
                const em = ENTITY_META[r.entity] || { icon: History, label: r.entity, tint: 'bg-gray-50 text-gray-700 border-gray-200' }
                const am = ACTION_META[r.action] || ACTION_META.updated
                const EIcon = em.icon
                const AIcon = am.icon
                const changeKeys = r.changes ? Object.keys(r.changes) : []
                const open = expanded.has(r.id)
                return (
                  <div key={r.id} className="px-4 py-3 hover:bg-gray-50/60 transition-colors">
                    <div className="flex items-start gap-3">
                      <div className={`shrink-0 w-8 h-8 rounded-lg border flex items-center justify-center ${em.tint}`}>
                        <EIcon size={14}/>
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-full border ${am.cls}`}>
                            <AIcon size={9}/>{am.label}
                          </span>
                          <span className="text-[11px] text-gray-400">{em.label}</span>
                          <span className="text-[13px] font-semibold text-gray-900 truncate">{r.label || '—'}</span>
                        </div>

                        {/* For a change, say what actually moved rather than just naming fields. */}
                        {r.action === 'updated' && changeKeys.length > 0 && (
                          <div className="mt-1 text-[12px] text-gray-600">
                            {changeKeys.slice(0, open ? changeKeys.length : 2).map(k => (
                              <div key={k} className="truncate">
                                <span className="text-gray-500">{fieldName(k)}:</span>{' '}
                                <span className="line-through text-gray-400">{shortVal(r.changes[k]?.from)}</span>
                                <span className="mx-1 text-gray-400">→</span>
                                <span className="font-medium text-gray-900">{shortVal(r.changes[k]?.to)}</span>
                              </div>
                            ))}
                            {!open && changeKeys.length > 2 && (
                              <button onClick={() => toggle(r.id)} className="text-[11px] text-blue-600 hover:underline mt-0.5">
                                +{changeKeys.length - 2} more change{changeKeys.length - 2 === 1 ? '' : 's'}
                              </button>
                            )}
                            {open && changeKeys.length > 2 && (
                              <button onClick={() => toggle(r.id)} className="text-[11px] text-blue-600 hover:underline mt-0.5">
                                Show less
                              </button>
                            )}
                          </div>
                        )}

                        <div className="mt-1 flex items-center gap-2 flex-wrap text-[11px] text-gray-500">
                          <span className={`w-1.5 h-1.5 rounded-full ${am.dot}`}/>
                          <span className="font-medium text-gray-700">
                            {r.actor_email || 'system'}
                          </span>
                          <span>·</span>
                          <span title={fullTime(r.at)}>{relativeTime(r.at)}</span>
                          {r.entity_id && (
                            <>
                              <span>·</span>
                              <span className="font-mono text-[10px] text-gray-400">{String(r.entity_id).slice(0, 8)}</span>
                            </>
                          )}
                        </div>
                      </div>
                      {r.action === 'deleted' && (
                        <span className="shrink-0 text-[10px] font-semibold text-rose-700 bg-rose-50 border border-rose-200 rounded px-1.5 py-0.5">
                          removed
                        </span>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div className="text-[12px] text-gray-500">
            Page <b>{page + 1}</b> of <b>{totalPages}</b> · showing {rows.length} of {total.toLocaleString('en-IN')}
          </div>
          <div className="inline-flex items-center gap-1">
            <button onClick={() => setPage(0)} disabled={page === 0}
              className="px-3 py-1.5 text-xs rounded-lg bg-white border border-gray-200 text-gray-700 disabled:opacity-40 disabled:cursor-not-allowed hover:border-gray-300">« First</button>
            <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={page === 0}
              className="px-3 py-1.5 text-xs rounded-lg bg-white border border-gray-200 text-gray-700 disabled:opacity-40 disabled:cursor-not-allowed hover:border-gray-300">‹ Prev</button>
            <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}
              className="px-3 py-1.5 text-xs rounded-lg bg-white border border-gray-200 text-gray-700 disabled:opacity-40 disabled:cursor-not-allowed hover:border-gray-300">Next ›</button>
            <button onClick={() => setPage(totalPages - 1)} disabled={page >= totalPages - 1}
              className="px-3 py-1.5 text-xs rounded-lg bg-white border border-gray-200 text-gray-700 disabled:opacity-40 disabled:cursor-not-allowed hover:border-gray-300">Last »</button>
          </div>
        </div>
      )}
    </div>
  )
}
