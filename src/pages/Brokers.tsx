import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { Table } from '@/components/ui/Table.tsx'
import { Button } from '@/components/ui/Button.tsx'
import { Input, Select } from '@/components/ui/Input.tsx'
import { Modal } from '@/components/ui/Modal.tsx'
import { Badge } from '@/components/ui/Badge.tsx'
import { KYC_COLORS, formatINR } from '@/lib/utils'
import { Plus, Search, KeyRound, Copy, Check, Eye, UserPlus, X } from 'lucide-react'
import toast from 'react-hot-toast'

const EMPTY = {
  name:'', email:'', phone:'', referral_code:'', rank:'Executive', status:'active',
  // broker_type splits the directory in two buckets so admin can't accidentally credit
  // a tree-broker on a traditional sale (or vice versa).
  // - 'mlm'         : sits in the sponsor tree, earns via the differential cascade
  // - 'traditional' : standalone broker used only for non-MLM sales
  broker_type:'mlm',
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
  return `b${digits}@example.com`
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

  const { data: earningsByBroker = {} } = useQuery({
    queryKey: ['broker_earnings'],
    queryFn: async () => {
      // EARNED = actually-distributed MLM commission (direct + upline differential), per payout_distributions.
      // This is the single source of truth used across the app — NOT bookings.commission_amount (which is only
      // the promised direct commission and ignores both collection progress and upline income).
      const [{ data: dist }, { data: promised }] = await Promise.all([
        supabase.from('payout_distributions').select('beneficiary_broker_id, net_payout, created_at'),
        supabase.from('bp_bookings').select('broker_id, commission_amount, stage').eq('stage', 'booking_done'),
      ])
      const out: Record<string, { total: number; ytd: number; count: number; promised: number }> = {}
      const year = new Date().getFullYear()
      for (const d of dist || []) {
        const k = (d as any).beneficiary_broker_id; if (!k) continue
        const o = out[k] ??= { total: 0, ytd: 0, count: 0, promised: 0 }
        const n = Number((d as any).net_payout || 0)
        o.total += n
        if ((d as any).created_at && new Date((d as any).created_at).getFullYear() === year) o.ytd += n
      }
      for (const b of promised || []) {
        const k = (b as any).broker_id; if (!k) continue
        const o = out[k] ??= { total: 0, ytd: 0, count: 0, promised: 0 }
        o.promised += Number((b as any).commission_amount || 0)
        o.count += 1
      }
      return out
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

  // Reset password on an existing broker login.  Calls the reset-broker-password edge
  // function (deployed alongside create-broker-login) which uses the service role to call
  // auth.admin.updateUserById.  Supabase stores passwords as bcrypt hashes, so this is
  // the only way for admin to give a broker who lost their password a way back in —
  // there is no path to "see" the existing password.
  const resetPassword = useMutation({
    mutationFn: async (params: { broker_id: string; password?: string }) => {
      const { data, error } = await supabase.functions.invoke('reset-broker-password', { body: params })
      if (error) throw error
      if (data?.error) throw new Error(data.error)
      return data
    },
    onError: (e: any) => toast.error(e.message || 'Failed to reset password'),
  })

  const [modal, setModal] = useState(false)
  const [editing, setEditing] = useState<any>(null)
  const [form, setForm] = useState<any>(EMPTY)
  const [q, setQ] = useState('')
  // '' = all brokers, 'mlm' = only tree brokers, 'traditional' = only standalone brokers
  const [typeFilter, setTypeFilter] = useState<'' | 'mlm' | 'traditional'>('')
  const [copiedKey, setCopiedKey] = useState<string|null>(null)
  const [loginResult, setLoginResult] = useState<any>(null)
  const [editPassword, setEditPassword] = useState('')
  const [showEditPassword, setShowEditPassword] = useState(false)

  const open = (b?: any) => {
    setEditing(b || null)
    setEditPassword('')
    setShowEditPassword(false)
    setForm(b ? {
      name:b.name, email:b.email||'', phone:b.phone||'', referral_code:b.referral_code||'',
      rank:b.rank||'Executive', status:b.status||'active', tds_applicable:!!b.tds_applicable,
      broker_type: b.broker_type || 'mlm',
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
  const filtered = allBrokers.filter((b: any) => {
    if (typeFilter && (b.broker_type || 'mlm') !== typeFilter) return false
    return `${b.name||''}${b.phone||''}${b.broker_id||''}${b.email||''}`.toLowerCase().includes(q.toLowerCase())
  })
  const mlmCount         = allBrokers.filter((b: any) => (b.broker_type || 'mlm') === 'mlm').length
  const traditionalCount = allBrokers.filter((b: any) => b.broker_type === 'traditional').length

  const rankList = ranks as any[]
  const rankPctFor = (rankName: string) => rankList.find((r: any) => r.rank_name === rankName)?.commission_pct
  const earnings: any = earningsByBroker

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

  // Reset password for an existing broker.  Uses editPassword if admin typed one (>= 6
  // chars), otherwise lets the edge function generate a random one and returns it.
  const submitPasswordReset = async (mode: 'custom' | 'random') => {
    if (!editing?.id || !editing.auth_user_id) return
    if (mode === 'custom' && (!editPassword || editPassword.length < 6)) {
      toast.error('Password must be at least 6 characters'); return
    }
    try {
      const lr = await resetPassword.mutateAsync({
        broker_id: editing.id,
        password: mode === 'custom' ? editPassword : undefined,
      })
      setLoginResult(lr)
      setEditPassword('')
      toast.success('Password reset · share the new password below')
    } catch {}
  }

  const cols = [
    { header: 'Broker ID', render: (r: any) => <span className="font-mono text-xs bg-gray-100 px-2 py-0.5 rounded">{r.broker_id}</span> },
    { header: 'Name', render: (r: any) => <Link to={`/brokers/${r.id}`} className="font-medium text-blue-700 hover:underline">{r.name}</Link> },
    { header: 'Phone', key: 'phone' },
    { header: 'Type', render: (r: any) => {
      const t = r.broker_type || 'mlm'
      // Bold pill so admin can scan the directory and spot which brokers are MLM
      // (sponsor-tree, differential cascade) vs traditional (standalone, no cascade).
      return t === 'traditional'
        ? <Badge label="Traditional" className="bg-amber-100 text-amber-800 border border-amber-200"/>
        : <Badge label="MLM" className="bg-blue-100 text-blue-800 border border-blue-200"/>
    }},
    { header: 'Rank', render: (r: any) => {
      const pct = rankPctFor(r.rank)
      return <div><span className="text-sm">{r.rank || '—'}</span>{pct != null && <div className="text-[10px] text-gray-400">{pct}% commission</div>}</div>
    }},
    { header: 'Earned (distributed)', render: (r: any) => {
      const e = earnings[r.id]
      if (!e || (e.total === 0 && e.promised === 0)) return <span className="text-xs text-gray-300">—</span>
      const pending = Math.max(0, (e.promised || 0) - (e.total || 0))
      return (
        <div>
          <div className="font-semibold text-green-700 text-sm">{formatINR(e.total)}</div>
          <div className="text-[10px] text-gray-400">
            {e.ytd ? `YTD ${formatINR(e.ytd)} · ` : ''}{e.count} bk
            {pending > 0 ? ` · +${formatINR(pending)} promised` : ''}
          </div>
        </div>
      )
    }},
    { header: 'Sponsor', render: (r: any) => r.sponsor?.name ? <span className="text-xs text-gray-600">{r.sponsor.name} <span className="text-gray-400">[{r.sponsor.broker_id}]</span></span> : <span className="text-xs text-gray-400">—</span> },
    { header: 'KYC', render: (r: any) => <Badge label={r.kyc_status || 'pending'} className={KYC_COLORS[r.kyc_status] || 'bg-gray-100 text-gray-600'} /> },
    { header: 'Login', render: (r: any) => r.auth_user_id
        ? (
          <div className="leading-tight">
            <div className="text-xs text-green-700 inline-flex items-center gap-1"><KeyRound size={11}/>linked</div>
            <div className="text-[10px] text-gray-500 font-mono truncate max-w-[160px]" title={r.email || ''}>{r.email || '—'}</div>
          </div>
        )
        : <span className="text-xs text-gray-400">not linked</span> },
    { header: 'Status', render: (r: any) => <Badge label={r.status} className={r.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'} /> },
    {
      header: '',
      render: (r: any) => (
        <div className="flex gap-1">
          <Link to={`/brokers/${r.id}`} className="text-xs px-2 py-1 rounded bg-blue-50 hover:bg-blue-100 text-blue-700">Profile</Link>
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

  const loginSection = () => {
    if (editing?.auth_user_id) {
      return (
        <div className="mt-2 space-y-2">
          {/* Existing login summary — email is the login identifier; password is stored as a
              bcrypt hash by Supabase Auth so admin can't see it, only reset it. */}
          <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-sm">
            <div className="flex items-center gap-2 text-emerald-900">
              <KeyRound size={14}/>Login linked
            </div>
            <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
              <div className="bg-white rounded px-2.5 py-1.5 border border-emerald-100">
                <div className="text-[10px] uppercase tracking-wide text-gray-500">Login email</div>
                <div className="flex items-center gap-1 mt-0.5">
                  <span className="font-mono text-gray-900 truncate">{editing.email || '—'}</span>
                  {editing.email && (
                    <button onClick={() => copy(editing.email, 'login-email')} className="text-gray-400 hover:text-gray-700" title="Copy email">
                      {copiedKey === 'login-email' ? <Check size={11}/> : <Copy size={11}/>}
                    </button>
                  )}
                </div>
              </div>
              <div className="bg-white rounded px-2.5 py-1.5 border border-emerald-100">
                <div className="text-[10px] uppercase tracking-wide text-gray-500">Sign-in URL</div>
                <div className="flex items-center gap-1 mt-0.5">
                  <span className="font-mono text-gray-900 truncate text-[11px]">{`${window.location.origin}/broker/login`}</span>
                  <button onClick={() => copy(`${window.location.origin}/broker/login`, 'login-url')} className="text-gray-400 hover:text-gray-700" title="Copy URL">
                    {copiedKey === 'login-url' ? <Check size={11}/> : <Copy size={11}/>}
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Password reset — admin can either type a new password or have one generated. */}
          <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
            <div className="flex items-center gap-2 text-amber-900 mb-2">
              <KeyRound size={13}/><b className="text-xs">Reset password</b>
              <span className="text-[10px] text-amber-700 ml-auto">Stored as bcrypt hash — the existing password can't be retrieved, only replaced.</span>
            </div>
            <div className="flex gap-2 flex-wrap">
              <div className="flex-1 min-w-[200px] relative">
                <input
                  type={showEditPassword ? 'text' : 'password'}
                  value={editPassword}
                  onChange={e => setEditPassword(e.target.value)}
                  placeholder="New password (min 6 chars), or click Generate"
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 pr-16 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 bg-white"
                />
                <button type="button" onClick={() => setShowEditPassword(s => !s)} className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-500 hover:text-gray-700">
                  {showEditPassword ? 'Hide' : 'Show'}
                </button>
              </div>
              <Button size="sm" onClick={() => submitPasswordReset('custom')} loading={resetPassword.isPending} disabled={editPassword.length < 6}>
                Set password
              </Button>
              <Button size="sm" variant="secondary" onClick={() => submitPasswordReset('random')} loading={resetPassword.isPending}>
                Generate
              </Button>
            </div>
          </div>
        </div>
      )
    }
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
    return (
      <div className="mt-2 p-3 bg-blue-50 border border-blue-200 rounded-lg space-y-1.5">
        <div className="text-xs text-blue-900">The broker will sign in at <b>/broker/login</b> with:</div>
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
        <div><h1 className="text-xl font-bold text-gray-900">Brokers</h1><p className="text-sm text-gray-500">{allBrokers.length} brokers · click a name for the full earnings profile</p></div>
        <Button onClick={() => open()}><Plus size={14} />Add Broker</Button>
      </div>
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm">
        <div className="p-4 border-b border-gray-100 flex gap-3 items-center flex-wrap">
          <div className="relative w-full md:flex-1 md:max-w-xs"><Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" /><input value={q} onChange={e => setQ(e.target.value)} placeholder="Search brokers…" className="w-full pl-8 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" /></div>
          {/* Type chips so admin can scope the list to MLM brokers vs traditional brokers
              without scrolling.  Counts are computed off the unfiltered list. */}
          <div className="inline-flex rounded-lg border border-gray-200 overflow-hidden text-xs">
            <button
              onClick={() => setTypeFilter('')}
              className={`px-3 py-1.5 ${typeFilter === '' ? 'bg-gray-900 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'}`}
            >All ({allBrokers.length})</button>
            <button
              onClick={() => setTypeFilter('mlm')}
              className={`px-3 py-1.5 border-l border-gray-200 ${typeFilter === 'mlm' ? 'bg-blue-600 text-white' : 'bg-white text-blue-700 hover:bg-blue-50'}`}
            >MLM ({mlmCount})</button>
            <button
              onClick={() => setTypeFilter('traditional')}
              className={`px-3 py-1.5 border-l border-gray-200 ${typeFilter === 'traditional' ? 'bg-amber-600 text-white' : 'bg-white text-amber-700 hover:bg-amber-50'}`}
            >Traditional ({traditionalCount})</button>
          </div>
        </div>
        {/* Desktop: the dense table.  Mobile: the same data in stacked cards because
            horizontally-scrolling 10 columns on a 360px screen was painful (admin's
            screenshot showed exactly this).  Both views read from the same `filtered`
            array and use the same actions, so behaviour is identical. */}
        <div className="hidden md:block">
          <Table columns={cols} data={filtered} loading={isLoading} />
        </div>
        <div className="md:hidden p-2 space-y-2">
          {isLoading && <div className="py-12 text-center text-sm text-gray-400">Loading brokers…</div>}
          {!isLoading && filtered.length === 0 && (
            <div className="py-12 text-center text-sm text-gray-400">No brokers match the filter.</div>
          )}
          {filtered.map((r: any) => {
            const e = earnings[r.id]
            const pct = rankPctFor(r.rank)
            const t = r.broker_type || 'mlm'
            return (
              <div key={r.id} className="bg-white border border-gray-200 rounded-xl p-3 shadow-sm">
                <div className="flex items-start gap-3">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold shrink-0 ${t === 'traditional' ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'}`}>
                    {(r.name || '?').charAt(0).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <Link to={`/brokers/${r.id}`} className="font-semibold text-blue-700 hover:underline truncate block">{r.name || '—'}</Link>
                    <div className="text-[11px] text-gray-500 font-mono">{r.broker_id || '—'}</div>
                  </div>
                  <Badge
                    label={t === 'traditional' ? 'Traditional' : 'MLM'}
                    className={t === 'traditional'
                      ? 'bg-amber-100 text-amber-800 border border-amber-200 shrink-0'
                      : 'bg-blue-100 text-blue-800 border border-blue-200 shrink-0'}
                  />
                </div>

                <div className="mt-2.5 flex flex-wrap gap-1.5 text-[11px]">
                  {r.phone && <span className="bg-gray-50 border border-gray-100 rounded-full px-2 py-0.5 text-gray-700">📞 {r.phone}</span>}
                  {r.rank && <span className="bg-gray-50 border border-gray-100 rounded-full px-2 py-0.5 text-gray-700">{r.rank}{pct != null ? ` · ${pct}%` : ''}</span>}
                  <Badge label={r.kyc_status || 'pending'} className={`${KYC_COLORS[r.kyc_status] || 'bg-gray-100 text-gray-600'} text-[10px]`}/>
                  <Badge label={r.status} className={`${r.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'} text-[10px]`}/>
                  {r.auth_user_id && (
                    <span className="bg-emerald-50 border border-emerald-100 rounded-full px-2 py-0.5 text-emerald-700 inline-flex items-center gap-1">
                      <KeyRound size={10}/>linked
                    </span>
                  )}
                </div>

                {(e && (e.total > 0 || e.promised > 0)) || r.sponsor?.name ? (
                  <div className="mt-2 flex items-center justify-between gap-3 pt-2 border-t border-gray-100 text-xs">
                    <div className="min-w-0">
                      {r.sponsor?.name && (
                        <div className="text-gray-500 truncate">
                          Sponsor: <span className="text-gray-700">{r.sponsor.name}</span>
                        </div>
                      )}
                    </div>
                    {e && (e.total > 0 || e.promised > 0) && (
                      <div className="text-right shrink-0">
                        <div className="font-semibold text-green-700">{formatINR(e.total || 0)}</div>
                        <div className="text-[10px] text-gray-400">
                          {e.ytd ? `YTD ${formatINR(e.ytd)} · ` : ''}{e.count} bk
                        </div>
                      </div>
                    )}
                  </div>
                ) : null}

                <div className="mt-2.5 flex gap-1.5">
                  <Link to={`/brokers/${r.id}`} className="flex-1 text-center text-xs py-1.5 rounded-lg bg-blue-50 hover:bg-blue-100 text-blue-700 font-medium">Profile</Link>
                  <button onClick={() => open(r)} className="flex-1 text-center text-xs py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium">Edit</button>
                  <Link to={`/broker/dashboard?broker_id=${r.id}`} target="_blank" rel="noopener noreferrer" className="flex-1 text-center text-xs py-1.5 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium inline-flex items-center justify-center gap-1" title="Open broker portal as this broker (read-only shadow mode)">
                    <Eye size={11}/>View as
                  </Link>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <Modal open={modal} onClose={() => setModal(false)} title={editing ? `Edit Broker — ${editing.broker_id || ''}` : 'Add Broker'}>
        {/* Broker-type toggle promoted to the TOP of the modal so admin sees it before
            filling out any fields.  Was buried below rank earlier -- admin reported there
            was "no way to add traditional broker" because the select wasn't obvious. */}
        <div className="mb-4 rounded-xl border-2 border-gray-200 overflow-hidden">
          <div className="flex">
            <button
              type="button"
              onClick={() => setForm((p: any) => ({ ...p, broker_type: 'mlm', sponsor_id: (allBrokers.find((b: any) => b.id === p.sponsor_id && (b.broker_type || 'mlm') === 'mlm') ? p.sponsor_id : '') }))}
              className={`flex-1 px-3 py-2.5 text-sm font-semibold transition ${(form.broker_type || 'mlm') === 'mlm' ? 'bg-blue-600 text-white' : 'bg-white text-blue-700 hover:bg-blue-50'}`}
            >
              MLM broker
              <div className="text-[10px] font-normal opacity-80 mt-0.5">Sits in sponsor tree · differential cascade</div>
            </button>
            <button
              type="button"
              onClick={() => setForm((p: any) => ({ ...p, broker_type: 'traditional', sponsor_id: (allBrokers.find((b: any) => b.id === p.sponsor_id && b.broker_type === 'traditional') ? p.sponsor_id : '') }))}
              className={`flex-1 px-3 py-2.5 text-sm font-semibold transition border-l-2 border-gray-200 ${form.broker_type === 'traditional' ? 'bg-amber-600 text-white' : 'bg-white text-amber-700 hover:bg-amber-50'}`}
            >
              Traditional broker
              <div className="text-[10px] font-normal opacity-80 mt-0.5">Standalone · no sponsor cascade</div>
            </button>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-4">
          <Input label="Full Name" value={form.name} onChange={(e: any) => set('name', e.target.value)} required />
          <Input label="Phone" value={form.phone} onChange={(e: any) => set('phone', e.target.value)} required placeholder="10-digit mobile (used as login + password)" />
          <Input label="Email (optional)" value={form.email} onChange={(e: any) => set('email', e.target.value)} placeholder={form.phone ? `Auto: ${syntheticEmailFromPhone(form.phone)}` : 'leave blank to auto-generate from phone'} />
          <Input label="Referral Code (optional)" value={form.referral_code} onChange={(e: any) => set('referral_code', e.target.value)} placeholder="leave blank if not used"/>

          {/* Rank is irrelevant for traditional brokers (they don't use the rank ladder),
              but it's still required by the DB.  Default to Executive (lowest) and hide
              the picker entirely when broker_type is traditional. */}
          {form.broker_type !== 'traditional' && (
          <Select label="Rank (from Commission Ranks)" value={form.rank} onChange={(e: any) => set('rank', e.target.value)}>
            {rankList.length === 0 && <option value="">— no ranks defined yet —</option>}
            {rankList.map((r: any) => (
              <option key={r.rank_name} value={r.rank_name}>L{r.level} — {r.rank_name} ({r.commission_pct}%)</option>
            ))}
          </Select>
          )}
          <Select label="Status" value={form.status} onChange={(e: any) => set('status', e.target.value)}>
            <option value="active">Active</option><option value="inactive">Inactive</option><option value="suspended">Suspended</option>
          </Select>

          <div className="col-span-2 mt-2 pt-3 border-t border-gray-100">
            <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Sponsor / Upline (drives differential payouts)</label>
            <p className="text-xs text-gray-400 mt-0.5 mb-2">Type a name, broker ID or phone to filter. Pick a result from the list, or leave blank for top-of-tree brokers.</p>
            {/* MLM and Traditional trees are strictly separate -- only let admin pick
                a sponsor of the same broker_type as the broker being edited.  The DB
                trigger enforce_same_type_sponsor would refuse a cross-type save anyway,
                but filtering up front avoids confusing "sponsor must match" errors. */}
            <SponsorPicker
              brokers={allBrokers.filter((b: any) => (b.broker_type || 'mlm') === (form.broker_type || 'mlm'))}
              value={form.sponsor_id}
              excludeId={editing?.id}
              onChange={(id) => set('sponsor_id', id)}
            />
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

      <Modal open={!!loginResult} onClose={() => setLoginResult(null)} title={loginResult?.message?.toLowerCase().includes('reset') ? 'Password reset · share new credentials' : 'Broker login created'}>
        {loginResult && (
          <div className="space-y-3">
            <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg text-xs text-emerald-900">
              Share these with the broker.  They sign in at <b>/broker/login</b> with their phone number + password.
              {loginResult.message?.toLowerCase().includes('reset') && ' This password is shown once — copy it now.'}
            </div>
            <div className="space-y-2">
              {/* Phone is the broker-facing primary credential now.  Read it off the row
                  being edited; the create-login response doesn't carry it explicitly. */}
              {editing?.phone && (
                <Field label="Phone"      value={editing.phone}        copyKey="phone"    copiedKey={copiedKey} onCopy={copy}/>
              )}
              {loginResult.password ? (
                <Field label="Password"   value={loginResult.password} copyKey="password" copiedKey={copiedKey} onCopy={copy}/>
              ) : (
                <div className="text-xs text-gray-500">User already existed in auth — linked to broker. Password unchanged.</div>
              )}
              <Field label="Login URL"    value={`${window.location.origin}/broker/login`} copyKey="url" copiedKey={copiedKey} onCopy={copy}/>
              {/* Email is now a fallback / power-user option.  Auto-promoted brokers have
                  synthetic emails the broker can't easily type, so it stays collapsed under
                  a disclosure. */}
              <details className="text-xs">
                <summary className="text-gray-500 cursor-pointer hover:text-gray-700">Show internal email (fallback)</summary>
                <div className="mt-2"><Field label="Email" value={loginResult.email} copyKey="email" copiedKey={copiedKey} onCopy={copy}/></div>
              </details>
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

// Combobox-style sponsor picker. Single input → live filtered dropdown → click to pick.
// Selected sponsor is shown as a chip with a Change button.
function SponsorPicker({ brokers, value, excludeId, onChange }: { brokers: any[]; value: string; excludeId?: string; onChange: (id: string) => void }) {
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(false)
  const selected = brokers.find((b: any) => b.id === value)

  const filtered = brokers
    .filter((b: any) => b.id !== excludeId)
    .filter((b: any) => !q || `${b.name || ''} ${b.broker_id || ''} ${b.phone || ''} ${b.rank || ''}`.toLowerCase().includes(q.toLowerCase()))
    .slice(0, 30)

  if (selected) {
    return (
      <div className="flex items-center gap-2 p-2.5 rounded-lg border border-indigo-200 bg-indigo-50">
        <div className="w-9 h-9 rounded-full bg-indigo-200 text-indigo-800 flex items-center justify-center font-bold text-sm">
          {(selected.name || '?')[0].toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-sm text-gray-900 truncate">{selected.name}</div>
          <div className="text-xs text-gray-500 truncate">[{selected.broker_id}] · {selected.rank || '—'} · {selected.phone || '—'}</div>
        </div>
        <button
          type="button"
          onClick={() => { onChange(''); setQ(''); setOpen(true) }}
          className="text-xs px-2 py-1 rounded text-indigo-700 hover:bg-indigo-100"
        >
          Change
        </button>
        <button
          type="button"
          onClick={() => onChange('')}
          className="text-gray-400 hover:text-red-600 p-1 rounded hover:bg-red-50"
          title="Remove sponsor"
        >
          <X size={14}/>
        </button>
      </div>
    )
  }

  return (
    <div className="relative">
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"/>
        <input
          type="text"
          value={q}
          onChange={e => { setQ(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          placeholder="Search by name, broker ID or phone…"
          className="w-full rounded-lg border border-gray-200 pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
        />
      </div>
      {open && (
        <div className="absolute z-50 left-0 right-0 mt-1 max-h-72 overflow-y-auto bg-white border border-gray-200 rounded-lg shadow-lg">
          <button
            type="button"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => { onChange(''); setOpen(false); setQ('') }}
            className="w-full text-left px-3 py-2 text-xs text-gray-500 hover:bg-gray-50 border-b border-gray-100"
          >
            — No sponsor (top of tree) —
          </button>
          {filtered.length === 0 ? (
            <div className="px-3 py-4 text-center text-xs text-gray-400">No matches.</div>
          ) : filtered.map((b: any) => (
            <button
              key={b.id}
              type="button"
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => { onChange(b.id); setOpen(false); setQ('') }}
              className="w-full text-left px-3 py-2 hover:bg-blue-50 flex items-center gap-2 border-b border-gray-50 last:border-b-0"
            >
              <div className="w-7 h-7 rounded-full bg-blue-100 text-blue-700 flex items-center justify-center font-bold text-[10px] shrink-0">
                {(b.name || '?')[0].toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm text-gray-900 truncate">{b.name} <span className="font-mono text-[10px] text-gray-400">[{b.broker_id}]</span></div>
                <div className="text-[11px] text-gray-500 truncate">{b.rank || '—'} · {b.phone || '—'}</div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
