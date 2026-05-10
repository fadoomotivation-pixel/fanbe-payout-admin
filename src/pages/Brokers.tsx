import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { Table } from '@/components/ui/Table.tsx'
import { Button } from '@/components/ui/Button.tsx'
import { Input, Select } from '@/components/ui/Input.tsx'
import { Modal } from '@/components/ui/Modal.tsx'
import { Badge } from '@/components/ui/Badge.tsx'
import { KYC_COLORS } from '@/lib/utils'
import { Plus, Search, KeyRound, Copy, Check, Eye, UserPlus } from 'lucide-react'
import toast from 'react-hot-toast'

const EMPTY = {
  name:'', email:'', phone:'', referral_code:'', rank:'Executive', status:'active',
  tds_applicable:false, pan_no:'', gst_no:'',
  sponsor_id:'', date_of_joining:'',
  bank_name:'', account_no:'', ifsc:'', account_holder:'', aadhaar_no:'',
}

function nullifyBlanks(obj: any) {
  const out: any = { ...obj }
  for (const k of ['referral_code', 'pan_no', 'gst_no', 'aadhaar_no', 'account_no', 'ifsc']) {
    if (out[k] === '') out[k] = null
  }
  return out
}

function digitsOnly(s: string) { return (s || '').replace(/\D/g, '') }

function syntheticEmailFromPhone(phone: string) {
  const digits = digitsOnly(phone)
  if (!digits) return ''
  return `b${digits}@fanbegroup.com`
}

