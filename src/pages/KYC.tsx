import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/Button.tsx'
import { Badge } from '@/components/ui/Badge.tsx'
import { Modal } from '@/components/ui/Modal.tsx'
import { Textarea } from '@/components/ui/Input.tsx'
import { formatDate } from '@/lib/utils'
import { Link } from 'react-router-dom'
import { CheckCircle2, XCircle, User, FileText, Eye, Search, ShieldCheck, Clock, Ban, Folder, ChevronRight, ExternalLink } from 'lucide-react'
import toast from 'react-hot-toast'

const BROKER_STATUS_COLORS: Record<string, string> = {
  pending:  'bg-amber-50 text-amber-700 border border-amber-200',
  approved: 'bg-emerald-50 text-emerald-700 border border-emerald-200',
  rejected: 'bg-rose-50 text-rose-700 border border-rose-200',
  re_review:'bg-blue-50 text-blue-700 border border-blue-200',
}

const DOC_LABEL: Record<string, string> = {
  aadhaar: 'Aadhaar', aadhar: 'Aadhaar', aadhaar_card: 'Aadhaar', aadhar_card: 'Aadhaar',
  pan: 'PAN', pan_card: 'PAN', pan_no: 'PAN',
  bank: 'Bank passbook', bank_passbook: 'Bank passbook', passbook: 'Bank passbook',
  cancelled_cheque: 'Cancelled cheque', cheque: 'Cancelled cheque',
  photo: 'Photo',
  address_proof: 'Address proof',
}

const docName = (d: any) => d.doc_label || DOC_LABEL[d.doc_type] || (d.doc_type || 'Document').replace(/_/g, ' ')

