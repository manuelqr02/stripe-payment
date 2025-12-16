const Stripe = require('stripe');
const rawBody = require('raw-body');
const db = require('../../lib/db');

export const config = {
  api: {
    bodyParser: false,
  },
};

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.end('Method Not Allowed');
    return;
  }

  const sig = req.headers['stripe-signature'];
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

  let buf;
  try {
    buf = await rawBody(req);
  } catch (err) {
    console.error('raw-body error', err);
    res.statusCode = 400;
    res.end('Invalid request body');
    return;
  }

  let event;
  try {
    if (webhookSecret) {
      event = stripe.webhooks.constructEvent(buf, sig, webhookSecret);
    } else {
      event = JSON.parse(buf.toString());
    }
  } catch (err) {
    console.error('Webhook signature verification failed.', err.message);
    res.statusCode = 400;
    res.end(`Webhook Error: ${err.message}`);
    return;
  }

  try {
    switch (event.type) {
      case 'payment_intent.succeeded':
        {
          const pi = event.data.object;
          await db.query('UPDATE orders SET status=$1 WHERE provider_order_id=$2 AND provider=$3', [pi.status, pi.id, 'stripe']);
        }
        break;
      case 'payment_intent.payment_failed':
        {
          const pi = event.data.object;
          await db.query('UPDATE orders SET status=$1 WHERE provider_order_id=$2 AND provider=$3', [pi.status, pi.id, 'stripe']);
        }
        break;
      default:
        break;
    }
  } catch (err) {
    console.error('Error handling webhook event', err);
  }

  res.statusCode = 200;
  res.end('OK');
}
