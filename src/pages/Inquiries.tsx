import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import toast from 'react-hot-toast'

type Row = { id:string; name:string; mobile:string; email:string|null; project_id:string|null; agent_code:string|null; status:string; created_at:string }

export default function Inquiries(){
  const [rows,setRows]=useState<Row[]>([])
  const [status,setStatus]=useState('')
  const [agent,setAgent]=useState('')
  const [loading,setLoading]=useState(true)
  const load=async()=>{
    setLoading(true)
    let q=supabase.from('inquiries').select('*').order('created_at',{ascending:false}).limit(500)
    if(status) q=q.eq('status',status)
    if(agent) q=q.eq('agent_code',agent)
    const {data,error}=await q
    if(error) toast.error(error.message); else setRows((data||[]) as Row[])
    setLoading(false)
  }
  useEffect(()=>{load()},[status,agent])
  const setRowStatus=async(id:string,s:string)=>{
    const {error}=await supabase.from('inquiries').update({status:s,updated_at:new Date().toISOString()}).eq('id',id)
    if(error) toast.error(error.message); else { toast.success('Updated'); load() }
  }
  return(
    <div className="p-3 md:p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Inquiries</h1>
        <div className="flex gap-2">
          <select value={status} onChange={e=>setStatus(e.target.value)} className="border rounded px-3 py-2 text-sm">
            <option value="">All status</option><option>new</option><option>contacted</option><option>qualified</option><option>converted</option><option>lost</option>
          </select>
          <input value={agent} onChange={e=>setAgent(e.target.value)} placeholder="Agent code" className="border rounded px-3 py-2 text-sm"/>
        </div>
      </div>
      <div className="bg-white rounded-xl shadow overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left"><tr>
            <th className="p-3">Date</th><th className="p-3">Name</th><th className="p-3">Mobile</th><th className="p-3">Email</th><th className="p-3">Agent</th><th className="p-3">Status</th><th className="p-3">Action</th>
          </tr></thead>
          <tbody>
            {loading?<tr><td className="p-6" colSpan={7}>Loading…</td></tr>:rows.map(r=>(
              <tr key={r.id} className="border-t">
                <td className="p-3">{new Date(r.created_at).toLocaleDateString()}</td>
                <td className="p-3 font-medium">{r.name}</td>
                <td className="p-3">{r.mobile}</td>
                <td className="p-3">{r.email||'-'}</td>
                <td className="p-3">{r.agent_code||'-'}</td>
                <td className="p-3"><span className="px-2 py-1 rounded-full bg-slate-100 text-xs">{r.status}</span></td>
                <td className="p-3">
                  <select value={r.status} onChange={e=>setRowStatus(r.id,e.target.value)} className="border rounded px-2 py-1 text-xs">
                    <option>new</option><option>contacted</option><option>qualified</option><option>converted</option><option>lost</option>
                  </select>
                </td>
              </tr>
            ))}
            {!loading&&rows.length===0&&<tr><td className="p-3 md:p-6 text-slate-500" colSpan={7}>No inquiries yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  )
}
