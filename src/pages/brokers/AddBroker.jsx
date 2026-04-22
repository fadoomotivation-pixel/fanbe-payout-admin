import { useState, useEffect } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { ArrowLeft, Eye, EyeOff, Copy, CheckCircle, UserPlus, Loader2 } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import toast from 'react-hot-toast'

const RANKS = [
  { value: 'associate', label: 'Associate' },
  { value: 'sales_officer', label: 'Sales Officer' },
  { value: 'senior_sales_officer', label: 'Senior Sales Officer' },
  { value: 'team_leader', label: 'Team Leader' },
  { value: 'senior_team_leader', label: 'Senior Team Leader' },
  { value: 'team_manager', label: 'Team Manager' },
  { value: 'senior_team_manager', label: 'Senior Team Manager' },
  { value: 'area_manager', label: 'Area Manager' },
  { value: 'senior_area_manager', label: 'Senior Area Manager' },
  { value: 'regional_manager', label: 'Regional Manager' },
  { value: 'senior_regional_manager', label: 'Senior Regional Manager' },
  { value: 'zonal_manager', label: 'Zonal Manager' },
  { value: 'national_manager', label: 'National Manager' },
  { value: 'vice_president', label: 'Vice President' },
  { value: 'president', label: 'President' },
]

function generateTempPassword() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  return Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join('')
}

