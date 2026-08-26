import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '@/lib/supabase'
import { formatINR, formatDate } from '@/lib/utils'
import { bookingValue, balanceOf, paidByBooking } from '@/lib/bookingMath'
import { waLink } from '@/lib/whatsapp'
import { useCallQueue, useCallHistory, todayISO, type CallTarget } from './useCollection'
import LogCallSheet from './LogCallSheet'
import {
  Phone, MessageCircle, NotebookPen, ChevronLeft, Search as SearchIcon,
  ListChecks, User, History as HistoryIcon, TrendingUp,
} from 'lucide-react'
import './mobile.css'

// The collection app.  One job: ring the people whose EMI is late, and write down what
// they said.  Everything on screen serves that loop — anything that does not is left in
// the admin panel where there is room for it.

type Tab = 'today' | 'search' | 'me'

const daysWord = (n: number) => n === 0 ? 'due today' : n === 1 ? '1 day late' : `${n} days late`

export default function CollectionApp() {
  const [tab, setTab] = useState<Tab>('today')
  const [logFor, setLogFor] = useState<CallTarget | null>(null)
  const [openCustomer, setOpenCustomer] = useState<CallTarget | null>(null)

  return (
    <div className="m-app">
      {openCustomer
        ? <CustomerScreen target={openCustomer} onBack={() => setOpenCustomer(null)} onLog={setLogFor}/>
        : (
          <>
            {tab === 'today'  && <TodayScreen  onLog={setLogFor} onOpen={setOpenCustomer}/>}
            {tab === 'search' && <SearchScreen onOpen={setOpenCustomer}/>}
            {tab === 'me'     && <MeScreen/>}
          </>
        )}

      {!openCustomer && (
        <nav className="m-tabbar">
          {([
            ['today',  'Today',  ListChecks],
            ['search', 'Search', SearchIcon],
            ['me',     'My work', TrendingUp],
          ] as const).map(([key, label, Icon]) => (
            <button key={key} className="m-tab" data-active={tab === key} onClick={() => setTab(key as Tab)}>
              <Icon size={21} strokeWidth={tab === key ? 2.4 : 1.9}/>
              {label}
            </button>
          ))}
        </nav>
      )}

      <LogCallSheet target={logFor} open={!!logFor} onClose={() => setLogFor(null)}/>
    </div>
  )
}

/* ── Today: the call queue ─────────────────────────────────────── */
function TodayScreen({ onLog, onOpen }: { onLog: (t: CallTarget) => void; onOpen: (t: CallTarget) => void }) {
  const { data: queue = [], isLoading } = useCallQueue()
  const [done, setDone] = useState<Set<string>>(new Set())

  const totals = useMemo(() => ({
    people: queue.length,
    money: queue.reduce((s, q) => s + q.overdueAmount, 0),
  }), [queue])

  const remaining = queue.filter(q => !done.has(q.bookingId))

  return (
    <div style={{ padding: '22px 16px 8px' }}>
      <div className="m-title">Today</div>
      <div className="m-sub">
        {isLoading ? 'Loading your list…'
          : totals.people === 0 ? 'Nothing to chase. Enjoy it.'
          : `${remaining.length} of ${totals.people} left · ${formatINR(totals.money)} overdue`}
      </div>

      {/* Progress reads as a job with an end, not an endless list. */}
      {totals.people > 0 && (
        <div style={{ height: 6, borderRadius: 999, background: 'var(--m-line)', margin: '16px 0 20px', overflow: 'hidden' }}>
          <div style={{
            height: '100%', borderRadius: 999, background: 'var(--m-green)',
            width: `${Math.round(((totals.people - remaining.length) / totals.people) * 100)}%`,
            transition: 'width .3s ease',
          }}/>
        </div>
      )}

      {isLoading && <div style={{ padding: 40, textAlign: 'center', color: 'var(--m-ink-3)' }}>Loading…</div>}

      {!isLoading && remaining.length === 0 && totals.people > 0 && (
        <div className="m-card" style={{ padding: 28, textAlign: 'center', marginTop: 8 }}>
          <div style={{ fontSize: 34 }}>✅</div>
          <div style={{ fontWeight: 700, marginTop: 8 }}>All done for today</div>
          <div style={{ fontSize: 13, color: 'var(--m-ink-2)', marginTop: 4 }}>
            Every account on your list has been called.
          </div>
        </div>
      )}

      <div style={{ display: 'grid', gap: 12 }}>
        {remaining.map(t => (
          <CallCard key={t.bookingId} t={t}
            onLog={() => onLog(t)}
            onOpen={() => onOpen(t)}
            onDone={() => setDone(p => new Set(p).add(t.bookingId))}/>
        ))}
      </div>
    </div>
  )
}

