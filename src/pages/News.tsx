import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import toast from 'react-hot-toast'

type Row={id:string;title:string;post_type:string;description:string|null;image_url:string|null;publish_from:string|null;publish_to:string|null;is_active:boolean;state:string}

export default function News(){
  const[rows,setRows]=useState<Row[]>([])
  const[show,setShow]=useState(false)
  const[form,setForm]=useState({title:'',post_type:'news',description:'',image_url:'',publish_from:'',publish_to:''})
  const[postFilter,setPostFilter]=useState('')
  const load=async()=>{
    let q=supabase.from('news_events').select('*').order('created_at',{ascending:false})
    if(postFilter) q=q.eq('post_type',postFilter)
    const{data}=await q
    setRows((data||[]) as Row[])
  }
  useEffect(()=>{load()},[postFilter])
  const create=async()=>{
    if(!form.title) return toast.error('Title required')
    const{error}=await supabase.from('news_events').insert({...form,state:'published'})
    if(error) toast.error(error.message); else { toast.success('Created'); setShow(false); setForm({title:'',post_type:'news',description:'',image_url:'',publish_from:'',publish_to:''}); load() }
  }
  const toggle=async(r:Row)=>{ await supabase.from('news_events').update({is_active:!r.is_active}).eq('id',r.id); load() }
  const remove=async(id:string)=>{ if(confirm('Delete?')){ await supabase.from('news_events').delete().eq('id',id); load() } }
  return(
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">News & Events</h1>
        <div className="flex gap-2">
          <select value={postFilter} onChange={e=>setPostFilter(e.target.value)} className="border rounded px-3 py-2 text-sm">
            <option value="">All</option><option value="news">News</option><option value="event">Event</option><option value="popup">Popup</option>
          </select>
          <button onClick={()=>setShow(true)} className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm">+ New</button>
        </div>
      </div>
      <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
        {rows.map(r=>(
          <div key={r.id} className="bg-white rounded-xl shadow p-4 space-y-2">
            <div className="flex justify-between items-start">
              <div><span className="text-xs uppercase tracking-wide text-slate-500">{r.post_type}</span><h3 className="font-medium">{r.title}</h3></div>
              <button onClick={()=>toggle(r)} className={`text-xs px-2 py-1 rounded ${r.is_active?'bg-emerald-100 text-emerald-700':'bg-slate-200'}`}>{r.is_active?'Active':'Off'}</button>
            </div>
            {r.image_url&&<img src={r.image_url} className="w-full h-32 object-cover rounded"/>}
            {r.description&&<p className="text-sm text-slate-600 line-clamp-3">{r.description}</p>}
            <div className="text-xs text-slate-500">{r.publish_from} → {r.publish_to||'∞'}</div>
            <button onClick={()=>remove(r.id)} className="text-xs text-rose-600">Delete</button>
          </div>
        ))}
      </div>
      {show&&(
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl p-6 w-full max-w-md space-y-3">
            <h2 className="font-semibold">New Post</h2>
            <input placeholder="Title" value={form.title} onChange={e=>setForm({...form,title:e.target.value})} className="w-full border rounded px-3 py-2 text-sm"/>
            <select value={form.post_type} onChange={e=>setForm({...form,post_type:e.target.value})} className="w-full border rounded px-3 py-2 text-sm"><option value="news">News</option><option value="event">Event</option><option value="popup">Popup</option></select>
            {form.post_type==='popup'?<input placeholder="Image URL" value={form.image_url} onChange={e=>setForm({...form,image_url:e.target.value})} className="w-full border rounded px-3 py-2 text-sm"/>:<textarea placeholder="Description" value={form.description} onChange={e=>setForm({...form,description:e.target.value})} className="w-full border rounded px-3 py-2 text-sm h-24"/>}
            <div className="grid grid-cols-2 gap-2">
              <input type="date" value={form.publish_from} onChange={e=>setForm({...form,publish_from:e.target.value})} className="border rounded px-3 py-2 text-sm"/>
              <input type="date" value={form.publish_to} onChange={e=>setForm({...form,publish_to:e.target.value})} className="border rounded px-3 py-2 text-sm"/>
            </div>
            <div className="flex justify-end gap-2"><button onClick={()=>setShow(false)} className="px-4 py-2 text-sm">Cancel</button><button onClick={create} className="bg-blue-600 text-white px-4 py-2 rounded text-sm">Publish</button></div>
          </div>
        </div>
      )}
    </div>
  )
}
