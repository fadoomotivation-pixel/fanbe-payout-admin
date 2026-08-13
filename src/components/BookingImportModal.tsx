// Bulk import of OLD bookings from Excel / Google Sheets.
//
// Admin: "booking ka bhi bana do jo purani booking admin daal de -- plot no, project,
// size, name, number, father name etc."
//
// This one touches five tables at once (customer, booking, booking↔plots, payment, plot
// status), so the rules below are the difference between a clean history import and a
// very expensive mess:
//
//   * COMMISSION.  recompute_booking_payouts() pays on every *verified* payment of a
//     booking that has a broker.  Import a year of history with receipts attached and
//     the engine would happily pay every broker all over again for deals settled long
//     ago.  So imported bookings are stamped commission_mode='traditional' with
//     traditional_commission_pct = 0 and pay_upline = false: direct_pct comes out 0, the
//     `IF direct_pct > 0` guard skips the payout row, and the cascade is off.  That holds
//     permanently -- later recomputes re-derive 0, they don't "remember" a one-off skip.
//     Admin can opt into normal commission per import run when the deals really are new.
//
//   * PAID / BALANCE.  The app reads collected money from verified bp_payments rows, not
//     from columns on the booking, so an "amount received" is written as one opening
//     receipt.  Skip it and every imported booking would read as fully unpaid.
//
//   * PLOTS.  A plot can only belong to one booking, so a plot already used earlier in
//     the sheet, or already sitting on a booking, is refused rather than double-sold.
//
//   * CUSTOMERS.  Matched on phone AND name together.  Phone alone is not an identity:
//     sheets are full of placeholders like 9999999999, and matching on one of those
//     merged eight different buyers onto a single customer -- who happened to be a
//     broker, so every booking number inherited their FNB code as well.  A placeholder
//     number, or a real number already on file under a different name, means a fresh
//     customer record and a warning.
import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { Modal } from '@/components/ui/Modal.tsx'
import { Button } from '@/components/ui/Button.tsx'
import { Select } from '@/components/ui/Input.tsx'
import { formatINR } from '@/lib/utils'
import { ClipboardPaste, AlertTriangle, CheckCircle2, Download, Info } from 'lucide-react'
import toast from 'react-hot-toast'

const COLUMNS = [
  'booking_no', 'booking_date', 'project', 'plot_no', 'size_sqyd', 'rate_per_sqyd',
  'customer_name', 'phone', 'father_name', 'address', 'pan', 'broker_code',
  'amount_received', 'total_amount',
] as const
type Col = typeof COLUMNS[number]

const digitsOnly = (s: string) => (s || '').replace(/\D/g, '')

// A phone is only an identity if it is actually a phone.  Sheets are full of
// placeholders — 9999999999, 0000000000, 1234567890 — and matching on those merges
// unrelated buyers into one customer record.  Anything under 10 digits, or made of a
// single repeated digit, or plainly sequential, is treated as "no phone given".
const PLACEHOLDER_PHONES = new Set(['1234567890', '0123456789', '9876543210'])
const isRealPhone = (p: string) =>
  p.length >= 10 && !/^(\d)\1+$/.test(p) && !PLACEHOLDER_PHONES.has(p)

// Two names are the same person if they normalise equal, or one clearly contains the
// other ("RAJESH KUMAR" vs "RAJESH KUMAR/SUNITA").  Anything else is a different buyer.
const nameKey = (s: string) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '')
const namesMatch = (a: string, b: string) => {
  const x = nameKey(a), y = nameKey(b)
  if (!x || !y) return false
  return x === y || x.includes(y) || y.includes(x)
}
const num = (s: string) => Number(String(s || '').replace(/[₹,\s]/g, '')) || 0
const norm = (s: string) => (s || '').trim().toLowerCase()

