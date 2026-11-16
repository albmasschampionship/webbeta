import { createHmac, timingSafeEqual } from 'node:crypto';

const API_BASE = 'https://api.stripe.com/v1';

export function stripeConfigured() {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

async function stripeRequest(pathname, { method = 'GET', body, idempotencyKey } = {}) {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY is not configured');

  const headers = {
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/x-www-form-urlencoded',
    'Stripe-Version': '2024-06-20'
  };
  if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;

  const res = await fetch(`${API_BASE}${pathname}`, {
    method,
    headers,
    body: body ? body.toString() : undefined
  });

  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = payload?.error?.message || `Stripe request failed (${res.status})`;
    const err = new Error(message);
    err.status = res.status;
    err.type = payload?.error?.type;
    throw err;
  }
  return payload;
}

/**
 * Creates a hosted Stripe Checkout Session. Card data never touches this server.
 */
export async function createCheckoutSession({ ref, email, lines, currency, baseUrl, description, metadata = {} }) {
  const body = new URLSearchParams();
  body.set('mode', 'payment');
  body.set('success_url', `${baseUrl}/success.html?ref=${encodeURIComponent(ref)}&session_id={CHECKOUT_SESSION_ID}`);
  body.set('cancel_url', `${baseUrl}/book.html?ref=${encodeURIComponent(ref)}&status=cancelled`);
  body.set('client_reference_id', ref);
  body.set('customer_email', email);
  body.set('billing_address_collection', 'required');
  body.set('locale', 'auto');
  body.set('submit_type', 'pay');
  body.set('payment_method_types[0]', 'card');
  body.set('metadata[ref]', ref);
  body.set('payment_intent_data[metadata][ref]', ref);
  body.set('payment_intent_data[description]', description);
  body.set('custom_text[submit][message]', 'Registration details are reviewed by the organising committee before the championship.');
  if (metadata.passName) body.set('metadata[pass]', metadata.passName);

  lines.forEach((line, i) => {
    body.set(`line_items[${i}][quantity]`, String(line.qty));
    body.set(`line_items[${i}][price_data][currency]`, currency.toLowerCase());
    body.set(`line_items[${i}][price_data][unit_amount]`, String(line.unit));
    body.set(`line_items[${i}][price_data][product_data][name]`, line.label);
    if (line.description) body.set(`line_items[${i}][price_data][product_data][description]`, line.description);
  });

  return stripeRequest('/checkout/sessions', { method: 'POST', body, idempotencyKey: `checkout-${ref}` });
}

export async function retrieveSession(sessionId) {
  return stripeRequest(`/checkout/sessions/${encodeURIComponent(sessionId)}`);
}

/**
 * Verifies a Stripe webhook signature header (t=...,v1=...).
 */
export function verifyWebhookSignature(payload, signatureHeader, secret, toleranceSeconds = 300) {
  if (!signatureHeader) return false;
  const parts = Object.fromEntries(
    signatureHeader.split(',').map((kv) => {
      const [k, v] = kv.split('=');
      return [k, v];
    })
  );
  const timestamp = Number(parts.t);
  if (!timestamp || !parts.v1) return false;
  if (Math.abs(Date.now() / 1000 - timestamp) > toleranceSeconds) return false;

  const expected = createHmac('sha256', secret).update(`${timestamp}.${payload}`).digest('hex');
  const received = String(parts.v1);
  if (expected.length !== received.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(received));
}
