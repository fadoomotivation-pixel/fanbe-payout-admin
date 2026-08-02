import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '@/lib/supabase'
import toast from 'react-hot-toast'
import { computeWithdrawal, loadPayoutConfig, loadBrokerWallets, type PayoutConfig, type BrokerWallet } from '@/lib/payoutEngine'
import { formatINR } from '@/lib/utils'
import { findUtrConflict, utrConflictMessage } from '@/lib/utr'
import { logClosure, getCurrentUserId } from '@/lib/closure'
import { ClosureDialog } from '@/components/ClosureDialog'
import { Lock, Unlock, Plus, Search, Wallet, Banknote, Send, AlertCircle, X, HelpCircle, CheckCircle2, ArrowRight } from 'lucide-react'

type Row = {
  id: string
  broker_id: string
  amount: number
  net_amount: number
  status: string
  bank_name: string | null
  account_no: string | null
  ifsc: string | null
  account_holder: string | null
  created_at: string
  utr: string | null
  closed_at: string | null
  rejection_reason: string | null
  paid_at: string | null
}

type Broker = {
  id: string; name: string; broker_id: string; phone: string | null
  bank_name: string | null; account_no: string | null; ifsc: string | null; account_holder: string | null
  kyc_status: string | null; tds_applicable: boolean | null
}

