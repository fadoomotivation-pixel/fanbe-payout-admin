import { useEffect, useMemo, useState } from 'react'
import { supabase } from '@/lib/supabase'
import toast from 'react-hot-toast'

type Head = { id: string; name: string }
type Broker = { id: string; name: string | null; broker_id: string | null }
type Row = {
  id: string; item_name: string; amount: number; head_id: string | null
  expense_date: string; description: string | null
  responsible_person: string | null; broker_id: string | null
}

// Heads that are about money owed to / taken by a specific broker.  When one of
// these is picked, the form asks WHICH broker so the spend can be attributed
// (and, for Advance, later debited from that broker's payout).
const BROKER_HEADS = ['advance', 'payout', 'discount']

export default function Expenses() {
  const [heads, setHeads] = useState<Head[]>([])
  const [rows, setRows] = useState<Row[]>([])
  const [brokers, setBrokers] = useState<Broker[]>([])
  const [form, setForm] = useState({ item_name: '', amount: '', head_id: '', description: '', responsible_person: '', broker_id: '' })
  const [newHead, setNewHead] = useState('')

  const load = async () => {
    const [a, b, c] = await Promise.all([
      supabase.from('expense_heads').select('id,name').order('name'),
      supabase.from('expenses').select('id,item_name,amount,head_id,expense_date,description,responsible_person,broker_id').order('expense_date', { ascending: false }).limit(200),
      supabase.from('brokers').select('id,name,broker_id').order('name'),
    ])
    if (a.data) setHeads(a.data as Head[])
    if (b.data) setRows(b.data as Row[])
    if (c.data) setBrokers(c.data as Broker[])
  }
  useEffect(() => { load() }, [])

  const headById = useMemo(() => Object.fromEntries(heads.map(h => [h.id, h.name])), [heads])
  const brokerById = useMemo(() => Object.fromEntries(brokers.map(b => [b.id, b])), [brokers])
  const selectedHeadName = (headById[form.head_id] || '').toLowerCase()
  const headWantsBroker = BROKER_HEADS.includes(selectedHeadName)

  const addHead = async () => {
    if (!newHead.trim()) return
    const { error } = await supabase.from('expense_heads').insert({ name: newHead.trim() })
    if (error) toast.error(error.message); else { setNewHead(''); load() }
  }

  const addExpense = async () => {
    if (!form.item_name || !form.amount) return toast.error('Item & amount required')
    if (headWantsBroker && !form.broker_id) return toast.error(`Pick the broker this ${selectedHeadName} is for.`)
    const { error } = await supabase.from('expenses').insert({
      item_name: form.item_name,
      amount: Number(form.amount),
      head_id: form.head_id || null,
      description: form.description || null,
      responsible_person: form.responsible_person.trim() || null,
      // Only attach a broker when the head is a broker-linked one.
      broker_id: headWantsBroker ? form.broker_id : null,
    })
    if (error) toast.error(error.message)
    else { toast.success('Expense added'); setForm({ item_name: '', amount: '', head_id: '', description: '', responsible_person: '', broker_id: '' }); load() }
  }

  const total = rows.reduce((s, r) => s + Number(r.amount), 0)
  const brokerLabel = (id: string | null) => {
    if (!id) return null
    const b = brokerById[id]
    return b ? `${b.name || '—'}${b.broker_id ? ` [${b.broker_id}]` : ''}` : '—'
  }

  return (
    <div className="p-3 md:p-6 space-y-4">
      <h1 className="text-2xl font-semibold">Expenses</h1>
      <div className="grid md:grid-cols-3 gap-4">
        <div className="md:col-span-2 bg-white rounded-xl shadow p-4 space-y-2">
          <h2 className="font-medium">Add Expense</h2>
          <input placeholder="Item name" value={form.item_name} onChange={e => setForm({ ...form, item_name: e.target.value })} className="w-full border rounded px-3 py-2 text-sm" />
          <input placeholder="Amount (₹)" type="number" value={form.amount} onChange={e => setForm({ ...form, amount: e.target.value })} className="w-full border rounded px-3 py-2 text-sm" />
          <select value={form.head_id} onChange={e => setForm({ ...form, head_id: e.target.value, broker_id: '' })} className="w-full border rounded px-3 py-2 text-sm">
            <option value="">-- Expense head --</option>
            {heads.map(h => <option key={h.id} value={h.id}>{h.name}</option>)}
          </select>
          {/* Broker attribution — only for Advance / Payout / Discount heads. */}
          {headWantsBroker && (
            <div>
              <select value={form.broker_id} onChange={e => setForm({ ...form, broker_id: e.target.value })} className="w-full border rounded px-3 py-2 text-sm">
                <option value="">-- Broker this {selectedHeadName} is for --</option>
                {brokers.map(b => <option key={b.id} value={b.id}>{b.name || '—'}{b.broker_id ? ` [${b.broker_id}]` : ''}</option>)}
              </select>
              {selectedHeadName === 'advance' && (
                <p className="text-[11px] text-amber-700 mt-1">Advance is money paid to the broker up front — it will be deducted from what they can withdraw.</p>
              )}
            </div>
          )}
          {/* Who is accountable for this spend. */}
          <input placeholder="Responsible person (who is accountable)" value={form.responsible_person} onChange={e => setForm({ ...form, responsible_person: e.target.value })} className="w-full border rounded px-3 py-2 text-sm" />
          <input placeholder="Description" value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} className="w-full border rounded px-3 py-2 text-sm" />
          <button onClick={addExpense} className="bg-blue-600 text-white rounded px-4 py-2 text-sm">Add</button>
        </div>
        <div className="bg-white rounded-xl shadow p-4 space-y-2">
          <h2 className="font-medium">Expense Heads</h2>
          <div className="flex gap-2">
            <input value={newHead} onChange={e => setNewHead(e.target.value)} placeholder="e.g. Electricity" className="flex-1 border rounded px-3 py-2 text-sm" />
            <button onClick={addHead} className="bg-emerald-600 text-white rounded px-3 text-sm">+</button>
          </div>
          <ul className="text-sm divide-y">{heads.map(h => <li key={h.id} className="py-1.5">{h.name}</li>)}</ul>
        </div>
      </div>
      <div className="bg-white rounded-xl shadow overflow-x-auto">
        <div className="flex justify-between p-4 border-b"><h2 className="font-medium">Recent Expenses</h2><span className="text-sm text-slate-600">Total ₹{total.toLocaleString('en-IN')}</span></div>
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left"><tr><th className="p-3">Date</th><th className="p-3">Head</th><th className="p-3">Item</th><th className="p-3">Amount</th><th className="p-3">Broker</th><th className="p-3">Responsible</th><th className="p-3">Description</th></tr></thead>
          <tbody>{rows.map(r => (
            <tr key={r.id} className="border-t">
              <td className="p-3">{r.expense_date}</td>
              <td className="p-3">{r.head_id ? (headById[r.head_id] || '—') : '—'}</td>
              <td className="p-3">{r.item_name}</td>
              <td className="p-3">₹{Number(r.amount).toLocaleString('en-IN')}</td>
              <td className="p-3">{brokerLabel(r.broker_id) || '—'}</td>
              <td className="p-3">{r.responsible_person || '—'}</td>
              <td className="p-3">{r.description || '-'}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
    </div>
  )
}
