import { useEffect, useState } from 'react'
import { supabase } from '@/lib/supabase'
import toast from 'react-hot-toast'
import { computeWithdrawal, loadPayoutConfig, type PayoutConfig } from '@/lib/payoutEngine'
import { logClosure, getCurrentUserId } from '@/lib/closure'
import { ClosureDialog } from '@/components/ClosureDialog'
import { Lock, Unlock } from 'lucide-react'

type Row = {
  id: string
  broker_id: string
  amount: number
  net_amount: number
  status: string
  bank_name: string | null
  account_no: string | null
  created_at: string
  utr: string | null
  closed_at: string | null
}

export default function Withdrawals() {
  const [rows, setRows] = useState<Row[]>([])
  const [cfg, setCfg]   = useState<PayoutConfig | null>(null)
  const [closureFor, setClosureFor] = useState<{ row: Row; action: 'close' | 'reopen' } | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const load = async () => {
    const { data, error } = await supabase
      .from('withdrawal_requests')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(300)
    if (error) toast.error(error.message)
    else setRows((data || []) as Row[])
  }
  useEffect(() => { load(); loadPayoutConfig().then(setCfg) }, [])

  const act = async (id: string, status: string, extra: any = {}) => {
    const { error } = await supabase
      .from('withdrawal_requests')
      .update({ status, approved_at: new Date().toISOString(), ...extra })
      .eq('id', id)
    if (error) toast.error(error.message)
    else { toast.success(status); load() }
  }

  const handleClosure = async (reason: string) => {
    if (!closureFor) return
    setSubmitting(true)
    try {
      const userId = await getCurrentUserId()
      if (closureFor.action === 'close') {
        const { error } = await supabase.from('withdrawal_requests').update({
          status: 'closed',
          closed_at: new Date().toISOString(),
          closed_by: userId,
          closure_notes: reason || null,
          reopened_at: null,
          reopened_by: null,
          reopen_reason: null,
        }).eq('id', closureFor.row.id)
        if (error) throw error
        await logClosure({
          entityType: 'withdrawal',
          entityId: closureFor.row.id,
          action: 'closed',
          reason,
          metadata: { net_amount: closureFor.row.net_amount, utr: closureFor.row.utr },
        })
        toast.success('Withdrawal closed')
      } else {
        if (!reason) throw new Error('Reopen reason is required')
        const { error } = await supabase.from('withdrawal_requests').update({
          status: 'paid',
          closed_at: null,
          reopened_at: new Date().toISOString(),
          reopened_by: userId,
          reopen_reason: reason,
        }).eq('id', closureFor.row.id)
        if (error) throw error
        await logClosure({ entityType: 'withdrawal', entityId: closureFor.row.id, action: 'reopened', reason })
        toast.success('Withdrawal reopened')
      }
      setClosureFor(null)
      load()
    } catch (e: any) {
      toast.error(e.message)
    } finally {
      setSubmitting(false)
    }
  }

  const statusPill = (s: string) => {
    const cls =
      s === 'approved' ? 'bg-emerald-100 text-emerald-700' :
      s === 'rejected' ? 'bg-rose-100 text-rose-700' :
      s === 'paid'     ? 'bg-blue-100 text-blue-700' :
      s === 'closed'   ? 'bg-slate-200 text-slate-800' :
                         'bg-amber-100 text-amber-700'
    return <span className={`text-xs px-2 py-1 rounded-full ${cls}`}>{s}</span>
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold">Withdrawal Requests</h1>
        {cfg && <p className="text-xs text-slate-500">Admin {cfg.admin_charge_pct}% · TDS {cfg.tds_pct}% · Min ₹{cfg.min_withdrawal}</p>}
      </div>
      <div className="bg-white rounded-xl shadow overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-left">
            <tr>
              <th className="p-3">Date</th>
              <th className="p-3">Broker</th>
              <th className="p-3">Bank</th>
              <th className="p-3">Gross</th>
              <th className="p-3">Net</th>
              <th className="p-3">Status</th>
              <th className="p-3">Action</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => {
              const calc = cfg ? computeWithdrawal(Number(r.amount), cfg) : null
              const locked = !!r.closed_at
              return (
                <tr key={r.id} className={`border-t ${locked ? 'bg-slate-50/60' : ''}`}>
                  <td className="p-3">{new Date(r.created_at).toLocaleDateString()}</td>
                  <td className="p-3 font-mono text-xs">{r.broker_id.slice(0, 8)}</td>
                  <td className="p-3">{r.bank_name || '-'}<div className="text-xs text-slate-500">{r.account_no}</div></td>
                  <td className="p-3">₹{Number(r.amount).toLocaleString()}{calc && <div className="text-xs text-slate-500">−{calc.admin}+{calc.tds}</div>}</td>
                  <td className="p-3 font-medium">₹{Number(r.net_amount).toLocaleString()}</td>
                  <td className="p-3">
                    <div className="flex flex-col gap-1">
                      {statusPill(r.status)}
                      {locked && (
                        <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-slate-700 bg-slate-100 border border-slate-200 px-1.5 py-0.5 rounded w-fit">
                          <Lock size={9}/>Closed {new Date(r.closed_at!).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="p-3 space-x-1">
                    {!locked && r.status === 'pending' && (
                      <>
                        <button onClick={() => act(r.id, 'approved')} className="text-xs bg-emerald-600 text-white px-2 py-1 rounded">Approve</button>
                        <button onClick={() => act(r.id, 'rejected', { rejection_reason: prompt('Reason?') || '' })} className="text-xs bg-rose-600 text-white px-2 py-1 rounded">Reject</button>
                      </>
                    )}
                    {!locked && r.status === 'approved' && (
                      <button onClick={() => { const utr = prompt('UTR?'); if (utr) act(r.id, 'paid', { utr, paid_at: new Date().toISOString() }) }} className="text-xs bg-blue-600 text-white px-2 py-1 rounded">Mark Paid</button>
                    )}
                    {!locked && r.status === 'paid' && (
                      <button onClick={() => setClosureFor({ row: r, action: 'close' })} className="text-xs bg-slate-800 text-white px-2 py-1 rounded inline-flex items-center gap-1">
                        <Lock size={11}/>Close
                      </button>
                    )}
                    {locked && (
                      <button onClick={() => setClosureFor({ row: r, action: 'reopen' })} className="text-xs bg-white border border-slate-300 text-slate-700 px-2 py-1 rounded inline-flex items-center gap-1 hover:bg-slate-50">
                        <Unlock size={11}/>Reopen
                      </button>
                    )}
                    {r.utr && <span className="text-xs text-slate-500">UTR {r.utr}</span>}
                  </td>
                </tr>
              )
            })}
            {rows.length === 0 && (
              <tr><td colSpan={7} className="p-8 text-center text-sm text-slate-400">No withdrawal requests yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <ClosureDialog
        open={!!closureFor}
        action={closureFor?.action === 'reopen' ? 'reopen' : 'close'}
        entityLabel={`withdrawal of ₹${closureFor ? Number(closureFor.row.net_amount).toLocaleString() : ''}`}
        description={closureFor?.action === 'close'
          ? 'Closing a paid withdrawal locks the amount against the broker wallet. The broker cannot dispute it without an admin reopen.'
          : undefined}
        reasonRequired={closureFor?.action === 'reopen'}
        onClose={() => setClosureFor(null)}
        onConfirm={handleClosure}
        submitting={submitting}
      />
    </div>
  )
}
