import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import toast from 'react-hot-toast'

const PERMS=[
  'dashboard.view','projects.manage','plots.manage','bookings.create','bookings.view',
  'payments.confirm','customers.create','customers.edit','customers.delete',
  'brokers.manage','kyc.approve','withdrawals.approve','payouts.view',
  'expenses.create','reports.view','settings.manage','users.manage','tickets.manage',
]

type Role={id:string;name:string;description:string|null;is_system:boolean}

export default function Roles(){
  const[roles,setRoles]=useState<Role[]>([])
  const[active,setActive]=useState<Role|null>(null)
  const[granted,setGranted]=useState<Set<string>>(new Set())
  const[newRole,setNewRole]=useState('')
  const load=async()=>{ const{data}=await supabase.from('roles').select('*').order('name'); setRoles((data||[]) as Role[]) }
  useEffect(()=>{load()},[])
  useEffect(()=>{(async()=>{
    if(!active){setGranted(new Set());return}
    const{data}=await supabase.from('role_permissions').select('permission').eq('role_id',active.id)
    setGranted(new Set((data||[]).map((r:any)=>r.permission)))
  })()},[active])
  const toggle=(p:string)=>{ const s=new Set(granted); s.has(p)?s.delete(p):s.add(p); setGranted(s) }
  const save=async()=>{
    if(!active) return
    await supabase.from('role_permissions').delete().eq('role_id',active.id)
    const rows=[...granted].map(p=>({role_id:active.id,permission:p}))
    if(rows.length){ const{error}=await supabase.from('role_permissions').insert(rows); if(error) return toast.error(error.message) }
    toast.success('Permissions saved')
  }
  const create=async()=>{
    if(!newRole.trim()) return
    const{error}=await supabase.from('roles').insert({name:newRole.trim().toLowerCase().replace(/\s+/g,'_')})
    if(error) toast.error(error.message); else { setNewRole(''); load() }
  }
  return(
    <div className="p-3 md:p-6 space-y-4">
      <h1 className="text-2xl font-semibold">Roles & Permissions</h1>
      <div className="grid md:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl shadow p-4 space-y-2">
          <h2 className="font-medium">Roles</h2>
          <div className="flex gap-2"><input value={newRole} onChange={e=>setNewRole(e.target.value)} placeholder="new role" className="flex-1 border rounded px-3 py-2 text-sm"/><button onClick={create} className="bg-blue-600 text-white px-3 rounded text-sm">+</button></div>
          <ul className="divide-y">
            {roles.map(r=>(
              <li key={r.id}><button onClick={()=>setActive(r)} className={`w-full text-left py-2 px-2 text-sm ${active?.id===r.id?'bg-blue-50':''}`}>{r.name} {r.is_system&&<span className="text-[10px] text-slate-400 ml-1">system</span>}</button></li>
            ))}
          </ul>
        </div>
        <div className="md:col-span-2 bg-white rounded-xl shadow p-4 space-y-3">
          <div className="flex justify-between items-center"><h2 className="font-medium">{active?`Permissions for ${active.name}`:'Select a role'}</h2>{active&&<button onClick={save} className="bg-emerald-600 text-white px-4 py-2 rounded text-sm">Save</button>}</div>
          {active&&<div className="grid sm:grid-cols-2 gap-2">
            {PERMS.map(p=>(
              <label key={p} className="flex items-center gap-2 text-sm border rounded px-3 py-2">
                <input type="checkbox" checked={granted.has(p)} onChange={()=>toggle(p)}/>{p}
              </label>
            ))}
          </div>}
        </div>
      </div>
    </div>
  )
}
