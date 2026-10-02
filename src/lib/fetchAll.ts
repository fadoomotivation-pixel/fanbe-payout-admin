// Two limits that silently cut lists short, and the helpers that get around them.
//
// 1. PostgREST returns at most `max-rows` (1,000 by default) per request, without an error.
//    A query that "fetches every booking" stops at 1,000 and the page simply shows fewer —
//    nothing on screen says anything is missing.  fetchAllRows pages through with .range()
//    until a short page comes back.
//
// 2. `.in('id', [...])` puts every id in the URL.  Around 400 uuids the URL passes the
//    gateway's limit and the request fails.  inChunks splits the list and merges the results.

const PAGE = 1000

export async function fetchAllRows<T = any>(
  makeQuery: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: any }>,
): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await makeQuery(from, from + PAGE - 1)
    if (error) throw error
    const rows = data || []
    out.push(...rows)
    if (rows.length < PAGE) break
  }
  return out
}

export async function inChunks<T = any>(
  ids: string[],
  run: (chunk: string[]) => PromiseLike<{ data: T[] | null; error: any }>,
  size = 150,
): Promise<T[]> {
  const unique = Array.from(new Set(ids.filter(Boolean)))
  const out: T[] = []
  for (let i = 0; i < unique.length; i += size) {
    const { data, error } = await run(unique.slice(i, i + size))
    if (error) throw error
    out.push(...(data || []))
  }
  return out
}

/** Today's date in the browser's own calendar (IST here), not UTC.  toISOString() gives
 *  the UTC date, which is still "yesterday" until 05:30 in India. */
export function todayLocalISO(d: Date = new Date()): string {
  const y = d.getFullYear(), m = String(d.getMonth() + 1).padStart(2, '0'), dd = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}
