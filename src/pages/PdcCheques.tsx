// PDC (post-dated cheque) register.
//
// Customers hand over a stack of cheques at booking time, dated across the coming
// months.  Until a cheque actually clears it is a promise, not money — so PDCs live
// in bp_pdc_cheques, NOT in bp_payments.  If they were payments they would inflate
// total_collected and pay the broker commission on money that hasn't arrived (and
// might bounce).
//
// A cheque becomes exactly one verified bp_payments row at the moment it clears, via
// the pdc_clear_cheque() RPC — cheque row and payment row are written in one
// transaction, and the UNIQUE payment_id link makes a double-clear impossible even if
// the button is double-clicked.  Bouncing a cleared cheque deletes that payment again
// so the commission unwinds with it (pdc_bounce_cheque()).
import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { Table } from '@/components/ui/Table.tsx'
import { Button } from '@/components/ui/Button.tsx'
import { Input, Select, Textarea } from '@/components/ui/Input.tsx'
import { Modal } from '@/components/ui/Modal.tsx'
import { Badge } from '@/components/ui/Badge.tsx'
import { formatINR, formatDate } from '@/lib/utils'
import { Plus, Search, Download, X, AlertTriangle, CheckCircle2, Landmark, Phone, MessageCircle } from 'lucide-react'
import { waLink } from '@/lib/whatsapp'
import toast from 'react-hot-toast'

type Status = 'pending' | 'deposited' | 'cleared' | 'bounced' | 'cancelled'

const STATUS_META: Record<Status, { label: string; className: string }> = {
  pending:   { label: 'Pending',   className: 'bg-amber-50 text-amber-700 border border-amber-200' },
  deposited: { label: 'Deposited', className: 'bg-blue-50 text-blue-700 border border-blue-200' },
  cleared:   { label: 'Cleared',   className: 'bg-emerald-50 text-emerald-700 border border-emerald-200' },
  bounced:   { label: 'Bounced',   className: 'bg-red-50 text-red-700 border border-red-200' },
  cancelled: { label: 'Cancelled', className: 'bg-gray-100 text-gray-600 border border-gray-200' },
}

// Which bucket the money lands in once the cheque clears.  Mirrors
// bp_payments.payment_type so the created payment always passes its check constraint.
const PAYMENT_TYPES = [
  { value: 'emi',          label: 'EMI instalment' },
  { value: 'booking',      label: 'Booking amount' },
  { value: 'token',        label: 'Token' },
  { value: 'full_payment', label: 'Full payment' },
]

const today = () => new Date().toISOString().slice(0, 10)
const addMonths = (iso: string, n: number) => {
  const d = new Date(iso)
  const day = d.getDate()
  d.setMonth(d.getMonth() + n)
  // Clamp for short months so 31 Jan + 1 month lands on 28/29 Feb, not 2/3 Mar.
  if (d.getDate() < day) d.setDate(0)
  return d.toISOString().slice(0, 10)
}

// "CHQ000123" + 1 → "CHQ000124".  Only the trailing digits move, and the width is
// preserved, which is exactly how a chequebook runs.
const bumpChequeNo = (no: string, n: number) => {
  const m = (no || '').match(/^(.*?)(\d+)(\D*)$/)
  if (!m) return n === 0 ? no : `${no}-${n + 1}`
  const next = String(Number(m[2]) + n).padStart(m[2].length, '0')
  return `${m[1]}${next}${m[3]}`
}

const EMPTY_FORM = {
  booking_id: '', cheque_no: '', bank_name: '', branch: '',
  cheque_date: today(), amount: '', payment_type: 'emi', notes: '',
  series: false, series_count: '12', series_interval: '1',
}

