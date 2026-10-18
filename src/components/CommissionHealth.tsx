// The ways a sale ends up paying nobody, or paying the wrong person.
//
// Admin: "kahi bhi or error h traditional me to manisha ko dikha jae, guardrail honi
// chahiye ... har jagah jaha hona chahiye."
//
// Everything here is silent by nature. recompute_booking_payouts() does not complain when
// a booking has no commission on it, or when the person who sold it is missing from the
// split - it simply inserts nothing, or inserts rows for everyone except them. The
// booking looks finished, the office moves on, and the gap only turns up in a payout
// cycle weeks later, or not at all.
//
// So each check below is a specific way money goes missing, written as the question the
// office would ask, with the booking named and a way through to it. None of them is
// theory: the first one is CR-0833 on the live system right now - broker attached, 1,100
// collected and verified, commission 0, nobody paid a rupee.
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { fetchAllRows, inChunks } from '@/lib/fetchAll'
import { formatINR } from '@/lib/utils'
import { Secret } from '@/lib/privacy'
import { downloadCsv } from '@/lib/download'
import { Search, Download, AlertTriangle, ExternalLink } from 'lucide-react'

type Issue =
  | 'no_commission'
  | 'split_without_seller'
  | 'over_100'
  | 'wrong_type'
  | 'pay_upline_on'
  | 'unverified_money'

const ISSUES: { key: Issue; label: string; severity: 'high' | 'mid'; why: string }[] = [
  { key: 'no_commission', label: 'No commission set', severity: 'high',
    why: 'A traditional sale with a broker on it but no rate, no percentage and no team split. The engine inserts nothing, so this booking pays nobody — however much the customer pays in. Open the booking and set what the broker is on.' },
  { key: 'split_without_seller', label: 'Seller left out of the split', severity: 'high',
    why: 'This booking has team rows, and the broker who actually sold it is not one of them. Once ANY team row exists the engine pays those rows and ignores the booking’s own broker completely — so everybody above gets paid and the person who made the sale gets nothing.' },
  { key: 'over_100', label: 'Split adds to over 100%', severity: 'high',
    why: 'The team rows add to more than 100% of every payment, so the company pays out more than the customer puts in. Almost always a percentage typed into the wrong row.' },
  { key: 'wrong_type', label: 'Broker is the wrong kind', severity: 'high',
    why: 'A traditional sale credited to an Affiliate broker, or the reverse. The two trees are paid in completely different ways — one from an agreed rate, one from the rank ladder — so whatever this pays will not be what anybody agreed.' },
  { key: 'pay_upline_on', label: 'Old upline switch still on', severity: 'high',
    why: 'This booking still carries traditional_pay_upline. That flag sends a traditional sale into the Affiliate cascade, which reads percentages from the rank ladder — traditional brokers sit on a defaulted ‘Executive’ 5% slab they have nothing to do with. The switch is gone from the form; this is a leftover.' },
  { key: 'unverified_money', label: 'Money in, not verified', severity: 'mid',
    why: 'The customer has paid, but the payment is still unverified — and commission is only ever computed on verified payments. Nobody earns anything on this money until somebody verifies it.' },
]

type Row = {
  id: string
  booking_no: string | null
  customer_name: string
  broker_name: string
  mode: string
  total: number
  detail: string
  issues: Issue[]
}

