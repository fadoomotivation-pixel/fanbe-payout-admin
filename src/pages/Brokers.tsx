import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { Table } from '@/components/ui/Table.tsx'
import { Button } from '@/components/ui/Button.tsx'
import { Input, Select } from '@/components/ui/Input.tsx'
import { Modal } from '@/components/ui/Modal.tsx'
import { Badge } from '@/components/ui/Badge.tsx'
import { KYC_COLORS } from '@/lib/utils'
import { Plus, Search } from 'lucide-react'
import toast from 'react-hot-toast'

const EMPTY = { name:'', email:'', phone:'', referral_code:'', rank:'partner', status:'active', tds_applicable:false, pan_no:'', gst_no:'' }

export default function Brokers() {
  const qc = useQueryClient()
  const { data: brokers = [], isLoading } = useQuery({
    queryKey: ['brokers'],
    queryFn: async () => {
      const { data, error } = await supabase.from('brokers').select('*').order('created_at', { ascending: false })
      if (error) throw error; return data
    },
  })
  const create = useMutation({ mutationFn: async (p: any) => { const { data, error } = await supabase.from('brokers').insert(p).select().single(); if (error) throw error; return data }, onSuccess: () => { qc.invalidateQueries({ queryKey: ['brokers'] }); toast.success('Broker added') }, onError: (e: any) => toast.error(e.message) })
  const update = useMutation({ mutationFn: async ({ id, data }: { id: string; data: any }) => { const { data: d, error } = await supabase.from('brokers').update({ ...data, updated_at: new Date().toISOString() }).eq('id', id).select().single(); if (error) throw error; return d }, onSuccess: () => { qc.invalidateQueries({ queryKey: ['brokers'] }); toast.success('Broker updated') }, onError: (e: any) => toast.error(e.message) })

  const [modal, setModal] = useState(false)
  const [editing, setEditing] = useState<any>(null)
  const [form, setForm] = useState<any>(EMPTY)
  const [q, setQ] = useState('')

  const open = (b?: any) => { setEditing(b || null); setForm(b ? { name:b.name, email:b.email, phone:b.phone, referral_code:b.referral_code, rank:b.rank, status:b.status, tds_applicable:b.tds_applicable, pan_no:b.pan_no||'', gst_no:b.gst_no||'' } : EMPTY); setModal(true) }
  const save = async () => { editing ? await update.mutateAsync({ id: editing.id, data: form }) : await create.mutateAsync(form); setModal(false) }
  const set = (k: string, v: any) => setForm((p: any) => ({ ...p, [k]: v }))
  const filtered = (brokers as any[]).filter((b: any) => `${b.name}${b.phone}${b.broker_id}`.toLowerCase().includes(q.toLowerCase()))

  const cols = [
    { header: 'Broker ID', render: (r: any) => <span className="font-mono text-xs bg-gray-100 px-2 py-0.5 rounded">{r.broker_id}</span> },
    { header: 'Name', render: (r: any) => <span className="font-medium">{r.name}</span> },
    { header: 'Phone', key: 'phone' }, { header: 'Email', key: 'email' },
    { header: 'Rank', render: (r: any) => <span className="capitalize">{r.rank}</span> },
    { header: 'KYC', render: (r: any) => <Badge label={r.kyc_status || 'pending'} className={KYC_COLORS[r.kyc_status] || 'bg-gray-100 text-gray-600'} /> },
    { header: 'Status', render: (r: any) => <Badge label={r.status} className={r.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'} /> },
    { header: '', render: (r: any) => <Button size="sm" variant="ghost" onClick={() => open(r)}>Edit</Button> },
  ]

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div><h1 className="text-xl font-bold text-gray-900">Brokers</h1><p className="text-sm text-gray-500">{(brokers as any[]).length} brokers registered</p></div>
        <Button onClick={() => open()}><Plus size={14} />Add Broker</Button>
      </div>
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm">
        <div className="p-4 border-b border-gray-100 flex gap-3">
          <div className="relative flex-1 max-w-xs"><Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" /><input value={q} onChange={e => setQ(e.target.value)} placeholder="Search brokers…" className="w-full pl-8 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" /></div>
        </div>
        <Table columns={cols} data={filtered} loading={isLoading} />
      </div>
      <Modal open={modal} onClose={() => setModal(false)} title={editing ? 'Edit Broker' : 'Add Broker'}>
        <div className="grid grid-cols-2 gap-4">
          <Input label="Full Name" value={form.name} onChange={(e: any) => set('name', e.target.value)} required />
          <Input label="Phone" value={form.phone} onChange={(e: any) => set('phone', e.target.value)} required />
          <Input label="Email" value={form.email} onChange={(e: any) => set('email', e.target.value)} />
          <Input label="Referral Code" value={form.referral_code} onChange={(e: any) => set('referral_code', e.target.value)} />
          <Select label="Rank" value={form.rank} onChange={(e: any) => set('rank', e.target.value)}>
            <option value="partner">Partner</option><option value="senior_partner">Senior Partner</option><option value="channel_partner">Channel Partner</option><option value="associate">Associate</option>
          </Select>
          <Select label="Status" value={form.status} onChange={(e: any) => set('status', e.target.value)}>
            <option value="active">Active</option><option value="inactive">Inactive</option><option value="suspended">Suspended</option>
          </Select>
          <Input label="PAN No" value={form.pan_no} onChange={(e: any) => set('pan_no', e.target.value)} />
          <Input label="GST No" value={form.gst_no} onChange={(e: any) => set('gst_no', e.target.value)} />
          <div className="col-span-2 flex items-center gap-2">
            <input type="checkbox" id="tds" checked={form.tds_applicable} onChange={e => set('tds_applicable', e.target.checked)} className="rounded" />
            <label htmlFor="tds" className="text-sm text-gray-700">TDS Applicable</label>
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-6">
          <Button variant="secondary" onClick={() => setModal(false)}>Cancel</Button>
          <Button onClick={save} loading={create.isPending || update.isPending}>Save</Button>
        </div>
      </Modal>
    </div>
  )
}