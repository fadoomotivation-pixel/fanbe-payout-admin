import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Plus, Search, Users } from 'lucide-react'
import { supabase } from '../../lib/supabase'
import Badge from '../../components/ui/Badge'
import Modal from '../../components/ui/Modal'
import toast from 'react-hot-toast'

const initialForm = {
  name: '',
  phone: '',
  alt_phone: '',
  email: '',
  aadhaar: '',
  pan: '',
  address: '',
  city: '',
  state: '',
  notes: '',
}

export default function CustomersList() {
  const [customers, setCustomers] = useState([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState(initialForm)

  useEffect(() => {
    fetchCustomers()
  }, [])

  async function fetchCustomers() {
    setLoading(true)
    const { data } = await supabase.from('bp_customers').select('*').order('created_at', { ascending: false })
    setCustomers(data || [])
    setLoading(false)
  }

  async function createCustomer(e) {
    e.preventDefault()
    setSaving(true)
    const { error } = await supabase.from('bp_customers').insert(form)
    setSaving(false)
    if (error) return toast.error(error.message)
    toast.success('Customer created')
    setOpen(false)
    setForm(initialForm)
    fetchCustomers()
  }

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim()
    if (!q) return customers
    return customers.filter((c) => [c.name, c.phone, c.email, c.city, c.pan].filter(Boolean).some((v) => String(v).toLowerCase().includes(q)))
  }, [customers, search])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Customers</h1>
          <p className="text-sm text-slate-500 mt-1">Manage buyers, KYC identity and booking-linked customer records.</p>
        </div>
        <button className="btn-primary" onClick={() => setOpen(true)}><Plus size={16} /> Add Customer</button>
      </div>

      <div className="card p-4 flex items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} className="input pl-9" placeholder="Search name, phone, PAN, city..." />
        </div>
        <div className="text-sm text-slate-500">{customers.length} customers</div>
      </div>

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50 text-slate-600">
              <tr>
                <th className="px-4 py-3 text-left font-semibold">Customer</th>
                <th className="px-4 py-3 text-left font-semibold">Contact</th>
                <th className="px-4 py-3 text-left font-semibold">City</th>
                <th className="px-4 py-3 text-left font-semibold">KYC</th>
                <th className="px-4 py-3 text-right font-semibold">Action</th>
              </tr>
            </thead>
            <tbody>
              {!loading && filtered.length === 0 && (
                <tr><td colSpan="5" className="px-4 py-10 text-center text-slate-500">No customers found.</td></tr>
              )}
              {filtered.map((customer) => (
                <tr key={customer.id} className="border-t border-slate-100">
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-900">{customer.name}</div>
                    <div className="text-xs text-slate-500">{customer.email || 'No email'}</div>
                  </td>
                  <td className="px-4 py-3 text-slate-600">{customer.phone}</td>
                  <td className="px-4 py-3 text-slate-600">{customer.city || '—'}</td>
                  <td className="px-4 py-3">
                    {customer.pan || customer.aadhaar ? <Badge color="green">Available</Badge> : <Badge color="yellow">Pending</Badge>}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link to={`/customers/${customer.id}`} className="text-teal-700 hover:text-teal-800 font-medium">View</Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Modal open={open} onClose={() => setOpen(false)} title="Add Customer">
        <form onSubmit={createCustomer} className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {Object.keys(initialForm).map((key) => (
            <div key={key} className={['address', 'notes'].includes(key) ? 'md:col-span-2' : ''}>
              <label className="label capitalize">{key.replace('_', ' ')}</label>
              {['address', 'notes'].includes(key) ? (
                <textarea className="input min-h-24" value={form[key]} onChange={(e) => setForm((p) => ({ ...p, [key]: e.target.value }))} />
              ) : (
                <input className="input" value={form[key]} onChange={(e) => setForm((p) => ({ ...p, [key]: e.target.value }))} required={['name', 'phone'].includes(key)} />
              )}
            </div>
          ))}
          <div className="md:col-span-2 flex justify-end gap-3">
            <button type="button" className="btn-secondary" onClick={() => setOpen(false)}>Cancel</button>
            <button type="submit" className="btn-primary" disabled={saving}>{saving ? 'Saving...' : 'Create Customer'}</button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
