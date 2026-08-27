import { useState } from 'react'
import { formatINR, formatDate } from '@/lib/utils'
import { waLink } from '@/lib/whatsapp'
import { tap } from './native'
import { useBookings, useCustomers, useCustomerBookings, useProjects, usePlots, usePlotHolders, type BookingRow } from './useBusiness'
import {
  ChevronLeft, ChevronRight, Phone, MessageCircle, Search as SearchIcon,
  Building2, MapPin, Layers,
} from 'lucide-react'

// Bookings, customers and inventory on the phone.
//
// These are reference screens, not data-entry ones: someone standing in front of a
// customer needs to answer "what does he owe" and "is that plot free" in a couple of taps.
// Editing stays in the admin panel, where there is room to do it carefully.

const STAGE_LABEL: Record<string, string> = {
  token_received: 'Token', booking_done: 'Booked', cancelled: 'Cancelled',
}
const STATUS_LABEL: Record<string, string> = {
  available: 'Available', token: 'Token', booked: 'Booked',
  registry_done: 'Registered', cancelled: 'Cancelled',
}
const STATUS_CHIP: Record<string, string> = {
  available: 'm-chip-green', token: 'm-chip-amber', booked: 'm-chip-grey',
  registry_done: 'm-chip-green', cancelled: 'm-chip-red',
}

/* ── shared bits ───────────────────────────────────────────────── */

export function ScreenHeader({ title, sub, onBack }: { title: string; sub?: string; onBack?: () => void }) {
  return (
    <>
      {onBack && (
        <button onClick={() => { tap(); onBack() }} className="m-press"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 3, background: 'none', border: 0, color: 'var(--m-blue)', fontSize: 16, padding: '4px 0 12px', fontWeight: 600 }}>
          <ChevronLeft size={20}/> Back
        </button>
      )}
      <div className="m-title" style={{ fontSize: onBack ? 26 : 30 }}>{title}</div>
      {sub && <div className="m-sub">{sub}</div>}
    </>
  )
}

function SearchField({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div style={{ position: 'relative', margin: '16px 0 14px' }}>
      <SearchIcon size={16} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--m-ink-3)' }}/>
      <input value={value} onChange={e => onChange(e.target.value)} className="m-field"
        placeholder={placeholder} style={{ paddingLeft: 40 }}/>
    </div>
  )
}

