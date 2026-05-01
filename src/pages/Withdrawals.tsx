import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import toast from 'react-hot-toast'
import { computeWithdrawal, loadPayoutConfig, type PayoutConfig } from '@/lib/payoutEngine'

type Row={id:string;broker_id:string;amount:number;net_amount:number;status:string;bank_name:string|null;account_no:string|null;created_at:string;utr:string|null}

export default function Withdrawals(){
  const[rows,setRows]=useState<Row[]>([])
  const[cfg,setCfg]=useState<PayoutConfig|null>(null)
  const load=async()=>{
    const{data,error}=await supabase.from('withdrawal_requests').select('*').order('created_at',{ascending:false}).limit(300)
    if(error) toast.error(error.message); else setRows((data||[]) as Row[])
  }
  useEffect(()=>{load(); loadPayoutConfig().then(setCfg)},[])
  const act=async(id:string,status:string,extra:any={})=>{
    const{error}=await supabase.from('withdrawal_requests').update({status,approved_at:new Date().toISOString(),...extra}).eq('id',id)
    if(error) toast.error(error.message); else { toast.success(status); load() }
  }
  return(
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Withdrawal Requests</h1>
        {cfg&&<p className="text-xs text-slate-500">Admin {cfg.admin_charge_pct}% · TDS {cfg.tds_pct}% · Min ₹{cfg.min_withdrawal}</p>}
      </div>
      <div className="bg-white rounded-xl shadow overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left"><tr><th className="p-3">Date</th><th className="p-3">Broker</th><th className="p-3">Bank</th><th className="p-3">Gross</th><th className="p-3">Net</th><th className="p-3">Status</th><th className="p-3">Action</th></tr></thead>
          <tbody>
            {rows.map(r=>{
              const calc=cfg?computeWithdrawal(Number(r.amount),cfg):null
              return(
                <tr key={r.id} className="border-t">
                  <td className="p-3">{new Date(r.created_at).toLocaleDateString()}</td>
                  <td className="p-3 font-mono text-xs">{r.broker_id.slice(0,8)}</td>
                  <td className="p-3">{r.bank_name||'-'}<div className="text-xs text-slate-500">{r.account_no}</div></td>
                  <td className="p-3">₹{Number(r.amount).toLocaleString()}{calc&&<div className="text-xs text-slate-500">−{calc.admin}+{calc.tds}</div>}</td>
                  <td className="p-3 font-medium">₹{Number(r.net_amount).toLocaleString()}</td>
                  <td className="p-3"><span className={`text-xs px-2 py-1 rounded-full ${r.status==='approved'?'bg-emerald-100 text-emerald-700':r.status==='rejected'?'bg-rose-100 text-rose-700':r.status==='paid'?'bg-blue-100 text-blue-700':'bg-amber-100 text-amber-700'}`}>{r.status}</span></td>
                  <td className="p-3 space-x-1">
                    {r.status==='pending'&&<>
                      <button onClick={()=>act(r.id,'approved')} className="text-xs bg-emerald-600 text-white px-2 py-1 rounded">Approve</button>
                      <button onClick={()=>act(r.id,'rejected',{rejection_reason:prompt('Reason?')||''})} className="text-xs bg-rose-600 text-white px-2 py-1 rounded">Reject</button>
                    </>}
                    {r.status==='approved'&&<button onClick={()=>{const utr=prompt('UTR?'); if(utr) act(r.id,'paid',{utr,paid_at:new Date().toISOString()})}} className="text-xs bg-blue-600 text-white px-2 py-1 rounded">Mark Paid</button>}
                    {r.utr&&<span className="text-xs text-slate-500">UTR {r.utr}</span>}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
