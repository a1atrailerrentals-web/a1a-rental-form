const nodemailer = require('nodemailer');

exports.handler = async function(event) {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const { to, subject, html } = JSON.parse(event.body);

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: 'a1atrailerrentals@gmail.com',
      pass: 'gftqyuzztebrvycq'
    }
  });

  try {
    await transporter.sendMail({
      from: 'A1A Trailer Rentals <a1atrailerrentals@gmail.com>',
      to,
      subject,
      html
    });
    return { statusCode: 200, body: JSON.stringify({ success: true }) };
  } catch (err) {
    return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
  }
};
