// Bulk import of OLD bookings from Excel / Google Sheets.
//
// The column order is admin's own sheet, not ours — they sent it as the thing the team
// already fills in, so the import reads that rather than asking the office to re-type
// years of history into a different shape:
//
//   id no | name | s/o | upline | mobile no | plot no | say | RATE | Project | booking date
//
// and two optional columns on the end that the sheet did not have yet: advance (money
// already collected) and commission % (what the deal pays in total).
//
// This one touches six tables at once (customer, booking, booking↔plots, booking↔brokers,
// payment, plot status), so the rules below are the difference between a clean history
// import and a very expensive mess:
//
//   * COMMISSION.  recompute_booking_payouts() pays on every *verified* payment of a
//     booking that has a broker.  Import a year of history with receipts attached and the
//     engine would happily pay every broker all over again for deals settled long ago.
//     So commission is OFF unless admin ticks it on for the run, and when off every
//     broker row is written at 0% — direct_pct and each split come out 0, the
//     `IF ... > 0` guards skip the payout rows, and later recomputes re-derive 0 rather
//     than "remembering" a one-off skip.  The uplines are still recorded, so the booking
//     shows who sold it.
//
//   * THE UPLINE COLUMN IS A SHARE, NOT A RATE.  "radheyshyam:50/shyam:30/jyoti:20" means
//     they split the commission 50/30/20 between them — it does NOT mean radheyshyam gets
//     50% of the sale value.  The deal's actual rate comes from the commission % column,
//     and each broker is stored at (total × share).  Reading those shares as rates would
//     hand three people half a plot each, so the two are kept firmly apart.
//
//   * NAMES, NOT CODES.  The sheet names uplines the way the office says them —
//     "satish kr", "nn pandey", "radheyshyam".  A name that matches more than one broker
//     is never guessed: it is reported and left off, because picking the wrong one quietly
//     pays the wrong person.
//
//   * PAID / BALANCE.  The app reads collected money from verified bp_payments rows, not
//     from columns on the booking, so "advance" is written as one opening receipt.  Skip
//     it and every imported booking would read as fully unpaid.
//
//   * PLOTS.  A plot can only belong to one booking, so a plot already used earlier in the
//     sheet, or already sitting on a booking, is refused rather than double-sold.
//
//   * CUSTOMERS.  Matched on phone AND name together.  Phone alone is not an identity:
//     sheets are full of placeholders like 9999999999, and matching on one of those merged
//     eight different buyers onto a single customer — who happened to be a broker, so every
//     booking number inherited their FNB code as well.
import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { Modal } from '@/components/ui/Modal.tsx'
import { Button } from '@/components/ui/Button.tsx'
import { Select } from '@/components/ui/Input.tsx'
import { formatINR } from '@/lib/utils'
import { ClipboardPaste, AlertTriangle, CheckCircle2, Download, Info } from 'lucide-react'
import toast from 'react-hot-toast'
import { saveBlob } from '@/lib/download'
import { makeBrokerFinder } from '@/lib/brokerMatch'

// Admin's sheet, in admin's order, plus the two optional columns on the end.
const COLUMNS = [
  'legacy_no', 'customer_name', 'father_name', 'upline', 'phone',
  'plot_no', 'size_sqyd', 'rate_per_sqyd', 'project', 'booking_date',
  'advance', 'commission_pct',
] as const
type Col = typeof COLUMNS[number]

const HEADER_LABELS = [
  'id no', 'name', 's/o', 'upline', 'mobile no',
  'plot no', 'say', 'RATE', 'Project', 'booking date',
  'advance', 'commission %',
]

const digitsOnly = (s: string) => (s || '').replace(/\D/g, '')

// A phone is only an identity if it is actually a phone.  Sheets are full of
// placeholders — 9999999999, 0000000000, 1234567890 — and matching on those merges
// unrelated buyers into one customer record.
const PLACEHOLDER_PHONES = new Set(['1234567890', '0123456789', '9876543210'])
const isRealPhone = (p: string) =>
  p.length >= 10 && !/^(\d)\1+$/.test(p) && !PLACEHOLDER_PHONES.has(p)

