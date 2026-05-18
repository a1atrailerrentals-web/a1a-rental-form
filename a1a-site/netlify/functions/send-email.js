// netlify/functions/send-email.js
//
// Receives the rental-agreement submission from index.html and sends two
// emails via Resend (one to the renter, one to A1A) with the license,
// registration, insurance photos and signature attached.
//
// Required env var on Netlify: RESEND_API_KEY
// Required dependency in your repo: npm install resend
//
// Important: this only works once your domain is verified in Resend. Until
// then Resend will only deliver to the email tied to your Resend account.
 
const { Resend } = require('resend');
 
// Change this once your domain is verified in Resend. Until then leave it
// as Resend's shared test sender (onboarding@resend.dev) — but that sender
// will ONLY deliver to your own verified email.
const FROM_ADDRESS = 'A1A Trailer Rentals <bookings@a1atrailerrentals.com>';
 
exports.handler = async (event) => {
  // CORS / preflight
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
      },
      body: '',
    };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }
 
  if (!process.env.RESEND_API_KEY) {
    return json(500, { ok: false, error: 'RESEND_API_KEY is not configured' });
  }
 
  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (e) {
    return json(400, { ok: false, error: 'Invalid JSON body' });
  }
 
  const {
    renterEmail,
    businessEmail,
    renterSubject,
    businessSubject,
    renterHtml,
    businessHtml,
    attachments = [],
  } = body;
 
  if (!renterEmail || !businessEmail) {
    return json(400, { ok: false, error: 'renterEmail and businessEmail are required' });
  }
 
  // Resend expects attachments as { filename, content } where content is base64.
  // contentType is optional but helps clients display the file inline.
  const resendAttachments = (attachments || [])
    .filter((a) => a && a.filename && a.content)
    .map((a) => ({
      filename: a.filename,
      content: a.content,
      contentType: a.contentType,
    }));
 
  const resend = new Resend(process.env.RESEND_API_KEY);
 
  try {
    const [renterRes, businessRes] = await Promise.all([
      resend.emails.send({
        from: FROM_ADDRESS,
        to: [renterEmail],
        subject: renterSubject || 'Your A1A Trailer Rental Agreement',
        html: renterHtml || '<p>Your rental agreement has been received.</p>',
        attachments: resendAttachments,
      }),
      resend.emails.send({
        from: FROM_ADDRESS,
        to: [businessEmail],
        replyTo: renterEmail,
        subject: businessSubject || 'New Rental Agreement',
        html: businessHtml || '<p>A new rental agreement was submitted.</p>',
        attachments: resendAttachments,
      }),
    ]);
 
    // Resend v3 SDK returns { data, error } on each send — surface them.
    const renterError = renterRes && renterRes.error ? renterRes.error : null;
    const businessError = businessRes && businessRes.error ? businessRes.error : null;
 
    if (renterError || businessError) {
      return json(500, {
        ok: false,
        error: (renterError && renterError.message) || (businessError && businessError.message) || 'Email delivery failed',
        renterError,
        businessError,
      });
    }
 
    return json(200, {
      ok: true,
      renterId: renterRes && renterRes.data && renterRes.data.id,
      businessId: businessRes && businessRes.data && businessRes.data.id,
    });
  } catch (err) {
    return json(500, { ok: false, error: err.message || String(err) });
  }
};
 
function json(statusCode, payload) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
    body: JSON.stringify(payload),
  };
}
 
