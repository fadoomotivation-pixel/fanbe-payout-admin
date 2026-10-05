// One way to hand the user a file.  Every CSV button in the app goes through here.
//
// Each page used to build its own <a download>, click it, and revoke the blob URL on the
// very next line.  Chrome on Android (and some desktop browsers) starts the download a
// moment after the click — by then the URL was already gone, so nothing downloaded.  The
// link was also never attached to the page, which Firefox needs.  And with no byte-order
// mark, Excel opened the UTF-8 file as ANSI, so "₹" and Hindi names came out garbled.

/** Hand a Blob to the browser as a download. */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.rel = 'noopener'
  a.style.display = 'none'
  document.body.appendChild(a)
  a.click()
  a.remove()
  // Long enough for any browser to have picked the file up; then free the memory.
  setTimeout(() => URL.revokeObjectURL(url), 60_000)
}

// A cell starting with = + - @ is run as a formula when the file is opened in Excel —
// a customer name like "=HYPERLINK(...)" would execute.  Plain numbers (including negative
// ones) are left alone.
function cell(v: unknown): string {
  let s = v == null ? '' : String(v)
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`
  return `"${s.replace(/"/g, '""')}"`
}

/** Rows (first row = headers) to CSV text. */
export function toCsv(rows: unknown[][]): string {
  return rows.map(r => r.map(cell).join(',')).join('\r\n')
}

/** Build and download a CSV that opens cleanly in Excel. */
export function downloadCsv(filename: string, rows: unknown[][]): void {
  const name = filename.toLowerCase().endsWith('.csv') ? filename : `${filename}.csv`
  saveBlob(new Blob(['﻿' + toCsv(rows)], { type: 'text/csv;charset=utf-8' }), name)
}

/** Download any JSON-serialisable value as a .json file. */
export function downloadJson(filename: string, value: unknown): void {
  saveBlob(new Blob([JSON.stringify(value, null, 1)], { type: 'application/json' }), filename)
}
