// netlify/functions/stripe-webhook.js
//
// Listens for Stripe's checkout.session.completed event — this is the
// AUTHORITATIVE signal that payment succeeded (never trust the browser
// redirect alone). Sends a "payment received" notification to the
// business so you know to release pickup access.

const Stripe = require('stripe');
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const { addBookingRange } = require('./availability');

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const BUSINESS_EMAIL = process.env.BUSINESS_EMAIL || 'a1atrailerrentals@gmail.com';
const FROM_EMAIL = process.env.FROM_EMAIL || 'A1A Trailer Rentals <onboarding@resend.dev>';

async function sendEmail({ to, subject, html }) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${RESEND_API_KEY}` },
    body: JSON.stringify({ from: FROM_EMAIL, to: [to], subject, html }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`Resend error (${res.status}): ${text}`);
  }
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const sig = event.headers['stripe-signature'];
  let stripeEvent;
  try {
    stripeEvent = stripe.webhooks.constructEvent(
      event.body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    return { statusCode: 400, body: `Webhook signature verification failed: ${err.message}` };
  }

  if (stripeEvent.type === 'checkout.session.completed') {
    const session = stripeEvent.data.object;
    const meta = session.metadata || {};
    const amountTotal = ((session.amount_total || 0) / 100).toFixed(2);

    // Block these dates out for this trailer now that payment has cleared.
    // This is the same authoritative signal used for the notification
    // email below, so a booking only ever blocks the calendar once it's
    // actually paid for — not just started.
    try {
      await addBookingRange(meta.trailer_key, meta.start_date, meta.end_date, {
        label: meta.renter_name ? `Booked — ${meta.renter_name}` : 'Booked',
      });
    } catch (err) {
      console.error('Failed to record booking in availability store:', err.message);
    }

    const html = `
      <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
        <div style="background:#0a1628;padding:24px;border-radius:8px 8px 0 0">
          <h1 style="color:#27a844;font-size:22px;margin:0">Payment Received ✓</h1>
        </div>
        <div style="padding:24px;border:1px solid #eee;border-top:none;border-radius:0 0 8px 8px">
          <table style="width:100%;border-collapse:collapse">
            <tr><td style="padding:8px;border-bottom:1px solid #eee;color:#888;width:40%">Renter</td><td style="padding:8px;border-bottom:1px solid #eee;font-weight:500">${meta.renter_name || ''}</td></tr>
            <tr><td style="padding:8px;border-bottom:1px solid #eee;color:#888">Email</td><td style="padding:8px;border-bottom:1px solid #eee">${session.customer_email || session.customer_details?.email || ''}</td></tr>
            <tr><td style="padding:8px;border-bottom:1px solid #eee;color:#888">Trailer</td><td style="padding:8px;border-bottom:1px solid #eee">${meta.trailer || ''}</td></tr>
            <tr><td style="padding:8px;border-bottom:1px solid #eee;color:#888">Dates</td><td style="padding:8px;border-bottom:1px solid #eee">${meta.start_date || ''} &ndash; ${meta.end_date || ''}</td></tr>
            <tr><td style="padding:8px;border-bottom:1px solid #eee;color:#888">Rental Fee</td><td style="padding:8px;border-bottom:1px solid #eee">$${meta.rental_amount || ''}</td></tr>
            <tr><td style="padding:8px;border-bottom:1px solid #eee;color:#888">Security Deposit</td><td style="padding:8px;border-bottom:1px solid #eee">$${meta.deposit_amount || ''}</td></tr>
            <tr><td style="padding:8px;color:#888">Total Charged</td><td style="padding:8px;font-weight:600;color:#27a844">$${amountTotal}</td></tr>
          </table>
          <p style="margin-top:16px;font-size:13px;color:#888">Payment confirmed via Stripe. Safe to release pickup access / lockbox code to the renter.</p>
        </div>
      </div>`;

    try {
      await sendEmail({ to: BUSINESS_EMAIL, subject: `Payment Received — ${meta.renter_name || 'Renter'} (${meta.trailer || ''})`, html });
    } catch (err) {
      // Stripe will retry the webhook if we return non-2xx, but the payment
      // itself already succeeded — log and still acknowledge receipt so
      // Stripe doesn't retry indefinitely for an email-only failure.
      console.error('Failed to send payment-received email:', err.message);
    }
  }

  return { statusCode: 200, body: JSON.stringify({ received: true }) };
};
