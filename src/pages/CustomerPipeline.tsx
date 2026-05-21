import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/Button.tsx'
import { Input, Select } from '@/components/ui/Input.tsx'
import { Modal } from '@/components/ui/Modal.tsx'
import { Badge } from '@/components/ui/Badge.tsx'
import { formatINR, formatDate } from '@/lib/utils'
import { distributePaymentCommission } from '@/lib/payoutEngine'
import { printApplicationForm } from '@/lib/printTemplates'
import EmiPanel from '@/components/EmiPanel'
import {
  Users, Search, Filter, ChevronRight, Banknote, Calculator, ArrowUpRight,
  CheckCircle2, AlertTriangle, Coins, Phone, MessageCircle, IndianRupee, X, ExternalLink,
  FileText, Printer,
} from 'lucide-react'
import toast from 'react-hot-toast'

type Tab = 'all' | 'unpaid_booking' | 'emi_active' | 'settled'

const STAGE_COLORS: Record<string, string> = {
  token_received: 'bg-orange-50 text-orange-700 border-orange-200',
  booking_done:   'bg-green-50 text-green-700 border-green-200',
  cancelled:      'bg-red-50 text-red-700 border-red-200',
}

const PAYMENT_MODES = ['cash','neft','rtgs','imps','upi','cheque','dd']

const today = () => new Date().toISOString().slice(0, 10)

