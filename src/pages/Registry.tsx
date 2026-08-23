// Registry register — the counterpart to the PDC page, for the last step of a sale.
//
// Admin: "PDC cheque to theek hai, par ye kaise pata chalega ki registry ho gayi?
// real estate me registry bhi hoti hai."
//
// Marking a registry was already possible, but only from a button buried inside a
// booking row — so there was no way to see, across the whole book, which sales are
// registered, which are waiting, and which are actually ready to be registered.  This
// page is that view.
//
// The one piece of judgement it encodes: a plot is READY for registry when the booking
// is confirmed AND the customer has paid in full.  Money outstanding doesn't block the
// registry (part-payment registries do happen and admin can tick through the warning),
// but it should never be presented as ready, because that is how a plot gets signed
// over with lakhs still uncollected.
import { useMemo, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { Modal } from '@/components/ui/Modal.tsx'
import { Button } from '@/components/ui/Button.tsx'
import { Input, Textarea } from '@/components/ui/Input.tsx'
import { Badge } from '@/components/ui/Badge.tsx'
import { formatINR, formatDate } from '@/lib/utils'
import { getCurrentUserId } from '@/lib/closure'
import { bookingValue, balanceOf, isRegistryReady, isRegistryDone } from '@/lib/bookingMath'
import { waLink } from '@/lib/whatsapp'
import { ScrollText, Search, Download, X, CheckCircle2, Clock, AlertTriangle, MessageCircle } from 'lucide-react'
import toast from 'react-hot-toast'

type Tab = 'ready' | 'waiting' | 'done' | 'all'

const TABS: { value: Tab; label: string; sub: string }[] = [
  { value: 'ready',   label: 'Ready for registry', sub: 'Fully paid · registry not done' },
  { value: 'waiting', label: 'Payment pending',    sub: 'Balance outstanding · not ready yet' },
  { value: 'done',    label: 'Registry done',      sub: 'Completed and recorded' },
  { value: 'all',     label: 'All bookings',       sub: 'Everything except cancelled' },
]

const today = () => new Date().toISOString().slice(0, 10)

export default function Registry() {
  const qc = useQueryClient()
  const [tab, setTab] = useState<Tab>('ready')
  const [search, setSearch] = useState('')
  const [filterProject, setFilterProject] = useState('')
  const [target, setTarget] = useState<any>(null)
  const [form, setForm] = useState<any>({ registry_date: today(), registry_doc_no: '', registry_office: '', registry_notes: '', ack_balance: false })
  const [saving, setSaving] = useState(false)

  const { data: bookings = [], isLoading } = useQuery({
    queryKey: ['registry_bookings'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('bp_bookings')
        .select(`
          id, booking_no, legacy_booking_no, stage, application_date, total_amount, plot_total_price,
          registry_date, registry_doc_no, registry_office, registry_notes,
          customer_id, project_id,
          bp_customers(name, phone, customer_code),
          bp_projects(name),
          bp_plots(plot_no),
          bp_booking_plots(position, plot_id, bp_plots(plot_no))
        `)
        .neq('stage', 'cancelled')
        .order('created_at', { ascending: false })
      if (error) throw error
      return data || []
    },
  })

  // Collected money comes from verified payments — the same source the rest of the app
  // treats as truth, so "fully paid" here means the same thing it does everywhere else.
  const { data: paidByBooking = {} } = useQuery<Record<string, number>>({
    queryKey: ['registry_paid'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('bp_payments').select('booking_id, amount').eq('verification_status', 'verified')
      if (error) throw error
      const out: Record<string, number> = {}
      for (const p of data || []) {
        if (!p.booking_id) continue
        out[p.booking_id] = (out[p.booking_id] || 0) + Number(p.amount || 0)
      }
      return out
    },
  })

  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: async () => {
      const { data, error } = await supabase.from('bp_projects').select('id,name').order('name')
      if (error) throw error
      return data || []
    },
  })

  const plotNosOf = (b: any): string[] => {
    const rows = (b?.bp_booking_plots || []) as any[]
    return rows.length > 0
      ? [...rows].sort((x, y) => (x.position || 1) - (y.position || 1)).map(r => r.bp_plots?.plot_no).filter(Boolean)
      : [b?.bp_plots?.plot_no].filter(Boolean)
  }

  const rowsWithState = useMemo(() => (bookings as any[]).map(b => {
    // Value, collected, balance and "ready" all come from lib/bookingMath so this page,
    // the Customer Pipeline and the Today's-work queue can never disagree about whether
    // a booking is finished paying.
    const total   = bookingValue(b)
    const paid    = Number(paidByBooking[b.id] || 0)
    const balance = balanceOf(total, paid)
    const done    = isRegistryDone(b)
    const ready   = isRegistryReady(b, paid)
    return { ...b, total, paid, balance, done, ready }
  }), [bookings, paidByBooking])


  // Reminder for the balance blocking a registry.  Uses the shared waLink so the number
  // is normalised the same way as on every other page.
  const remindBalance = (r: any) => {
    const msg = [
      `Dear ${r.bp_customers?.name || 'Sir/Madam'},`,
      '',
      `This is a reminder from Fanbe Group for booking ${r.booking_no || ''}.`,
      `Balance due: ${formatINR(r.balance)}.`,
      'Your registry can be done once the full payment is received.',
      '',
      'Please pay at your earliest. Ignore this message if you have already paid.',
      '',
      'Thank you.',
    ].join('\n')
    const url = waLink(r.bp_customers?.phone, msg)
    if (!url) { toast.error('This customer has no usable phone number saved.'); return }
    window.open(url, '_blank')
  }

  const rows = rowsWithState.filter(r => {
    if (tab === 'done'    && !r.done) return false
    if (tab === 'ready'   && !r.ready) return false
    if (tab === 'waiting' && (r.done || r.ready)) return false
    if (filterProject && r.project_id !== filterProject) return false
    if (search.trim()) {
      const q = search.toLowerCase()
      const hay = [r.booking_no, r.legacy_booking_no, r.bp_customers?.name, r.bp_customers?.phone,
        r.registry_doc_no, r.registry_office, r.bp_projects?.name, ...plotNosOf(r)]
      if (!hay.some((v: any) => (v || '').toString().toLowerCase().includes(q))) return false
    }
    return true
  })

  const counts = {
    ready:   rowsWithState.filter(r => r.ready).length,
    waiting: rowsWithState.filter(r => !r.done && !r.ready).length,
    done:    rowsWithState.filter(r => r.done).length,
    all:     rowsWithState.length,
  }
  const doneValue    = rowsWithState.filter(r => r.done).reduce((s, r) => s + r.total, 0)
  const readyValue   = rowsWithState.filter(r => r.ready).reduce((s, r) => s + r.total, 0)
  const pendingDues  = rowsWithState.filter(r => !r.done && !r.ready).reduce((s, r) => s + r.balance, 0)

  const openFor = (b: any) => {
    setForm({
      registry_date:   b.registry_date || today(),
      registry_doc_no: b.registry_doc_no || '',
      registry_office: b.registry_office || '',
      registry_notes:  b.registry_notes || '',
      ack_balance: false,
    })
    setTarget(b)
  }

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['registry_bookings'] })
    qc.invalidateQueries({ queryKey: ['bookings'] })
    qc.invalidateQueries({ queryKey: ['plots_avail'] })
    qc.invalidateQueries({ queryKey: ['plots'] })
  }

  const save = async () => {
    if (!target) return
    setSaving(true)
    try {
      const userId = await getCurrentUserId()
      const { error } = await supabase.from('bp_bookings').update({
        registry_date:         form.registry_date || null,
        registry_doc_no:       form.registry_doc_no?.trim() || null,
        registry_office:       form.registry_office?.trim() || null,
        registry_notes:        form.registry_notes?.trim() || null,
        registry_completed_at: new Date().toISOString(),
        registry_completed_by: userId,
        updated_at: new Date().toISOString(),
      }).eq('id', target.id)
      if (error) throw error

      // Registry is the end of the road for the plot.  Checked for an error on purpose —
      // 'registry_done' is the only terminal value bp_plots_status_check accepts.
      const ids = ((target.bp_booking_plots || []) as any[]).map(r => r.plot_id).filter(Boolean)
      if (ids.length > 0) {
        const { error: plotErr } = await supabase.from('bp_plots').update({ status: 'registry_done' }).in('id', ids)
        if (plotErr) throw plotErr
      }
      toast.success('Registry recorded')
      setTarget(null)
      refresh()
    } catch (e: any) {
      toast.error(e?.message || 'Could not save the registry details.')
    } finally {
      setSaving(false)
    }
  }

  const undo = async () => {
    if (!target) return
    setSaving(true)
    try {
      const { error } = await supabase.from('bp_bookings').update({
        registry_date: null, registry_doc_no: null, registry_office: null,
        registry_completed_at: null, registry_completed_by: null,
        updated_at: new Date().toISOString(),
      }).eq('id', target.id)
      if (error) throw error
      // Hand the plots back to the status the booking's stage implies, so inventory
      // doesn't stay stuck on a registry that was entered by mistake.
      const ids = ((target.bp_booking_plots || []) as any[]).map(r => r.plot_id).filter(Boolean)
      if (ids.length > 0) {
        await supabase.from('bp_plots')
          .update({ status: target.stage === 'token_received' ? 'token' : 'booked' })
          .in('id', ids).eq('status', 'registry_done')
      }
      toast.success('Registry entry removed')
      setTarget(null)
      refresh()
    } catch (e: any) {
      toast.error(e?.message || 'Could not remove the registry entry.')
    } finally {
      setSaving(false)
    }
  }

  const exportCsv = () => {
    const headers = ['Booking No', 'Old Register No', 'Customer', 'Phone', 'Project', 'Plots', 'Total', 'Paid', 'Balance', 'Registry Status', 'Registry Date', 'Document No', 'Sub-registrar Office']
    const body = rows.map((r: any) => [
      r.booking_no || '', r.legacy_booking_no || '', r.bp_customers?.name || '', r.bp_customers?.phone || '',
      r.bp_projects?.name || '', plotNosOf(r).join(' | '), r.total, r.paid, r.balance,
      r.done ? 'Done' : r.ready ? 'Ready' : 'Payment pending',
      r.registry_date || '', r.registry_doc_no || '', r.registry_office || '',
    ])
    const csv = [headers, ...body].map(l => l.map((v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }))
    const a = document.createElement('a')
    a.href = url; a.download = `registry-${today()}.csv`; a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="p-4 md:p-8 space-y-5 max-w-6xl mx-auto">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Registry</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Which plots have actually been registered in the customer's name — and which are ready to be.
          </p>
        </div>
        <Button variant="secondary" onClick={exportCsv}><Download size={14}/>Export</Button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'Registry done',      value: String(counts.done),    sub: formatINR(doneValue),   cls: 'text-emerald-700' },
          { label: 'Ready for registry', value: String(counts.ready),   sub: formatINR(readyValue),  cls: 'text-blue-700' },
          { label: 'Payment pending',    value: String(counts.waiting), sub: `${formatINR(pendingDues)} to collect`, cls: 'text-amber-700' },
          { label: 'Total bookings',     value: String(counts.all),     sub: 'excluding cancelled',  cls: 'text-gray-900' },
        ].map(k => (
          <div key={k.label} className="bg-white border border-gray-200 rounded-xl p-4">
            <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">{k.label}</div>
            <div className={`text-2xl font-bold mt-1 ${k.cls}`}>{k.value}</div>
            <div className="text-[11px] text-gray-400 mt-0.5">{k.sub}</div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        {TABS.map(t => (
          <button key={t.value} onClick={() => setTab(t.value)}
            className={`text-left px-3 py-2 rounded-xl border transition ${
              tab === t.value ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-700 border-gray-200 hover:border-gray-400'}`}>
            <div className="text-xs font-semibold">{t.label} ({counts[t.value]})</div>
            <div className={`text-[10px] ${tab === t.value ? 'text-white/70' : 'text-gray-400'}`}>{t.sub}</div>
          </button>
        ))}
      </div>

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden">
        <div className="p-3 border-b border-gray-100 flex flex-wrap gap-2 items-center">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"/>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search booking no, customer, plot or document no"
              className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"/>
          </div>
          <select value={filterProject} onChange={e => setFilterProject(e.target.value)} className="px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white">
            <option value="">All projects</option>
            {(projects as any[]).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
          {(search || filterProject) && (
            <button onClick={() => { setSearch(''); setFilterProject('') }} className="text-xs text-gray-500 hover:text-gray-800 px-2 py-1 inline-flex items-center gap-1"><X size={12}/>Clear</button>
          )}
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-y border-gray-100">
              <tr>
                {['Booking', 'Customer', 'Plot / Project', 'Value', 'Balance', 'Registry', ''].map(h => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {isLoading ? (
                <tr><td colSpan={7} className="py-12 text-center text-gray-400">Loading…</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={7} className="py-12 text-center text-gray-400">Nothing in this list.</td></tr>
              ) : rows.map((r: any) => (
                <tr key={r.id} className="hover:bg-blue-50/30">
                  <td className="px-4 py-3 whitespace-nowrap">
                    <Link to={`/customer-pipeline?booking=${r.id}`} className="font-mono text-xs font-semibold text-blue-700 hover:underline">{r.booking_no}</Link>
                    {r.legacy_booking_no && <div className="font-mono text-[10px] text-gray-400">पुराना {r.legacy_booking_no}</div>}
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-gray-900">{r.bp_customers?.name || '—'}</div>
                    <div className="text-xs text-gray-400">{r.bp_customers?.phone || '—'}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-gray-900">{plotNosOf(r).join(', ') || '—'}</div>
                    <div className="text-xs text-gray-400">{r.bp_projects?.name || '—'}</div>
                  </td>
                  <td className="px-4 py-3 tabular-nums text-gray-700 whitespace-nowrap">{formatINR(r.total)}</td>
                  <td className="px-4 py-3 tabular-nums whitespace-nowrap">
                    {r.balance > 0
                      ? <span className="text-amber-700 font-semibold">{formatINR(r.balance)}</span>
                      : <span className="text-emerald-700">Clear</span>}
                  </td>
                  <td className="px-4 py-3">
                    {r.done ? (
                      <div>
                        <Badge label="Done" className="bg-emerald-50 text-emerald-700 border border-emerald-200"/>
                        <div className="text-[11px] text-gray-400 mt-0.5">
                          {formatDate(r.registry_date)}{r.registry_doc_no ? ` · ${r.registry_doc_no}` : ''}
                        </div>
                      </div>
                    ) : r.ready ? (
                      <Badge label="Ready" className="bg-blue-50 text-blue-700 border border-blue-200"/>
                    ) : (
                      <Badge label="Payment pending" className="bg-amber-50 text-amber-700 border border-amber-200"/>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right whitespace-nowrap">
                    {/* On this page a pending registry is almost always a pending balance,
                        and chasing it meant leaving for another screen. */}
                    {!r.done && r.balance > 0 && r.bp_customers?.phone && (
                      <Button size="sm" variant="ghost" onClick={() => remindBalance(r)}
                        title="WhatsApp the customer about the outstanding balance">
                        <MessageCircle size={12}/>Remind
                      </Button>
                    )}
                    <Button size="sm" variant={r.done ? 'ghost' : 'secondary'} onClick={() => openFor(r)}>
                      <ScrollText size={12}/>{r.done ? 'View / edit' : 'Mark registry'}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Mark / edit registry ───────────────────────────────────────────── */}
      <Modal open={!!target} onClose={() => setTarget(null)} title={`Registry — ${target?.booking_no || ''}`} size="sm">
        {target && (
          <div className="space-y-3">
            <div className="text-xs bg-gray-50 border border-gray-200 rounded-lg px-2.5 py-2 text-gray-700 grid grid-cols-2 gap-y-1 gap-x-3">
              <span>Customer: <b>{target.bp_customers?.name || '—'}</b></span>
              <span>Plot{plotNosOf(target).length > 1 ? 's' : ''}: <b>{plotNosOf(target).join(', ') || '—'}</b></span>
              <span>Total: <b>{formatINR(target.total)}</b></span>
              <span>Collected: <b>{formatINR(target.paid)}</b></span>
            </div>

            {target.balance > 0 && (
              <label className="flex items-start gap-2 text-xs bg-amber-50 border border-amber-200 text-amber-900 rounded-lg px-2.5 py-2 cursor-pointer">
                <input type="checkbox" className="mt-0.5 rounded" checked={!!form.ack_balance}
                  onChange={e => setForm((p: any) => ({ ...p, ack_balance: e.target.checked }))}/>
                <span>
                  <AlertTriangle size={11} className="inline mr-1"/>
                  <b>{formatINR(target.balance)} is still outstanding.</b> Tick to confirm the registry is going ahead anyway.
                </span>
              </label>
            )}

            <div className="grid grid-cols-2 gap-3">
              <Input label="Registry date" type="date" value={form.registry_date}
                onChange={(e: any) => setForm((p: any) => ({ ...p, registry_date: e.target.value }))}/>
              <Input label="Registered document no." value={form.registry_doc_no}
                onChange={(e: any) => setForm((p: any) => ({ ...p, registry_doc_no: e.target.value }))} placeholder="as on the deed"/>
            </div>
            <Input label="Sub-registrar office" value={form.registry_office}
              onChange={(e: any) => setForm((p: any) => ({ ...p, registry_office: e.target.value }))} placeholder="e.g. Tehsil Ballabgarh"/>
            <Textarea label="Notes" rows={2} value={form.registry_notes}
              onChange={(e: any) => setForm((p: any) => ({ ...p, registry_notes: e.target.value }))}/>

            <div className="text-[11px] text-gray-600 bg-teal-50 border border-teal-200 rounded-lg px-2.5 py-2">
              Saving marks {plotNosOf(target).length > 1 ? 'these plots' : 'this plot'} <b>registry done</b> — the terminal state. They leave the available pool and later edits to the booking will not move them back.
            </div>

            <div className="flex justify-between gap-2 pt-1">
              {target.done
                ? <Button variant="ghost" className="text-red-600" loading={saving} onClick={undo}>Remove registry entry</Button>
                : <span/>}
              <div className="flex gap-2">
                <Button variant="secondary" onClick={() => setTarget(null)}>Cancel</Button>
                <Button loading={saving} disabled={!form.registry_date || (target.balance > 0 && !form.ack_balance)} onClick={save}>
                  {target.done ? 'Update registry' : 'Mark registry done'}
                </Button>
              </div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
