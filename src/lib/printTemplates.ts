import { formatINR } from './utils'

export function printPaymentReceipt(p: any, ctx: { customer?: any; booking?: any; project?: any; plot?: any } = {}) {
  const { customer, booking, project, plot } = ctx
  const cust = customer || p.bp_bookings?.bp_customers || {}
  const bk   = booking || p.bp_bookings || {}
  const pj   = project || bk.bp_projects || {}
  const pl   = plot || bk.bp_plots || {}
  const date = p.payment_date ? new Date(p.payment_date).toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: '2-digit' }) : ''
  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"/><title>Receipt #${p.receipt_no || p.id?.slice(0,6).toUpperCase()}</title>
<style>
  @page{size:A5;margin:8mm}
  body{font-family:'Helvetica Neue',Arial,sans-serif;background:#fef9c3;color:#0f172a;font-size:12px;padding:18px;max-width:520px;margin:auto}
  .head{display:flex;align-items:center;justify-content:space-between;border-bottom:2px solid #0f172a;padding-bottom:8px;margin-bottom:12px}
  .brand{font-size:22px;font-weight:900;letter-spacing:1px;color:#0f172a}
  .brand small{display:block;font-size:9px;font-weight:500;color:#475569;letter-spacing:0.5px}
  .meta{text-align:right;font-size:10px;color:#475569}
  .rcptno{font-weight:800;color:#dc2626;font-size:14px}
  h2{text-align:center;font-size:13px;letter-spacing:3px;text-decoration:underline;margin:10px 0}
  .row{display:flex;border-bottom:1px dotted #475569;padding:5px 0}
  .row .lbl{width:38%;color:#475569;font-size:10px}
  .row .val{flex:1;font-weight:600}
  .amount{margin:14px 0;padding:12px;background:#fff;border:2px dashed #0f172a;border-radius:8px;text-align:center}
  .amount .v{font-size:24px;font-weight:900;color:#16a34a}
  .amount .w{font-size:11px;color:#475569;font-style:italic;margin-top:4px}
  .terms{font-size:9px;color:#475569;margin-top:14px;border-top:1px solid #cbd5e1;padding-top:8px}
  .sig{margin-top:20px;display:flex;justify-content:space-between;font-size:10px;color:#475569}
  .sig .box{border-top:1px solid #0f172a;padding-top:4px;width:42%;text-align:center}
  @media print{body{padding:8mm}}
</style>
</head>
<body>
  <div class="head">
    <div class="brand">FANBE DEVELOPERS<small>2nd Floor, Balaji Tower, Plot No.35, Nathu Colony, Opp. Agarwal Dharamshala, Ballabgarh, Faridabad &middot; www.fanbeindia.com &middot; fanbeindia@gmail.com</small></div>
    <div class="meta">Receipt No: <span class="rcptno">${p.receipt_no || '—'}</span><br/>Date: <b>${date}</b></div>
  </div>
  <h2>ADJUSTMENT</h2>
  <div class="row"><div class="lbl">Received with thanks from</div><div class="val">Mr/Mrs ${cust.name || '—'}</div></div>
  <div class="row"><div class="lbl">S/o, W/o, D/o</div><div class="val">${cust.father_or_husband_name || '—'}</div></div>
  <div class="row"><div class="lbl">Mobile</div><div class="val">${cust.phone || cust.mobile || '—'}</div></div>
  <div class="row"><div class="lbl">Address</div><div class="val">${cust.address || '—'}</div></div>
  <div class="row"><div class="lbl">I.D. No</div><div class="val">${cust.customer_code || cust.member_code || '—'}</div></div>
  <div class="row"><div class="lbl">Plot No &amp; Size</div><div class="val">${pl.plot_no || pl.plot_number || '—'} / ${pl.size_sqyd || pl.area || '—'} sq</div></div>
  <div class="row"><div class="lbl">Product</div><div class="val">${pj.name || pj.project_name || '—'}</div></div>
  <div class="row"><div class="lbl">Vide cash / Cheque / Draft No</div><div class="val">${p.is_cash_adjustment ? 'Cash adj' : (p.utr_ref || p.reference_no || '—')}${p.instalment_no ? ' · inst ' + p.instalment_no : ''}</div></div>
  <div class="row"><div class="lbl">Drawn On</div><div class="val">${p.drawn_on_bank || (p.payment_mode==='cash'?'Cash':'—')}</div></div>
  <div class="row"><div class="lbl">Branch</div><div class="val">${p.branch || '—'}</div></div>
  <div class="row"><div class="lbl">Sponsor's Name</div><div class="val">${p.sponsor_name || '—'}</div></div>
  <div class="amount">
    <div class="v">${formatINR(p.amount)}</div>
    <div class="w">${p.rupees_in_words || ''}</div>
  </div>
  ${p.subject_to_realisation ? '<div class="terms">Subject to realisation of Cheque / Draft.</div>' : ''}
  <div class="sig">
    <div class="box">Customer Signature</div>
    <div class="box">For FANBE DEVELOPERS<br/>Authorised Signatory</div>
  </div>
  <script>window.onload=()=>setTimeout(()=>window.print(),200)</script>
</body></html>`
  const w = window.open('', '_blank', 'width=620,height=820')
  if (w) { w.document.write(html); w.document.close() }
}

export function printApplicationForm(b: any, ctx: { customer?: any; project?: any; plot?: any; broker?: any } = {}) {
  const cust = ctx.customer || b.bp_customers || {}
  const pj   = ctx.project  || b.bp_projects  || {}
  const pl   = ctx.plot     || b.bp_plots     || {}
  const br   = ctx.broker   || b.brokers      || {}
  const fmtDate = (d: any) => d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: '2-digit' }) : ''
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
  @media print{body{padding:0}}
</style></head>
<body>
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
  <script>window.onload=()=>setTimeout(()=>window.print(),200)</script>
</body></html>`
  const w = window.open('', '_blank', 'width=900,height=1100')
  if (w) { w.document.write(html); w.document.close() }
}
