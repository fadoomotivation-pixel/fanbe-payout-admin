import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import toast from 'react-hot-toast'

type Section={id:string;name:string}
type Ticket={id:string;ticket_no:string;subject:string;status:string;priority:string;user_name:string|null;section_id:string|null;created_at:string}
type Msg={id:string;message:string;sender_role:string|null;created_at:string}

export default function Tickets(){
  const[sections,setSections]=useState<Section[]>([])
  const[tickets,setTickets]=useState<Ticket[]>([])
  const[active,setActive]=useState<Ticket|null>(null)
  const[msgs,setMsgs]=useState<Msg[]>([])
  const[reply,setReply]=useState('')
  const load=async()=>{
    const[s,t]=await Promise.all([
      supabase.from('ticket_sections').select('*'),
      supabase.from('tickets').select('*').order('created_at',{ascending:false}).limit(200),
    ])
    setSections((s.data||[]) as Section[])
    setTickets((t.data||[]) as Ticket[])
  }
  useEffect(()=>{load()},[])
  const open=async(t:Ticket)=>{
    setActive(t)
    const{data}=await supabase.from('ticket_messages').select('*').eq('ticket_id',t.id).order('created_at')
    setMsgs((data||[]) as Msg[])
  }
  const send=async()=>{
    if(!active||!reply.trim()) return
    const{error}=await supabase.from('ticket_messages').insert({ticket_id:active.id,message:reply,sender_role:'admin'})
    if(error) toast.error(error.message); else { setReply(''); open(active) }
  }
  const setStatus=async(s:string)=>{
    if(!active) return
    await supabase.from('tickets').update({status:s,updated_at:new Date().toISOString()}).eq('id',active.id)
    toast.success(s); load()
  }
  return(
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-semibold">Support Tickets</h1>
      <div className="grid md:grid-cols-3 gap-4">
        <div className="bg-white rounded-xl shadow divide-y max-h-[70vh] overflow-y-auto">
          {tickets.map(t=>(
            <button key={t.id} onClick={()=>open(t)} className={`w-full text-left p-3 hover:bg-slate-50 ${active?.id===t.id?'bg-blue-50':''}`}>
              <div className="flex justify-between"><span className="font-mono text-xs">{t.ticket_no}</span><span className={`text-xs ${t.status==='closed'?'text-slate-400':'text-blue-600'}`}>{t.status}</span></div>
              <div className="text-sm font-medium truncate">{t.subject}</div>
              <div className="text-xs text-slate-500">{t.user_name||'-'} · {sections.find(s=>s.id===t.section_id)?.name||'-'}</div>
            </button>
          ))}
          {tickets.length===0&&<div className="p-6 text-sm text-slate-500">No tickets.</div>}
        </div>
        <div className="md:col-span-2 bg-white rounded-xl shadow flex flex-col max-h-[70vh]">
          {!active?<div className="p-10 text-center text-slate-500 text-sm">Select a ticket to view conversation.</div>:<>
            <div className="p-4 border-b flex items-center justify-between">
              <div><div className="font-medium">{active.subject}</div><div className="text-xs text-slate-500">#{active.ticket_no}</div></div>
              <div className="flex gap-1">
                <button onClick={()=>setStatus('in_progress')} className="text-xs bg-amber-100 text-amber-800 px-2 py-1 rounded">In Progress</button>
                <button onClick={()=>setStatus('closed')} className="text-xs bg-slate-200 px-2 py-1 rounded">Close</button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-4 space-y-2">
              {msgs.map(m=>(
                <div key={m.id} className={`max-w-md rounded-lg p-3 text-sm ${m.sender_role==='admin'?'ml-auto bg-blue-600 text-white':'bg-slate-100'}`}>
                  <div>{m.message}</div>
                  <div className="text-[10px] opacity-70 mt-1">{new Date(m.created_at).toLocaleString()}</div>
                </div>
              ))}
              {msgs.length===0&&<p className="text-sm text-slate-400">No messages yet.</p>}
            </div>
            <div className="p-3 border-t flex gap-2">
              <input value={reply} onChange={e=>setReply(e.target.value)} onKeyDown={e=>e.key==='Enter'&&send()} placeholder="Type a reply…" className="flex-1 border rounded px-3 py-2 text-sm"/>
              <button onClick={send} className="bg-blue-600 text-white px-4 rounded text-sm">Send</button>
            </div>
          </>}
        </div>
      </div>
    </div>
  )
}
