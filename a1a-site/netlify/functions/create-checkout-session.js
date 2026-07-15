// netlify/functions/create-checkout-session.js
//
// Creates a Stripe Checkout Session for the rental fee + refundable
// security deposit, charged together upfront. Price is computed
// SERVER-SIDE from the trailer + dates (never trusted from the browser)
// so a renter can't tamper with the amount before paying.
//
// Most rates are whole-day tiers, matched from the calendar day
// difference between startDate/endDate. A few short-term rates (4-hour,
// 12-hour, 8-hour) are less than one day and can't be expressed as a
// calendar date range at all, so the front end instead sends an explicit
// `durationKey` (e.g. "4h") identifying exactly which rate tier the
// renter picked. When durationKey is present we look the rate up
// directly by key instead of computing it from the date difference —
// the price still comes only from this server-side RATES table, so the
// renter still can't influence the charged amount.
//
// After a successful payment, Stripe redirects to success.html and
// (separately) fires a webhook that notifies the business — see
// stripe-webhook.js.

const Stripe = require('stripe');
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

const SITE_URL = process.env.SITE_URL; // e.g. https://a1atrailerrentals.netlify.app

const RATES = {
  '7x16': [
    { key: '4h', label: '4 hours', days: 0.5, price: 60 },
    { key: '12h', label: '12 hours', days: 0.75, price: 100 },
    { key: '1d', label: '1 day', days: 1, price: 159 },
    { key: '2d', label: '2 days', days: 2, price: 229 },
    { key: '3d', label: '3 days', days: 3, price: 299 },
    { key: '4d', label: '4 days', days: 4, price: 389 },
    { key: '5d', label: '5 days', days: 5, price: 489 },
    { key: '6d', label: '6 days', days: 6, price: 589 },
    { key: '7d', label: '7 days', days: 7, price: 639 },
  ],
  '7x20': [
    { key: '4h', label: '4 hours', days: 0.5, price: 70 },
    { key: '12h', label: '12 hours', days: 0.75, price: 110 },
    { key: '1d', label: '1 day', days: 1, price: 169 },
    { key: '2d', label: '2 days', days: 2, price: 239 },
    { key: '3d', label: '3 days', days: 3, price: 309 },
    { key: '4d', label: '4 days', days: 4, price: 399 },
    { key: '5d', label: '5 days', days: 5, price: 499 },
    { key: '6d', label: '6 days', days: 6, price: 599 },
    { key: '7d', label: '7 days', days: 7, price: 649 },
  ],
  dump: [
    { key: '8h', label: '8 hours', days: 0.75, price: 130 },
    { key: '1d', label: '1 day', days: 1, price: 180 },
    { key: '2d', label: '2 days', days: 2, price: 285 },
    { key: '3d', label: '3 days', days: 3, price: 410 },
    { key: '4d', label: '4 days', days: 4, price: 525 },
    { key: '5d', label: '5 days', days: 5, price: 629 },
    { key: '6d', label: '6 days', days: 6, price: 699 },
    { key: '7d', label: '7 days', days: 7, price: 765 },
  ],
};
const NAMES = { '7x16': '7x16 Car Hauler', '7x20': '7x20 Car Hauler', dump: "14' Dump Trailer" };
const DEPOSITS = { '7x16': 100, '7x20': 100, dump: 250 };

function getBestRate(trailerKey, days) {
  const rates = RATES[trailerKey];
  for (const r of rates) if (r.days >= days) return r;
  return rates[rates.length - 1];
}

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }
  if (!process.env.STRIPE_SECRET_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: 'Stripe is not configured (missing STRIPE_SECRET_KEY)' }) };
  }

  let data;
  try {
    data = JSON.parse(event.body || '{}');
  } catch (err) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const { trailerKey, startDate, endDate, durationKey, name, email } = data;
  if (!trailerKey || !RATES[trailerKey] || !startDate || !endDate || !email) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing or invalid fields' }) };
  }

  let rate;
  if (durationKey) {
    // Short-term (sub-24-hour) rate, selected explicitly on the form —
    // can't be derived from a calendar date difference.
    rate = RATES[trailerKey].find((r) => r.key === durationKey);
    if (!rate) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Invalid duration key' }) };
    }
  } else {
    const start = new Date(startDate);
    const end = new Date(endDate);
    const days = Math.round((end - start) / (1000 * 60 * 60 * 24));
    if (!(days > 0)) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Invalid date range' }) };
    }
    rate = getBestRate(trailerKey, days);
  }

  const deposit = DEPOSITS[trailerKey];
  const trailerName = NAMES[trailerKey];

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      customer_email: email,
      line_items: [
        {
          price_data: {
            currency: 'usd',
            product_data: { name: `${trailerName} Rental (${rate.label})` },
            unit_amount: Math.round(rate.price * 100),
          },
          quantity: 1,
        },
        {
          price_data: {
            currency: 'usd',
            product_data: {
              name: `Refundable Security Deposit — ${trailerName}`,
              description: 'Refunded within 7 business days after the trailer is returned in equivalent condition, less any amounts owed under the rental agreement.',
            },
            unit_amount: Math.round(deposit * 100),
          },
          quantity: 1,
        },
      ],
      metadata: {
        renter_name: name || '',
        trailer: trailerName,
        trailer_key: trailerKey,
        start_date: startDate,
        end_date: endDate,
        rate_label: rate.label,
        rental_amount: String(rate.price),
        deposit_amount: String(deposit),
      },
      success_url: `${SITE_URL}/success.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${SITE_URL}/index.html`,
    });

    return { statusCode: 200, body: JSON.stringify({ url: session.url }) };
  } catch (err) {
    return { statusCode: 502, body: JSON.stringify({ error: err.message }) };
  }
};