export default function Withdrawals() {
  const [rows, setRows] = useState<Row[]>([])
  const [brokers, setBrokers] = useState<Broker[]>([])
  const [walletByBroker, setWalletByBroker] = useState<Record<string, BrokerWallet>>({})
  const [cfg, setCfg]   = useState<PayoutConfig | null>(null)
  const [closureFor, setClosureFor] = useState<{ row: Row; action: 'close' | 'reopen' } | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [filter, setFilter] = useState<'all'|'pending'|'approved'|'paid'|'rejected'|'closed'>('all')
  const [search, setSearch] = useState('')
  const [showHelp, setShowHelp] = useState(false)

  // ── Create-new modal ──
  const [createOpen, setCreateOpen] = useState(false)
  const [createBrokerId, setCreateBrokerId] = useState('')
  const [createAmount, setCreateAmount] = useState('')
  const [createNotes, setCreateNotes] = useState('')
  const [overrideBank, setOverrideBank] = useState(false)
  const [bankOverride, setBankOverride] = useState({ bank_name: '', account_no: '', ifsc: '', account_holder: '' })
  const [creating, setCreating] = useState(false)
  const [brokerSearch, setBrokerSearch] = useState('')

  const brokerLookup = useMemo(() => {
    const m: Record<string, Broker> = {}; for (const b of brokers) m[b.id] = b; return m
  }, [brokers])

  const load = async () => {
    const [{ data: w, error: e1 }, { data: bs }] = await Promise.all([
      supabase.from('withdrawal_requests').select('*').order('created_at', { ascending: false }).limit(300),
      supabase.from('brokers').select('id, name, broker_id, phone, bank_name, account_no, ifsc, account_holder, kyc_status, tds_applicable').order('name'),
    ])
    if (e1) toast.error(e1.message); else setRows((w || []) as Row[])
    setBrokers((bs || []) as Broker[])

    // Shared wallet helper — sums BOTH withdrawal_requests and bp_payout_transactions so the
    // "available" figure here matches the /payouts page and the broker's own dashboard exactly.
    setWalletByBroker(await loadBrokerWallets())
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
          status: 'closed', closed_at: new Date().toISOString(), closed_by: userId,
          closure_notes: reason || null, reopened_at: null, reopened_by: null, reopen_reason: null,
        }).eq('id', closureFor.row.id)
        if (error) throw error
        await logClosure({ entityType: 'withdrawal', entityId: closureFor.row.id, action: 'closed', reason, metadata: { net_amount: closureFor.row.net_amount, utr: closureFor.row.utr } })
        toast.success('Withdrawal closed')
      } else {
        if (!reason) throw new Error('Reopen reason is required')
        const { error } = await supabase.from('withdrawal_requests').update({
          status: 'paid', closed_at: null, reopened_at: new Date().toISOString(), reopened_by: userId, reopen_reason: reason,
        }).eq('id', closureFor.row.id)
        if (error) throw error
        await logClosure({ entityType: 'withdrawal', entityId: closureFor.row.id, action: 'reopened', reason })
        toast.success('Withdrawal reopened')
      }
      setClosureFor(null); load()
    } catch (e: any) { toast.error(e.message) }
    finally { setSubmitting(false) }
  }

  // ── New withdrawal (admin creates on behalf of broker) ──
  const openCreate = () => {
    setCreateOpen(true); setCreateBrokerId(''); setCreateAmount(''); setCreateNotes('')
    setOverrideBank(false); setBankOverride({ bank_name: '', account_no: '', ifsc: '', account_holder: '' })
  }
  const selectedBroker = createBrokerId ? brokerLookup[createBrokerId] : null
  const wallet = selectedBroker ? walletByBroker[selectedBroker.id] || { earned: 0, paid: 0, pending: 0, advance: 0, available: 0 } : null
  const available = wallet?.available ?? 0
  const computeForCreate = useMemo(() => {
    if (!cfg) return null
    const amt = parseFloat(createAmount) || 0
    if (amt <= 0) return null
    return computeWithdrawal(amt, cfg)
  }, [createAmount, cfg])

  const submitCreate = async () => {
    if (!selectedBroker) return toast.error('Select a broker')
    const amount = parseFloat(createAmount) || 0
    if (amount <= 0) return toast.error('Enter amount')
    if (cfg && amount < cfg.min_withdrawal) return toast.error(`Min withdrawal is ₹${cfg.min_withdrawal}`)
    if (amount > available) return toast.error(`Amount exceeds available balance (₹${available.toLocaleString()})`)
    const bank = overrideBank ? bankOverride : {
      bank_name: selectedBroker.bank_name || '', account_no: selectedBroker.account_no || '',
      ifsc: selectedBroker.ifsc || '', account_holder: selectedBroker.account_holder || selectedBroker.name,
    }
    if (!bank.bank_name || !bank.account_no) return toast.error('Bank details are missing — fill them or pick another broker')

    setCreating(true)
    const net = computeForCreate ? computeForCreate.net : amount
    const adminPct = cfg?.admin_charge_pct || 0
    const tdsPct = selectedBroker.tds_applicable ? (cfg?.tds_pct || 0) : 0
    const userId = await getCurrentUserId()
    const { error } = await supabase.from('withdrawal_requests').insert({
      broker_id: selectedBroker.id,
      amount,
      admin_charge_pct: adminPct,
      tds_pct: tdsPct,
      net_amount: Math.round(net),
      bank_name: bank.bank_name,
      account_no: bank.account_no,
      ifsc: bank.ifsc,
      account_holder: bank.account_holder || selectedBroker.name,
      status: 'pending',
      rejection_reason: createNotes ? `Admin note: ${createNotes}` : null,
      approved_by: userId,
    })
    setCreating(false)
    if (error) return toast.error(error.message)
    toast.success('Withdrawal request created')
    setCreateOpen(false); load()
  }

  // Status labels rewritten in plain English — "Pending" stays, but "approved" reads as
  // "OK to pay", "paid" as "Money sent", "closed" as "Locked".  Matches the 4-step
  // pipeline shown above the table.
  const statusPill = (s: string) => {
    const cfgMap: Record<string, { label: string; cls: string }> = {
      pending:  { label: 'Awaiting decision', cls: 'bg-amber-100 text-amber-700' },
      approved: { label: "OK to pay",         cls: 'bg-emerald-100 text-emerald-700' },
      paid:     { label: 'Money sent',         cls: 'bg-blue-100 text-blue-700' },
      closed:   { label: 'Locked',             cls: 'bg-slate-200 text-slate-800' },
      rejected: { label: 'Rejected',           cls: 'bg-rose-100 text-rose-700' },
    }
    const c = cfgMap[s] || { label: s, cls: 'bg-amber-100 text-amber-700' }
    return <span className={`text-xs px-2 py-1 rounded-full font-medium ${c.cls}`}>{c.label}</span>
  }

  // Stats + filter
  const stats = useMemo(() => {
    const pending  = rows.filter(r => r.status === 'pending').length
    const approved = rows.filter(r => r.status === 'approved').length
    const paid     = rows.filter(r => r.status === 'paid').length
    const closed   = rows.filter(r => !!r.closed_at).length
    const totalPaid = rows.filter(r => r.status === 'paid' || r.status === 'closed').reduce((s, r) => s + Number(r.net_amount || r.amount || 0), 0)
    return { pending, approved, paid, closed, totalPaid }
  }, [rows])

  const filtered = useMemo(() => {
    let arr = rows
    if (filter === 'closed') arr = arr.filter(r => !!r.closed_at)
    else if (filter !== 'all') arr = arr.filter(r => r.status === filter && !r.closed_at)
    const q = search.trim().toLowerCase()
    if (q) arr = arr.filter(r => {
      const b = brokerLookup[r.broker_id]
      const hay = `${b?.name || ''} ${b?.broker_id || ''} ${r.utr || ''} ${r.bank_name || ''} ${r.account_no || ''}`.toLowerCase()
      return hay.includes(q)
    })
    return arr
  }, [rows, filter, search, brokerLookup])

  const filteredBrokersForPicker = useMemo(() => {
    const q = brokerSearch.trim().toLowerCase()
    if (!q) return brokers.slice(0, 50)
    return brokers.filter(b =>
      (b.name || '').toLowerCase().includes(q) ||
      (b.broker_id || '').toLowerCase().includes(q) ||
      (b.phone || '').toLowerCase().includes(q)
    ).slice(0, 50)
  }, [brokers, brokerSearch])

  return (
    <div className="p-3 md:p-6 space-y-4">
      <Link to="/payouts" className="text-xs text-gray-500 hover:text-gray-900 inline-flex items-center gap-1">
        ← Back to Pay brokers
      </Link>
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-semibold">Withdrawals</h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Money out to brokers in 3 steps · {cfg ? `Admin ${cfg.admin_charge_pct}% · TDS ${cfg.tds_pct}% · Min ₹${cfg.min_withdrawal}` : ''}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowHelp(!showHelp)} className="inline-flex items-center gap-1 px-3 py-2 text-xs rounded-lg border border-gray-200 hover:bg-gray-50 text-gray-700">
            <HelpCircle size={13}/>How it works
          </button>
          <button onClick={openCreate} className="inline-flex items-center gap-1.5 px-3 py-2 text-sm rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 font-semibold">
            <Plus size={14}/>New withdrawal
          </button>
        </div>
      </div>

      {/* "How it works" — collapsible explainer.  Admin can re-open any time from the
          help button above.  The whole reason this page is being redesigned is that the
          previous version showed 5 statuses + 4 button shapes with no story.  Now there
          is a story: 3 steps + an optional 4th lock for audit. */}
      {showHelp && (
        <div className="bg-gradient-to-br from-indigo-50 to-blue-50 border border-indigo-200 rounded-xl p-4">
          <div className="flex items-start justify-between mb-3">
            <h3 className="text-sm font-semibold text-indigo-900 inline-flex items-center gap-1.5">
              <HelpCircle size={14}/>How a withdrawal flows
            </h3>
            <button onClick={() => setShowHelp(false)} className="text-indigo-400 hover:text-indigo-700"><X size={14}/></button>
          </div>
          <ol className="space-y-2 text-sm text-gray-800">
            <li className="flex items-start gap-2"><span className="shrink-0 w-5 h-5 rounded-full bg-amber-500 text-white text-[11px] font-bold flex items-center justify-center">1</span><div><b>Broker requests</b> — appears here as <i>Pending</i>. Check the broker's bank details and the requested amount.</div></li>
            <li className="flex items-start gap-2"><span className="shrink-0 w-5 h-5 rounded-full bg-emerald-500 text-white text-[11px] font-bold flex items-center justify-center">2</span><div><b>You approve</b> — moves to <i>Approved</i>. The money isn't out yet, this just says "I've decided to pay it".</div></li>
            <li className="flex items-start gap-2"><span className="shrink-0 w-5 h-5 rounded-full bg-blue-500 text-white text-[11px] font-bold flex items-center justify-center">3</span><div><b>You send the money</b> via NEFT/IMPS, then record the bank's UTR here. Moves to <i>Money sent</i>.</div></li>
            <li className="flex items-start gap-2"><span className="shrink-0 w-5 h-5 rounded-full bg-slate-500 text-white text-[11px] font-bold flex items-center justify-center">4</span><div><b>Lock (optional)</b> — once you've verified the bank statement matches, lock the record. After lock, no edits without an admin reopen. Use this for closed accounting periods.</div></li>
          </ol>
          <p className="mt-3 text-[11px] text-indigo-700">Most withdrawals only need steps 1–3. Locking (step 4) is for end-of-month audit only.</p>
        </div>
      )}

      {/* 4-step pipeline — tap any step to filter the list.  Replaces the old row of 5
          equally-weighted stat tiles, which gave no sense of direction.  Arrows make the
          progression read left-to-right; the current filter highlights its tile. */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-3 overflow-x-auto">
        <div className="flex items-stretch gap-2 min-w-fit">
          <PipeStep step={1} label="Awaiting decision" sub="Broker requested" count={stats.pending} tone="amber" active={filter === 'pending'} onClick={() => setFilter('pending')}/>
          <PipeArrow/>
          <PipeStep step={2} label="OK'd to pay"        sub="Send money next"  count={stats.approved} tone="emerald" active={filter === 'approved'} onClick={() => setFilter('approved')}/>
          <PipeArrow/>
          <PipeStep step={3} label="Money sent"          sub={`Total ${formatINR(stats.totalPaid)}`} count={stats.paid} tone="blue" active={filter === 'paid'} onClick={() => setFilter('paid')}/>
          <PipeArrow/>
          <PipeStep step={4} label="Locked"              sub="Audit complete" count={stats.closed} tone="slate" active={filter === 'closed'} onClick={() => setFilter('closed')}/>
          <button
            onClick={() => setFilter('all')}
            className={`shrink-0 px-3 py-2 rounded-lg text-xs font-medium ${filter === 'all' ? 'bg-gray-900 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
            title="Show everything"
          >
            All<br/><span className="text-[10px] opacity-70">({rows.length})</span>
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-3">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"/>
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search broker, code, UTR, bank, account..."
            className="w-full pl-8 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-300"/>
        </div>
      </div>

      {/* Table */}
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
            {filtered.map(r => {
              const calc = cfg ? computeWithdrawal(Number(r.amount), cfg) : null
              const locked = !!r.closed_at
              const b = brokerLookup[r.broker_id]
              return (
                <tr key={r.id} className={`border-t ${locked ? 'bg-slate-50/60' : ''}`}>
                  <td className="p-3 whitespace-nowrap">{new Date(r.created_at).toLocaleDateString('en-IN')}</td>
                  <td className="p-3">
                    <div className="font-medium text-gray-900">{b?.name || '—'}</div>
                    <div className="text-[10px] text-gray-400 font-mono">[{b?.broker_id || r.broker_id.slice(0,8)}]</div>
                  </td>
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
                  <td className="p-3 whitespace-nowrap">
                    {/* One primary "next step" button per status, in plain English so admin
                        knows exactly what'll happen on tap.  Secondary actions (Reject,
                        Unlock) get a smaller treatment so they don't compete with the
                        primary CTA. */}
                    {!locked && r.status === 'pending' && (
                      <div className="flex items-center gap-1">
                        <button onClick={() => act(r.id, 'approved')} className="text-xs bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-1.5 rounded font-semibold inline-flex items-center gap-1">
                          <CheckCircle2 size={11}/>OK to pay
                        </button>
                        <button onClick={() => act(r.id, 'rejected', { rejection_reason: prompt('Reason for rejection?') || '' })} className="text-xs text-rose-700 hover:bg-rose-50 px-2 py-1.5 rounded">
                          Reject
                        </button>
                      </div>
                    )}
                    {!locked && r.status === 'approved' && (
                      <button
                        onClick={async () => {
                          // KYC gate — a broker whose KYC isn't approved cannot be paid out, full stop.
                          const b = brokerLookup[r.broker_id]
                          if (b && b.kyc_status !== 'approved') {
                            toast.error(`KYC ${b.kyc_status || 'pending'} for ${b.name} — approve KYC before paying out.`)
                            return
                          }
                          const utr = prompt(`Enter UTR / reference number from your bank for ₹${Number(r.net_amount).toLocaleString('en-IN')} payment to ${b?.name || 'this broker'}:`)
                          if (!utr) return
                          // UTR must be globally unique — see src/lib/utr.ts.
                          const conflict = await findUtrConflict(utr, { withdrawal: r.id })
                          if (conflict) { toast.error(utrConflictMessage(conflict)); return }
                          act(r.id, 'paid', { utr: utr.trim(), paid_at: new Date().toISOString() })
                        }}
                        className="text-xs bg-blue-600 hover:bg-blue-700 text-white px-3 py-1.5 rounded font-semibold inline-flex items-center gap-1"
                        title="You send the money via NEFT/IMPS and record the bank's UTR here"
                      >
                        <Send size={11}/>Send money & record UTR
                      </button>
                    )}
                    {!locked && r.status === 'paid' && (
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setClosureFor({ row: r, action: 'close' })}
                          className="text-xs bg-slate-800 hover:bg-slate-900 text-white px-3 py-1.5 rounded font-semibold inline-flex items-center gap-1"
                          title="Lock this record so it can't be edited — use once you've reconciled the bank statement"
                        >
                          <Lock size={11}/>Lock for audit
                        </button>
                        <span className="text-[10px] text-gray-400">Optional</span>
                      </div>
                    )}
                    {locked && (
                      <button onClick={() => setClosureFor({ row: r, action: 'reopen' })} className="text-xs text-slate-600 hover:bg-slate-100 px-2 py-1 rounded inline-flex items-center gap-1">
                        <Unlock size={11}/>Unlock
                      </button>
                    )}
                    {r.utr && <div className="text-[10px] text-slate-500 mt-1 font-mono">UTR {r.utr}</div>}
                  </td>
                </tr>
              )
            })}
            {filtered.length === 0 && (
              <tr><td colSpan={7} className="p-8 text-center text-sm text-slate-400">No withdrawal requests in this view.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <ClosureDialog
        open={!!closureFor}
        action={closureFor?.action === 'reopen' ? 'reopen' : 'close'}
        entityLabel={`withdrawal of ₹${closureFor ? Number(closureFor.row.net_amount).toLocaleString() : ''}`}
        description={closureFor?.action === 'close'
          ? "Lock this record after you've checked your bank statement and the payment matches. After locking, no one can edit the amount, UTR or status without an admin unlock. Use this once a month at audit time — it's NOT required to call the payment done."
          : "Unlock so the record can be edited again. The reason will appear in the audit log."}
        reasonRequired={closureFor?.action === 'reopen'}
        onClose={() => setClosureFor(null)}
        onConfirm={handleClosure}
        submitting={submitting}
      />

      {/* ── New withdrawal modal ────────────────────────────────────── */}
      {createOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 px-4" onClick={() => setCreateOpen(false)}>
          <div onClick={e => e.stopPropagation()} className="bg-white rounded-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
            <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
              <div>
                <h3 className="text-lg font-bold text-gray-900">New withdrawal request</h3>
                <p className="text-xs text-gray-500">Create on behalf of a broker (e.g. offline broker or admin override)</p>
              </div>
              <button onClick={() => setCreateOpen(false)} className="text-gray-400 hover:text-gray-700"><X size={18}/></button>
            </div>

            <div className="p-5 space-y-4">
              {/* Step 1: pick broker */}
              <div>
                <label className="text-xs font-semibold text-gray-700 mb-1 block">1. Broker</label>
                {!selectedBroker ? (
                  <>
                    <div className="relative mb-2">
                      <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"/>
                      <input value={brokerSearch} onChange={e => setBrokerSearch(e.target.value)} placeholder="Search name, code, phone..."
                        className="w-full pl-8 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-300"/>
                    </div>
                    <div className="border border-gray-200 rounded-lg max-h-48 overflow-y-auto divide-y divide-gray-50">
                      {filteredBrokersForPicker.length === 0 && <div className="p-3 text-xs text-gray-400">No brokers match.</div>}
                      {filteredBrokersForPicker.map(b => {
                        const w = walletByBroker[b.id] || { earned: 0, paid: 0, pending: 0, advance: 0, available: 0 }
                        const avail = Math.max(0, w.earned - w.paid - w.pending)
                        return (
                          <button key={b.id} onClick={() => setCreateBrokerId(b.id)} className="w-full px-3 py-2 text-left hover:bg-emerald-50/60 flex items-center justify-between">
                            <div>
                              <div className="text-sm font-medium text-gray-900">{b.name}</div>
                              <div className="text-[10px] font-mono text-gray-500">[{b.broker_id}] · {b.phone || '—'}{b.kyc_status !== 'approved' ? ` · KYC ${b.kyc_status || 'pending'}` : ''}</div>
                            </div>
                            <div className="text-right">
                              <div className="text-xs font-semibold text-emerald-700">₹{avail.toLocaleString()}</div>
                              <div className="text-[10px] text-gray-400">available</div>
                            </div>
                          </button>
                        )
                      })}
                    </div>
                  </>
                ) : (
                  <div className="rounded-lg border border-emerald-200 bg-emerald-50/40 p-3 flex items-start justify-between">
                    <div>
                      <div className="text-sm font-semibold text-gray-900">{selectedBroker.name}</div>
                      <div className="text-[10px] font-mono text-gray-500">[{selectedBroker.broker_id}] · {selectedBroker.phone || '—'}</div>
                      {selectedBroker.kyc_status !== 'approved' && (
                        <div className="text-[11px] text-amber-800 mt-1 inline-flex items-center gap-1"><AlertCircle size={11}/>KYC {selectedBroker.kyc_status || 'pending'} — payout will hold until approved</div>
                      )}
                    </div>
                    <button onClick={() => setCreateBrokerId('')} className="text-xs text-emerald-700 hover:underline">Change</button>
                  </div>
                )}
              </div>

              {/* Wallet snapshot */}
              {selectedBroker && wallet && (
                <div className={`grid gap-2 ${wallet.advance > 0 ? 'grid-cols-4' : 'grid-cols-3'}`}>
                  <Mini label="Earned"   value={`₹${wallet.earned.toLocaleString()}`} accent="text-emerald-700"/>
                  <Mini label="Paid out" value={`₹${wallet.paid.toLocaleString()}`}   accent="text-rose-700"/>
                  {wallet.advance > 0 && <Mini label="Advance" value={`₹${wallet.advance.toLocaleString()}`} accent="text-amber-700"/>}
                  <Mini label="Available" value={`₹${available.toLocaleString()}`}    accent="text-indigo-700" highlight/>
                </div>
              )}

              {/* Step 2: amount */}
              {selectedBroker && (
                <div>
                  <label className="text-xs font-semibold text-gray-700 mb-1 block">2. Amount (₹)</label>
                  <input type="number" value={createAmount} onChange={e => setCreateAmount(e.target.value)} max={available} placeholder="0"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-300"/>
                  {computeForCreate && (
                    <div className="mt-2 text-xs space-y-1 text-gray-600 bg-gray-50 rounded-lg p-3">
                      <div className="flex justify-between"><span>Gross</span><b>₹{computeForCreate.gross.toLocaleString()}</b></div>
                      <div className="flex justify-between"><span>Admin charge ({cfg?.admin_charge_pct}%)</span><b className="text-amber-700">−₹{computeForCreate.admin.toLocaleString()}</b></div>
                      <div className="flex justify-between"><span>TDS ({selectedBroker.tds_applicable ? cfg?.tds_pct : 0}%)</span><b className="text-rose-700">−₹{(selectedBroker.tds_applicable ? computeForCreate.tds : 0).toLocaleString()}</b></div>
                      <div className="flex justify-between pt-1 border-t border-gray-200"><span>Broker will receive</span><b className="text-emerald-700">₹{computeForCreate.net.toLocaleString()}</b></div>
                    </div>
                  )}
                </div>
              )}

              {/* Step 3: bank */}
              {selectedBroker && (
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-semibold text-gray-700">3. Pay to</label>
                    <label className="text-[11px] text-gray-500 flex items-center gap-1">
                      <input type="checkbox" checked={overrideBank} onChange={e => setOverrideBank(e.target.checked)}/>
                      Override bank details
                    </label>
                  </div>
                  {!overrideBank ? (
                    selectedBroker.bank_name ? (
                      <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2 text-xs">
                        <div className="font-medium text-gray-800">{selectedBroker.bank_name}</div>
                        <div className="text-gray-500">A/c {selectedBroker.account_no} · IFSC {selectedBroker.ifsc} · {selectedBroker.account_holder || selectedBroker.name}</div>
                      </div>
                    ) : (
                      <div className="rounded-lg border border-rose-200 bg-rose-50 text-rose-800 px-3 py-2 text-xs flex items-start gap-2">
                        <AlertCircle size={12} className="mt-0.5"/>No bank details on file. Toggle "Override bank details" to enter them now.
                      </div>
                    )
                  ) : (
                    <div className="grid grid-cols-2 gap-2">
                      <input value={bankOverride.bank_name} onChange={e => setBankOverride(p => ({ ...p, bank_name: e.target.value }))} placeholder="Bank name" className={fld}/>
                      <input value={bankOverride.account_holder} onChange={e => setBankOverride(p => ({ ...p, account_holder: e.target.value }))} placeholder="Account holder" className={fld}/>
                      <input value={bankOverride.account_no} onChange={e => setBankOverride(p => ({ ...p, account_no: e.target.value }))} placeholder="Account no" className={fld}/>
                      <input value={bankOverride.ifsc} onChange={e => setBankOverride(p => ({ ...p, ifsc: e.target.value.toUpperCase() }))} placeholder="IFSC" className={fld}/>
                    </div>
                  )}
                </div>
              )}

              {/* Notes */}
              {selectedBroker && (
                <div>
                  <label className="text-xs font-semibold text-gray-700 mb-1 block">Internal note (optional)</label>
                  <textarea value={createNotes} onChange={e => setCreateNotes(e.target.value)} rows={2} placeholder="e.g. broker requested via call"
                    className={`${fld} resize-none`}/>
                </div>
              )}
            </div>

            <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-end gap-2">
              <button onClick={() => setCreateOpen(false)} className="px-3 py-2 text-sm rounded-lg border border-gray-200 hover:bg-gray-50">Cancel</button>
              <button onClick={submitCreate} disabled={!selectedBroker || creating}
                className="inline-flex items-center gap-1.5 px-4 py-2 text-sm rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-semibold disabled:opacity-50">
                <Send size={14}/>{creating ? 'Creating…' : 'Create request'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

const fld = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-300'

function Mini({ label, value, accent, highlight }: any) {
  return (
    <div className={`rounded-lg border p-2 ${highlight ? 'bg-indigo-50 border-indigo-200' : 'bg-white border-gray-200'}`}>
      <div className="text-[10px] text-gray-500">{label}</div>
      <div className={`text-sm font-bold ${accent}`}>{value}</div>
    </div>
  )
}

// One step in the 4-step withdrawal pipeline at the top of the page.  Doubles as a filter
// toggle — tap to scope the list to that stage.  Colour matches the stage's pill colour
// so admin learns the visual language as they go.
function PipeStep({ step, label, sub, count, tone, active, onClick }: {
  step: number; label: string; sub: string; count: number; tone: 'amber'|'emerald'|'blue'|'slate'; active: boolean; onClick: () => void
}) {
  const tones = {
    amber:   { ring: 'border-amber-300',   bg: 'bg-amber-50',   num: 'bg-amber-500',   text: 'text-amber-900' },
    emerald: { ring: 'border-emerald-300', bg: 'bg-emerald-50', num: 'bg-emerald-500', text: 'text-emerald-900' },
    blue:    { ring: 'border-blue-300',    bg: 'bg-blue-50',    num: 'bg-blue-500',    text: 'text-blue-900' },
    slate:   { ring: 'border-slate-300',   bg: 'bg-slate-100',  num: 'bg-slate-500',   text: 'text-slate-900' },
  } as const
  const t = tones[tone]
  return (
    <button
      onClick={onClick}
      className={`shrink-0 text-left flex items-center gap-2.5 px-3 py-2 rounded-lg border-2 transition ${active ? `${t.ring} ${t.bg}` : 'border-gray-200 bg-white hover:border-gray-300'}`}
    >
      <div className={`w-7 h-7 rounded-full ${t.num} text-white text-xs font-bold flex items-center justify-center shrink-0`}>{step}</div>
      <div>
        <div className="text-[10px] uppercase tracking-wide font-semibold text-gray-500">{sub}</div>
        <div className={`text-xs font-bold ${active ? t.text : 'text-gray-900'}`}>
          {label} <span className="tabular-nums">({count})</span>
        </div>
      </div>
    </button>
  )
}

function PipeArrow() {
  return <ArrowRight size={14} className="self-center text-gray-300 shrink-0"/>
}
