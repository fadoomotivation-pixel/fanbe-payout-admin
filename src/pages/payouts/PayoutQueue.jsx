import { useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useMutation } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { queryClient } from '../../lib/queryClient'
import LoadingSpinner from '../../components/ui/LoadingSpinner'
import {
  Banknote, Clock3, CircleDollarSign, CheckCircle2, XCircle,
  PauseCircle, Search, ChevronDown, MoreVertical, IndianRupee,
  Filter, Download
} from 'lucide-react'
import { PAYOUT_STATUS, PAYOUT_STATUS_COLORS } from '../../constants/enums'
import { formatINR, formatDate } from '../../lib/utils'
import toast from 'react-hot-toast'

const PAYOUT_TYPE_LABELS = {
  on_booking: 'On Booking',
  milestone: 'Milestone',
  registry: 'Registry',
  bonus: 'Bonus',
  referral: 'Referral',
  override: 'Override',
}

function KpiCard({ label, value, sub, color = 'text-slate-900', icon: Icon }) {
  return (
    <div className="card p-4">
      <div className="flex items-center gap-2 text-slate-500 text-xs mb-1">
        {Icon && <Icon size={13} />} {label}
      </div>
      <p className={`text-2xl font-bold mt-1 ${color}`}>{value}</p>
      {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
    </div>
  )
}

function ActionMenu({ row, onAction }) {
  const [open, setOpen] = useState(false)
  const actions = [
    { key: 'approved', label: 'Approve', icon: CheckCircle2, color: 'text-blue-700', show: row.status !== 'approved' && row.status !== 'paid' },
    { key: 'paid', label: 'Mark Paid', icon: Banknote, color: 'text-green-700', show: row.status !== 'paid' },
    { key: 'hold', label: 'Put on Hold', icon: PauseCircle, color: 'text-orange-600', show: row.status !== 'hold' && row.status !== 'paid' },
    { key: 'rejected', label: 'Reject', icon: XCircle, color: 'text-red-600', show: row.status !== 'rejected' && row.status !== 'paid' },
  ].filter(a => a.show)

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-700"
      >
        <MoreVertical size={15} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-20 mt-1 w-40 bg-white border border-slate-200 rounded-xl shadow-lg overflow-hidden">
            {actions.map(a => (
              <button
                key={a.key}
                onClick={() => { onAction(row.id, a.key); setOpen(false) }}
                className={`w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-slate-50 ${a.color}`}
              >
                <a.icon size={14} /> {a.label}
              </button>
            ))}
            {row.broker_id && (
              <Link
                to={`/brokers/${row.broker_id}`}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-slate-50 text-slate-600 border-t border-slate-100"
                onClick={() => setOpen(false)}
              >
                View Broker
              </Link>
            )}
          </div>
        </>
      )}
    </div>
  )
}

