// Plot numbers sort like a human reads them, not like a dictionary.
//
// `plot_no` is text, so `ORDER BY plot_no` gives A-1, A-10, A-11 … A-19, A-2, A-20 —
// every plot starting with the same digit bunched together.  Admin's words for it:
// "ek wale ek saath, do wale ek saath".  On a 1,451-plot scheme that makes the list
// unusable: to find P-12 and P-13 you scroll past P-120 to P-129 first.
//
// The schemes do not agree on a format either, so the comparison has to cope with all of
// these, which is what is actually in the table today:
//
//   A-1, A-10        prefix, dash, number
//   P-104(L)         …with a suffix in brackets
//   A1, A100         no dash
//   P1(L)
//   10A, 10B         number first, letter after
//   37, 40           bare numbers
//   P-36,37          one row that is really two plot numbers
//
// `localeCompare` with `numeric: true` handles every one of them: it walks the two
// strings together and compares digit runs as numbers, so "A-2" < "A-10", "10A" < "10B",
// and "P-104(L)" < "P-105".  No parsing, no assumptions about where the number sits.

/** Compare two plot numbers the way a person would read them down a list. */
export function comparePlotNo(a: string | null | undefined, b: string | null | undefined): number {
  const x = String(a ?? '').trim()
  const y = String(b ?? '').trim()
  // Blanks last, so a plot with no number never sits above a real one.
  if (!x && !y) return 0
  if (!x) return 1
  if (!y) return -1
  return x.localeCompare(y, 'en', { numeric: true, sensitivity: 'base' })
}

/**
 * Sort rows that carry a plot number, newest copy returned (the input is not touched).
 *
 * `key` picks the field for rows that are not the plot itself — a booking row holds its
 * number at `bp_plots.plot_no`, for example.
 */
export function sortByPlotNo<T>(rows: T[], key: (row: T) => string | null | undefined = (r: any) => r?.plot_no): T[] {
  return [...rows].sort((a, b) => comparePlotNo(key(a), key(b)))
}

/**
 * Group plots by scheme, then sort inside each — used where one list mixes schemes, so
 * the schemes stay together instead of interleaving by number.
 */
export function sortByProjectThenPlotNo<T>(
  rows: T[],
  projectName: (row: T) => string | null | undefined,
  plotNo: (row: T) => string | null | undefined = (r: any) => r?.plot_no,
): T[] {
  return [...rows].sort((a, b) => {
    const pa = String(projectName(a) ?? '').trim()
    const pb = String(projectName(b) ?? '').trim()
    if (pa !== pb) return pa.localeCompare(pb, 'en', { sensitivity: 'base' })
    return comparePlotNo(plotNo(a), plotNo(b))
  })
}
