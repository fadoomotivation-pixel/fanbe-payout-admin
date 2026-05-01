import { useState } from 'react'
import { supabase } from '@/lib/supabase'
import toast from 'react-hot-toast'
import { generateEmiSchedule, type EmiFrequency, type InterestMethod } from '@/lib/emiEngine'

export default function EMI(){
  const[bookingId,setBookingId]=useState('')
  const[principal,setPrincipal]=useState('')
  const[freq,setFreq]=useState<EmiFrequency>('monthly')
  const[n,setN]=useState('12')
  const[rate,setRate]=useState('0')
  const[method,setMethod]=useState<InterestMethod>('flat')
  const[start,setStart]=useState(new Date().toISOString().slice(0,10))
  const sch=principal&&Number(principal)>0?generateEmiSchedule({principal:Number(principal),numInstallments:Number(n)||1,startDate:start,frequency:freq,interestRatePct:Number(rate)||0,interestMethod:method}):null
  const save=async()=>{
    if(!bookingId||!sch) return toast.error('Booking + principal required')
    const{data,error}=await supabase.from('emi_schedules').insert({booking_id:bookingId,frequency:freq,start_date:start,num_installments:Number(n),principal:Number(principal),interest_rate_pct:Number(rate)||0,interest_method:method,total_payable:sch.totalPayable}).select('id').single()
    if(error||!data) return toast.error(error?.message||'failed')
    const rows=sch.installments.map(i=>({schedule_id:data.id,seq:i.seq,due_date:i.dueDate,amount:i.amount,principal_component:i.principalComponent,interest_component:i.interestComponent}))
    const{error:e2}=await supabase.from('emi_installments').insert(rows)
    if(e2) toast.error(e2.message); else toast.success('EMI schedule created')
  }
  return(
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-semibold">EMI Calculator & Schedule</h1>
      <div className="grid md:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl shadow p-4 space-y-2">
          <input placeholder="Booking ID" value={bookingId} onChange={e=>setBookingId(e.target.value)} className="w-full border rounded px-3 py-2 text-sm"/>
          <input placeholder="Principal amount" type="number" value={principal} onChange={e=>setPrincipal(e.target.value)} className="w-full border rounded px-3 py-2 text-sm"/>
          <div className="grid grid-cols-2 gap-2">
            <select value={freq} onChange={e=>setFreq(e.target.value as EmiFrequency)} className="border rounded px-3 py-2 text-sm"><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option><option value="half_yearly">Half-yearly</option><option value="annual">Annual</option></select>
            <input placeholder="# installments" type="number" value={n} onChange={e=>setN(e.target.value)} className="border rounded px-3 py-2 text-sm"/>
            <input placeholder="Interest %" type="number" step="0.01" value={rate} onChange={e=>setRate(e.target.value)} className="border rounded px-3 py-2 text-sm"/>
            <select value={method} onChange={e=>setMethod(e.target.value as InterestMethod)} className="border rounded px-3 py-2 text-sm"><option value="flat">Flat</option><option value="reducing">Reducing</option></select>
            <input type="date" value={start} onChange={e=>setStart(e.target.value)} className="border rounded px-3 py-2 text-sm col-span-2"/>
          </div>
          <button onClick={save} className="bg-blue-600 text-white rounded px-4 py-2 text-sm">Save Schedule</button>
        </div>
        <div className="bg-white rounded-xl shadow p-4">
          {sch?<>
            <div className="grid grid-cols-3 gap-2 text-center mb-3">
              <div><p className="text-xs text-slate-500">Per Inst.</p><p className="font-semibold">₹{sch.installmentAmount.toLocaleString()}</p></div>
              <div><p className="text-xs text-slate-500">Interest</p><p className="font-semibold">₹{sch.totalInterest.toLocaleString()}</p></div>
              <div><p className="text-xs text-slate-500">Total</p><p className="font-semibold">₹{sch.totalPayable.toLocaleString()}</p></div>
            </div>
            <div className="max-h-80 overflow-y-auto">
              <table className="w-full text-xs"><thead className="bg-slate-50"><tr><th className="p-2 text-left">#</th><th className="p-2 text-left">Due</th><th className="p-2 text-right">EMI</th><th className="p-2 text-right">Principal</th><th className="p-2 text-right">Interest</th></tr></thead>
                <tbody>{sch.installments.map(i=>(<tr key={i.seq} className="border-t"><td className="p-2">{i.seq}</td><td className="p-2">{i.dueDate}</td><td className="p-2 text-right">₹{i.amount.toLocaleString()}</td><td className="p-2 text-right">₹{i.principalComponent.toLocaleString()}</td><td className="p-2 text-right">₹{i.interestComponent.toLocaleString()}</td></tr>))}</tbody>
              </table>
            </div>
          </>:<p className="text-sm text-slate-500">Enter principal to preview schedule.</p>}
        </div>
      </div>
    </div>
  )
}
