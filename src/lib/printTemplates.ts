import { formatINR } from './utils'
import { BRAND } from './branding'

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
export function printPaymentReceipt(p: any, ctx: { customer?: any; booking?: any; project?: any; plot?: any } = {}) {
  const { customer, booking, project, plot } = ctx
  const cust = customer || p.bp_bookings?.bp_customers || {}
  const bk   = booking || p.bp_bookings || {}
  const pj   = project || bk.bp_projects || {}
  const pl   = plot || bk.bp_plots || {}
  const date = p.payment_date ? new Date(p.payment_date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
  const amount = Number(p.amount || 0)
  const inWords = p.rupees_in_words || toWordsINR(amount)
  const title = paymentTypeLabel(p.payment_type)

  const half = (copyLabel: string) => `
    <section class="half">
      <div class="copy-tag">${copyLabel}</div>
      <div class="head">
        <div class="brand">
          ${BRAND.company.toUpperCase()}
          <small>${BRAND.address}</small>
          <small>${BRAND.website}${BRAND.email ? ' · ' + BRAND.email : ''}${BRAND.phone ? ' · ' + BRAND.phone : ''}</small>
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
        <div class="box">For ${BRAND.company.toUpperCase()}<br/>Authorised Signatory</div>
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
  .half { position: relative; flex: 1 1 0; padding: 6mm 8mm; border: 1px solid #cbd5e1; border-radius: 6px; background:#fff }
  .copy-tag { position:absolute; top:6mm; right:8mm; font-size:9px; font-weight:700; letter-spacing:1px; color:#94a3b8 }
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

export function printApplicationForm(b: any, ctx: { customer?: any; project?: any; plot?: any; broker?: any; payments?: any[] } = {}) {
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
  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"/><title>Application Form — ${b.booking_no || ''}</title>
<style>
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
</style></head>
<body>
  <div class="toolbar">
    <button class="pr" onclick="window.print()">🖨 Print form</button>
    <button class="cl" onclick="window.close()">Close</button>
    <span>Cancelled the dialog? Tap Print again.</span>
  </div>
  <div class="toolbar-spacer" style="height:48px"></div>
  <div class="header">
    <div class="logo">${BRAND.company.split(/\s+/).map(w => w.charAt(0)).join('').slice(0, 2).toUpperCase()}</div>
    <div><div class="title">${BRAND.company.toUpperCase()}</div><div style="font-size:10px;color:#64748b">${BRAND.applicationTagline}</div></div>
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
  <p class="accept">मैंने <b>${BRAND.company.toUpperCase()}</b> के सभी नियम व शर्तें पढ़ व समझ ली है तथा ये मुझे स्वीकार है! मैं अपने पूर्ण विवेक से इस योजना का सदस्य बन रहा/रही हूँ!</p>

  <div class="sigrow"><div class="sigbox">हस्ताक्षर</div><div class="sigbox">हस्ताक्षर परिचयकर्ता</div><div class="sigbox">हस्ताक्षर मैनेजर<br/>${b.manager_signature_by || ''}</div></div>
  <script>window.onload=()=>setTimeout(()=>window.print(),200)</script>
</body></html>`
  const w = window.open('', '_blank', 'width=900,height=1100')
  if (w) { w.document.write(html); w.document.close() }
}