export default function PayoutQueue() {
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const [selected, setSelected] = useState(new Set())
  const [bulkAction, setBulkAction] = useState('')

  // Fetch all payout transactions with broker + booking join
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['payout-queue'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('bp_payout_transactions')
        .select(`
          *,
          brokers(id, name, mobile, rank),
          bp_bookings(booking_no, bp_projects(name))
        `)
        .order('created_at', { ascending: false })
      if (error) throw error
      return data || []
    },
  })

  // Update status mutation (single row)
  const updateStatus = useMutation({
    mutationFn: async ({ ids, status }) => {
      const { error } = await supabase
        .from('bp_payout_transactions')
        .update({ status, ...(status === 'paid' ? { paid_at: new Date().toISOString() } : {}) })
        .in('id', ids)
      if (error) throw error
    },
    onSuccess: (_, { ids, status }) => {
      queryClient.invalidateQueries({ queryKey: ['payout-queue'] })
      queryClient.invalidateQueries({ queryKey: ['broker-payouts'] })
      toast.success(`${ids.length} transaction${ids.length > 1 ? 's' : ''} marked ${status}`)
      setSelected(new Set())
    },
    onError: () => toast.error('Update failed'),
  })

  function handleAction(id, status) {
    updateStatus.mutate({ ids: [id], status })
  }

  function handleBulkAction() {
    if (!bulkAction || selected.size === 0) return
    updateStatus.mutate({ ids: [...selected], status: bulkAction })
    setBulkAction('')
  }

  // Filtered rows
  const filtered = useMemo(() => {
    return rows.filter(r => {
      if (statusFilter && r.status !== statusFilter) return false
      if (typeFilter && r.payout_type !== typeFilter) return false
      if (search) {
        const q = search.toLowerCase()
        const brokerName = r.brokers?.name?.toLowerCase() || ''
        const bookingNo = r.bp_bookings?.booking_no?.toLowerCase() || ''
        const ref = (r.reference_no || r.id || '').toLowerCase()
        if (!brokerName.includes(q) && !bookingNo.includes(q) && !ref.includes(q)) return false
      }
      return true
    })
  }, [rows, statusFilter, typeFilter, search])

  // KPIs from ALL rows (unfiltered)
  const kpiPending = rows.filter(r => r.status === 'pending')
  const kpiApproved = rows.filter(r => r.status === 'approved')
  const kpiPaid = rows.filter(r => r.status === 'paid')
  const kpiHold = rows.filter(r => r.status === 'hold')
  const totalPending = kpiPending.reduce((s, r) => s + (r.amount || 0), 0)
  const totalApproved = kpiApproved.reduce((s, r) => s + (r.amount || 0), 0)
  const totalPaid = kpiPaid.reduce((s, r) => s + (r.net_amount || r.amount || 0), 0)

  // Select all on current filtered page
  const allFilteredIds = filtered.map(r => r.id)
  const allSelected = allFilteredIds.length > 0 && allFilteredIds.every(id => selected.has(id))
  function toggleAll() {
    if (allSelected) {
      setSelected(prev => { const n = new Set(prev); allFilteredIds.forEach(id => n.delete(id)); return n })
    } else {
      setSelected(prev => { const n = new Set(prev); allFilteredIds.forEach(id => n.add(id)); return n })
    }
  }
  function toggleOne(id) {
    setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  // CSV export
  function exportCSV() {
    const headers = ['Booking No', 'Project', 'Broker', 'Mobile', 'Type', 'Gross', 'TDS', 'Net', 'Status', 'Date']
    const csvRows = filtered.map(r => [
      r.bp_bookings?.booking_no || '',
      r.bp_bookings?.bp_projects?.name || '',
      r.brokers?.name || '',
      r.brokers?.mobile || '',
      r.payout_type || '',
      r.amount || 0,
      r.tds_amount || 0,
      r.net_amount || r.amount || 0,
      r.status || '',
      r.created_at ? new Date(r.created_at).toLocaleDateString('en-IN') : '',
    ])
    const csv = [headers, ...csvRows].map(row => row.join(',')).join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `payout-queue-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
  }

  if (isLoading) return <LoadingSpinner fullPage />

  const uniqueTypes = [...new Set(rows.map(r => r.payout_type).filter(Boolean))]

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="page-title">Payout Queue</h1>
          <p className="text-sm text-slate-500 mt-0.5">Review and disburse broker commission payouts</p>
        </div>
        <button
          onClick={exportCSV}
          className="btn-secondary flex items-center gap-1.5 text-sm"
        >
          <Download size={14} /> Export CSV
        </button>
      </div>

      {/* KPI Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard
          label="Pending"
          value={kpiPending.length}
          sub={formatINR(totalPending)}
          color="text-yellow-600"
          icon={Clock3}
        />
        <KpiCard
          label="Approved"
          value={kpiApproved.length}
          sub={formatINR(totalApproved)}
          color="text-blue-700"
          icon={CheckCircle2}
        />
        <KpiCard
          label="Paid Out"
          value={kpiPaid.length}
          sub={formatINR(totalPaid)}
          color="text-green-700"
          icon={Banknote}
        />
        <KpiCard
          label="On Hold"
          value={kpiHold.length}
          sub="requires review"
          color="text-orange-600"
          icon={PauseCircle}
        />
      </div>

      {/* Filters + Search + Bulk */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Search */}
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search broker, booking, ref…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="input pl-8 text-sm py-2 w-full"
          />
        </div>

        {/* Status filter */}
        <div className="relative">
          <Filter size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            className="input pl-8 pr-8 text-sm py-2 appearance-none"
          >
            <option value="">All Status</option>
            {PAYOUT_STATUS.map(s => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
          <ChevronDown size={13} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
        </div>

        {/* Type filter */}
        <div className="relative">
          <select
            value={typeFilter}
            onChange={e => setTypeFilter(e.target.value)}
            className="input pr-8 text-sm py-2 appearance-none"
          >
            <option value="">All Types</option>
            {uniqueTypes.map(t => (
              <option key={t} value={t}>{PAYOUT_TYPE_LABELS[t] || t}</option>
            ))}
          </select>
          <ChevronDown size={13} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
        </div>

        {/* Bulk action */}
        {selected.size > 0 && (
          <div className="flex items-center gap-2 ml-auto">
            <span className="text-xs text-slate-500 font-medium">{selected.size} selected</span>
            <select
              value={bulkAction}
              onChange={e => setBulkAction(e.target.value)}
              className="input text-sm py-2 pr-8 appearance-none"
            >
              <option value="">Bulk Action…</option>
              <option value="approved">Approve</option>
              <option value="paid">Mark Paid</option>
              <option value="hold">Put on Hold</option>
              <option value="rejected">Reject</option>
            </select>
            <button
              onClick={handleBulkAction}
              disabled={!bulkAction || updateStatus.isPending}
              className="btn-primary text-sm disabled:opacity-50"
            >
              Apply
            </button>
          </div>
        )}

        {/* Result count (when no selection) */}
        {selected.size === 0 && (
          <span className="text-xs text-slate-400 ml-auto">{filtered.length} of {rows.length}</span>
        )}
      </div>

      {/* Table */}
      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="px-4 py-2.5 w-8">
                  <input
                    type="checkbox"
                    checked={allSelected}
                    onChange={toggleAll}
                    className="rounded border-slate-300 text-teal-600"
                  />
                </th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500">Booking / Project</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500">Broker</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500">Type</th>
                <th className="text-right px-4 py-2.5 text-xs font-semibold text-slate-500">Gross</th>
                <th className="text-right px-4 py-2.5 text-xs font-semibold text-slate-500">TDS</th>
                <th className="text-right px-4 py-2.5 text-xs font-semibold text-slate-500">Net</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500">Status</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500">Date</th>
                <th className="px-4 py-2.5 w-8" />
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 && (
                <tr>
                  <td colSpan="10" className="px-4 py-12 text-center text-slate-400">
                    {rows.length === 0 ? 'No payout transactions yet.' : 'No transactions match the filters.'}
                  </td>
                </tr>
              )}
              {filtered.map(row => (
                <tr
                  key={row.id}
                  className={`border-b border-slate-100 transition-colors ${
                    selected.has(row.id) ? 'bg-teal-50' : 'hover:bg-slate-50'
                  }`}
                >
                  {/* Checkbox */}
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      checked={selected.has(row.id)}
                      onChange={() => toggleOne(row.id)}
                      className="rounded border-slate-300 text-teal-600"
                    />
                  </td>

                  {/* Booking / Project */}
                  <td className="px-4 py-3">
                    <p className="font-medium text-teal-700">
                      {row.bp_bookings?.booking_no || row.reference_no || '—'}
                    </p>
                    <p className="text-xs text-slate-400 mt-0.5">
                      {row.bp_bookings?.bp_projects?.name || '—'}
                    </p>
                  </td>

                  {/* Broker */}
                  <td className="px-4 py-3">
                    {row.brokers ? (
                      <Link
                        to={`/brokers/${row.broker_id}`}
                        className="font-medium text-slate-800 hover:text-teal-700"
                      >
                        {row.brokers.name}
                      </Link>
                    ) : (
                      <span className="text-slate-400">—</span>
                    )}
                    {row.brokers?.mobile && (
                      <p className="text-xs text-slate-400 mt-0.5">+91 {row.brokers.mobile}</p>
                    )}
                  </td>

                  {/* Type */}
                  <td className="px-4 py-3">
                    <span className="text-xs bg-slate-100 text-slate-700 px-2 py-0.5 rounded-full capitalize">
                      {PAYOUT_TYPE_LABELS[row.payout_type] || row.payout_type || 'Commission'}
                    </span>
                  </td>

                  {/* Gross */}
                  <td className="px-4 py-3 text-right font-medium text-slate-800">
                    {formatINR(row.amount)}
                  </td>

                  {/* TDS */}
                  <td className="px-4 py-3 text-right text-red-500 text-xs">
                    {row.tds_amount ? `-${formatINR(row.tds_amount)}` : '—'}
                  </td>

                  {/* Net */}
                  <td className="px-4 py-3 text-right font-semibold text-slate-900">
                    {formatINR(row.net_amount || row.amount)}
                  </td>

                  {/* Status */}
                  <td className="px-4 py-3">
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${
                      PAYOUT_STATUS_COLORS[row.status] || 'bg-slate-100 text-slate-600'
                    }`}>
                      {row.status || 'pending'}
                    </span>
                  </td>

                  {/* Date */}
                  <td className="px-4 py-3 text-slate-400 text-xs whitespace-nowrap">
                    {formatDate(row.created_at)}
                    {row.paid_at && (
                      <p className="text-green-600 mt-0.5">Paid {formatDate(row.paid_at)}</p>
                    )}
                  </td>

                  {/* Actions */}
                  <td className="px-3 py-3">
                    <ActionMenu row={row} onAction={handleAction} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Footer summary */}
        {filtered.length > 0 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100 bg-slate-50">
            <span className="text-xs text-slate-500">
              {filtered.length} transaction{filtered.length !== 1 ? 's' : ''}
            </span>
            <div className="flex items-center gap-4 text-xs">
              <span className="text-slate-500">
                Gross: <span className="font-semibold text-slate-700">
                  {formatINR(filtered.reduce((s, r) => s + (r.amount || 0), 0))}
                </span>
              </span>
              <span className="text-red-400">
                TDS: <span className="font-semibold">
                  -{formatINR(filtered.reduce((s, r) => s + (r.tds_amount || 0), 0))}
                </span>
              </span>
              <span className="text-slate-700 font-semibold">
                Net: <span className="text-teal-700">
                  {formatINR(filtered.reduce((s, r) => s + (r.net_amount || r.amount || 0), 0))}
                </span>
              </span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