function Chips({ options, value, onChange }: { options: { v: string; label: string }[]; value: string; onChange: (v: string) => void }) {
  return (
    // Horizontally scrollable so filters never wrap into a second row and push the list
    // below the fold on a small screen.
    <div style={{ display: 'flex', gap: 7, overflowX: 'auto', paddingBottom: 12, margin: '0 -16px', padding: '0 16px 12px' }}>
      {options.map(o => (
        <button key={o.v} onClick={() => { tap(); onChange(o.v) }} className="m-press"
          style={{
            flex: '0 0 auto', padding: '9px 14px', borderRadius: 999, fontSize: 13, fontWeight: 600,
            border: '1px solid var(--m-line)', whiteSpace: 'nowrap',
            background: value === o.v ? 'var(--m-ink)' : 'var(--m-surface)',
            color: value === o.v ? '#fff' : 'var(--m-ink-2)',
          }}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

function Pager({ page, total, pageSize, onPage }: { page: number; total: number; pageSize: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize))
  if (pages <= 1) return null
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '16px 0 6px' }}>
      <button disabled={page === 0} onClick={() => { tap(); onPage(page - 1) }} className="m-press"
        style={{ padding: '10px 16px', borderRadius: 12, border: '1px solid var(--m-line)', background: 'var(--m-surface)', color: 'var(--m-ink)', fontWeight: 600, fontSize: 13, opacity: page === 0 ? 0.4 : 1 }}>
        Previous
      </button>
      <span style={{ fontSize: 12.5, color: 'var(--m-ink-3)' }}>{page + 1} of {pages}</span>
      <button disabled={page >= pages - 1} onClick={() => { tap(); onPage(page + 1) }} className="m-press"
        style={{ padding: '10px 16px', borderRadius: 12, border: '1px solid var(--m-line)', background: 'var(--m-surface)', color: 'var(--m-ink)', fontWeight: 600, fontSize: 13, opacity: page >= pages - 1 ? 0.4 : 1 }}>
        Next
      </button>
    </div>
  )
}

function Empty({ children }: { children: any }) {
  return <div className="m-card" style={{ padding: 26, textAlign: 'center', fontSize: 13.5, color: 'var(--m-ink-2)' }}>{children}</div>
}

function Loading() {
  return <div style={{ padding: 40, textAlign: 'center', color: 'var(--m-ink-3)', fontSize: 13 }}>Loading…</div>
}

/** A money figure with its label, used wherever a booking's position is summarised. */
function Figure({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div>
      <div style={{ fontSize: 10.5, color: 'var(--m-ink-3)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.03em' }}>{label}</div>
      <div style={{ fontSize: 17, fontWeight: 700, color: tone || 'var(--m-ink)', marginTop: 2 }}>{formatINR(value)}</div>
    </div>
  )
}

/* ── Bookings ──────────────────────────────────────────────────── */

export function BookingsScreen({ onOpen }: { onOpen: (b: BookingRow) => void }) {
  const [search, setSearch] = useState('')
  const [stage, setStage] = useState('')
  const [page, setPage] = useState(0)
  const { data, isLoading } = useBookings({ search, stage, page })
  const rows = data?.rows ?? []

  const set = (fn: () => void) => { fn(); setPage(0) }

  return (
    <div className="m-screen" style={{ padding: '22px 16px 8px' }}>
      <ScreenHeader title="Bookings" sub={data ? `${data.total.toLocaleString('en-IN')} bookings` : 'Loading…'}/>
      <SearchField value={search} onChange={v => set(() => setSearch(v))} placeholder="Name, phone or booking no."/>
      <Chips value={stage} onChange={v => set(() => setStage(v))} options={[
        { v: '', label: 'All' },
        { v: 'booking_done', label: 'Booked' },
        { v: 'token_received', label: 'Token' },
        { v: 'cancelled', label: 'Cancelled' },
      ]}/>

      {isLoading && <Loading/>}
      {!isLoading && rows.length === 0 && <Empty>No bookings match that.</Empty>}

      <div style={{ display: 'grid', gap: 11 }}>
        {rows.map(b => <BookingCard key={b.id} b={b} onOpen={() => onOpen(b)}/>)}
      </div>
      <Pager page={page} total={data?.total ?? 0} pageSize={30} onPage={setPage}/>
    </div>
  )
}

export function BookingCard({ b, onOpen }: { b: BookingRow; onOpen: () => void }) {
  const pct = b.value > 0 ? Math.min(100, Math.round((b.paid / b.value) * 100)) : 0
  return (
    <button onClick={() => { tap(); onOpen() }} className="m-card m-press"
      style={{ padding: 15, border: 0, textAlign: 'left', width: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 16.5, fontWeight: 680, letterSpacing: '-0.01em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {b.name}
          </div>
          <div style={{ fontSize: 12, color: 'var(--m-ink-2)', marginTop: 2 }}>
            {b.bookingNo}{b.plotNo ? ` · Plot ${b.plotNo}` : ''}{b.projectName ? ` · ${b.projectName}` : ''}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: 17, fontWeight: 700, color: b.balance > 0 ? 'var(--m-ink)' : 'var(--m-green)' }}>
            {formatINR(b.balance)}
          </div>
          <div style={{ fontSize: 10.5, color: 'var(--m-ink-3)' }}>{b.balance > 0 ? 'balance' : 'settled'}</div>
        </div>
      </div>

      {/* One bar says more than three numbers: how much of this deal is actually in. */}
      <div style={{ height: 5, borderRadius: 999, background: 'var(--m-line)', margin: '11px 0 8px', overflow: 'hidden' }}>
        <div style={{ height: '100%', width: `${pct}%`, borderRadius: 999, background: pct >= 100 ? 'var(--m-green)' : 'var(--m-blue)' }}/>
      </div>

      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
        <span className={`m-chip ${b.stage === 'cancelled' ? 'm-chip-red' : b.stage === 'booking_done' ? 'm-chip-green' : 'm-chip-amber'}`}>
          {STAGE_LABEL[b.stage] || b.stage}
        </span>
        {b.registryDone && <span className="m-chip m-chip-green">Registered</span>}
        <span style={{ fontSize: 11.5, color: 'var(--m-ink-3)', marginLeft: 'auto' }}>
          {formatINR(b.paid)} of {formatINR(b.value)}
        </span>
      </div>
    </button>
  )
}

/* ── Customers ─────────────────────────────────────────────────── */

export function CustomersScreen({ onOpen }: { onOpen: (c: any) => void }) {
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(0)
  const { data, isLoading } = useCustomers({ search, page })
  const rows = data?.rows ?? []

  return (
    <div className="m-screen" style={{ padding: '22px 16px 8px' }}>
      <ScreenHeader title="Customers" sub={data ? `${data.total.toLocaleString('en-IN')} customers` : 'Loading…'}/>
      <SearchField value={search} onChange={v => { setSearch(v); setPage(0) }} placeholder="Name, phone or customer code"/>

      {isLoading && <Loading/>}
      {!isLoading && rows.length === 0 && <Empty>Nobody matches that.</Empty>}

      <div style={{ display: 'grid', gap: 11 }}>
        {rows.map(c => (
          <button key={c.id} onClick={() => { tap(); onOpen(c) }} className="m-card m-press"
            style={{ padding: 15, border: 0, textAlign: 'left', width: '100%' }}>
            <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
              {/* Initial instead of an avatar: no image to load, and it still gives the eye
                  something to lock onto when scanning a long list. */}
              <div style={{
                width: 42, height: 42, borderRadius: 999, flexShrink: 0,
                background: 'linear-gradient(135deg,#0071E3,#4E9BFF)', color: '#fff',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontWeight: 700, fontSize: 17,
              }}>
                {(c.name || '?').charAt(0).toUpperCase()}
              </div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 16, fontWeight: 660, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</div>
                <div style={{ fontSize: 12, color: 'var(--m-ink-2)', marginTop: 1 }}>
                  {c.code}{c.phone ? ` · ${c.phone}` : ''}
                </div>
              </div>
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontSize: 15.5, fontWeight: 700, color: c.balance > 0 ? 'var(--m-ink)' : 'var(--m-green)' }}>
                  {formatINR(c.balance)}
                </div>
                <div style={{ fontSize: 10.5, color: 'var(--m-ink-3)' }}>
                  {c.bookings} booking{c.bookings === 1 ? '' : 's'}
                </div>
              </div>
            </div>
          </button>
        ))}
      </div>
      <Pager page={page} total={data?.total ?? 0} pageSize={30} onPage={setPage}/>
    </div>
  )
}

