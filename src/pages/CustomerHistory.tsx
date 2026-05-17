import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import { Search, User, Wallet, CalendarDays, AlertTriangle, Printer, FileText } from 'lucide-react'
import { formatINR, formatDate } from '@/lib/utils'
import { printPaymentReceipt } from '@/lib/printTemplates'
import toast from 'react-hot-toast'

export default function Customers() {
  const [searchParams, setSearchParams] = useSearchParams()
  const [customers, setCustomers] = useState<any[]>([])
  const [loading, setLoading]     = useState(true)
  const [q, setQ]                 = useState('')
  const [activeId, setActiveIdState] = useState<string | null>(searchParams.get('customer'))
  const [detail, setDetail]       = useState<any>(null)
  const [detailLoading, setDetailLoading] = useState(false)

  const setActiveId = (id: string | null) => {
    setActiveIdState(id)
    const next = new URLSearchParams(searchParams)
    if (id) next.set('customer', id); else next.delete('customer')
    setSearchParams(next, { replace: true })
  }

  useEffect(() => {
    const fromUrl = searchParams.get('customer')
    if (fromUrl && fromUrl !== activeId) setActiveIdState(fromUrl)
  }, [searchParams])

  useEffect(() => { (async () => {
    const { data, error } = await supabase
      .from('bp_customers')
      .select('id, customer_code, name, phone, email, address, father_or_husband_name, dob, pan, nominee_name, nominee_relation')
      .order('created_at', { ascending: false })
    if (error) { toast.error(error.message); setLoading(false); return }
    setCustomers(data || []); setLoading(false)
  })() }, [])

  useEffect(() => { if (!activeId) { setDetail(null); return } ; (async () => {
    setDetailLoading(true)
    // Customer + bookings (each booking includes plot+project+payments+emi schedule+instalments)
    const { data: c } = await supabase.from('bp_customers').select('*').eq('id', activeId).maybeSingle()
    const { data: bookings = [] } = await supabase
      .from('bp_bookings')
      .select('*, bp_plots(*), bp_projects(*), brokers(name, broker_id)')
      .eq('customer_id', activeId)
      .order('created_at', { ascending: false })
    // fetch payments + emi for each booking in parallel
    const enriched = await Promise.all((bookings as any[] || []).map(async (b: any) => {
      const [{ data: payments }, { data: scheds }] = await Promise.all([
        supabase.from('bp_payments').select('*').eq('booking_id', b.id).order('payment_date', { ascending: false }),
        supabase.from('emi_schedules').select('*').eq('booking_id', b.id),
      ])
      let instalments: any[] = []
      if (scheds && scheds.length) {
        const { data: ins } = await supabase
          .from('emi_installments').select('*')
          .in('schedule_id', scheds.map((s: any) => s.id))
          .order('seq', { ascending: true })
        instalments = (ins || []).map((i: any) => ({
          ...i,
          computed_status: i.status === 'paid' ? 'paid'
            : new Date(i.due_date) < new Date() ? 'overdue' : 'pending',
        }))
      }
      return { ...b, payments: payments || [], schedule: scheds?.[0] || null, instalments }
    }))
    setDetail({ customer: c, bookings: enriched })
    setDetailLoading(false)
  })() }, [activeId])

  const filtered = useMemo(() => {
    const k = q.toLowerCase()
    return customers.filter(c =>
      `${c.name||''} ${c.customer_code||''} ${c.phone||''} ${c.email||''} ${c.father_or_husband_name||''}`.toLowerCase().includes(k)
    )
  }, [customers, q])

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Customers</h1>
          <p className="text-sm text-gray-500">{customers.length} total · click a row to see token, booking amount, EMI & receipts</p>
        </div>
      </div>

      <div className="grid grid-cols-12 gap-5">
        <div className="col-span-5">
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-3 mb-3">
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
              <input
                value={q} onChange={e => setQ(e.target.value)}
                placeholder="Search by name, code, phone, father…"
                className="w-full pl-8 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
          <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
            {loading ? <div className="p-6 text-sm text-gray-400">Loading…</div>
              : filtered.length === 0 ? <div className="p-6 text-sm text-gray-400">No customers</div>
              : <div className="divide-y divide-gray-50 max-h-[70vh] overflow-y-auto">
                  {filtered.map(c => (
                    <button key={c.id} onClick={() => setActiveId(c.id)} className={`w-full text-left px-4 py-3 hover:bg-gray-50 ${activeId === c.id ? 'bg-blue-50 border-l-2 border-blue-500' : ''}`}>
                      <div className="font-mono text-[11px] text-gray-500">{c.customer_code || '—'}</div>
                      <div className="font-medium text-sm text-gray-900">{c.name}</div>
                      <div className="text-xs text-gray-500">{c.phone}{c.father_or_husband_name ? ` · S/o ${c.father_or_husband_name}` : ''}</div>
                    </button>
                  ))}
                </div>}
          </div>
        </div>

        <div className="col-span-7">
          {!activeId ? (
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm h-48 flex items-center justify-center text-sm text-gray-400">
              <User size={16} className="mr-2"/>Select a customer to view their full ledger
            </div>
          ) : detailLoading || !detail ? (
            <div className="bg-white rounded-xl border border-gray-100 shadow-sm h-48 flex items-center justify-center text-sm text-gray-400">Loading…</div>
          ) : <CustomerProfile data={detail}/>}
        </div>
      </div>
    </div>
  )
}

