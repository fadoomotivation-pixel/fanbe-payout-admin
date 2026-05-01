import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'

export default function BalanceSheet(){
  const[rev,setRev]=useState(0)
  const[exp,setExp]=useState(0)
  const[payouts,setPayouts]=useState(0)
  useEffect(()=>{(async()=>{
    const[a,b,c]=await Promise.all([
      supabase.from('payments').select('amount,status'),
      supabase.from('expenses').select('amount'),
      supabase.from('payout_distributions').select('net_payout'),
    ])
    setRev((a.data||[]).filter((p:any)=>p.status==='approved').reduce((s:number,p:any)=>s+Number(p.amount),0))
    setExp((b.data||[]).reduce((s:number,p:any)=>s+Number(p.amount),0))
    setPayouts((c.data||[]).reduce((s:number,p:any)=>s+Number(p.net_payout),0))
  })()},[])
  const profit=rev-exp-payouts
  const Card=({label,value,tone}:{label:string;value:number;tone?:string})=>(
    <div className={`bg-white rounded-xl shadow p-5 border-l-4 ${tone||'border-blue-500'}`}>
      <p className="text-xs uppercase tracking-wide text-slate-500">{label}</p>
      <p className="text-2xl font-semibold mt-1">₹{value.toLocaleString()}</p>
    </div>
  )
  return(
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-semibold">Balance Sheet</h1>
      <div className="grid md:grid-cols-4 gap-4">
        <Card label="Total Revenue" value={rev} tone="border-emerald-500"/>
        <Card label="Total Expenses" value={exp} tone="border-rose-500"/>
        <Card label="Total Payouts" value={payouts} tone="border-amber-500"/>
        <Card label="Net Profit / Loss" value={profit} tone={profit>=0?'border-emerald-600':'border-rose-600'}/>
      </div>
      <div className="bg-white rounded-xl shadow p-5">
        <h2 className="font-medium mb-3">P&L Summary</h2>
        <table className="w-full text-sm">
          <tbody>
            <tr className="border-b"><td className="py-2">Revenue (approved payments)</td><td className="py-2 text-right text-emerald-700">+ ₹{rev.toLocaleString()}</td></tr>
            <tr className="border-b"><td className="py-2">Operating Expenses</td><td className="py-2 text-right text-rose-700">- ₹{exp.toLocaleString()}</td></tr>
            <tr className="border-b"><td className="py-2">Broker Payouts (net)</td><td className="py-2 text-right text-rose-700">- ₹{payouts.toLocaleString()}</td></tr>
            <tr className="font-semibold"><td className="py-2">Net P/L</td><td className={`py-2 text-right ${profit>=0?'text-emerald-700':'text-rose-700'}`}>₹{profit.toLocaleString()}</td></tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}
