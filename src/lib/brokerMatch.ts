// Finding a broker from the name the office actually wrote.
//
// Sheets name brokers the way people say them — "satish", "nn pandey", "radheyshyam",
// "radhe shyam" — not by code.  Both importers need the same answer, so the rule lives
// here once: the booking import reads uplines out of a cell, the broker import reads a
// sponsor out of a column, and neither is allowed to be cleverer than the other.
//
// The order is what keeps it safe:
//
//   1. the broker code, if that is what was written
//   2. the whole name ignoring spacing and punctuation — this is what makes
//      "radheyshyam" find "Radhey Shyam", and "shyam" find "Shyam" rather than the
//      longer name that merely ends in it
//   3. word by word, where every word written must START a different word of the
//      broker's name
//
// Step 3 accepts "satish" for "Satish Kumar" and "radhe shyam" for "Radhey Shyam", while
// refusing "radhe shyam" for a plain "Shyam".  A simple substring test matched that last
// one, which sent commission to the wrong person — so it is not used.
//
// Two or more hits is never resolved by guessing.  Paying the wrong broker is worse than
// leaving the row for someone to finish by hand.

export type MatchableBroker = { id: string; name?: string | null; broker_id?: string | null }

export type BrokerMatch<T> = {
  broker: T | null
  /** 'code' | 'name' | 'partial' when found; 'ambiguous' | 'missing' | 'blank' when not. */
  why: 'code' | 'name' | 'partial' | 'ambiguous' | 'missing' | 'blank'
}

export const brokerNameKey = (s: string | null | undefined) =>
  String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '')

const tokensOf = (s: string | null | undefined) =>
  String(s || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)

/** Every word written starts a different word of the broker's name. */
function wordsMatch(queryTokens: string[], brokerTokens: string[]): boolean {
  if (queryTokens.length === 0 || queryTokens.length > brokerTokens.length) return false
  const used = new Set<number>()
  return queryTokens.every(q => {
    const i = brokerTokens.findIndex((b, idx) => !used.has(idx) && b.startsWith(q))
    if (i < 0) return false
    used.add(i)
    return true
  })
}

/**
 * Build a finder over one list of brokers.  The indexes are built once so a sheet of a
 * few thousand rows does not re-scan the broker list for every cell.
 */
export function makeBrokerFinder<T extends MatchableBroker>(brokers: T[]) {
  const byCode = new Map<string, T>()
  const byName = new Map<string, T[]>()
  const tokenised: { b: T; tok: string[] }[] = []

  for (const b of brokers) {
    const code = String(b.broker_id || '').trim().toLowerCase()
    if (code && !byCode.has(code)) byCode.set(code, b)
    const key = brokerNameKey(b.name)
    if (key) {
      const list = byName.get(key)
      if (list) list.push(b); else byName.set(key, [b])
    }
    tokenised.push({ b, tok: tokensOf(b.name) })
  }

  return function findBroker(raw: string | null | undefined): BrokerMatch<T> {
    const q = String(raw || '').trim()
    if (!q) return { broker: null, why: 'blank' }

    const code = byCode.get(q.toLowerCase())
    if (code) return { broker: code, why: 'code' }

    const key = brokerNameKey(q)
    if (!key) return { broker: null, why: 'blank' }

    const exact = byName.get(key)
    if (exact && exact.length === 1) return { broker: exact[0], why: 'name' }
    if (exact && exact.length > 1) return { broker: null, why: 'ambiguous' }

    const qTok = tokensOf(q)
    const loose = tokenised.filter(t => wordsMatch(qTok, t.tok))
    if (loose.length === 1) return { broker: loose[0].b, why: 'partial' }
    if (loose.length > 1) return { broker: null, why: 'ambiguous' }

    return { broker: null, why: 'missing' }
  }
}