export default function PdcCheques() {
  const qc = useQueryClient()
  const [modal, setModal] = useState(false)
  const [form, setForm] = useState<any>({ ...EMPTY_FORM })
  const [search, setSearch] = useState('')
  const [filterStatus, setFilterStatus] = useState('')
  const [dueFilter, setDueFilter] = useState<'' | 'overdue' | 'soon' | 'open'>('')
  const [bounceFor, setBounceFor] = useState<any>(null)
  const [deleteFor, setDeleteFor] = useState<any>(null)
  const [bounceReason, setBounceReason] = useState('')
  const set = (k: string, v: any) => setForm((p: any) => ({ ...p, [k]: v }))

  const { data: cheques = [], isLoading } = useQuery({
    queryKey: ['pdc_cheques'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('bp_pdc_cheques')
        .select('*, bp_bookings(booking_no, stage, bp_customers(name, phone))')
        .order('cheque_date', { ascending: true })
      if (error) throw error
      return data || []
    },
  })

  const { data: bookings = [] } = useQuery({
    queryKey: ['pdc_bookings'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('bp_bookings')
        .select('id, booking_no, customer_id, stage, total_amount, bp_customers(name, phone)')
        .in('stage', ['token_received', 'booking_done'])
        .order('created_at', { ascending: false })
      if (error) throw error
      return data || []
    },
  })

  const selectedBooking = (bookings as any[]).find((b: any) => b.id === form.booking_id)

  // Rows the admin is about to create — shown before saving so a 12-cheque series can
  // be eyeballed (and the duplicate guard understood) rather than discovered after.
  const seriesPreview = useMemo(() => {
    const n = form.series ? Math.max(1, Math.min(60, Number(form.series_count) || 1)) : 1
    const step = Math.max(1, Number(form.series_interval) || 1)
    return Array.from({ length: n }, (_, i) => ({
      cheque_no: bumpChequeNo(form.cheque_no, i),
      cheque_date: addMonths(form.cheque_date || today(), i * step),
      amount: Number(form.amount) || 0,
    }))
  }, [form.series, form.series_count, form.series_interval, form.cheque_no, form.cheque_date, form.amount])

  const create = useMutation({
    mutationFn: async () => {
      if (!form.booking_id) throw new Error('Pick the booking these cheques belong to.')
      if (!form.cheque_no.trim()) throw new Error('Enter the cheque number.')
      if (!(Number(form.amount) > 0)) throw new Error('Enter an amount greater than zero.')
      if (!form.cheque_date) throw new Error('Enter the date written on the cheque.')

      const rows = seriesPreview.map(r => ({
        booking_id: form.booking_id,
        customer_id: selectedBooking?.customer_id || null,
        cheque_no: r.cheque_no.trim(),
        bank_name: form.bank_name.trim() || null,
        branch: form.branch.trim() || null,
        cheque_date: r.cheque_date,
        amount: r.amount,
        payment_type: form.payment_type,
        notes: form.notes.trim() || null,
      }))
      const { error } = await supabase.from('bp_pdc_cheques').insert(rows)
      if (error) {
        // uq_bp_pdc_cheque_identity — the same cheque number + bank is already on file.
        if ((error.message || '').toLowerCase().includes('uq_bp_pdc_cheque_identity')) {
          throw new Error('One of these cheque numbers is already entered for this bank. Check the register before re-entering.')
        }
        throw error
      }
      return rows.length
    },
    onSuccess: (n) => {
      qc.invalidateQueries({ queryKey: ['pdc_cheques'] })
      toast.success(`${n} cheque${n === 1 ? '' : 's'} added to the register`)
      setModal(false)
      setForm({ ...EMPTY_FORM })
    },
    onError: (e: any) => toast.error(e.message || 'Could not save the cheques.'),
  })

  const setStatus = useMutation({
    mutationFn: async ({ row, status }: { row: any; status: Status }) => {
      const patch: any = { status }
      if (status === 'deposited') patch.deposited_on = today()
      const { error } = await supabase.from('bp_pdc_cheques').update(patch).eq('id', row.id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pdc_cheques'] })
      toast.success('Cheque updated')
    },
    onError: (e: any) => toast.error(e.message),
  })

  // Clearing goes through the RPC so the cheque row and the payment row are written in
  // one transaction — never an orphan payment, never two payments for one cheque.
  const clear = useMutation({
    mutationFn: async (row: any) => {
      const { error } = await supabase.rpc('pdc_clear_cheque', { p_cheque_id: row.id, p_cleared_on: today() })
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pdc_cheques'] })
      qc.invalidateQueries({ queryKey: ['payments'] })
      qc.invalidateQueries({ queryKey: ['payments_by_booking'] })
      qc.invalidateQueries({ queryKey: ['bookings'] })
      qc.invalidateQueries({ queryKey: ['payouts'] })
      qc.invalidateQueries({ queryKey: ['commission_ledger'] })
      toast.success('Cheque cleared — payment receipt created and commission distributed')
    },
    onError: (e: any) => toast.error(e.message || 'Could not clear the cheque.'),
  })

  const bounce = useMutation({
    mutationFn: async ({ row, reason }: { row: any; reason: string }) => {
      const { error } = await supabase.rpc('pdc_bounce_cheque', { p_cheque_id: row.id, p_reason: reason || null })
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pdc_cheques'] })
      qc.invalidateQueries({ queryKey: ['payments'] })
      qc.invalidateQueries({ queryKey: ['payments_by_booking'] })
      qc.invalidateQueries({ queryKey: ['bookings'] })
      qc.invalidateQueries({ queryKey: ['payouts'] })
      qc.invalidateQueries({ queryKey: ['commission_ledger'] })
      setBounceFor(null); setBounceReason('')
      toast.success('Cheque marked bounced — any payment and commission it created has been reversed')
    },
    onError: (e: any) => toast.error(e.message || 'Could not bounce the cheque.'),
  })

  // Reminder about a specific cheque, in plain English, ready to send.
  const chequeReminder = (c: any) => {
    const name = c.bp_bookings?.bp_customers?.name || 'Sir/Madam'
    const msg = [
      `Dear ${name},`,
      '',
      `This is a reminder from Fanbe Group about your cheque no ${c.cheque_no}`
        + `${c.bank_name ? ` (${c.bank_name})` : ''} dated ${formatDate(c.cheque_date)}`
        + ` for ${formatINR(Number(c.amount || 0))}.`,
      'We will be depositing it shortly. Please make sure the funds are available.',
      '',
      'Thank you.',
    ].join('\n')
    const url = waLink(c.bp_bookings?.bp_customers?.phone, msg)
    if (!url) { toast.error('This customer has no usable phone number saved.'); return }
    window.open(url, '_blank')
  }

  // Delete is for a cheque entered wrongly -- a typo in the number, a duplicate row from a
  // series added twice.  A CLEARED cheque is never deletable: it has already created a
  // payment receipt, and bp_pdc_cheques.payment_id is what ties the two together.  Removing
  // it would leave a receipt in the books that no cheque accounts for.  Bounce it first,
  // which deletes the payment and reverses the commission properly, then delete.
  const removeCheque = useMutation({
    mutationFn: async (row: any) => {
      if (row.status === 'cleared' || row.payment_id) {
        throw new Error('This cheque has cleared and created a receipt. Mark it bounced first, then delete it.')
      }
      const { error } = await supabase.from('bp_pdc_cheques').delete().eq('id', row.id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['pdc_cheques'] })
      setDeleteFor(null)
      toast.success('Cheque removed from the register')
    },
    onError: (e: any) => toast.error(e.message || 'Could not delete the cheque.'),
  })

  const rows = (cheques as any[]).filter((c: any) => {
    if (filterStatus && c.status !== filterStatus) return false
    // The tiles double as filters: reading "6 overdue" and then hunting for those six in
    // the table was the slow part.  Tapping the tile shows exactly those.
    if (dueFilter) {
      const isOpen = c.status === 'pending' || c.status === 'deposited'
      if (!isOpen) return false
      const td = today()
      if (dueFilter === 'overdue' && !(c.cheque_date < td)) return false
      if (dueFilter === 'soon' && !(c.cheque_date >= td && c.cheque_date <= addMonths(td, 1))) return false
    }
    if (search.trim()) {
      const q = search.toLowerCase()
      const hay = [c.cheque_no, c.bank_name, c.branch, c.bp_bookings?.booking_no,
        c.bp_bookings?.bp_customers?.name, c.bp_bookings?.bp_customers?.phone]
      if (!hay.some((v: any) => (v || '').toString().toLowerCase().includes(q))) return false
    }
    return true
  })

  const t = today()
  const open      = (cheques as any[]).filter((c: any) => c.status === 'pending' || c.status === 'deposited')
  const overdue   = open.filter((c: any) => c.cheque_date < t)
  const dueSoon   = open.filter((c: any) => c.cheque_date >= t && c.cheque_date <= addMonths(t, 1))
  const sum = (list: any[]) => list.reduce((s, c) => s + Number(c.amount || 0), 0)
  const clearedTotal = sum((cheques as any[]).filter((c: any) => c.status === 'cleared'))
  const bouncedList  = (cheques as any[]).filter((c: any) => c.status === 'bounced')

  const exportCsv = () => {
    const headers = ['Cheque No', 'Bank', 'Branch', 'Cheque Date', 'Amount', 'Booking', 'Customer', 'Type', 'Status', 'Deposited On', 'Cleared On', 'Bounce Reason']
    const body = rows.map((c: any) => [
      c.cheque_no, c.bank_name || '', c.branch || '', c.cheque_date, c.amount,
      c.bp_bookings?.booking_no || '', c.bp_bookings?.bp_customers?.name || '',
      c.payment_type, c.status, c.deposited_on || '', c.cleared_on || '', c.bounce_reason || '',
    ])
    const csv = [headers, ...body].map(r => r.map((v: any) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n')
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }))
    const a = document.createElement('a')
    a.href = url; a.download = `pdc-cheques-${t}.csv`; a.click()
    URL.revokeObjectURL(url)
  }

  const columns = [
    {
      header: 'Cheque',
      render: (r: any) => (
        <div>
          <div className="font-mono font-medium text-sm text-gray-900">{r.cheque_no}</div>
          <div className="text-xs text-gray-400">{[r.bank_name, r.branch].filter(Boolean).join(' · ') || '—'}</div>
        </div>
      ),
    },
    {
      header: 'Cheque date',
      render: (r: any) => {
        const isOpen = r.status === 'pending' || r.status === 'deposited'
        const late = isOpen && r.cheque_date < t
        return (
          <div>
            <div className={`text-sm ${late ? 'font-semibold text-red-700' : 'text-gray-700'}`}>{formatDate(r.cheque_date)}</div>
            {late && <div className="text-[11px] text-red-600">overdue — bank it</div>}
          </div>
        )
      },
    },
    {
      header: 'Booking / Customer',
      render: (r: any) => {
        const phone = r.bp_bookings?.bp_customers?.phone
        const isOpen = r.status === 'pending' || r.status === 'deposited'
        return (
          <div>
            <div className="font-mono text-xs text-blue-700">{r.bp_bookings?.booking_no || '—'}</div>
            <div className="text-xs text-gray-500">{r.bp_bookings?.bp_customers?.name || '—'}</div>
            {/* Before banking a cheque somebody rings the customer to check the funds are
                there.  The number was already loaded but not reachable, so that meant
                opening another page first. */}
            {phone && isOpen && (
              <div className="flex items-center gap-2 mt-1">
                <a href={`tel:${phone}`} onClick={e => e.stopPropagation()}
                  className="inline-flex items-center gap-1 text-[11px] text-gray-600 hover:text-blue-700">
                  <Phone size={10}/>{phone}
                </a>
                <button onClick={e => { e.stopPropagation(); chequeReminder(r) }}
                  title="Send a WhatsApp reminder about this cheque"
                  className="inline-flex items-center gap-1 text-[11px] text-emerald-700 hover:text-emerald-900">
                  <MessageCircle size={10}/>Remind
                </button>
              </div>
            )}
          </div>
        )
      },
    },
    { header: 'Amount', render: (r: any) => <span className="font-semibold text-gray-900 tabular-nums">{formatINR(r.amount)}</span> },
    { header: 'Towards', render: (r: any) => <span className="text-xs text-gray-600">{PAYMENT_TYPES.find(p => p.value === r.payment_type)?.label || r.payment_type}</span> },
    {
      header: 'Status',
      render: (r: any) => {
        const meta = STATUS_META[r.status as Status] || STATUS_META.pending
        return (
          <div>
            <Badge label={meta.label} className={meta.className} />
            {r.status === 'cleared' && r.cleared_on && <div className="text-[11px] text-gray-400 mt-0.5">on {formatDate(r.cleared_on)}</div>}
            {r.status === 'bounced' && r.bounce_reason && <div className="text-[11px] text-red-600 mt-0.5 max-w-[160px] truncate" title={r.bounce_reason}>{r.bounce_reason}</div>}
          </div>
        )
      },
    },
    {
      header: 'Action',
      render: (r: any) => {
        const cancelledBooking = r.bp_bookings?.stage === 'cancelled'
        if (r.status === 'cleared') {
          return (
            <button onClick={() => setBounceFor(r)} className="text-xs px-2 py-1 rounded-md border border-red-200 text-red-700 hover:bg-red-50">
              Mark bounced
            </button>
          )
        }
        if (r.status === 'bounced' || r.status === 'cancelled') {
          return (
            <div className="flex flex-wrap gap-1">
              <button onClick={() => setStatus.mutate({ row: r, status: 'pending' })} className="text-xs px-2 py-1 rounded-md border border-gray-200 text-gray-600 hover:bg-gray-50">
                Reopen
              </button>
              <button onClick={() => setDeleteFor(r)} title="Remove a wrongly entered cheque"
                className="text-xs px-2 py-1 rounded-md border border-red-200 text-red-600 hover:bg-red-50">
                Delete
              </button>
            </div>
          )
        }
        return (
          <div className="flex flex-wrap gap-1">
            {r.status === 'pending' && (
              <button onClick={() => setStatus.mutate({ row: r, status: 'deposited' })} className="text-xs px-2 py-1 rounded-md border border-blue-200 text-blue-700 hover:bg-blue-50">
                Deposited
              </button>
            )}
            <button
              onClick={() => clear.mutate(r)}
              disabled={cancelledBooking || clear.isPending}
              title={cancelledBooking ? 'The booking is cancelled — clearing would credit commission on a dead deal.' : 'Money received — create the payment receipt'}
              className="text-xs px-2 py-1 rounded-md bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Cleared
            </button>
            <button onClick={() => setBounceFor(r)} className="text-xs px-2 py-1 rounded-md border border-red-200 text-red-700 hover:bg-red-50">
              Bounced
            </button>
            <button onClick={() => setStatus.mutate({ row: r, status: 'cancelled' })} className="text-xs px-2 py-1 rounded-md border border-gray-200 text-gray-500 hover:bg-gray-50">
              Void
            </button>
            <button onClick={() => setDeleteFor(r)} title="Remove a wrongly entered cheque"
              className="text-xs px-2 py-1 rounded-md border border-red-200 text-red-600 hover:bg-red-50">
              Delete
            </button>
          </div>
        )
      },
    },
  ]

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">PDC Cheques</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Post-dated cheques on file. A cheque becomes a payment receipt only when it clears — until then it does not count as collected money and no commission is paid on it.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={exportCsv}><Download size={14}/>Export</Button>
          <Button onClick={() => { setForm({ ...EMPTY_FORM }); setModal(true) }}><Plus size={14}/>Add cheques</Button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {[
          { key: 'overdue' as const, label: 'Overdue — not yet banked', value: formatINR(sum(overdue)), sub: `${overdue.length} cheque${overdue.length === 1 ? '' : 's'}`, cls: 'text-red-700' },
          { key: 'soon'    as const, label: 'Due within a month',       value: formatINR(sum(dueSoon)), sub: `${dueSoon.length} cheque${dueSoon.length === 1 ? '' : 's'}`, cls: 'text-amber-700' },
          { key: 'open'    as const, label: 'On file (uncleared)',      value: formatINR(sum(open)),    sub: `${open.length} cheque${open.length === 1 ? '' : 's'}`, cls: 'text-blue-700' },
          { key: ''        as const, label: 'Cleared to date',          value: formatINR(clearedTotal), sub: `${bouncedList.length} bounced`, cls: 'text-emerald-700' },
        ].map((k) => {
          const selectable = k.key !== ''
          const active = selectable && dueFilter === k.key
          return (
            <button key={k.label} type="button"
              onClick={() => { if (!selectable) return; setDueFilter(active ? '' : k.key); setFilterStatus('') }}
              title={selectable ? (active ? 'Showing these — tap to clear' : 'Tap to show only these') : undefined}
              className={`text-left bg-white border rounded-xl p-3 transition ${
                active ? 'border-gray-900 ring-1 ring-gray-900/10' : 'border-gray-200'
              } ${selectable ? 'hover:border-gray-400 cursor-pointer' : 'cursor-default'}`}>
              <div className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">{k.label}</div>
              <div className={`text-lg font-bold mt-1 ${k.cls}`}>{k.value}</div>
              <div className="text-[11px] text-gray-400">{k.sub}{active ? ' · filtered' : ''}</div>
            </button>
          )
        })}
      </div>

      <div className="bg-white border border-gray-200 rounded-xl">
        <div className="p-3 border-b border-gray-100 flex flex-wrap gap-2 items-center">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"/>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search cheque no, bank, booking or customer"
              className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)} className="px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white">
            <option value="">All statuses</option>
            {Object.entries(STATUS_META).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
          {(search || filterStatus) && (
            <button onClick={() => { setSearch(''); setFilterStatus('') }} className="text-xs text-gray-500 hover:text-gray-800 px-2 py-1 inline-flex items-center gap-1">
              <X size={12}/>Clear
            </button>
          )}
        </div>
        <Table columns={columns} data={rows} loading={isLoading} emptyMsg="No cheques on file yet. Use “Add cheques” when a customer hands over their PDCs." />
      </div>

      {/* ── Add cheques ───────────────────────────────────────────────────── */}
      <Modal open={modal} onClose={() => setModal(false)} title="Add PDC cheques">
        <div className="space-y-3">
          <Select label="Booking" value={form.booking_id} onChange={(e: any) => set('booking_id', e.target.value)}>
            <option value="">Select the booking these cheques are against</option>
            {(bookings as any[]).map((b: any) => (
              <option key={b.id} value={b.id}>
                {b.booking_no} — {b.bp_customers?.name || 'No name'}{b.bp_customers?.phone ? ` (${b.bp_customers.phone})` : ''}
              </option>
            ))}
          </Select>

          <div className="grid grid-cols-2 gap-3">
            <Input label="Cheque number" value={form.cheque_no} onChange={(e: any) => set('cheque_no', e.target.value)} placeholder="e.g. 000123" />
            <Input label="Amount per cheque (₹)" type="number" value={form.amount} onChange={(e: any) => set('amount', e.target.value)} placeholder="e.g. 25000" />
            <Input label="Bank name" value={form.bank_name} onChange={(e: any) => set('bank_name', e.target.value)} placeholder="e.g. HDFC Bank" />
            <Input label="Branch" value={form.branch} onChange={(e: any) => set('branch', e.target.value)} placeholder="e.g. Sector 50, Noida" />
            <Input label="Date on the cheque" type="date" value={form.cheque_date} onChange={(e: any) => set('cheque_date', e.target.value)} />
            <Select label="Money goes towards" value={form.payment_type} onChange={(e: any) => set('payment_type', e.target.value)}>
              {PAYMENT_TYPES.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
            </Select>
          </div>

          {/* A customer normally hands over a whole chequebook's worth at once, so
              entering them one at a time is where duplicates and typos creep in. */}
          <div className="rounded-lg border border-gray-200 overflow-hidden">
            <label className="flex items-center gap-2 px-3 py-2 bg-gray-50 cursor-pointer">
              <input type="checkbox" checked={form.series} onChange={e => set('series', e.target.checked)} className="rounded"/>
              <span className="text-sm font-medium text-gray-800">Customer gave a series of cheques</span>
              <span className="text-[11px] text-gray-500">— auto-number them and space the dates out</span>
            </label>
            {form.series && (
              <div className="p-3 space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <Input label="How many cheques" type="number" value={form.series_count} onChange={(e: any) => set('series_count', e.target.value)} />
                  <Select label="One cheque every" value={form.series_interval} onChange={(e: any) => set('series_interval', e.target.value)}>
                    <option value="1">Month</option>
                    <option value="3">Quarter</option>
                    <option value="6">Half year</option>
                    <option value="12">Year</option>
                  </Select>
                </div>
                <div className="max-h-40 overflow-y-auto rounded-lg border border-gray-100">
                  <table className="w-full text-xs">
                    <thead className="bg-gray-50 sticky top-0">
                      <tr>
                        <th className="text-left px-2 py-1.5 font-semibold text-gray-500">#</th>
                        <th className="text-left px-2 py-1.5 font-semibold text-gray-500">Cheque no</th>
                        <th className="text-left px-2 py-1.5 font-semibold text-gray-500">Date</th>
                        <th className="text-right px-2 py-1.5 font-semibold text-gray-500">Amount</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {seriesPreview.map((r, i) => (
                        <tr key={i}>
                          <td className="px-2 py-1 text-gray-400">{i + 1}</td>
                          <td className="px-2 py-1 font-mono">{r.cheque_no || '—'}</td>
                          <td className="px-2 py-1">{formatDate(r.cheque_date)}</td>
                          <td className="px-2 py-1 text-right tabular-nums">{formatINR(r.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="text-[11px] text-gray-600">
                  Total across {seriesPreview.length} cheque{seriesPreview.length === 1 ? '' : 's'}:{' '}
                  <b>{formatINR(seriesPreview.reduce((s, r) => s + r.amount, 0))}</b>
                  {selectedBooking && <> · booking value {formatINR(Number(selectedBooking.total_amount || 0))}</>}
                </div>
              </div>
            )}
          </div>

          <Textarea label="Notes (optional)" value={form.notes} onChange={(e: any) => set('notes', e.target.value)} rows={2} placeholder="Anything worth remembering about these cheques" />

          <div className="text-[11px] text-gray-600 bg-blue-50 border border-blue-200 rounded-lg px-2.5 py-2 flex items-start gap-1.5">
            <Landmark size={13} className="mt-0.5 shrink-0 text-blue-700"/>
            <span>
              These are recorded as cheques on file only. Nothing is counted as collected and no broker commission is paid until you mark a cheque <b>Cleared</b> — which then creates the payment receipt automatically.
            </span>
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <Button variant="secondary" onClick={() => setModal(false)}>Cancel</Button>
            <Button onClick={() => create.mutate()} loading={create.isPending}>
              Add {seriesPreview.length} cheque{seriesPreview.length === 1 ? '' : 's'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* ── Bounce ────────────────────────────────────────────────────────── */}
      <Modal open={!!deleteFor} onClose={() => setDeleteFor(null)} title="Delete cheque" size="sm">
        {deleteFor && (
          <div className="space-y-3">
            <p className="text-sm text-gray-700">
              Remove cheque <b className="font-mono">{deleteFor.cheque_no}</b>
              {deleteFor.bank_name ? ` (${deleteFor.bank_name})` : ''} for <b>{formatINR(Number(deleteFor.amount || 0))}</b>,
              dated {formatDate(deleteFor.cheque_date)}?
            </p>
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-amber-900">
              Use this only for a cheque entered by mistake — a wrong number, or a duplicate row.
              If the customer actually gave this cheque and it later failed, mark it <b>Bounced</b>
              instead so the register still shows what happened.
            </div>
            <p className="text-xs text-gray-500">
              Nothing else changes: a cheque on file was never counted as money, so no receipt and no
              commission depend on it.
            </p>
          </div>
        )}
        <div className="flex justify-end gap-2 mt-5">
          <Button variant="secondary" onClick={() => setDeleteFor(null)}>Cancel</Button>
          <Button variant="danger" loading={removeCheque.isPending} onClick={() => removeCheque.mutate(deleteFor)}>
            Delete cheque
          </Button>
        </div>
      </Modal>

      <Modal open={!!bounceFor} onClose={() => { setBounceFor(null); setBounceReason('') }} title="Mark cheque bounced" size="sm">
        {bounceFor && (
          <div className="space-y-3">
            <div className="text-sm text-gray-700">
              Cheque <b className="font-mono">{bounceFor.cheque_no}</b> for <b>{formatINR(bounceFor.amount)}</b>
              {bounceFor.bp_bookings?.booking_no && <> on booking <b className="font-mono">{bounceFor.bp_bookings.booking_no}</b></>}.
            </div>
            {bounceFor.status === 'cleared' && (
              <div className="text-xs bg-amber-50 border border-amber-200 text-amber-900 rounded-lg px-2.5 py-2 flex items-start gap-1.5">
                <AlertTriangle size={13} className="mt-0.5 shrink-0"/>
                <span>
                  This cheque was already marked cleared. Bouncing it will <b>delete the payment receipt it created and reverse the broker commission</b>. If that commission is already inside a closed payout cycle, reopen the cycle first.
                </span>
              </div>
            )}
            <Textarea label="Reason from the bank" value={bounceReason} onChange={(e: any) => setBounceReason(e.target.value)} rows={2} placeholder="e.g. insufficient funds, signature mismatch" />
            <div className="flex justify-end gap-2">
              <Button variant="secondary" onClick={() => { setBounceFor(null); setBounceReason('') }}>Cancel</Button>
              <Button variant="danger" loading={bounce.isPending} onClick={() => bounce.mutate({ row: bounceFor, reason: bounceReason })}>
                Mark bounced
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
