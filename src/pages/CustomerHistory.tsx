import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

type Customer={id:string;customer_code:string;name:string;mobile:string;city:string|null;address:string|null}
type Booking={id:string;cost:number;project_name?:string;plot_no?:string;created_at:string}
type Payment={id:string;amount:number;status:string;created_at:string;mode?:string;receipt_no?:string}

export default function CustomerHistory(){
  const[code,setCode]=useState('')
  const[customer,setCustomer]=useState<Customer|null>(null)
  const[bookings,setBookings]=useState<Booking[]>([])
  const[payments,setPayments]=useState<Payment[]>([])
  const search=async()=>{
    if(!code.trim()) return
    const{data}=await supabase.from('customers').select('*').eq('customer_code',code.trim()).maybeSingle()
    setCustomer(data as Customer|null)
    if(data){
      const[b,p]=await Promise.all([
        supabase.from('bookings').select('*').eq('customer_id',data.id),
        supabase.from('payments').select('*').eq('customer_id',data.id).order('created_at',{ascending:false}),
      ])
      setBookings((b.data||[]) as Booking[])
      setPayments((p.data||[]) as Payment[])
    }
  }
  const totalCost=bookings.reduce((s,b)=>s+Number(b.cost||0),0)
  const paid=payments.filter(p=>p.status==='approved').reduce((s,p)=>s+Number(p.amount),0)
  const pending=totalCost-paid
  return(
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-semibold">Customer History</h1>
      <div className="bg-white rounded-xl shadow p-4 flex gap-2">
        <input value={code} onChange={e=>setCode(e.target.value)} placeholder="Customer code (e.g. CR0006)" className="flex-1 border rounded px-3 py-2 text-sm"/>
        <button onClick={search} className="bg-blue-600 text-white px-4 py-2 rounded text-sm">Search</button>
      </div>
      {customer&&<>
        <div className="grid md:grid-cols-4 gap-4">
          <div className="bg-white rounded-xl shadow p-4 md:col-span-2">
            <h2 className="font-medium">{customer.name} <span className="font-mono text-xs text-slate-500 ml-2">{customer.customer_code}</span></h2>
            <p className="text-sm">{customer.mobile}</p>
            <p className="text-sm text-slate-500">{customer.address} {customer.city}</p>
          </div>
          <div className="bg-white rounded-xl shadow p-4"><p className="text-xs text-slate-500">Total Cost</p><p className="text-xl font-semibold">₹{totalCost.toLocaleString()}</p></div>
          <div className="bg-white rounded-xl shadow p-4"><p className="text-xs text-slate-500">Pending</p><p className="text-xl font-semibold text-rose-600">₹{pending.toLocaleString()}</p></div>
        </div>
        <div className="bg-white rounded-xl shadow overflow-x-auto">
          <h2 className="font-medium p-4 border-b">Bookings</h2>
          <table className="w-full text-sm"><thead className="bg-slate-50 text-left"><tr><th className="p-3">Date</th><th className="p-3">Project</th><th className="p-3">Plot</th><th className="p-3">Cost</th></tr></thead>
            <tbody>{bookings.map(b=>(<tr key={b.id} className="border-t"><td className="p-3">{new Date(b.created_at).toLocaleDateString()}</td><td className="p-3">{b.project_name||'-'}</td><td className="p-3">{b.plot_no||'-'}</td><td className="p-3">₹{Number(b.cost).toLocaleString()}</td></tr>))}</tbody></table>
        </div>
        <div className="bg-white rounded-xl shadow overflow-x-auto">
          <h2 className="font-medium p-4 border-b">Receipts</h2>
          <table className="w-full text-sm"><thead className="bg-slate-50 text-left"><tr><th className="p-3">Date</th><th className="p-3">Receipt</th><th className="p-3">Amount</th><th className="p-3">Status</th></tr></thead>
            <tbody>{payments.map(p=>(<tr key={p.id} className="border-t"><td className="p-3">{new Date(p.created_at).toLocaleDateString()}</td><td className="p-3 font-mono text-xs">{p.receipt_no||p.id.slice(0,8)}</td><td className="p-3">₹{Number(p.amount).toLocaleString()}</td><td className="p-3"><span className={`text-xs px-2 py-1 rounded-full ${p.status==='approved'?'bg-emerald-100 text-emerald-700':'bg-amber-100 text-amber-700'}`}>{p.status}</span></td></tr>))}</tbody></table>
        </div>
      </>}
      {!customer&&code&&<p className="text-sm text-slate-500">No customer found.</p>}
    </div>
  )
}
