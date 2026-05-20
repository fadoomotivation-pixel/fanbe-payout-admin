import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { Table } from '@/components/ui/Table.tsx'
import { Button } from '@/components/ui/Button.tsx'
import { Badge } from '@/components/ui/Badge.tsx'
import { Input, Select, Textarea } from '@/components/ui/Input.tsx'
import { Modal } from '@/components/ui/Modal.tsx'
import { formatINR, formatDate } from '@/lib/utils'
import { printPaymentReceipt } from '@/lib/printTemplates'
import { distributePaymentCommission, reversePaymentCommission } from '@/lib/payoutEngine'
import { Plus, CheckCircle, XCircle, Printer, Clock } from 'lucide-react'
import toast from 'react-hot-toast'

const EMPTY = {
  booking_id:'', payment_type:'token', amount:'', payment_mode:'cash',
  utr_ref:'', payment_date:'', received_by:'', notes:'',
  verification_status:'unverified',
  receipt_no:'', drawn_on_bank:'', branch:'', instalment_no:'',
  rupees_in_words:'', sponsor_name:'',
  is_cash_adjustment:false, subject_to_realisation:true,
}

const STATUS_COLORS: Record<string, string> = {
  unverified: 'bg-yellow-50 text-yellow-700 border border-yellow-200',
  verified:   'bg-green-50 text-green-700 border border-green-200',
  rejected:   'bg-red-50 text-red-700 border border-red-200',
}

const TABS = ['All', 'Unverified', 'Verified', 'Rejected'] as const
type Tab = typeof TABS[number]

function toWordsINR(n: number): string {
  if (!n || isNaN(n)) return ''
  const a = ['','One','Two','Three','Four','Five','Six','Seven','Eight','Nine','Ten','Eleven','Twelve','Thirteen','Fourteen','Fifteen','Sixteen','Seventeen','Eighteen','Nineteen']
  const b = ['','','Twenty','Thirty','Forty','Fifty','Sixty','Seventy','Eighty','Ninety']
  const num = Math.floor(n)
  if (num === 0) return 'Zero only'
  const inWords = (x: number): string => {
    if (x < 20) return a[x]
    if (x < 100) return b[Math.floor(x/10)] + (x%10 ? ' ' + a[x%10] : '')
    if (x < 1000) return a[Math.floor(x/100)] + ' Hundred' + (x%100 ? ' ' + inWords(x%100) : '')
    return ''
  }
  let out = ''
  const crore = Math.floor(num / 10000000)
  const lakh  = Math.floor((num % 10000000) / 100000)
  const thou  = Math.floor((num % 100000) / 1000)
  const rest  = num % 1000
  if (crore) out += inWords(crore) + ' Crore '
  if (lakh)  out += inWords(lakh) + ' Lakh '
  if (thou)  out += inWords(thou) + ' Thousand '
  if (rest)  out += inWords(rest)
  return (out.trim() || 'Zero') + ' only'
}

