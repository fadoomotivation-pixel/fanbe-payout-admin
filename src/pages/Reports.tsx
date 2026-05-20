import { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { formatINR } from '@/lib/utils'
import { Modal } from '@/components/ui/Modal.tsx'
import { Button } from '@/components/ui/Button.tsx'
import { Input, Select } from '@/components/ui/Input.tsx'
import toast from 'react-hot-toast'

type Tab = 'payments' | 'commissions' | 'emi_due' | 'broker_summary'

const PAYMENT_TYPES = ['token','booking','emi','full','full_payment']
const PAYMENT_MODES = ['cash','neft','rtgs','imps','upi','cheque','dd']
const VERIF_STATUS  = ['pending','verified','rejected']

function defaultRange() {
  const to = new Date().toISOString().slice(0,10)
  const fromDate = new Date(); fromDate.setDate(1)
  const from = fromDate.toISOString().slice(0,10)
  return { from, to }
}

export default function Reports() {
  const qc = useQueryClient()
  const [rows, setRows] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<Tab>('payments')
  const [range, setRange] = useState(defaultRange())
  const [editPayment, setEditPayment] = useState<any | null>(null)
  const [editCommission, setEditCommission] = useState<any | null>(null)
  const [reloadFlag, setReloadFlag] = useState(0)

  useEffect(() => {
    setLoading(true)
    const run = async () => {
      if (tab === 'payments') {
        const { data } = await supabase
          .from('bp_payments')
          .select('id, amount, payment_type, payment_mode, verification_status, payment_date, receipt_no, utr_ref, notes, bp_bookings(booking_no, bp_customers(name))')
          .gte('payment_date', range.from)
          .lte('payment_date', range.to)
          .order('payment_date', { ascending: false })
          .limit(500)
        setRows(data || [])
      } else if (tab === 'commissions') {
        const { data } = await supabase
          .from('bp_bookings')
          .select('id, booking_no, total_amount, commission_amount, commission_rate, stage, application_date, broker_id, brokers(name, broker_id)')
          .eq('stage', 'booking_done')
          .gte('application_date', range.from)
          .lte('application_date', range.to)
          .order('application_date', { ascending: false })
          .limit(500)
        setRows(data || [])
      } else if (tab === 'emi_due') {
        const today = new Date().toISOString().slice(0,10)
        const { data } = await supabase
          .from('emi_installments')
          .select('id, seq, due_date, amount, status, emi_schedules(bp_bookings(booking_no, bp_customers(name)))')
          .neq('status', 'paid')
          .lte('due_date', today)
          .order('due_date', { ascending: true })
          .limit(500)
        setRows(data || [])
      } else {
        // broker_summary — aggregate commissions by broker in the date range
        const { data } = await supabase
          .from('bp_bookings')
          .select('broker_id, commission_amount, total_amount, stage, brokers(id, name, broker_id, rank)')
          .eq('stage', 'booking_done')
          .gte('application_date', range.from)
          .lte('application_date', range.to)
        const agg: Record<string, any> = {}
        for (const r of data || []) {
          if (!r.broker_id) continue
          const k = r.broker_id
          agg[k] ??= { broker_id: r.brokers?.broker_id, broker_uuid: k, name: r.brokers?.name, rank: r.brokers?.rank, commission: 0, volume: 0, bookings: 0 }
          agg[k].commission += Number(r.commission_amount || 0)
          agg[k].volume     += Number(r.total_amount || 0)
          agg[k].bookings   += 1
        }
        setRows(Object.values(agg).sort((a: any, b: any) => b.commission - a.commission))
      }
      setLoading(false)
    }
    run()
  }, [tab, range, reloadFlag])

  const refresh = () => setReloadFlag(f => f + 1)

  const deletePayment = async (id: string) => {
    if (!confirm('Delete this payment row? This cannot be undone.')) return
    const { error } = await supabase.from('bp_payments').delete().eq('id', id)
    if (error) toast.error(error.message); else { toast.success('Payment deleted'); refresh() }
  }

  const savePayment = async () => {
    if (!editPayment) return
    const { id, ...rest } = editPayment
    const { error } = await supabase.from('bp_payments').update({
      amount: Number(rest.amount) || 0,
      payment_type: rest.payment_type,
      payment_mode: rest.payment_mode,
      verification_status: rest.verification_status,
      payment_date: rest.payment_date,
      receipt_no: rest.receipt_no || null,
      utr_ref: rest.utr_ref || null,
      notes: rest.notes || null,
    }).eq('id', id)
    if (error) { toast.error(error.message); return }
    toast.success('Payment updated'); setEditPayment(null); refresh()
  }

  const saveCommission = async () => {
    if (!editCommission) return
    const { id, commission_rate, total_amount } = editCommission
    const rate = Number(commission_rate) || 0
    const amt  = Math.round(Number(total_amount || 0) * rate / 100)
    const { error } = await supabase.from('bp_bookings').update({ commission_rate: rate, commission_amount: amt }).eq('id', id)
    if (error) { toast.error(error.message); return }
    // Propagate to react-query consumers (Payouts, Commission Ledger, BrokerDashboard, etc.)
    qc.invalidateQueries({ queryKey: ['bookings'] })
    qc.invalidateQueries({ queryKey: ['payouts'] })
    qc.invalidateQueries({ queryKey: ['commission_ledger'] })
    toast.success('Commission updated'); setEditCommission(null); refresh()
  }

  const totals = useMemo(() => {
    if (tab === 'payments') return rows.reduce((s: number, r: any) => s + Number(r.amount || 0), 0)
    if (tab === 'commissions') return rows.reduce((s: number, r: any) => s + Number(r.commission_amount || 0), 0)
    if (tab === 'emi_due') return rows.reduce((s: number, r: any) => s + Number(r.amount || 0), 0)
    return rows.reduce((s: number, r: any) => s + Number(r.commission || 0), 0)
  }, [rows, tab])

  const exportCsv = () => {
    if (!rows.length) return
    const flat = rows.map((r: any) => {
      if (tab === 'payments') return { receipt_no: r.receipt_no || '', booking: r.bp_bookings?.booking_no || '', customer: r.bp_bookings?.bp_customers?.name || '', amount: r.amount, type: r.payment_type, mode: r.payment_mode, status: r.verification_status, date: r.payment_date }
      if (tab === 'commissions') return { booking: r.booking_no, broker: r.brokers?.name || '', broker_id: r.brokers?.broker_id || '', total: r.total_amount, commission_pct: r.commission_rate, commission_amount: r.commission_amount, date: r.application_date }
      if (tab === 'emi_due') return { booking: r.emi_schedules?.bp_bookings?.booking_no || '', customer: r.emi_schedules?.bp_bookings?.bp_customers?.name || '', seq: r.seq, amount: r.amount, due_date: r.due_date, status: r.status }
      return { broker: r.name, broker_id: r.broker_id, rank: r.rank, bookings: r.bookings, volume: r.volume, commission: r.commission }
    })
    const headers = Object.keys(flat[0])
    const csv = [headers.join(','), ...flat.map(r => headers.map(h => JSON.stringify((r as any)[h] ?? '')).join(','))].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a'); a.href = url; a.download = `${tab}-${range.from}-to-${range.to}.csv`; a.click()
    URL.revokeObjectURL(url)
  }

  const tabs: { key: Tab; label: string }[] = [
    { key: 'payments',       label: 'Payments Received' },
    { key: 'commissions',    label: 'Broker Commissions' },
    { key: 'broker_summary', label: 'Broker Summary' },
    { key: 'emi_due',        label: 'EMI Due / Overdue' },
  ]

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Reports</h1>
          <p className="text-sm text-gray-500">Edit, filter, export and review transactions</p>
        </div>
        <button onClick={exportCsv} disabled={!rows.length} className="px-4 py-2 rounded-lg text-sm font-medium bg-gray-900 text-white disabled:bg-gray-300">Export CSV</button>
      </div>

      <div className="flex flex-wrap gap-2">
        {tabs.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${tab === t.key ? 'bg-blue-600 text-white' : 'bg-white border border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="bg-white rounded-xl border border-gray-100 p-3 flex flex-wrap items-end gap-3">
        <div>
          <label className="text-[11px] text-gray-500 block mb-1">From</label>
          <input type="date" value={range.from} onChange={e => setRange({ ...range, from: e.target.value })} className="text-sm border border-gray-200 rounded-lg px-3 py-1.5"/>
        </div>
        <div>
          <label className="text-[11px] text-gray-500 block mb-1">To</label>
          <input type="date" value={range.to} onChange={e => setRange({ ...range, to: e.target.value })} className="text-sm border border-gray-200 rounded-lg px-3 py-1.5"/>
        </div>
        <div className="flex gap-2">
          <QuickRange label="This month" onPick={() => setRange(defaultRange())}/>
          <QuickRange label="Last 7 days" onPick={() => { const to=new Date(); const from=new Date(); from.setDate(from.getDate()-7); setRange({ from: from.toISOString().slice(0,10), to: to.toISOString().slice(0,10) }) }}/>
          <QuickRange label="YTD" onPick={() => { const y=new Date().getFullYear(); setRange({ from: `${y}-01-01`, to: new Date().toISOString().slice(0,10) }) }}/>
        </div>
        <div className="ml-auto text-sm text-gray-600">
          {rows.length} rows · <b className="text-gray-900">{formatINR(totals)}</b>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="bg-gray-50 border-y border-gray-100">
              {tab === 'payments'       && ['Receipt','Booking','Customer','Type','Mode','Amount','Status','Date','Actions'].map(h => <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">{h}</th>)}
              {tab === 'commissions'    && ['Booking','Broker','Total Value','%','Commission','Date','Actions'].map(h => <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">{h}</th>)}
              {tab === 'broker_summary' && ['Broker','Rank','Bookings','Sales Volume','Total Commission'].map(h => <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">{h}</th>)}
              {tab === 'emi_due'        && ['Booking','Customer','#','Amount','Due','Status'].map(h => <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">{h}</th>)}
            </tr></thead>
            <tbody className="divide-y divide-gray-50">
              {loading ? <tr><td colSpan={9} className="py-12 text-center text-gray-400">Loading…</td></tr>
              : !rows.length ? <tr><td colSpan={9} className="py-12 text-center text-gray-400">No records in this range</td></tr>
              : rows.map((r: any, i) => (
                <tr key={r.id || r.broker_uuid || i} className="hover:bg-blue-50/30">
                  {tab === 'payments' && (<>
                    <td className="px-4 py-3 font-mono text-xs text-gray-500">{r.receipt_no || '—'}</td>
                    <td className="px-4 py-3 text-gray-700">{r.bp_bookings?.booking_no || '—'}</td>
                    <td className="px-4 py-3 text-gray-700">{r.bp_bookings?.bp_customers?.name || '—'}</td>
                    <td className="px-4 py-3 text-gray-700 uppercase text-xs">{r.payment_type}</td>
                    <td className="px-4 py-3 text-gray-700 uppercase text-xs">{r.payment_mode}</td>
                    <td className="px-4 py-3 font-semibold">{formatINR(r.amount)}</td>
                    <td className="px-4 py-3"><span className={`px-2 py-0.5 rounded-full text-xs font-medium ${r.verification_status === 'verified' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>{r.verification_status}</span></td>
                    <td className="px-4 py-3 text-gray-400 text-xs">{r.payment_date}</td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1">
                        <button onClick={() => setEditPayment({ ...r })} className="text-xs px-2 py-1 rounded bg-blue-50 text-blue-700 hover:bg-blue-100">Edit</button>
                        <button onClick={() => deletePayment(r.id)} className="text-xs px-2 py-1 rounded bg-red-50 text-red-700 hover:bg-red-100">Delete</button>
                      </div>
                    </td>
                  </>)}
                  {tab === 'commissions' && (<>
                    <td className="px-4 py-3 text-gray-700">{r.booking_no}</td>
                    <td className="px-4 py-3 text-gray-700">
                      {r.broker_id
                        ? <Link to={`/brokers/${r.broker_id}`} className="text-blue-600 hover:underline">{r.brokers?.name || '—'}</Link>
                        : '—'}
                      <span className="text-xs text-gray-400 ml-1">[{r.brokers?.broker_id || '—'}]</span>
                    </td>
                    <td className="px-4 py-3">{formatINR(r.total_amount)}</td>
                    <td className="px-4 py-3 text-gray-600">{r.commission_rate || 0}%</td>
                    <td className="px-4 py-3 font-semibold text-blue-700">{formatINR(r.commission_amount || 0)}</td>
                    <td className="px-4 py-3 text-gray-400 text-xs">{r.application_date}</td>
                    <td className="px-4 py-3">
                      <button onClick={() => setEditCommission({ ...r })} className="text-xs px-2 py-1 rounded bg-blue-50 text-blue-700 hover:bg-blue-100">Edit %</button>
                    </td>
                  </>)}
                  {tab === 'broker_summary' && (<>
                    <td className="px-4 py-3">
                      <Link to={`/brokers/${r.broker_uuid}`} className="text-blue-600 hover:underline font-medium">{r.name || '—'}</Link>
                      <span className="text-xs text-gray-400 ml-1">[{r.broker_id || '—'}]</span>
                    </td>
                    <td className="px-4 py-3 text-gray-600">{r.rank || '—'}</td>
                    <td className="px-4 py-3">{r.bookings}</td>
                    <td className="px-4 py-3">{formatINR(r.volume)}</td>
                    <td className="px-4 py-3 font-semibold text-blue-700">{formatINR(r.commission)}</td>
                  </>)}
                  {tab === 'emi_due' && (<>
                    <td className="px-4 py-3 text-gray-700">{r.emi_schedules?.bp_bookings?.booking_no || '—'}</td>
                    <td className="px-4 py-3 text-gray-700">{r.emi_schedules?.bp_bookings?.bp_customers?.name || '—'}</td>
                    <td className="px-4 py-3 text-gray-500">{r.seq}</td>
                    <td className="px-4 py-3 font-semibold">{formatINR(r.amount)}</td>
                    <td className="px-4 py-3 text-red-600 font-semibold text-xs">{r.due_date}</td>
                    <td className="px-4 py-3"><span className="px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700">{r.status}</span></td>
                  </>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <Modal open={!!editPayment} onClose={() => setEditPayment(null)} title="Edit Payment">
        {editPayment && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Input label="Amount (₹)" type="number" value={editPayment.amount} onChange={(e: any) => setEditPayment({ ...editPayment, amount: e.target.value })} />
              <Input label="Date" type="date" value={editPayment.payment_date || ''} onChange={(e: any) => setEditPayment({ ...editPayment, payment_date: e.target.value })} />
              <Select label="Type" value={editPayment.payment_type} onChange={(e: any) => setEditPayment({ ...editPayment, payment_type: e.target.value })}>
                {PAYMENT_TYPES.map(t => <option key={t} value={t}>{t.toUpperCase()}</option>)}
              </Select>
              <Select label="Mode" value={editPayment.payment_mode} onChange={(e: any) => setEditPayment({ ...editPayment, payment_mode: e.target.value })}>
                {PAYMENT_MODES.map(m => <option key={m} value={m}>{m.toUpperCase()}</option>)}
              </Select>
              <Select label="Verification" value={editPayment.verification_status} onChange={(e: any) => setEditPayment({ ...editPayment, verification_status: e.target.value })}>
                {VERIF_STATUS.map(s => <option key={s} value={s}>{s}</option>)}
              </Select>
              <Input label="Receipt No" value={editPayment.receipt_no || ''} onChange={(e: any) => setEditPayment({ ...editPayment, receipt_no: e.target.value })} />
              <Input label="UTR / Reference" value={editPayment.utr_ref || ''} onChange={(e: any) => setEditPayment({ ...editPayment, utr_ref: e.target.value })} className="col-span-2" />
              <Input label="Notes" value={editPayment.notes || ''} onChange={(e: any) => setEditPayment({ ...editPayment, notes: e.target.value })} className="col-span-2" />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" onClick={() => setEditPayment(null)}>Cancel</Button>
              <Button onClick={savePayment}>Save</Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={!!editCommission} onClose={() => setEditCommission(null)} title="Edit Broker Commission">
        {editCommission && (
          <div className="space-y-3">
            <div className="text-xs text-gray-500">Booking <b>{editCommission.booking_no}</b> · Total {formatINR(editCommission.total_amount)}</div>
            <Input label="Commission %" type="number" step="0.01" value={editCommission.commission_rate || 0} onChange={(e: any) => setEditCommission({ ...editCommission, commission_rate: e.target.value })} />
            <div className="text-xs text-gray-500">New commission amount: <b className="text-blue-700">{formatINR(Math.round(Number(editCommission.total_amount || 0) * (Number(editCommission.commission_rate) || 0) / 100))}</b></div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="secondary" onClick={() => setEditCommission(null)}>Cancel</Button>
              <Button onClick={saveCommission}>Save</Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}

function QuickRange({ label, onPick }: { label: string; onPick: () => void }) {
  return <button onClick={onPick} className="text-xs px-2 py-1.5 rounded bg-gray-100 hover:bg-gray-200 text-gray-700">{label}</button>
}