function CallCard({ t, onLog, onOpen, onDone }: { t: CallTarget; onLog: () => void; onOpen: () => void; onDone: () => void }) {
  const wa = waLink(t.phone, [
    `Dear ${t.name},`, '',
    `This is a payment reminder from Fanbe Group for booking ${t.bookingNo}.`,
    t.overdueAmount > 0 ? `Overdue amount: ${formatINR(t.overdueAmount)}.` : `Balance due: ${formatINR(t.balance)}.`,
    '', 'Please pay at your earliest. Ignore this message if you have already paid.',
    '', 'Thank you.',
  ].join('\n'))

  return (
    <div className="m-card" style={{ padding: 16 }}>
      <button onClick={onOpen} style={{ background: 'none', border: 0, padding: 0, textAlign: 'left', width: '100%' }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', justifyContent: 'space-between' }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ fontSize: 17, fontWeight: 680, letterSpacing: '-0.01em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {t.name}
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--m-ink-2)', marginTop: 2 }}>
              {t.bookingNo}{t.plotNo ? ` · Plot ${t.plotNo}` : ''}
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: t.overdueAmount > 0 ? 'var(--m-red)' : 'var(--m-ink)' }}>
              {formatINR(t.overdueAmount > 0 ? t.overdueAmount : t.balance)}
            </div>
            <div style={{ fontSize: 11, color: 'var(--m-ink-3)' }}>
              {t.overdueAmount > 0 ? 'overdue' : 'balance'}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
          {t.overdueCount > 0 && (
            <span className={`m-chip ${t.daysLate > 60 ? 'm-chip-red' : 'm-chip-amber'}`}>
              {daysWord(t.daysLate)}
            </span>
          )}
          {t.overdueCount > 1 && <span className="m-chip m-chip-grey">{t.overdueCount} instalments</span>}
          {t.reason === 'followup' && <span className="m-chip m-chip-green">Follow-up due</span>}
          {t.promisedAmount ? <span className="m-chip m-chip-green">Promised {formatINR(t.promisedAmount)}</span> : null}
        </div>

        {/* What they said last time — so the caller opens with context, not from scratch. */}
        {t.lastCall && (
          <div style={{ marginTop: 10, padding: '9px 11px', borderRadius: 12, background: 'var(--m-bg)' }}>
            <div style={{ fontSize: 11, color: 'var(--m-ink-3)', fontWeight: 600 }}>
              Last call · {formatDate(t.lastCall.created_at)} · {t.lastCall.status}
            </div>
            {(t.lastCall.major_objection || t.lastCall.notes) && (
              <div style={{ fontSize: 12.5, color: 'var(--m-ink-2)', marginTop: 3 }}>
                {t.lastCall.major_objection ? <b>{t.lastCall.major_objection}</b> : null}
                {t.lastCall.major_objection && t.lastCall.notes ? ' — ' : ''}
                {t.lastCall.notes || ''}
              </div>
            )}
          </div>
        )}
      </button>

      <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
        {t.phone && (
          <a href={`tel:${t.phone}`} onClick={onDone} className="m-cta m-cta-call m-press" style={{ flex: 2, textDecoration: 'none' }}>
            <Phone size={17}/> Call
          </a>
        )}
        {wa && (
          <a href={wa} target="_blank" rel="noreferrer" className="m-cta m-cta-wa m-press" style={{ flex: 1, textDecoration: 'none' }}>
            <MessageCircle size={17}/>
          </a>
        )}
        <button onClick={onLog} className="m-cta m-cta-log m-press" style={{ flex: 1 }}>
          <NotebookPen size={17}/>
        </button>
      </div>
    </div>
  )
}

