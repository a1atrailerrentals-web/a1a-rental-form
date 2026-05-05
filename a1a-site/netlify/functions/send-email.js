exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const RESEND_API_KEY = 're_jN7gPLtM_Fc9EfyrAWU6kerizRgJ4ns4j';
  const { to, subject, html } = JSON.parse(event.body);

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${RESEND_API_KEY}`
    },
    body: JSON.stringify({
      from: 'A1A Trailer Rentals <onboarding@resend.dev>',
      to: [to],
      subject,
      html
    })
  });

  const data = await res.json();

  if (!res.ok) {
    return { statusCode: 500, body: JSON.stringify({ error: data }) };
  }

  return { statusCode: 200, body: JSON.stringify({ success: true }) };
};
