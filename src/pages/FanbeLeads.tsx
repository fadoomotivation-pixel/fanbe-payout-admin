// FANBE Leads — the enquiries that come in from www.fanbegroup.com.
//
// Admin: "jo www.fanbegroup.com pr lead h vo kahi FANBE leads kar show kro ... jo purani
// leads website k h vo leads me show kr dena time k sath or date k sath jitna data h".
//
// Where they live: the website calls the `submit_website_lead` RPC, which writes a row
// into `leads` with source 'WhatsApp' (its default) or 'Website', and puts the whole
// enquiry into `notes` — the IST timestamp, the message the visitor typed, which page
// they were on and where they came from.  Nothing on the row itself holds the message, so
// this page reads it back out of the note.
//
// READ ONLY, on purpose.  `leads` belongs to the call-centre CRM that shares this
// database.  This page shows what the website sent and offers a WhatsApp reply; it never
// writes, assigns or deletes, so the two systems cannot fight over the same row.
//
// WHO SEES WHAT.  The CRM's own policy on `leads` is
// `is_super_admin() OR is_sales_manager() OR assigned_to = auth.uid()`, which left this
// page empty for every office login except the one super-admin — including `payout`,
// which has no CRM role at all.
//
// Relaxing that policy would have handed all ~6,000 Facebook, Instagram and manual leads
// to every payout user, so it is untouched.  Instead the rows come through
// `fanbe_website_leads()` (migration 20261011): a SECURITY DEFINER function that returns
// ONLY the website enquiries, and only when public.is_staff() — so payout staff see the
// 52 website leads and still cannot read the rest of the lead book, and a broker login
// gets nothing at all.  The filter is inside the function; no argument comes from here,
// so there is nothing a caller can pass to widen it.
import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { fetchAllRows, todayLocalISO } from '@/lib/fetchAll'
import { downloadCsv } from '@/lib/download'
import { waLink } from '@/lib/whatsapp'
import { Button } from '@/components/ui/Button.tsx'
import { Secret } from '@/lib/privacy'
import {
  Inbox, Search, Download, X, MessageCircle, Phone, Globe, Calendar, Info,
} from 'lucide-react'

type Lead = {
  id: string
  name: string | null
  full_name: string | null
  phone: string | null
  email: string | null
  source: string | null
  status: string | null
  final_status: string | null
  interest_level: string | null
  project: string | null
  notes: string | null
  created_at: string
  assigned_to_name: string | null
}

// The note the website writes looks like:
//
//   🟢 WhatsApp enquiry from website — 10/10/2026, 11:57:31 am
//   Source: Google/Search — organic
//   Message: "Hello, I want a plot"
//   Page: /projects
//
// and a repeat enquiry from the same number is stacked on top of the older one, newest
// first, separated by a blank line.  Only the newest block is read here; the full note is
// still shown underneath so nothing is hidden.
function parseNote(notes: string | null | undefined) {
  const whole = String(notes || '')
  const latest = whole.split(/\n\s*\n/)[0] || ''
  const pick = (label: string) => {
    const m = latest.match(new RegExp(`^\\s*${label}\\s*:\\s*(.+)$`, 'im'))
    return m ? m[1].trim().replace(/^"|"$/g, '') : ''
  }
  // Where the visitor came from is dropped on the way in, not hidden on the way out, so
  // it cannot reappear through the raw note, the search box or the export.  Admin: "isme
  // lead kaha se aa rahi h mat dikhao".  The website still records it; this page is not
  // where the office needs it.
  const strip = (t: string) =>
    t.split('\n').filter(l => !/^\s*(Source|Page|Referrer|UTM[^:]*)\s*:/i.test(l)).join('\n').trim()
  return {
    repeat: /^🔁/.test(latest.trim()),
    message: pick('Message'),
    whole: strip(whole),
  }
}

