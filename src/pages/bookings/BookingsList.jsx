import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { Link } from 'react-router-dom'
import { Plus, Search, CreditCard, Banknote, Calculator } from 'lucide-react'
import LoadingSpinner from '../../components/ui/LoadingSpinner'
import EmptyState from '../../components/ui/EmptyState'
import { formatDate, formatINR } from '../../lib/utils'
import { STAGE_COLORS } from '../../constants/enums'

const STAGE_FILTERS = [
  { value: '', label: 'All' },
  { value: 'token', label: 'Token' },
  { value: 'booking', label: 'Booking' },
  { value: 'full_payment', label: 'Full Payment' },
  { value: 'registry_done', label: 'Registry' },
  { value: 'cancelled', label: 'Cancelled' },
]

const PAYMENT_TYPE_ICONS = {
  emi: { icon: CreditCard, label: 'EMI', cls: 'bg-purple-100 text-purple-700' },
  partial: { icon: Calculator, label: 'Partial', cls: 'bg-orange-100 text-orange-700' },
  lumpsum: { icon: Banknote, label: 'Lumpsum', cls: 'bg-slate-100 text-slate-600' },
}

export default function BookingsList() {
  const [stageFilter, setStageFilter] = useState('')
  const [paymentFilter, setPaymentFilter] = useState('')
  const [search, setSearch] = useState('')

  const { data: bookings = [], isLoading } = useQuery({
    queryKey: ['bookings', stageFilter, paymentFilter],
    queryFn: async () => {
      let q = supabase
        .from('bp_bookings')
        .select('id, booking_no, stage, payment_type, plot_total_price, total_collected, balance_due, created_at, emi_months, emi_amount, bp_customers(name), bp_plots(plot_no), bp_projects(name), brokers(name)')
        .order('created_at', { ascending: false })
      if (stageFilter) q = q.eq('stage', stageFilter)
      if (paymentFilter) q = q.eq('payment_type', paymentFilter)
      const { data } = await q
      return data
    },
  })

  const filtered = search.trim()
    ? bookings.filter(b =>
        b.booking_no?.toLowerCase().includes(search.toLowerCase()) ||
        b.bp_customers?.name?.toLowerCase().includes(search.toLowerCase()) ||
        b.bp_plots?.plot_no?.toLowerCase().includes(search.toLowerCase()) ||
        b.brokers?.name?.toLowerCase().includes(search.toLowerCase())
      )
    : bookings

  // KPI summary
  const totalCollected = bookings.reduce((s, b) => s + Number(b.total_collected || 0), 0)
  const totalBalance = bookings.reduce((s, b) => s + Number(b.balance_due || 0), 0)
  const emiCount = bookings.filter(b => b.payment_type === 'emi').length

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="page-title">Bookings</h1>
        <Link to="/bookings/new" className="btn-primary"><Plus size={16} />New Booking</Link>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-3 gap-3">
        <div className="card p-3 text-center">
          <p className="text-xs text-slate-500">Total Bookings</p>
          <p className="text-xl font-bold text-slate-700">{bookings.length}</p>
        </div>
        <div className="card p-3 text-center">
          <p className="text-xs text-slate-500">Collected</p>
          <p className="text-xl font-bold text-green-700">{formatINR(totalCollected)}</p>
        </div>
        <div className="card p-3 text-center">
          <p className="text-xs text-slate-500">Balance Due</p>
          <p className="text-xl font-bold text-red-600">{formatINR(totalBalance)}</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        {/* Search */}
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search booking, customer, plot…"
            className="input pl-8"
          />
        </div>
        {/* Payment type filter */}
        <div className="flex gap-2 flex-wrap">
          {[{ value: '', label: 'All Types' }, { value: 'lumpsum', label: 'Lumpsum' }, { value: 'emi', label: 'EMI' }, { value: 'partial', label: 'Partial' }].map(f => (
            <button
              key={f.value}
              onClick={() => setPaymentFilter(f.value)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                paymentFilter === f.value ? 'bg-teal-600 text-white' : 'bg-white border border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}
            >{f.label}</button>
          ))}
        </div>
      </div>

      {/* Stage tabs */}
      <div className="flex gap-0 border-b border-slate-200 overflow-x-auto">
        {STAGE_FILTERS.map(f => (
          <button
            key={f.value}
            onClick={() => setStageFilter(f.value)}
            className={`px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
              stageFilter === f.value
                ? 'border-teal-600 text-teal-700'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >{f.label}</button>
        ))}
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        {isLoading ? <LoadingSpinner fullPage /> : filtered.length === 0 ? <EmptyState title="No bookings found" /> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200">
                  {['Booking No', 'Customer', 'Project · Plot', 'Broker', 'Stage', 'Type', 'Plot Value', 'Collected', 'Balance', 'Date'].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-slate-500 whitespace-nowrap">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map(b => {
                  const pt = PAYMENT_TYPE_ICONS[b.payment_type || 'lumpsum'] || PAYMENT_TYPE_ICONS.lumpsum
                  const TypeIcon = pt.icon
                  const balance = Number(b.balance_due || 0)
                  const progress = b.plot_total_price > 0
                    ? Math.min(100, Math.round((Number(b.total_collected) / Number(b.plot_total_price)) * 100))
                    : 0

                  return (
                    <tr key={b.id} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                      <td className="px-4 py-3">
                        <Link to={`/bookings/${b.id}`} className="font-semibold text-teal-700 hover:underline">
                          {b.booking_no}
                        </Link>
                      </td>
                      <td className="px-4 py-3 font-medium">{b.bp_customers?.name}</td>
                      <td className="px-4 py-3">
                        <span className="text-slate-700">{b.bp_projects?.name}</span>
                        <span className="text-slate-400 mx-1">·</span>
                        <span className="font-medium">{b.bp_plots?.plot_no}</span>
                      </td>
                      <td className="px-4 py-3 text-slate-500">{b.brokers?.name || <span className="text-slate-300">—</span>}</td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${STAGE_COLORS[b.stage]}`}>
                          {b.stage?.replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${pt.cls}`}>
                          <TypeIcon size={10} />{pt.label}
                          {b.payment_type === 'emi' && b.emi_months && (
                            <span className="ml-0.5 opacity-70">({b.emi_months}m)</span>
                          )}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-600">{b.plot_total_price ? formatINR(b.plot_total_price) : '—'}</td>
                      <td className="px-4 py-3">
                        <div className="space-y-1">
                          <span className="font-medium text-green-700">{formatINR(b.total_collected)}</span>
                          <div className="w-16 h-1 bg-slate-100 rounded-full overflow-hidden">
                            <div className="h-full bg-teal-500 rounded-full" style={{ width: `${progress}%` }} />
                          </div>
                        </div>
                      </td>
                      <td className={`px-4 py-3 font-medium ${balance > 0 ? 'text-red-600' : 'text-green-700'}`}>
                        {formatINR(balance)}
                      </td>
                      <td className="px-4 py-3 text-slate-400 whitespace-nowrap">{formatDate(b.created_at)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
