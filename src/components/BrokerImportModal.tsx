// Bulk import of existing brokers from Excel / Google Sheets.
//
// Admin: "traditional broker ki id lagani hai jo purane broker hain, wo Excel se aa
// jayein -- ek ek karke bohot time lagega."  Old brokers already have their codes on
// paper, so the importer takes the broker_id from the sheet rather than minting a new
// one; assign_broker_id() only fills a BLANK broker_id, so a supplied code survives.
//
// Everything is validated and shown row-by-row BEFORE anything is written.  The rules
// that matter (each one is a real way this could go wrong):
//
//   * broker_id repeated inside the paste, or already on file  -> blocked.  UNIQUE.
//   * phone repeated / already on file                          -> blocked.  Phone is
//     the broker's LOGIN; two brokers sharing one is an auth mess, not a cosmetic dupe.
//   * email is NOT NULL + UNIQUE on brokers, and sheets rarely carry one -> derived
//     from the phone (b<digits>@fanbegroup.com, the same shape the Add Broker form
//     uses) or from the broker code, then checked for collisions like any other field.
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

// Column order the paste is read in.  Matches the order admin already keeps in the
// sheet; only Name is mandatory.
const COLUMNS = ['broker_id', 'name', 'phone', 'email', 'pan_no', 'date_of_joining'] as const

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

  const parsed = useMemo<Row[]>(() => {
    // '#' marks the sample rows in the downloadable template.  Skipping them means the
    // examples can be pasted back by mistake without creating three fake brokers —
    // and admin turns an example into a real row just by deleting the '#'.
    const lines = text.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'))
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

    return body.map((line, i) => {
      // Tabs when pasted from a spreadsheet; commas as a fallback for CSV text.
      const cells = (line.includes('\t') ? line.split('\t') : line.split(',')).map(c => c.trim())
      const get = (k: typeof COLUMNS[number]) => cells[COLUMNS.indexOf(k)] || ''

      const errors: string[] = []
      const broker_id = get('broker_id')
      const name      = get('name')
      const phone     = digitsOnly(get('phone'))
      const pan_no    = get('pan_no').toUpperCase()
      const rawDate   = get('date_of_joining')

      if (!name) errors.push('Name is missing')

      const idKey = broker_id.toLowerCase()
      if (broker_id) {
        if (seenId.has(idKey)) errors.push(`Broker ID ${broker_id} is already used`)
        else seenId.add(idKey)
      }

      if (phone) {
        if (phone.length < 10) errors.push('Phone is shorter than 10 digits')
        else if (seenPhone.has(phone)) errors.push(`Phone ${phone} is already used`)
        else seenPhone.add(phone)
      }

      // brokers.email is NOT NULL + UNIQUE, so every row needs one whether the sheet
      // has it or not.  Phone-derived first (matches the Add Broker form), then code.
      let email = get('email').toLowerCase()
      if (!email) {
        if (phone) email = `b${phone}@fanbegroup.com`
        else if (broker_id) email = `${idKey.replace(/[^a-z0-9]/g, '')}@fanbegroup.com`
      }
      if (!email) errors.push('No email, phone or broker ID to build an email from')
      else if (seenEmail.has(email)) errors.push(`Email ${email} is already used`)
      else seenEmail.add(email)

      const date_of_joining = parseDate(rawDate)
      if (rawDate && !date_of_joining) errors.push(`Date "${rawDate}" is not dd/mm/yyyy or yyyy-mm-dd`)

      return { line: i + 1, broker_id, name, phone, email, pan_no, date_of_joining, errors }
    })
  }, [text, existing])

  const valid   = parsed.filter(r => r.errors.length === 0)
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
      broker_type: brokerType,
      // Traditional brokers are paid the per-booking %, not a rank slab, but rank is
      // NOT NULL — 'Executive' is the lowest active slab and what the Add Broker form
      // uses, so imported rows behave exactly like hand-added ones.
      rank: 'Executive',
      status: 'active',
    })

    // Chunked so a long sheet doesn't hit a request limit; on a chunk failure we retry
    // that chunk one row at a time, so admin gets the exact rows that failed instead of
    // "something went wrong" for the whole batch.
    const CHUNK = 50
    for (let i = 0; i < valid.length; i += CHUNK) {
      const slice = valid.slice(i, i + CHUNK)
      const { error } = await supabase.from('brokers').insert(slice.map(payloadFor))
      if (!error) { ok += slice.length; continue }
      for (const r of slice) {
        const { error: rowErr } = await supabase.from('brokers').insert(payloadFor(r))
        if (rowErr) failed.push({ line: r.line, name: r.name, reason: rowErr.message })
        else ok++
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
      'Broker ID,Name,Phone,Email,PAN,Date of Joining',
      '# --- The lines starting with # are examples. Delete them, or just remove the # to import that row. ---',
      '# TR814,RAJESH KUMAR,9811100011,rajesh@example.com,ABCPK1234A,01/04/2024',
      '# TR815,SUNITA DEVI,9811100012,,,15/07/2023          <- email/PAN blank is fine',
      '# ,MOHIT SAXENA,9811100013,,,                        <- Broker ID blank = a new code is generated',
      '#',
      '# Only Name is required. Keep the columns in this order and do not add new ones.',
      '# Broker ID  : the code this broker already uses. Leave blank for a new one.',
      '# Phone      : 10 digits. This is the broker login, so it must not repeat.',
      '# Email      : optional. Left blank, one is built from the phone number.',
      '# Date       : dd/mm/yyyy, dd-mm-yyyy or yyyy-mm-dd.',
      '',
    ].join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }))
    const a = document.createElement('a')
    a.href = url
    a.download = 'broker-import-template.csv'
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <Modal open={open} onClose={close} title="Import brokers from Excel" size="lg">
      <div className="space-y-3">
        <div className="text-sm text-gray-600">
          Copy the rows straight out of Excel or Google Sheets and paste them below — one broker per line, in this column order:
        </div>
        <div className="font-mono text-[11px] bg-gray-50 border border-gray-200 rounded-lg px-3 py-2 text-gray-700 overflow-x-auto whitespace-nowrap">
          Broker ID → Name → Phone → Email → PAN → Date of joining
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
          Only <b>Name</b> is required. Leave <b>Broker ID</b> blank to have a fresh code generated; fill it in to keep the code the broker already has.
          Dates can be <code>dd/mm/yyyy</code> or <code>yyyy-mm-dd</code>. A header row is skipped automatically.
        </div>

        <div className="grid grid-cols-2 gap-3 items-end">
          <Select label="Import these as" value={brokerType} onChange={(e: any) => setBrokerType(e.target.value)}>
            <option value="traditional">Traditional brokers (standalone, custom commission)</option>
            <option value="mlm">MLM brokers (sponsor tree)</option>
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
          placeholder={'TR814\tRAJESH KUMAR\t9811100011\t\tABCPK1234A\t01/04/2024\nTR815\tSUNITA DEVI\t9811100012'}
          className="w-full font-mono text-xs border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
        />

        {parsed.length > 0 && (
          <>
            <div className="flex flex-wrap gap-3 text-xs">
              <span className="inline-flex items-center gap-1 text-emerald-700"><CheckCircle2 size={13}/><b>{valid.length}</b> ready to import</span>
              {invalid.length > 0 && <span className="inline-flex items-center gap-1 text-red-700"><AlertTriangle size={13}/><b>{invalid.length}</b> need fixing (they will be skipped)</span>}
            </div>

            <div className="max-h-64 overflow-auto rounded-lg border border-gray-200">
              <table className="w-full text-xs">
                <thead className="bg-gray-50 sticky top-0">
                  <tr>
                    {['#', 'Broker ID', 'Name', 'Phone', 'Email', 'PAN', 'Joined', 'Status'].map(h => (
                      <th key={h} className="text-left px-2 py-1.5 font-semibold text-gray-500 whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {parsed.map(r => (
                    <tr key={r.line} className={r.errors.length ? 'bg-red-50/50' : ''}>
                      <td className="px-2 py-1 text-gray-400">{r.line}</td>
                      <td className="px-2 py-1 font-mono">{r.broker_id || <span className="text-gray-400">auto</span>}</td>
                      <td className="px-2 py-1">{r.name || <span className="text-red-600">—</span>}</td>
                      <td className="px-2 py-1 font-mono">{r.phone || '—'}</td>
                      <td className="px-2 py-1 text-gray-500 max-w-[180px] truncate" title={r.email}>{r.email || '—'}</td>
                      <td className="px-2 py-1 font-mono">{r.pan_no || '—'}</td>
                      <td className="px-2 py-1">{r.date_of_joining || '—'}</td>
                      <td className="px-2 py-1">
                        {r.errors.length === 0
                          ? <span className="text-emerald-700">OK</span>
                          : <span className="text-red-700">{r.errors.join('; ')}</span>}
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
