import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import toast from 'react-hot-toast'

type Head={id:string;name:string}
type Row={id:string;item_name:string;amount:number;head_id:string|null;expense_date:string;description:string|null}

export default function Expenses(){
  const[heads,setHeads]=useState<Head[]>([])
  const[rows,setRows]=useState<Row[]>([])
  const[form,setForm]=useState({item_name:'',amount:'',head_id:'',description:''})
  const[newHead,setNewHead]=useState('')
  const load=async()=>{
    const[a,b]=await Promise.all([
      supabase.from('expense_heads').select('*').order('name'),
      supabase.from('expenses').select('*').order('expense_date',{ascending:false}).limit(200),
    ])
    if(a.data) setHeads(a.data as Head[])
    if(b.data) setRows(b.data as Row[])
  }
  useEffect(()=>{load()},[])
  const addHead=async()=>{
    if(!newHead.trim()) return
    const{error}=await supabase.from('expense_heads').insert({name:newHead.trim()})
    if(error) toast.error(error.message); else { setNewHead(''); load() }
  }
  const addExpense=async()=>{
    if(!form.item_name||!form.amount) return toast.error('Item & amount required')
    const{error}=await supabase.from('expenses').insert({...form,amount:Number(form.amount)})
    if(error) toast.error(error.message); else { toast.success('Expense added'); setForm({item_name:'',amount:'',head_id:'',description:''}); load() }
  }
  const total=rows.reduce((s,r)=>s+Number(r.amount),0)
  return(
    <div className="p-3 md:p-6 space-y-4">
      <h1 className="text-2xl font-semibold">Expenses</h1>
      <div className="grid md:grid-cols-3 gap-4">
        <div className="md:col-span-2 bg-white rounded-xl shadow p-4 space-y-2">
          <h2 className="font-medium">Add Expense</h2>
          <input placeholder="Item name" value={form.item_name} onChange={e=>setForm({...form,item_name:e.target.value})} className="w-full border rounded px-3 py-2 text-sm"/>
          <input placeholder="Amount" type="number" value={form.amount} onChange={e=>setForm({...form,amount:e.target.value})} className="w-full border rounded px-3 py-2 text-sm"/>
          <select value={form.head_id} onChange={e=>setForm({...form,head_id:e.target.value})} className="w-full border rounded px-3 py-2 text-sm">
            <option value="">-- Expense head --</option>
            {heads.map(h=><option key={h.id} value={h.id}>{h.name}</option>)}
          </select>
          <input placeholder="Description" value={form.description} onChange={e=>setForm({...form,description:e.target.value})} className="w-full border rounded px-3 py-2 text-sm"/>
          <button onClick={addExpense} className="bg-blue-600 text-white rounded px-4 py-2 text-sm">Add</button>
        </div>
        <div className="bg-white rounded-xl shadow p-4 space-y-2">
          <h2 className="font-medium">Expense Heads</h2>
          <div className="flex gap-2">
            <input value={newHead} onChange={e=>setNewHead(e.target.value)} placeholder="e.g. Electricity" className="flex-1 border rounded px-3 py-2 text-sm"/>
            <button onClick={addHead} className="bg-emerald-600 text-white rounded px-3 text-sm">+</button>
          </div>
          <ul className="text-sm divide-y">{heads.map(h=><li key={h.id} className="py-1.5">{h.name}</li>)}</ul>
        </div>
      </div>
      <div className="bg-white rounded-xl shadow overflow-x-auto">
        <div className="flex justify-between p-4 border-b"><h2 className="font-medium">Recent Expenses</h2><span className="text-sm text-slate-600">Total ₹{total.toLocaleString()}</span></div>
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left"><tr><th className="p-3">Date</th><th className="p-3">Item</th><th className="p-3">Amount</th><th className="p-3">Description</th></tr></thead>
          <tbody>{rows.map(r=>(<tr key={r.id} className="border-t"><td className="p-3">{r.expense_date}</td><td className="p-3">{r.item_name}</td><td className="p-3">₹{Number(r.amount).toLocaleString()}</td><td className="p-3">{r.description||'-'}</td></tr>))}</tbody>
        </table>
      </div>
    </div>
  )
}