const nameKey = (s: string) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '')
const namesMatch = (a: string, b: string) => {
  const x = nameKey(a), y = nameKey(b)
  if (!x || !y) return false
  return x === y || x.includes(y) || y.includes(x)
}
const num = (s: string) => Number(String(s || '').replace(/[₹,\s]/g, '')) || 0
const norm = (s: string) => (s || '').trim().toLowerCase()

// "66sq" → 66.  "150(L)sq" → 150, and the (L) is kept as a note on the booking because
// the office writes it to mean the plot is on a corner/large side — it is not a number.
function parseSize(raw: string): { size: number; tag: string } {
  const s = String(raw || '').trim()
  const tag = /\(([^)]+)\)/.exec(s)?.[1] || ''
  return { size: Number(s.replace(/[^\d.]/g, '')) || 0, tag }
}

function parseDate(raw: string): string | null {
  const s = (raw || '').trim()
  if (!s) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s
  // dd-mm-yy and dd-mm-yyyy.  The sheet uses two-digit years ("30-01-26"), which are
  // 20xx: these are property bookings, not 1926.
  const m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})$/)
  if (!m) return null
  const [, d, mo, y] = m
  const year = y.length === 2 ? `20${y}` : y
  return `${year}-${mo.padStart(2, '0')}-${d.padStart(2, '0')}`
}

/**
 * Split the upline cell into brokers and their SHARE of the commission.
 *
 * "radheyshyam/shyam/jyoti"            → three equal shares (33.33 each)
 * "radheyshyam:50/shyam:30/jyoti:20"   → exactly those shares
 * "radheyshyam:50/shyam"               → 50, then the remaining 50 to shyam
 *
 * Shares always add to 100: what is written is honoured, and whatever is left over is
 * spread equally across the names that did not say.
 */
function parseUplines(raw: string): { name: string; share: number; explicit: boolean }[] {
  const parts = String(raw || '').split('/').map(p => p.trim()).filter(Boolean)
  if (parts.length === 0) return []
  const items = parts.map(p => {
    const m = p.match(/^(.*?)[\s:]*[:=]\s*([\d.]+)\s*%?$/)
    if (m && m[1].trim()) return { name: m[1].trim(), share: Number(m[2]) || 0, explicit: true }
    return { name: p, share: 0, explicit: false }
  })
  const explicitTotal = items.filter(i => i.explicit).reduce((s, i) => s + i.share, 0)
  const rest = items.filter(i => !i.explicit)
  if (rest.length > 0) {
    const left = Math.max(0, 100 - explicitTotal)
    const each = Math.round((left / rest.length) * 10000) / 10000
    rest.forEach(i => { i.share = each })
  }
  return items
}

const round4 = (n: number) => Math.round(n * 10000) / 10000

type UplineHit = { name: string; share: number; broker_id: string | null; matched_as: string }

