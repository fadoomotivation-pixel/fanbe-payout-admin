import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import toast from 'react-hot-toast'

type Row={id:string;rank_name:string;level:number;min_business:number;max_business:number|null;income_amount:number;income_pct:number;active:boolean}

export default function CommissionRanks(){
  const[rows,setRows]=useState<Row[]>([])
  const load=async()=>{ const{data}=await supabase.from('commission_ranks').select('*').order('level'); setRows((data||[]) as Row[]) }
  useEffect(()=>{load()},[])
  const update=async(id:string,patch:any)=>{ const{error}=await supabase.from('commission_ranks').update(patch).eq('id',id); if(error) toast.error(error.message); else load() }
  const add=async()=>{
    const next=(rows[rows.length-1]?.level||0)+1
    const{error}=await supabase.from('commission_ranks').insert({rank_name:`Rank ${next}`,level:next,min_business:0,income_amount:0,income_pct:0})
    if(error) toast.error(error.message); else load()
  }
  const num=(v:string)=>v===''?null:Number(v)
  return(
    <div className="p-6 space-y-4">
      <div className="flex justify-between items-center"><h1 className="text-2xl font-semibold">Commission Ranks</h1><button onClick={add} className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm">+ Add Rank</button></div>
      <p className="text-sm text-slate-500">Slabs auto-evaluate based on a broker's lifetime business volume. Used by the payout engine.</p>
      <div className="bg-white rounded-xl shadow overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left"><tr><th className="p-3">Lvl</th><th className="p-3">Rank</th><th className="p-3">Min Business</th><th className="p-3">Max Business</th><th className="p-3">Income ₹</th><th className="p-3">Income %</th><th className="p-3">Active</th></tr></thead>
          <tbody>
            {rows.map(r=>(
              <tr key={r.id} className="border-t">
                <td className="p-3">{r.level}</td>
                <td className="p-3"><input defaultValue={r.rank_name} onBlur={e=>update(r.id,{rank_name:e.target.value})} className="border rounded px-2 py-1"/></td>
                <td className="p-3"><input type="number" defaultValue={r.min_business} onBlur={e=>update(r.id,{min_business:Number(e.target.value)})} className="border rounded px-2 py-1 w-32"/></td>
                <td className="p-3"><input type="number" defaultValue={r.max_business??''} onBlur={e=>update(r.id,{max_business:num(e.target.value)})} className="border rounded px-2 py-1 w-32"/></td>
                <td className="p-3"><input type="number" defaultValue={r.income_amount} onBlur={e=>update(r.id,{income_amount:Number(e.target.value)})} className="border rounded px-2 py-1 w-28"/></td>
                <td className="p-3"><input type="number" step="0.01" defaultValue={r.income_pct} onBlur={e=>update(r.id,{income_pct:Number(e.target.value)})} className="border rounded px-2 py-1 w-20"/></td>
                <td className="p-3"><input type="checkbox" checked={r.active} onChange={e=>update(r.id,{active:e.target.checked})}/></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
