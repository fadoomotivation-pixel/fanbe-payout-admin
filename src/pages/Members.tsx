import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import toast from 'react-hot-toast'

type Row={ id:string; member_code:string; name:string; mobile:string; city:string|null; is_customer:boolean; customer_id:string|null }

export default function Members(){
  const[rows,setRows]=useState<Row[]>([])
  const[show,setShow]=useState(false)
  const[form,setForm]=useState({name:'',mobile:'',city:'',state:'',email:'',aadhaar:'',pan:''})
  const load=async()=>{
    const {data,error}=await supabase.from('registry_members').select('*').order('created_at',{ascending:false}).limit(500)
    if(error) toast.error(error.message); else setRows((data||[]) as Row[])
  }
  useEffect(()=>{load()},[])
  const create=async()=>{
    const code='RM'+Date.now().toString().slice(-7)
    const {error}=await supabase.from('registry_members').insert({...form,member_code:code})
    if(error) toast.error(error.message); else { toast.success('Member created'); setShow(false); load() }
  }
  const convert=async(r:Row)=>{
    if(r.is_customer) return
    if(!confirm(`Convert ${r.name} to customer?`)) return
    const code='CR'+Date.now().toString().slice(-6)
    const {data,error}=await supabase.from('customers').insert({customer_code:code,name:r.name,mobile:r.mobile,registry_member_id:r.id}).select('id').single()
    if(error){ toast.error(error.message); return }
    await supabase.from('registry_members').update({is_customer:true,customer_id:data.id}).eq('id',r.id)
    toast.success('Converted to customer')
    load()
  }
  return(
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Registry Members</h1>
        <button onClick={()=>setShow(true)} className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm">+ Add Member</button>
      </div>
      <div className="bg-white rounded-xl shadow overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left"><tr><th className="p-3">Code</th><th className="p-3">Name</th><th className="p-3">Mobile</th><th className="p-3">City</th><th className="p-3">Status</th><th className="p-3">Action</th></tr></thead>
          <tbody>
            {rows.map(r=>(
              <tr key={r.id} className="border-t">
                <td className="p-3 font-mono">{r.member_code}</td>
                <td className="p-3 font-medium">{r.name}</td>
                <td className="p-3">{r.mobile}</td>
                <td className="p-3">{r.city||'-'}</td>
                <td className="p-3">{r.is_customer?<span className="text-green-700 text-xs">Customer</span>:<span className="text-slate-500 text-xs">Member</span>}</td>
                <td className="p-3">{r.is_customer?<span className="text-xs text-slate-400">Already converted</span>:<button onClick={()=>convert(r)} className="text-xs bg-emerald-600 text-white px-3 py-1 rounded">Convert to Customer</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {show&&(
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-full max-w-md space-y-3">
            <h2 className="font-semibold">New Registry Member</h2>
            {(['name','mobile','city','state','email','aadhaar','pan'] as const).map(k=>(
              <input key={k} placeholder={k} value={(form as any)[k]} onChange={e=>setForm({...form,[k]:e.target.value})} className="w-full border rounded px-3 py-2 text-sm"/>
            ))}
            <div className="flex justify-end gap-2 pt-2">
              <button onClick={()=>setShow(false)} className="px-4 py-2 text-sm">Cancel</button>
              <button onClick={create} className="bg-blue-600 text-white px-4 py-2 rounded text-sm">Create</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
