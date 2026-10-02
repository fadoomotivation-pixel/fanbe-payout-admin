import { formatINR } from './utils'
import { supabase } from './supabase'

// Receipts printed more than once must be marked DUPLICATE COPY (admin: "duplicate
// receipt if customer took 2nd recipt it should show").  We know a reprint two ways:
//   - the payment row carries print_count > 0 (it was printed in a PAST session), or
//   - we already printed it in THIS browser session (below).
// Either signal flags the copy.  We also fire-and-forget an atomic DB bump so the
// count survives across sessions/devices.
const printedThisSession = new Set<string>()

function toWordsINR(n: number): string {
  if (!n || isNaN(n)) return ''
  const a = ['','One','Two','Three','Four','Five','Six','Seven','Eight','Nine','Ten','Eleven','Twelve','Thirteen','Fourteen','Fifteen','Sixteen','Seventeen','Eighteen','Nineteen']
  const b = ['','','Twenty','Thirty','Forty','Fifty','Sixty','Seventy','Eighty','Ninety']
  const num = Math.floor(n); if (num === 0) return 'Zero only'
  const w = (x: number): string => x < 20 ? a[x] : x < 100 ? b[Math.floor(x/10)] + (x%10?' '+a[x%10]:'') : x < 1000 ? a[Math.floor(x/100)] + ' Hundred' + (x%100?' '+w(x%100):'') : ''
  let out = ''
  const cr = Math.floor(num/10000000); const la = Math.floor((num%10000000)/100000); const th = Math.floor((num%100000)/1000); const rest = num%1000
  if (cr) out += w(cr) + ' Crore '
  if (la) out += w(la) + ' Lakh '
  if (th) out += w(th) + ' Thousand '
  if (rest) out += w(rest)
  return (out.trim() || 'Zero') + ' only'
}

// Days an instalment may sit unpaid before the booking counts as lapsed.  Same number
// payoutEngine uses for commission lapsation (lapsation_grace_days), kept in step so
// "overdue" means one thing across the app.
const LAPSE_GRACE_DAYS = 90

/**
 * The worst unpaid instalment on a booking, if any has run past the grace window.
 * Returns null when the booking is clean, has no EMI schedule, or can't be checked —
 * a lookup failure must never be the reason a receipt won't print.
 */
async function findLapsedInstalment(bookingId: string | undefined | null) {
  if (!bookingId) return null
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - LAPSE_GRACE_DAYS)
  try {
    const { data, error } = await supabase
      .from('emi_installments')
      .select('seq, due_date, amount, status, emi_schedules!inner(booking_id)')
      .eq('emi_schedules.booking_id', bookingId)
      .neq('status', 'paid')
      .lt('due_date', cutoff.toISOString().slice(0, 10))
      .order('due_date', { ascending: true })
    if (error || !data || data.length === 0) return null
    const worst: any = data[0]
    const daysOverdue = Math.floor((Date.now() - new Date(worst.due_date).getTime()) / 86400000)
    return { seq: worst.seq, due_date: worst.due_date, amount: Number(worst.amount || 0), daysOverdue, count: data.length }
  } catch {
    return null
  }
}

function paymentTypeLabel(t: string | undefined): string {
  switch (t) {
    case 'token':        return 'TOKEN RECEIPT'
    case 'booking':      return 'BOOKING DEPOSIT RECEIPT'
    case 'full_payment': return 'FULL PAYMENT RECEIPT'
    case 'emi':          return 'EMI INSTALMENT RECEIPT'
    default:             return 'PAYMENT RECEIPT'
  }
}

/**
 * A4 portrait receipt: SAME information twice on one page.
 *   Top half  → tear off and hand to customer
 *   Bottom half → keep in office binder (company copy)
 * A dashed cut-line and "✂ Cut here" hint sit between the halves.
 */
// Who sold this booking.  Admin asked for the broker's name and code to be on the EMI
// receipt, and the receipt is printed from six different places — the payments page, the
// EMI panel, the pipeline, the broker portal.  Rather than make all six fetch and pass a
// broker (six chances to pass the wrong one, or forget), the single receipt function looks
// it up itself when the caller has not already supplied one.
async function findBookingBroker(bookingId: string | undefined | null, supplied?: any) {
  if (supplied?.name || supplied?.broker_id) return supplied
  if (!bookingId) return null
  try {
    const { data: bk } = await supabase
      .from('bp_bookings').select('broker_id').eq('id', bookingId).maybeSingle()
    if (!bk?.broker_id) return null
    const { data: brk } = await supabase
      .from('brokers').select('name, broker_id, phone').eq('id', bk.broker_id).maybeSingle()
    return brk || null
  } catch {
    // A receipt the customer is waiting for must print even if this lookup fails.
    return null
  }
}

