import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { Table } from '@/components/ui/Table.tsx'
import { Button } from '@/components/ui/Button.tsx'
import { Input, Select, Textarea } from '@/components/ui/Input.tsx'
import { Modal } from '@/components/ui/Modal.tsx'
import { Badge } from '@/components/ui/Badge.tsx'
import { formatINR, formatDate, PAYOUT_STATUS_COLORS } from '@/lib/utils'
import { Filter } from 'lucide-react'
import toast from 'react-hot-toast'

export default function Payouts() {
  const qc = useQueryClient()
  const [statusF, setStatusF] = useState('')
  const { data: payouts = [], isLoading } = useQuery({
    queryKey: ['payouts', statusF],
    queryFn: async () => {
      let q = supabase.from('bp_payout_transactions').select('*,brokers(name,broker_id,pan_no,tds_applicable),bp_bookings(booking_no)').order('created_at', { ascending: false })
      if (statusF) q = q.eq('status', statusF)
      const { data, error } = await q; if (error) throw error; return data
    },
  })
  const update = useMutation({ mutationFn: async ({ id, data }: { id: string; data: any }) => { const { data: d, error } = await supabase.from('bp_payout_transactions').update({ ...data, updated_at: new Date().toISOString() }).eq('id', id).select().single(); if (error) throw error; return d }, onSuccess: () => { qc.invalidateQueries({ queryKey: ['payouts'] }); toast.success('Payout updated') }, onError: (e: any) => toast.error(e.message) })

  const [selected, setSelected] = useState<any>(null); const [modal, setModal] = useState(false)
  const [form, setForm] = useState<any>({ status:'', payment_mode:'', utr_ref:'', paid_date:'', rejection_reason:'', notes:'', tds_amount:'', net_amount:'' })
  const open = (r: any) => { setSelected(r); setForm({ status:r.status, payment_mode:r.payment_mode||'', utr_ref:r.utr_ref||'', paid_date:r.paid_date||'', rejection_reason:r.rejection_reason||'', notes:r.notes||'', tds_amount:r.tds_amount||'', net_amount:r.net_amount||'' }); setModal(true) }
  const save = async () => { await update.mutateAsync({ id: selected.id, data: { ...form, tds_amount: form.tds_amount ? Number(form.tds_amount) : null, net_amount: form.net_amount ? Number(form.net_amount) : null } }); setModal(false) }
  const set = (k: string, v: any) => setForm((p: any) => ({ ...p, [k]: v }))

  const cols = [
    { header: 'Broker', render: (r: any) => <div><div className="font-medium">{r.brokers?.name}</div><div className="text-xs text-gray-400">{r.brokers?.broker_id}</div></div> },
    { header: 'Booking', render: (r: any) => <span className="text-xs">{r.bp_bookings?.booking_no || '—'}</span> },
    { header: 'Type', render: (r: any) => <span className="capitalize text-xs">{r.payout_type}</span> },
    { header: 'Amount', render: (r: any) => <span className="font-semibold">{formatINR(r.amount)}</span> },
    { header: 'TDS', render: (r: any) => r.tds_amount ? formatINR(r.tds_amount) : '—' },
    { header: 'Net', render: (r: any) => <span className="font-semibold text-green-700">{r.net_amount ? formatINR(r.net_amount) : '—'}</span> },
    { header: 'Status', render: (r: any) => <Badge label={r.status} className={PAYOUT_STATUS_COLORS[r.status] || 'bg-gray-100 text-gray-700'} /> },
    { header: 'Paid Date', render: (r: any) => formatDate(r.paid_date) },
    { header: '', render: (r: any) => <Button size="sm" variant="ghost" onClick={() => open(r)}>Manage</Button> },
  ]

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div><h1 className="text-xl font-bold text-gray-900">Payouts</h1><p className="text-sm text-gray-500">Manage broker payout transactions</p></div>
      </div>
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm">
        <div className="p-4 border-b border-gray-100 flex gap-3 items-center">
          <Filter size={14} className="text-gray-400" />
          <select value={statusF} onChange={e => setStatusF(e.target.value)} className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none">
            {['','pending','approved','paid','rejected','hold'].map(s => <option key={s} value={s}>{s || 'All Status'}</option>)}
          </select>
        </div>
        <Table columns={cols} data={payouts} loading={isLoading} />
      </div>
      <Modal open={modal} onClose={() => setModal(false)} title="Manage Payout">
        {selected && (
          <div className="space-y-4">
            <div className="bg-blue-50 rounded-lg p-4 text-sm grid grid-cols-2 gap-2">
              <div><span className="text-gray-500">Broker:</span> <strong>{selected.brokers?.name}</strong></div>
              <div><span className="text-gray-500">Amount:</span> <strong>{formatINR(selected.amount)}</strong></div>
              <div><span className="text-gray-500">PAN:</span> {selected.brokers?.pan_no || '—'}</div>
              <div><span className="text-gray-500">TDS:</span> {selected.brokers?.tds_applicable ? 'Yes' : 'No'}</div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Select label="Status" value={form.status} onChange={(e: any) => set('status', e.target.value)}>
                {['pending','approved','paid','rejected','hold'].map(s => <option key={s} value={s}>{s}</option>)}
              </Select>
              <Select label="Payment Mode" value={form.payment_mode} onChange={(e: any) => set('payment_mode', e.target.value)}>
                <option value="">Select</option>
                {['neft','rtgs','imps','upi','cheque'].map(m => <option key={m} value={m}>{m.toUpperCase()}</option>)}
              </Select>
              <Input label="UTR / Ref No" value={form.utr_ref} onChange={(e: any) => set('utr_ref', e.target.value)} />
              <Input label="Paid Date" type="date" value={form.paid_date} onChange={(e: any) => set('paid_date', e.target.value)} />
              <Input label="TDS Amount (₹)" type="number" value={form.tds_amount} onChange={(e: any) => set('tds_amount', e.target.value)} />
              <Input label="Net Amount (₹)" type="number" value={form.net_amount} onChange={(e: any) => set('net_amount', e.target.value)} />
              <Textarea label="Notes" value={form.notes} onChange={(e: any) => set('notes', e.target.value)} className="col-span-2" rows={2} />
            </div>
          </div>
        )}
        <div className="flex justify-end gap-2 mt-6">
          <Button variant="secondary" onClick={() => setModal(false)}>Cancel</Button>
          <Button onClick={save} loading={update.isPending}>Update Payout</Button>
        </div>
      </Modal>
    </div>
  )
}