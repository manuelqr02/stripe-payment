const Stripe = require('stripe');
const db = require('../../lib/db');

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.end('Method Not Allowed');
    return;
  }

  try {
    const { amount, currency = 'USD', metadata = {}, idempotency_key } = req.body || {};
    // Support Idempotency from header as well
    const idemKey = idempotency_key || req.headers['idempotency-key'] || null;

    if (!process.env.STRIPE_SECRET_KEY) {
      res.statusCode = 500;
      res.end('Stripe secret key not configured');
      return;
    }

    if (!amount || amount <= 0) {
      res.statusCode = 400;
      res.end('Invalid amount');
      return;
    }

    const stripe = Stripe(process.env.STRIPE_SECRET_KEY);

    // If idempotency key provided, check DB for existing order
    if (idemKey) {
      const { rows } = await db.query('SELECT * FROM orders WHERE provider=$1 AND idempotency_key=$2 LIMIT 1', ['stripe', idemKey]);
      if (rows && rows.length > 0) {
        const existing = rows[0];
        try {
          const pi = await stripe.paymentIntents.retrieve(existing.provider_order_id);
          res.setHeader('Content-Type', 'application/json');
          res.status(200).json({ clientSecret: pi.client_secret, id: pi.id });
          return;
        } catch (err) {
          // If retrieval fails, continue to create a new one — but log
          console.warn('Failed to retrieve existing PaymentIntent, creating new one', err);
        }
      }
    }

    const createOptions = {};
    if (idemKey) createOptions.idempotencyKey = idemKey;

    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(amount),
      currency,
      metadata,
    }, createOptions);

    try {
      await db.query(
        'INSERT INTO orders (provider, provider_order_id, amount, currency, status, metadata, idempotency_key, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,now())',
        ['stripe', paymentIntent.id, paymentIntent.amount, paymentIntent.currency, paymentIntent.status, JSON.stringify(metadata), idemKey]
      );
    } catch (dbErr) {
      console.error('DB insert error:', dbErr);
    }

    res.setHeader('Content-Type', 'application/json');
    res.status(200).json({ clientSecret: paymentIntent.client_secret, id: paymentIntent.id });
  } catch (err) {
    console.error(err);
    res.statusCode = 500;
    res.end('Internal Server Error');
  }
}


