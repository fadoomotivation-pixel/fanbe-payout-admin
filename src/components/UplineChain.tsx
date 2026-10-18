// The team sitting above a broker, drawn from sponsor_id.
//
// Admin, relaying Manisha's call: "maan lo Vaidehi mam hai... unki team me Alok sir...
// Alok sir ki team me Shashi sir... Shashi sir ki team me Pragya mam. Pragya mam ne koi
// booking karai, to unka direct to jayega Pragya mam ko hi, lekin upar kuch percentage
// Alok sir ko bhi jayegi, Shashi sir ko bhi, Vaidehi mam ko bhi. Abhi agar hum khali ek
// hi select karte hain Pragya, to hume ye justify nahi hoyega ki upar in logo ko bhi
// jayega ya nahi."
//
// And, asked whether the amounts should show: "amount show na ho, unka naam show ho jaye
// ki haa bhai ye is is team ke -- matlab ye downline inhi logo ki hai."
//
// So this shows NAMES ONLY, deliberately. Not because amounts are hard, but because they
// would be wrong: on a traditional deal the rate is whatever was agreed for that deal -
// "kisi ko 100 rupaye gaj de rakha hai kisi ko 1000 kisi ko 1500" - and paying the upline
// is an explicit per-booking choice, not something this chain decides. A number here would
// read as a promise the system has not made. The office takes the commission out to Excel.
//
// The other thing it answers is the one that actually bites: "Vaidehi mam ki team me maan
// lo 2 Rajiv ho gaye, alag alag associate hain, to ye justify karna mushkil ho jayega ki
// ye kiski team wala Rajiv hai." Two brokers with the same name are told apart by who sits
// above them, so that is what gets drawn.
//
// One component, used by the Add Broker form and the booking form both, so the two can
// never start disagreeing about who is above whom.
import { useMemo } from 'react'
import { Secret } from '@/lib/privacy'

export type ChainBroker = {
  id: string
  name?: string | null
  broker_id?: string | null
  rank?: string | null
  sponsor_id?: string | null
  broker_type?: string | null
  /** Traditional brokers: the agreed rate they are on, per gaj. */
  traditional_rate_per_sqyd?: number | null
}

/**
 * Walk sponsor_id upwards. Capped at 15 levels for the same reason
 * recompute_booking_payouts() caps its own walk: the database refuses a cycle, but this
 * runs against whatever copy of the list the browser happens to be holding.
 */
export function uplineOf(brokers: ChainBroker[], startId?: string | null): ChainBroker[] {
  if (!startId) return []
  const byId = new Map(brokers.map(b => [b.id, b]))
  const out: ChainBroker[] = []
  const seen = new Set<string>()
  let cur: string | null | undefined = startId
  for (let i = 0; i < 15 && cur; i++) {
    if (seen.has(cur)) break
    seen.add(cur)
    const b = byId.get(cur)
    if (!b) break
    out.push(b)
    cur = b.sponsor_id
  }
  return out
}

export default function UplineChain({
  brokers, startId, title, emptyText, note,
}: {
  brokers: ChainBroker[]
  /** The broker whose team above we are drawing — a chosen sponsor, or a booking's broker. */
  startId?: string | null
  title?: string
  emptyText?: string
  note?: string
}) {
  const chain = useMemo(() => uplineOf(brokers, startId), [brokers, startId])
  // Traditional levels with no agreed rate: the team commission cannot fill them in.
  const missingRate = useMemo(
    () => chain.filter(b => (b.broker_type || 'mlm') === 'traditional'
      && !(Number(b.traditional_rate_per_sqyd) > 0)),
    [chain],
  )

  if (!startId) {
    return emptyText ? <p className="mt-2 text-[11px] text-gray-400">{emptyText}</p> : null
  }
  if (chain.length === 0) return null

  return (
    <div className="mt-2.5 rounded-lg border border-indigo-100 bg-indigo-50/40 px-3 py-2" data-testid="upline-chain">
      <div className="text-[11px] font-semibold text-indigo-900 mb-1.5">
        {title || 'Team above'} — {chain.length} level{chain.length === 1 ? '' : 's'}
      </div>
      <ol className="space-y-1">
        {chain.map((b, i) => (
          <li key={b.id} className="flex items-center gap-2 text-[12px]">
            <span className="w-5 shrink-0 text-[10px] font-mono text-indigo-400">L{i + 1}</span>
            <span className="font-medium text-gray-900 truncate">{b.name || '—'}</span>
            <span className="text-[10px] font-mono text-gray-400 shrink-0">[{b.broker_id || '—'}]</span>
            {/* What this broker is paid on. The rank ladder belongs to the Affiliate
                tree; a traditional broker's rank column only ever holds the defaulted
                'Executive', so printing it here told the office that ALOK, BAIDHEI and
                SHIV SHANKAR were on a 5% slab they have nothing to do with. They are on
                an agreed rate per gaj — which is also the number the team commission
                needs, so saying "rate not set" here is the answer to "where do I put the
                commission for the people above". */}
            {(b.broker_type || 'mlm') === 'traditional'
              ? (Number(b.traditional_rate_per_sqyd) > 0
                  // Behind the privacy lock, like every other broker figure on screen.
                  // Manisha's "amount show na ho" still holds for anyone who has not put
                  // the PIN in; what she needs when she IS working is one glance at who
                  // sits on what rate, and the lock is already how this app settles that.
                  // "rate not set" stays readable — it is a status, not an amount, and it
                  // is the one thing that has to be acted on.
                  ? <span className="text-[10px] font-mono text-indigo-700 shrink-0">
                      <Secret>{`₹${b.traditional_rate_per_sqyd}/gaj`}</Secret>
                    </span>
                  : <span className="text-[10px] text-amber-700 shrink-0">rate not set</span>)
              : (b.rank && <span className="text-[10px] text-indigo-700 shrink-0">{b.rank}</span>)}
            {i === chain.length - 1 && !b.sponsor_id && (
              <span className="text-[10px] text-gray-400 shrink-0">top of tree</span>
            )}
          </li>
        ))}
      </ol>
      {missingRate.length > 0 && (
        <p className="mt-1.5 text-[11px] bg-white border border-amber-300 text-amber-900 rounded px-2 py-1.5">
          No rate per gaj for {missingRate.map(b => b.name || '—').join(', ')}. Set it on their
          broker record (Brokers → Edit), then <b>Fill team commission</b> can work out what each
          level earns. Without it they are left out rather than paid zero.
        </p>
      )}
      {note && <p className="mt-1.5 text-[11px] text-indigo-900/70">{note}</p>}
    </div>
  )
}
