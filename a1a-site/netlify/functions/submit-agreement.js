// netlify/functions/submit-agreement.js
//
// Receives the renter's info, uploaded documents, and signature from the
// rental agreement page. Sends two emails via Resend:
//   1. A confirmation to the renter (no attachments)
//   2. A full copy to the business, with the license / registration /
//      insurance uploads and the signature image attached.
//
// The Resend API key lives only in this server-side function (as an
// environment variable) and is never sent to the browser.

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const BUSINESS_EMAIL = process.env.BUSINESS_EMAIL || 'a1atrailerrentals@gmail.com';
const FROM_EMAIL = process.env.FROM_EMAIL || 'A1A Trailer Rentals <onboarding@resend.dev>';

function stripDataUrlPrefix(base64) {
  if (!base64) return '';
  const commaIdx = base64.indexOf(',');
  return commaIdx !== -1 ? base64.slice(commaIdx + 1) : base64;
}

async function sendEmail({ to, subject, html, attachments }) {
  const body = { from: FROM_EMAIL, to: [to], subject, html };
  if (attachments && attachments.length) body.attachments = attachments;
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${RESEND_API_KEY}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Resend error (${res.status}): ${text}`);
  }
  return res.json();
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  let data;
  try {
    data = JSON.parse(event.body || '{}');
  } catch (err) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const {
    name, email, phone, address, city, state, zip,
    trailerName, startDate, endDate,
    signature,        // base64 PNG data URL
    license, licenseFilename,
    registration, registrationFilename,
    insurance, insuranceFilename,
  } = data;

  if (!name || !email || !phone || !trailerName || !startDate || !endDate || !signature) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing required fields' }) };
  }
  if (!license || !registration || !insurance) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Required documents missing' }) };
  }
  if (!RESEND_API_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Server email is not configured (missing RESEND_API_KEY)' }) };
  }

  const fullAddress = [address, city, state, zip].filter(Boolean).join(', ');
  const submitDate = new Date().toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short' });

  const renterHtml = `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
      <div style="background:#0a1628;padding:24px;border-radius:8px 8px 0 0">
        <h1 style="color:#e03030;font-size:22px;margin:0">A1A Trailer Rentals</h1>
        <p style="color:rgba(255,255,255,0.5);margin:4px 0 0;font-size:13px">Rental Agreement &amp; Documents Received</p>
      </div>
      <div style="padding:24px;border:1px solid #eee;border-top:none;border-radius:0 0 8px 8px">
        <p>Hi <strong>${name}</strong>,</p>
        <p>Thanks! We've received your signed rental agreement and documents for the <strong>${trailerName}</strong>, ${startDate} &ndash; ${endDate}.</p>
        <p>Next step: complete payment (rental fee + refundable security deposit) to confirm your reservation. You'll be redirected to our secure payment page now.</p>
        <p style="margin-top:24px;color:#888;font-size:13px">A1A Trailer Rentals &nbsp;|&nbsp; 904-417-8106 &nbsp;|&nbsp; St. Augustine, FL</p>
      </div>
    </div>`;

  const businessHtml = `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
      <div style="background:#0a1628;padding:24px;border-radius:8px 8px 0 0">
        <h1 style="color:#e03030;font-size:22px;margin:0">New Rental Agreement</h1>
        <p style="color:rgba(255,255,255,0.5);margin:4px 0 0;font-size:13px">Submitted ${submitDate}</p>
      </div>
      <div style="padding:24px;border:1px solid #eee;border-top:none;border-radius:0 0 8px 8px">
        <table style="width:100%;border-collapse:collapse">
          <tr><td style="padding:8px;border-bottom:1px solid #eee;color:#888;width:40%">Name</td><td style="padding:8px;border-bottom:1px solid #eee;font-weight:500">${name}</td></tr>
          <tr><td style="padding:8px;border-bottom:1px solid #eee;color:#888">Email</td><td style="padding:8px;border-bottom:1px solid #eee">${email}</td></tr>
          <tr><td style="padding:8px;border-bottom:1px solid #eee;color:#888">Phone</td><td style="padding:8px;border-bottom:1px solid #eee">${phone}</td></tr>
          <tr><td style="padding:8px;border-bottom:1px solid #eee;color:#888">Address</td><td style="padding:8px;border-bottom:1px solid #eee">${fullAddress}</td></tr>
          <tr><td style="padding:8px;border-bottom:1px solid #eee;color:#888">Trailer</td><td style="padding:8px;border-bottom:1px solid #eee">${trailerName}</td></tr>
          <tr><td style="padding:8px;border-bottom:1px solid #eee;color:#888">Start Date</td><td style="padding:8px;border-bottom:1px solid #eee">${startDate}</td></tr>
          <tr><td style="padding:8px;color:#888">Return Date</td><td style="padding:8px">${endDate}</td></tr>
        </table>
        <p style="margin-top:16px;font-size:13px;color:#888">License, registration, insurance, and the signed signature image are attached. Payment (rental fee + deposit) will follow via Stripe Checkout — you'll get a separate payment-received email once that's complete.</p>
      </div>
    </div>`;

  const attachments = [
    { filename: licenseFilename || 'drivers-license', content: stripDataUrlPrefix(license) },
    { filename: registrationFilename || 'vehicle-registration', content: stripDataUrlPrefix(registration) },
    { filename: insuranceFilename || 'proof-of-insurance', content: stripDataUrlPrefix(insurance) },
    { filename: 'signature.png', content: stripDataUrlPrefix(signature) },
  ];

  try {
    await sendEmail({ to: email, subject: 'A1A Trailer Rentals — Documents Received', html: renterHtml });
    await sendEmail({ to: BUSINESS_EMAIL, subject: `New Rental Agreement — ${name} (${trailerName})`, html: businessHtml, attachments });
    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch (err) {
    return { statusCode: 502, body: JSON.stringify({ error: err.message }) };
  }
};