export async function printPaymentReceipt(p: any, ctx: { customer?: any; booking?: any; project?: any; plot?: any; broker?: any } = {}) {
  // Receipts are held back on a booking whose EMI has gone unpaid past the 90-day
  // lapsation window (the same grace period payoutEngine uses).  Admin asked for the
  // block here rather than at each button because this function is the single
  // chokepoint every one of the six print sites goes through.
  //
  // It asks rather than hard-blocks: the payment being receipted may be the very one
  // clearing the arrears, and a receipt the customer is standing there waiting for must
  // never be permanently unreachable.  The warning names the worst instalment so the
  // decision is an informed one.
  const lapse = await findLapsedInstalment(p.booking_id || ctx.booking?.id)
  if (lapse) {
    const proceed = window.confirm(
      `⚠️  EMI overdue on this booking\n\n` +
      `Instalment #${lapse.seq} of ${formatINR(lapse.amount)} was due on ${new Date(lapse.due_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })} ` +
      `— ${lapse.daysOverdue} days ago (past the 90-day limit).` +
      (lapse.count > 1 ? `\n${lapse.count} instalments are overdue in total.` : '') +
      `\n\nReceipts are held back until the arrears are cleared.\n\n` +
      `Print anyway?`,
    )
    if (!proceed) return
  }

  const { customer, booking, project, plot } = ctx
  const cust = customer || p.bp_bookings?.bp_customers || {}
  const bk   = booking || p.bp_bookings || {}
  const pj   = project || bk.bp_projects || {}
  const pl   = plot || bk.bp_plots || {}
  const brk  = await findBookingBroker(p.booking_id || bk.id, ctx.broker || bk.brokers)
  const brokerLine = brk
    ? `${brk.name || '—'}${brk.broker_id ? ` [${brk.broker_id}]` : ''}`
    : '—'
  const date = p.payment_date ? new Date(p.payment_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
  const amount = Number(p.amount || 0)
  const inWords = p.rupees_in_words || toWordsINR(amount)
  const title = paymentTypeLabel(p.payment_type)

  // Duplicate detection.  priorPrints = times printed BEFORE this render; if > 0 (or
  // we already printed it this session) this is a reprint → stamp DUPLICATE.  The
  // reprint number shown is priorPrints + 1 (so the 2nd copy reads "Reprint #2").
  const priorPrints = Number(p.print_count ?? 0)
  const isDuplicate = priorPrints > 0 || (p.id && printedThisSession.has(p.id))
  const reprintNo = priorPrints + 1
  if (p.id) {
    printedThisSession.add(p.id)
    // Fire-and-forget: bump the stored counter so future sessions know it's a reprint.
    // Never blocks or breaks the print if it fails (e.g. offline).
    try { supabase.rpc('bump_receipt_print', { p_payment: p.id }).then(() => {}, () => {}) } catch { /* ignore */ }
  }

  const half = (copyLabel: string) => `
    <section class="half${isDuplicate ? ' dup' : ''}">
      ${isDuplicate ? '<div class="dup-mark">DUPLICATE</div>' : ''}
      <div class="copy-tag">${copyLabel}${isDuplicate ? ` · DUPLICATE COPY · Reprint #${reprintNo}` : ''}</div>
      <div class="head">
        <div class="brand">
          FANBE DEVELOPERS
          <small>2nd Floor, Balaji Tower, Plot No.35, Nathu Colony, Opp. Agarwal Dharamshala, Ballabgarh, Faridabad</small>
          <small>www.fanbeindia.com · fanbeindia@gmail.com</small>
        </div>
        <div class="meta">
          <div>Receipt No</div>
          <div class="rcptno">${p.receipt_no || '—'}</div>
          <div>Date: <b>${date}</b></div>
        </div>
      </div>

      <h2>${title}</h2>

      <div class="grid">
        <div class="row"><div class="lbl">Received from</div><div class="val">${cust.name || '—'}</div></div>
        <div class="row"><div class="lbl">S/o, W/o, D/o</div><div class="val">${cust.father_or_husband_name || '—'}</div></div>
        <div class="row"><div class="lbl">Mobile</div><div class="val">${cust.phone || cust.mobile || '—'}</div></div>
        <div class="row"><div class="lbl">Customer ID</div><div class="val">${cust.customer_code || cust.member_code || '—'}</div></div>
        <div class="row"><div class="lbl">Plot &amp; Size</div><div class="val">${pl.plot_no || pl.plot_number || '—'}${pl.size_sqyd ? ' / ' + pl.size_sqyd + ' sq.yd' : ''}</div></div>
        <div class="row"><div class="lbl">Project</div><div class="val">${pj.name || pj.project_name || '—'}</div></div>
        <div class="row"><div class="lbl">Booking No</div><div class="val">${bk.booking_no || '—'}</div></div>
        <div class="row"><div class="lbl">Broker / Agent</div><div class="val">${brokerLine}</div></div>
        <div class="row"><div class="lbl">Mode</div><div class="val">${(p.payment_mode || '—').toUpperCase()}${p.instalment_no ? ' · Instalment ' + p.instalment_no : ''}</div></div>
        <div class="row"><div class="lbl">${p.payment_mode === 'cheque' ? 'Cheque No' : p.payment_mode === 'dd' ? 'Draft No' : 'UTR / Ref'}</div><div class="val">${p.utr_ref || p.reference_no || (p.payment_mode === 'cash' ? 'Cash' : '—')}</div></div>
        <div class="row"><div class="lbl">Drawn On / Branch</div><div class="val">${(p.drawn_on_bank || (p.payment_mode === 'cash' ? 'Cash' : '—'))}${p.branch ? ' · ' + p.branch : ''}</div></div>
      </div>

      <div class="amount">
        <div class="v">${formatINR(amount)}</div>
        <div class="w">${inWords}</div>
      </div>

      ${p.subject_to_realisation ? '<div class="terms">Subject to realisation of Cheque / Draft.</div>' : ''}

      <div class="sig">
        <div class="box">Customer Signature</div>
        <div class="box">For FANBE DEVELOPERS<br/>Authorised Signatory</div>
      </div>
    </section>
  `

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"/><title>Receipt ${p.receipt_no || ''}</title>
<style>
  @page { size: A4 portrait; margin: 0 }
  * { box-sizing: border-box }
  body { font-family:'Helvetica Neue',Arial,sans-serif; color:#0f172a; font-size:11px; margin:0; padding:0; background:#fff }
  .page { width: 210mm; height: 297mm; padding: 12mm; display: flex; flex-direction: column; gap: 8mm }
  .half { position: relative; flex: 1 1 0; padding: 6mm 8mm; border: 1px solid #cbd5e1; border-radius: 6px; background:#fff; overflow:hidden }
  .half.dup { border-color:#fecaca }
  .copy-tag { position:absolute; top:6mm; right:8mm; font-size:9px; font-weight:700; letter-spacing:1px; color:#94a3b8; z-index:2 }
  .half.dup .copy-tag { color:#dc2626 }
  /* Big diagonal DUPLICATE watermark behind the content — visible but light so the
     printed receipt stays readable. */
  .dup-mark { position:absolute; top:50%; left:50%; transform:translate(-50%,-50%) rotate(-24deg);
    font-size:54px; font-weight:900; letter-spacing:8px; color:rgba(220,38,38,0.12);
    border:4px solid rgba(220,38,38,0.14); border-radius:10px; padding:6px 26px; white-space:nowrap; z-index:1; pointer-events:none }
  .cut { display:flex; align-items:center; gap:6px; color:#94a3b8; font-size:9px; letter-spacing:2px }
  .cut .line { flex:1; border-top: 1.2px dashed #94a3b8 }
  .head { display:flex; align-items:flex-start; justify-content:space-between; border-bottom:1.5px solid #0f172a; padding-bottom:5px; margin-bottom:8px }
  .brand { font-size:14px; font-weight:900; letter-spacing:0.6px; color:#0f172a; line-height:1.15 }
  .brand small { display:block; font-size:7.5px; font-weight:500; color:#475569; letter-spacing:0.2px; margin-top:2px }
  .meta { text-align:right; font-size:8.5px; color:#475569; line-height:1.5 }
  .rcptno { font-weight:800; color:#dc2626; font-size:13px; letter-spacing:0.5px }
  h2 { text-align:center; font-size:11px; letter-spacing:3px; text-decoration:underline; margin:6px 0 8px }
  .grid { display:grid; grid-template-columns:1fr 1fr; gap:0 12px }
  .row { display:flex; padding:3px 0; border-bottom:1px dotted #cbd5e1; font-size:10px }
  .row .lbl { width:42%; color:#64748b; font-size:8.5px; padding-top:1px }
  .row .val { flex:1; font-weight:600 }
  .amount { margin:8px 0; padding:8px; background:#f8fafc; border:1.5px dashed #0f172a; border-radius:6px; text-align:center }
  .amount .v { font-size:20px; font-weight:900; color:#16a34a; letter-spacing:0.5px }
  .amount .w { font-size:9.5px; color:#475569; font-style:italic; margin-top:2px }
  .terms { font-size:8px; color:#475569; margin-top:6px; border-top:1px solid #e2e8f0; padding-top:4px }
  .sig { margin-top:10px; display:flex; justify-content:space-between; font-size:8.5px; color:#475569 }
  .sig .box { border-top:1px solid #0f172a; padding-top:3px; width:44%; text-align:center }
  @media print { .page { box-shadow:none } .toolbar, .toolbar-spacer { display:none !important } }
  .toolbar{position:fixed;top:0;left:0;right:0;display:flex;gap:10px;justify-content:center;align-items:center;padding:10px;background:#0f172a;z-index:9999}
  .toolbar button{font:600 13px/1 'Helvetica Neue',Arial,sans-serif;padding:9px 18px;border-radius:8px;border:0;cursor:pointer}
  .toolbar .pr{background:#16a34a;color:#fff}
  .toolbar .cl{background:#334155;color:#e2e8f0}
  .toolbar span{color:#94a3b8;font:500 11px/1.3 'Helvetica Neue',Arial,sans-serif}
</style>
</head>
<body>
  <div class="toolbar">
    <button class="pr" onclick="window.print()">🖨 Print receipt</button>
    <button class="cl" onclick="window.close()">Close</button>
    <span>Cancelled the dialog? Tap Print again.</span>
  </div>
  <div class="toolbar-spacer" style="height:48px"></div>
  <div class="page">
    ${half('CUSTOMER COPY')}
    <div class="cut"><span class="line"></span>✂ &nbsp; CUT HERE &nbsp; ✂<span class="line"></span></div>
    ${half('OFFICE COPY')}
  </div>
  <script>window.onload=()=>setTimeout(()=>window.print(),300)</script>
</body></html>`
  const w = window.open('', '_blank', 'width=820,height=1100')
  if (w) { w.document.write(html); w.document.close() }
}

const FORM_CSS = `
  @page{size:A4;margin:10mm}
  body{font-family:'Helvetica Neue',Arial,sans-serif;color:#0f172a;font-size:12px;max-width:760px;margin:auto;padding:14px}
  .header{display:flex;align-items:center;gap:14px;border-bottom:3px solid #1d4ed8;padding-bottom:10px}
  .logo{width:54px;height:54px;border-radius:10px;background:#1d4ed8;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:900;font-size:22px}
  .title{font-size:22px;font-weight:900;color:#1d4ed8;letter-spacing:1px}
  .sub{text-align:center;margin:14px 0 6px}
  .sub h2{font-size:18px;color:#3730a3;margin:0}
  .sub h3{font-size:13px;color:#dc2626;text-decoration:underline;margin:4px 0 0;display:inline-block}
  .row{display:flex;gap:14px;margin:5px 0}
  .field{flex:1;display:flex;align-items:flex-end;gap:6px;border-bottom:1px dotted #64748b;padding-bottom:2px;font-size:11px}
  .field b{color:#64748b;font-weight:500;white-space:nowrap}
  .field span{font-weight:700;flex:1}
  .section-title{font-weight:700;color:#7c2d12;margin-top:14px;font-size:13px;border-bottom:1px solid #fdba74;padding-bottom:2px}
  .aff{font-size:10px;margin-top:14px}
  .aff h4{margin:0 0 4px;color:#7c2d12;font-size:13px}
  .aff ol{padding-left:20px;line-height:1.5;color:#1e293b}
  .accept{margin-top:10px;font-size:11px;font-style:italic}
  .sigrow{display:flex;justify-content:space-between;margin-top:30px}
  .sigbox{flex:1;text-align:center;font-size:10px;color:#64748b;padding-top:4px;border-top:1px solid #0f172a;margin:0 8px}
  .pay{width:100%;border-collapse:collapse;font-size:10px;margin-top:6px;border:1px solid #cbd5e1}
  .pay thead th{background:#f1f5f9;color:#475569;text-align:left;padding:5px 6px;font-size:9.5px;letter-spacing:0.4px;border-bottom:1px solid #cbd5e1}
  .pay tbody td{padding:5px 6px;border-bottom:1px dotted #e2e8f0}
  .pay tbody tr:last-child td{border-bottom:none}
  .pay .num{text-align:right;font-variant-numeric:tabular-nums}
  .pay .mono{font-family:'SFMono-Regular',Consolas,monospace;font-size:9.5px}
  .pay tfoot td{padding:5px 6px;border-top:1px solid #cbd5e1}
  .pay .ftr{background:#f8fafc;font-weight:600;color:#0f172a}
  .toolbar{position:fixed;top:0;left:0;right:0;display:flex;gap:10px;justify-content:center;align-items:center;padding:10px;background:#0f172a;z-index:9999}
  .toolbar button{font:600 13px/1 'Helvetica Neue',Arial,sans-serif;padding:9px 18px;border-radius:8px;border:0;cursor:pointer}
  .toolbar .pr{background:#16a34a;color:#fff}
  .toolbar .cl{background:#334155;color:#e2e8f0}
  .toolbar span{color:#94a3b8;font:500 11px/1.3 'Helvetica Neue',Arial,sans-serif}
  @media print{body{padding:0} .toolbar,.toolbar-spacer{display:none !important}}
`

// Builds one form's markup only.  Kept separate from the window/CSS wrapper so that
// printing twenty forms is the same template repeated, not a second copy of it that can
// drift away from the single-form version.
function applicationFormBody(b: any, ctx: { customer?: any; project?: any; plot?: any; broker?: any; payments?: any[] } = {}) {
  const cust = ctx.customer || b.bp_customers || {}
  const pj   = ctx.project  || b.bp_projects  || {}
  const pl   = ctx.plot     || b.bp_plots     || {}
  const br   = ctx.broker   || b.brokers      || {}
  const payments = (ctx.payments || []).slice().sort((a, b) => (a.payment_date || a.created_at || '').localeCompare(b.payment_date || b.created_at || ''))
  const fmtDate = (d: any) => d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: '2-digit' }) : ''
  const totalPaid = payments.reduce((s, p) => s + Number(p.amount || 0), 0)
  const totalNet  = Number(b.total_amount || b.plot_total_price || 0)
  const balance   = Math.max(0, totalNet - totalPaid)
  const typeLabel = (t: string | undefined) => t === 'token' ? 'Token' : t === 'booking' ? 'Booking' : t === 'emi' ? 'EMI' : t === 'full_payment' ? 'Full' : (t || '—')

  const paymentRows = payments.length
    ? payments.map((p, i) => `<tr>
        <td class="num">${i + 1}</td>
        <td>${fmtDate(p.payment_date || p.created_at)}</td>
        <td>${typeLabel(p.payment_type)}${p.instalment_no ? ' · #' + p.instalment_no : ''}</td>
        <td>${(p.payment_mode || '—').toUpperCase()}</td>
        <td class="mono">${p.receipt_no || '—'}</td>
        <td class="mono">${p.utr_ref || (p.payment_mode === 'cash' ? 'Cash' : '—')}</td>
        <td class="num">₹${Number(p.amount || 0).toLocaleString('en-IN')}</td>
      </tr>`).join('')
    : '<tr><td colspan="7" style="text-align:center;color:#94a3b8;padding:12px">No payments recorded yet.</td></tr>'

  const paymentBlock = `
    <div class="section-title">भुगतान विवरण / Payment History</div>
    <table class="pay">
      <thead>
        <tr><th>#</th><th>Date</th><th>Type</th><th>Mode</th><th>Receipt No</th><th>UTR / Ref</th><th>Amount</th></tr>
      </thead>
      <tbody>${paymentRows}</tbody>
      <tfoot>
        <tr>
          <td colspan="6" class="ftr">Total paid · ${payments.length} payment${payments.length !== 1 ? 's' : ''}</td>
          <td class="num ftr">₹${totalPaid.toLocaleString('en-IN')}</td>
        </tr>
        <tr>
          <td colspan="6" class="ftr">Plot total net</td>
          <td class="num ftr">₹${totalNet.toLocaleString('en-IN')}</td>
        </tr>
        <tr>
          <td colspan="6" class="ftr"><b>Balance due</b></td>
          <td class="num ftr" style="color:${balance > 0 ? '#dc2626' : '#16a34a'};font-weight:800">₹${balance.toLocaleString('en-IN')}</td>
        </tr>
      </tfoot>
    </table>
  `
  return `
  <div class="header">
    <div class="logo">FG</div>
    <div><div class="title">FANBE GROUP</div><div style="font-size:10px;color:#64748b">Success Starts Here</div></div>
  </div>
  <div class="sub"><h2>आवासीय भू-खण्ड योजना</h2><br/><h3>आवेदन-पत्र</h3></div>
  <div class="row"><div class="field"><b>आवासीय योजना का नाम</b><span>${b.scheme_name || pj.name || pj.project_name || ''}</span></div><div class="field" style="max-width:200px"><b>दिनांक</b><span>${fmtDate(b.application_date || b.created_at)}</span></div></div>
  <div class="row"><div class="field"><b>नाम</b><span>${cust.name || ''}</span></div><div class="field" style="max-width:200px"><b>जन्म तिथि</b><span>${fmtDate(cust.dob)}</span></div></div>
  <div class="row"><div class="field"><b>पिता/पति का नाम</b><span>${cust.father_or_husband_name || ''}</span></div></div>
  <div class="row"><div class="field"><b>स्थाई पता</b><span>${cust.address || ''}</span></div></div>
  <div class="row"><div class="field"><b>बुकिंग राशि</b><span>${b.booking_amount ? '₹' + Number(b.booking_amount).toLocaleString('en-IN') : ''}</span></div><div class="field"><b>बुकिंग राशि समय</b><span>${b.booking_time || ''}</span></div></div>
  <div class="row"><div class="field"><b>दूरभाष</b><span>${cust.phone || cust.mobile || ''}</span></div><div class="field"><b>ई-मेल</b><span>${cust.email || ''}</span></div></div>
  <div class="row"><div class="field"><b>बैंक का नाम</b><span>${b.customer_bank_name || ''}</span></div><div class="field" style="max-width:200px"><b>समय</b><span>${b.booking_time || ''}</span></div></div>
  <div class="row"><div class="field"><b>प्लॉट नं.</b><span>${pl.plot_no || pl.plot_number || ''}</span></div><div class="field"><b>वर्ग गज</b><span>${pl.size_sqyd || pl.area || ''}</span></div><div class="field"><b>प्रति वर्ग गज कीमत</b><span>${pl.sqft_rate ? '₹' + pl.sqft_rate : ''}</span></div><div class="field"><b>प्लॉट की कुल कीमत</b><span>${b.total_amount ? '₹' + Number(b.total_amount).toLocaleString('en-IN') : ''}</span></div></div>
  <div class="row"><div class="field"><b>परिचयकर्ता / Upline</b><span>${br.name || ''}</span></div><div class="field" style="max-width:240px"><b>परिचयकर्ता कोड नं.</b><span>${b.upline_broker_code || br.broker_id || ''}</span></div></div>

  <div class="section-title">उतराधिकारी / Nominee</div>
  <div class="row"><div class="field"><b>नाम</b><span>${cust.nominee_name || ''}</span></div><div class="field" style="max-width:240px"><b>सम्बन्ध</b><span>${cust.nominee_relation || ''}</span></div></div>
  <div class="row"><div class="field"><b>जन्म तिथि</b><span>${fmtDate(cust.nominee_dob)}</span></div><div class="field"><b>पिता/पति का नाम</b><span>${cust.nominee_father_name || ''}</span></div></div>
  <div class="row"><div class="field"><b>स्थाई पता</b><span>${cust.nominee_address || ''}</span></div><div class="field" style="max-width:240px"><b>पेन कार्ड नं.</b><span>${cust.nominee_pan || ''}</span></div></div>

  ${paymentBlock}

  <div class="aff"><h4>हलफनामा / Affidavit</h4><ol>
    <li>मैंने योजना में जमीन की स्थिति देख ली है, जो मुझे स्वीकार है।</li>
    <li>मैं अपने भूखण्ड की समस्त किस्तों की राशि जमा कराने के पश्चात् ही बेचने, रहने व भेंट करने के लिए स्वतंत्र हूँ।</li>
    <li>केन्द्र सरकार व राज्य सरकार द्वारा लगाया गया कर मेरे / आवेदनकर्ता द्वारा देय होगा।</li>
    <li>इकरारनामा/रजिस्ट्री करते समय जमा राशि की सभी रसीदें दिखाना आवश्यक होगा।</li>
    <li>मैं किस्तों का भुगतान नकद/चेक से ही करुंगा तथा इसके बदले में रसीदें प्राप्त करूँगा।</li>
    <li>मैंने समझ लिया है कि अगर मैं प्लॉट का आवंटन कम्पनी द्वारा निर्धारित समय पर नहीं करता हूँ, तो मेरे द्वारा जमा सम्पूर्ण राशि केवल कम्पनी के किसी दूसरे उपलब्ध प्लॉट में ही हस्तांतरित करा सकता है।</li>
  </ol></div>
  <p class="accept">मैंने <b>FANBE GROUP</b> के सभी नियम व शर्तें पढ़ व समझ ली है तथा ये मुझे स्वीकार है! मैं अपने पूर्ण विवेक से इस योजना का सदस्य बन रहा/रही हूँ!</p>

  <div class="sigrow"><div class="sigbox">हस्ताक्षर</div><div class="sigbox">हस्ताक्षर परिचयकर्ता</div><div class="sigbox">हस्ताक्षर मैनेजर<br/>${b.manager_signature_by || ''}</div></div>
`
}

