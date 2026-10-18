// Bulk import of existing brokers from Excel / Google Sheets.
//
// Admin: "traditional broker ki id lagani hai jo purane broker hain, wo Excel se aa
// jayein -- ek ek karke bohot time lagega."  Old brokers already have their codes on
// paper, so the importer takes the broker_id from the sheet rather than minting a new
// one; assign_broker_id() only fills a BLANK broker_id, so a supplied code survives.
//
// NOTHING is mandatory: admin wants the sheet in fast and will tidy up inside the app
// afterwards, so a row is never refused.  Anything missing or clashing is fixed up to
// something safe and reported as a warning, because the alternative -- writing it
// as-is -- would hit a DB constraint and lose the row entirely:
//
//   * name is NOT NULL          -> blank becomes "NAME MISSING", which admin can search.
//   * broker_id is UNIQUE       -> a clashing code is dropped so assign_broker_id() mints
//     a fresh one; the broker still lands and the code can be corrected on their page.
//   * email is NOT NULL+UNIQUE and sheets rarely carry one -> derived from the phone
//     (b<digits>@fanbegroup.com, the shape the Add Broker form uses), else the code,
//     else the line number, and a '-2' suffix is added until it is genuinely unique.
//   * phone has no DB constraint, so a duplicate is kept -- but it IS the broker's
//     login, so it is called out loudly rather than accepted in silence.
//   * after writing, sync_broker_id_sequences() pushes broker_id_tr_seq past the
//     highest imported TR id -- otherwise the NEXT broker created through the UI draws
//     an id that the import already took, and it fails for someone else entirely.
//
// Logins are deliberately NOT created in bulk: that is one edge-function call per
// broker, and a half-finished run would leave logins nobody can account for.  Use the
// key icon on a broker row to issue a login when it's actually needed.
import { useState, useMemo } from 'react'
import { supabase } from '@/lib/supabase'
import { Modal } from '@/components/ui/Modal.tsx'
import { Button } from '@/components/ui/Button.tsx'
import { Select } from '@/components/ui/Input.tsx'
import { ClipboardPaste, AlertTriangle, CheckCircle2, Download } from 'lucide-react'
import toast from 'react-hot-toast'
import { makeBrokerFinder } from '@/lib/brokerMatch'
import { downloadTemplateFile } from '@/lib/download'

// Column order the paste is read in.  Matches the order admin already keeps in the
// sheet.  Every one of them is optional.
// `sponsor` is appended rather than slotted in, so a sheet written against the older
// column order still pastes correctly -- it just leaves the upline blank.
// The bank columns are not decoration.  This software exists to pay these people, and
// Withdrawals holds a payout until the broker has bank details and KYC — so importing a
// hundred brokers without them just moves the typing to a hundred broker pages before
// anyone can be paid a rupee.  'type' lets ONE sheet carry both trees instead of running
// the import twice.
const COLUMNS = [
  'broker_id', 'name', 'phone', 'email', 'pan_no', 'date_of_joining', 'sponsor',
  'type', 'bank_name', 'account_no', 'ifsc', 'account_holder', 'aadhaar_no',
  // Traditional brokers only: the rate they are on, in rupees per gaj. Without it the
  // booking form cannot fill the team commission and the office is back to Excel, so it
  // belongs on the same sheet as everything else about the broker.
  'rate_per_sqyd',
  // Or a flat amount per plot instead — a broker is on one basis or the other.
  'rate_per_plot',
] as const

const digitsOnly = (s: string) => (s || '').replace(/\D/g, '')

// Accepts 2026-08-10, 10/08/2026 and 10-08-2026 (Indian sheets use the latter two).
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
  broker_id: string
  name: string
  phone: string
  email: string
  pan_no: string
  date_of_joining: string | null
  sponsor: string
  broker_type: 'traditional' | 'mlm'
  bank_name: string
  account_no: string
  ifsc: string
  account_holder: string
  aadhaar_no: string
  rate_per_sqyd: number | null
  rate_per_plot: number | null
  errors: string[]
}