export function CustomerDetailScreen({ customer, onBack, onOpenBooking }: { customer: any; onBack: () => void; onOpenBooking: (b: BookingRow) => void }) {
  const { data: bookings = [], isLoading } = useCustomerBookings(customer.id)
  const wa = waLink(customer.phone, `Dear ${customer.name},\n\nThis is a message from Fanbe Group regarding your booking.\n\nThank you.`)

  return (
    <div className="m-screen" style={{ padding: '14px 16px 30px' }}>
      <ScreenHeader title={customer.name} sub={`${customer.code}${customer.city ? ` · ${customer.city}` : ''}`} onBack={onBack}/>

      <div className="m-card" style={{ padding: 16, marginTop: 18, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
        <Figure label="Value"   value={customer.value}/>
        <Figure label="Paid"    value={customer.paid} tone="var(--m-green)"/>
        <Figure label="Balance" value={customer.balance} tone={customer.balance > 0 ? 'var(--m-red)' : 'var(--m-green)'}/>
      </div>

      {customer.phone && (
        <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
          <a href={`tel:${customer.phone}`} onClick={() => tap('medium')} className="m-cta m-cta-call m-press" style={{ flex: 2, textDecoration: 'none' }}>
            <Phone size={17}/> Call
          </a>
          {wa && (
            <a href={wa} target="_blank" rel="noreferrer" onClick={() => tap()} className="m-cta m-cta-wa m-press" style={{ flex: 1, textDecoration: 'none' }}>
              <MessageCircle size={17}/>
            </a>
          )}
        </div>
      )}

      <div style={{ margin: '26px 0 10px', fontSize: 12, fontWeight: 700, color: 'var(--m-ink-2)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
        Bookings ({bookings.length})
      </div>
      {isLoading && <Loading/>}
      {!isLoading && bookings.length === 0 && <Empty>No bookings for this customer.</Empty>}
      <div style={{ display: 'grid', gap: 11 }}>
        {bookings.map(b => <BookingCard key={b.id} b={b} onOpen={() => onOpenBooking(b)}/>)}
      </div>
    </div>
  )
}

/* ── Projects and plots ────────────────────────────────────────── */

export function ProjectsScreen({ onOpen }: { onOpen: (p: any) => void }) {
  const { data: projects = [], isLoading } = useProjects()
  const totals = projects.reduce((s, p) => ({ total: s.total + p.total, available: s.available + p.available }), { total: 0, available: 0 })

  return (
    <div className="m-screen" style={{ padding: '22px 16px 8px' }}>
      <ScreenHeader title="Inventory"
        sub={isLoading ? 'Loading…' : `${totals.total.toLocaleString('en-IN')} plots · ${totals.available.toLocaleString('en-IN')} available`}/>

      {isLoading && <Loading/>}
      {!isLoading && projects.length === 0 && <Empty>No projects yet.</Empty>}

      <div style={{ display: 'grid', gap: 11, marginTop: 16 }}>
        {projects.map(p => (
          <button key={p.id} onClick={() => { tap(); onOpen(p) }} className="m-card m-press"
            style={{ padding: 16, border: 0, textAlign: 'left', width: '100%' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 38, height: 38, borderRadius: 11, background: '#E8F1FF', color: 'var(--m-blue)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Building2 size={19}/>
              </div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 16.5, fontWeight: 680 }}>{p.name}</div>
                {p.location && (
                  <div style={{ fontSize: 12, color: 'var(--m-ink-2)', marginTop: 1, display: 'flex', alignItems: 'center', gap: 3 }}>
                    <MapPin size={11}/>{p.location}
                  </div>
                )}
              </div>
              <ChevronRight size={18} style={{ color: 'var(--m-ink-3)' }}/>
            </div>

            {/* One bar showing how much of the scheme is sold, in the same colours the
                plot chips use, so the two screens read as one thing. */}
            {p.total > 0 && (
              <>
                <div style={{ display: 'flex', height: 6, borderRadius: 999, overflow: 'hidden', margin: '13px 0 9px', background: 'var(--m-line)' }}>
                  <div style={{ width: `${(p.available / p.total) * 100}%`, background: 'var(--m-green)' }}/>
                  <div style={{ width: `${(p.booked / p.total) * 100}%`, background: 'var(--m-amber)' }}/>
                  <div style={{ width: `${(p.registered / p.total) * 100}%`, background: 'var(--m-blue)' }}/>
                </div>
                <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                  <span className="m-chip m-chip-green">{p.available} available</span>
                  <span className="m-chip m-chip-amber">{p.booked} booked</span>
                  {p.registered > 0 && <span className="m-chip m-chip-grey">{p.registered} registered</span>}
                </div>
              </>
            )}
          </button>
        ))}
      </div>
    </div>
  )
}

export function PlotsScreen({ project, onBack, onOpenBooking }: { project: any; onBack: () => void; onOpenBooking: (bookingId: string) => void }) {
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('')
  const [page, setPage] = useState(0)
  const { data, isLoading } = usePlots(project.id, { search, status, page })
  const rows = data?.rows ?? []
  const { data: holders = {} } = usePlotHolders(rows.map((r: any) => r.id))

  return (
    <div className="m-screen" style={{ padding: '14px 16px 8px' }}>
      <ScreenHeader title={project.name}
        sub={data ? `${data.total.toLocaleString('en-IN')} plots` : 'Loading…'} onBack={onBack}/>
      <SearchField value={search} onChange={v => { setSearch(v); setPage(0) }} placeholder="Plot number"/>
      <Chips value={status} onChange={v => { setStatus(v); setPage(0) }} options={[
        { v: '', label: 'All' },
        { v: 'available', label: 'Available' },
        { v: 'booked', label: 'Booked' },
        { v: 'token', label: 'Token' },
        { v: 'registry_done', label: 'Registered' },
      ]}/>

      {isLoading && <Loading/>}
      {!isLoading && rows.length === 0 && <Empty>No plots match that.</Empty>}

      <div style={{ display: 'grid', gap: 10 }}>
        {rows.map((p: any) => {
          const held = holders[p.id]
          const card = (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'flex-start' }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 16.5, fontWeight: 700 }}>Plot {p.plot_no || '—'}</div>
                  <div style={{ fontSize: 12, color: 'var(--m-ink-2)', marginTop: 2 }}>
                    {p.size_sqyd ? `${Number(p.size_sqyd).toLocaleString('en-IN')} sqyd` : '—'}
                    {p.block ? ` · Blk ${p.block}` : ''}{p.sector ? ` · Sec ${p.sector}` : ''}
                  </div>
                </div>
                <span className={`m-chip ${STATUS_CHIP[p.status] || 'm-chip-grey'}`}>
                  {STATUS_LABEL[p.status] || p.status}
                </span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}>
                <span style={{ fontSize: 12, color: 'var(--m-ink-3)' }}>
                  {p.price_per_sqyd ? `${formatINR(p.price_per_sqyd)}/sqyd` : 'rate not set'}
                </span>
                <span style={{ fontSize: 15, fontWeight: 700 }}>
                  {p.total_price ? formatINR(p.total_price) : '—'}
                </span>
              </div>
              {/* A booked plot is only useful if it says who has it. */}
              {held && (
                <div style={{ marginTop: 10, padding: '9px 11px', borderRadius: 12, background: 'var(--m-bg)', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 13, fontWeight: 620, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{held.name}</div>
                    <div style={{ fontSize: 11, color: 'var(--m-ink-3)' }}>{held.bookingNo}</div>
                  </div>
                  <ChevronRight size={16} style={{ color: 'var(--m-ink-3)' }}/>
                </div>
              )}
            </>
          )
          return held ? (
            <button key={p.id} onClick={() => { tap(); onOpenBooking(held.bookingId) }} className="m-card m-press"
              style={{ padding: 15, border: 0, textAlign: 'left', width: '100%' }}>{card}</button>
          ) : (
            <div key={p.id} className="m-card" style={{ padding: 15 }}>{card}</div>
          )
        })}
      </div>
      <Pager page={page} total={data?.total ?? 0} pageSize={30} onPage={setPage}/>
    </div>
  )
}
