// Day Book — roz ka hisaab.
//
// Every real-estate office closes the day the same way: what came in, what went out, and
// does the cash in the drawer match.  This CRM recorded both sides — receipts on
// bp_payments, spend on expenses, broker payouts on withdrawals and payout cycles — but
// never put them on one page, so the evening tally was done on paper from four screens.
//
// Rules this page follows, because a day book that is off by one row is worse than none:
//   - Money IN counts VERIFIED receipts only.  A payment still awaiting verification may
//     yet be rejected (a bounced cheque, a wrong UTR); it is shown separately, not added.
//   - Money OUT is expenses + broker withdrawals paid + payout-cycle payments made.  The
//     two payout paths are separate settlements with a guard against paying the same
//     earnings twice (see PayoutCycles closeCycle), so adding both does not double-count.
//   - Each line is split Cash / Bank / Cheque by the same rule the Expenses page uses
//     (src/lib/paymentMode.ts), so the cash figure here is the one to count the drawer to.
//   - The day is the Indian calendar day.  Timestamps are stored in UTC, so a payout made
//     at 1 a.m. IST is filtered with the +05:30 offset rather than landing on yesterday.
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { formatINR } from '@/lib/utils'
import { modeBucket, BUCKET_LABEL, type ModeBucket } from '@/lib/paymentMode'
import {
  ChevronLeft, ChevronRight, Printer, ArrowDownLeft, ArrowUpRight, AlertTriangle,
  Banknote, Landmark, FileText, Scale,
} from 'lucide-react'

type Line = {
  id: string
  dir: 'in' | 'out'
  kind: string
  party: string
  ref: string
  mode: string
  bucket: ModeBucket
  amount: number
  sortKey: string
}

function isoDay(d: Date) {
  // Local calendar date, not toISOString(): that converts to UTC and turns IST mornings
  // into the previous day.
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), dd = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}
function shiftDay(day: string, by: number) {
  const [y, m, d] = day.split('-').map(Number)
  return isoDay(new Date(y, m - 1, d + by))
}
function prettyDay(day: string) {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(y, m - 1, d).toLocaleDateString('en-IN', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })
}

