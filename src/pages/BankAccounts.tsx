import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import toast from 'react-hot-toast'

type Row={id:string;bank_name:string;account_holder:string;account_no:string;ifsc:string;account_type:string;opening_balance:number;is_default:boolean;active:boolean}

export default function BankAccounts(){
  const[rows,setRows]=useState<Row[]>([])
  const[show,setShow]=useState(false)
  const[form,setForm]=useState({bank_name:'',account_holder:'',account_no:'',ifsc:'',account_type:'current',opening_balance:''})
  const load=async()=>{ const{data}=await supabase.from('company_bank_accounts').select('*').order('created_at',{ascending:false}); setRows((data||[]) as Row[]) }
  useEffect(()=>{load()},[])
  const save=async()=>{
    const{error}=await supabase.from('company_bank_accounts').insert({...form,opening_balance:Number(form.opening_balance||0)})
    if(error) toast.error(error.message); else { toast.success('Added'); setShow(false); load() }
  }
  const setDefault=async(id:string)=>{
    await supabase.from('company_bank_accounts').update({is_default:false}).neq('id','00000000-0000-0000-0000-000000000000')
    await supabase.from('company_bank_accounts').update({is_default:true}).eq('id',id)
    load()
  }
  return(
    <div className="p-6 space-y-4">
      <div className="flex justify-between items-center"><h1 className="text-2xl font-semibold">Company Bank Accounts</h1><button onClick={()=>setShow(true)} className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm">+ Add</button></div>
      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
        {rows.map(r=>(
          <div key={r.id} className={`bg-white rounded-xl shadow p-4 ${r.is_default?'ring-2 ring-blue-500':''}`}>
            <h3 className="font-medium">{r.bank_name}</h3>
            <p className="text-sm">{r.account_holder}</p>
            <p className="font-mono text-sm">{r.account_no}</p>
            <p className="text-xs text-slate-500">IFSC {r.ifsc} · {r.account_type}</p>
            <p className="text-xs mt-1">Opening ₹{Number(r.opening_balance).toLocaleString()}</p>
            {!r.is_default&&<button onClick={()=>setDefault(r.id)} className="mt-2 text-xs text-blue-600">Set as default</button>}
          </div>
        ))}
      </div>
      {show&&(
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-full max-w-md space-y-2">
            <h2 className="font-semibold">New Bank Account</h2>
            {(['bank_name','account_holder','account_no','ifsc'] as const).map(k=>(
              <input key={k} placeholder={k} value={(form as any)[k]} onChange={e=>setForm({...form,[k]:e.target.value})} className="w-full border rounded px-3 py-2 text-sm"/>
            ))}
            <select value={form.account_type} onChange={e=>setForm({...form,account_type:e.target.value})} className="w-full border rounded px-3 py-2 text-sm"><option value="current">Current</option><option value="savings">Savings</option></select>
            <input placeholder="Opening balance" type="number" value={form.opening_balance} onChange={e=>setForm({...form,opening_balance:e.target.value})} className="w-full border rounded px-3 py-2 text-sm"/>
            <div className="flex justify-end gap-2"><button onClick={()=>setShow(false)} className="px-4 py-2 text-sm">Cancel</button><button onClick={save} className="bg-blue-600 text-white px-4 py-2 rounded text-sm">Save</button></div>
          </div>
        </div>
      )}
    </div>
  )
}
