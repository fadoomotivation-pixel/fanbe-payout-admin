import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { formatDate } from '@/lib/utils'
import { Table } from '@/components/ui/Table.tsx'
import { Button } from '@/components/ui/Button.tsx'
import { Badge } from '@/components/ui/Badge.tsx'
import { Modal } from '@/components/ui/Modal.tsx'
import { Input, Textarea } from '@/components/ui/Input.tsx'
import {
  PhoneCall, Clock, Calendar, AlertTriangle, Search, ChevronRight,
  CheckCircle2, RotateCcw, Eye, MessageCircle, Phone, BarChart3, Users, Inbox,
} from 'lucide-react'
import toast from 'react-hot-toast'

type Tab = 'followups' | 'scorecards' | 'ghosts' | 'activity'

const today = () => new Date().toISOString().slice(0, 10)
const daysFromNow = (d: number) => { const x = new Date(); x.setDate(x.getDate() + d); return x.toISOString().slice(0, 10) }

const fmtMin = (sec: number) => {
  if (!sec) return '0 min'
  const m = Math.floor(sec / 60), s = sec % 60
  if (m === 0) return `${s}s`
  if (m < 60)  return `${m} min`
  const h = Math.floor(m / 60); const rm = m % 60
  return rm ? `${h}h ${rm}m` : `${h}h`
}

