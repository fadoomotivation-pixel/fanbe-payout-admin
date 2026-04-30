import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus, Search, UserCheck } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import Badge from '../../components/ui/Badge'
import Modal from '../../components/ui/Modal'
import toast from 'react-hot-toast'

const initialForm = {
  name: '',
  phone: '',
  email: '',
  address: '',
  aadhar_number: '',
  pan_number: '',
  notes: '',
}

const STATUS_COLORS = {
  pending_kyc: 'yellow',
  kyc_uploaded: 'blue',
  converted: 'green',
}

const STATUS_LABELS = {
  pending_kyc: 'KYC Pending',
  kyc_uploaded: 'KYC Uploaded',
  converted: 'Converted',
}

export default function MembersList() {
  const [members, setMembers] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState(initialForm)

  useEffect(() => { fetchMembers() }, [])

  async function fetchMembers() {
    setLoading(true)
    const { data, error } = await supabase
      .from('bp_members')
      .select('*')
      .order('created_at', { ascending: false })
    if (error) toast.error(error.message)
    setMembers(data || [])
    setLoading(false)
  }

  async function createMember(e) {
    e.preventDefault()
    setSaving(true)
    const { error } = await supabase.from('bp_members').insert({
      ...form,
      status: 'pending_kyc',
    })
    setSaving(false)
    if (error) return toast.error(error.message)
    toast.success('Member registered')
    setOpen(false)
    setForm(initialForm)
    fetchMembers()
  }

  const filtered = useMemo(() => {
    let list = members
    if (statusFilter !== 'all') list = list.filter((m) => m.status === statusFilter)
    const q = search.toLowerCase().trim()
    if (!q) return list
    return list.filter((m) =>
      [m.name, m.phone, m.email, m.pan_number, m.aadhar_number]
        .filter(Boolean)
        .some((v) => String(v).toLowerCase().includes(q))
    )
  }, [members, search, statusFilter])

  const counts = useMemo(() => ({
    all: members.length,
    pending_kyc: members.filter((m) => m.status === 'pending_kyc').length,
    kyc_uploaded: members.filter((m) => m.status === 'kyc_uploaded').length,
    converted: members.filter((m) => m.status === 'converted').length,
  }), [members])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Members</h1>
          <p className="text-sm text-slate-500 mt-1">
            Stage 2 of the pipeline. Registered users awaiting KYC before conversion to Customer.
          </p>
        </div>
        <button className="btn-primary" onClick={() => setOpen(true)}>
          <Plus size={16} /> Register Member
        </button>
      </div>

      {/* Status filter tabs */}
      <div className="flex gap-2 flex-wrap">
        {['all', 'pending_kyc', 'kyc_uploaded', 'converted'].map((s) => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
              statusFilter === s
                ? 'bg-teal-700 text-white border-teal-700'
                : 'bg-white text-slate-600 border-slate-200 hover:border-teal-400'
            }`}
          >
            {s === 'all' ? 'All' : STATUS_LABELS[s]} ({counts[s]})
          </button>
        ))}
      </div>

      <div className="card p-4 flex items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="input pl-9"
            placeholder="Search name, phone, PAN, Aadhar..."
          />
        </div>
        <div className="text-sm text-slate-500">{filtered.length} members</div>
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-4 py-3 text-left font-semibold">Member</th>
                <th className="px-4 py-3 text-left font-semibold">Contact</th>
                <th className="px-4 py-3 text-left font-semibold">PAN</th>
                <th className="px-4 py-3 text-left font-semibold">Aadhar</th>
                <th className="px-4 py-3 text-left font-semibold">KYC Status</th>
                <th className="px-4 py-3 text-right font-semibold">Action</th>
              </tr>
            </thead>
            <tbody>
              {loading && (
                <tr>
                  <td colSpan="6" className="px-4 py-10 text-center text-slate-400">Loading...</td>
                </tr>
              )}
              {!loading && filtered.length === 0 && (
                <tr>
                  <td colSpan="6" className="px-4 py-10 text-center text-slate-500">
                    No members found.
                  </td>
                </tr>
              )}
              {filtered.map((member) => (
                <tr key={member.id} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-900">{member.name}</div>
                    <div className="text-xs text-slate-500">{member.email || 'No email'}</div>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{member.phone}</td>
                  <td className="px-4 py-3">
                    {member.pan_number ? (
                      <span className="font-mono text-xs text-slate-700">{member.pan_number}</span>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {member.aadhar_number ? (
                      <span className="font-mono text-xs text-slate-700">
                        XXXX-XXXX-{String(member.aadhar_number).slice(-4)}
                      </span>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <Badge color={STATUS_COLORS[member.status] || 'gray'}>
                      {STATUS_LABELS[member.status] || member.status}
                    </Badge>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      to={`/members/${member.id}`}
                      className="text-teal-700 hover:text-teal-800 font-medium"
                    >
                      View
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Add Member Modal */}
      <Modal open={open} onClose={() => setOpen(false)} title="Register Member">
        <form onSubmit={createMember} className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="label">Full Name *</label>
            <input className="input" value={form.name} required onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))} />
          </div>
          <div>
            <label className="label">Phone *</label>
            <input className="input" value={form.phone} required onChange={(e) => setForm((p) => ({ ...p, phone: e.target.value }))} />
          </div>
          <div>
            <label className="label">Email</label>
            <input className="input" type="email" value={form.email} onChange={(e) => setForm((p) => ({ ...p, email: e.target.value }))} />
          </div>
          <div>
            <label className="label">PAN Number</label>
            <input className="input uppercase" maxLength={10} value={form.pan_number} onChange={(e) => setForm((p) => ({ ...p, pan_number: e.target.value.toUpperCase() }))} />
          </div>
          <div>
            <label className="label">Aadhar Number</label>
            <input className="input" maxLength={12} value={form.aadhar_number} onChange={(e) => setForm((p) => ({ ...p, aadhar_number: e.target.value.replace(/\D/g, '') }))} placeholder="12-digit number" />
          </div>
          <div className="md:col-span-2">
            <label className="label">Address</label>
            <textarea className="input min-h-20" value={form.address} onChange={(e) => setForm((p) => ({ ...p, address: e.target.value }))} />
          </div>
          <div className="md:col-span-2">
            <label className="label">Notes</label>
            <textarea className="input min-h-16" value={form.notes} onChange={(e) => setForm((p) => ({ ...p, notes: e.target.value }))} />
          </div>
          <div className="md:col-span-2 flex justify-end gap-3">
            <button type="button" className="btn-secondary" onClick={() => setOpen(false)}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? 'Registering...' : 'Register Member'}
            </button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
