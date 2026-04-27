import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { formatINR, formatDate } from '../../lib/utils'
import { Plus, Tag, Receipt, Download, Trash2 } from 'lucide-react'

export default function Expenses() {
  const [tab, setTab] = useState('expenses')
  const [showHeadModal, setShowHeadModal] = useState(false)
  const [showExpModal, setShowExpModal] = useState(false)
  const [headForm, setHeadForm] = useState({ name: '', description: '' })
  const [expForm, setExpForm] = useState({ head_id: '', amount: '', expense_date: new Date().toISOString().split('T')[0], description: '' })
  const qc = useQueryClient()

  const { data: heads = [] } = useQuery({
    queryKey: ['expense_heads'],
    queryFn: async () => { const { data } = await supabase.from('expense_heads').select('*').order('name'); return data || [] },
  })

  const { data: expenses = [], isLoading } = useQuery({
    queryKey: ['expenses'],
    queryFn: async () => {
      const { data } = await supabase.from('expenses').select('*, expense_heads(name)').order('expense_date', { ascending: false })
      return data || []
    },
  })

  const addHead = useMutation({
    mutationFn: async () => { const { error } = await supabase.from('expense_heads').insert(headForm); if (error) throw error },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['expense_heads'] }); setShowHeadModal(false); setHeadForm({ name: '', description: '' }) },
  })

  const addExpense = useMutation({
    mutationFn: async () => { const { error } = await supabase.from('expenses').insert({ ...expForm, amount: Number(expForm.amount) }); if (error) throw error },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['expenses'] }); setShowExpModal(false); setExpForm({ head_id: '', amount: '', expense_date: new Date().toISOString().split('T')[0], description: '' }) },
  })

  const deleteExpense = useMutation({
    mutationFn: async (id) => { const { error } = await supabase.from('expenses').delete().eq('id', id); if (error) throw error },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['expenses'] }),
  })

  function exportCSV() {
    const header = 'Date,Head,Description,Amount'
    const lines = expenses.map(r => `${r.expense_date},${r.expense_heads?.name || ''},"${(r.description || '').replace(/"/g, '""')}",${r.amount}`)
    const blob = new Blob([[header, ...lines].join('\n')], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = 'expenses.csv'; a.click()
    URL.revokeObjectURL(url)
  }

  const total = expenses.reduce((s, r) => s + (Number(r.amount) || 0), 0)

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Expenses</h1>
          <p className="text-sm text-gray-500">Track company expenditures</p>
        </div>
        <div className="flex gap-2">
          {tab === 'expenses' && (
            <>
              <button onClick={exportCSV} className="btn-secondary flex items-center gap-1.5 text-sm"><Download size={14} /> Export CSV</button>
              <button onClick={() => setShowExpModal(true)} className="btn-primary flex items-center gap-1.5 text-sm"><Plus size={14} /> Add Expense</button>
            </>
          )}
          {tab === 'heads' && (
            <button onClick={() => setShowHeadModal(true)} className="btn-primary flex items-center gap-1.5 text-sm"><Plus size={14} /> Add Head</button>
          )}
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 flex items-center gap-3 w-fit">
        <Receipt size={20} className="text-teal-600" />
        <div>
          <p className="text-xs text-gray-500">Total Expenses</p>
          <p className="text-xl font-bold text-gray-900">{formatINR(total)}</p>
        </div>
      </div>

      <div className="flex gap-2">
        {[['expenses', 'Expenses'], ['heads', 'Expense Heads']].map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              tab === key ? 'bg-teal-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}>{label}</button>
        ))}
      </div>

      {tab === 'expenses' && (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100">
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">Date</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">Head</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">Description</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">Amount</th>
                  <th className="text-left px-4 py-3 text-xs font-medium text-gray-500"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {isLoading
                  ? <tr><td colSpan={5} className="text-center py-8 text-gray-400 text-xs">Loading…</td></tr>
                  : expenses.length === 0
                  ? <tr><td colSpan={5} className="text-center py-8 text-gray-400 text-xs">No expenses yet</td></tr>
                  : expenses.map(row => (
                    <tr key={row.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-xs text-gray-600">{formatDate(row.expense_date)}</td>
                      <td className="px-4 py-3"><span className="px-2 py-0.5 bg-teal-50 text-teal-700 rounded text-xs font-medium">{row.expense_heads?.name || '—'}</span></td>
                      <td className="px-4 py-3 text-sm text-gray-700">{row.description || '—'}</td>
                      <td className="px-4 py-3 font-semibold text-gray-900">{formatINR(row.amount)}</td>
                      <td className="px-4 py-3">
                        <button onClick={() => deleteExpense.mutate(row.id)} className="text-red-400 hover:text-red-600 p-1"><Trash2 size={14} /></button>
                      </td>
                    </tr>
                  ))
                }
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'heads' && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {heads.length === 0 && <p className="text-gray-400 text-sm col-span-full text-center py-8">No expense heads. Add one to get started.</p>}
          {heads.map(h => (
            <div key={h.id} className="bg-white rounded-xl border border-gray-100 shadow-sm p-4 flex items-start gap-2">
              <Tag size={16} className="text-teal-600 mt-0.5 shrink-0" />
              <div>
                <p className="font-semibold text-gray-900 text-sm">{h.name}</p>
                {h.description && <p className="text-xs text-gray-500 mt-0.5">{h.description}</p>}
              </div>
            </div>
          ))}
        </div>
      )}

      {showHeadModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-sm mx-4">
            <h3 className="text-base font-semibold text-gray-900 mb-4">Add Expense Head</h3>
            <div className="space-y-3">
              <div><label className="label">Name *</label><input className="input w-full mt-1" value={headForm.name} onChange={e => setHeadForm(p => ({ ...p, name: e.target.value }))} /></div>
              <div><label className="label">Description</label><input className="input w-full mt-1" value={headForm.description} onChange={e => setHeadForm(p => ({ ...p, description: e.target.value }))} /></div>
            </div>
            <div className="flex gap-2 justify-end mt-4">
              <button onClick={() => setShowHeadModal(false)} className="btn-secondary">Cancel</button>
              <button onClick={() => addHead.mutate()} disabled={!headForm.name || addHead.isPending} className="btn-primary">Save</button>
            </div>
          </div>
        </div>
      )}

      {showExpModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl shadow-xl p-6 w-full max-w-sm mx-4">
            <h3 className="text-base font-semibold text-gray-900 mb-4">Add Expense</h3>
            <div className="space-y-3">
              <div>
                <label className="label">Expense Head *</label>
                <select className="input w-full mt-1" value={expForm.head_id} onChange={e => setExpForm(p => ({ ...p, head_id: e.target.value }))}>
                  <option value="">Select head…</option>
                  {heads.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
                </select>
              </div>
              <div><label className="label">Amount (₹) *</label><input type="number" className="input w-full mt-1" value={expForm.amount} onChange={e => setExpForm(p => ({ ...p, amount: e.target.value }))} /></div>
              <div><label className="label">Date *</label><input type="date" className="input w-full mt-1" value={expForm.expense_date} onChange={e => setExpForm(p => ({ ...p, expense_date: e.target.value }))} /></div>
              <div><label className="label">Description</label><textarea className="input w-full mt-1" rows={2} value={expForm.description} onChange={e => setExpForm(p => ({ ...p, description: e.target.value }))} /></div>
            </div>
            <div className="flex gap-2 justify-end mt-4">
              <button onClick={() => setShowExpModal(false)} className="btn-secondary">Cancel</button>
              <button onClick={() => addExpense.mutate()} disabled={!expForm.head_id || !expForm.amount || addExpense.isPending} className="btn-primary">Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