export default function AddBroker() {
  const navigate = useNavigate()
  const [step, setStep] = useState(1) // 1=details, 2=bank&kyc, 3=confirm
  const [loading, setLoading] = useState(false)
  const [brokers, setBrokers] = useState([]) // for upline dropdown
  const [tempPassword] = useState(generateTempPassword)
  const [showPassword, setShowPassword] = useState(false)
  const [copied, setCopied] = useState(false)
  const [createdBroker, setCreatedBroker] = useState(null)

  const [form, setForm] = useState({
    name: '',
    mobile: '',
    email: '',
    rank: 'associate',
    upline_broker_id: '',
    pan_number: '',
    aadhaar_number: '',
    bank_account_no: '',
    bank_ifsc: '',
    bank_name: '',
    kyc_status: 'pending',
    address: '',
    city: '',
  })

  const [errors, setErrors] = useState({})

  useEffect(() => {
    supabase.from('brokers').select('id, name, rank').order('name').then(({ data }) => setBrokers(data || []))
  }, [])

  const set = (k, v) => {
    setForm(f => ({ ...f, [k]: v }))
    setErrors(e => ({ ...e, [k]: '' }))
  }

  function validateStep1() {
    const e = {}
    if (!form.name.trim()) e.name = 'Full name is required'
    if (!/^[6-9]\d{9}$/.test(form.mobile)) e.mobile = 'Enter valid 10-digit mobile'
    if (form.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) e.email = 'Enter valid email'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  function validateStep2() {
    const e = {}
    if (form.pan_number && !/^[A-Z]{5}[0-9]{4}[A-Z]$/.test(form.pan_number.toUpperCase())) e.pan_number = 'Invalid PAN format (e.g. ABCDE1234F)'
    if (form.aadhaar_number && !/^\d{12}$/.test(form.aadhaar_number)) e.aadhaar_number = 'Aadhaar must be 12 digits'
    if (form.bank_ifsc && !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(form.bank_ifsc.toUpperCase())) e.bank_ifsc = 'Invalid IFSC format'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  async function handleSubmit() {
    setLoading(true)
    try {
      // Check mobile not already registered
      const { data: existing } = await supabase.from('brokers').select('id').eq('mobile', form.mobile).maybeSingle()
      if (existing) {
        toast.error('A broker with this mobile number already exists')
        setStep(1)
        setErrors({ mobile: 'Mobile already registered' })
        setLoading(false)
        return
      }

      // Create dummy email for Supabase Auth
      const authEmail = form.email || `broker_${form.mobile}@internal.fanbegroup.com`

      // Create auth user via service role (Edge Function)
      // For now create broker record directly — portal_access granted after auth creation
      const { data: broker, error } = await supabase.from('brokers').insert({
        name: form.name.trim(),
        mobile: form.mobile,
        email: form.email || null,
        rank: form.rank,
        upline_broker_id: form.upline_broker_id || null,
        pan_number: form.pan_number.toUpperCase() || null,
        aadhaar_number: form.aadhaar_number || null,
        bank_account_no: form.bank_account_no || null,
        bank_ifsc: form.bank_ifsc.toUpperCase() || null,
        bank_name: form.bank_name || null,
        kyc_status: form.kyc_status,
        address: form.address || null,
        city: form.city || null,
        status: 'active',
        portal_access: false,
        force_password_change: true,
        temp_password: tempPassword,
        created_at: new Date().toISOString(),
      }).select().single()

      if (error) throw error

      // Call Edge Function to create auth user + send credentials
      const { error: fnErr } = await supabase.functions.invoke('create-broker-account', {
        body: { broker_id: broker.id }
      })

      if (fnErr) {
        // Non-fatal: broker record created, just couldn't send credentials
        toast('Broker created. Credentials could not be sent automatically — share manually.', { icon: '⚠️' })
      } else {
        toast.success('Broker account created & credentials sent!')
      }

      setCreatedBroker(broker)
      setStep(3)
    } catch (err) {
      toast.error(err.message || 'Failed to create broker')
    }
    setLoading(false)
  }

  function copyPassword() {
    navigator.clipboard.writeText(tempPassword)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const inputCls = (field) =>
    `input ${errors[field] ? 'border-red-400 focus:border-red-500 focus:ring-red-200' : ''}`

  // ── STEP 3: Success Screen ──────────────────────────────────────────
  if (step === 3 && createdBroker) {
    return (
      <div className="max-w-lg mx-auto">
        <div className="card p-8 text-center space-y-4">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto">
            <CheckCircle size={32} className="text-green-600" />
          </div>
          <h2 className="text-xl font-bold text-slate-900">Broker Account Created!</h2>
          <p className="text-slate-500 text-sm">Credentials have been sent to <strong>+91 {form.mobile}</strong> via SMS.</p>

          <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-left space-y-3">
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Login Credentials</p>
            <div className="flex justify-between text-sm">
              <span className="text-slate-500">Portal URL</span>
              <span className="font-medium text-teal-700">broker.fanbegroup.com</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-500">Mobile</span>
              <span className="font-medium">{form.mobile}</span>
            </div>
            <div className="flex justify-between text-sm items-center">
              <span className="text-slate-500">Temp Password</span>
              <div className="flex items-center gap-2">
                <span className="font-mono font-bold text-slate-900">
                  {showPassword ? tempPassword : '••••••••'}
                </span>
                <button onClick={() => setShowPassword(v => !v)} className="text-slate-400 hover:text-slate-600">
                  {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
                <button onClick={copyPassword} className="text-teal-600 hover:text-teal-800">
                  {copied ? <CheckCircle size={14} /> : <Copy size={14} />}
                </button>
              </div>
            </div>
          </div>

          <div className="flex gap-3 pt-2">
            <Link to={`/brokers/${createdBroker.id}`} className="flex-1 btn-primary text-center">
              View Broker Profile
            </Link>
            <Link to="/brokers/new" onClick={() => { setStep(1); setCreatedBroker(null) }} className="flex-1 btn-secondary text-center">
              Add Another
            </Link>
          </div>
          <Link to="/brokers" className="text-sm text-slate-500 hover:text-slate-700 block">← Back to Brokers List</Link>
        </div>
      </div>
    )
  }

  // ── STEPS 1 & 2 ────────────────────────────────────────────────────
  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Link to="/brokers" className="p-2 rounded-lg hover:bg-slate-100"><ArrowLeft size={16} /></Link>
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Add New Broker</h1>
          <p className="text-sm text-slate-500 mt-0.5">Fill in broker details to create their account and send credentials.</p>
        </div>
      </div>

      {/* Step Indicator */}
      <div className="flex items-center gap-2">
        {['Personal Details', 'Bank & KYC'].map((label, i) => (
          <div key={i} className="flex items-center gap-2">
            <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-sm font-medium transition-colors
              ${step === i + 1 ? 'bg-teal-600 text-white' : step > i + 1 ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
              <span className="w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold
                bg-white/30">{step > i + 1 ? '✓' : i + 1}</span>
              {label}
            </div>
            {i === 0 && <div className="w-8 h-px bg-slate-200" />}
          </div>
        ))}
      </div>

      <div className="card p-6 space-y-5">

        {/* ── STEP 1: Personal Details ── */}
        {step === 1 && (
          <>
            <h2 className="font-semibold text-slate-800 border-b border-slate-100 pb-2">Personal Details</h2>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="label">Full Name <span className="text-red-500">*</span></label>
                <input className={inputCls('name')} placeholder="e.g. Rahul Sharma" value={form.name} onChange={e => set('name', e.target.value)} />
                {errors.name && <p className="text-red-500 text-xs mt-1">{errors.name}</p>}
              </div>

              <div>
                <label className="label">Mobile Number <span className="text-red-500">*</span></label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-sm">+91</span>
                  <input className={`${inputCls('mobile')} pl-10`} placeholder="9876543210" maxLength={10}
                    value={form.mobile} onChange={e => set('mobile', e.target.value.replace(/\D/g, ''))} />
                </div>
                {errors.mobile && <p className="text-red-500 text-xs mt-1">{errors.mobile}</p>}
              </div>

              <div>
                <label className="label">Email <span className="text-slate-400 text-xs">(optional)</span></label>
                <input className={inputCls('email')} placeholder="rahul@example.com" type="email"
                  value={form.email} onChange={e => set('email', e.target.value)} />
                {errors.email && <p className="text-red-500 text-xs mt-1">{errors.email}</p>}
              </div>

              <div>
                <label className="label">Rank</label>
                <select className="input" value={form.rank} onChange={e => set('rank', e.target.value)}>
                  {RANKS.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
                </select>
              </div>

              <div>
                <label className="label">Upline Broker <span className="text-slate-400 text-xs">(optional)</span></label>
                <select className="input" value={form.upline_broker_id} onChange={e => set('upline_broker_id', e.target.value)}>
                  <option value="">— None / Top Level —</option>
                  {brokers.map(b => <option key={b.id} value={b.id}>{b.name} ({b.rank?.replace(/_/g, ' ')})</option>)}
                </select>
              </div>

              <div>
                <label className="label">City <span className="text-slate-400 text-xs">(optional)</span></label>
                <input className="input" placeholder="e.g. Lucknow" value={form.city} onChange={e => set('city', e.target.value)} />
              </div>

              <div className="md:col-span-2">
                <label className="label">Address <span className="text-slate-400 text-xs">(optional)</span></label>
                <textarea className="input resize-none" rows={2} placeholder="Full address..."
                  value={form.address} onChange={e => set('address', e.target.value)} />
              </div>
            </div>

            {/* Temp Password Preview */}
            <div className="bg-teal-50 border border-teal-200 rounded-xl p-4">
              <p className="text-xs font-semibold text-teal-700 mb-2">Auto-generated Temp Password</p>
              <div className="flex items-center gap-3">
                <span className="font-mono font-bold text-teal-900 text-lg tracking-widest">
                  {showPassword ? tempPassword : '••••••••'}
                </span>
                <button onClick={() => setShowPassword(v => !v)} className="text-teal-500 hover:text-teal-700">
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
                <button onClick={copyPassword} className="text-teal-600 hover:text-teal-800 flex items-center gap-1 text-xs">
                  {copied ? <><CheckCircle size={14} /> Copied!</> : <><Copy size={14} /> Copy</>}
                </button>
              </div>
              <p className="text-xs text-teal-600 mt-1">This will be sent to the broker's mobile via SMS. They must change it on first login.</p>
            </div>

            <div className="flex justify-end">
              <button className="btn-primary" onClick={() => validateStep1() && setStep(2)}>Next: Bank & KYC →</button>
            </div>
          </>
        )}

        {/* ── STEP 2: Bank & KYC ── */}
        {step === 2 && (
          <>
            <h2 className="font-semibold text-slate-800 border-b border-slate-100 pb-2">Bank & KYC Details</h2>
            <p className="text-sm text-slate-500 -mt-2">These can be filled later. Leave blank if broker will submit KYC themselves.</p>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="label">PAN Number</label>
                <input className={inputCls('pan_number')} placeholder="ABCDE1234F" maxLength={10}
                  value={form.pan_number} onChange={e => set('pan_number', e.target.value.toUpperCase())} />
                {errors.pan_number && <p className="text-red-500 text-xs mt-1">{errors.pan_number}</p>}
              </div>

              <div>
                <label className="label">Aadhaar Number</label>
                <input className={inputCls('aadhaar_number')} placeholder="123456789012" maxLength={12}
                  value={form.aadhaar_number} onChange={e => set('aadhaar_number', e.target.value.replace(/\D/g, ''))} />
                {errors.aadhaar_number && <p className="text-red-500 text-xs mt-1">{errors.aadhaar_number}</p>}
              </div>

              <div>
                <label className="label">Bank Account Number</label>
                <input className="input" placeholder="Account number"
                  value={form.bank_account_no} onChange={e => set('bank_account_no', e.target.value.replace(/\D/g, ''))} />
              </div>

              <div>
                <label className="label">IFSC Code</label>
                <input className={inputCls('bank_ifsc')} placeholder="SBIN0001234" maxLength={11}
                  value={form.bank_ifsc} onChange={e => set('bank_ifsc', e.target.value.toUpperCase())} />
                {errors.bank_ifsc && <p className="text-red-500 text-xs mt-1">{errors.bank_ifsc}</p>}
              </div>

              <div className="md:col-span-2">
                <label className="label">Bank Name</label>
                <input className="input" placeholder="e.g. State Bank of India"
                  value={form.bank_name} onChange={e => set('bank_name', e.target.value)} />
              </div>

              <div>
                <label className="label">KYC Status</label>
                <select className="input" value={form.kyc_status} onChange={e => set('kyc_status', e.target.value)}>
                  <option value="pending">Pending — Broker to Submit</option>
                  <option value="submitted">Submitted — Under Review</option>
                  <option value="verified">Verified</option>
                </select>
              </div>
            </div>

            {/* Summary before submit */}
            <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 space-y-2">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Review Summary</p>
              <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-sm">
                <div className="text-slate-500">Name</div><div className="font-medium">{form.name}</div>
                <div className="text-slate-500">Mobile</div><div className="font-medium">+91 {form.mobile}</div>
                <div className="text-slate-500">Rank</div><div className="font-medium">{RANKS.find(r => r.value === form.rank)?.label}</div>
                <div className="text-slate-500">Upline</div><div className="font-medium">{brokers.find(b => b.id === form.upline_broker_id)?.name || 'None'}</div>
              </div>
            </div>

            <div className="flex justify-between">
              <button className="btn-secondary" onClick={() => setStep(1)}>← Back</button>
              <button
                className="btn-primary flex items-center gap-2"
                onClick={() => validateStep2() && handleSubmit()}
                disabled={loading}
              >
                {loading ? <><Loader2 size={16} className="animate-spin" /> Creating...</> : <><UserPlus size={16} /> Create Account & Send Credentials</>}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
