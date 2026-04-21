import { useQuery, useMutation } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { queryClient } from '../../lib/queryClient'
import { useState } from 'react'
import { Plus, Pencil, Trash2 } from 'lucide-react'
import LoadingSpinner from '../../components/ui/LoadingSpinner'
import Modal from '../../components/ui/Modal'
import toast from 'react-hot-toast'

export default function CommissionRules() {
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [form, setForm] = useState({ project_id: '', payout_stage: 'token', commission_type: 'percentage', commission_value: '', tds_applicable: true, notes: '' })

  const { data: rules = [], isLoading } = useQuery({
    queryKey: ['commission-rules'],
    queryFn: async () => {
      const { data } = await supabase.from('bp_commission_rules').select('*, bp_projects(name)').order('created_at', { ascending: false })
      return data
    },
  })

  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: async () => {
      const { data } = await supabase.from('bp_projects').select('id, name')
      return data
    },
  })

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = { ...form, commission_value: parseFloat(form.commission_value) }
      const { error } = editing
        ? await supabase.from('bp_commission_rules').update(payload).eq('id', editing.id)
        : await supabase.from('bp_commission_rules').insert(payload)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['commission-rules'] })
      toast.success(editing ? 'Rule updated' : 'Rule created')
      setOpen(false)
      setEditing(null)
      setForm({ project_id: '', payout_stage: 'token', commission_type: 'percentage', commission_value: '', tds_applicable: true, notes: '' })
    },
    onError: e => toast.error(e.message),
  })

  const deleteMutation = useMutation({
    mutationFn: async (id) => {
      const { error } = await supabase.from('bp_commission_rules').delete().eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['commission-rules'] })
      toast.success('Rule deleted')
    },
  })

  const openEdit = (rule) => {
    setEditing(rule)
    setForm(rule)
    setOpen(true)
  }

  if (isLoading) return <LoadingSpinner fullPage />

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="page-title">Commission Rules</h1>
        <button onClick={() => setOpen(true)} className="btn-primary"><Plus size={16} />Add Rule</button>
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="bg-slate-50 border-b border-slate-200">
              {['Project', 'Stage', 'Type', 'Value', 'TDS', 'Notes', ''].map(h => (
                <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-slate-500">{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {rules.map(r => (
                <tr key={r.id} className="border-b border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-3">{r.bp_projects?.name || 'All'}</td>
                  <td className="px-4 py-3 capitalize">{r.payout_stage}</td>
                  <td className="px-4 py-3 capitalize">{r.commission_type}</td>
                  <td className="px-4 py-3 font-medium">{r.commission_type === 'percentage' ? `${r.commission_value}%` : `₹${r.commission_value?.toLocaleString('en-IN')}`}</td>
                  <td className="px-4 py-3">{r.tds_applicable ? 'Yes' : 'No'}</td>
                  <td className="px-4 py-3 text-slate-500">{r.notes || '—'}</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1">
                      <button onClick={() => openEdit(r)} className="p-1 rounded hover:bg-slate-100"><Pencil size={13} /></button>
                      <button onClick={() => deleteMutation.mutate(r.id)} className="p-1 rounded hover:bg-red-50 text-red-600"><Trash2 size={13} /></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Modal open={open} onClose={() => { setOpen(false); setEditing(null) }} title={editing ? 'Edit Rule' : 'New Commission Rule'} size="md">
        <div className="space-y-4">
          <div><label className="label">Project (leave blank for all)</label>
            <select className="input" value={form.project_id} onChange={e => setForm(f => ({ ...f, project_id: e.target.value }))}>
              <option value="">All Projects</option>
              {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div><label className="label">Payout Stage</label>
              <select className="input" value={form.payout_stage} onChange={e => setForm(f => ({ ...f, payout_stage: e.target.value }))}>
                {['token', 'booking', 'full_payment', 'registry_done'].map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
              </select>
            </div>
            <div><label className="label">Commission Type</label>
              <select className="input" value={form.commission_type} onChange={e => setForm(f => ({ ...f, commission_type: e.target.value }))}>
                <option value="percentage">Percentage</option>
                <option value="fixed">Fixed Amount</option>
              </select>
            </div>
            <div><label className="label">Value ({form.commission_type === 'percentage' ? '%' : '₹'})</label>
              <input type="number" className="input" value={form.commission_value} onChange={e => setForm(f => ({ ...f, commission_value: e.target.value }))} />
            </div>
            <div className="flex items-center gap-2 pt-5">
              <input type="checkbox" id="tds" checked={form.tds_applicable} onChange={e => setForm(f => ({ ...f, tds_applicable: e.target.checked }))} />
              <label htmlFor="tds" className="text-sm text-slate-700">TDS Applicable</label>
            </div>
          </div>

          <div><label className="label">Notes</label><textarea className="input" value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} /></div>
          <div className="flex gap-3 justify-end">
            <button onClick={() => setOpen(false)} className="btn-secondary">Cancel</button>
            <button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending} className="btn-primary">Save Rule</button>
          </div>
        </div>
      </Modal>
    </div>
  )
}