export default function CallCenter() {
  const qc = useQueryClient()
  const [tab, setTab] = useState<Tab>('followups')
  const [employeeFilter, setEmployeeFilter] = useState('')
  const [search, setSearch] = useState('')
  const [rescheduleFor, setRescheduleFor] = useState<any>(null)
  const [reschedDate, setReschedDate] = useState(daysFromNow(1))
  const [reschedNote, setReschedNote] = useState('')
  const [viewCall, setViewCall] = useState<any>(null)

  // ── Queries ──────────────────────────────────────────────────────
  const { data: kpi } = useQuery({
    queryKey: ['call_center_kpi'],
    queryFn: async () => {
      const [{ data: todayCalls }, { count: dueCount }, { count: ghostCount }] = await Promise.all([
        supabase.from('calls').select('id, duration').eq('call_date', today()),
        supabase.from('calls').select('id', { count: 'exact', head: true })
          .eq('followup_status', 'pending')
          .lte('next_followup_date', today()),
        supabase.from('v_ghost_leads').select('id', { count: 'exact', head: true })
          .gte('days_since_contact', 7),
      ])
      const callsToday = todayCalls?.length || 0
      const secondsToday = (todayCalls || []).reduce((s: number, r: any) => s + Number(r.duration || 0), 0)
      return { callsToday, secondsToday, dueCount: dueCount || 0, ghostCount: ghostCount || 0 }
    },
  })

  const { data: followups = [], isLoading: fuLoading } = useQuery({
    queryKey: ['call_center_followups', employeeFilter],
    enabled: tab === 'followups',
    queryFn: async () => {
      let q = supabase.from('calls')
        .select('id, employee_id, employee_name, lead_id, lead_name, phone, notes, next_followup_date, followup_status, major_objection, call_date')
        .eq('followup_status', 'pending')
        .lte('next_followup_date', daysFromNow(7))   // today + next 7 days + overdue
        .order('next_followup_date', { ascending: true })
        .limit(300)
      if (employeeFilter) q = q.eq('employee_id', employeeFilter)
      const { data, error } = await q
      if (error) throw error
      return data || []
    },
  })

  const { data: scorecards = [], isLoading: scLoading } = useQuery({
    queryKey: ['call_center_scorecards'],
    enabled: tab === 'scorecards',
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_tele_caller_scorecard')
        .select('*')
        .order('calls_30d', { ascending: false })
      if (error) throw error
      return data || []
    },
  })

  const { data: ghosts = [], isLoading: gLoading } = useQuery({
    queryKey: ['call_center_ghosts'],
    enabled: tab === 'ghosts',
    queryFn: async () => {
      const { data, error } = await supabase
        .from('v_ghost_leads')
        .select('*')
        .gte('days_since_contact', 7)
        .order('days_since_contact', { ascending: false })
        .limit(500)
      if (error) throw error
      return data || []
    },
  })

  const { data: activity = [], isLoading: aLoading } = useQuery({
    queryKey: ['call_center_activity', employeeFilter],
    enabled: tab === 'activity',
    queryFn: async () => {
      let q = supabase.from('calls')
        .select('id, employee_name, lead_name, phone, call_type, status, duration, notes, next_followup_date, major_objection, call_date, call_time')
        .order('call_date', { ascending: false }).order('call_time', { ascending: false })
        .limit(100)
      if (employeeFilter) q = q.eq('employee_id', employeeFilter)
      const { data, error } = await q
      if (error) throw error
      return data || []
    },
  })

  // Employee picker source — distinct list from scorecard view (always populated)
  const { data: employees = [] } = useQuery({
    queryKey: ['call_center_employees'],
    queryFn: async () => {
      const { data } = await supabase.from('v_tele_caller_scorecard').select('employee_id, employee_name').order('employee_name')
      return (data || []) as { employee_id: string; employee_name: string }[]
    },
  })

  // ── Mutations ─────────────────────────────────────────────────────
  const markDone = useMutation({
    mutationFn: async (callId: string) => {
      const { data: { user } } = await supabase.auth.getUser()
      const { error } = await supabase.from('calls').update({
        followup_status: 'done',
        followup_completed_at: new Date().toISOString(),
        followup_completed_by: user?.id || null,
      }).eq('id', callId)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['call_center_followups'] })
      qc.invalidateQueries({ queryKey: ['call_center_kpi'] })
      toast.success('Follow-up marked done')
    },
    onError: (e: any) => toast.error(e.message),
  })

  const reschedule = useMutation({
    mutationFn: async ({ id, date, note }: { id: string; date: string; note: string }) => {
      const { error } = await supabase.from('calls').update({
        next_followup_date: date,
        followup_status: 'pending',
        feedback: note ? `${note} (rescheduled ${today()})` : undefined,
        reminder_sent_at: null,
      }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['call_center_followups'] })
      qc.invalidateQueries({ queryKey: ['call_center_kpi'] })
      toast.success('Follow-up rescheduled')
      setRescheduleFor(null)
    },
    onError: (e: any) => toast.error(e.message),
  })

  // ── Derived filters / search ───────────────────────────────────────
  const filteredFollowups = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return followups
    return followups.filter((r: any) =>
      (r.lead_name || '').toLowerCase().includes(q) ||
      (r.employee_name || '').toLowerCase().includes(q) ||
      (r.phone || '').toLowerCase().includes(q) ||
      (r.notes || '').toLowerCase().includes(q)
    )
  }, [followups, search])

  const filteredGhosts = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return ghosts
    return ghosts.filter((r: any) =>
      (r.full_name || r.name || '').toLowerCase().includes(q) ||
      (r.assigned_to_name || '').toLowerCase().includes(q) ||
      (r.phone || '').toLowerCase().includes(q)
    )
  }, [ghosts, search])

  // ── Cell renderers ────────────────────────────────────────────────
  const followupCols = [
    { header: 'Due', render: (r: any) => {
      const overdue = r.next_followup_date < today()
      return (
        <div>
          <div className={`text-sm font-semibold ${overdue ? 'text-red-700' : r.next_followup_date === today() ? 'text-amber-700' : 'text-gray-900'}`}>
            {formatDate(r.next_followup_date)}
          </div>
          <div className="text-[10px] text-gray-400">{overdue ? `overdue ${Math.abs(daysBetween(r.next_followup_date, today()))}d` : r.next_followup_date === today() ? 'today' : `in ${daysBetween(r.next_followup_date, today())}d`}</div>
        </div>
      )
    }},
    { header: 'Lead', render: (r: any) => (
      <div>
        <div className="font-medium text-sm">{r.lead_name || '—'}</div>
        <div className="text-xs text-gray-500">{r.phone || '—'}</div>
      </div>
    )},
    { header: 'Tele-caller', render: (r: any) => <span className="text-sm">{r.employee_name || '—'}</span> },
    { header: 'Last note', render: (r: any) => (
      <div className="max-w-xs">
        <div className="text-xs text-gray-700 line-clamp-2">{r.notes || '—'}</div>
        {r.major_objection && <div className="text-[10px] text-rose-600 mt-0.5">⚠ {r.major_objection}</div>}
      </div>
    )},
    { header: '', render: (r: any) => (
      <div className="flex gap-1">
        <Button size="sm" variant="ghost" onClick={() => setViewCall(r)}><Eye size={12}/>View</Button>
        {r.phone && <a href={`tel:${r.phone}`} className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded bg-blue-50 text-blue-700 hover:bg-blue-100"><Phone size={11}/>Call</a>}
        {r.phone && <a href={`https://wa.me/${String(r.phone).replace(/[^\d]/g,'')}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded bg-emerald-50 text-emerald-700 hover:bg-emerald-100"><MessageCircle size={11}/>WA</a>}
        <Button size="sm" variant="secondary" onClick={() => { setRescheduleFor(r); setReschedDate(daysFromNow(1)); setReschedNote('') }}><RotateCcw size={12}/>Reschedule</Button>
        <Button size="sm" onClick={() => markDone.mutate(r.id)} loading={markDone.isPending}><CheckCircle2 size={12}/>Done</Button>
      </div>
    )},
  ]

  const scorecardCols = [
    { header: 'Tele-caller', render: (r: any) => <span className="font-medium text-sm">{r.employee_name || '—'}</span> },
    { header: 'Today', render: (r: any) => <span className="text-sm">{r.calls_today} calls · {fmtMin(r.seconds_today)}</span> },
    { header: '30-day calls', render: (r: any) => <span className="text-sm font-semibold">{r.calls_30d}</span> },
    { header: 'Talk time (30d)', render: (r: any) => <span className="text-sm">{fmtMin(r.total_seconds_30d)}</span> },
    { header: 'Connected', render: (r: any) => {
      const total = (r.connected_30d || 0) + (r.not_connected_30d || 0)
      const pct = total > 0 ? Math.round((r.connected_30d / total) * 100) : 0
      return <div><div className="text-sm font-semibold text-emerald-700">{r.connected_30d}<span className="text-gray-400 font-normal"> / {total}</span></div><div className="text-[10px] text-gray-400">{pct}% connect rate</div></div>
    }},
    { header: 'Unique leads', render: (r: any) => <span className="text-sm">{r.unique_leads_30d}</span> },
    { header: 'Today/Overdue FU', render: (r: any) => (
      <div className="flex gap-1.5">
        {r.today_followups > 0 && <Badge label={`${r.today_followups} today`} className="bg-amber-50 text-amber-700 border border-amber-200"/>}
        {r.overdue_followups > 0 && <Badge label={`${r.overdue_followups} overdue`} className="bg-rose-50 text-rose-700 border border-rose-200"/>}
        {!r.today_followups && !r.overdue_followups && <span className="text-xs text-gray-400">all clear</span>}
      </div>
    )},
  ]

  const ghostCols = [
    { header: 'Days silent', render: (r: any) => (
      <div className={`font-bold ${r.days_since_contact >= 30 ? 'text-rose-700' : r.days_since_contact >= 14 ? 'text-amber-700' : 'text-yellow-700'}`}>
        {r.days_since_contact}d
      </div>
    )},
    { header: 'Lead', render: (r: any) => (
      <div>
        <div className="font-medium text-sm">{r.full_name || r.name || '—'}</div>
        <div className="text-xs text-gray-500">{r.phone || '—'}{r.project ? ` · ${r.project}` : ''}</div>
      </div>
    )},
    { header: 'Assigned to', render: (r: any) => (
      <div>
        <div className="text-sm">{r.assigned_to_name || '—'}</div>
        <div className="text-[10px] text-gray-400">since {formatDate(r.assigned_at)}</div>
      </div>
    )},
    { header: 'Calls so far', render: (r: any) => <span className="text-sm">{r.total_calls || 0}</span> },
    { header: 'Last call', render: (r: any) => r.last_call_date ? formatDate(r.last_call_date) : <span className="text-rose-600 text-xs">never</span> },
    { header: '', render: (r: any) => (
      <div className="flex gap-1">
        {r.phone && <a href={`tel:${r.phone}`} className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded bg-blue-50 text-blue-700 hover:bg-blue-100"><Phone size={11}/>Call</a>}
        {r.phone && <a href={`https://wa.me/${String(r.phone).replace(/[^\d]/g,'')}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded bg-emerald-50 text-emerald-700 hover:bg-emerald-100"><MessageCircle size={11}/>WA</a>}
      </div>
    )},
  ]

  const activityCols = [
    { header: 'When', render: (r: any) => (
      <div className="text-xs">
        <div className="font-medium">{formatDate(r.call_date)}</div>
        <div className="text-gray-400">{(r.call_time || '').slice(0, 5)}</div>
      </div>
    )},
    { header: 'Lead', render: (r: any) => (
      <div>
        <div className="text-sm font-medium">{r.lead_name || '—'}</div>
        <div className="text-xs text-gray-500">{r.phone || '—'}</div>
      </div>
    )},
    { header: 'Tele-caller', render: (r: any) => <span className="text-sm">{r.employee_name || '—'}</span> },
    { header: 'Status', render: (r: any) => {
      const cls = r.status === 'Connected' ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-amber-50 text-amber-700 border-amber-200'
      return <Badge label={`${r.call_type || '—'} · ${r.status || '—'}`} className={`text-xs border ${cls}`}/>
    }},
    { header: 'Duration', render: (r: any) => <span className="text-sm">{fmtMin(r.duration || 0)}</span> },
    { header: 'Notes', render: (r: any) => (
      <div className="max-w-xs">
        <div className="text-xs text-gray-700 line-clamp-2">{r.notes || '—'}</div>
        {r.major_objection && <div className="text-[10px] text-rose-600 mt-0.5">⚠ {r.major_objection}</div>}
      </div>
    )},
    { header: 'Next FU', render: (r: any) => r.next_followup_date ? <span className="text-xs">{formatDate(r.next_followup_date)}</span> : <span className="text-xs text-gray-300">—</span> },
  ]

  return (
    <div className="p-3 md:p-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-indigo-50 rounded-lg"><PhoneCall size={20} className="text-indigo-600"/></div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">Call Center</h1>
            <p className="text-sm text-gray-500">Tele-caller activity, follow-ups, ghost leads. Auto-reminders run daily at 9 AM.</p>
          </div>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi icon={<PhoneCall size={16}/>}     label="Calls today"        value={String(kpi?.callsToday ?? '—')} tint="bg-blue-50 border-blue-200 text-blue-700"/>
        <Kpi icon={<Clock size={16}/>}         label="Talk time today"    value={fmtMin(kpi?.secondsToday ?? 0)} tint="bg-emerald-50 border-emerald-200 text-emerald-700"/>
        <Kpi icon={<Calendar size={16}/>}      label="Follow-ups due"     value={String(kpi?.dueCount ?? '—')} sub="today + overdue" tint="bg-amber-50 border-amber-200 text-amber-700"/>
        <Kpi icon={<AlertTriangle size={16}/>} label="Ghost leads"        value={String(kpi?.ghostCount ?? '—')} sub="7+ days silent" tint="bg-rose-50 border-rose-200 text-rose-700"/>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200 overflow-x-auto">
        {([
          { k: 'followups',  label: 'Follow-ups',     icon: Calendar },
          { k: 'scorecards', label: 'Scorecards',     icon: BarChart3 },
          { k: 'ghosts',     label: 'Ghost leads',    icon: AlertTriangle },
          { k: 'activity',   label: 'Recent activity', icon: Inbox },
        ] as { k: Tab; label: string; icon: any }[]).map(t => (
          <button key={t.k} onClick={() => setTab(t.k)}
            className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px inline-flex items-center gap-1.5 whitespace-nowrap ${tab === t.k ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-gray-500 hover:text-gray-700'}`}>
            <t.icon size={13}/>{t.label}
          </button>
        ))}
      </div>

      {/* Filters */}
      {(tab === 'followups' || tab === 'activity' || tab === 'ghosts') && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-3 flex gap-2 items-center flex-wrap">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"/>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search lead, phone, notes..."
              className="w-full pl-8 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-300"/>
          </div>
          {(tab === 'followups' || tab === 'activity') && (
            <select value={employeeFilter} onChange={e => setEmployeeFilter(e.target.value)} className="border border-gray-200 rounded-lg px-2 py-2 text-sm focus:outline-none">
              <option value="">All tele-callers</option>
              {employees.map((e: any) => <option key={e.employee_id} value={e.employee_id}>{e.employee_name || e.employee_id?.slice(0,8)}</option>)}
            </select>
          )}
        </div>
      )}

      {/* Tab content */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm">
        {tab === 'followups'  && <Table columns={followupCols} data={filteredFollowups} loading={fuLoading} emptyMsg="🎉 No follow-ups due in the next 7 days."/>}
        {tab === 'scorecards' && <Table columns={scorecardCols} data={scorecards}        loading={scLoading}  emptyMsg="No tele-caller activity in the last 30 days."/>}
        {tab === 'ghosts'     && <Table columns={ghostCols}    data={filteredGhosts}    loading={gLoading}  emptyMsg="✓ No ghost leads — every assigned lead has been contacted in the last 7 days."/>}
        {tab === 'activity'   && <Table columns={activityCols} data={activity}          loading={aLoading}  emptyMsg="No recent calls."/>}
      </div>

      {/* ── Reschedule modal ─────────────────────────────────────── */}
      <Modal open={!!rescheduleFor} onClose={() => setRescheduleFor(null)} title={`Reschedule follow-up · ${rescheduleFor?.lead_name || ''}`} size="sm">
        <div className="space-y-3">
          <div className="rounded-lg bg-blue-50 border border-blue-100 text-blue-900 text-xs p-3">
            Current due: <b>{rescheduleFor?.next_followup_date ? formatDate(rescheduleFor.next_followup_date) : '—'}</b> · Tele-caller: <b>{rescheduleFor?.employee_name || '—'}</b>
          </div>
          <Input type="date" label="New follow-up date" value={reschedDate} onChange={(e: any) => setReschedDate(e.target.value)} min={today()}/>
          <Textarea label="Note (optional)" value={reschedNote} onChange={(e: any) => setReschedNote(e.target.value)} rows={3} placeholder="why are you postponing?"/>
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <Button variant="secondary" onClick={() => setRescheduleFor(null)}>Cancel</Button>
          <Button onClick={() => reschedule.mutate({ id: rescheduleFor.id, date: reschedDate, note: reschedNote })} loading={reschedule.isPending}><RotateCcw size={14}/>Reschedule</Button>
        </div>
      </Modal>

      {/* ── View call details modal ──────────────────────────────── */}
      <Modal open={!!viewCall} onClose={() => setViewCall(null)} title={`Call · ${viewCall?.lead_name || ''}`}>
        {viewCall && (
          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-3">
              <Detail label="Tele-caller" value={viewCall.employee_name}/>
              <Detail label="Lead phone" value={viewCall.phone}/>
              <Detail label="Type" value={viewCall.call_type}/>
              <Detail label="Status" value={viewCall.status}/>
              <Detail label="Duration" value={fmtMin(viewCall.duration || 0)}/>
              <Detail label="Date" value={`${formatDate(viewCall.call_date)} ${(viewCall.call_time || '').slice(0,5)}`}/>
              <Detail label="Next follow-up" value={viewCall.next_followup_date ? formatDate(viewCall.next_followup_date) : '—'}/>
              <Detail label="Major objection" value={viewCall.major_objection || '—'} accent="text-rose-700"/>
            </div>
            <div>
              <div className="text-xs text-gray-500 mb-1">Notes</div>
              <div className="rounded-lg bg-gray-50 border border-gray-200 p-3 text-sm whitespace-pre-wrap">{viewCall.notes || '—'}</div>
            </div>
            {viewCall.feedback && (
              <div>
                <div className="text-xs text-gray-500 mb-1">Feedback</div>
                <div className="rounded-lg bg-gray-50 border border-gray-200 p-3 text-sm whitespace-pre-wrap">{viewCall.feedback}</div>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  )
}

function Kpi({ icon, label, value, sub, tint }: any) {
  return (
    <div className={`rounded-xl border p-3 ${tint}`}>
      <div className="flex items-center justify-between">
        {icon}<div className="text-xl font-bold">{value}</div>
      </div>
      <div className="text-xs text-gray-500 mt-0.5">{label}</div>
      {sub && <div className="text-[10px] text-gray-400">{sub}</div>}
    </div>
  )
}

function Detail({ label, value, accent }: any) {
  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
      <div className="text-[10px] text-gray-500">{label}</div>
      <div className={`text-sm font-semibold ${accent || 'text-gray-900'}`}>{value || '—'}</div>
    </div>
  )
}

function daysBetween(a: string, b: string): number {
  const da = new Date(a), db = new Date(b)
  return Math.round((da.getTime() - db.getTime()) / 86400000)
}