export default function BrokerImportModal({ open, onClose, existing, onImported }: {
  open: boolean
  onClose: () => void
  /** Every broker already on file — used to catch collisions before writing. */
  existing: any[]
  onImported: () => void
}) {
  const [text, setText] = useState('')
  const [brokerType, setBrokerType] = useState<'traditional' | 'mlm'>('traditional')
  const [saving, setSaving] = useState(false)
  const [result, setResult] = useState<{ ok: number; failed: { line: number; name: string; reason: string }[] } | null>(null)

  // Does the database have the per-gaj rate column yet? Brokers are loaded with select *,
  // so the key is present on every row once migration 20261014 has been run. Feature-
  // detected because that migration is run by hand after this code deploys, and a column
  // Postgres does not have would fail the whole import rather than one field.
  const hasRateColumn = existing.length === 0
    || Object.prototype.hasOwnProperty.call(existing[0] as any, 'traditional_rate_per_sqyd')
  const hasPerPlotColumn = existing.length === 0
    || Object.prototype.hasOwnProperty.call(existing[0] as any, 'traditional_rate_per_plot')

  const parsed = useMemo<Row[]>(() => {
    // '#' marks the sample rows in the downloadable template.  Skipping them means the
    // examples can be pasted back by mistake without creating three fake brokers —
    // and admin turns an example into a real row just by deleting the '#'.
    // NOT .trim() on the line.  A leading blank cell is a tab at the start, and trimming
    // it ate the empty Broker ID column — so "  ,MOHIT SAXENA,9811100013" (a new broker
    // with no code yet, which is the normal case and what the sample itself shows) read
    // the NAME as the broker id and shifted every column after it by one.
    const lines = text.split('\n').map(l => l.replace(/\r$/, '')).filter(l => l.trim() && !l.trim().startsWith('#'))
    if (lines.length === 0) return []

    // Drop a header row if the sheet was copied with one.
    const first = lines[0].toLowerCase()
    const body = (first.includes('name') && (first.includes('broker') || first.includes('phone') || first.includes('mobile')))
      ? lines.slice(1)
      : lines

    // Collision sets seeded from the DB, then grown as we walk the paste, so a clash
    // against an earlier line in the same paste is caught too.
    const seenId    = new Set(existing.map(b => (b.broker_id || '').trim().toLowerCase()).filter(Boolean))
    const seenPhone = new Set(existing.map(b => digitsOnly(b.phone || '')).filter(Boolean))
    const seenEmail = new Set(existing.map(b => (b.email || '').trim().toLowerCase()).filter(Boolean))
    // Names matter more here than they look. The BOOKING import matches an upline by
    // NAME, and when a name matches two brokers it reports "ambiguous" and leaves the
    // upline off entirely — that booking then pays nobody. Manisha hit exactly this with
    // two brokers called Rajiv. So importing a second broker under a name already in use
    // quietly builds that trap, and it has to be said out loud at the preview.
    const nameCount = new Map<string, number>()
    for (const b of existing) {
      const k = (b.name || '').trim().toLowerCase()
      if (k) nameCount.set(k, (nameCount.get(k) || 0) + 1)
    }

    const rows: Row[] = body.map((line, i) => {
      // Tabs when pasted from a spreadsheet; commas as a fallback for CSV text.
      const cells = (line.includes('\t') ? line.split('\t') : line.split(',')).map(c => c.trim())
      const get = (k: typeof COLUMNS[number]) => cells[COLUMNS.indexOf(k)] || ''

      // Nothing here blocks a row.  Admin wants the sheet in fast and will tidy up
      // inside the app afterwards, so anything missing or clashing is fixed up to
      // something safe and reported as a warning instead of stopping the import.
      const warnings: string[] = []
      let broker_id = get('broker_id')
      let name      = get('name')
      const phone   = digitsOnly(get('phone'))
      const pan_no  = get('pan_no').toUpperCase()
      const rawDate = get('date_of_joining')

      // brokers.name is NOT NULL — a searchable placeholder beats refusing the row.
      if (!name) { name = 'NAME MISSING'; warnings.push('No name — saved as "NAME MISSING", search that to fix them later') }

      const nameKey = name.trim().toLowerCase()
      if (nameKey && name !== 'NAME MISSING') {
        const already = nameCount.get(nameKey) || 0
        if (already > 0) {
          warnings.push(
            `Another broker is already called "${name}" — a booking sheet naming this upline `
            + 'will match two people, and the importer leaves the upline off rather than guess, '
            + 'so that booking would pay nobody. Add something to tell them apart.')
        }
        nameCount.set(nameKey, already + 1)
      }

      // broker_id is UNIQUE in the DB, so a clash cannot simply be written.  Drop the
      // supplied code and let assign_broker_id() mint a fresh one; the broker still
      // lands, and admin can correct the code on the broker's page.
      const idKey = broker_id.toLowerCase()
      if (broker_id) {
        if (seenId.has(idKey)) {
          warnings.push(`Broker ID ${broker_id} is already taken — a new code will be generated instead`)
          broker_id = ''
        } else seenId.add(idKey)
      }

      // Phone has no DB constraint, so a clash is admin's to resolve — but it IS the
      // broker's login, so say so loudly rather than silently accepting it.
      if (phone && phone.length < 10) warnings.push(`Phone ${phone} is shorter than 10 digits`)
      if (phone) {
        if (seenPhone.has(phone)) warnings.push(`Phone ${phone} is already used by another broker — both would share a login`)
        else seenPhone.add(phone)
      }

      // brokers.email is NOT NULL + UNIQUE, so every row needs one whether the sheet has
      // it or not, and it has to be unique no matter what.  Phone-derived first (matches
      // the Add Broker form), then the code, then the line number as a last resort.
      let email = get('email').toLowerCase()
      if (!email) {
        if (phone) email = `b${phone}@fanbegroup.com`
        else if (broker_id) email = `${idKey.replace(/[^a-z0-9]/g, '')}@fanbegroup.com`
        else email = `broker-line${i + 1}@fanbegroup.com`
      }
      if (seenEmail.has(email)) {
        const [local, domain] = email.split('@')
        let n = 2
        while (seenEmail.has(`${local}-${n}@${domain}`)) n++
        const fixed = `${local}-${n}@${domain}`
        warnings.push(`Email ${email} was already used — saved as ${fixed}`)
        email = fixed
      }
      seenEmail.add(email)

      const date_of_joining = parseDate(rawDate)
      if (rawDate && !date_of_joining) warnings.push(`Date "${rawDate}" not understood — left blank`)

      // Resolved AFTER the insert, not here: a sponsor is very often another row of the
      // same sheet, so it only exists once the batch has landed.
      const sponsor = get('sponsor')

      // Per-row type, so one sheet can hold both trees.  Blank falls back to the dropdown,
      // which is how every existing sheet keeps working unchanged.
      const typeCell = get('type').trim().toLowerCase()
      const broker_type: 'traditional' | 'mlm' =
          /^(trad|traditional|tr)$/.test(typeCell)                  ? 'traditional'
        : /^(mlm|affiliate|affiliate network|fnb|network)$/.test(typeCell) ? 'mlm'
        : brokerType
      if (typeCell && broker_type !== (/^(trad|traditional|tr)$/.test(typeCell) ? 'traditional' : 'mlm')) {
        warnings.push(`Type "${typeCell}" not understood — imported as ${brokerType === 'mlm' ? 'Affiliate Network' : 'Traditional'}`)
      }

      // Bank details.  Nothing is forced: a broker without them still imports, they just
      // cannot be paid until somebody fills them in, which Withdrawals already says.
      const bank_name      = get('bank_name')
      const account_no     = digitsOnly(get('account_no'))
      const ifsc           = get('ifsc').toUpperCase().replace(/\s/g, '')
      const account_holder = get('account_holder') || ''
      const aadhaar_no     = digitsOnly(get('aadhaar_no'))

      // What a traditional broker is on, per gaj. Null, not 0, when the sheet leaves it
      // blank: 0 would be a decision about somebody's money that nobody has made, and the
      // booking form reports a missing rate instead of quietly paying nothing.
      const rateRaw = Number(String(get('rate_per_sqyd')).replace(/[^\d.]/g, ''))
      const rate_per_sqyd = Number.isFinite(rateRaw) && rateRaw > 0 ? rateRaw : null
      if (rate_per_sqyd != null && broker_type !== 'traditional') {
        warnings.push('Rate per gaj only applies to a traditional broker — ignored on this row, an Affiliate broker is paid from their rank')
      }
      if (rate_per_sqyd != null && rate_per_sqyd > 5000) {
        warnings.push(`Rate ${rate_per_sqyd}/gaj looks high — check the column before paying on it`)
      }
      const plotRaw = Number(String(get('rate_per_plot')).replace(/[^\d.]/g, ''))
      const rate_per_plot = Number.isFinite(plotRaw) && plotRaw > 0 ? plotRaw : null
      if (rate_per_plot != null && rate_per_sqyd != null) {
        warnings.push('Both a per-gaj rate and a per-plot amount are filled in — a broker is on one or the other, so the per-plot amount is used')
      }
      if (rate_per_plot != null && broker_type !== 'traditional') {
        warnings.push('Per-plot commission only applies to a traditional broker — ignored on this row')
      }
      if (rate_per_sqyd == null && rate_per_plot == null && broker_type === 'traditional') {
        warnings.push('No rate set — this broker earns nothing from the team commission until one is, per gaj or per plot')
      }

      if (ifsc && !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(ifsc)) {
        warnings.push(`IFSC ${ifsc} does not look like an IFSC code — saved anyway, check it before paying`)
      }
      if (account_no && (account_no.length < 9 || account_no.length > 18)) {
        warnings.push(`Account number ${account_no} is ${account_no.length} digits — check it before paying`)
      }
      if (aadhaar_no && aadhaar_no.length !== 12) {
        warnings.push(`Aadhaar ${aadhaar_no} is not 12 digits — saved anyway`)
      }
      // Half a bank account cannot be paid into, so say which half is missing.
      if ((account_no || ifsc) && !(account_no && ifsc)) {
        warnings.push(account_no ? 'Account number without an IFSC — payment would fail' : 'IFSC without an account number — payment would fail')
      }

      return {
        line: i + 1, broker_id, name, phone, email, pan_no, date_of_joining, sponsor,
        broker_type, bank_name, account_no, ifsc, account_holder, aadhaar_no,
        rate_per_sqyd, rate_per_plot,
        errors: warnings,
      }
    })

    // ── One more pass, for the things a single row cannot see ──────────────
    //
    // A cross-type tree is REFUSED by the database (enforce_same_type_sponsor), and a
    // sponsor is very often another row of the same sheet, so neither the row itself nor
    // the broker list alone can tell. Catching it here means the preview says "this will
    // not link" before the import runs, instead of a raw Postgres message afterwards on
    // a broker that has already been created.
    const typeByName = new Map<string, Set<string>>()
    const note = (n: string, t: string) => {
      const k = (n || '').trim().toLowerCase()
      if (!k) return
      const set = typeByName.get(k) || new Set<string>()
      set.add(t); typeByName.set(k, set)
    }
    for (const b of existing) note(b.name || '', (b as any).broker_type || 'mlm')
    for (const r of rows) note(r.name, r.broker_type)

    for (const r of rows) {
      const want = r.sponsor.trim().toLowerCase()
      if (!want) continue
      const types = typeByName.get(want)
      // Unknown names are already reported by the upline pass; only a KNOWN name whose
      // type cannot match is worth saying here.
      if (!types || types.size === 0) continue
      if (!types.has(r.broker_type)) {
        const theirs = [...types].map(t => t === 'traditional' ? 'Traditional' : 'Affiliate').join('/')
        r.errors.push(
          `Upline "${r.sponsor}" is ${theirs} but this broker is `
          + `${r.broker_type === 'traditional' ? 'Traditional' : 'Affiliate'} — the two trees are kept `
          + 'separate, so the database will refuse the link and this broker will be saved with no upline.')
      }
    }

    return rows
  }, [text, existing])

  // Every parsed row is importable now — `errors` only ever carries warnings, so the
  // count below is "rows that will need a look afterwards", not "rows being dropped".
  const valid   = parsed
  const invalid = parsed.filter(r => r.errors.length > 0)

  const runImport = async () => {
    if (valid.length === 0) return
    setSaving(true)
    setResult(null)
    const failed: { line: number; name: string; reason: string }[] = []
    let ok = 0

    const payloadFor = (r: Row) => ({
      // Blank broker_id is left out entirely so assign_broker_id() mints the next one.
      ...(r.broker_id ? { broker_id: r.broker_id } : {}),
      name: r.name,
      email: r.email,
      phone: r.phone || null,
      pan_no: r.pan_no || null,
      date_of_joining: r.date_of_joining,
      broker_type: r.broker_type,
      bank_name: r.bank_name || null,
      account_no: r.account_no || null,
      ifsc: r.ifsc || null,
      // Falls back to the broker's own name: a bank rejects a transfer whose account
      // holder is blank, and for most of these two names are the same anyway.
      account_holder: r.account_holder || r.name || null,
      aadhaar_no: r.aadhaar_no || null,
      // Traditional brokers are paid the per-booking %, not a rank slab, but rank is
      // NOT NULL — 'Executive' is the lowest active slab and what the Add Broker form
      // uses, so imported rows behave exactly like hand-added ones.
      rank: 'Executive',
      status: 'active',
      // Only on a traditional broker, and only once the database has the column —
      // migration 20261014 is run by hand after this deploys, and sending a column
      // Postgres does not have would fail the whole import.
      // One basis only, per-plot first — the same rule the whole app reads by, so a
      // sheet with both filled in cannot create a broker who is on two arrangements.
      ...(hasRateColumn && r.broker_type === 'traditional'
        ? (hasPerPlotColumn && r.rate_per_plot != null
            ? { traditional_rate_per_plot: r.rate_per_plot }
            : r.rate_per_sqyd != null ? { traditional_rate_per_sqyd: r.rate_per_sqyd } : {})
        : {}),
    })

    // Chunked so a long sheet doesn't hit a request limit; on a chunk failure we retry
    // that chunk one row at a time, so admin gets the exact rows that failed instead of
    // "something went wrong" for the whole batch.
    const CHUNK = 50
    // Rows that actually landed, so the sponsor pass below can link to them by name.
    const created: { id: string; name: string | null; broker_id: string | null }[] = []
    for (let i = 0; i < valid.length; i += CHUNK) {
      const slice = valid.slice(i, i + CHUNK)
      const { data, error } = await supabase.from('brokers').insert(slice.map(payloadFor)).select('id, name, broker_id')
      if (!error) { ok += slice.length; created.push(...((data || []) as any[])); continue }
      for (const r of slice) {
        const { data: one, error: rowErr } = await supabase.from('brokers').insert(payloadFor(r)).select('id, name, broker_id')
        if (rowErr) failed.push({ line: r.line, name: r.name, reason: rowErr.message })
        else { ok++; created.push(...((one || []) as any[])) }
      }
    }

    // ── Uplines, second pass ──────────────────────────────────────────────
    // Only now, because a sponsor is usually another row of the same sheet and did not
    // exist while the batch was being written.  Matching is the shared rule, so a
    // sponsor name behaves exactly as an upline name does in the booking import.
    //
    // The database still has the last word: enforce_same_type_sponsor and
    // enforce_no_sponsor_cycle reject a cross-type or looping tree, and that rejection is
    // reported rather than swallowed — the broker is already saved, only the link failed.
    const withSponsor = valid.filter(r => r.sponsor.trim())
    if (withSponsor.length > 0) {
      const pool = [...existing, ...created] as any[]
      const findBroker = makeBrokerFinder(pool)
      const createdByLine = new Map<number, any>()
      // created[] comes back in insert order, which is valid[] order.
      valid.forEach((r, idx) => { if (created[idx]) createdByLine.set(r.line, created[idx]) })

      for (const r of withSponsor) {
        const me = createdByLine.get(r.line)
        if (!me) continue
        const { broker: up, why } = findBroker(r.sponsor)
        if (!up) {
          failed.push({ line: r.line, name: r.name, reason: why === 'ambiguous'
            ? `Saved, but upline "${r.sponsor}" matches more than one broker — set it by hand`
            : `Saved, but upline "${r.sponsor}" was not found — set it by hand` })
          continue
        }
        if (up.id === me.id) {
          failed.push({ line: r.line, name: r.name, reason: 'Saved, but the upline is the broker themselves — left blank' })
          continue
        }
        const { error: upErr } = await supabase.from('brokers')
          .update({ sponsor_id: up.id, parent_id: up.id }).eq('id', me.id)
        if (upErr) failed.push({ line: r.line, name: r.name, reason: `Saved, but the upline could not be set: ${upErr.message}` })
      }
    }

    // Push the id sequences past anything just imported, so the next broker added
    // through the UI can't be handed a code this import already took.
    if (ok > 0) {
      const { error: seqErr } = await supabase.rpc('sync_broker_id_sequences')
      if (seqErr) console.warn('sync_broker_id_sequences failed:', seqErr)
    }

    setSaving(false)
    setResult({ ok, failed })
    if (ok > 0) {
      onImported()
      toast.success(`${ok} broker${ok === 1 ? '' : 's'} imported`)
    }
    if (failed.length > 0) toast.error(`${failed.length} row(s) could not be saved`)
  }

  const close = () => { setText(''); setResult(null); onClose() }

  // A filled-in sample sheet so admin can see the shape instead of guessing it.  Sample
  // rows are '#'-prefixed, so the file can be pasted back as-is and only the real rows
  // admin adds get imported.  Opens straight in Excel / Google Sheets.
  const downloadTemplate = () => {
    const csv = [
      'Broker ID,Name,Phone,Email,PAN,Date of Joining,Upline (sponsor),Type,Bank name,Account no,IFSC,Account holder,Aadhaar,Rate per gaj,Rate per plot',
      'TR814,SHIV SHANKAR THAKUR,9811100011,,,01/04/2024,,traditional,State Bank of India,30123456789,SBIN0001234,SHIV SHANKAR THAKUR,,2000,',
      'TR816,SURENDER CHAUDHARY,9811100012,,ABCPK1234A,15/07/2023,SHIV SHANKAR THAKUR,traditional,HDFC Bank,50100123456789,HDFC0000123,SURENDER CHAUDHARY,,1500,',
      ',SATISH KUMAR,9811100013,,,,TR816,traditional,,,,,,,50000',
      ',RADHEY SHYAM,9811100014,,,,SATISH KUMAR,affiliate,Punjab National Bank,1234567890123,PUNB0123456,RADHEY SHYAM,123412341234,,',
      '',
      '# ---- Notes. Lines starting with # are ignored, so you can leave them in. ----',
      '# Fill what you have. Nothing is compulsory - the rest can be corrected in the app afterwards.',
      '# But read the two starred lines: those are the ones that cost money if they are wrong.',
      '#',
      '# * Name           : spell it EXACTLY as your booking sheet spells the upline.',
      '#                    This is how a booking finds its broker. "Radheyshyam" and',
      '#                    "Radhey Shyam" both match, but "R. Shyam" does not, and that',
      '#                    booking then pays nobody.',
      '# * Rate per gaj   : TRADITIONAL brokers only - what this broker is on, per gaj.',
      '#                    This is the number that used to live in your head and send the',
      '#                    commission out to Excel. Put it here and the booking form fills',
      '#                    the whole team in one click.',
      '#                    Each level earns the DIFFERENCE between their rate and the rate',
      '#                    of the person below them. In the four sample rows above:',
      '#                      SATISH   1200/gaj sells it -> earns 1200/gaj',
      '#                      SURENDER 1500/gaj          -> earns  300/gaj (1500-1200)',
      '#                      SHIV     2000/gaj          -> earns  500/gaj (2000-1500)',
      '#                    So a 100 gaj deal costs 2000 x 100 in all, NOT the three rates',
      '#                    added together. Leave blank if nothing is agreed yet - that',
      '#                    broker is then left out of the auto-fill rather than paid zero.',
      '#                    Affiliate brokers ignore this: they are paid from their rank.',
      '# * Rate per plot  : the OTHER way to pay a traditional broker - a flat amount for',
      '#                    each plot, whatever its size. SATISH above is on 50,000 a plot.',
      '#                    Fill ONE of the two, not both. A broker is on per gaj OR per',
      '#                    plot; if both are filled the per-plot amount is used.',
      '#                    Careful: plots here run from about 12 gaj to 583, so a flat',
      '#                    50,000 is roughly 4,000 a gaj on the smallest and 86 on the',
      '#                    largest. That is a fine deal to strike on purpose and an easy',
      '#                    one to strike by accident.',
      '# * Account no     : with IFSC. Withdrawals will not pay a broker who has no bank',
      '#                    details, so a sheet without these just moves the typing to a',
      '#                    hundred broker pages later. Account holder is the name as the',
      '#                    BANK has it - left blank, the broker name is used.',
      '#',
      '# Broker ID      : the code this broker already uses. Leave BLANK and a new one is',
      '#                  generated - TR817... for traditional, FNB05144... for Affiliate',
      '#                  Network - carrying on from your old register.',
      '# Phone          : 10 digits. This is the broker login, so it must not repeat.',
      '# Email          : optional. Left blank, one is built from the phone number.',
      '# PAN            : optional, but TDS is deducted at a higher rate without it.',
      '# Aadhaar        : optional, 12 digits. Used for KYC.',
      '# Date of Joining: dd/mm/yyyy, dd-mm-yyyy or yyyy-mm-dd.',
      '# Type           : traditional or affiliate. Leave BLANK and the dropdown in the',
      '#                  import window decides - so one sheet can hold both kinds, or',
      '#                  you can keep separate sheets, whichever suits.',
      '# Upline         : who sits above them in the tree. NAME or code, either works, and',
      '#                  it may be someone further down this same sheet. Leave blank for a',
      '#                  top-level broker. A name matching two brokers is reported, never',
      '#                  guessed. Affiliate and Traditional trees stay separate - an upline',
      '#                  of the other kind is refused.',
      '#',
      '# Order matters: brokers go in BEFORE bookings. A booking imported first finds no',
      '# upline to match, and the names on that sheet are dropped - which is exactly how',
      '# 44 of the 45 bookings currently on file ended up with no broker on them.',
      '',
    ].join('\n')
    downloadTemplateFile('broker-import-sample.csv', csv)
  }

  return (
    <Modal open={open} onClose={close} title="Import brokers from Excel" size="lg">
      <div className="space-y-3">
        <div className="text-sm text-gray-600">
          Copy the rows straight out of Excel or Google Sheets and paste them below — one broker per line, in this column order:
        </div>
        <div className="font-mono text-[11px] bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-gray-700 overflow-x-auto whitespace-nowrap">
          Broker ID → Name → Phone → Email → PAN → Date of joining → Upline (sponsor) → Type → Bank name → Account no → IFSC → Account holder → Aadhaar → Rate per gaj → Rate per plot
        </div>
        <div className="flex items-center gap-2 text-xs bg-emerald-50 border border-emerald-200 rounded-lg px-2.5 py-2">
          <span className="text-emerald-900 flex-1">
            Not sure how to lay the sheet out? Download the sample file, fill your brokers into it, then copy the rows back here.
          </span>
          <button type="button" onClick={downloadTemplate}
            className="shrink-0 inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700">
            <Download size={13}/>Sample sheet
          </button>
        </div>
        <div className="text-[11px] text-gray-500">
          <b>Nothing is compulsory</b> — fill in whatever you have and fix the rest inside the app later. Leave <b>Broker ID</b> blank to have a fresh code generated; fill it in to keep the code the broker already has.
          Dates can be <code>dd/mm/yyyy</code> or <code>yyyy-mm-dd</code>. A header row is skipped automatically.
        </div>

        <div className="grid grid-cols-2 gap-3 items-end">
          <Select label="Import these as" value={brokerType} onChange={(e: any) => setBrokerType(e.target.value)}>
            <option value="traditional">Traditional brokers (standalone, custom commission)</option>
            <option value="mlm">Affiliate Network brokers (sponsor tree)</option>
          </Select>
          <div className="text-[11px] text-gray-500 pb-2">
            Sponsor / upline is not set by the import — link those from the broker's own page afterwards.
          </div>
        </div>

        <textarea
          value={text}
          onChange={e => setText(e.target.value)}
          rows={8}
          spellCheck={false}
          placeholder={'TR814\tRADHEY SHYAM\t9811100011\t\t\t01/04/2024\nTR815\tSATISH KUMAR\t9811100012\t\tABCPK1234A\t15/07/2023\tRADHEY SHYAM'}
          className="w-full font-mono text-xs border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />

        {parsed.length > 0 && (
          <>
            <div className="flex flex-wrap gap-3 text-xs">
              <span className="inline-flex items-center gap-1 text-emerald-700"><CheckCircle2 size={13}/><b>{valid.length}</b> will be imported</span>
              {invalid.length > 0 && <span className="inline-flex items-center gap-1 text-amber-700"><AlertTriangle size={13}/><b>{invalid.length}</b> imported with gaps — tidy up in the app afterwards</span>}
            </div>

            <div className="max-h-64 overflow-auto rounded-lg border border-gray-200">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 sticky top-0">
                  <tr>
                    {['#', 'Broker ID', 'Name', 'Phone', 'Email', 'PAN', 'Joined', 'Upline', 'Type', 'Bank', 'Status'].map(h => (
                      <th key={h} className="text-left px-2 py-1.5 font-semibold text-gray-500 whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {parsed.map(r => (
                    <tr key={r.line} className={r.errors.length ? 'bg-amber-50/40' : ''}>
                      <td className="px-2 py-1 text-gray-400">{r.line}</td>
                      <td className="px-2 py-1 font-mono">{r.broker_id || <span className="text-gray-400">auto</span>}</td>
                      <td className="px-2 py-1">{r.name}</td>
                      <td className="px-2 py-1 font-mono">{r.phone || '—'}</td>
                      <td className="px-2 py-1 text-gray-500 max-w-[180px] truncate" title={r.email}>{r.email || '—'}</td>
                      <td className="px-2 py-1 font-mono">{r.pan_no || '—'}</td>
                      <td className="px-2 py-1">{r.date_of_joining || '—'}</td>
                      <td className="px-2 py-1">{r.sponsor || <span className="text-gray-400">—</span>}</td>
                      <td className="px-2 py-1">
                        {r.broker_type === 'mlm'
                          ? <span className="text-blue-700">Affiliate</span>
                          : <span className="text-amber-700">Traditional</span>}
                      </td>
                      {/* Payable or not, at a glance: the whole point of importing these
                          people is to be able to pay them. */}
                      <td className="px-2 py-1">
                        {r.account_no && r.ifsc
                          ? <span className="text-emerald-700">can be paid</span>
                          : <span className="text-gray-400">no bank yet</span>}
                      </td>
                      <td className="px-2 py-1">
                        {r.errors.length === 0
                          ? <span className="text-emerald-700">OK</span>
                          : <span className="text-amber-700">{r.errors.join('; ')}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {result && (
          <div className={`text-xs rounded-lg px-3 py-2 border ${result.failed.length ? 'bg-amber-50 border-amber-200 text-amber-900' : 'bg-emerald-50 border-emerald-200 text-emerald-800'}`}>
            <div><b>{result.ok}</b> broker(s) imported.</div>
            {result.failed.length > 0 && (
              <div className="mt-1">
                <b>{result.failed.length}</b> could not be saved:
                <ul className="list-disc ml-4 mt-0.5">
                  {result.failed.slice(0, 8).map(f => <li key={f.line}>Line {f.line} ({f.name || 'no name'}): {f.reason}</li>)}
                </ul>
                {result.failed.length > 8 && <div className="mt-0.5">…and {result.failed.length - 8} more.</div>}
              </div>
            )}
          </div>
        )}

        <div className="text-[11px] text-gray-600 bg-blue-50 border border-blue-200 rounded-lg px-2.5 py-2">
          Imported brokers are created <b>without logins</b>. Use the key icon on a broker's row to issue a login when that broker actually needs one.
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={close}>{result ? 'Done' : 'Cancel'}</Button>
          <Button onClick={runImport} loading={saving} disabled={valid.length === 0}>
            <ClipboardPaste size={14}/>Import {valid.length} broker{valid.length === 1 ? '' : 's'}
          </Button>
        </div>
      </div>
    </Modal>
  )
}