export default function CommissionHealth() {
  const [active, setActive] = useState<Issue>('no_commission')
  const [q, setQ] = useState('')
  const [limit, setLimit] = useState(100)

  const { data, isLoading } = useQuery({
    queryKey: ['commission_health'],
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const bookings = await fetchAllRows((f, t) => supabase
        .from('bp_bookings')
        .select('id, booking_no, stage, commission_mode, broker_id, total_amount, plot_total_price, traditional_commission_pct, traditional_commission_per_sqyd, traditional_pay_upline, bp_customers(name)')
        .neq('stage', 'cancelled').order('id').range(f, t))

      const brokers = await fetchAllRows((f, t) => supabase
        .from('brokers').select('id, name, broker_id, broker_type').order('id').range(f, t))
      const brokerById = new Map((brokers as any[]).map(b => [b.id, b]))

      const ids = (bookings as any[]).map(b => b.id)
      const splits = ids.length
        ? await inChunks<any>(ids, chunk => supabase
            .from('bp_booking_brokers').select('booking_id, broker_id, commission_pct').in('booking_id', chunk))
        : []
      const splitByBooking = new Map<string, any[]>()
      for (const s of splits) {
        const arr = splitByBooking.get(s.booking_id) || []
        arr.push(s); splitByBooking.set(s.booking_id, arr)
      }

      // Unverified money, summed per booking — the figure is the point, not the count.
      const pays = ids.length
        ? await inChunks<any>(ids, chunk => supabase
            .from('bp_payments').select('booking_id, amount, verification_status').in('booking_id', chunk))
        : []
      const unverifiedByBooking = new Map<string, number>()
      for (const p of pays) {
        if ((p.verification_status || '') === 'verified') continue
        if (!(Number(p.amount) > 0)) continue
        unverifiedByBooking.set(p.booking_id, (unverifiedByBooking.get(p.booking_id) || 0) + Number(p.amount))
      }

      let withBroker = 0
      let willPay = 0
      const rows: Row[] = []

      for (const b of bookings as any[]) {
        const issues: Issue[] = []
        const broker = b.broker_id ? brokerById.get(b.broker_id) : null
        const mode = (b.commission_mode || 'mlm') === 'traditional' ? 'traditional' : 'mlm'
        const team = splitByBooking.get(b.id) || []
        const teamTotal = team.reduce((s, r) => s + Number(r.commission_pct || 0), 0)
        const hasOwnRate = Number(b.traditional_commission_pct) > 0
          || Number(b.traditional_commission_per_sqyd) > 0
        const details: string[] = []

        if (broker) {
          withBroker++
          // Will this booking pay anybody at all?
          const pays = mode === 'traditional' ? (team.length > 0 ? teamTotal > 0 : hasOwnRate) : true
          if (pays) willPay++

          if (mode === 'traditional' && team.length === 0 && !hasOwnRate) {
            issues.push('no_commission')
            details.push('no rate, no % and no team split')
          }
          if (team.length > 0 && !team.some(r => r.broker_id === b.broker_id)) {
            issues.push('split_without_seller')
            details.push(`${team.length} team row${team.length === 1 ? '' : 's'}, none of them ${broker.name}`)
          }
          if (teamTotal > 100) {
            issues.push('over_100')
            details.push(`team rows add to ${Math.round(teamTotal * 100) / 100}%`)
          }
          const bt = broker.broker_type || 'mlm'
          if ((mode === 'traditional') !== (bt === 'traditional')) {
            issues.push('wrong_type')
            details.push(`${mode === 'traditional' ? 'Traditional' : 'Affiliate'} sale on ${bt === 'traditional' ? 'a Traditional' : 'an Affiliate'} broker`)
          }
          if (mode === 'traditional' && b.traditional_pay_upline) {
            issues.push('pay_upline_on')
            details.push('traditional_pay_upline is still set')
          }
          const unv = unverifiedByBooking.get(b.id) || 0
          if (unv > 0) {
            issues.push('unverified_money')
            details.push(`${formatINR(unv)} paid but not verified`)
          }
        }

        if (issues.length > 0) {
          rows.push({
            id: b.id,
            booking_no: b.booking_no,
            customer_name: b.bp_customers?.name || '—',
            broker_name: broker ? `${broker.name}${broker.broker_id ? ` [${broker.broker_id}]` : ''}` : '—',
            mode: mode === 'traditional' ? 'Traditional' : 'Affiliate',
            total: Number(b.total_amount || b.plot_total_price || 0),
            detail: details.join(' · '),
            issues,
          })
        }
      }

      return { rows, live: (bookings as any[]).length, withBroker, willPay }
    },
  })

  const rows = data?.rows || []
  const counts = useMemo(() => {
    const c: Record<Issue, number> = {
      no_commission: 0, split_without_seller: 0, over_100: 0,
      wrong_type: 0, pay_upline_on: 0, unverified_money: 0,
    }
    for (const r of rows) for (const i of r.issues) c[i]++
    return c
  }, [rows])

  const meta = ISSUES.find(i => i.key === active)!
  const list = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return rows
      .filter(r => r.issues.includes(active))
      .filter(r => !needle
        || (r.booking_no || '').toLowerCase().includes(needle)
        || r.customer_name.toLowerCase().includes(needle)
        || r.broker_name.toLowerCase().includes(needle))
  }, [rows, active, q])

  const exportCsv = () => {
    downloadCsv(`commission-health-${active}`, [
      ['Issue', 'Booking', 'Customer', 'Broker', 'Mode', 'Value', 'What is wrong'],
      ...list.map(r => [meta.label, r.booking_no || '', r.customer_name, r.broker_name, r.mode, r.total, r.detail]),
    ])
  }

  if (isLoading) return <div className="py-12 text-center text-sm text-gray-400">Checking the commission on every booking…</div>

  const noBroker = (data?.live || 0) - (data?.withBroker || 0)

  return (
    <div className="space-y-3">
      {/* The one sentence that says where things stand. */}
      <div className="rounded-xl border border-gray-200 bg-white p-4">
        <div className="text-lg font-semibold text-gray-900">
          {data?.willPay || 0} of {data?.live || 0} live bookings will pay somebody
        </div>
        <p className="text-xs text-gray-500 mt-1">
          A booking pays nobody unless three things are true: a broker on it, a payment that is
          <b> verified</b>, and a commission actually set. {noBroker > 0 && (
            <>
              {' '}<b>{noBroker}</b> {noBroker === 1 ? 'booking has' : 'bookings have'} no broker at all —
              those are on the <Link to="/record-health" className="text-blue-600 hover:underline">Bookings</Link> tab.
            </>
          )}
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {ISSUES.map(i => {
          const n = counts[i.key]
          const on = active === i.key
          return (
            <button key={i.key} onClick={() => { setActive(i.key); setLimit(100) }}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition ${
                on ? 'bg-gray-900 text-white border-gray-900'
                : n === 0 ? 'bg-white text-gray-400 border-gray-200'
                : i.severity === 'high' ? 'bg-rose-50 text-rose-700 border-rose-200 hover:bg-rose-100'
                : 'bg-amber-50 text-amber-800 border-amber-200 hover:bg-amber-100'}`}>
              {i.label} ({n})
            </button>
          )
        })}
      </div>

      <div className={`rounded-lg border px-3 py-2 text-xs ${meta.severity === 'high' ? 'border-rose-200 bg-rose-50 text-rose-900' : 'border-amber-200 bg-amber-50 text-amber-900'}`}>
        <div className="font-semibold flex items-center gap-1 mb-0.5"><AlertTriangle size={12}/>{meta.label}</div>
        {meta.why}
      </div>

      <div className="flex items-center gap-2">
        <div className="relative flex-1 max-w-xs">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400"/>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Booking, customer or broker…"
            className="w-full border border-gray-200 rounded-lg pl-8 pr-3 py-1.5 text-sm"/>
        </div>
        <span className="text-xs text-gray-500">{list.length} found</span>
        <button onClick={exportCsv} disabled={list.length === 0}
          className="ml-auto inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 disabled:opacity-40">
          <Download size={13}/>Export
        </button>
      </div>

      {list.length === 0 ? (
        <div className="py-12 text-center text-sm text-gray-500">
          Nothing here — no booking has this problem.
        </div>
      ) : (
        <div className="overflow-x-auto border border-gray-200 rounded-xl">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-[11px] uppercase tracking-wide text-gray-500">
              <tr>
                {['Booking', 'Customer', 'Broker', 'Mode', 'Value', 'What is wrong', ''].map(h => (
                  <th key={h} className="text-left px-4 py-2 font-semibold whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {list.slice(0, limit).map(r => (
                <tr key={r.id}>
                  <td className="px-4 py-2.5 font-mono text-xs text-gray-900">{r.booking_no || '—'}</td>
                  <td className="px-4 py-2.5 text-gray-900">{r.customer_name}</td>
                  <td className="px-4 py-2.5 text-gray-700">{r.broker_name}</td>
                  <td className="px-4 py-2.5 text-xs text-gray-500">{r.mode}</td>
                  <td className="px-4 py-2.5 tabular-nums"><Secret>{formatINR(r.total)}</Secret></td>
                  <td className="px-4 py-2.5 text-xs text-gray-600">{r.detail}</td>
                  <td className="px-4 py-2.5 text-right">
                    <Link to={`/bookings?q=${encodeURIComponent(r.booking_no || '')}`}
                      className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded bg-blue-50 hover:bg-blue-100 text-blue-700">
                      <ExternalLink size={11}/>Open
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {list.length > limit && (
            <button onClick={() => setLimit(l => l + 200)}
              className="w-full py-2 text-xs text-blue-700 hover:bg-gray-50">
              Show more ({list.length - limit} left)
            </button>
          )}
        </div>
      )}
    </div>
  )
}