function parseDate(raw: string): string | null {
  const s = (raw || '').trim()
  if (!s) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  const m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/)
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`
  return null
}

type Row = {
  line: number
  booking_no: string
  booking_date: string | null
  project_id: string | null
  project_name: string
  plot_id: string | null
  plot_no: string
  size_sqyd: number
  rate_per_sqyd: number
  total: number
  customer_id: string | null   // existing customer matched on phone
  customer_name: string
  phone: string
  father_name: string
  address: string
  pan: string
  broker_id: string | null
  amount_received: number
  warnings: string[]
}

export default function BookingImportModal({ open, onClose, onImported }: {
  open: boolean
  onClose: () => void
  onImported: () => void
}) {
  const [text, setText] = useState('')
  const [stage, setStage] = useState<'booking_done' | 'token_received'>('booking_done')
  const [payCommission, setPayCommission] = useState(false)
  const [saving, setSaving] = useState(false)
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [result, setResult] = useState<{ ok: number; failed: { line: number; who: string; reason: string }[] } | null>(null)

  const { data: ref } = useQuery({
    queryKey: ['booking_import_ref'],
    enabled: open,
    queryFn: async () => {
      // Plots are paged: the bigger schemes hold more rows than one PostgREST response
      // returns, and a missing tail would show up as "plot not found" on valid rows.
      const PAGE = 1000
      const plots: any[] = []
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await supabase
          .from('bp_plots').select('id, plot_no, project_id, size_sqyd, price_per_sqyd, status')
          .order('plot_no').range(from, from + PAGE - 1)
        if (error) throw error
        plots.push(...(data || []))
        if (!data || data.length < PAGE) break
      }
      const [projects, customers, brokers, bookings] = await Promise.all([
        supabase.from('bp_projects').select('id, name'),
        supabase.from('bp_customers').select('id, name, phone'),
        supabase.from('brokers').select('id, broker_id, name'),
        supabase.from('bp_bookings').select('legacy_booking_no, plot_id'),
      ])
      return {
        plots,
        projects: projects.data || [],
        customers: customers.data || [],
        brokers: brokers.data || [],
        bookings: bookings.data || [],
      }
    },
  })

  const parsed = useMemo<Row[]>(() => {
    if (!ref) return []
    const lines = text.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'))
    if (lines.length === 0) return []
    const first = lines[0].toLowerCase()
    const body = (first.includes('plot') && (first.includes('project') || first.includes('name')))
      ? lines.slice(1) : lines

    const projectByName = new Map(ref.projects.map((p: any) => [norm(p.name), p]))
    const custByPhone   = new Map(
      ref.customers.map((c: any) => [digitsOnly(c.phone || ''), c]).filter(([k]: any) => isRealPhone(k)),
    )
    const brokerByCode  = new Map(ref.brokers.map((b: any) => [norm(b.broker_id), b]))
    const plotsByKey    = new Map<string, any>()
    for (const p of ref.plots) plotsByKey.set(`${p.project_id}|${norm(p.plot_no)}`, p)

    const takenPlots = new Set(ref.bookings.map((b: any) => b.plot_id).filter(Boolean))
    const takenNos   = new Set(ref.bookings.map((b: any) => norm(b.legacy_booking_no)).filter(Boolean))
    const seenPlots  = new Set<string>()
    const seenNos    = new Set<string>()

    return body.map((line, i) => {
      const cells = (line.includes('\t') ? line.split('\t') : line.split(',')).map(c => c.trim())
      const get = (k: Col) => cells[COLUMNS.indexOf(k)] || ''
      // NOTHING blocks a row.  Admin wants years of history in fast and will correct it
      // inside the app, so a missing or unmatched value is imported as a gap and
      // reported — never refused.  The one thing that is never guessed is the plot
      // link: an unmatched or already-sold plot is left off the booking rather than
      // risking the same plot sitting on two bookings.
      const warnings: string[] = []

      const booking_no    = get('booking_no')
      const rawDate       = get('booking_date')
      const project_name  = get('project')
      const plot_no       = get('plot_no')
      let   customer_name = get('customer_name')
      const phone         = digitsOnly(get('phone'))
      const broker_code   = get('broker_code')

      // bp_customers.name is NOT NULL — a searchable placeholder beats losing the row.
      if (!customer_name) { customer_name = 'NAME MISSING'; warnings.push('No customer name — saved as "NAME MISSING"') }
      if (!phone) warnings.push('No phone — this booking gets its own customer record')
      else if (phone.length < 10) warnings.push(`Phone ${phone} is shorter than 10 digits`)

      const booking_date = parseDate(rawDate)
      if (rawDate && !booking_date) warnings.push(`Date "${rawDate}" not understood — left blank`)

      // Project → plot.  Plot numbers repeat across schemes, so the plot is only ever
      // looked up inside its own project.
      const project = project_name ? projectByName.get(norm(project_name)) : null
      if (!project_name) warnings.push('No project — add it on the booking later')
      else if (!project) warnings.push(`Project "${project_name}" not found — imported without a project`)

      let plot: any = null
      if (project && plot_no) {
        const found = plotsByKey.get(`${project.id}|${norm(plot_no)}`)
        if (!found) warnings.push(`Plot "${plot_no}" not found in ${project_name} — imported without a plot`)
        else if (seenPlots.has(found.id)) warnings.push(`Plot ${plot_no} is used twice in this sheet — left off this booking`)
        else if (takenPlots.has(found.id)) warnings.push(`Plot ${plot_no} is already on another booking — left off this one`)
        else { plot = found; seenPlots.add(found.id) }
      } else if (plot_no && !project) {
        warnings.push(`Plot "${plot_no}" needs a matching project before it can be linked`)
      } else if (project && !plot_no) {
        warnings.push('No plot no — add it on the booking later')
      }

      if (booking_no) {
        const k = norm(booking_no)
        if (seenNos.has(k) || takenNos.has(k)) warnings.push(`Old register no ${booking_no} appears more than once — imported anyway, so check these`)
        else seenNos.add(k)

      }

      let broker: any = null
      if (broker_code) {
        broker = brokerByCode.get(norm(broker_code))
        if (!broker) warnings.push(`Broker code "${broker_code}" not found — imported without a broker`)
      }

      // Sizes fall back to the plot's own figures when the sheet leaves them out.
      const size_sqyd     = num(get('size_sqyd'))     || Number(plot?.size_sqyd || 0)
      const rate_per_sqyd = num(get('rate_per_sqyd')) || Number(plot?.price_per_sqyd || 0)
      const total         = num(get('total_amount'))  || Math.round(size_sqyd * rate_per_sqyd)
      if (total <= 0) warnings.push('No value yet — add Size + Rate or a Total on the booking later')

      const amount_received = num(get('amount_received'))
      if (amount_received > total && total > 0) {
        warnings.push(`Received ${formatINR(amount_received)} is more than the total ${formatINR(total)}`)
      }

      // Reuse an existing customer ONLY when the phone is a real one AND the name agrees.
      // Matching on the phone alone is what merged eight different buyers into a single
      // record: they all carried 9999999999 in the sheet, so every booking landed on the
      // one customer who already had that number — and because that customer was also a
      // broker, the booking numbers inherited their FNB code too.
      let existingCust: any = null
      if (isRealPhone(phone)) {
        const candidate = custByPhone.get(phone)
        if (candidate && namesMatch(candidate.name, customer_name)) {
          existingCust = candidate
        } else if (candidate) {
          warnings.push(`Phone ${phone} is already on file for "${candidate.name}" — a separate customer was created for ${customer_name}`)
        }
      } else if (phone) {
        warnings.push(`${phone} looks like a placeholder, not a real number — this booking gets its own customer record`)
      }

      return {
        line: i + 1, booking_no, booking_date,
        project_id: project?.id || null, project_name,
        plot_id: plot?.id || null, plot_no,
        size_sqyd, rate_per_sqyd, total,
        customer_id: existingCust?.id || null, customer_name, phone,
        father_name: get('father_name'), address: get('address'), pan: get('pan').toUpperCase(),
        broker_id: broker?.id || null,
        amount_received, warnings,
      }
    })
  }, [text, ref])

  // Every parsed row imports — the counts below are "clean" vs "imported with gaps".
  const valid   = parsed
  const invalid = parsed.filter(r => r.warnings.length > 0)

  const runImport = async () => {
    if (valid.length === 0) return
    setSaving(true); setResult(null); setProgress({ done: 0, total: valid.length })
    const failed: { line: number; who: string; reason: string }[] = []
    let ok = 0
    // Phones created during THIS run, so the same buyer appearing on two rows gets one
    // customer record rather than a duplicate.
    const createdCustomers = new Map<string, string>()

    for (const r of valid) {
      try {
        // Same rule inside the run: only a real phone can identify a repeat buyer, so
        // several rows sharing a placeholder number stay separate people.
        const cacheKey = isRealPhone(r.phone) ? `${r.phone}|${nameKey(r.customer_name)}` : ''
        let customer_id = r.customer_id || (cacheKey ? createdCustomers.get(cacheKey) : null) || null
        if (!customer_id) {
          const { data: c, error: cErr } = await supabase.from('bp_customers').insert({
            name: r.customer_name,
            // NOT NULL on bp_customers.  An empty string satisfies it, and blank phones
            // are excluded from the match map, so two phone-less rows never collapse
            // into one customer.
            phone: r.phone || '',
            father_or_husband_name: r.father_name || null,
            address: r.address || null,
            pan: r.pan || null,
          }).select('id').single()
          if (cErr || !c) throw cErr || new Error('Could not create the customer')
          customer_id = c.id
          if (cacheKey) createdCustomers.set(cacheKey, customer_id)
        }

        const { data: bk, error: bErr } = await supabase.from('bp_bookings').insert({
          // The register number goes in its OWN column.  Putting it in booking_no used to
          // replace the system id, so one imported row read "341" while every other row
          // read "CR-0010" -- two kinds of identifier in one column.  booking_no is left
          // blank here so generate_booking_no() issues the usual CR-xxxx.
          legacy_booking_no: r.booking_no || null,
          customer_id,
          plot_id: r.plot_id,
          project_id: r.project_id,
          broker_id: r.broker_id,
          stage,
          size_sqyd: r.size_sqyd || null,
          rate_per_sqyd: r.rate_per_sqyd || null,
          base_price: Math.round(r.size_sqyd * r.rate_per_sqyd) || null,
          dev_charges: 0, plc_charges: 0, discount_amount: 0,
          plot_total_price: r.total || null, total_amount: r.total || null,
          application_date: r.booking_date,
          // See the header note: 0% traditional means recompute_booking_payouts() derives
          // direct_pct = 0 and inserts nothing, now and on every future recompute.
          ...(payCommission
            ? { commission_mode: 'mlm' }
            : { commission_mode: 'traditional', traditional_commission_pct: 0, traditional_pay_upline: false }),
          notes: 'Imported from the old records sheet',
        }).select('id').single()
        if (bErr || !bk) throw bErr || new Error('Could not create the booking')

        if (r.plot_id) {
          await supabase.from('bp_booking_plots').insert({ booking_id: bk.id, plot_id: r.plot_id, position: 1 })
          await supabase.from('bp_plots')
            .update({ status: stage === 'token_received' ? 'token' : 'booked' })
            .eq('id', r.plot_id).neq('status', 'registry_done')
        }

        // One opening receipt so Paid / Balance read correctly — the app sums verified
        // bp_payments, it does not read the booking's own amount columns.
        if (r.amount_received > 0) {
          const { error: pErr } = await supabase.from('bp_payments').insert({
            booking_id: bk.id, customer_id,
            payment_type: 'booking', amount: r.amount_received, payment_mode: 'cash',
            payment_date: r.booking_date || new Date().toISOString().slice(0, 10),
            verification_status: 'verified', verified_at: new Date().toISOString(),
            drawn_on_bank: 'Cash',
            notes: 'Opening balance — imported from the old records sheet',
          })
          if (pErr) throw new Error(`Booking saved, but the received amount could not be recorded: ${pErr.message}`)
        }

        ok++
      } catch (e: any) {
        failed.push({ line: r.line, who: `${r.customer_name} / ${r.plot_no}`, reason: e?.message || String(e) })
      }
      setProgress(p => ({ ...p, done: p.done + 1 }))
    }

    setSaving(false)
    setResult({ ok, failed })
    if (ok > 0) { onImported(); toast.success(`${ok} booking${ok === 1 ? '' : 's'} imported`) }
    if (failed.length > 0) toast.error(`${failed.length} row(s) could not be saved`)
  }

  const close = () => { setText(''); setResult(null); setProgress({ done: 0, total: 0 }); onClose() }

  const downloadTemplate = () => {
    const csv = [
      'Old Booking No,Booking Date,Project,Plot No,Size (sqyd),Rate per sqyd,Customer Name,Phone,Father/Husband Name,Address,PAN,Broker Code,Amount Received,Total Amount',
      '# --- Lines starting with # are examples/notes. Delete them, or remove the # to import that row. ---',
      '# OLD-101,15/07/2023,BRIJ VATIKA,A-101,100,5000,RAJESH KUMAR,9811100011,SHYAM KUMAR,"Ballabgarh, Faridabad",ABCPK1234A,TR805,200000,500000',
      '# ,01/04/2024,SHREE GOKUL VATIKA,B-22,,,SUNITA DEVI,9811100012,RAM DEVI,,,,,',
      '#',
      '# Nothing is compulsory - fill in whatever you have and correct the rest in the app later.',
      '# The more you fill, the less there is to fix: Project + Plot No link the plot,',
      '#   Size + Rate (or Total Amount) set the value, Phone links repeat customers.',
      '# Old Booking No : the number from your paper register. It is kept and shown next to',
      '#                  the system id (CR-0011) - it does not replace it. Leave blank if none.',
      '# Project        : must match the name on the Projects page exactly.',
      '# Plot No        : must exist in that project and must not already be on a booking.',
      '# Phone          : 10 digits. Same phone on two rows = one customer with two bookings.',
      '# Broker Code    : optional, e.g. TR805 or FNB05012. Leave blank if there was no broker.',
      '# Amount Received: money already collected. Recorded as one opening receipt.',
      '# Date           : dd/mm/yyyy, dd-mm-yyyy or yyyy-mm-dd.',
      '',
    ].join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }))
    const a = document.createElement('a')
    a.href = url; a.download = 'booking-import-template.csv'; a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <Modal open={open} onClose={close} title="Import old bookings from Excel" size="xl">
      <div className="space-y-3">
        <div className="text-sm text-gray-600">
          Paste the rows straight out of Excel or Google Sheets — one booking per line, in this column order:
        </div>
        <div className="font-mono text-[11px] bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-gray-700 overflow-x-auto whitespace-nowrap">
          Old Booking No → Date → Project → Plot No → Size → Rate/sqyd → Customer Name → Phone → Father/Husband → Address → PAN → Broker Code → Amount Received → Total
        </div>
        <div className="flex items-center gap-2 text-xs bg-emerald-50 border border-emerald-200 rounded-lg px-2.5 py-2">
          <span className="text-emerald-900 flex-1">
            Download the sample sheet, fill your old bookings into it, then copy the rows back here.
          </span>
          <button type="button" onClick={downloadTemplate}
            className="shrink-0 inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700">
            <Download size={13}/>Sample sheet
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Select label="Import these bookings at stage" value={stage} onChange={(e: any) => setStage(e.target.value)}>
            <option value="booking_done">Booking Done (completed deals)</option>
            <option value="token_received">Token Received</option>
          </Select>
          <label className="flex items-start gap-2 text-xs bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-2 cursor-pointer">
            <input type="checkbox" className="mt-0.5 rounded" checked={payCommission} onChange={e => setPayCommission(e.target.checked)} />
            <span className="text-amber-900">
              <b>Pay broker commission on these bookings</b><br/>
              Leave this OFF for old deals whose commission was already settled — otherwise the system would pay every broker again on the amounts you import.
            </span>
          </label>
        </div>

        <textarea
          value={text} onChange={e => setText(e.target.value)} rows={7} spellCheck={false}
          placeholder={'OLD-101\t15/07/2023\tBRIJ VATIKA\tA-101\t100\t5000\tRAJESH KUMAR\t9811100011\tSHYAM KUMAR\t\t\tTR805\t200000\t500000'}
          className="w-full font-mono text-xs border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />

        {!ref && open && <div className="text-xs text-gray-400">Loading projects, plots and customers…</div>}

        {parsed.length > 0 && (
          <>
            <div className="flex flex-wrap gap-3 text-xs">
              <span className="inline-flex items-center gap-1 text-emerald-700"><CheckCircle2 size={13}/><b>{valid.length}</b> will be imported</span>
              {invalid.length > 0 && <span className="inline-flex items-center gap-1 text-amber-700"><AlertTriangle size={13}/><b>{invalid.length}</b> with gaps — fix in the app afterwards</span>}
              <span className="text-gray-500">Total value {formatINR(valid.reduce((s, r) => s + r.total, 0))} · received {formatINR(valid.reduce((s, r) => s + r.amount_received, 0))}</span>
            </div>

            <div className="max-h-72 overflow-auto rounded-lg border border-gray-200">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 sticky top-0">
                  <tr>
                    {['#', 'Old No', 'Project / Plot', 'Customer', 'Phone', 'Total', 'Received', 'Broker', 'Status'].map(h => (
                      <th key={h} className="text-left px-2 py-1.5 font-semibold text-gray-500 whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {parsed.map(r => (
                    <tr key={r.line} className={r.warnings.length ? 'bg-amber-50/40' : ''}>
                      <td className="px-2 py-1 text-gray-400">{r.line}</td>
                      <td className="px-2 py-1 font-mono">{r.booking_no || <span className="text-gray-400">—</span>}</td>
                      <td className="px-2 py-1">{r.project_name || '—'} · <b>{r.plot_no || '—'}</b></td>
                      <td className="px-2 py-1">
                        {r.customer_name || '—'}
                        {r.customer_id && <span className="ml-1 text-[10px] text-blue-600">(existing)</span>}
                      </td>
                      <td className="px-2 py-1 font-mono">{r.phone || '—'}</td>
                      <td className="px-2 py-1 tabular-nums">{formatINR(r.total)}</td>
                      <td className="px-2 py-1 tabular-nums">{r.amount_received ? formatINR(r.amount_received) : '—'}</td>
                      <td className="px-2 py-1">{r.broker_id ? '✓' : '—'}</td>
                      <td className="px-2 py-1">
                        {r.warnings.length > 0
                          ? <span className="text-amber-700">{r.warnings.join('; ')}</span>
                          : <span className="text-emerald-700">OK</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {saving && progress.total > 0 && (
          <div className="text-xs text-gray-600">Importing {progress.done} of {progress.total}…</div>
        )}

        {result && (
          <div className={`text-xs rounded-lg px-3 py-2 border ${result.failed.length ? 'bg-amber-50 border-amber-200 text-amber-900' : 'bg-emerald-50 border-emerald-200 text-emerald-800'}`}>
            <div><b>{result.ok}</b> booking(s) imported.</div>
            {result.failed.length > 0 && (
              <div className="mt-1">
                <b>{result.failed.length}</b> could not be saved:
                <ul className="list-disc ml-4 mt-0.5">
                  {result.failed.slice(0, 8).map(f => <li key={f.line}>Line {f.line} ({f.who}): {f.reason}</li>)}
                </ul>
                {result.failed.length > 8 && <div className="mt-0.5">…and {result.failed.length - 8} more.</div>}
              </div>
            )}
          </div>
        )}

        <div className="text-[11px] text-gray-600 bg-blue-50 border border-blue-200 rounded-lg px-2.5 py-2 flex items-start gap-1.5">
          <Info size={13} className="mt-0.5 shrink-0 text-blue-700"/>
          <span>
            Each row creates the customer (or reuses one matched on phone), the booking, and — where an amount is given — one opening receipt so Paid and Balance read correctly. The plot is marked booked. EMI schedules and further payments can be added afterwards from the booking's Edit screen.
          </span>
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={close}>{result ? 'Done' : 'Cancel'}</Button>
          <Button onClick={runImport} loading={saving} disabled={valid.length === 0 || !ref}>
            <ClipboardPaste size={14}/>Import {valid.length} booking{valid.length === 1 ? '' : 's'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
