import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { Table } from '@/components/ui/Table.tsx'
import { Button } from '@/components/ui/Button.tsx'
import { Input, Select, Textarea } from '@/components/ui/Input.tsx'
import { Modal } from '@/components/ui/Modal.tsx'
import { formatINR, formatDate } from '@/lib/utils'
import { Plus } from 'lucide-react'
import toast from 'react-hot-toast'

const EMPTY = { booking_id:'', payment_type:'token', amount:'', payment_mode:'cash', utr_ref:'', payment_date:'', received_by:'', notes:'' }

export default function Payments() {
  const qc = useQueryClient()
  const { data: payments = [], isLoading } = useQuery({
    queryKey: ['payments'],
    queryFn: async () => { const { data, error } = await supabase.from('bp_payments').select('*').order('payment_date', { ascending: false }); if (error) throw error; return data },
  })
  const { data: bookings = [] } = useQuery({
    queryKey: ['bookings_list'],
    queryFn: async () => { const { data, error } = await supabase.from('bp_bookings').select('id,booking_no,bp_customers(name)'); if (error) throw error; return data },
  })
  const create = useMutation({ mutationFn: async (p: any) => { const { data, error } = await supabase.from('bp_payments').insert(p).select().single(); if (error) throw error; return data }, onSuccess: () => { qc.invalidateQueries({ queryKey: ['payments'] }); toast.success('Payment recorded') }, onError: (e: any) => toast.error(e.message) })

  const [modal, setModal] = useState(false); const [form, setForm] = useState<any>(EMPTY)
  const save = async () => { await create.mutateAsync({ ...form, amount: Number(form.amount) }); setModal(false); setForm(EMPTY) }
  const set = (k: string, v: any) => setForm((p: any) => ({ ...p, [k]: v }))

  const cols = [
    { header: 'Booking', render: (r: any) => <span className="font-mono text-xs">{r.booking_id?.slice(0, 8)}…</span> },
    { header: 'Type', render: (r: any) => <span className="capitalize text-xs">{r.payment_type}</span> },
    { header: 'Amount', render: (r: any) => <span className="font-semibold text-green-700">{formatINR(r.amount)}</span> },
    { header: 'Mode', render: (r: any) => <span className="capitalize">{r.payment_mode}</span> },
    { header: 'UTR/Ref', key: 'utr_ref' },
    { header: 'Date', render: (r: any) => formatDate(r.payment_date) },
    { header: 'Received By', key: 'received_by' },
  ]

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div><h1 className="text-xl font-bold text-gray-900">Payments</h1><p className="text-sm text-gray-500">Customer payment records</p></div>
        <Button onClick={() => setModal(true)}><Plus size={14} />Record Payment</Button>
      </div>
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm"><Table columns={cols} data={payments} loading={isLoading} /></div>
      <Modal open={modal} onClose={() => setModal(false)} title="Record Payment">
        <div className="grid grid-cols-2 gap-4">
          <Select label="Booking" value={form.booking_id} onChange={(e: any) => set('booking_id', e.target.value)} className="col-span-2">
            <option value="">Select Booking</option>
            {(bookings as any[]).map((b: any) => <option key={b.id} value={b.id}>{b.booking_no} — {b.bp_customers?.name}</option>)}
          </Select>
          <Select label="Payment Type" value={form.payment_type} onChange={(e: any) => set('payment_type', e.target.value)}>
            {['token','booking','emi','full_payment','miscellaneous'].map(t => <option key={t} value={t}>{t}</option>)}
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