type Row = {
  line: number
  legacy_no: string
  booking_date: string | null
  project_id: string | null
  project_name: string
  plot_id: string | null
  plot_no: string
  size_sqyd: number
  size_tag: string
  rate_per_sqyd: number
  total: number
  customer_id: string | null
  customer_name: string
  phone: string
  father_name: string
  uplines: UplineHit[]
  commission_pct: number
  advance: number
  warnings: string[]
  /** Set when the row must NOT be imported. A warning is a gap to fix later; this is a
      row that would make the books wrong, so it is left out entirely. */
  skip: string
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
    const lines = text.split('\n').map(l => l.replace(/\r$/, '')).filter(l => l.trim() && !l.trim().startsWith('#'))
    if (lines.length === 0) return []
    const first = lines[0].toLowerCase()
    const looksLikeHeader = first.includes('name') && (first.includes('plot') || first.includes('upline') || first.includes('id no'))
    const body = looksLikeHeader ? lines.slice(1) : lines

    const projectByName = new Map(ref.projects.map((p: any) => [norm(p.name), p]))
    const custByPhone = new Map<string, any>(
      ref.customers
        .map((c: any) => [digitsOnly(c.phone || ''), c] as [string, any])
        .filter(([k]: [string, any]) => isRealPhone(k)),
    )
    const plotsByKey = new Map<string, any>()
    for (const p of ref.plots) plotsByKey.set(`${p.project_id}|${norm(p.plot_no)}`, p)

    // Broker lookup by the name the office actually says -- same rule as the broker
    // import's sponsor column, so the two can never disagree.  See lib/brokerMatch.ts.
    const findBroker = makeBrokerFinder(ref.brokers as any[])

    const takenPlots = new Set(ref.bookings.map((b: any) => b.plot_id).filter(Boolean))
    const takenNos = new Set(ref.bookings.map((b: any) => norm(b.legacy_booking_no)).filter(Boolean))
    const seenPlots = new Set<string>()
    const seenNos = new Set<string>()

    return body.map((line, i) => {
      const cells = (line.includes('\t') ? line.split('\t') : line.split(',')).map(c => c.trim())
      const get = (k: Col) => cells[COLUMNS.indexOf(k)] || ''
      // NOTHING blocks a row.  Admin wants years of history in fast and will correct it
      // inside the app, so a missing or unmatched value is imported as a gap and
      // reported — never refused.  The one thing never guessed is the plot link: an
      // unmatched or already-sold plot is left off rather than double-selling it.
      const warnings: string[] = []

      const legacy_no = get('legacy_no')
      const rawDate = get('booking_date')
      const project_name = get('project')
      const plot_no = get('plot_no')
      let customer_name = get('customer_name')
      const phone = digitsOnly(get('phone'))

      if (!customer_name) { customer_name = 'NAME MISSING'; warnings.push('No customer name — saved as "NAME MISSING"') }
      if (!phone) warnings.push('No mobile no — this booking gets its own customer record')
      else if (phone.length < 10) warnings.push(`Mobile ${phone} is shorter than 10 digits`)

      const booking_date = parseDate(rawDate)
      if (rawDate && !booking_date) warnings.push(`Date "${rawDate}" not understood — left blank`)

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

      // A duplicate old id is the one thing that must never be waved through. Everything
      // else on this sheet is a gap the office can fill in later; a second copy of a deal
      // that is already in the system is a wrong record that doubles the books, and it
      // cannot be spotted afterwards without comparing against the old register by hand.
      //
      // This is not theory. The Import button stayed on screen after a run, Manisha
      // pressed it three times because the window would not close, and 45 old deals
      // became 99 bookings. With this check the second and third press do nothing.
      let skip = ''
      if (legacy_no) {
        const k = norm(legacy_no)
        if (takenNos.has(k))      skip = `Old id ${legacy_no} is already in the system — skipped`
        else if (seenNos.has(k))  skip = `Old id ${legacy_no} appears twice in this sheet — only the first is imported`
        else seenNos.add(k)
      }

      const { size: rawSize, tag: size_tag } = parseSize(get('size_sqyd'))
      const size_sqyd = rawSize || Number(plot?.size_sqyd || 0)
      const rate_per_sqyd = num(get('rate_per_sqyd')) || Number(plot?.price_per_sqyd || 0)
      const total = Math.round(size_sqyd * rate_per_sqyd)
      if (total <= 0) warnings.push('No value yet — add Size + Rate on the booking later')

      const advance = num(get('advance'))
      if (advance > total && total > 0) {
        warnings.push(`Advance ${formatINR(advance)} is more than the value ${formatINR(total)}`)
      }

      // The commission RATE for the whole deal.  The upline column only says how that rate
      // is divided; it never sets the rate itself.
      const commission_pct = num(get('commission_pct'))
      if (commission_pct > 20) warnings.push(`Commission ${commission_pct}% looks too high — check the column`)

      const shares = parseUplines(get('upline'))
      const uplines: UplineHit[] = shares.map(u => {
        const { broker, why } = findBroker(u.name)
        if (!broker) {
          if (why === 'ambiguous') warnings.push(`Upline "${u.name}" matches more than one broker — left off, add it on the booking`)
          else warnings.push(`Upline "${u.name}" not found in Brokers — left off this booking`)
        }
        return { name: u.name, share: u.share, broker_id: broker?.id || null, matched_as: broker?.name || '' }
      })
      const shareTotal = round4(uplines.reduce((s, u) => s + u.share, 0))
      if (uplines.length > 0 && Math.abs(shareTotal - 100) > 0.5) {
        warnings.push(`Upline shares add to ${shareTotal}%, not 100% — check the upline column`)
      }
      if (commission_pct > 0 && uplines.length === 0) {
        warnings.push('Commission % is set but no upline is named — nobody would be paid')
      }

      // A row whose columns have slipped sideways reads as "everything unmatched at once".
      // Saying so plainly beats importing nine fields of nonsense.
      const shifted = !!plot_no && !plot && !project && size_sqyd === 0 && rate_per_sqyd === 0
      if (shifted) warnings.push('This row looks shifted — the columns do not line up. Check it in Excel before importing.')

      let existingCust: any = null
      if (isRealPhone(phone)) {
        const candidate = custByPhone.get(phone)
        if (candidate && namesMatch(candidate.name, customer_name)) existingCust = candidate
        else if (candidate) warnings.push(`Mobile ${phone} is already on file for "${candidate.name}" — a separate customer was created for ${customer_name}`)
      } else if (phone) {
        warnings.push(`${phone} looks like a placeholder, not a real number — this booking gets its own customer record`)
      }

      return {
        line: i + 1, legacy_no, booking_date, skip,
        project_id: project?.id || null, project_name,
        plot_id: plot?.id || null, plot_no,
        size_sqyd, size_tag, rate_per_sqyd, total,
        customer_id: existingCust?.id || null, customer_name, phone,
        father_name: get('father_name'),
        uplines, commission_pct, advance, warnings,
      }
    })
  }, [text, ref])

  // Rows whose sheet names an upline that matched no broker. Counted once per row, not
  // once per name, because the question the office needs answered is "how many of these
  // deals would pay nobody".
  const unmatchedUplineRows = parsed.filter(
    r => !r.skip && r.uplines.length > 0 && r.uplines.every(u => !u.broker_id),
  ).length
  const valid   = parsed.filter(r => !r.skip)
  const skipped = parsed.filter(r =>  r.skip)
  const invalid = valid.filter(r => r.warnings.length > 0)

  const runImport = async () => {
    if (valid.length === 0) return
    setSaving(true); setResult(null); setProgress({ done: 0, total: valid.length })
    const failed: { line: number; who: string; reason: string }[] = []
    let ok = 0
    const createdCustomers = new Map<string, string>()

    for (const r of valid) {
      try {
        const cacheKey = isRealPhone(r.phone) ? `${r.phone}|${nameKey(r.customer_name)}` : ''
        let customer_id = r.customer_id || (cacheKey ? createdCustomers.get(cacheKey) : null) || null
        if (!customer_id) {
          const { data: c, error: cErr } = await supabase.from('bp_customers').insert({
            name: r.customer_name,
            phone: r.phone || '',
            father_or_husband_name: r.father_name || null,
          }).select('id').single()
          if (cErr || !c) throw cErr || new Error('Could not create the customer')
          customer_id = c.id
          if (cacheKey) createdCustomers.set(cacheKey, customer_id)
        }

        // Brokers that actually matched, in sheet order.  The first is the booking's own
        // broker_id (position 1), exactly as the booking form writes a traditional split.
        const hits = r.uplines.filter(u => u.broker_id)
        // Share → rate.  OFF means recorded but unpaid: every pct is 0, so
        // recompute_booking_payouts() derives nothing, now and on every future recompute.
        const rateFor = (u: UplineHit) =>
          payCommission && r.commission_pct > 0 ? round4(r.commission_pct * u.share / 100) : 0

        const noteBits = ['Imported from the old records sheet']
        if (r.size_tag) noteBits.push(`Size written as "${r.size_tag}" in the sheet`)
        // When the plot number on the sheet matched nothing in Plots, the booking is saved
        // without a plot and the number was simply thrown away -- so the printed form had
        // a blank plot no. and nobody could tell which plot the old register meant. Keep it.
        if (r.plot_no && !r.plot_id) noteBits.push(`Plot "${r.plot_no}" from the sheet is not in Plots yet — link it from the booking`)
        // Same for upline names that matched no broker: the sheet said who sells this deal
        // and the system would otherwise forget it entirely.
        if (r.uplines.length > 0 && r.uplines.every(u => !u.broker_id)) {
          noteBits.push(`Upline from the sheet, not in Brokers: ${r.uplines.map(u => `${u.name} ${u.share}%`).join(', ')}`)
        }
        if (hits.length > 0 && !(payCommission && r.commission_pct > 0)) {
          noteBits.push(`Upline split from the sheet (not paid): ${r.uplines.map(u => `${u.name} ${u.share}%`).join(', ')}`)
        }

        const { data: bk, error: bErr } = await supabase.from('bp_bookings').insert({
          // The register number goes in its OWN column so booking_no stays the system id.
          legacy_booking_no: r.legacy_no || null,
          customer_id,
          plot_id: r.plot_id,
          project_id: r.project_id,
          broker_id: hits[0]?.broker_id || null,
          stage,
          size_sqyd: r.size_sqyd || null,
          rate_per_sqyd: r.rate_per_sqyd || null,
          base_price: r.total || null,
          dev_charges: 0, plc_charges: 0, discount_amount: 0,
          plot_total_price: r.total || null, total_amount: r.total || null,
          application_date: r.booking_date,
          // Always traditional: the sheet gives an explicit rate and an explicit split, which
          // is exactly what traditional mode means.  Affiliate Network would re-derive the rate from the
          // broker's rank and ignore both.
          commission_mode: 'traditional',
          traditional_commission_pct: hits[0] ? rateFor(hits[0]) : 0,
          traditional_pay_upline: false,
          notes: noteBits.join(' · '),
        }).select('id').single()
        if (bErr || !bk) throw bErr || new Error('Could not create the booking')

        if (hits.length > 0) {
          const { error: sErr } = await supabase.from('bp_booking_brokers').insert(
            hits.map((u, idx) => ({
              booking_id: bk.id,
              broker_id: u.broker_id,
              commission_pct: rateFor(u),
              position: idx + 1,
            })),
          )
          if (sErr) throw new Error(`Booking saved, but the uplines could not be recorded: ${sErr.message}`)
        }

        if (r.plot_id) {
          await supabase.from('bp_booking_plots').insert({ booking_id: bk.id, plot_id: r.plot_id, position: 1 })
          await supabase.from('bp_plots')
            .update({ status: stage === 'token_received' ? 'token' : 'booked' })
            .eq('id', r.plot_id).neq('status', 'registry_done')
        }

        // One opening receipt so Paid / Balance read correctly — the app sums verified
        // bp_payments, it does not read the booking's own amount columns.
        if (r.advance > 0) {
          const { error: pErr } = await supabase.from('bp_payments').insert({
            booking_id: bk.id, customer_id,
            payment_type: 'booking', amount: r.advance, payment_mode: 'cash',
            payment_date: r.booking_date || new Date().toISOString().slice(0, 10),
            verification_status: 'verified', verified_at: new Date().toISOString(),
            drawn_on_bank: 'Cash',
            notes: 'Advance — imported from the old records sheet',
          })
          if (pErr) throw new Error(`Booking saved, but the advance could not be recorded: ${pErr.message}`)
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

  // The sample opens in Excel with the office's own column names, three filled rows to copy
  // the shape from, and the notes BELOW a blank line so the top of the sheet stays clean to
  // type into.
  const downloadTemplate = () => {
    const csv = [
      HEADER_LABELS.join(','),
      '1,pooja,rohit,geeta rani,9311099657,p404,66sq,6025,khatu shyam,30-01-26,50000,2',
      '2,runa devi,deva singh,radheyshyam:50/shyam:30/jyoti:20,8447807061,p65,50sq,6525,kunj bihari,13-01-26,25000,3',
      '3,pritilata,nawnit kumar,satish/nn pandey,7004711426,p470,150(L)sq,6025,kunj bihari,29-12-25,,',
      '',
      '# ---- Notes. Delete these lines before importing, or just leave them: lines starting with # are ignored. ----',
      '# Fill what you have. Nothing is compulsory - the rest can be corrected in the app afterwards.',
      '#',
      '# id no        : your old register number. It is KEPT and shown next to the system id - it does not replace it.',
      '# name / s/o   : buyer, and father or husband.',
      '# upline       : broker name. For more than one, separate with /  e.g. satish/nn pandey',
      '#                To set the split, write a share after the name:  radheyshyam:50/shyam:30/jyoti:20',
      '#                No share written = the rest is divided equally between those names.',
      '#                These are SHARES OF THE COMMISSION, not of the sale price.',
      '# mobile no    : 10 digits. Same mobile + same name on two rows = one customer with two bookings.',
      '# plot no      : must exist in that project and must not already be on a booking. One plot per row.',
      '# say          : size in gaj. "66sq" or "150(L)sq" both work - the (L) is kept as a note.',
      '# RATE         : price per gaj. Value = say x RATE.',
      '# Project      : must match the name on the Projects page exactly.',
      '# booking date : dd-mm-yy, dd/mm/yyyy or yyyy-mm-dd.',
      '# advance      : money already collected. Recorded as one opening receipt so Paid/Balance are right.',
      '# commission % : what the WHOLE deal pays, e.g. 2. The upline shares divide this number.',
      '#                Leave blank for old deals already settled. Commission is only actually paid if you',
      '#                tick "Pay broker commission" in the import window.',
      '',
    ].join('\n')
    saveBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), 'booking-import-sample.csv')
  }

  const payableRows = parsed.filter(r => r.commission_pct > 0 && r.uplines.some(u => u.broker_id)).length

  return (
    <Modal open={open} onClose={close} title="Import old bookings from Excel" size="xl">
      <div className="space-y-3">
        <div className="text-sm text-gray-600">
          Paste the rows straight out of Excel or Google Sheets — one booking per line, in your sheet's own column order:
        </div>
        <div className="font-mono text-[11px] bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-gray-700 overflow-x-auto whitespace-nowrap">
          {HEADER_LABELS.join('  →  ')}
        </div>
        <div className="flex items-center gap-2 text-xs bg-emerald-50 border border-emerald-200 rounded-lg px-2.5 py-2">
          <span className="text-emerald-900 flex-1">
            Download the sample sheet, fill your old bookings into it, then copy the rows back here.
            The last two columns — <b>advance</b> and <b>commission %</b> — are new; leave them blank and nothing is paid.
          </span>
          <button type="button" onClick={downloadTemplate}
            className="shrink-0 inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700">
            <Download size={13}/>Sample sheet
          </button>
        </div>

        <div className="text-[11px] text-blue-900 bg-blue-50 border border-blue-200 rounded-lg px-2.5 py-2">
          <b>More than one upline?</b> Separate them with <code className="font-mono">/</code> — <code className="font-mono">satish/nn pandey</code>.
          To fix the split, write the share after each name: <code className="font-mono">radheyshyam:50/shyam:30/jyoti:20</code>.
          Any name without a share takes an equal cut of what is left.
          These are shares <b>of the commission</b>; the commission itself comes from the last column.
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
              Leave this OFF for old deals whose commission was already settled — otherwise the system would pay every upline again on the advances you import.
              The uplines are recorded either way.
            </span>
          </label>
        </div>

        {payCommission && payableRows > 0 && (
          <div className="text-xs bg-rose-50 border border-rose-200 text-rose-900 rounded-lg px-2.5 py-2 flex items-start gap-1.5">
            <AlertTriangle size={13} className="mt-0.5 shrink-0"/>
            <span><b>{payableRows}</b> row(s) will pay commission to their uplines as soon as the advance is recorded. Only leave this on for deals that have <b>not</b> been settled yet.</span>
          </div>
        )}

        <textarea
          value={text} onChange={e => setText(e.target.value)} rows={7} spellCheck={false}
          placeholder={'1\tpooja\trohit\tgeeta rani\t9311099657\tp404\t66sq\t6025\tkhatu shyam\t30-01-26\t50000\t2'}
          className="w-full font-mono text-xs border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />

        {!ref && open && <div className="text-xs text-gray-400">Loading projects, plots, brokers and customers…</div>}

        {/* Brokers must go in BEFORE bookings. The office imported 99 bookings while the
            Brokers page held two names, so every upline on the sheet matched nothing and
            not one of those deals pays anybody. That was only a yellow line per row
            among many; it needed to be the first thing you see. */}
        {unmatchedUplineRows > 0 && (
          <div className="text-xs rounded-lg px-3 py-2.5 border bg-rose-50 border-rose-300 text-rose-900">
            <b>{unmatchedUplineRows} of {parsed.length} rows name an upline that is not in Brokers.</b>
            {' '}Those bookings would be saved with no broker attached, so <b>nobody gets paid</b> on
            them and no commission is ever worked out — the names on your sheet are simply dropped.
            Import your brokers first (Brokers → Import), then paste this sheet again.
          </div>
        )}

        {parsed.length > 0 && (
          <>
            <div className="flex flex-wrap gap-3 text-xs">
              <span className="inline-flex items-center gap-1 text-emerald-700"><CheckCircle2 size={13}/><b>{valid.length}</b> will be imported</span>
              {invalid.length > 0 && <span className="inline-flex items-center gap-1 text-amber-700"><AlertTriangle size={13}/><b>{invalid.length}</b> with gaps — fix in the app afterwards</span>}
              {skipped.length > 0 && <span className="inline-flex items-center gap-1 text-rose-700"><AlertTriangle size={13}/><b>{skipped.length}</b> already imported — skipped</span>}
              <span className="text-gray-500">Total value {formatINR(valid.reduce((s, r) => s + r.total, 0))} · advance {formatINR(valid.reduce((s, r) => s + r.advance, 0))}</span>
            </div>

            <div className="max-h-72 overflow-auto rounded-lg border border-gray-200">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 sticky top-0">
                  <tr>
                    {['#', 'Old id', 'Project / Plot', 'Customer', 'Mobile', 'Size', 'Value', 'Advance', 'Upline (share → rate)', 'Status'].map(h => (
                      <th key={h} className="text-left px-2 py-1.5 font-semibold text-gray-500 whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {parsed.map(r => (
                    <tr key={r.line} className={r.warnings.length ? 'bg-amber-50/40' : ''}>
                      <td className="px-2 py-1 text-gray-400">{r.line}</td>
                      <td className="px-2 py-1 font-mono">{r.legacy_no || <span className="text-gray-400">—</span>}</td>
                      <td className="px-2 py-1">{r.project_name || '—'} · <b>{r.plot_no || '—'}</b></td>
                      <td className="px-2 py-1">
                        {r.customer_name || '—'}
                        {r.customer_id && <span className="ml-1 text-[10px] text-blue-600">(existing)</span>}
                      </td>
                      <td className="px-2 py-1 font-mono">{r.phone || '—'}</td>
                      <td className="px-2 py-1 tabular-nums">{r.size_sqyd || '—'}{r.size_tag ? ` (${r.size_tag})` : ''}</td>
                      <td className="px-2 py-1 tabular-nums">{formatINR(r.total)}</td>
                      <td className="px-2 py-1 tabular-nums">{r.advance ? formatINR(r.advance) : '—'}</td>
                      <td className="px-2 py-1">
                        {r.uplines.length === 0 ? <span className="text-gray-400">—</span> : (
                          <span className="space-x-1">
                            {r.uplines.map((u, i) => (
                              <span key={i} className={u.broker_id ? 'text-gray-800' : 'text-rose-700 line-through'}>
                                {u.matched_as || u.name} {u.share}%
                                {payCommission && r.commission_pct > 0 && u.broker_id
                                  ? ` → ${round4(r.commission_pct * u.share / 100)}%` : ''}
                                {i < r.uplines.length - 1 ? ' ·' : ''}
                              </span>
                            ))}
                          </span>
                        )}
                      </td>
                      <td className="px-2 py-1">
                        {r.skip
                          ? <span className="text-rose-700 font-medium">{r.skip}</span>
                          : r.warnings.length > 0
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
            Each row creates the customer (or reuses one matched on mobile + name), the booking, its uplines, and — where an advance is given — one opening receipt so Paid and Balance read correctly. The plot is marked booked. EMI schedules and further payments can be added afterwards from the booking's Edit screen.
          </span>
        </div>

        {/* After a run the Import button is gone, not merely disabled. Leaving it on
            screen is what caused the duplicates: the window stayed open, it still said
            "Import 20 bookings", and pressing it again imported all 20 a second time. */}
        <div className="flex justify-end gap-2">
          {result ? (
            <Button onClick={close}><CheckCircle2 size={14}/>Done</Button>
          ) : (
            <>
              <Button variant="secondary" onClick={close}>Cancel</Button>
              <Button onClick={runImport} loading={saving} disabled={valid.length === 0 || !ref}>
                <ClipboardPaste size={14}/>Import {valid.length} booking{valid.length === 1 ? '' : 's'}
              </Button>
            </>
          )}
        </div>
      </div>
    </Modal>
  )
}