export default function DayBook() {
  const [day, setDay] = useState(isoDay(new Date()))
  const isToday = day === isoDay(new Date())

  const { data, isLoading } = useQuery({
    queryKey: ['day_book', day],
    queryFn: async () => {
      const next = shiftDay(day, 1)
      const dayStartIST = `${day}T00:00:00+05:30`
      const nextStartIST = `${next}T00:00:00+05:30`

      const [pay, exp, wd, ptx, heads] = await Promise.all([
        supabase.from('bp_payments')
          .select('id, amount, payment_mode, payment_type, verification_status, receipt_no, utr_ref, is_cash_adjustment, created_at, bp_bookings(booking_no, bp_customers(name))')
          .eq('payment_date', day),
        // '*' so the voucher number is picked up once its migration has run, without the
        // page failing on a column that does not exist yet.
        supabase.from('expenses').select('*').eq('expense_date', day),
        supabase.from('withdrawal_requests')
          .select('id, amount, net_amount, utr, paid_at, broker_id')
          .eq('status', 'paid').gte('paid_at', dayStartIST).lt('paid_at', nextStartIST),
        supabase.from('bp_payout_transactions')
          .select('id, amount, net_amount, payment_mode, utr_ref, paid_date, broker_id')
          .eq('status', 'paid').eq('paid_date', day),
        supabase.from('expense_heads').select('id, name'),
      ])

      const brokerIds = Array.from(new Set([
        ...((wd.data || []) as any[]).map(r => r.broker_id),
        ...((ptx.data || []) as any[]).map(r => r.broker_id),
      ].filter(Boolean)))
      const brokerById: Record<string, any> = {}
      if (brokerIds.length) {
        const { data: brks } = await supabase.from('brokers').select('id, name, broker_id').in('id', brokerIds)
        for (const b of ((brks || []) as any[])) brokerById[b.id] = b
      }
      const headById: Record<string, string> = {}
      for (const h of ((heads.data || []) as any[])) headById[h.id] = h.name

      // Any query that failed is reported, not swallowed: a day book that silently drops
      // the expenses side would show a profit that is not there.
      const failed = [pay, exp, wd, ptx].filter(r => r.error).map(r => r.error?.message)

      return {
        payments: (pay.data || []) as any[],
        expenses: (exp.data || []) as any[],
        withdrawals: (wd.data || []) as any[],
        payoutTxns: (ptx.data || []) as any[],
        brokerById, headById, failed,
      }
    },
  })

  const view = useMemo(() => {
    const lines: Line[] = []
    const pending: any[] = []
    if (!data) return { lines, pending }

    for (const p of data.payments) {
      if (p.verification_status !== 'verified') { pending.push(p); continue }
      lines.push({
        id: 'p' + p.id, dir: 'in',
        kind: `Receipt · ${(p.payment_type || 'payment').replace(/_/g, ' ')}`,
        party: p.bp_bookings?.bp_customers?.name || '—',
        ref: [p.receipt_no, p.bp_bookings?.booking_no, p.utr_ref].filter(Boolean).join(' · ') || '—',
        // The channel follows the recorded payment mode, the same as on the Payments page;
        // a "cash adjustment" flag only changes the label, not which drawer it counts in.
        mode: p.is_cash_adjustment ? `${p.payment_mode || 'cash'} (adj)` : (p.payment_mode || '—'),
        bucket: modeBucket(p.payment_mode),
        amount: Number(p.amount || 0),
        sortKey: p.created_at || '',
      })
    }
    for (const e of data.expenses) {
      lines.push({
        id: 'e' + e.id, dir: 'out',
        kind: `Expense · ${data.headById[e.head_id] || 'uncategorised'}`,
        party: e.paid_to || e.item_name || '—',
        ref: [e.voucher_no, e.item_name, e.reference_no].filter(Boolean).join(' · ') || '—',
        mode: e.payment_mode || '—',
        bucket: modeBucket(e.payment_mode),
        amount: Number(e.amount || 0),
        sortKey: e.created_at || '',
      })
    }
    for (const w of data.withdrawals) {
      const b = data.brokerById[w.broker_id]
      lines.push({
        id: 'w' + w.id, dir: 'out',
        kind: 'Broker withdrawal paid',
        party: b ? `${b.name || '—'}${b.broker_id ? ` [${b.broker_id}]` : ''}` : '—',
        ref: w.utr || '—',
        mode: 'bank',
        bucket: 'bank',
        // What actually left the account is the net, after TDS and admin charge.
        amount: Number(w.net_amount ?? w.amount ?? 0),
        sortKey: w.paid_at || '',
      })
    }
    for (const t of data.payoutTxns) {
      const b = data.brokerById[t.broker_id]
      lines.push({
        id: 't' + t.id, dir: 'out',
        kind: 'Payout cycle paid',
        party: b ? `${b.name || '—'}${b.broker_id ? ` [${b.broker_id}]` : ''}` : '—',
        ref: t.utr_ref || '—',
        mode: t.payment_mode || 'bank',
        bucket: modeBucket(t.payment_mode || 'bank'),
        amount: Number(t.net_amount ?? t.amount ?? 0),
        sortKey: t.paid_date || '',
      })
    }
    lines.sort((a, b) => a.sortKey.localeCompare(b.sortKey))
    return { lines, pending }
  }, [data])

  const totals = useMemo(() => {
    const by = (dir: 'in' | 'out', bucket?: ModeBucket) =>
      view.lines.filter(l => l.dir === dir && (!bucket || l.bucket === bucket)).reduce((s, l) => s + l.amount, 0)
    const buckets: ModeBucket[] = ['cash', 'bank', 'cheque']
    return {
      inAll: by('in'), outAll: by('out'),
      rows: buckets.map(b => ({ bucket: b, in: by('in', b), out: by('out', b), net: by('in', b) - by('out', b) })),
      pendingAmt: view.pending.reduce((s, p) => s + Number(p.amount || 0), 0),
    }
  }, [view])

  const net = totals.inAll - totals.outAll
  const cashRow = totals.rows.find(r => r.bucket === 'cash')!

  const printBook = () => {
    const rowsHtml = view.lines.map(l => `
      <tr>
        <td>${l.dir === 'in' ? 'IN' : 'OUT'}</td>
        <td>${l.kind}</td>
        <td>${l.party}</td>
        <td>${l.ref}</td>
        <td>${(l.mode || '').toUpperCase()}</td>
        <td class="num ${l.dir}">${l.dir === 'in' ? '' : '− '}${formatINR(l.amount)}</td>
      </tr>`).join('')
    const sumRows = totals.rows.map(r => `
      <tr><td>${BUCKET_LABEL[r.bucket]}</td><td class="num in">${formatINR(r.in)}</td><td class="num out">${formatINR(r.out)}</td><td class="num"><b>${formatINR(r.net)}</b></td></tr>`).join('')
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"/><title>Day Book ${day}</title>
<style>
  @page{size:A4;margin:12mm}
  body{font-family:'Helvetica Neue',Arial,sans-serif;color:#0f172a;font-size:11px}
  h1{font-size:18px;margin:0}
  .sub{color:#64748b;font-size:11px;margin:2px 0 12px}
  table{width:100%;border-collapse:collapse;margin-top:8px}
  th,td{border-bottom:1px solid #e2e8f0;padding:5px 6px;text-align:left}
  th{background:#f1f5f9;font-size:10px;text-transform:uppercase;letter-spacing:.4px;color:#475569}
  .num{text-align:right;font-variant-numeric:tabular-nums}
  .in{color:#047857}.out{color:#b91c1c}
  .tot td{font-weight:700;border-top:2px solid #0f172a}
  .warn{margin-top:10px;padding:6px 8px;background:#fffbeb;border:1px solid #fde68a;color:#92400e}
  .sig{display:flex;gap:30px;margin-top:40px}.sig div{flex:1;border-top:1px solid #0f172a;padding-top:4px;text-align:center;color:#475569}
  .toolbar{margin-bottom:12px}@media print{.toolbar{display:none}}
</style></head><body>
  <div class="toolbar"><button onclick="window.print()">Print</button></div>
  <h1>FANBE DEVELOPERS — Day Book</h1>
  <div class="sub">${prettyDay(day)}</div>
  <table><thead><tr><th>Channel</th><th class="num">In</th><th class="num">Out</th><th class="num">Net</th></tr></thead>
    <tbody>${sumRows}
    <tr class="tot"><td>Total</td><td class="num in">${formatINR(totals.inAll)}</td><td class="num out">${formatINR(totals.outAll)}</td><td class="num">${formatINR(net)}</td></tr></tbody></table>
  ${totals.pendingAmt > 0 ? `<div class="warn">${view.pending.length} receipt(s) worth ${formatINR(totals.pendingAmt)} are awaiting verification and are NOT counted above.</div>` : ''}
  <table><thead><tr><th>In/Out</th><th>Type</th><th>Party</th><th>Reference</th><th>Mode</th><th class="num">Amount</th></tr></thead>
    <tbody>${rowsHtml || '<tr><td colspan="6" style="text-align:center;color:#94a3b8;padding:16px">No entries on this day</td></tr>'}</tbody></table>
  <div class="sig"><div>Prepared by</div><div>Cash counted by</div><div>Authorised Signatory</div></div>
  <script>window.onload=()=>setTimeout(()=>window.print(),200)</script>
</body></html>`
    const w = window.open('', '_blank', 'width=900,height=1100')
    if (w) { w.document.write(html); w.document.close() }
  }

  const BUCKET_ICON: Record<ModeBucket, any> = { cash: Banknote, bank: Landmark, cheque: FileText }

  return (
    <div className="p-4 md:p-8 space-y-5">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Day Book</h1>
          <p className="text-sm text-gray-500 mt-0.5">What came in, what went out, and the cash the drawer should hold — for one day.</p>
        </div>
        <button onClick={printBook} disabled={isLoading}
          className="inline-flex items-center gap-1.5 text-sm px-3 py-2 rounded-lg bg-gray-900 text-white hover:bg-black disabled:opacity-40">
          <Printer size={14}/>Print day book
        </button>
      </div>

      {/* Day navigation */}
      <div className="flex items-center gap-2 flex-wrap">
        <button onClick={() => setDay(shiftDay(day, -1))} className="p-2 rounded-lg border border-gray-200 bg-white hover:border-gray-400" title="Previous day"><ChevronLeft size={16}/></button>
        <input type="date" value={day} onChange={e => e.target.value && setDay(e.target.value)}
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white"/>
        <button onClick={() => setDay(shiftDay(day, 1))} disabled={isToday}
          className="p-2 rounded-lg border border-gray-200 bg-white hover:border-gray-400 disabled:opacity-30" title="Next day"><ChevronRight size={16}/></button>
        {!isToday && (
          <button onClick={() => setDay(isoDay(new Date()))} className="text-sm px-3 py-2 rounded-lg border border-gray-200 bg-white hover:border-gray-400">Today</button>
        )}
        <span className="text-sm text-gray-600 ml-1">{prettyDay(day)}</span>
      </div>

      {data?.failed && data.failed.length > 0 && (
        <div className="p-3 rounded-lg bg-red-50 border border-red-200 text-sm text-red-800 flex items-start gap-2">
          <AlertTriangle size={14} className="mt-0.5 shrink-0"/>
          Part of this day book did not load ({data.failed.join('; ')}). The totals below are incomplete — do not tally against them.
        </div>
      )}

      {isLoading ? (
        <div className="py-16 text-center text-sm text-gray-400">Loading the day…</div>
      ) : (
        <>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="rounded-xl border border-emerald-200 bg-emerald-50/50 p-4">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-emerald-800"><ArrowDownLeft size={13}/>Money in</div>
              <div className="text-2xl font-bold text-emerald-900 mt-1 tabular-nums">{formatINR(totals.inAll)}</div>
              <div className="text-[11px] text-emerald-700">{view.lines.filter(l => l.dir === 'in').length} verified receipt(s)</div>
            </div>
            <div className="rounded-xl border border-red-200 bg-red-50/50 p-4">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-red-800"><ArrowUpRight size={13}/>Money out</div>
              <div className="text-2xl font-bold text-red-900 mt-1 tabular-nums">{formatINR(totals.outAll)}</div>
              <div className="text-[11px] text-red-700">{view.lines.filter(l => l.dir === 'out').length} payment(s) made</div>
            </div>
            <div className={`rounded-xl border p-4 ${net >= 0 ? 'border-blue-200 bg-blue-50/50' : 'border-amber-200 bg-amber-50/50'}`}>
              <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-gray-700"><Scale size={13}/>Net for the day</div>
              <div className={`text-2xl font-bold mt-1 tabular-nums ${net >= 0 ? 'text-blue-900' : 'text-amber-900'}`}>{formatINR(net)}</div>
              <div className="text-[11px] text-gray-600">in − out</div>
            </div>
          </div>

          {/* The cash line is what the drawer gets counted against at closing. */}
          <div className="rounded-xl border-2 border-gray-900 bg-white p-4 flex flex-wrap items-center gap-4">
            <Banknote size={22} className="text-gray-900"/>
            <div className="flex-1 min-w-[200px]">
              <div className="text-sm font-semibold text-gray-900">Cash movement today</div>
              <div className="text-[12px] text-gray-500">Cash received {formatINR(cashRow.in)} − cash paid out {formatINR(cashRow.out)}. Count the drawer against this.</div>
            </div>
            <div className={`text-2xl font-bold tabular-nums ${cashRow.net >= 0 ? 'text-gray-900' : 'text-red-700'}`}>{formatINR(cashRow.net)}</div>
          </div>

          {totals.pendingAmt > 0 && (
            <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-sm text-amber-900 flex items-start gap-2">
              <AlertTriangle size={14} className="mt-0.5 shrink-0"/>
              <span>
                <b>{view.pending.length}</b> receipt{view.pending.length === 1 ? '' : 's'} worth <b>{formatINR(totals.pendingAmt)}</b> {view.pending.length === 1 ? 'is' : 'are'} awaiting verification
                and {view.pending.length === 1 ? 'is' : 'are'} not counted above — a cheque or transfer is not money until it is confirmed.
              </span>
            </div>
          )}

          {/* By channel */}
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>{['Channel', 'In', 'Out', 'Net'].map(h => (
                  <th key={h} className={`px-4 py-2.5 text-[11px] font-semibold text-gray-500 uppercase tracking-wide ${h === 'Channel' ? 'text-left' : 'text-right'}`}>{h}</th>
                ))}</tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {totals.rows.map(r => {
                  const Icon = BUCKET_ICON[r.bucket]
                  return (
                    <tr key={r.bucket}>
                      <td className="px-4 py-2.5 font-medium text-gray-900"><span className="inline-flex items-center gap-1.5"><Icon size={13} className="text-gray-500"/>{BUCKET_LABEL[r.bucket]}</span></td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-emerald-700">{formatINR(r.in)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums text-red-700">{formatINR(r.out)}</td>
                      <td className="px-4 py-2.5 text-right tabular-nums font-semibold">{formatINR(r.net)}</td>
                    </tr>
                  )
                })}
                <tr className="bg-gray-50 font-bold">
                  <td className="px-4 py-2.5">Total</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-emerald-700">{formatINR(totals.inAll)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-red-700">{formatINR(totals.outAll)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{formatINR(net)}</td>
                </tr>
              </tbody>
            </table>
          </div>

          {/* Every entry */}
          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-100">
              <h2 className="text-sm font-semibold text-gray-900">Every entry · {view.lines.length}</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>{['', 'Type', 'Party', 'Reference', 'Mode', 'Amount'].map(h => (
                    <th key={h} className={`px-4 py-2.5 text-[11px] font-semibold text-gray-500 uppercase tracking-wide ${h === 'Amount' ? 'text-right' : 'text-left'}`}>{h}</th>
                  ))}</tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {view.lines.length === 0 && (
                    <tr><td colSpan={6} className="px-4 py-10 text-center text-sm text-gray-400">Nothing was received or paid on this day.</td></tr>
                  )}
                  {view.lines.map(l => (
                    <tr key={l.id} className="hover:bg-gray-50/60">
                      <td className="px-4 py-2.5">
                        {l.dir === 'in'
                          ? <ArrowDownLeft size={14} className="text-emerald-600"/>
                          : <ArrowUpRight size={14} className="text-red-600"/>}
                      </td>
                      <td className="px-4 py-2.5 text-xs text-gray-700 capitalize">{l.kind}</td>
                      <td className="px-4 py-2.5 text-gray-900">{l.party}</td>
                      <td className="px-4 py-2.5 text-xs text-gray-500 font-mono">{l.ref}</td>
                      <td className="px-4 py-2.5 text-xs uppercase text-gray-600">{l.mode}</td>
                      <td className={`px-4 py-2.5 text-right tabular-nums font-semibold ${l.dir === 'in' ? 'text-emerald-700' : 'text-red-700'}`}>
                        {l.dir === 'out' ? '− ' : ''}{formatINR(l.amount)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
