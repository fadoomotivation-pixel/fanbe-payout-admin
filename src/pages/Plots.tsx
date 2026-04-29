import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { Table } from '@/components/ui/Table.tsx'
import { Button } from '@/components/ui/Button.tsx'
import { Input, Select } from '@/components/ui/Input.tsx'
import { Modal } from '@/components/ui/Modal.tsx'
import { Badge } from '@/components/ui/Badge.tsx'
import { formatINR } from '@/lib/utils'
import toast from 'react-hot-toast'

export default function Plots() {
  const qc = useQueryClient()
  const [projectFilter, setProjectFilter] = useState('')

  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: async () => { const { data, error } = await supabase.from('bp_projects').select('id,name'); if (error) throw error; return data },
  })
  const { data: plots = [], isLoading } = useQuery({
    queryKey: ['plots', projectFilter],
    queryFn: async () => {
      let q = supabase.from('bp_plots').select('*,bp_projects(name)').order('plot_no')
      if (projectFilter) q = q.eq('project_id', projectFilter)
      const { data, error } = await q; if (error) throw error; return data
    },
  })
  const update = useMutation({ mutationFn: async ({ id, data }: { id: string; data: any }) => { const { data: d, error } = await supabase.from('bp_plots').update({ ...data, updated_at: new Date().toISOString() }).eq('id', id).select().single(); if (error) throw error; return d }, onSuccess: () => { qc.invalidateQueries({ queryKey: ['plots'] }); toast.success('Plot updated') }, onError: (e: any) => toast.error(e.message) })

  const [modal, setModal] = useState(false); const [editing, setEditing] = useState<any>(null); const [form, setForm] = useState<any>({})
  const open = (p: any) => { setEditing(p); setForm({ plot_no: p.plot_no, size_sqyd: p.size_sqyd, facing: p.facing||'', corner: p.corner, status: p.status, base_price: p.base_price }); setModal(true) }
  const save = async () => { await update.mutateAsync({ id: editing.id, data: { ...form, size_sqyd: Number(form.size_sqyd), base_price: Number(form.base_price) } }); setModal(false) }
  const set = (k: string, v: any) => setForm((p: any) => ({ ...p, [k]: v }))

  const STATUS_COLORS: Record<string,string> = { available:'bg-green-100 text-green-700', booked:'bg-blue-100 text-blue-700', sold:'bg-gray-100 text-gray-600', reserved:'bg-yellow-100 text-yellow-700', blocked:'bg-red-100 text-red-700' }

  const cols = [
    { header: 'Plot No', render: (r: any) => <span className="font-semibold">{r.plot_no}</span> },
    { header: 'Project', render: (r: any) => <span className="text-xs">{r.bp_projects?.name}</span> },
    { header: 'Size (sqyd)', key: 'size_sqyd' },
    { header: 'Facing', key: 'facing' },
    { header: 'Corner', render: (r: any) => r.corner ? <Badge label="Corner" className="bg-purple-100 text-purple-700" /> : '—' },
    { header: 'Base Price', render: (r: any) => formatINR(r.base_price) },
    { header: 'Status', render: (r: any) => <Badge label={r.status} className={STATUS_COLORS[r.status] || 'bg-gray-100 text-gray-600'} /> },
    { header: '', render: (r: any) => <Button size="sm" variant="ghost" onClick={() => open(r)}>Edit</Button> },
  ]

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div><h1 className="text-xl font-bold text-gray-900">Plots</h1><p className="text-sm text-gray-500">{(plots as any[]).length} plots</p></div>
      </div>
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm">
        <div className="p-4 border-b border-gray-100">
          <select value={projectFilter} onChange={e => setProjectFilter(e.target.value)} className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none">
            <option value="">All Projects</option>
            {(projects as any[]).map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <Table columns={cols} data={plots} loading={isLoading} />
      </div>
      <Modal open={modal} onClose={() => setModal(false)} title="Edit Plot">
        <div className="grid grid-cols-2 gap-4">
          <Input label="Plot No" value={form.plot_no} onChange={(e: any) => set('plot_no', e.target.value)} />
          <Input label="Size (sqyd)" type="number" value={form.size_sqyd} onChange={(e: any) => set('size_sqyd', e.target.value)} />
          <Input label="Facing" value={form.facing} onChange={(e: any) => set('facing', e.target.value)} />
          <Input label="Base Price (₹)" type="number" value={form.base_price} onChange={(e: any) => set('base_price', e.target.value)} />
          <Select label="Status" value={form.status} onChange={(e: any) => set('status', e.target.value)}>
            {['available','booked','sold','reserved','blocked'].map(s => <option key={s} value={s}>{s}</option>)}
          </Select>
          <div className="flex items-center gap-2 mt-4">
            <input type="checkbox" id="corner" checked={form.corner} onChange={e => set('corner', e.target.checked)} className="rounded" />
            <label htmlFor="corner" className="text-sm text-gray-700">Corner Plot</label>
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-6">
          <Button variant="secondary" onClick={() => setModal(false)}>Cancel</Button>
          <Button onClick={save} loading={update.isPending}>Save</Button>
        </div>
      </Modal>
    </div>
  )
}