export default function KYC() {
  const qc = useQueryClient()
  const [preview, setPreview] = useState<any>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<'all'|'pending'|'approved'|'rejected'>('all')
  const [rejectFor, setRejectFor] = useState<{ broker: any } | null>(null)
  const [rejectReason, setRejectReason] = useState('')

  const { data: brokers = [], isLoading } = useQuery({
    queryKey: ['kyc_brokers'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('brokers')
        .select('id, name, broker_id, phone, email, pan_no, aadhaar_no, kyc_status, kyc_reviewed_at, kyc_reviewed_by, created_at')
        .order('created_at', { ascending: false })
      if (error) throw error
      return data
    },
  })

  const { data: kycDocs = [] } = useQuery({
    queryKey: ['kyc_docs'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('bp_broker_kyc')
        .select('*')
        .order('created_at', { ascending: false })
      if (error) throw error
      return data
    },
  })

  // Group documents by broker_id
  const docsByBroker = useMemo(() => {
    const m = new Map<string, any[]>()
    for (const d of kycDocs as any[]) {
      const arr = m.get(d.broker_id) || []
      arr.push(d); m.set(d.broker_id, arr)
    }
    return m
  }, [kycDocs])

  // ── Mutations ───────────────────────────────────────────────────
  const setBrokerKyc = useMutation({
    mutationFn: async ({ id, status, reason }: { id: string; status: 'approved'|'rejected'|'pending'|'re_review'; reason?: string }) => {
      const { data: { user } } = await supabase.auth.getUser()
      const patch: any = { kyc_status: status, updated_at: new Date().toISOString() }
      if (status === 'approved' || status === 'rejected') {
        patch.kyc_reviewed_at = new Date().toISOString()
        patch.kyc_reviewed_by = user?.id || null
      }
      const { error } = await supabase.from('brokers').update(patch).eq('id', id)
      if (error) throw error
      if (reason) {
        // Note rejection reason on the most recent doc, if any
        const docs = docsByBroker.get(id) || []
        if (docs[0]) await supabase.from('bp_broker_kyc').update({ notes: reason }).eq('id', docs[0].id)
      }
    },
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ['kyc_brokers'] })
      qc.invalidateQueries({ queryKey: ['kyc_docs'] })
      toast.success(`KYC ${v.status === 'approved' ? 'approved' : v.status === 'rejected' ? 'rejected' : 'updated'}`)
      setRejectFor(null); setRejectReason('')
    },
    onError: (e: any) => toast.error(e.message),
  })

  const toggleDoc = useMutation({
    mutationFn: async ({ id, verified }: { id: string; verified: boolean }) => {
      const { data: { user } } = await supabase.auth.getUser()
      const { error } = await supabase.from('bp_broker_kyc').update({
        verified,
        verified_at: verified ? new Date().toISOString() : null,
        verified_by: verified ? (user?.id || null) : null,
      }).eq('id', id)
      if (error) throw error
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['kyc_docs'] })
      toast.success('Document updated')
    },
    onError: (e: any) => toast.error(e.message),
  })

  // ── Derived stats ───────────────────────────────────────────────
  const stats = useMemo(() => {
    const total = brokers.length
    const pending  = brokers.filter((b: any) => b.kyc_status === 'pending' || !b.kyc_status).length
    const approved = brokers.filter((b: any) => b.kyc_status === 'approved').length
    const rejected = brokers.filter((b: any) => b.kyc_status === 'rejected').length
    const docTotal = kycDocs.length
    const docVerified = (kycDocs as any[]).filter(d => d.verified).length
    return { total, pending, approved, rejected, docTotal, docVerified }
  }, [brokers, kycDocs])

  const filteredBrokers = useMemo(() => {
    let arr = brokers as any[]
    if (filter === 'pending') arr = arr.filter(b => (b.kyc_status || 'pending') === 'pending')
    else if (filter !== 'all') arr = arr.filter(b => b.kyc_status === filter)
    const q = search.trim().toLowerCase()
    if (q) {
      arr = arr.filter(b =>
        (b.name || '').toLowerCase().includes(q) ||
        (b.broker_id || '').toLowerCase().includes(q) ||
        (b.phone || '').toLowerCase().includes(q) ||
        (b.email || '').toLowerCase().includes(q) ||
        (b.pan_no || '').toLowerCase().includes(q)
      )
    }
    return arr
  }, [brokers, filter, search])

  const toggleExpand = (id: string) => setExpanded(prev => {
    const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n
  })

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">KYC Verification</h1>
          <p className="text-sm text-gray-500">Review broker identity, documents, and KYC decisions</p>
        </div>
        <div className="text-xs text-gray-500">
          {stats.docVerified} / {stats.docTotal} documents verified
        </div>
      </div>

      {/* Stat tiles — clickable filters */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
        {[
          { key: 'all',      label: 'Total brokers', value: stats.total,    icon: ShieldCheck, color: 'text-gray-900',     bg: 'bg-white border border-gray-200' },
          { key: 'pending',  label: 'Pending',       value: stats.pending,  icon: Clock,       color: 'text-amber-700',    bg: 'bg-amber-50 border border-amber-200' },
          { key: 'approved', label: 'Approved',      value: stats.approved, icon: CheckCircle2,color: 'text-emerald-700',  bg: 'bg-emerald-50 border border-emerald-200' },
          { key: 'rejected', label: 'Rejected',      value: stats.rejected, icon: Ban,         color: 'text-rose-700',     bg: 'bg-rose-50 border border-rose-200' },
        ].map(s => {
          const active = filter === s.key
          const Ic = s.icon
          return (
            <button key={s.key} onClick={() => setFilter(s.key as any)}
              className={`text-left rounded-xl p-3 transition ${s.bg} ${active ? 'ring-2 ring-indigo-400' : ''}`}>
              <div className="flex items-center justify-between">
                <Ic size={14} className={s.color}/>
                <div className={`text-2xl font-bold ${s.color}`}>{s.value}</div>
              </div>
              <div className="text-xs text-gray-500 mt-0.5">{s.label}</div>
            </button>
          )
        })}
      </div>

      {/* Search bar */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm mb-4 p-3">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"/>
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search broker by name, code, phone, email, PAN..."
            className="w-full pl-8 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-300"
          />
        </div>
      </div>

      {/* Broker list, grouped */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm divide-y divide-gray-100">
        {isLoading && <div className="py-12 text-center text-sm text-gray-400">Loading…</div>}
        {!isLoading && filteredBrokers.length === 0 && (
          <div className="py-12 text-center text-sm text-gray-400">No brokers match the filter.</div>
        )}
        {filteredBrokers.map((b: any) => {
          const docs = docsByBroker.get(b.id) || []
          const verifiedDocs = docs.filter((d: any) => d.verified).length
          const open = expanded.has(b.id)
          const status = b.kyc_status || 'pending'
          return (
            <div key={b.id}>
              <div className="px-4 py-3 flex items-center gap-3 hover:bg-gray-50/60">
                <button onClick={() => toggleExpand(b.id)} className="flex-1 flex items-center gap-3 text-left">
                  <ChevronRight size={14} className={`text-gray-400 transition-transform ${open ? 'rotate-90' : ''}`}/>
                  <div className="w-9 h-9 rounded-full bg-blue-50 flex items-center justify-center shrink-0">
                    <User size={16} className="text-blue-600"/>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-gray-900 truncate">{b.name}</div>
                    <div className="text-xs text-gray-500 truncate">
                      <span className="font-mono">[{b.broker_id}]</span>
                      {b.phone && <span> · {b.phone}</span>}
                      {b.email && <span> · {b.email}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <div className="text-xs text-gray-500">{verifiedDocs}/{docs.length} docs</div>
                    <Badge label={status.replace(/_/g,' ')} className={BROKER_STATUS_COLORS[status] || 'bg-gray-100 text-gray-700'}/>
                  </div>
                </button>
                <div className="flex items-center gap-1 shrink-0">
                  <Link to={`/broker/dashboard?broker_id=${b.id}`} className="px-2 py-1 text-xs rounded-md border border-gray-200 hover:bg-gray-50 inline-flex items-center gap-1">
                    <ExternalLink size={11}/>Portal
                  </Link>
                  {status !== 'approved' && (
                    <Button size="sm" onClick={() => setBrokerKyc.mutate({ id: b.id, status: 'approved' })} loading={setBrokerKyc.isPending}>
                      <CheckCircle2 size={12}/>Approve
                    </Button>
                  )}
                  {status !== 'rejected' && (
                    <Button size="sm" variant="danger" onClick={() => setRejectFor({ broker: b })}>
                      <XCircle size={12}/>Reject
                    </Button>
                  )}
                </div>
              </div>

              {open && (
                <div className="bg-gray-50/60 px-12 py-3 border-t border-gray-100">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs mb-3">
                    <Info label="PAN"        value={b.pan_no || '—'}/>
                    <Info label="Aadhaar"    value={b.aadhaar_no ? `••••${String(b.aadhaar_no).slice(-4)}` : '—'}/>
                    <Info label="Reviewed"   value={b.kyc_reviewed_at ? formatDate(b.kyc_reviewed_at) : '—'}/>
                    <Info label="Joined"     value={formatDate(b.created_at)}/>
                  </div>

                  {docs.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-gray-300 bg-white py-6 text-center text-xs text-gray-400">
                      <Folder size={20} className="mx-auto mb-1 text-gray-300"/>No KYC documents uploaded for this broker yet.
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                      {docs.map((d: any) => (
                        <div key={d.id} className={`bg-white rounded-lg border ${d.verified ? 'border-emerald-200' : 'border-gray-200'} p-3 flex items-start gap-3`}>
                          <div className={`w-9 h-9 rounded-md flex items-center justify-center shrink-0 ${d.verified ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
                            <FileText size={16}/>
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="font-semibold text-sm truncate">{docName(d)}</div>
                            <div className="text-[10px] text-gray-400 truncate">{d.file_name || '—'}</div>
                            <div className="text-[10px] text-gray-400">Uploaded {formatDate(d.created_at)}{d.verified_at ? ` · Verified ${formatDate(d.verified_at)}` : ''}</div>
                            {d.notes && <div className="mt-1 text-[11px] text-rose-700">{d.notes}</div>}
                            <div className="mt-1 flex items-center gap-1">
                              {d.file_url && (
                                <button onClick={() => setPreview(d)} className="text-[11px] px-2 py-0.5 rounded border border-gray-200 text-gray-700 hover:bg-gray-50 inline-flex items-center gap-1">
                                  <Eye size={10}/>View
                                </button>
                              )}
                              {d.verified ? (
                                <button onClick={() => toggleDoc.mutate({ id: d.id, verified: false })} className="text-[11px] px-2 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200 hover:bg-amber-100">Unverify</button>
                              ) : (
                                <button onClick={() => toggleDoc.mutate({ id: d.id, verified: true })} className="text-[11px] px-2 py-0.5 rounded bg-emerald-50 text-emerald-800 border border-emerald-200 hover:bg-emerald-100">Verify</button>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Doc preview modal */}
      <Modal open={!!preview} onClose={() => setPreview(null)} title={preview ? `${docName(preview)} · preview` : ''} size="lg">
        {preview && (
          <div className="space-y-3">
            <div className="text-xs text-gray-500">
              {preview.file_name || preview.file_url} · uploaded {formatDate(preview.created_at)}
            </div>
            {preview.file_url ? (
              /\.(png|jpe?g|gif|webp)$/i.test(preview.file_url) ? (
                <img src={preview.file_url} alt={docName(preview)} className="w-full max-h-[70vh] object-contain rounded-lg border border-gray-200"/>
              ) : (
                <a href={preview.file_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 text-blue-600 hover:underline">
                  <ExternalLink size={14}/>Open file in new tab
                </a>
              )
            ) : (
              <div className="text-sm text-gray-500">No file attached.</div>
            )}
          </div>
        )}
      </Modal>

      {/* Reject KYC modal */}
      <Modal open={!!rejectFor} onClose={() => { setRejectFor(null); setRejectReason('') }} title={`Reject KYC for ${rejectFor?.broker?.name || ''}`} size="sm">
        <div className="rounded-lg bg-rose-50 border border-rose-200 text-rose-900 p-3 text-sm mb-3">
          The broker will stay on hold for payouts until KYC is re-submitted and approved.
        </div>
        <Textarea label="Reason (required)" value={rejectReason} onChange={(e: any) => setRejectReason(e.target.value)} rows={3} placeholder="Why is this KYC being rejected?"/>
        <div className="flex justify-end gap-2 mt-5">
          <Button variant="secondary" onClick={() => { setRejectFor(null); setRejectReason('') }}>Cancel</Button>
          <Button variant="danger" disabled={!rejectReason.trim() || setBrokerKyc.isPending}
            onClick={() => setBrokerKyc.mutate({ id: rejectFor!.broker.id, status: 'rejected', reason: rejectReason })}>
            <XCircle size={14}/>Reject KYC
          </Button>
        </div>
      </Modal>
    </div>
  )
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white rounded-md border border-gray-200 px-2.5 py-1.5">
      <div className="text-[10px] text-gray-500">{label}</div>
      <div className="text-xs font-semibold text-gray-800">{value}</div>
    </div>
  )
}