export function CustomerProfile({ data }: { data: any }) {
  const { customer: c, bookings } = data
  const totalCost  = bookings.reduce((s: number, b: any) => s + Number(b.total_amount || 0), 0)
  const totalPaid  = bookings.reduce((s: number, b: any) => s + b.payments.filter((p:any) => p.verification_status === 'verified').reduce((ps: number, p:any) => ps + Number(p.amount || 0), 0), 0)
  const outstanding = Math.max(0, totalCost - totalPaid)
  const overdueCount = bookings.reduce((s: number, b: any) => s + b.instalments.filter((i:any) => i.computed_status === 'overdue').length, 0)

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
        <div className="flex items-start justify-between">
          <div>
            <div className="font-mono text-[11px] text-gray-500">{c.customer_code}</div>
            <h2 className="text-lg font-bold text-gray-900">{c.name}</h2>
            <div className="text-xs text-gray-500 mt-0.5">{c.phone} · {c.email || '—'}</div>
          </div>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mt-4 text-sm">
          <Field label="S/o, W/o, D/o" value={c.father_or_husband_name}/>
          <Field label="Date of Birth" value={c.dob}/>
          <Field label="PAN"           value={c.pan}/>
          <Field label="Address"       value={c.address} className="col-span-2 md:col-span-3"/>
        </div>
        {c.nominee_name && (
          <div className="mt-3 pt-3 border-t border-gray-100">
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Nominee</div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3 text-sm">
              <Field label="Name"     value={c.nominee_name}/>
              <Field label="Relation" value={c.nominee_relation}/>
              <Field label="DOB"      value={c.nominee_dob}/>
              <Field label="PAN"      value={c.nominee_pan}/>
              <Field label="Address"  value={c.nominee_address} className="col-span-2 md:col-span-3"/>
            </div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Stat icon={<FileText size={14}/>}      label="Bookings"    value={String(bookings.length)} />
        <Stat icon={<Wallet size={14}/>}        label="Total Cost"  value={formatINR(totalCost)} />
        <Stat icon={<CalendarDays size={14}/>}  label="Paid"        value={formatINR(totalPaid)} color="text-green-700" />
        <Stat icon={<AlertTriangle size={14}/>} label={overdueCount ? `Overdue (${overdueCount})` : 'Outstanding'} value={formatINR(outstanding)} color={overdueCount ? 'text-red-700' : 'text-amber-700'} />
      </div>

      {bookings.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6 text-sm text-gray-400 text-center">No bookings yet for this customer.</div>
      ) : bookings.map((b: any) => (
        <div key={b.id} className="bg-white rounded-xl border border-gray-100 shadow-sm p-5">
          <div className="flex items-start justify-between mb-3">
            <div>
              <div className="font-mono text-[11px] text-blue-700 font-semibold">{b.booking_no}</div>
              <div className="text-sm font-semibold">{b.scheme_name || b.bp_projects?.name || '—'}</div>
              <div className="text-xs text-gray-500">Plot {b.bp_plots?.plot_no || '—'} · {b.bp_plots?.size_sqyd || '—'} sq</div>
            </div>
            <div className="text-right">
              <div className="text-sm font-bold text-green-700">{formatINR(b.total_amount)}</div>
              <div className="text-[11px] text-gray-500">Booking amt: {formatINR(b.booking_amount)}</div>
              <div className="text-[11px] text-gray-500 capitalize">Stage: {b.stage?.replace(/_/g,' ')}</div>
            </div>
          </div>

          {b.brokers?.name && <div className="text-xs text-gray-500 mb-3">Upline: <b>{b.brokers.name}</b> [{b.brokers.broker_id || b.upline_broker_code || '—'}]</div>}

          {/* Payments */}
          <div className="mt-2">
            <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">Receipts ({b.payments.length})</div>
            {b.payments.length === 0 ? <div className="text-xs text-gray-400">No receipts yet</div> : (
              <table className="w-full text-xs">
                <thead className="text-gray-400"><tr><th className="text-left py-1">Receipt</th><th className="text-left">Type</th><th className="text-left">Mode</th><th className="text-right">Amount</th><th className="text-right">Date</th><th></th></tr></thead>
                <tbody className="divide-y divide-gray-50">
                  {b.payments.map((p: any) => (
                    <tr key={p.id} className={p.verification_status === 'verified' ? '' : 'opacity-60'}>
                      <td className="py-1 font-mono text-red-700 font-semibold">{p.receipt_no || '—'}</td>
                      <td className="capitalize">{p.payment_type?.replace(/_/g,' ')}{p.instalment_no ? ` · inst ${p.instalment_no}` : ''}</td>
                      <td className="uppercase">{p.is_cash_adjustment ? 'Cash adj' : p.payment_mode}</td>
                      <td className="text-right font-semibold text-green-700">{formatINR(p.amount)}</td>
                      <td className="text-right text-gray-500">{formatDate(p.payment_date)}</td>
                      <td className="text-right"><button onClick={() => printPaymentReceipt(p, { customer: c, booking: b, project: b.bp_projects, plot: b.bp_plots })} className="text-blue-600 hover:underline inline-flex items-center gap-0.5"><Printer size={11}/>Print</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {/* EMI */}
          {b.schedule && (
            <div className="mt-4 pt-3 border-t border-gray-100">
              <div className="flex items-center justify-between mb-2">
                <div className="text-xs font-semibold text-gray-500 uppercase tracking-wide">EMI Schedule · {b.schedule.frequency} · {b.schedule.num_installments} inst.</div>
                <div className="text-xs text-gray-500">Principal: <b>{formatINR(b.schedule.principal)}</b></div>
              </div>
              <table className="w-full text-xs">
                <thead className="text-gray-400"><tr><th className="text-left py-1">#</th><th className="text-left">Due</th><th className="text-right">Amount</th><th className="text-left">Status</th><th className="text-right">Paid On</th></tr></thead>
                <tbody className="divide-y divide-gray-50">
                  {b.instalments.map((i: any) => (
                    <tr key={i.id} className={i.computed_status === 'paid' ? 'opacity-60' : ''}>
                      <td className="py-1 text-gray-400">{i.seq}</td>
                      <td className={i.computed_status === 'overdue' ? 'text-red-600 font-semibold' : ''}>{formatDate(i.due_date)}</td>
                      <td className="text-right font-semibold">{formatINR(i.amount)}</td>
                      <td><span className={`text-[10px] px-1.5 py-0.5 rounded-full capitalize ${
                        i.computed_status === 'paid' ? 'bg-green-100 text-green-700' :
                        i.computed_status === 'overdue' ? 'bg-red-100 text-red-700' :
                        'bg-yellow-100 text-yellow-700'}`}>{i.computed_status}</span></td>
                      <td className="text-right text-gray-500">{i.paid_at ? formatDate(i.paid_at) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

function Field({ label, value, className = '' }: any) {
  return <div className={className}><div className="text-[11px] text-gray-400 uppercase tracking-wide">{label}</div><div className="text-gray-900">{value || '—'}</div></div>
}
function Stat({ icon, label, value, color = 'text-gray-900' }: any) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-3 shadow-sm">
      <div className="flex items-center gap-1.5 text-gray-400 text-xs mb-0.5">{icon}{label}</div>
      <div className={`font-semibold text-sm ${color}`}>{value}</div>
    </div>
  )
}