export default function CustomerPipeline() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [tab, setTab] = useState<Tab>('all')
  const [search, setSearch] = useState('')
  const [filterBroker, setFilterBroker] = useState('')
  const [filterProject, setFilterProject] = useState('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [emiBooking, setEmiBooking] = useState<any>(null)
  const [payFor, setPayFor] = useState<{ booking: any; type: 'token' | 'booking' } | null>(null)

  // ── Queries ────────────────────────────────────────────────────────
  const { data: bookings = [], isLoading } = useQuery({
    queryKey: ['cp_bookings'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('bp_bookings')
        .select(`
          id, booking_no, stage, application_date, total_amount, plot_total_price,
          token_amount, booking_amount, full_payment_amount,
          expected_booking_amount, commission_amount, commission_rate,
          broker_id, customer_id, plot_id, project_id, closed_at,
          bp_customers(id, customer_code, name, phone),
          bp_plots(plot_no, size_sqyd, sector, block),
          bp_projects(name, location),
          brokers(name, broker_id, rank)
        `)
        .not('stage', 'eq', 'cancelled')
        .order('created_at', { ascending: false })
        .limit(500)
      if (error) throw error
      return data || []
    },
  })

  const bookingIds = useMemo(() => bookings.map((b: any) => b.id), [bookings])

  const { data: paymentsByBooking = {} } = useQuery<Record<string, { token: number; booking: number; emi: number; full: number; total: number; last_date: string | null }>>({
    queryKey: ['cp_payments', bookingIds],
    enabled: bookingIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('bp_payments')
        .select('booking_id, amount, payment_type, payment_date, verification_status')
        .in('booking_id', bookingIds)
        .eq('verification_status', 'verified')
      if (error) throw error
      const m: Record<string, any> = {}
      for (const p of (data || [])) {
        if (!p.booking_id) continue
        if (!m[p.booking_id]) m[p.booking_id] = { token: 0, booking: 0, emi: 0, full: 0, total: 0, last_date: null }
        const amt = Number(p.amount || 0)
        m[p.booking_id].total += amt
        if (p.payment_type === 'token')        m[p.booking_id].token   += amt
        if (p.payment_type === 'booking')      m[p.booking_id].booking += amt
        if (p.payment_type === 'emi')          m[p.booking_id].emi     += amt
        if (p.payment_type === 'full_payment') m[p.booking_id].full    += amt
        if (!m[p.booking_id].last_date || (p.payment_date && p.payment_date > m[p.booking_id].last_date)) {
          m[p.booking_id].last_date = p.payment_date
        }
      }
      return m
    },
  })

  const { data: emiSummary = {} } = useQuery<Record<string, { schedule_id: string; n: number; paid: number; partial: number; overdue: number; next_due: string | null; per_inst: number }>>({
    queryKey: ['cp_emi', bookingIds],
    enabled: bookingIds.length > 0,
    queryFn: async () => {
      const { data: scheds } = await supabase
        .from('emi_schedules')
        .select('id, booking_id, num_installments')
        .in('booking_id', bookingIds)
      const schedIds = (scheds || []).map((s: any) => s.id)
      if (schedIds.length === 0) return {}
      const { data: insts } = await supabase
        .from('emi_installments')
        .select('schedule_id, due_date, amount, paid_amount, status')
        .in('schedule_id', schedIds)
      const schedToBooking: Record<string, string> = {}
      for (const s of (scheds || [])) schedToBooking[s.id] = s.booking_id
      const todayStr = today()
      const out: Record<string, any> = {}
      for (const s of (scheds || [])) {
        const bid = schedToBooking[s.id]
        out[bid] = { schedule_id: s.id, n: s.num_installments, paid: 0, partial: 0, overdue: 0, next_due: null as string | null, per_inst: 0 }
      }
      for (const i of (insts || [])) {
        const bid = schedToBooking[i.schedule_id]
        if (!bid) continue
        const row = out[bid]
        if (!row.per_inst && i.amount) row.per_inst = i.amount
        if (i.status === 'paid')    row.paid++
        if (i.status === 'partial') row.partial++
        if (i.status !== 'paid' && i.due_date < todayStr) row.overdue++
        if (i.status !== 'paid' && (!row.next_due || i.due_date < row.next_due)) row.next_due = i.due_date
      }
      return out
    },
  })

  const { data: mlmByBooking = {} } = useQuery<Record<string, { rows: number; net: number }>>({
    queryKey: ['cp_mlm', bookingIds],
    enabled: bookingIds.length > 0,
    queryFn: async () => {
      const { data } = await supabase
        .from('payout_distributions')
        .select('booking_id, net_payout')
        .in('booking_id', bookingIds)
      const m: Record<string, any> = {}
      for (const d of (data || [])) {
        if (!d.booking_id) continue
        if (!m[d.booking_id]) m[d.booking_id] = { rows: 0, net: 0 }
        m[d.booking_id].rows++
        m[d.booking_id].net += Number(d.net_payout || 0)
      }
      return m
    },
  })

  // Brokers + sponsor chain for upline display
  const { data: brokerChains = {} } = useQuery<Record<string, { id: string; name: string; broker_id: string; rank: string }[]>>({
    queryKey: ['cp_broker_chains'],
    queryFn: async () => {
      const [{ data: brokers }, { data: tree }] = await Promise.all([
        supabase.from('brokers').select('id, name, broker_id, rank, sponsor_id'),
        supabase.from('sponsor_tree').select('descendant_id, ancestor_id, depth'),
      ])
      const lookup: Record<string, any> = {}
      for (const b of (brokers || [])) lookup[b.id] = b
      const chains: Record<string, any[]> = {}
      // For each broker, build chain via sponsor_id walk (fallback if sponsor_tree empty)
      for (const b of (brokers || [])) {
        const chain: any[] = [{ ...b, depth: 0 }]
        let cur: any = b
        let safety = 15
        while (cur?.sponsor_id && safety-- > 0) {
          const up = lookup[cur.sponsor_id]
          if (!up) break
          chain.push({ ...up, depth: chain.length })
          cur = up
        }
        chains[b.id] = chain
      }
      // Override via sponsor_tree if it has explicit ancestor mappings
      if (tree && tree.length) {
        for (const b of (brokers || [])) {
          const ancestors = tree
            .filter((t: any) => t.descendant_id === b.id && t.ancestor_id !== b.id)
            .sort((x: any, y: any) => (x.depth || 0) - (y.depth || 0))
          if (ancestors.length) {
            const chain: any[] = [{ ...b, depth: 0 }]
            for (const a of ancestors) {
              const up = lookup[a.ancestor_id]
              if (up) chain.push({ ...up, depth: a.depth })
            }
            chains[b.id] = chain
          }
        }
      }
      return chains
    },
  })

  const { data: brokers = [] } = useQuery({
    queryKey: ['cp_brokers_list'],
    queryFn: async () => {
      const { data } = await supabase.from('brokers').select('id, name, broker_id').order('name')
      return data || []
    },
  })

  const { data: projects = [] } = useQuery({
    queryKey: ['cp_projects_list'],
    queryFn: async () => {
      const { data } = await supabase.from('bp_projects').select('id, name').order('name')
      return data || []
    },
  })

  // ── Mutations ──────────────────────────────────────────────────────
  const recordPay = useMutation({
    mutationFn: async (p: { booking: any; type: 'token' | 'booking'; amount: number; mode: string; date: string; utr: string; drawn_on: string; branch: string }) => {
      if (!p.amount || p.amount <= 0) throw new Error('Amount required')
      const { data: rn } = await supabase.rpc('next_receipt_no')
      const { data: payment, error } = await supabase.from('bp_payments').insert({
        booking_id: p.booking.id, customer_id: p.booking.customer_id,
        payment_type: p.type, amount: p.amount, payment_mode: p.mode,
        payment_date: p.date, verification_status: 'verified',
        verified_at: new Date().toISOString(),
        receipt_no: rn || null,
        utr_ref: p.utr || null,
        drawn_on_bank: p.drawn_on || (p.mode === 'cash' ? 'Cash' : null),
        branch: p.branch || null,
        sponsor_name: p.booking.brokers?.name || null,
      }).select('id').single()
      if (error) throw error

      // Booking-type payment: also update bp_bookings.booking_amount + advance stage if needed
      if (p.type === 'booking') {
        const prevBooking = Number(p.booking.booking_amount || 0)
        const patch: any = {
          booking_amount: prevBooking + p.amount,
          booking_date: p.booking.booking_date || p.date,
          updated_at: new Date().toISOString(),
        }
        if (p.booking.stage === 'token_received') patch.stage = 'booking_done'
        await supabase.from('bp_bookings').update(patch).eq('id', p.booking.id)
        // Sync plot status
        if (p.booking.plot_id) {
          await supabase.from('bp_plots').update({ status: 'booked' }).eq('id', p.booking.plot_id)
        }
      }
      if (p.type === 'token' && p.booking.stage !== 'token_received' && p.booking.stage !== 'booking_done') {
        await supabase.from('bp_bookings').update({ stage: 'token_received', token_amount: Number(p.booking.token_amount || 0) + p.amount, updated_at: new Date().toISOString() }).eq('id', p.booking.id)
      } else if (p.type === 'token') {
        await supabase.from('bp_bookings').update({ token_amount: Number(p.booking.token_amount || 0) + p.amount, updated_at: new Date().toISOString() }).eq('id', p.booking.id)
      }

      // Per-payment MLM distribution
      const rows = await distributePaymentCommission({ bookingId: p.booking.id, paymentId: payment.id, amount: p.amount })
      return rows.length
    },
    onSuccess: (distributed) => {
      qc.invalidateQueries({ queryKey: ['cp_bookings'] })
      qc.invalidateQueries({ queryKey: ['cp_payments'] })
      qc.invalidateQueries({ queryKey: ['cp_mlm'] })
      qc.invalidateQueries({ queryKey: ['bookings'] })
      qc.invalidateQueries({ queryKey: ['payments'] })
      qc.invalidateQueries({ queryKey: ['payouts'] })
      qc.invalidateQueries({ queryKey: ['commission_ledger'] })
      qc.invalidateQueries({ queryKey: ['plots'] })
      toast.success(`Payment recorded${distributed ? ` · MLM × ${distributed}` : ''}`)
      setPayFor(null)
    },
    onError: (e: any) => toast.error(e.message),
  })

  // ── Derive per-row state ───────────────────────────────────────────
  const rows = useMemo(() => {
    return (bookings as any[]).map((b: any) => {
      const pm = paymentsByBooking[b.id] || { token: 0, booking: 0, emi: 0, full: 0, total: 0, last_date: null }
      const total = Number(b.total_amount || b.plot_total_price || 0)
      const paid  = pm.total
      const balance = Math.max(0, total - paid)
      const emi = emiSummary[b.id]
      const mlm = mlmByBooking[b.id] || { rows: 0, net: 0 }
      const chain = brokerChains[b.broker_id] || []
      const expected = Number(b.expected_booking_amount || 0)
      const hasToken   = pm.token > 0
      const hasBooking = pm.booking > 0
      const bookingShortfall = expected > 0 && pm.booking < expected ? expected - pm.booking : 0
      const category: Tab =
        balance <= 0 && total > 0  ? 'settled'
      : (hasToken && !hasBooking && pm.full === 0) ? 'unpaid_booking'
      : (!!emi && balance > 0)      ? 'emi_active'
                                    : 'all'
      return {
        ...b, pm, total, paid, balance, emi, mlm, chain, expected,
        hasToken, hasBooking, bookingShortfall, category,
      }
    })
  }, [bookings, paymentsByBooking, emiSummary, mlmByBooking, brokerChains])

  const stats = useMemo(() => {
    const all = rows.length
    const unpaid = rows.filter(r => r.category === 'unpaid_booking').length
    const emi    = rows.filter(r => r.category === 'emi_active').length
    const settled = rows.filter(r => r.category === 'settled').length
    const expectedAmt = rows.filter(r => r.category === 'unpaid_booking').reduce((s, r) => s + r.expected, 0)
    const balanceAmt  = rows.reduce((s, r) => s + r.balance, 0)
    return { all, unpaid, emi, settled, expectedAmt, balanceAmt }
  }, [rows])

  const filtered = useMemo(() => {
    let arr = rows
    if (tab !== 'all') arr = arr.filter(r => r.category === tab)
    if (filterBroker)  arr = arr.filter(r => r.broker_id === filterBroker)
    if (filterProject) arr = arr.filter(r => r.project_id === filterProject)
    const q = search.trim().toLowerCase()
    if (q) arr = arr.filter(r =>
      (r.bp_customers?.name || '').toLowerCase().includes(q) ||
      (r.bp_customers?.phone || '').toLowerCase().includes(q) ||
      (r.bp_customers?.customer_code || '').toLowerCase().includes(q) ||
      (r.booking_no || '').toLowerCase().includes(q) ||
      (r.bp_plots?.plot_no || '').toLowerCase().includes(q) ||
      (r.brokers?.name || '').toLowerCase().includes(q)
    )
    return arr
  }, [rows, tab, filterBroker, filterProject, search])

  const toggleExpand = (id: string) => setExpanded(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })

  return (
    <div className="p-3 md:p-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-indigo-50 rounded-lg"><Users size={20} className="text-indigo-600"/></div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">Customer Pipeline</h1>
            <p className="text-sm text-gray-500">Every deal at a glance — customer, plot, what's been paid, what's pending, the broker chain &amp; MLM earned.</p>
          </div>
        </div>
      </div>

      {/* KPI tiles + tabs combined */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <TabTile active={tab==='all'}            onClick={() => setTab('all')}
          icon={<Users size={16}/>}              label="All customers"     value={String(stats.all)}                                tint="indigo"/>
        <TabTile active={tab==='unpaid_booking'} onClick={() => setTab('unpaid_booking')}
          icon={<AlertTriangle size={16}/>}      label="Unpaid booking"     value={String(stats.unpaid)} sub={stats.expectedAmt > 0 ? `expects ${formatINR(stats.expectedAmt)}` : 'token paid · deposit pending'} tint="amber"/>
        <TabTile active={tab==='emi_active'}     onClick={() => setTab('emi_active')}
          icon={<Calculator size={16}/>}         label="EMI collection"     value={String(stats.emi)} sub={`balance ${formatINR(stats.balanceAmt)}`}     tint="blue"/>
        <TabTile active={tab==='settled'}        onClick={() => setTab('settled')}
          icon={<CheckCircle2 size={16}/>}       label="Fully settled"      value={String(stats.settled)} sub="zero balance"                              tint="emerald"/>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-3 flex flex-wrap gap-2 items-center">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"/>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search customer, phone, code, booking, plot, broker..."
            className="w-full pl-8 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-300"/>
        </div>
        <select value={filterBroker} onChange={e => setFilterBroker(e.target.value)} className="border border-gray-200 rounded-lg px-2 py-2 text-sm focus:outline-none">
          <option value="">All brokers</option>
          {(brokers as any[]).map((b: any) => <option key={b.id} value={b.id}>{b.name} [{b.broker_id}]</option>)}
        </select>
        <select value={filterProject} onChange={e => setFilterProject(e.target.value)} className="border border-gray-200 rounded-lg px-2 py-2 text-sm focus:outline-none">
          <option value="">All projects</option>
          {(projects as any[]).map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <div className="text-xs text-gray-500 ml-auto">{filtered.length} of {rows.length}</div>
      </div>

      {/* Deals list */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm divide-y divide-gray-100">
        {isLoading && <div className="py-10 text-center text-sm text-gray-400">Loading…</div>}
        {!isLoading && filtered.length === 0 && (
          <div className="py-12 text-center">
            <div className="text-sm text-gray-400">
              {tab === 'unpaid_booking' && '✓ No deals waiting on booking deposit — well done.'}
              {tab === 'emi_active' && 'No active EMI plans. Once a booking has an EMI schedule and balance, it appears here.'}
              {tab === 'settled' && 'No fully settled deals yet.'}
              {tab === 'all' && 'No customers in pipeline. Create a booking to start.'}
            </div>
          </div>
        )}
        {filtered.map((r: any) => {
          const open = expanded.has(r.id)
          const cust = r.bp_customers
          return (
            <div key={r.id}>
              <div className="px-3 md:px-4 py-3 hover:bg-gray-50/60">
                <div className="flex items-start gap-3 flex-wrap md:flex-nowrap">
                  <button onClick={() => toggleExpand(r.id)} className="shrink-0 mt-1"><ChevronRight size={14} className={`text-gray-400 transition-transform ${open ? 'rotate-90' : ''}`}/></button>

                  {/* Customer + plot */}
                  <div className="flex-1 min-w-[200px]">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <Link to={`/customer-history?customer=${r.customer_id}`} className="font-semibold text-sm text-gray-900 hover:text-blue-700 hover:underline">{cust?.name || '—'}</Link>
                      <span className="text-[10px] font-mono text-gray-400">{cust?.customer_code || ''}</span>
                      {cust?.phone && (
                        <>
                          <a href={`tel:${cust.phone}`} className="text-[10px] text-blue-700 hover:underline inline-flex items-center gap-0.5"><Phone size={9}/>{cust.phone}</a>
                          <a href={`https://wa.me/${String(cust.phone).replace(/[^\d]/g,'')}`} target="_blank" rel="noreferrer" className="text-[10px] text-emerald-700 hover:underline inline-flex items-center gap-0.5"><MessageCircle size={9}/>WA</a>
                        </>
                      )}
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      <span className="font-mono text-blue-700">{r.booking_no}</span>
                      {r.bp_plots?.plot_no && <span> · Plot {r.bp_plots.plot_no}</span>}
                      {r.bp_plots?.size_sqyd && <span> · {r.bp_plots.size_sqyd} sqyd</span>}
                      {(r.bp_projects?.name || r.scheme_name) && <span> · {r.bp_projects?.name || r.scheme_name}</span>}
                    </div>
                  </div>

                  {/* Token */}
                  <Col label="Token">
                    {r.pm.token > 0 ? (
                      <div>
                        <div className="text-sm font-semibold text-emerald-700">{formatINR(r.pm.token)}</div>
                        <div className="text-[10px] text-gray-400">received</div>
                      </div>
                    ) : (
                      <div className="text-xs text-gray-400">—</div>
                    )}
                  </Col>

                  {/* Booking deposit */}
                  <Col label="Booking deposit">
                    {r.pm.booking > 0 ? (
                      <div>
                        <div className="text-sm font-semibold text-blue-700">{formatINR(r.pm.booking)}</div>
                        {r.bookingShortfall > 0
                          ? <div className="text-[10px] text-amber-700">partial · short {formatINR(r.bookingShortfall)}</div>
                          : <div className="text-[10px] text-gray-400">paid</div>}
                      </div>
                    ) : r.expected > 0 ? (
                      <div>
                        <div className="text-sm font-semibold text-amber-700">⏳ {formatINR(r.expected)}</div>
                        <div className="text-[10px] text-amber-600">expected (unpaid)</div>
                      </div>
                    ) : r.hasToken ? (
                      <div className="text-xs text-amber-700">⏳ pending</div>
                    ) : (
                      <div className="text-xs text-gray-400">—</div>
                    )}
                  </Col>

                  {/* EMI */}
                  <Col label="EMI">
                    {r.emi ? (
                      <div>
                        <div className="text-sm font-semibold text-gray-900">{r.emi.paid + r.emi.partial}/{r.emi.n}</div>
                        <div className="text-[10px] text-gray-500">{r.emi.per_inst ? `${formatINR(r.emi.per_inst)} ea` : ''}</div>
                        {r.emi.overdue > 0 && <div className="text-[10px] font-semibold text-rose-700">{r.emi.overdue} overdue</div>}
                        {r.emi.next_due && r.emi.overdue === 0 && <div className="text-[10px] text-amber-700">next {formatDate(r.emi.next_due)}</div>}
                      </div>
                    ) : r.hasBooking ? (
                      <div className="text-xs text-gray-400">no schedule</div>
                    ) : (
                      <div className="text-xs text-gray-300">—</div>
                    )}
                  </Col>

                  {/* Broker chain */}
                  <Col label="Broker · upline">
                    {r.brokers ? (
                      <div className="text-xs">
                        <Link to={`/broker/dashboard?broker_id=${r.broker_id}`} className="font-medium text-blue-700 hover:underline">{r.brokers.name}</Link>
                        {r.chain.length > 1 && (
                          <div className="text-[10px] text-gray-500 truncate max-w-[180px]" title={r.chain.slice(1).map((c: any) => c.name).join(' → ')}>
                            ↑ {r.chain.slice(1, 4).map((c: any) => c.name).join(' → ')}{r.chain.length > 4 ? ` …+${r.chain.length - 4}` : ''}
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="text-xs text-gray-400">no broker</div>
                    )}
                  </Col>

                  {/* MLM earned */}
                  <Col label="MLM net">
                    <div>
                      <div className="text-sm font-bold text-emerald-700">{formatINR(r.mlm.net)}</div>
                      <div className="text-[10px] text-gray-400">{r.mlm.rows} {r.mlm.rows === 1 ? 'row' : 'rows'}</div>
                    </div>
                  </Col>

                  {/* Balance */}
                  <Col label="Balance">
                    <div>
                      <div className={`text-sm font-bold ${r.balance > 0 ? 'text-orange-700' : 'text-emerald-700'}`}>{formatINR(r.balance)}</div>
                      <div className="text-[10px] text-gray-400">of {formatINR(r.total)}</div>
                    </div>
                  </Col>

                  {/* Quick actions */}
                  <div className="shrink-0 flex flex-col gap-1 items-end min-w-[150px]">
                    <Badge label={r.stage?.replace(/_/g, ' ')} className={`text-[10px] border ${STAGE_COLORS[r.stage] || 'bg-gray-100 text-gray-700'}`}/>
                    {!r.hasToken && r.balance > 0 && (
                      <Button size="sm" variant="secondary" onClick={() => setPayFor({ booking: r, type: 'token' })}><Banknote size={11}/>Record token</Button>
                    )}
                    {r.hasToken && r.balance > 0 && (
                      <Button size="sm" onClick={() => setPayFor({ booking: r, type: 'booking' })}>
                        <Banknote size={11}/>{r.hasBooking ? 'Add booking payment' : 'Record booking'}
                      </Button>
                    )}
                    {r.balance > 0 && (
                      <Button size="sm" variant={r.emi ? 'ghost' : 'secondary'} onClick={() => setEmiBooking(r)}>
                        <Calculator size={11}/>{r.emi ? 'EMI' : 'Start EMI'}
                      </Button>
                    )}
                    <div className="flex gap-1">
                      <button onClick={() => navigate(`/bookings?edit=${r.id}`)}
                        className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-md border border-gray-200 hover:bg-gray-50 text-gray-700">
                        <FileText size={11}/>Edit
                      </button>
                      <button onClick={() => printApplicationForm(r)}
                        className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-md border border-gray-200 hover:bg-gray-50 text-gray-700">
                        <Printer size={11}/>Form
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Expanded payment ledger */}
              {open && (
                <div className="bg-gray-50/60 px-12 py-3 border-t border-gray-100">
                  <ExpandedDetail row={r}/>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* EMI panel (reuse from Bookings) */}
      <EmiPanel booking={emiBooking} open={!!emiBooking} onClose={() => setEmiBooking(null)}/>

      {/* Quick payment modal */}
      <RecordPaymentModal
        open={!!payFor}
        booking={payFor?.booking}
        type={payFor?.type || 'token'}
        onClose={() => setPayFor(null)}
        onSubmit={(form) => recordPay.mutate({ booking: payFor!.booking, type: payFor!.type, ...form })}
        submitting={recordPay.isPending}
      />
    </div>
  )
}

function TabTile({ active, onClick, icon, label, value, sub, tint }: any) {
  const palettes: Record<string, { bg: string; active: string; text: string }> = {
    indigo:  { bg: 'bg-white border-gray-200',           active: 'bg-gray-900 border-gray-900 text-white',       text: 'text-gray-900' },
    amber:   { bg: 'bg-amber-50 border-amber-200',       active: 'bg-amber-600 border-amber-600 text-white',     text: 'text-amber-800' },
    blue:    { bg: 'bg-blue-50 border-blue-200',         active: 'bg-blue-600 border-blue-600 text-white',       text: 'text-blue-800' },
    emerald: { bg: 'bg-emerald-50 border-emerald-200',   active: 'bg-emerald-600 border-emerald-600 text-white', text: 'text-emerald-800' },
  }
  const p = palettes[tint] || palettes.indigo
  return (
    <button onClick={onClick} className={`text-left rounded-xl border p-3 transition ${active ? p.active : p.bg}`}>
      <div className="flex items-center justify-between mb-1">
        <span className={active ? 'opacity-90' : p.text}>{icon}</span>
        <span className={`text-2xl font-bold ${active ? '' : p.text}`}>{value}</span>
      </div>
      <div className={`text-xs ${active ? 'opacity-80' : 'text-gray-500'}`}>{label}</div>
      {sub && <div className={`text-[10px] mt-0.5 ${active ? 'opacity-70' : 'text-gray-400'}`}>{sub}</div>}
    </button>
  )
}

function Col({ label, children }: any) {
  return (
    <div className="min-w-[100px] shrink-0">
      <div className="text-[10px] uppercase tracking-wider text-gray-400 mb-0.5">{label}</div>
      {children}
    </div>
  )
}

function ExpandedDetail({ row }: { row: any }) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
      <div className="bg-white rounded-lg border border-gray-200 p-3">
        <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-2 font-semibold">Pricing</div>
        <Row k="Total net value" v={formatINR(row.total)}/>
        <Row k="Paid (verified)" v={formatINR(row.paid)} accent="text-emerald-700"/>
        <Row k="Balance" v={formatINR(row.balance)} accent={row.balance > 0 ? 'text-orange-700' : 'text-emerald-700'}/>
        {row.commission_rate > 0 && <Row k="Commission rate" v={`${row.commission_rate}%`}/>}
        {row.commission_amount > 0 && <Row k="Commission promised" v={formatINR(row.commission_amount)} accent="text-blue-700"/>}
      </div>

      <div className="bg-white rounded-lg border border-gray-200 p-3">
        <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-2 font-semibold">Payment breakdown</div>
        <Row k="Token paid"        v={formatINR(row.pm.token)}/>
        <Row k="Booking deposit"   v={formatINR(row.pm.booking)}/>
        {row.expected > 0 && row.pm.booking < row.expected && <Row k="Expected (unpaid)" v={formatINR(row.expected)} accent="text-amber-700"/>}
        <Row k="EMI received"      v={formatINR(row.pm.emi)}/>
        {row.pm.full > 0 && <Row k="Full payment"  v={formatINR(row.pm.full)}/>}
        <Row k="Last payment date" v={row.pm.last_date ? formatDate(row.pm.last_date) : '—'}/>
      </div>

      <div className="bg-white rounded-lg border border-gray-200 p-3">
        <div className="text-[10px] uppercase tracking-wider text-gray-500 mb-2 font-semibold">MLM chain</div>
        {row.chain.length === 0 ? (
          <div className="text-gray-400">No broker assigned</div>
        ) : (
          <div className="space-y-1">
            {row.chain.map((c: any, i: number) => (
              <div key={c.id} className="flex items-center justify-between">
                <span className="flex items-center gap-1 truncate">
                  {i === 0 ? <Coins size={11} className="text-emerald-600 shrink-0"/> : <ArrowUpRight size={11} className="text-gray-400 shrink-0"/>}
                  <Link to={`/broker/dashboard?broker_id=${c.id}`} className="text-blue-700 hover:underline truncate">{c.name}</Link>
                  <span className="text-[10px] text-gray-400 font-mono">[{c.broker_id}]</span>
                </span>
                <span className="text-[10px] text-gray-500">{i === 0 ? 'direct' : `L${i}`}</span>
              </div>
            ))}
          </div>
        )}
        <div className="mt-2 pt-2 border-t border-gray-100">
          <Row k="MLM net distributed" v={formatINR(row.mlm.net)} accent="text-emerald-700"/>
          <Row k="Distribution rows"   v={String(row.mlm.rows)}/>
        </div>
      </div>
    </div>
  )
}

function Row({ k, v, accent }: any) {
  return (
    <div className="flex items-center justify-between py-0.5">
      <span className="text-gray-500">{k}</span>
      <span className={`font-semibold ${accent || 'text-gray-900'}`}>{v}</span>
    </div>
  )
}

function RecordPaymentModal({ open, booking, type, onClose, onSubmit, submitting }: any) {
  const [form, setForm] = useState<any>({ amount: '', mode: 'cash', date: today(), utr: '', drawn_on: '', branch: '' })
  // Reset when (re)opened — leave Amount blank so admin types intentionally
  useMemo(() => {
    if (open && booking) setForm({ amount: '', mode: 'cash', date: today(), utr: '', drawn_on: '', branch: '' })
  }, [open, booking?.id, type])
  const set = (k: string, v: any) => setForm((p: any) => ({ ...p, [k]: v }))

  if (!booking) return null

  const amt = Number(form.amount) || 0
  const expectedRemaining = type === 'booking' ? Math.max(0, Number(booking.expected || 0) - Number(booking.pm?.booking || 0)) : 0
  const balanceAfter = Math.max(0, Number(booking.balance) - amt)

  // Quick-amount presets
  const presets: { label: string; value: number; tone: string }[] = []
  if (type === 'booking' && expectedRemaining > 0) {
    presets.push({ label: `Expected · ${formatINR(expectedRemaining)}`, value: expectedRemaining, tone: 'bg-blue-50 text-blue-800 border-blue-200' })
    presets.push({ label: `Half · ${formatINR(Math.round(expectedRemaining / 2))}`, value: Math.round(expectedRemaining / 2), tone: 'bg-amber-50 text-amber-800 border-amber-200' })
  }
  presets.push({ label: `Full balance · ${formatINR(booking.balance)}`, value: booking.balance, tone: 'bg-emerald-50 text-emerald-800 border-emerald-200' })

  return (
    <Modal open={open} onClose={onClose} title={type === 'token' ? `Record token · ${booking.bp_customers?.name || ''}` : `Record booking deposit · ${booking.bp_customers?.name || ''}`} size="sm">
      <div className="space-y-3">
        {/* Context strip */}
        <div className="bg-blue-50/60 border border-blue-100 rounded-lg p-3 text-xs grid grid-cols-2 gap-1">
          <span className="text-gray-600">Total plot value</span><b className="text-right">{formatINR(booking.total)}</b>
          <span className="text-gray-600">Already paid</span><b className="text-right text-emerald-700">{formatINR(booking.paid)}</b>
          {type === 'booking' && booking.expected > 0 && (
            <>
              <span className="text-gray-600">Expected booking deposit</span><b className="text-right text-blue-800">{formatINR(booking.expected)}</b>
              <span className="text-gray-600">Already paid against it</span><b className="text-right">{formatINR(booking.pm.booking || 0)}</b>
            </>
          )}
          <span className="text-gray-600">Balance remaining</span><b className="text-right text-orange-700">{formatINR(booking.balance)}</b>
        </div>

        {/* Custom amount field */}
        <div>
          <label className="text-xs font-semibold text-gray-700 mb-1 block">Amount received today (₹)</label>
          <input type="number" autoFocus value={form.amount} onChange={e => set('amount', e.target.value)}
            placeholder="any amount the customer is paying"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-indigo-300"/>

          {/* Quick presets */}
          <div className="flex flex-wrap gap-1.5 mt-2">
            {presets.map(p => (
              <button key={p.label} type="button" onClick={() => set('amount', String(p.value))}
                className={`text-[11px] px-2 py-1 rounded-md border ${p.tone} hover:opacity-80`}>{p.label}</button>
            ))}
          </div>

          {/* Live feedback */}
          {amt > 0 && (
            <div className="mt-2 text-[11px]">
              {type === 'booking' && booking.expected > 0 && amt < expectedRemaining && (
                <span className="text-amber-700">⏳ Partial booking deposit · shortfall {formatINR(expectedRemaining - amt)} (carries forward, can be collected later)</span>
              )}
              {type === 'booking' && booking.expected > 0 && amt >= expectedRemaining && (
                <span className="text-emerald-700">✓ Booking deposit fully covered{amt > expectedRemaining ? ` · ${formatINR(amt - expectedRemaining)} extra towards balance` : ''}</span>
              )}
              {amt > booking.balance && (
                <span className="text-rose-700 block mt-0.5">⚠ Amount exceeds balance ({formatINR(booking.balance)}). Excess will be recorded but not applied to outstanding.</span>
              )}
              {amt <= booking.balance && <span className="text-gray-500 block mt-0.5">Balance after this payment: <b className="text-orange-700">{formatINR(balanceAfter)}</b></span>}
            </div>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Select label="Mode" value={form.mode} onChange={(e: any) => set('mode', e.target.value)}>
            {PAYMENT_MODES.map(m => <option key={m} value={m}>{m.toUpperCase()}</option>)}
          </Select>
          <Input label="Date" type="date" value={form.date} onChange={(e: any) => set('date', e.target.value)}/>
          <Input label="UTR / Reference" value={form.utr} onChange={(e: any) => set('utr', e.target.value)} className="col-span-2"/>
          <Input label="Drawn on (bank)" value={form.drawn_on} onChange={(e: any) => set('drawn_on', e.target.value)}/>
          <Input label="Branch" value={form.branch} onChange={(e: any) => set('branch', e.target.value)}/>
        </div>

        <div className="text-[11px] text-gray-500">
          Per-payment MLM commission will be distributed to the broker chain.
        </div>
      </div>
      <div className="flex justify-end gap-2 mt-5">
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button onClick={() => onSubmit({ amount: amt, mode: form.mode, date: form.date, utr: form.utr, drawn_on: form.drawn_on, branch: form.branch })} loading={submitting} disabled={!amt}>
          <IndianRupee size={14}/>Record &amp; distribute MLM
        </Button>
      </div>
    </Modal>
  )
}
