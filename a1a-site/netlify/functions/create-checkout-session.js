// netlify/functions/create-checkout-session.js
//
// Creates a Stripe Checkout Session for the rental fee + refundable
// security deposit, charged together upfront. Price is computed
// SERVER-SIDE from the trailer + dates (never trusted from the browser)
// so a renter can't tamper with the amount before paying.
//
// After a successful payment, Stripe redirects to success.html and
// (separately) fires a webhook that notifies the business — see
// stripe-webhook.js.

const Stripe = require('stripe');
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

const SITE_URL = process.env.SITE_URL; // e.g. https://a1atrailerrentals.netlify.app

const RATES = {
  '7x16': [
    { days: 0.5, price: 60 }, { days: 0.75, price: 100 }, { days: 1, price: 159 },
    { days: 2, price: 229 }, { days: 3, price: 299 }, { days: 4, price: 389 },
    { days: 5, price: 489 }, { days: 6, price: 589 }, { days: 7, price: 639 },
  ],
  '7x20': [
    { days: 0.5, price: 70 }, { days: 0.75, price: 110 }, { days: 1, price: 169 },
    { days: 2, price: 239 }, { days: 3, price: 309 }, { days: 4, price: 399 },
    { days: 5, price: 499 }, { days: 6, price: 599 }, { days: 7, price: 649 },
  ],
  dump: [
    { days: 0.75, price: 130 }, { days: 1, price: 180 }, { days: 2, price: 285 },
    { days: 3, price: 410 }, { days: 4, price: 525 }, { days: 5, price: 629 },
    { days: 6, price: 699 }, { days: 7, price: 765 },
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

  const { trailerKey, startDate, endDate, name, email } = data;
  if (!trailerKey || !RATES[trailerKey] || !startDate || !endDate || !email) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing or invalid fields' }) };
  }

  const start = new Date(startDate);
  const end = new Date(endDate);
  const days = Math.round((end - start) / (1000 * 60 * 60 * 24));
  if (!(days > 0)) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid date range' }) };
  }

  const rate = getBestRate(trailerKey, days);
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
            product_data: { name: `${trailerName} Rental (${rate.label || days + ' day(s)'})` },
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
        start_date: startDate,
        end_date: endDate,
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