/* ── Customer detail ───────────────────────────────────────────── */
function CustomerScreen({ target, onBack, onLog }: { target: CallTarget; onBack: () => void; onLog: (t: CallTarget) => void }) {
  const { data: history = [] } = useCallHistory(target.bookingId)
  const { data: emis = [] } = useQuery({
    queryKey: ['m_emis', target.bookingId],
    queryFn: async () => {
      const { data: scheds } = await supabase.from('emi_schedules').select('id').eq('booking_id', target.bookingId)
      const ids = (scheds || []).map((s: any) => s.id)
      if (ids.length === 0) return []
      const { data } = await supabase.from('emi_installments')
        .select('seq, due_date, amount, paid_amount, status').in('schedule_id', ids).order('seq')
      return data || []
    },
  })

  const t = todayISO()
  return (
    <div style={{ padding: '14px 16px 30px' }}>
      <button onClick={onBack} className="m-press"
        style={{ display: 'inline-flex', alignItems: 'center', gap: 3, background: 'none', border: 0, color: 'var(--m-blue)', fontSize: 16, padding: '4px 0 12px', fontWeight: 600 }}>
        <ChevronLeft size={20}/> Back
      </button>

      <div className="m-title" style={{ fontSize: 26 }}>{target.name}</div>
      <div className="m-sub">{target.bookingNo}{target.projectName ? ` · ${target.projectName}` : ''}{target.plotNo ? ` · Plot ${target.plotNo}` : ''}</div>

      <div className="m-card" style={{ padding: 16, marginTop: 18, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        <Money label="Overdue"  value={target.overdueAmount} tone="var(--m-red)"/>
        <Money label="Balance"  value={target.balance}/>
        <Money label="Paid"     value={target.paid} tone="var(--m-green)"/>
        <Money label="Total"    value={target.totalValue}/>
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
        {target.phone && (
          <a href={`tel:${target.phone}`} className="m-cta m-cta-call m-press" style={{ flex: 2, textDecoration: 'none' }}>
            <Phone size={17}/> Call {target.phone}
          </a>
        )}
        <button onClick={() => onLog(target)} className="m-cta m-cta-log m-press" style={{ flex: 1 }}>
          <NotebookPen size={17}/> Log
        </button>
      </div>

      <SectionTitle icon={<HistoryIcon size={14}/>}>Instalments</SectionTitle>
      <div className="m-card" style={{ overflow: 'hidden' }}>
        {emis.length === 0 && <div style={{ padding: 16, fontSize: 13, color: 'var(--m-ink-3)' }}>No EMI plan on this booking.</div>}
        {(emis as any[]).map((e, i) => {
          const due = Math.max(0, Number(e.amount || 0) - Number(e.paid_amount || 0))
          const late = e.status !== 'paid' && e.due_date <= t
          return (
            <div key={e.seq} style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '12px 15px', borderTop: i === 0 ? 'none' : '1px solid var(--m-line)',
            }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 600 }}>#{e.seq} · {formatDate(e.due_date)}</div>
                <div style={{ fontSize: 11.5, color: late ? 'var(--m-red)' : 'var(--m-ink-3)' }}>
                  {e.status === 'paid' ? 'Paid' : late ? 'Overdue' : 'Upcoming'}
                </div>
              </div>
              <div style={{ fontWeight: 650, color: e.status === 'paid' ? 'var(--m-ink-3)' : 'var(--m-ink)' }}>
                {formatINR(e.status === 'paid' ? Number(e.amount || 0) : due)}
              </div>
            </div>
          )
        })}
      </div>

      <SectionTitle icon={<NotebookPen size={14}/>}>Call history</SectionTitle>
      <div style={{ display: 'grid', gap: 10 }}>
        {history.length === 0 && (
          <div className="m-card" style={{ padding: 16, fontSize: 13, color: 'var(--m-ink-3)' }}>
            No calls logged yet. The first one you save shows up here.
          </div>
        )}
        {(history as any[]).map(c => (
          <div key={c.id} className="m-card" style={{ padding: 14 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <span className={`m-chip ${c.status === 'Connected' ? 'm-chip-green' : 'm-chip-grey'}`}>{c.status}</span>
              <span style={{ fontSize: 11.5, color: 'var(--m-ink-3)' }}>{formatDate(c.created_at)}</span>
            </div>
            {c.major_objection && <div style={{ fontSize: 14, fontWeight: 650, marginTop: 8 }}>{c.major_objection}</div>}
            {c.notes && <div style={{ fontSize: 13, color: 'var(--m-ink-2)', marginTop: 3 }}>{c.notes}</div>}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
              {c.promised_amount ? <span className="m-chip m-chip-amber">Promised {formatINR(Number(c.promised_amount))}{c.promised_date ? ` by ${formatDate(c.promised_date)}` : ''}</span> : null}
              {c.next_followup_date ? <span className="m-chip m-chip-grey">Next {formatDate(c.next_followup_date)}</span> : null}
            </div>
            {c.employee_name && <div style={{ fontSize: 11, color: 'var(--m-ink-3)', marginTop: 8 }}>by {c.employee_name}</div>}
          </div>
        ))}
      </div>
    </div>
  )
}

/* ── Search ────────────────────────────────────────────────────── */
function SearchScreen({ onOpen }: { onOpen: (t: CallTarget) => void }) {
  const [q, setQ] = useState('')
  const { data: results = [], isFetching } = useQuery({
    queryKey: ['m_search', q],
    enabled: q.trim().length >= 2,
    queryFn: async () => {
      const term = q.trim()
      const { data: custs } = await supabase.from('bp_customers')
        .select('id').or(`name.ilike.%${term}%,phone.ilike.%${term}%,customer_code.ilike.%${term}%`).limit(40)
      const custIds = (custs || []).map((c: any) => c.id)
      const parts = [`booking_no.ilike.%${term}%`]
      if (custIds.length) parts.push(`customer_id.in.(${custIds.join(',')})`)
      const { data: bks } = await supabase.from('bp_bookings')
        .select('id, booking_no, total_amount, plot_total_price, customer_id, bp_customers(id, name, phone), bp_projects(name), bp_plots(plot_no)')
        .or(parts.join(',')).neq('stage', 'cancelled').limit(40)
      const ids = (bks || []).map((b: any) => b.id)
      const { data: pays } = ids.length
        ? await supabase.from('bp_payments').select('booking_id, amount, verification_status').in('booking_id', ids)
        : { data: [] as any[] }
      const paid = paidByBooking(pays as any[])
      return ((bks || []) as any[]).map(b => {
        const value = bookingValue(b)
        const got = paid[b.id] || 0
        return {
          bookingId: b.id, customerId: b.bp_customers?.id ?? b.customer_id ?? null,
          name: b.bp_customers?.name || '(no name)', phone: b.bp_customers?.phone || null,
          bookingNo: b.booking_no || '', projectName: b.bp_projects?.name || null,
          plotNo: b.bp_plots?.plot_no || null,
          totalValue: value, paid: got, balance: balanceOf(value, got),
          overdueAmount: 0, overdueCount: 0, oldestDueDate: null, daysLate: 0,
          lastCall: null, followUpDate: null, promisedAmount: null, reason: 'followup',
        } as CallTarget
      })
    },
  })

  return (
    <div style={{ padding: '22px 16px 8px' }}>
      <div className="m-title">Search</div>
      <div className="m-sub">Any customer, by name, phone or booking number.</div>
      <input value={q} onChange={e => setQ(e.target.value)} className="m-field"
        placeholder="Name, phone or booking no." style={{ margin: '16px 0 18px' }} autoFocus/>

      {q.trim().length >= 2 && isFetching && <div style={{ color: 'var(--m-ink-3)', fontSize: 13 }}>Searching…</div>}
      {q.trim().length >= 2 && !isFetching && results.length === 0 && (
        <div style={{ color: 'var(--m-ink-3)', fontSize: 13 }}>Nobody matches that.</div>
      )}

      <div style={{ display: 'grid', gap: 10 }}>
        {results.map(r => (
          <button key={r.bookingId} onClick={() => onOpen(r)} className="m-card m-press"
            style={{ padding: 15, textAlign: 'left', border: 0, width: '100%' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 16, fontWeight: 650, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</div>
                <div style={{ fontSize: 12, color: 'var(--m-ink-2)', marginTop: 2 }}>{r.bookingNo}{r.phone ? ` · ${r.phone}` : ''}</div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontWeight: 700 }}>{formatINR(r.balance)}</div>
                <div style={{ fontSize: 11, color: 'var(--m-ink-3)' }}>balance</div>
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}

/* ── My work ───────────────────────────────────────────────────── */
function MeScreen() {
  const { data: stats } = useQuery({
    queryKey: ['m_my_work'],
    queryFn: async () => {
      const { data: auth } = await supabase.auth.getUser()
      const uid = auth?.user?.id
      const t = todayISO()
      const monthStart = t.slice(0, 8) + '01'
      const { data: mine } = await supabase.from('calls')
        .select('id, status, call_date, promised_amount, next_followup_date, followup_status')
        .eq('employee_id', uid || '00000000-0000-0000-0000-000000000000')
        .gte('call_date', monthStart)
      const rows = mine || []
      return {
        today: rows.filter((r: any) => r.call_date === t).length,
        month: rows.length,
        talked: rows.filter((r: any) => r.status === 'Connected').length,
        promised: rows.reduce((s: number, r: any) => s + Number(r.promised_amount || 0), 0),
        pendingFollowUps: rows.filter((r: any) => r.next_followup_date && r.followup_status === 'pending').length,
      }
    },
  })

  return (
    <div style={{ padding: '22px 16px 8px' }}>
      <div className="m-title">My work</div>
      <div className="m-sub">Your calls this month.</div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 18 }}>
        <Stat label="Calls today"       value={String(stats?.today ?? '—')}/>
        <Stat label="Calls this month"  value={String(stats?.month ?? '—')}/>
        <Stat label="Actually talked"   value={String(stats?.talked ?? '—')} tone="var(--m-green)"/>
        <Stat label="Follow-ups open"   value={String(stats?.pendingFollowUps ?? '—')} tone="var(--m-amber)"/>
      </div>

      <div className="m-card" style={{ padding: 18, marginTop: 12 }}>
        <div style={{ fontSize: 12, color: 'var(--m-ink-2)', fontWeight: 600 }}>PROMISED TO PAY</div>
        <div style={{ fontSize: 30, fontWeight: 700, marginTop: 4, letterSpacing: '-0.02em' }}>
          {formatINR(stats?.promised ?? 0)}
        </div>
        <div style={{ fontSize: 12, color: 'var(--m-ink-3)', marginTop: 2 }}>
          collected from your calls this month
        </div>
      </div>
    </div>
  )
}

/* ── bits ──────────────────────────────────────────────────────── */
function Money({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: 'var(--m-ink-3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.03em' }}>{label}</div>
      <div style={{ fontSize: 19, fontWeight: 700, color: tone || 'var(--m-ink)', marginTop: 2 }}>{formatINR(value)}</div>
    </div>
  )
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="m-card" style={{ padding: 16 }}>
      <div style={{ fontSize: 11, color: 'var(--m-ink-3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.03em' }}>{label}</div>
      <div style={{ fontSize: 28, fontWeight: 700, color: tone || 'var(--m-ink)', marginTop: 3, letterSpacing: '-0.02em' }}>{value}</div>
    </div>
  )
}

function SectionTitle({ children, icon }: { children: any; icon?: any }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6, margin: '26px 0 10px', fontSize: 12, fontWeight: 700, color: 'var(--m-ink-2)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
      {icon}{children}
    </div>
  )
}
