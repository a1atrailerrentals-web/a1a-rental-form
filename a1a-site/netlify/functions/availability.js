// netlify/functions/availability.js
//
// Single source of truth for which dates a trailer is unavailable —
// either because it's already booked (added automatically by
// stripe-webhook.js when a payment succeeds) or because you manually
// blacked it out (maintenance, personal use, etc.). Stored in Netlify
// Blobs, which requires no setup beyond the @netlify/blobs dependency —
// it's automatically available to functions on a deployed Netlify site.
//
// GET  ?trailer=7x16              -> { trailer, ranges: [...] } for one trailer
// GET  (no trailer param)         -> { all: { "7x16": [...], "7x20": [...], dump: [...] } }
// POST { adminPassword, trailer, start, end, label }  -> add a manual blackout range
// DELETE { adminPassword, trailer, rangeId }          -> remove a range
//
// Date ranges use plain "YYYY-MM-DD" strings and are inclusive of both
// start and end. "start" and "end" are calendar dates, not timestamps, so
// string comparison (e.g. "2026-08-05" <= "2026-08-07") works correctly.

const { getStore } = require('@netlify/blobs');

const TRAILER_KEYS = ['7x16', '7x20', 'dump'];

function store() {
  return getStore('availability');
}

async function getRanges(trailerKey) {
  const data = await store().get(trailerKey, { type: 'json' });
  return Array.isArray(data) ? data : [];
}

async function setRanges(trailerKey, ranges) {
  await store().setJSON(trailerKey, ranges);
}

exports.handler = async (event) => {
  const method = event.httpMethod;

  if (method === 'GET') {
    const trailer = event.queryStringParameters && event.queryStringParameters.trailer;
    if (trailer) {
      if (!TRAILER_KEYS.includes(trailer)) {
        return { statusCode: 400, body: JSON.stringify({ error: 'Unknown trailer' }) };
      }
      const ranges = await getRanges(trailer);
      return { statusCode: 200, body: JSON.stringify({ trailer, ranges }) };
    }
    const all = {};
    for (const key of TRAILER_KEYS) all[key] = await getRanges(key);
    return { statusCode: 200, body: JSON.stringify({ all }) };
  }

  if (method === 'POST' || method === 'DELETE') {
    let data;
    try {
      data = JSON.parse(event.body || '{}');
    } catch (err) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON' }) };
    }

    if (!process.env.ADMIN_PASSWORD || data.adminPassword !== process.env.ADMIN_PASSWORD) {
      return { statusCode: 401, body: JSON.stringify({ error: 'Unauthorized' }) };
    }

    const { trailer } = data;
    if (!TRAILER_KEYS.includes(trailer)) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Unknown trailer' }) };
    }

    if (method === 'POST') {
      const { start, end, label } = data;
      if (!start || !end) {
        return { statusCode: 400, body: JSON.stringify({ error: 'start and end dates are required' }) };
      }
      if (end < start) {
        return { statusCode: 400, body: JSON.stringify({ error: 'end date must be on or after start date' }) };
      }
      const ranges = await getRanges(trailer);
      const newRange = {
        id: `bo_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        start,
        end,
        type: 'blackout',
        label: label || 'Blocked',
      };
      ranges.push(newRange);
      await setRanges(trailer, ranges);
      return { statusCode: 200, body: JSON.stringify({ ok: true, range: newRange }) };
    }

    if (method === 'DELETE') {
      const { rangeId } = data;
      if (!rangeId) {
        return { statusCode: 400, body: JSON.stringify({ error: 'rangeId is required' }) };
      }
      const ranges = await getRanges(trailer);
      const filtered = ranges.filter((r) => r.id !== rangeId);
      await setRanges(trailer, filtered);
      return { statusCode: 200, body: JSON.stringify({ ok: true }) };
    }
  }

  return { statusCode: 405, body: 'Method Not Allowed' };
};

// Used directly by stripe-webhook.js (same process, no HTTP round-trip)
// to record a paid booking against the same store this function reads from.
exports.addBookingRange = async (trailerKey, start, end, meta = {}) => {
  if (!TRAILER_KEYS.includes(trailerKey) || !start || !end) return;
  const ranges = await getRanges(trailerKey);
  ranges.push({
    id: `bk_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    start,
    end,
    type: 'booking',
    label: meta.label || 'Booked',
  });
  await setRanges(trailerKey, ranges);
};
