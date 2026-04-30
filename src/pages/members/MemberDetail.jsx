import { useEffect, useState } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { ArrowLeft, Upload, UserCheck, AlertCircle, CheckCircle2, FileText } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import Badge from '../../components/ui/Badge'
import toast from 'react-hot-toast'

const STATUS_COLORS = { pending_kyc: 'yellow', kyc_uploaded: 'blue', converted: 'green' }
const STATUS_LABELS = { pending_kyc: 'KYC Pending', kyc_uploaded: 'KYC Uploaded', converted: 'Converted to Customer' }

export default function MemberDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [member, setMember] = useState(null)
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState({ aadhar: false, pan: false })
  const [converting, setConverting] = useState(false)
  const [confirmConvert, setConfirmConvert] = useState(false)

  useEffect(() => { fetchMember() }, [id])

  async function fetchMember() {
    setLoading(true)
    const { data, error } = await supabase.from('bp_members').select('*').eq('id', id).single()
    if (error) { toast.error('Member not found'); navigate('/members'); return }
    setMember(data)
    setLoading(false)
  }

  async function uploadDocument(file, type) {
    if (!file) return
    const ext = file.name.split('.').pop()
    const path = `members/${id}/${type}_${Date.now()}.${ext}`
    setUploading((p) => ({ ...p, [type]: true }))

    const { error: uploadError } = await supabase.storage
      .from('kyc-documents')
      .upload(path, file, { upsert: true })

    if (uploadError) {
      toast.error(uploadError.message)
      setUploading((p) => ({ ...p, [type]: false }))
      return
    }

    const { data: urlData } = supabase.storage.from('kyc-documents').getPublicUrl(path)
    const field = type === 'aadhar' ? 'aadhar_image_url' : 'pan_image_url'

    const { error: updateError } = await supabase
      .from('bp_members')
      .update({ [field]: urlData.publicUrl, status: 'kyc_uploaded' })
      .eq('id', id)

    setUploading((p) => ({ ...p, [type]: false }))
    if (updateError) return toast.error(updateError.message)
    toast.success(`${type === 'aadhar' ? 'Aadhar' : 'PAN'} uploaded successfully`)
    fetchMember()
  }

  async function convertToCustomer() {
    if (!member.aadhar_image_url || !member.pan_number) {
      toast.error('KYC documents (Aadhar image + PAN number) are required before conversion.')
      return
    }
    setConverting(true)

    // Create customer record
    const { error: custError } = await supabase.from('bp_customers').insert({
      name: member.name,
      phone: member.phone,
      email: member.email,
      address: member.address,
      aadhaar: member.aadhar_number,
      pan: member.pan_number,
      notes: member.notes,
      member_id: member.id,
    })

    if (custError) {
      setConverting(false)
      return toast.error(custError.message)
    }

    // Mark member as converted
    await supabase
      .from('bp_members')
      .update({ status: 'converted', converted_at: new Date().toISOString() })
      .eq('id', id)

    setConverting(false)
    setConfirmConvert(false)
    toast.success(`${member.name} converted to Customer successfully!`)
    fetchMember()
  }

  if (loading) return <div className="flex justify-center py-20"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-teal-600" /></div>
  if (!member) return null

  const kycComplete = !!(member.aadhar_image_url && member.pan_number)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link to="/members" className="p-2 hover:bg-slate-100 rounded-lg transition-colors">
          <ArrowLeft size={20} className="text-slate-600" />
        </Link>
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-slate-900">{member.name}</h1>
          <p className="text-sm text-slate-500 mt-0.5">Member Profile · Registered {new Date(member.created_at).toLocaleDateString('en-IN')}</p>
        </div>
        <Badge color={STATUS_COLORS[member.status]}>{STATUS_LABELS[member.status]}</Badge>
      </div>

      {/* KYC Warning Banner */}
      {!kycComplete && member.status !== 'converted' && (
        <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-xl p-4">
          <AlertCircle size={18} className="text-amber-600 mt-0.5 shrink-0" />
          <div>
            <p className="text-sm font-semibold text-amber-800">KYC Incomplete</p>
            <p className="text-sm text-amber-700 mt-0.5">
              Aadhar image upload and PAN number are required before this member can be converted to a Customer.
            </p>
          </div>
        </div>
      )}

      {member.status === 'converted' && (
        <div className="flex items-center gap-3 bg-green-50 border border-green-200 rounded-xl p-4">
          <CheckCircle2 size={18} className="text-green-600 shrink-0" />
          <p className="text-sm font-semibold text-green-800">
            Converted to Customer on {member.converted_at ? new Date(member.converted_at).toLocaleDateString('en-IN') : '—'}
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Profile Info */}
        <div className="lg:col-span-2 space-y-6">
          <div className="card p-6">
            <h2 className="text-base font-semibold text-slate-800 mb-4">Personal Information</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {[
                { label: 'Full Name', value: member.name },
                { label: 'Phone', value: member.phone },
                { label: 'Email', value: member.email || '—' },
                { label: 'Aadhar Number', value: member.aadhar_number ? `XXXX-XXXX-${String(member.aadhar_number).slice(-4)}` : '—' },
                { label: 'PAN Number', value: member.pan_number || '—' },
              ].map(({ label, value }) => (
                <div key={label}>
                  <p className="text-xs text-slate-500 uppercase tracking-wide">{label}</p>
                  <p className="text-sm font-medium text-slate-800 mt-1">{value}</p>
                </div>
              ))}
              <div className="sm:col-span-2">
                <p className="text-xs text-slate-500 uppercase tracking-wide">Address</p>
                <p className="text-sm font-medium text-slate-800 mt-1">{member.address || '—'}</p>
              </div>
              {member.notes && (
                <div className="sm:col-span-2">
                  <p className="text-xs text-slate-500 uppercase tracking-wide">Notes</p>
                  <p className="text-sm text-slate-700 mt-1">{member.notes}</p>
                </div>
              )}
            </div>
          </div>

          {/* KYC Document Upload */}
          <div className="card p-6">
            <h2 className="text-base font-semibold text-slate-800 mb-4">KYC Documents</h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Aadhar Upload */}
              <div className="border border-dashed border-slate-300 rounded-xl p-4 text-center">
                <FileText size={28} className="mx-auto text-slate-400 mb-2" />
                <p className="text-sm font-medium text-slate-700 mb-1">Aadhar Card</p>
                {member.aadhar_image_url ? (
                  <div className="space-y-2">
                    <a href={member.aadhar_image_url} target="_blank" rel="noopener noreferrer"
                      className="inline-block text-xs text-teal-700 underline">
                      View Uploaded
                    </a>
                    <div>
                      <label className="text-xs text-slate-500 cursor-pointer hover:text-teal-700 underline">
                        Re-upload
                        <input type="file" className="hidden" accept="image/*,.pdf"
                          onChange={(e) => uploadDocument(e.target.files[0], 'aadhar')} />
                      </label>
                    </div>
                  </div>
                ) : (
                  <label className={`btn-secondary text-xs cursor-pointer ${uploading.aadhar ? 'opacity-50 pointer-events-none' : ''}`}>
                    {uploading.aadhar ? 'Uploading...' : <><Upload size={12} className="inline mr-1" />Upload</>}
                    <input type="file" className="hidden" accept="image/*,.pdf"
                      onChange={(e) => uploadDocument(e.target.files[0], 'aadhar')} />
                  </label>
                )}
                {member.aadhar_image_url && <CheckCircle2 size={14} className="mx-auto mt-2 text-green-500" />}
              </div>

              {/* PAN Upload */}
              <div className="border border-dashed border-slate-300 rounded-xl p-4 text-center">
                <FileText size={28} className="mx-auto text-slate-400 mb-2" />
                <p className="text-sm font-medium text-slate-700 mb-1">PAN Card</p>
                {member.pan_image_url ? (
                  <div className="space-y-2">
                    <a href={member.pan_image_url} target="_blank" rel="noopener noreferrer"
                      className="inline-block text-xs text-teal-700 underline">
                      View Uploaded
                    </a>
                    <div>
                      <label className="text-xs text-slate-500 cursor-pointer hover:text-teal-700 underline">
                        Re-upload
                        <input type="file" className="hidden" accept="image/*,.pdf"
                          onChange={(e) => uploadDocument(e.target.files[0], 'pan')} />
                      </label>
                    </div>
                  </div>
                ) : (
                  <label className={`btn-secondary text-xs cursor-pointer ${uploading.pan ? 'opacity-50 pointer-events-none' : ''}`}>
                    {uploading.pan ? 'Uploading...' : <><Upload size={12} className="inline mr-1" />Upload</>}
                    <input type="file" className="hidden" accept="image/*,.pdf"
                      onChange={(e) => uploadDocument(e.target.files[0], 'pan')} />
                  </label>
                )}
                {member.pan_image_url && <CheckCircle2 size={14} className="mx-auto mt-2 text-green-500" />}
              </div>
            </div>
          </div>
        </div>

        {/* Sidebar: Convert Action */}
        <div className="space-y-4">
          <div className="card p-5">
            <h3 className="text-sm font-semibold text-slate-700 mb-3">Pipeline Action</h3>
            {member.status === 'converted' ? (
              <div className="text-sm text-green-700 font-medium flex items-center gap-2">
                <CheckCircle2 size={16} /> Already a Customer
              </div>
            ) : (
              <>
                <p className="text-xs text-slate-500 mb-4">
                  Once KYC is complete, convert this member to a <strong>Customer</strong> so they can be
                  selected in the booking module.
                </p>
                {!confirmConvert ? (
                  <button
                    onClick={() => setConfirmConvert(true)}
                    disabled={!kycComplete}
                    className={`w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold transition-colors ${
                      kycComplete
                        ? 'bg-teal-700 text-white hover:bg-teal-800'
                        : 'bg-slate-100 text-slate-400 cursor-not-allowed'
                    }`}
                  >
                    <UserCheck size={15} />
                    Convert to Customer
                  </button>
                ) : (
                  <div className="space-y-3">
                    <p className="text-xs font-semibold text-slate-700">Confirm conversion?</p>
                    <p className="text-xs text-slate-500">This will create a Customer record for <strong>{member.name}</strong>.</p>
                    <div className="flex gap-2">
                      <button
                        onClick={convertToCustomer}
                        disabled={converting}
                        className="flex-1 bg-teal-700 text-white rounded-lg py-2 text-xs font-semibold hover:bg-teal-800 disabled:opacity-50"
                      >
                        {converting ? 'Converting...' : 'Yes, Convert'}
                      </button>
                      <button
                        onClick={() => setConfirmConvert(false)}
                        className="flex-1 border border-slate-200 rounded-lg py-2 text-xs font-medium hover:bg-slate-50"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
                {!kycComplete && (
                  <p className="text-xs text-amber-600 mt-2 flex items-center gap-1">
                    <AlertCircle size={12} /> Upload Aadhar image + enter PAN to enable
                  </p>
                )}
              </>
            )}
          </div>

          <div className="card p-4">
            <p className="text-xs text-slate-500 uppercase tracking-wide mb-2">Timeline</p>
            <div className="space-y-2 text-xs text-slate-600">
              <div>Registered: <span className="font-medium">{new Date(member.created_at).toLocaleDateString('en-IN')}</span></div>
              {member.converted_at && <div>Converted: <span className="font-medium text-green-700">{new Date(member.converted_at).toLocaleDateString('en-IN')}</span></div>}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