export default function Payments() {
  const qc = useQueryClient()
  const [modal, setModal] = useState(false)
  const [tab, setTab] = useState<Tab>('All')
  const [form, setForm] = useState<any>(EMPTY)
  const set = (k: string, v: any) => setForm((p: any) => ({ ...p, [k]: v }))

  const { data: payments = [], isLoading } = useQuery({
    queryKey: ['payments'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('bp_payments')
        .select('*,bp_bookings(booking_no,bp_customers(*),bp_plots(*),bp_projects(*))')
        .order('payment_date', { ascending: false })
      if (error) throw error
      return data
    },
  })

  const { data: bookings = [] } = useQuery({
    queryKey: ['bookings_list'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('bp_bookings').select('id,booking_no,bp_customers(name)')
      if (error) throw error
      return data
    },
  })

  const create = useMutation({
    mutationFn: async (p: any) => {
      // Auto-assign receipt no via DB sequence if not provided
      if (!p.receipt_no) {
        const { data: rn } = await supabase.rpc('next_receipt_no')
        if (rn) p.receipt_no = rn
      }
      const { data, error } = await supabase.from('bp_payments').insert(p).select().single()
      if (error) throw error
      // Per-payment MLM distribution — only fire when the payment is created already verified.
      // Otherwise wait for updateStatus → verified.
      let distributed = 0
      if (data?.verification_status === 'verified' && data.booking_id && Number(data.amount) > 0) {
        const rows = await distributePaymentCommission({ bookingId: data.booking_id, paymentId: data.id, amount: Number(data.amount) })
        distributed = rows.length
      }
      return { ...data, _distributed: distributed }
    },
    onSuccess: (res: any) => {
      qc.invalidateQueries({ queryKey: ['payments'] })
      qc.invalidateQueries({ queryKey: ['payments_by_booking'] })
      qc.invalidateQueries({ queryKey: ['payouts'] })
      qc.invalidateQueries({ queryKey: ['commission_ledger'] })
      qc.invalidateQueries({ queryKey: ['bookings'] })
      toast.success(`Payment recorded${res?._distributed ? ` · MLM × ${res._distributed}` : ''}`)
    },
    onError: (e: any) => toast.error(e.message),
  })

  const updateStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      const payload: any = { verification_status: status }
      if (status === 'verified') payload.verified_at = new Date().toISOString()
      if (status === 'rejected') payload.verified_at = null
      const { error } = await supabase
        .from('bp_payments')
        .update(payload)
        .eq('id', id)
      if (error) throw error

      // Wire MLM to verification:
      // - verified → distribute commission for this payment (idempotent on payment_id)
      // - rejected → reverse any commission previously distributed for this payment
      const row = payments.find((p: any) => p.id === id)
      let distributed = 0
      if (status === 'verified' && row?.booking_id && Number(row.amount) > 0) {
        const rows = await distributePaymentCommission({ bookingId: row.booking_id, paymentId: id, amount: Number(row.amount) })
        distributed = rows.length
      } else if (status === 'rejected') {
        await reversePaymentCommission(id)
      }
      return distributed
    },
    onSuccess: (distributed, vars) => {
      qc.invalidateQueries({ queryKey: ['payments'] })
      qc.invalidateQueries({ queryKey: ['payments_by_booking'] })
      qc.invalidateQueries({ queryKey: ['payouts'] })
      qc.invalidateQueries({ queryKey: ['commission_ledger'] })
      qc.invalidateQueries({ queryKey: ['bookings'] })
      const updated = payments.find((p: any) => p.id === vars.id)
      if (vars.status === 'verified' && updated) printPaymentReceipt({ ...updated, verification_status: 'verified', verified_at: new Date().toISOString() })
      toast.success(
        vars.status === 'verified'
          ? `Payment verified${distributed ? ` · MLM × ${distributed}` : ''} — receipt printed`
          : 'Payment rejected — commissions reversed'
      )
    },
    onError: (e: any) => toast.error(e.message),
  })

  const save = async () => {
    const amt = Number(form.amount) || 0
    const payload = {
      ...form,
      amount: amt,
      instalment_no: form.instalment_no ? Number(form.instalment_no) : null,
      rupees_in_words: form.rupees_in_words || toWordsINR(amt),
      payment_date: form.payment_date || null,
    }
    await create.mutateAsync(payload)
    setModal(false); setForm(EMPTY)
  }

  const filtered = tab === 'All' ? payments : payments.filter((p: any) => p.verification_status?.toLowerCase() === tab.toLowerCase())
  const unverifiedCount = payments.filter((p: any) => p.verification_status === 'unverified').length

  const cols = [
    { header: 'Receipt #', render: (r: any) => <span className="font-mono text-xs font-bold text-red-700">{r.receipt_no || '—'}</span> },
    {
      header: 'Booking / Customer',
      render: (r: any) => (
        <div>
          <div className="font-medium text-xs">{r.bp_bookings?.booking_no || r.booking_id?.slice(0,8) + '…'}</div>
          <div className="text-xs text-gray-400">{r.bp_bookings?.bp_customers?.name}</div>
        </div>
      ),
    },
    { header: 'Type',   render: (r: any) => <span className="capitalize text-xs">{r.payment_type?.replace(/_/g,' ')}{r.instalment_no ? ` · inst ${r.instalment_no}` : ''}</span> },
    { header: 'Amount', render: (r: any) => <span className="font-semibold text-green-700">{formatINR(r.amount)}</span> },
    { header: 'Mode',   render: (r: any) => <span className="uppercase text-xs">{r.is_cash_adjustment ? 'Cash adj' : r.payment_mode}</span> },
    { header: 'Drawn / Branch', render: (r: any) => <span className="text-xs">{r.drawn_on_bank || '—'}{r.branch ? ` · ${r.branch}` : ''}</span> },
    { header: 'Date',   render: (r: any) => formatDate(r.payment_date) },
    {
      header: 'Status',
      render: (r: any) => <Badge label={r.verification_status || 'unverified'} className={STATUS_COLORS[r.verification_status || 'unverified']} />,
    },
    {
      header: 'Actions',
      render: (r: any) => (
        <div className="flex gap-1">
          {r.verification_status !== 'verified' && (
            <Button size="sm" onClick={() => updateStatus.mutate({ id: r.id, status: 'verified' })} loading={updateStatus.isPending}><CheckCircle size={12} />Verify</Button>
          )}
          {r.verification_status !== 'rejected' && (
            <Button size="sm" variant="danger" onClick={() => updateStatus.mutate({ id: r.id, status: 'rejected' })} loading={updateStatus.isPending}><XCircle size={12} />Reject</Button>
          )}
          <Button size="sm" variant="ghost" onClick={() => printPaymentReceipt(r)}><Printer size={12} />Receipt</Button>
        </div>
      ),
    },
  ]

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Payments</h1>
          <p className="text-sm text-gray-500">Customer payment records and verification</p>
        </div>
        <Button onClick={() => setModal(true)}><Plus size={14} />Record Payment</Button>
      </div>

      {unverifiedCount > 0 && (
        <div className="flex items-center gap-3 mb-5 p-3 bg-yellow-50 border border-yellow-200 rounded-xl text-sm">
          <Clock size={16} className="text-yellow-600 shrink-0" />
          <span className="text-yellow-800 font-medium">{unverifiedCount} payment{unverifiedCount > 1 ? 's' : ''} awaiting verification</span>
          <button onClick={() => setTab('Unverified')} className="ml-auto text-yellow-700 underline text-xs">View →</button>
        </div>
      )}

      <div className="flex gap-1 mb-4 bg-gray-100 p-1 rounded-xl w-fit">
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)} className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${tab === t ? 'bg-white shadow text-gray-900' : 'text-gray-500 hover:text-gray-700'}`}>
            {t}
            {t === 'Unverified' && unverifiedCount > 0 && <span className="ml-1.5 bg-yellow-500 text-white text-xs rounded-full px-1.5 py-0.5">{unverifiedCount}</span>}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm">
        <Table columns={cols} data={filtered} loading={isLoading} />
      </div>

      <Modal open={modal} onClose={() => setModal(false)} title="Record Payment — रसीद">
        <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Booking & Amount</div>
        <div className="grid grid-cols-2 gap-3">
          <Select label="Booking" value={form.booking_id} onChange={(e: any) => set('booking_id', e.target.value)} className="col-span-2">
            <option value="">Select Booking</option>
            {(bookings as any[]).map((b: any) => <option key={b.id} value={b.id}>{b.booking_no} — {b.bp_customers?.name}</option>)}
          </Select>
          <Select label="Payment Type" value={form.payment_type} onChange={(e: any) => set('payment_type', e.target.value)}>
            {['token','booking','emi','full_payment','miscellaneous'].map(t => <option key={t} value={t}>{t.replace(/_/g,' ')}</option>)}
          </Select>
          <Input label="Instalment No" type="number" value={form.instalment_no} onChange={(e: any) => set('instalment_no', e.target.value)} />
          <Input label="राशि / Amount (₹)" type="number" value={form.amount} onChange={(e: any) => { set('amount', e.target.value); set('rupees_in_words', toWordsINR(Number(e.target.value))) }} />
          <Input label="Rupees in Words" value={form.rupees_in_words} onChange={(e: any) => set('rupees_in_words', e.target.value)} />
        </div>

        <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2 mt-4 pt-3 border-t border-gray-100">Mode & Bank</div>
        <div className="grid grid-cols-2 gap-3">
          <Select label="Payment Mode" value={form.payment_mode} onChange={(e: any) => set('payment_mode', e.target.value)}>
            {['cash','neft','rtgs','imps','upi','cheque','dd'].map(m => <option key={m} value={m}>{m.toUpperCase()}</option>)}
          </Select>
          <Input label="कैश/चेक नं. (UTR / Ref)" value={form.utr_ref} onChange={(e: any) => set('utr_ref', e.target.value)} />
          <Input label="Drawn On (Bank)" value={form.drawn_on_bank} onChange={(e: any) => set('drawn_on_bank', e.target.value)} placeholder="e.g. HDFC Bank" />
          <Input label="बैंक शाखा (Branch)" value={form.branch} onChange={(e: any) => set('branch', e.target.value)} placeholder="e.g. BIB/LBD" />
          <Input label="दिनांक (Date)" type="date" value={form.payment_date} onChange={(e: any) => set('payment_date', e.target.value)} />
          <Input label="Received By" value={form.received_by} onChange={(e: any) => set('received_by', e.target.value)} />
        </div>

        <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2 mt-4 pt-3 border-t border-gray-100">Receipt Details</div>
        <div className="grid grid-cols-2 gap-3">
          <Input label="Receipt No (auto if blank)" value={form.receipt_no} onChange={(e: any) => set('receipt_no', e.target.value)} placeholder="e.g. 6301" />
          <Input label="Sponsor's Name" value={form.sponsor_name} onChange={(e: any) => set('sponsor_name', e.target.value)} placeholder="e.g. Alok / Sanjeet" />
          <div className="col-span-2 flex flex-wrap gap-4 items-center">
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={!!form.is_cash_adjustment} onChange={e => set('is_cash_adjustment', e.target.checked)} className="rounded" />
              Cash adjustment (no cheque/draft)
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input type="checkbox" checked={!!form.subject_to_realisation} onChange={e => set('subject_to_realisation', e.target.checked)} className="rounded" />
              Subject to realisation of cheque/draft
            </label>
          </div>
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
