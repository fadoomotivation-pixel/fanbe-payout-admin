import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import toast from 'react-hot-toast'

type Row = {
  id:string; member_code:string; name:string; mobile:string; city:string|null;
  is_customer:boolean; customer_id:string|null;
  father_or_husband_name?:string|null; dob?:string|null;
  nominee_name?:string|null; nominee_relation?:string|null;
}

const EMPTY = {
  name:'', mobile:'', email:'', city:'', state:'', address:'', aadhaar:'', pan:'',
  father_or_husband_name:'', dob:'',
  nominee_name:'', nominee_relation:'', nominee_dob:'', nominee_father_name:'',
  nominee_address:'', nominee_pan:'',
}

export default function Members() {
  const [rows, setRows]   = useState<Row[]>([])
  const [show, setShow]   = useState(false)
  const [edit, setEdit]   = useState<Row|null>(null)
  const [form, setForm]   = useState<any>(EMPTY)
  const set = (k:string, v:any) => setForm((p:any) => ({ ...p, [k]: v }))

  const load = async () => {
    const { data, error } = await supabase.from('registry_members').select('*').order('created_at',{ascending:false}).limit(500)
    if (error) toast.error(error.message); else setRows((data||[]) as Row[])
  }
  useEffect(() => { load() }, [])

  const open = (r?: Row) => {
    setEdit(r || null)
    setForm(r ? { ...EMPTY, ...r } : EMPTY)
    setShow(true)
  }

  const save = async () => {
    const payload = { ...form, dob: form.dob || null, nominee_dob: form.nominee_dob || null }
    if (edit) {
      const { error } = await supabase.from('registry_members').update(payload).eq('id', edit.id)
      if (error) return toast.error(error.message)
      toast.success('Member updated')
    } else {
      const code = 'RM' + Date.now().toString().slice(-7)
      const { error } = await supabase.from('registry_members').insert({ ...payload, member_code: code })
      if (error) return toast.error(error.message)
      toast.success('Member created')
    }
    setShow(false); load()
  }

  const convert = async (r: Row) => {
    if (r.is_customer) return
    if (!confirm(`Convert ${r.name} to customer?`)) return
    const code = 'CR' + Date.now().toString().slice(-6)
    // Copy all form fields onto customers row
    const { data: full } = await supabase.from('registry_members').select('*').eq('id', r.id).single()
    const { data, error } = await supabase.from('customers').insert({
      customer_code: code,
      name: full.name, mobile: full.mobile, email: full.email, city: full.city, state: full.state,
      address: full.address, aadhaar: full.aadhaar, pan: full.pan,
      father_or_husband_name: full.father_or_husband_name, dob: full.dob,
      nominee_name: full.nominee_name, nominee_relation: full.nominee_relation,
      nominee_dob: full.nominee_dob, nominee_father_name: full.nominee_father_name,
      nominee_address: full.nominee_address, nominee_pan: full.nominee_pan,
      registry_member_id: r.id,
    }).select('id').single()
    if (error) { toast.error(error.message); return }
    await supabase.from('registry_members').update({ is_customer: true, customer_id: data.id }).eq('id', r.id)
    toast.success('Converted to customer')
    load()
  }

  const Field = ({ k, label, type='text', placeholder='' }: any) => (
    <div>
      <label className="block text-xs font-medium text-gray-600 mb-1">{label}</label>
      <input type={type} placeholder={placeholder} value={form[k]||''} onChange={e => set(k, e.target.value)} className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
    </div>
  )

  const totalRows     = rows.length
  const customerRows  = rows.filter(r => r.is_customer).length
  const memberOnly    = totalRows - customerRows

  return (
    <div className="p-3 md:p-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-semibold">Members &amp; Customers</h1>
          <p className="text-xs text-slate-500 mt-0.5">Registry of prospects + converted buyers. Convert a member to make them eligible for a booking.</p>
        </div>
        <button onClick={() => open()} className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm">+ Add Member</button>
      </div>

      {/* ── Funnel explainer ────────────────────────────────────────── */}
      <div className="bg-gradient-to-r from-blue-50 via-indigo-50 to-emerald-50 border border-indigo-100 rounded-xl p-4">
        <div className="text-[11px] font-semibold text-indigo-700 uppercase tracking-wider mb-2">How the funnel works</div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-2 text-sm">
          <FunnelStep n="1" title="Inquiry"      sub="Walk-in or web lead"          color="bg-amber-100 text-amber-800"/>
          <FunnelStep n="2" title="Member"       sub={`${memberOnly} on registry`}  color="bg-blue-100 text-blue-800"   active/>
          <FunnelStep n="3" title="Customer"     sub={`${customerRows} converted`}  color="bg-emerald-100 text-emerald-800" active/>
          <FunnelStep n="4" title="Booking"      sub="Plot allocated · payments tracked" color="bg-violet-100 text-violet-800"/>
          <FunnelStep n="5" title="Commission"   sub="Earned by broker · MLM upline" color="bg-rose-100 text-rose-800"/>
        </div>
        <div className="text-[11px] text-slate-600 mt-2 leading-relaxed">
          <b>Member</b> = a prospect on the registry (basic + nominee details captured). <b>Customer</b> = a member who has been promoted (via <i>Convert</i>) so they can be attached to a booking. Only Customers appear in the booking customer picker.
        </div>
      </div>

      <div className="bg-white rounded-xl shadow overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left"><tr><th className="p-3">Code</th><th className="p-3">Name</th><th className="p-3">Father / Husband</th><th className="p-3">Mobile</th><th className="p-3">DOB</th><th className="p-3">Nominee</th><th className="p-3">Status</th><th className="p-3">Action</th></tr></thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id} className="border-t">
                <td className="p-3 font-mono text-xs">{r.member_code}</td>
                <td className="p-3 font-medium">{r.name}</td>
                <td className="p-3 text-xs text-gray-600">{r.father_or_husband_name || '—'}</td>
                <td className="p-3 text-xs">{r.mobile}</td>
                <td className="p-3 text-xs">{r.dob || '—'}</td>
                <td className="p-3 text-xs text-gray-600">{r.nominee_name ? `${r.nominee_name} (${r.nominee_relation || '—'})` : '—'}</td>
                <td className="p-3">{r.is_customer ? <span className="text-green-700 text-xs">Customer</span> : <span className="text-slate-500 text-xs">Member</span>}</td>
                <td className="p-3 flex gap-2">
                  <button onClick={() => open(r)} className="text-xs bg-slate-100 px-2 py-1 rounded">Edit</button>
                  {!r.is_customer && <button onClick={() => convert(r)} className="text-xs bg-emerald-600 text-white px-2 py-1 rounded">Convert</button>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* end of table card above; modal below */}
      {show && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-white rounded-xl p-6 w-full max-w-2xl my-8">
            <h2 className="font-semibold text-lg mb-4">{edit ? 'Edit Member' : 'New Registry Member'}</h2>

            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Applicant</div>
            <div className="grid grid-cols-2 gap-3 mb-4">
              <Field k="name"  label="Full Name" />
              <Field k="father_or_husband_name" label="Father / Husband Name" />
              <Field k="dob"   label="Date of Birth" type="date" />
              <Field k="mobile" label="Mobile" />
              <Field k="email" label="Email" />
              <Field k="city"  label="City" />
              <Field k="state" label="State" />
              <Field k="pan"   label="PAN" />
              <Field k="aadhaar" label="Aadhaar" />
              <div className="col-span-2"><Field k="address" label="Permanent Address" /></div>
            </div>

            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2 pt-3 border-t border-gray-100">Nominee (उतराधिकारी)</div>
            <div className="grid grid-cols-2 gap-3">
              <Field k="nominee_name"        label="Nominee Name" />
              <Field k="nominee_relation"    label="Relation" placeholder="Wife / Son / Mother…" />
              <Field k="nominee_dob"         label="Nominee DOB" type="date" />
              <Field k="nominee_father_name" label="Nominee Father / Husband" />
              <Field k="nominee_pan"         label="Nominee PAN" />
              <div className="col-span-2"><Field k="nominee_address" label="Nominee Address" /></div>
            </div>

            <div className="flex justify-end gap-2 pt-5">
              <button onClick={() => setShow(false)} className="px-4 py-2 text-sm">Cancel</button>
              <button onClick={save} className="bg-blue-600 text-white px-4 py-2 rounded text-sm">{edit ? 'Save changes' : 'Create'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function FunnelStep({ n, title, sub, color, active }: any) {
  return (
    <div className={`rounded-lg px-3 py-2 ${active ? color + ' border border-current/20' : 'bg-white border border-slate-200 text-slate-500'}`}>
      <div className="flex items-center gap-1 mb-0.5">
        <span className={`w-4 h-4 rounded-full text-[10px] font-bold flex items-center justify-center ${active ? 'bg-white/60' : 'bg-slate-100'}`}>{n}</span>
        <span className="text-xs font-bold">{title}</span>
      </div>
      <div className="text-[10px] opacity-80">{sub}</div>
    </div>
  )
}