// Opens one window holding any number of forms, each starting on its own sheet.
function openApplicationForms(items: { b: any; ctx?: any }[], title: string) {
  if (items.length === 0) return
  const bodies = items
    .map(it => applicationFormBody(it.b, it.ctx || {}))
    .join('<div style="break-after:page;page-break-after:always"></div>')
  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"/><title>${title}</title>
<style>
${FORM_CSS}
</style></head>
<body>
  <div class="toolbar">
    <button class="pr" onclick="window.print()">\u{1F5A8} Print${items.length > 1 ? ` ${items.length} forms` : ' form'}</button>
    <button class="cl" onclick="window.close()">Close</button>
    <span>Cancelled the dialog? Tap Print again.</span>
  </div>
  <div class="toolbar-spacer" style="height:48px"></div>
  ${bodies}
  <script>window.onload=()=>setTimeout(()=>window.print(),200)</script>
</body></html>`
  const w = window.open('', '_blank', 'width=900,height=1100')
  if (w) { w.document.write(html); w.document.close() }
}

export function printApplicationForm(b: any, ctx: { customer?: any; project?: any; plot?: any; broker?: any; payments?: any[] } = {}) {
  openApplicationForms([{ b, ctx }], `Application Form \u2014 ${b.booking_no || ''}`)
}

// Bulk: one window, one print dialog, one form per sheet.  Printing them one at a time
// meant a popup and a dialog per booking, which the browser blocks after the first few.
export function printApplicationForms(items: { b: any; ctx?: any }[]) {
  openApplicationForms(items, `Application Forms \u2014 ${items.length}`)
}

// ── Expense payment voucher ─────────────────────────────────────────
//
// Admin: "expense ka print out kr sake" / "expenses voucher reciept printing option".
//
// A payment voucher is not a receipt.  A receipt says money came IN and is given to the
// customer; a voucher says money went OUT and is the office's own record — it carries who
// authorised it, who handed the cash over, who took it, and a signature from the person
// who received it.  That last signature is the whole point: without it there is nothing on
// paper tying a name to the cash, which is exactly the gap the "paid to" field was added
// for.  So this prints two halves on one A4: the office keeps one, the payee signs and
// returns the other.

type VoucherCtx = { head?: string; broker?: any }

function voucherBody(e: any, ctx: VoucherCtx = {}, copyLabel: string) {
  const amount = Number(e.amount || 0)
  const date = e.expense_date
    ? new Date(e.expense_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
    : '—'
  const brk = ctx.broker
  const brokerLine = brk ? `${brk.name || '—'}${brk.broker_id ? ` [${brk.broker_id}]` : ''}` : ''
  const mode = (e.payment_mode || '—').toUpperCase()
  // A cash payment has no reference to quote, so say "Cash" rather than leave a blank that
  // looks like a missing field.
  const refLabel = e.payment_mode === 'cheque' ? 'Cheque No' : e.payment_mode === 'cash' ? 'Reference' : 'UTR / Ref'
  const refValue = e.reference_no || (e.payment_mode === 'cash' ? 'Cash payment' : '—')

  return `
    <section class="half">
      <div class="copy-tag">${copyLabel}</div>
      <div class="head">
        <div class="brand">
          FANBE DEVELOPERS
          <small>2nd Floor, Balaji Tower, Plot No.35, Nathu Colony, Opp. Agarwal Dharamshala, Ballabgarh, Faridabad</small>
          <small>www.fanbeindia.com &middot; fanbeindia@gmail.com</small>
        </div>
        <div class="meta">
          <div>Voucher No</div>
          <div class="vno">${e.voucher_no || '—'}</div>
          <div>Date: <b>${date}</b></div>
        </div>
      </div>

      <h2>PAYMENT VOUCHER</h2>

      <div class="grid">
        <div class="row"><div class="lbl">Paid to</div><div class="val strong">${e.paid_to || '<span class="miss">not recorded</span>'}</div></div>
        <div class="row"><div class="lbl">Expense head</div><div class="val">${ctx.head || '—'}</div></div>
        <div class="row"><div class="lbl">Particulars</div><div class="val">${e.item_name || '—'}</div></div>
        ${brokerLine ? `<div class="row"><div class="lbl">Broker / Agent</div><div class="val">${brokerLine}</div></div>` : ''}
        <div class="row"><div class="lbl">Mode</div><div class="val">${mode}</div></div>
        <div class="row"><div class="lbl">${refLabel}</div><div class="val">${refValue}</div></div>
        <div class="row"><div class="lbl">Paid by</div><div class="val">${e.paid_by || '—'}</div></div>
        <div class="row"><div class="lbl">Approved by</div><div class="val">${e.responsible_person || '—'}</div></div>
        ${e.description ? `<div class="row wide"><div class="lbl">Notes</div><div class="val">${e.description}</div></div>` : ''}
      </div>

      <div class="amount">
        <div class="v">${formatINR(amount)}</div>
        <div class="w">${toWordsINR(amount)}</div>
      </div>

      <div class="declare">Received the above sum in full and final settlement of the particulars stated.</div>

      <div class="sig">
        <div class="box">Receiver&rsquo;s Signature<br/><small>${e.paid_to || ''}</small></div>
        <div class="box">Prepared / Paid by<br/><small>${e.paid_by || ''}</small></div>
        <div class="box">For FANBE DEVELOPERS<br/>Authorised Signatory</div>
      </div>
    </section>
  `
}

const VOUCHER_CSS = `
  @page { size: A4 portrait; margin: 0 }
  * { box-sizing: border-box }
  body { font-family:'Helvetica Neue',Arial,sans-serif; color:#0f172a; font-size:11px; margin:0; padding:0; background:#fff }
  .page { width:210mm; min-height:297mm; padding:12mm; display:flex; flex-direction:column; gap:8mm }
  .half { position:relative; flex:1 1 0; padding:6mm 8mm; border:1px solid #cbd5e1; border-radius:6px; background:#fff }
  .copy-tag { position:absolute; top:6mm; right:8mm; font-size:9px; font-weight:700; letter-spacing:1px; color:#94a3b8 }
  .head { display:flex; justify-content:space-between; gap:10mm; border-bottom:2px solid #0f172a; padding-bottom:3mm }
  .brand { font-size:16px; font-weight:900; letter-spacing:0.5px; line-height:1.15 }
  .brand small { display:block; font-size:8px; font-weight:400; color:#64748b; letter-spacing:0; margin-top:1.5mm }
  .meta { text-align:right; font-size:9px; color:#64748b; white-space:nowrap }
  .meta .vno { font-size:14px; font-weight:800; color:#b45309; letter-spacing:0.5px; margin:0.5mm 0 1mm }
  h2 { font-size:12px; letter-spacing:2px; text-align:center; margin:4mm 0 3mm; color:#b45309 }
  .grid { display:grid; grid-template-columns:1fr 1fr; gap:1.5mm 6mm }
  .row { display:flex; gap:2mm; align-items:baseline; border-bottom:1px dotted #cbd5e1; padding-bottom:1mm }
  .row.wide { grid-column:1 / -1 }
  .lbl { color:#64748b; font-size:9px; min-width:26mm }
  .val { font-weight:600; flex:1 }
  .val.strong { font-size:12px }
  .miss { color:#b45309; font-weight:500; font-style:italic }
  .amount { margin-top:4mm; padding:3mm 4mm; background:#fffbeb; border:1px solid #fde68a; border-radius:4px; display:flex; justify-content:space-between; align-items:center; gap:6mm }
  .amount .v { font-size:18px; font-weight:900; color:#92400e; white-space:nowrap }
  .amount .w { font-size:9.5px; color:#78350f; text-align:right; font-style:italic }
  .declare { margin-top:3mm; font-size:9px; color:#475569; font-style:italic }
  .sig { display:flex; gap:8mm; margin-top:9mm }
  .sig .box { flex:1; border-top:1px solid #0f172a; padding-top:1.5mm; font-size:9px; text-align:center; color:#475569 }
  .sig .box small { color:#94a3b8; font-size:8px }
  .toolbar { position:fixed; top:0; left:0; right:0; display:flex; gap:10px; justify-content:center; align-items:center; padding:10px; background:#0f172a; z-index:9999 }
  .toolbar button { font:600 13px/1 'Helvetica Neue',Arial,sans-serif; padding:9px 18px; border-radius:8px; border:0; cursor:pointer }
  .toolbar .pr { background:#16a34a; color:#fff }
  .toolbar .cl { background:#334155; color:#e2e8f0 }
  .toolbar span { color:#94a3b8; font:500 11px/1.3 'Helvetica Neue',Arial,sans-serif }
  @media print { .toolbar, .toolbar-spacer { display:none !important } }
`

function openVouchers(items: { e: any; ctx?: VoucherCtx }[], title: string) {
  if (items.length === 0) return
  // One sheet per voucher, office copy above payee copy — the same two-up arrangement the
  // payment receipt uses, so the office files both documents the same way.
  const pages = items
    .map(it => `<div class="page">${voucherBody(it.e, it.ctx || {}, 'OFFICE COPY')}${voucherBody(it.e, it.ctx || {}, 'PAYEE COPY')}</div>`)
    .join('<div style="break-after:page;page-break-after:always"></div>')

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"/><title>${title}</title>
<style>${VOUCHER_CSS}</style></head>
<body>
  <div class="toolbar">
    <button class="pr" onclick="window.print()">\u{1F5A8} Print${items.length > 1 ? ` ${items.length} vouchers` : ' voucher'}</button>
    <button class="cl" onclick="window.close()">Close</button>
    <span>Cancelled the dialog? Tap Print again.</span>
  </div>
  <div class="toolbar-spacer" style="height:48px"></div>
  ${pages}
  <script>window.onload=()=>setTimeout(()=>window.print(),200)</script>
</body></html>`

  const w = window.open('', '_blank', 'width=900,height=1100')
  if (w) { w.document.write(html); w.document.close() }
}

export function printExpenseVoucher(e: any, ctx: VoucherCtx = {}) {
  openVouchers([{ e, ctx }], `Voucher ${e.voucher_no || ''}`)
}

// Bulk print for a filtered period — one window and one dialog, because a popup per
// voucher is blocked by the browser after the first few.
export function printExpenseVouchers(items: { e: any; ctx?: VoucherCtx }[]) {
  openVouchers(items, `Vouchers — ${items.length}`)
}

// ── Customer register + EMI kist cards ──────────────────────────────
//
// Admin: "kon or kitni EMI h, printout kisto ki bhi yahi se ho jae".  Two printouts, both
// started from the Customer Pipeline:
//
//   printPipelineRegister — the list currently filtered on screen, ALL of it (not just the
//                           25 on the page), one line per booking with its EMI position:
//                           how many kist, how many paid, how many left, how many late.
//   printEmiCards         — one sheet per booking with every instalment on it, for the
//                           file or to hand to the customer.
//
// Both read numbers that were already worked out by lib/emiStatus, so a printed sheet says
// exactly what the screen said.  Text from the database is escaped before it goes into the
// print window: that window shares the app's origin, and a name is not trusted markup.

function esc(v: any): string {
  return String(v ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch] as string))
}
function d(v: any): string {
  if (!v) return '—'
  const s = String(v).slice(0, 10)
  const [y, m, dd] = s.split('-').map(Number)
  if (!y || !m || !dd) return esc(v)
  return new Date(y, m - 1, dd).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

function openPrintWindow(title: string, css: string, body: string, buttonLabel: string) {
  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"/><title>${esc(title)}</title>
<style>
${css}
  .toolbar{position:fixed;top:0;left:0;right:0;display:flex;gap:10px;justify-content:center;align-items:center;padding:10px;background:#0f172a;z-index:9999}
  .toolbar button{font:600 13px/1 'Helvetica Neue',Arial,sans-serif;padding:9px 18px;border-radius:8px;border:0;cursor:pointer}
  .toolbar .pr{background:#16a34a;color:#fff}.toolbar .cl{background:#334155;color:#e2e8f0}
  .toolbar span{color:#94a3b8;font:500 11px/1.3 'Helvetica Neue',Arial,sans-serif}
  @media print{.toolbar,.toolbar-spacer{display:none !important}}
</style></head>
<body>
  <div class="toolbar">
    <button class="pr" onclick="window.print()">\u{1F5A8} ${esc(buttonLabel)}</button>
    <button class="cl" onclick="window.close()">Close</button>
    <span>Cancelled the dialog? Tap Print again.</span>
  </div>
  <div class="toolbar-spacer" style="height:48px"></div>
  ${body}
  <script>window.onload=()=>setTimeout(()=>window.print(),250)</script>
</body></html>`
  const w = window.open('', '_blank', 'width=1100,height=900')
  if (w) { w.document.write(html); w.document.close() }
}

export type RegisterRow = {
  customer_name: string
  customer_code: string
  customer_phone: string
  booking_no: string
  legacy_booking_no?: string | null
  plot_no: string
  project_name: string
  broker_name: string
  broker_code: string
  commission_mode: string
  value: number
  paid: number
  balance: number
  emi?: { total: number; paid: number; left: number; overdue: number; amount_left: number; amount_overdue: number; next_due: string | null; per_inst: number } | null
}

export function printPipelineRegister(rows: RegisterRow[], meta: { title: string; filters: string[] }) {
  if (rows.length === 0) return
  const tot = rows.reduce((a, r) => ({
    value: a.value + r.value, paid: a.paid + r.paid, balance: a.balance + r.balance,
    kistLeft: a.kistLeft + (r.emi?.left || 0), kistLate: a.kistLate + (r.emi?.overdue || 0),
    late: a.late + (r.emi?.amount_overdue || 0), emiLeft: a.emiLeft + (r.emi?.amount_left || 0),
  }), { value: 0, paid: 0, balance: 0, kistLeft: 0, kistLate: 0, late: 0, emiLeft: 0 })
  const onPlan = rows.filter(r => r.emi).length

  const body = rows.map((r, i) => {
    const e = r.emi
    const late = !!e && e.overdue > 0
    return `<tr class="${late ? 'late' : ''}">
      <td class="n">${i + 1}</td>
      <td><b>${esc(r.customer_name || '—')}</b><div class="s">${esc(r.customer_code)}${r.customer_phone ? ' · ' + esc(r.customer_phone) : ''}</div></td>
      <td><span class="m">${esc(r.booking_no)}</span>${r.legacy_booking_no ? `<div class="s">old ${esc(r.legacy_booking_no)}</div>` : ''}<div class="s">Plot ${esc(r.plot_no || '—')}</div></td>
      <td>${esc(r.project_name || '—')}<div class="s">${r.commission_mode === 'traditional' ? 'Traditional' : 'MLM'}</div></td>
      <td>${esc(r.broker_name || '—')}${r.broker_code ? `<div class="s">${esc(r.broker_code)}</div>` : ''}</td>
      <td class="r">${r.value > 0 ? formatINR(r.value) : '<span class="warn">not set</span>'}</td>
      <td class="r">${formatINR(r.paid)}</td>
      <td class="r"><b>${formatINR(r.balance)}</b></td>
      <td class="c">${e ? `${e.paid}/${e.total}` : '—'}</td>
      <td class="c">${e ? `<b>${e.left}</b>` : '—'}${e && e.per_inst ? `<div class="s">${formatINR(e.per_inst)} ea</div>` : ''}</td>
      <td class="c">${late ? `<b class="bad">${e!.overdue}</b><div class="s bad">${formatINR(e!.amount_overdue)}</div>` : (e ? '0' : '—')}</td>
      <td class="c">${e?.next_due ? d(e.next_due) : '—'}</td>
    </tr>`
  }).join('')

  const css = `
  @page{size:A4 landscape;margin:9mm}
  *{box-sizing:border-box}
  body{font-family:'Helvetica Neue',Arial,sans-serif;color:#0f172a;font-size:10px;margin:0;padding:0 4mm}
  h1{font-size:15px;margin:0}
  .meta{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:2px solid #0f172a;padding-bottom:4px;margin-bottom:6px}
  .meta small{color:#64748b;font-size:9px}
  .f{color:#475569;font-size:9px;margin:2px 0 6px}
  .sum{display:flex;gap:6px;margin-bottom:6px;flex-wrap:wrap}
  .sum div{border:1px solid #e2e8f0;border-radius:4px;padding:3px 7px}
  .sum b{font-size:11px}
  table{width:100%;border-collapse:collapse}
  thead{display:table-header-group}
  th{background:#f1f5f9;color:#475569;font-size:8.5px;text-transform:uppercase;letter-spacing:.3px;text-align:left;padding:4px 5px;border-bottom:1px solid #cbd5e1}
  td{padding:4px 5px;border-bottom:1px solid #eef2f7;vertical-align:top}
  tr{page-break-inside:avoid}
  tr.late td{background:#fff5f5}
  .r{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
  .c{text-align:center;font-variant-numeric:tabular-nums;white-space:nowrap}
  .n{color:#94a3b8;width:22px}
  .m{font-family:'SFMono-Regular',Consolas,monospace}
  .s{color:#64748b;font-size:8.5px;margin-top:1px}
  .bad{color:#b91c1c}
  .warn{color:#b45309;font-style:italic}
  tfoot td{font-weight:700;border-top:2px solid #0f172a;background:#f8fafc}
  `
  const html = `
  <div class="meta">
    <div><h1>FANBE DEVELOPERS — ${esc(meta.title)}</h1>
      <div class="f">${meta.filters.length ? esc(meta.filters.join('  ·  ')) : 'All customers'}</div></div>
    <small>Printed ${d(new Date().toISOString())} · ${rows.length} booking${rows.length === 1 ? '' : 's'}</small>
  </div>
  <div class="sum">
    <div>Value <b>${formatINR(tot.value)}</b></div>
    <div>Collected <b>${formatINR(tot.paid)}</b></div>
    <div>Balance <b>${formatINR(tot.balance)}</b></div>
    <div>On EMI <b>${onPlan}</b></div>
    <div>Kist left <b>${tot.kistLeft}</b> · ${formatINR(tot.emiLeft)}</div>
    <div class="bad">Kist late <b>${tot.kistLate}</b> · ${formatINR(tot.late)}</div>
  </div>
  <table>
    <thead><tr>
      <th>#</th><th>Customer</th><th>Booking / Plot</th><th>Project</th><th>Broker</th>
      <th class="r">Value</th><th class="r">Paid</th><th class="r">Balance</th>
      <th class="c">Kist paid</th><th class="c">Kist left</th><th class="c">Late</th><th class="c">Next due</th>
    </tr></thead>
    <tbody>${body}</tbody>
    <tfoot><tr>
      <td></td><td colspan="4">Total · ${rows.length}</td>
      <td class="r">${formatINR(tot.value)}</td><td class="r">${formatINR(tot.paid)}</td><td class="r">${formatINR(tot.balance)}</td>
      <td></td><td class="c">${tot.kistLeft}</td><td class="c bad">${tot.kistLate}</td><td></td>
    </tr></tfoot>
  </table>`
  openPrintWindow(`${meta.title} — ${rows.length}`, css, html, `Print ${rows.length} rows`)
}

export type EmiCardItem = {
  detail: {
    schedule: any
    rows: { seq: number; due_date: string; amount: number; paid_amount: number; paid_at: string | null; due: number; state: 'paid' | 'overdue' | 'partial' | 'upcoming' }[]
    status: { total: number; paid: number; left: number; overdue: number; amount_total: number; amount_paid: number; amount_left: number; amount_overdue: number; next_due: string | null; per_inst: number }
  }
  customer?: any
  booking?: any
  plot?: any
  project?: any
  broker?: any
}

const STATE_LABEL: Record<string, string> = { paid: 'Paid', overdue: 'Late', partial: 'Part paid', upcoming: 'Due' }
const FREQ_LABEL: Record<string, string> = { monthly: 'Monthly', quarterly: 'Quarterly', half_yearly: 'Half-yearly', annual: 'Yearly', annually: 'Yearly' }

export function printEmiCards(items: EmiCardItem[]) {
  if (items.length === 0) return
  const sheets = items.map(it => {
    const { schedule: s, rows, status: st } = it.detail
    const c = it.customer || {}, b = it.booking || {}, pl = it.plot || {}, pj = it.project || {}, br = it.broker || {}
    const lines = rows.map(r => `
      <tr class="${r.state}">
        <td class="c">${r.seq}</td>
        <td>${d(r.due_date)}</td>
        <td class="r">${formatINR(r.amount)}</td>
        <td class="r">${r.state === 'paid' && !r.paid_amount ? formatINR(r.amount) : (r.paid_amount ? formatINR(r.paid_amount) : '—')}</td>
        <td>${r.paid_at ? d(r.paid_at) : '—'}</td>
        <td class="r">${r.due > 0 && r.state !== 'paid' ? formatINR(r.due) : '—'}</td>
        <td class="c"><span class="tag ${r.state}">${STATE_LABEL[r.state]}</span></td>
      </tr>`).join('')
    return `
    <section class="sheet">
      <div class="head">
        <div class="brand">FANBE DEVELOPERS<small>EMI schedule · kist card</small></div>
        <div class="meta">Booking <b>${esc(b.booking_no || '—')}</b><br/>Printed ${d(new Date().toISOString())}</div>
      </div>
      <div class="grid">
        <div><span>Customer</span><b>${esc(c.name || '—')}</b></div>
        <div><span>Customer ID</span><b>${esc(c.customer_code || '—')}</b></div>
        <div><span>Mobile</span><b>${esc(c.phone || '—')}</b></div>
        <div><span>Project</span><b>${esc(pj.name || '—')}</b></div>
        <div><span>Plot</span><b>${esc(pl.plot_no || '—')}${pl.size_sqyd ? ` · ${esc(pl.size_sqyd)} sq yd` : ''}</b></div>
        <div><span>Broker / Agent</span><b>${esc(br.name || '—')}${br.broker_id ? ` [${esc(br.broker_id)}]` : ''}</b></div>
        <div><span>EMI amount</span><b>${formatINR(Number(s?.total_payable || st.amount_total || 0))}</b></div>
        <div><span>Plan</span><b>${st.total} kist · ${esc(FREQ_LABEL[s?.frequency] || s?.frequency || '—')}${st.per_inst ? ` · ${formatINR(st.per_inst)} each` : ''}</b></div>
        <div><span>Started</span><b>${d(s?.start_date)}</b></div>
      </div>
      <div class="sum">
        <div class="ok">Paid <b>${st.paid}</b> kist · ${formatINR(st.amount_paid)}</div>
        <div>Left <b>${st.left}</b> kist · ${formatINR(st.amount_left)}</div>
        <div class="${st.overdue > 0 ? 'bad' : ''}">Late <b>${st.overdue}</b> kist · ${formatINR(st.amount_overdue)}</div>
        <div>Next due <b>${st.next_due ? d(st.next_due) : '—'}</b></div>
      </div>
      <table>
        <thead><tr><th class="c">Kist</th><th>Due date</th><th class="r">Amount</th><th class="r">Paid</th><th>Paid on</th><th class="r">Balance</th><th class="c">Status</th></tr></thead>
        <tbody>${lines || '<tr><td colspan="7" class="c">No instalments on this plan</td></tr>'}</tbody>
      </table>
      <div class="sig"><div>Customer signature</div><div>For FANBE DEVELOPERS<br/>Authorised signatory</div></div>
    </section>`
  }).join('<div style="break-after:page;page-break-after:always"></div>')

  const css = `
  @page{size:A4 portrait;margin:10mm}
  *{box-sizing:border-box}
  body{font-family:'Helvetica Neue',Arial,sans-serif;color:#0f172a;font-size:10.5px;margin:0}
  .sheet{padding:0 2mm}
  .head{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:2px solid #0f172a;padding-bottom:4px}
  .brand{font-size:16px;font-weight:900}
  .brand small{display:block;font-size:9px;font-weight:500;color:#64748b;letter-spacing:1px;text-transform:uppercase}
  .meta{text-align:right;font-size:9.5px;color:#475569}
  .grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:4px 10px;margin:8px 0}
  .grid div{border-bottom:1px dotted #cbd5e1;padding-bottom:2px}
  .grid span{display:block;color:#64748b;font-size:8.5px;text-transform:uppercase;letter-spacing:.3px}
  .sum{display:flex;gap:6px;margin:6px 0 8px;flex-wrap:wrap}
  .sum div{border:1px solid #e2e8f0;border-radius:4px;padding:4px 8px}
  .sum .ok{border-color:#a7f3d0;background:#ecfdf5}
  .sum .bad{border-color:#fecaca;background:#fef2f2;color:#991b1b}
  table{width:100%;border-collapse:collapse}
  thead{display:table-header-group}
  th{background:#f1f5f9;color:#475569;font-size:8.5px;text-transform:uppercase;letter-spacing:.3px;text-align:left;padding:4px 6px;border-bottom:1px solid #cbd5e1}
  td{padding:3.5px 6px;border-bottom:1px solid #eef2f7}
  tr{page-break-inside:avoid}
  tr.paid td{color:#64748b}
  tr.overdue td{background:#fff5f5}
  .r{text-align:right;font-variant-numeric:tabular-nums}
  .c{text-align:center}
  .tag{font-size:8.5px;font-weight:700;padding:1px 6px;border-radius:9px;border:1px solid}
  .tag.paid{color:#047857;border-color:#a7f3d0;background:#ecfdf5}
  .tag.overdue{color:#b91c1c;border-color:#fecaca;background:#fef2f2}
  .tag.partial{color:#b45309;border-color:#fde68a;background:#fffbeb}
  .tag.upcoming{color:#475569;border-color:#e2e8f0;background:#fff}
  .sig{display:flex;gap:30px;margin-top:22px}
  .sig div{flex:1;border-top:1px solid #0f172a;padding-top:3px;text-align:center;color:#475569;font-size:9px}
  `
  openPrintWindow(`EMI cards — ${items.length}`, css, sheets, items.length > 1 ? `Print ${items.length} EMI cards` : 'Print EMI card')
}