const IST = 'Asia/Kolkata'
const fmtDateTime = (iso: string) => {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('en-IN', {
    timeZone: IST, day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit', hour12: true,
  })
}
// The calendar date in IST, for the "today" and "this week" counts — a UTC slice would
// call anything before 05:30 yesterday.
const istDay = (iso: string) => {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const p = new Intl.DateTimeFormat('en-CA', { timeZone: IST, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
  return p
}

const INTEREST_CLS: Record<string, string> = {
  Hot:  'bg-rose-50 text-rose-700 border-rose-200',
  Warm: 'bg-amber-50 text-amber-700 border-amber-200',
  Cold: 'bg-sky-50 text-sky-700 border-sky-200',
}

export default function FanbeLeads() {
  const [search, setSearch] = useState('')
  const [project, setProject] = useState('')
  const [period, setPeriod] = useState<'all' | 'today' | 'week' | 'month'>('all')
  const [openNote, setOpenNote] = useState<string | null>(null)

  const { data: leads = [], isLoading, error } = useQuery<Lead[]>({
    queryKey: ['fanbe_website_leads'],
    queryFn: async () => {
      // The function does the filtering and the permission check in one place.
      const { data, error } = await supabase.rpc('fanbe_website_leads')
      if (!error) return (data || []) as Lead[]

      // Falls back to reading the table directly when the function is not there yet —
      // an app deployed ahead of its migration should degrade to "what this login may
      // read", not to an error page.
      if (!/function|does not exist|schema cache/i.test(error.message || '')) throw error
      return await fetchAllRows<Lead>((from, to) =>
        supabase.from('leads')
          .select('id, name, full_name, phone, email, source, status, final_status, interest_level, project, notes, created_at, assigned_to_name')
          .or('source.eq.WhatsApp,source.eq.Website,notes.ilike.%from website%')
          .order('created_at', { ascending: false })
          .range(from, to))
    },
  })

  const today = todayLocalISO()
  const weekAgo = todayLocalISO(new Date(Date.now() - 6 * 864e5))
  const monthAgo = todayLocalISO(new Date(Date.now() - 29 * 864e5))

  const projects = useMemo(
    () => [...new Set(leads.map(l => (l.project || '').trim()).filter(Boolean))].sort(),
    [leads],
  )

  const rows = useMemo(() => leads.filter(l => {
    const day = istDay(l.created_at)
    if (period === 'today' && day !== today) return false
    if (period === 'week' && day < weekAgo) return false
    if (period === 'month' && day < monthAgo) return false
    if (project && (l.project || '').trim() !== project) return false
    if (search.trim()) {
      const q = search.toLowerCase()
      const hay = [l.name, l.full_name, l.phone, l.email, l.project, parseNote(l.notes).whole]
      if (!hay.some(v => String(v || '').toLowerCase().includes(q))) return false
    }
    return true
  }), [leads, period, project, search, today, weekAgo, monthAgo])

  const counts = useMemo(() => ({
    total: leads.length,
    today: leads.filter(l => istDay(l.created_at) === today).length,
    week:  leads.filter(l => istDay(l.created_at) >= weekAgo).length,
    named: leads.filter(l => (l.project || '').trim()).length,
  }), [leads, today, weekAgo])

  const exportCsv = () => {
    const headers = ['Date & time (IST)', 'Name', 'Phone', 'Project', 'Interest', 'Message', 'Status', 'Assigned to']
    const body = rows.map(l => {
      const n = parseNote(l.notes)
      return [
        fmtDateTime(l.created_at), l.name || l.full_name || '', l.phone || '',
        l.project || '', l.interest_level || '', n.message, l.final_status || l.status || '',
        l.assigned_to_name || '',
      ]
    })
    downloadCsv(`fanbe-website-leads-${today}.csv`, [headers, ...body])
  }

  const filtersOn = !!(search || project || period !== 'all')

  return (
    <div className="p-4 md:p-8 space-y-5 max-w-6xl mx-auto">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2">
            <Globe size={22} className="text-emerald-600"/>FANBE Leads
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Enquiries that came in from www.fanbegroup.com — with the date, the time and the message the visitor sent.
          </p>
        </div>
        <Button variant="secondary" onClick={exportCsv} disabled={rows.length === 0}>
          <Download size={14}/>Export
        </Button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'All website leads', value: counts.total, hint: 'since the website went live' },
          { label: 'Today',             value: counts.today, hint: 'came in today' },
          { label: 'Last 7 days',       value: counts.week,  hint: 'this week' },
          { label: 'Named a scheme',    value: counts.named, hint: 'told us which project' },
        ].map(t => (
          <div key={t.label} className="bg-white border border-gray-200 rounded-xl p-4">
            <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">{t.label}</div>
            <div className="text-2xl font-bold text-gray-900 mt-1">{t.value}</div>
            <div className="text-[11px] text-gray-400 mt-0.5">{t.hint}</div>
          </div>
        ))}
      </div>

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="p-3 border-b border-gray-100 flex flex-wrap gap-2 items-center">
          <div className="relative flex-1 min-w-[180px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"/>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name, number, message or scheme"
              className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"/>
          </div>
          <select value={period} onChange={e => setPeriod(e.target.value as any)} className="px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white">
            <option value="all">All time</option>
            <option value="today">Today</option>
            <option value="week">Last 7 days</option>
            <option value="month">Last 30 days</option>
          </select>
          <select value={project} onChange={e => setProject(e.target.value)} className="px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white">
            <option value="">All schemes</option>
            {projects.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
          {filtersOn && (
            <button onClick={() => { setSearch(''); setProject(''); setPeriod('all') }}
              className="text-xs text-gray-500 hover:text-gray-800 px-2 py-1 inline-flex items-center gap-1"><X size={12}/>Clear</button>
          )}
          <span className="text-sm text-gray-500 ml-auto">{rows.length} shown</span>
        </div>

        {error ? (
          <div className="p-6 text-sm text-rose-700 bg-rose-50">
            Could not load the website leads: {(error as any)?.message || String(error)}
          </div>
        ) : isLoading ? (
          <div className="py-12 text-center text-gray-400">Loading…</div>
        ) : leads.length === 0 ? (
          <div className="p-6 text-sm text-gray-600 space-y-2">
            <div className="font-medium text-gray-900">No website enquiries yet.</div>
            <p>
              Anything sent from the enquiry form on www.fanbegroup.com appears here within seconds, with the date,
              the time and the visitor's message.
            </p>
            <p className="text-gray-500">
              If the website <i>is</i> getting enquiries and this stays empty, the office login being used is not on the
              staff list — add it under Roles and it will fill.
            </p>
          </div>
        ) : rows.length === 0 ? (
          <div className="py-12 text-center text-gray-400">No website leads match these filters.</div>
        ) : (
          <ul className="divide-y divide-gray-100">
            {rows.map(l => {
              const n = parseNote(l.notes)
              const who = l.name || l.full_name || 'Website enquiry'
              const wa = waLink(l.phone, `Namaste ${who === 'Website enquiry' ? '' : who}, Fanbe Group se baat kar rahe hain. Aapne hamari website par plot ke liye enquiry ki thi.`)
              return (
                <li key={l.id} className="p-3 hover:bg-gray-50/60">
                  <div className="flex flex-wrap items-start gap-x-3 gap-y-1">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-gray-900">{who}</span>
                        {n.repeat && (
                          <span className="text-[10px] uppercase tracking-wide bg-violet-100 text-violet-800 rounded px-1.5 py-0.5">repeat</span>
                        )}
                        {l.interest_level && (
                          <span className={`text-[10px] uppercase tracking-wide rounded px-1.5 py-0.5 border ${INTEREST_CLS[l.interest_level] || 'bg-gray-50 text-gray-600 border-gray-200'}`}>
                            {l.interest_level}
                          </span>
                        )}
                        {l.project && <span className="text-[11px] text-gray-600">· {l.project}</span>}
                      </div>

                      <div className="mt-0.5 text-[12px] text-gray-500 flex flex-wrap items-center gap-x-3 gap-y-0.5">
                        <span className="inline-flex items-center gap-1"><Calendar size={11}/>{fmtDateTime(l.created_at)}</span>
                        {l.phone && <span className="font-mono"><Secret>{l.phone}</Secret></span>}
                        {l.assigned_to_name && <span className="text-blue-700">with {l.assigned_to_name}</span>}
                      </div>

                      {n.message && (
                        <div className="mt-1 text-sm text-gray-800 bg-gray-50 border border-gray-200 rounded-lg px-2.5 py-1.5">
                          “{n.message}”
                        </div>
                      )}

                      <button
                        type="button"
                        onClick={() => setOpenNote(openNote === l.id ? null : l.id)}
                        className="mt-1 text-[11px] text-blue-700 hover:underline"
                      >
                        {openNote === l.id ? 'Hide the full enquiry' : 'Show the full enquiry'}
                      </button>
                      {openNote === l.id && (
                        <pre className="mt-1 text-[11px] text-gray-700 bg-white border border-gray-200 rounded-lg p-2 whitespace-pre-wrap break-words">
                          {n.whole || 'Nothing else was recorded.'}
                        </pre>
                      )}
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      {wa && (
                        <a href={wa} target="_blank" rel="noreferrer" title="Reply on WhatsApp"
                          className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1.5 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700">
                          <MessageCircle size={13}/>WhatsApp
                        </a>
                      )}
                      {l.phone && (
                        <a href={`tel:${l.phone}`} title="Call"
                          className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1.5 rounded-lg border border-gray-200 text-gray-700 hover:bg-gray-50">
                          <Phone size={13}/>Call
                        </a>
                      )}
                    </div>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <div className="text-[11px] text-gray-600 bg-blue-50 border border-blue-200 rounded-lg px-2.5 py-2 flex items-start gap-1.5">
        <Info size={13} className="mt-0.5 shrink-0 text-blue-700"/>
        <span>
          This page is read-only. Calling, assigning and follow-ups stay in the call-centre CRM, so the two systems
          never disagree about the same lead — use <b>WhatsApp</b> here to reply straight away, and work the lead there.
        </span>
      </div>
    </div>
  )
}
