import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { Table } from '@/components/ui/Table.tsx'
import { Button } from '@/components/ui/Button.tsx'
import { Badge } from '@/components/ui/Badge.tsx'
import { Input, Select, Textarea } from '@/components/ui/Input.tsx'
import { Modal } from '@/components/ui/Modal.tsx'
import { formatINR, formatDate } from '@/lib/utils'
import { Plus, CheckCircle, XCircle, Printer, Clock } from 'lucide-react'
import toast from 'react-hot-toast'

const EMPTY = {
  booking_id: '', payment_type: 'token', amount: '',
  payment_mode: 'cash', utr_ref: '', payment_date: '',
  received_by: '', notes: '', verification_status: 'unverified',
}

const STATUS_COLORS: Record<string, string> = {
  unverified: 'bg-yellow-50 text-yellow-700 border border-yellow-200',
  verified:   'bg-green-50 text-green-700 border border-green-200',
  rejected:   'bg-red-50 text-red-700 border border-red-200',
}

const TABS = ['All', 'Unverified', 'Verified', 'Rejected'] as const
type Tab = typeof TABS[number]

function printReceipt(p: any) {
  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8"/>
  <title>Payment Receipt — ${p.id?.slice(0,8).toUpperCase()}</title>
  <style>
    body{font-family:Arial,sans-serif;max-width:520px;margin:40px auto;color:#1a1a1a;font-size:13px}
    .logo{font-size:22px;font-weight:800;color:#1d4ed8;letter-spacing:-0.5px}  
    .title{font-size:16px;font-weight:700;margin:20px 0 4px}
    .sub{color:#6b7280;font-size:12px;margin-bottom:20px}
    table{width:100%;border-collapse:collapse}
    td{padding:8px 0;border-bottom:1px solid #f3f4f6;vertical-align:top}
    td:first-child{color:#6b7280;width:44%}
    td:last-child{font-weight:600;text-align:right}
    .amount{font-size:28px;font-weight:800;color:#16a34a;text-align:center;padding:20px;background:#f0fdf4;border-radius:12px;margin:20px 0}
    .footer{margin-top:32px;text-align:center;color:#9ca3af;font-size:11px;border-top:1px dashed #e5e7eb;padding-top:16px}
    .badge{display:inline-block;padding:2px 10px;border-radius:99px;font-size:11px;font-weight:700;background:#dcfce7;color:#15803d}
    @media print{body{margin:0}}
  </style>
</head>
<body>
  <div class="logo">FANBE</div>
  <div class="title">Payment Receipt</div>
  <div class="sub">Receipt No: RCP-${p.id?.slice(0,8).toUpperCase()} &nbsp;·&nbsp; <span class="badge">VERIFIED</span></div>
  <div class="amount">${formatINR(p.amount)}</div>
  <table>
    <tr><td>Booking ID</td><td>${p.booking_id?.slice(0,8)}…</td></tr>
    <tr><td>Payment Type</td><td style="text-transform:capitalize">${p.payment_type?.replace(/_/g,' ')}</td></tr>
    <tr><td>Payment Mode</td><td style="text-transform:uppercase">${p.payment_mode}</td></tr>
    <tr><td>UTR / Ref No</td><td>${p.utr_ref || '—'}</td></tr>
    <tr><td>Payment Date</td><td>${p.payment_date ? new Date(p.payment_date).toLocaleDateString('en-IN',{day:'2-digit',month:'short',year:'numeric'}) : '—'}</td></tr>
    <tr><td>Received By</td><td>${p.received_by || '—'}</td></tr>
    ${p.notes ? `<tr><td>Notes</td><td>${p.notes}</td></tr>` : ''}
    <tr><td>Verified At</td><td>${p.verified_at ? new Date(p.verified_at).toLocaleString('en-IN') : '—'}</td></tr>
  </table>
  <div class="footer">This is a system-generated receipt from Fanbe Payout Admin.<br/>For queries contact support.</div>
  <script>window.onload=()=>{window.print();}<\/script>
</body>
</html>`
  const w = window.open('', '_blank', 'width=600,height=800')
  if (w) { w.document.write(html); w.document.close() }
}

export default function Payments() {
  const qc = useQueryClient()
  const [modal, setModal]     = useState(false)
  const [preview, setPreview] = useState<any>(null)
  const [tab, setTab]         = useState<Tab>('All')
  const [form, setForm]       = useState<any>(EMPTY)
  const set = (k: string, v: any) => setForm((p: any) => ({ ...p, [k]: v }))

  const { data: payments = [], isLoading } = useQuery({
    queryKey: ['payments'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('bp_payments')
        .select('*,bp_bookings(booking_no,bp_customers(name))')
        .order('payment_date', { ascending: false })
      if (error) throw error
      return data
    },
  })

  const { data: bookings = [] } = useQuery({
    queryKey: ['bookings_list'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('bp_bookings')
        .select('id,booking_no,bp_customers(name)')
      if (error) throw error
      return data
    },
  })

  const create = useMutation({
    mutationFn: async (p: any) => {
      const { data, error } = await supabase.from('bp_payments').insert(p).select().single()
      if (error) throw error
      return data
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['payments'] }); toast.success('Payment recorded') },
    onError: (e: any) => toast.error(e.message),
  })

  const updateStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const { error } = await supabase
        .from('bp_payments')
        .update({ verification_status: status, verified_at: new Date().toISOString() })
        .eq('id', id)
      if (error) throw error
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['payments'] })
      const updated = payments.find((p: any) => p.id === vars.id)
      if (vars.status === 'verified' && updated) printReceipt({ ...updated, verification_status: 'verified', verified_at: new Date().toISOString() })
      toast.success(vars.status === 'verified' ? 'Payment verified — receipt printed 🖨️' : 'Payment rejected')
      setPreview(null)
    },
    onError: (e: any) => toast.error(e.message),
  })

  const save = async () => {
    await create.mutateAsync({ ...form, amount: Number(form.amount) })
    setModal(false); setForm(EMPTY)
  }

  // Filter
  const filtered = tab === 'All' ? payments : payments.filter((p: any) => p.verification_status?.toLowerCase() === tab.toLowerCase())

  // Stats
  const unverifiedCount = payments.filter((p: any) => p.verification_status === 'unverified').length

  const cols = [
    {
      header: 'Booking',
      render: (r: any) => (
        <div>
          <div className="font-medium text-xs">{r.bp_bookings?.booking_no || r.booking_id?.slice(0,8) + '…'}</div>
          <div className="text-xs text-gray-400">{r.bp_bookings?.bp_customers?.name}</div>
        </div>
      ),
    },
    { header: 'Type',   render: (r: any) => <span className="capitalize text-xs">{r.payment_type?.replace(/_/g,' ')}</span> },
    { header: 'Amount', render: (r: any) => <span className="font-semibold text-green-700">{formatINR(r.amount)}</span> },
    { header: 'Mode',   render: (r: any) => <span className="uppercase text-xs">{r.payment_mode}</span> },
    { header: 'UTR/Ref',render: (r: any) => <span className="font-mono text-xs">{r.utr_ref || '—'}</span> },
    { header: 'Date',   render: (r: any) => formatDate(r.payment_date) },
    {
      header: 'Status',
      render: (r: any) => (
        <Badge
          label={r.verification_status || 'unverified'}
          className={STATUS_COLORS[r.verification_status || 'unverified']}
        />
      ),
    },
    {
      header: 'Actions',
      render: (r: any) => (
        <div className="flex gap-1">
          {r.verification_status !== 'verified' && (
            <Button size="sm" onClick={() => updateStatus.mutate({ id: r.id, status: 'verified' })} loading={updateStatus.isPending}>
              <CheckCircle size={12} />Verify
            </Button>
          )}
          {r.verification_status !== 'rejected' && (
            <Button size="sm" variant="danger" onClick={() => updateStatus.mutate({ id: r.id, status: 'rejected' })} loading={updateStatus.isPending}>
              <XCircle size={12} />Reject
            </Button>
          )}
          {r.verification_status === 'verified' && (
            <Button size="sm" variant="ghost" onClick={() => printReceipt(r)}>
              <Printer size={12} />Receipt
            </Button>
          )}
        </div>
      ),
    },
  ]

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Payments</h1>
          <p className="text-sm text-gray-500">Customer payment records and verification</p>
        </div>
        <Button onClick={() => setModal(true)}><Plus size={14} />Record Payment</Button>
      </div>

      {/* Unverified alert banner */}
      {unverifiedCount > 0 && (
        <div className="flex items-center gap-3 mb-5 p-3 bg-yellow-50 border border-yellow-200 rounded-xl text-sm">
          <Clock size={16} className="text-yellow-600 shrink-0" />
          <span className="text-yellow-800 font-medium">{unverifiedCount} payment{unverifiedCount > 1 ? 's' : ''} awaiting verification</span>
          <button onClick={() => setTab('Unverified')} className="ml-auto text-yellow-700 underline text-xs">View →</button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 mb-4 bg-gray-100 p-1 rounded-xl w-fit">
        {TABS.map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${
              tab === t ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'
            }`}
          >
            {t}
            {t === 'Unverified' && unverifiedCount > 0 && (
              <span className="ml-1.5 bg-yellow-500 text-white text-xs rounded-full px-1.5 py-0.5">{unverifiedCount}</span>
            )}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm">
        <Table columns={cols} data={filtered} loading={isLoading} />
      </div>

      {/* Record Payment Modal */}
      <Modal open={modal} onClose={() => setModal(false)} title="Record Payment">
        <div className="grid grid-cols-2 gap-4">
          <Select label="Booking" value={form.booking_id} onChange={(e: any) => set('booking_id', e.target.value)} className="col-span-2">
            <option value="">Select Booking</option>
            {(bookings as any[]).map((b: any) => (
              <option key={b.id} value={b.id}>{b.booking_no} — {b.bp_customers?.name}</option>
            ))}
          </Select>
          <Select label="Payment Type" value={form.payment_type} onChange={(e: any) => set('payment_type', e.target.value)}>
            {['token','booking','emi','full_payment','miscellaneous'].map(t => <option key={t} value={t}>{t.replace(/_/g,' ')}</option>)}
          </Select>
          <Input label="Amount (₹)" type="number" value={form.amount} onChange={(e: any) => set('amount', e.target.value)} />
          <Select label="Payment Mode" value={form.payment_mode} onChange={(e: any) => set('payment_mode', e.target.value)}>
            {['cash','neft','rtgs','imps','upi','cheque','dd'].map(m => <option key={m} value={m}>{m.toUpperCase()}</option>)}
          </Select>
          <Input label="UTR / Ref No" value={form.utr_ref} onChange={(e: any) => set('utr_ref', e.target.value)} />
          <Input label="Payment Date" type="date" value={form.payment_date} onChange={(e: any) => set('payment_date', e.target.value)} />
          <Input label="Received By" value={form.received_by} onChange={(e: any) => set('received_by', e.target.value)} />
          <Textarea label="Notes" value={form.notes} onChange={(e: any) => set('notes', e.target.value)} className="col-span-2" rows={2} />
        </div>
        <div className="flex justify-end gap-2 mt-6">
          <Button variant="secondary" onClick={() => setModal(false)}>Cancel</Button>
          <Button onClick={save} loading={create.isPending}>Save Payment</Button>
        </div>
      </Modal>
    </div>
  )
}