export default function Brokers() {
  const qc = useQueryClient()

  const { data: brokers = [], isLoading } = useQuery({
    queryKey: ['brokers'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('brokers')
        .select('*, sponsor:sponsor_id(id,name,broker_id,rank)')
        .order('created_at', { ascending: false })
      if (error) throw error; return data
    },
  })

  const { data: ranks = [] } = useQuery({
    queryKey: ['commission_ranks_active'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('commission_ranks')
        .select('rank_name, level, commission_pct, active')
        .eq('active', true)
        .order('level', { ascending: true })
      if (error) throw error; return data
    },
  })

  const create = useMutation({ mutationFn: async (p: any) => { const { data, error } = await supabase.from('brokers').insert(p).select().single(); if (error) throw error; return data }, onError: (e: any) => toast.error(e.message) })
  const update = useMutation({ mutationFn: async ({ id, data }: { id: string; data: any }) => { const { data: d, error } = await supabase.from('brokers').update({ ...data, updated_at: new Date().toISOString() }).eq('id', id).select().single(); if (error) throw error; return d }, onSuccess: () => { qc.invalidateQueries({ queryKey: ['brokers'] }); toast.success('Broker updated') }, onError: (e: any) => toast.error(e.message) })

  const createLogin = useMutation({
    mutationFn: async (params: { broker_id: string; password: string }) => {
      const { data, error } = await supabase.functions.invoke('create-broker-login', { body: params })
      if (error) throw error
      if (data?.error) throw new Error(data.error)
      return data
    },
    onError: (e: any) => toast.error(e.message || 'Failed to create login'),
  })

  const [modal, setModal] = useState(false)
  const [editing, setEditing] = useState<any>(null)
  const [form, setForm] = useState<any>(EMPTY)
  const [q, setQ] = useState('')
  const [sponsorSearch, setSponsorSearch] = useState('')
  const [copiedKey, setCopiedKey] = useState<string|null>(null)
  const [loginResult, setLoginResult] = useState<any>(null)
  // Edit-mode only: admin types a password to reset login. On Add we always use phone digits.
  const [editPassword, setEditPassword] = useState('')
  const [showEditPassword, setShowEditPassword] = useState(false)

  const open = (b?: any) => {
    setEditing(b || null)
    setSponsorSearch('')
    setEditPassword('')
    setShowEditPassword(false)
    setForm(b ? {
      name:b.name, email:b.email||'', phone:b.phone||'', referral_code:b.referral_code||'',
      rank:b.rank||'Executive', status:b.status||'active', tds_applicable:!!b.tds_applicable,
      pan_no:b.pan_no||'', gst_no:b.gst_no||'',
      sponsor_id:b.sponsor_id||'', date_of_joining:b.date_of_joining||'',
      bank_name:b.bank_name||'', account_no:b.account_no||'', ifsc:b.ifsc||'',
      account_holder:b.account_holder||'', aadhaar_no:b.aadhaar_no||'',
    } : EMPTY)
    setModal(true)
  }

  const set = (k: string, v: any) => setForm((p: any) => ({ ...p, [k]: v }))

  const save = async () => {
    let email = form.email?.trim() || ''
    if (!email && form.phone) email = syntheticEmailFromPhone(form.phone)

    const payload = nullifyBlanks({
      ...form,
      email: email || null,
      sponsor_id: form.sponsor_id || null,
      date_of_joining: form.date_of_joining || null,
    })

    if (editing) {
      await update.mutateAsync({ id: editing.id, data: payload })
      setModal(false)
      return
    }

    try {
      const created = await create.mutateAsync(payload)
      qc.invalidateQueries({ queryKey: ['brokers'] })

      // Always use the phone digits as the broker's first password.
      const pwd = digitsOnly(form.phone)
      if (pwd.length >= 6 && payload.email) {
        try {
          const lr = await createLogin.mutateAsync({ broker_id: created.id, password: pwd })
          setLoginResult(lr)
          toast.success('Broker added · login created')
        } catch (e: any) {
          toast.error('Broker created, but login setup failed: ' + e.message)
        }
      } else {
        toast.success('Broker added')
      }
      setModal(false)
    } catch { /* toast handled */ }
  }

  const allBrokers = brokers as any[]
  const filtered = allBrokers.filter((b: any) => `${b.name||''}${b.phone||''}${b.broker_id||''}${b.email||''}`.toLowerCase().includes(q.toLowerCase()))
  const sponsorOptions = allBrokers
    .filter((b: any) => b.id !== editing?.id)
    .filter((b: any) => !sponsorSearch || `${b.name||''}${b.broker_id||''}${b.phone||''}`.toLowerCase().includes(sponsorSearch.toLowerCase()))
    .slice(0, 10)

  const rankList = ranks as any[]
  const rankPctFor = (rankName: string) => rankList.find((r: any) => r.rank_name === rankName)?.commission_pct

  const copy = async (text: string, key: string) => {
    try { await navigator.clipboard.writeText(text); setCopiedKey(key); setTimeout(() => setCopiedKey(null), 1200) } catch { toast.error('Copy failed') }
  }

  const submitLoginOnEdit = async () => {
    if (!editing?.id) return
    const broker = allBrokers.find((b: any) => b.id === editing.id)
    if (!broker?.email) { toast.error('Broker has no email yet — save the form first'); return }
    if (!editPassword || editPassword.length < 6) { toast.error('Password must be at least 6 characters'); return }
    try {
      const lr = await createLogin.mutateAsync({ broker_id: editing.id, password: editPassword })
      qc.invalidateQueries({ queryKey: ['brokers'] })
      setLoginResult(lr)
      setEditPassword('')
    } catch {}
  }

  const cols = [
    { header: 'Broker ID', render: (r: any) => <span className="font-mono text-xs bg-gray-100 px-2 py-0.5 rounded">{r.broker_id}</span> },
    { header: 'Name', render: (r: any) => <span className="font-medium">{r.name}</span> },
    { header: 'Phone', key: 'phone' },
    { header: 'Rank', render: (r: any) => {
      const pct = rankPctFor(r.rank)
      return <div><span className="text-sm">{r.rank || '—'}</span>{pct != null && <div className="text-[10px] text-gray-400">{pct}% commission</div>}</div>
    }},
    { header: 'Sponsor', render: (r: any) => r.sponsor?.name ? <span className="text-xs text-gray-600">{r.sponsor.name} <span className="text-gray-400">[{r.sponsor.broker_id}]</span></span> : <span className="text-xs text-gray-400">—</span> },
    { header: 'KYC', render: (r: any) => <Badge label={r.kyc_status || 'pending'} className={KYC_COLORS[r.kyc_status] || 'bg-gray-100 text-gray-600'} /> },
    { header: 'Login', render: (r: any) => r.auth_user_id
        ? <span className="text-xs text-green-700 inline-flex items-center gap-1"><KeyRound size={11}/>linked</span>
        : <span className="text-xs text-gray-400">not linked</span> },
    { header: 'Status', render: (r: any) => <Badge label={r.status} className={r.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'} /> },
    {
      header: '',
      render: (r: any) => (
        <div className="flex gap-1">
          <Button size="sm" variant="ghost" onClick={() => open(r)}>Edit</Button>
          <Link to={`/broker/dashboard?broker_id=${r.id}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded bg-gray-100 hover:bg-gray-200 text-gray-700" title="Open broker portal as this broker (read-only shadow mode)">
            <Eye size={12}/>View as
          </Link>
        </div>
      ),
    },
  ]

  const effectiveEmail = form.email?.trim() || syntheticEmailFromPhone(form.phone)
  const phoneDigits = digitsOnly(form.phone)

  // Login section now reads-only on Add (always uses phone-as-password).
  // On Edit, admin can reset password explicitly.
  const loginSection = () => {
    // Already linked
    if (editing?.auth_user_id) {
      return (
        <div className="mt-2 p-3 bg-emerald-50 rounded-lg text-sm text-emerald-900 flex items-center gap-2">
          ✓ Login already created. Broker signs in at <code className="bg-white px-1 py-0.5 rounded font-mono text-xs">/broker/login</code> with email <b>{editing.email}</b>.
          <button onClick={() => copy(`${window.location.origin}/broker/login`, 'login-url')} className="ml-auto inline-flex items-center gap-1 text-emerald-700 hover:underline text-xs">
            {copiedKey === 'login-url' ? <Check size={11}/> : <Copy size={11}/>}
            {copiedKey === 'login-url' ? 'Copied' : 'Copy login URL'}
          </button>
        </div>
      )
    }
    // Editing existing broker without login: allow admin to set a password explicitly
    if (editing) {
      return (
        <div className="mt-2 p-3 bg-blue-50 border border-blue-200 rounded-lg space-y-2">
          <div className="text-xs text-blue-900">Set a password the broker will use to sign in. Email: <b>{editing.email || effectiveEmail}</b></div>
          <div className="flex gap-2">
            <div className="flex-1 relative">
              <input
                type={showEditPassword ? 'text' : 'password'}
                value={editPassword}
                onChange={e => setEditPassword(e.target.value)}
                placeholder="Password (min 6 characters)"
                className="w-full rounded-lg border border-gray-200 px-3 py-2 pr-16 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              />
              <button type="button" onClick={() => setShowEditPassword(s => !s)} className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-500 hover:text-gray-700">
                {showEditPassword ? 'Hide' : 'Show'}
              </button>
            </div>
            <Button size="sm" onClick={submitLoginOnEdit} loading={createLogin.isPending} disabled={!editing.email || editPassword.length < 6}>
              <UserPlus size={13}/>Create Login
            </Button>
          </div>
        </div>
      )
    }
    // Add mode: password = phone (always). Show as read-only preview.
    return (
      <div className="mt-2 p-3 bg-blue-50 border border-blue-200 rounded-lg space-y-1.5">
        <div className="text-xs text-blue-900">
          The broker will sign in at <b>/broker/login</b> with:
        </div>
        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="bg-white rounded px-2 py-1.5"><span className="text-gray-500">Email</span><div className="font-mono">{effectiveEmail || '(fill phone above)'}</div></div>
          <div className="bg-white rounded px-2 py-1.5"><span className="text-gray-500">Password</span><div className="font-mono">{phoneDigits || '(fill phone above)'}</div></div>
        </div>
        <div className="text-[10px] text-blue-700">Password = the broker's phone digits. Broker can change it after first login.</div>
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div><h1 className="text-xl font-bold text-gray-900">Brokers</h1><p className="text-sm text-gray-500">{allBrokers.length} brokers registered · ranks driven by Commission Ranks ({rankList.length})</p></div>
        <Button onClick={() => open()}><Plus size={14} />Add Broker</Button>
      </div>
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm">
        <div className="p-4 border-b border-gray-100 flex gap-3">
          <div className="relative flex-1 max-w-xs"><Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" /><input value={q} onChange={e => setQ(e.target.value)} placeholder="Search brokers…" className="w-full pl-8 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" /></div>
        </div>
        <Table columns={cols} data={filtered} loading={isLoading} />
      </div>

      <Modal open={modal} onClose={() => setModal(false)} title={editing ? `Edit Broker — ${editing.broker_id || ''}` : 'Add Broker'}>
        <div className="grid grid-cols-2 gap-4">
          <Input label="Full Name" value={form.name} onChange={(e: any) => set('name', e.target.value)} required />
          <Input label="Phone" value={form.phone} onChange={(e: any) => set('phone', e.target.value)} required placeholder="10-digit mobile (used for login by default)" />
          <Input label="Email (optional)" value={form.email} onChange={(e: any) => set('email', e.target.value)} placeholder={form.phone ? `Auto: ${syntheticEmailFromPhone(form.phone)}` : 'leave blank to auto-generate from phone'} />
          <Input label="Referral Code (optional)" value={form.referral_code} onChange={(e: any) => set('referral_code', e.target.value)} placeholder="leave blank if not used"/>

          <Select label="Rank (from Commission Ranks)" value={form.rank} onChange={(e: any) => set('rank', e.target.value)}>
            {rankList.length === 0 && <option value="">— no ranks defined yet —</option>}
            {rankList.map((r: any) => (
              <option key={r.rank_name} value={r.rank_name}>L{r.level} — {r.rank_name} ({r.commission_pct}%)</option>
            ))}
          </Select>
          <Select label="Status" value={form.status} onChange={(e: any) => set('status', e.target.value)}>
            <option value="active">Active</option><option value="inactive">Inactive</option><option value="suspended">Suspended</option>
          </Select>

          <div className="col-span-2 mt-2 pt-3 border-t border-gray-100">
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Sponsor / Upline (drives differential payouts)</label>
            <p className="text-xs text-gray-400 mt-0.5">Search by name, broker ID or phone. Leave empty for top-of-tree brokers.</p>
          </div>
          <div className="col-span-2">
            <input value={sponsorSearch} onChange={e => setSponsorSearch(e.target.value)} placeholder="Search sponsor by name / ID / phone…" className="w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white mb-2" />
            <Select label="" value={form.sponsor_id} onChange={(e: any) => set('sponsor_id', e.target.value)}>
              <option value="">— No sponsor (top of tree) —</option>
              {sponsorOptions.map((b: any) => (
                <option key={b.id} value={b.id}>{b.name} [{b.broker_id}] · {b.rank} · {b.phone}</option>
              ))}
            </Select>
            {form.sponsor_id && (() => {
              const s = allBrokers.find((b: any) => b.id === form.sponsor_id)
              return s ? (
                <div className="mt-2 p-2 bg-indigo-50 rounded text-xs text-indigo-700">
                  ↑ Upline: <b>{s.name}</b> [{s.broker_id}] — Rank: <b>{s.rank}</b>
                </div>
              ) : null
            })()}
          </div>

          <Input label="Date of Joining" type="date" value={form.date_of_joining} onChange={(e: any) => set('date_of_joining', e.target.value)} />
          <Input label="Aadhaar No" value={form.aadhaar_no} onChange={(e: any) => set('aadhaar_no', e.target.value)} placeholder="XXXX-XXXX-XXXX" />
          <Input label="PAN No" value={form.pan_no} onChange={(e: any) => set('pan_no', e.target.value.toUpperCase())} />
          <Input label="GST No" value={form.gst_no} onChange={(e: any) => set('gst_no', e.target.value)} />

          <div className="col-span-2 mt-2 pt-3 border-t border-gray-100">
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Bank account (for withdrawals)</label>
          </div>
          <Input label="Account Holder" value={form.account_holder} onChange={(e: any) => set('account_holder', e.target.value)} />
          <Input label="Bank Name" value={form.bank_name} onChange={(e: any) => set('bank_name', e.target.value)} />
          <Input label="Account No" value={form.account_no} onChange={(e: any) => set('account_no', e.target.value)} />
          <Input label="IFSC" value={form.ifsc} onChange={(e: any) => set('ifsc', e.target.value.toUpperCase())} />

          <div className="col-span-2 mt-2 pt-3 border-t border-gray-100">
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide flex items-center gap-1"><KeyRound size={12}/> Broker portal login</label>
            {loginSection()}
          </div>

          <div className="col-span-2 flex items-center gap-2 mt-2">
            <input type="checkbox" id="tds" checked={form.tds_applicable} onChange={e => set('tds_applicable', e.target.checked)} className="rounded" />
            <label htmlFor="tds" className="text-sm text-gray-700">TDS Applicable</label>
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-6">
          <Button variant="secondary" onClick={() => setModal(false)}>Cancel</Button>
          <Button onClick={save} loading={create.isPending || update.isPending || createLogin.isPending}>{editing ? 'Save' : (form.phone ? 'Save Broker + Create Login' : 'Save Broker')}</Button>
        </div>
      </Modal>

      <Modal open={!!loginResult} onClose={() => setLoginResult(null)} title="Broker login created">
        {loginResult && (
          <div className="space-y-3">
            <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-900">
              Share these credentials with the broker. They sign in at <b>/broker/login</b>.
            </div>
            <div className="space-y-2">
              <Field label="Email"        value={loginResult.email}    copyKey="email"    copiedKey={copiedKey} onCopy={copy}/>
              {loginResult.password ? (
                <Field label="Password"   value={loginResult.password} copyKey="password" copiedKey={copiedKey} onCopy={copy}/>
              ) : (
                <div className="text-xs text-gray-500">User already existed in auth — linked to broker. Password unchanged.</div>
              )}
              <Field label="Login URL"    value={`${window.location.origin}/broker/login`} copyKey="url" copiedKey={copiedKey} onCopy={copy}/>
            </div>
            <div className="flex justify-end pt-2">
              <Button onClick={() => setLoginResult(null)}>Done</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}

function Field({ label, value, copyKey, copiedKey, onCopy }: any) {
  return (
    <div className="flex items-center gap-2 p-2 bg-gray-50 rounded-lg">
      <div className="text-xs text-gray-500 w-20 shrink-0">{label}</div>
      <div className="flex-1 font-mono text-sm break-all">{value}</div>
      <button onClick={() => onCopy(value, copyKey)} className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded bg-white border border-gray-200 hover:bg-gray-100">
        {copiedKey === copyKey ? <Check size={11}/> : <Copy size={11}/>}
        {copiedKey === copyKey ? 'Copied' : 'Copy'}
      </button>
    </div>
  )
}
