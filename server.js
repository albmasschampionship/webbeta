import './lib/env.js';

import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { EVENT, formatMoney, quote } from './public/js/lib/catalog.js';
import { buildConfig } from './public/js/lib/config.js';
import { create, findByRef, findBySession, list, newCheckInCode, newReference, update } from './lib/store.js';
import { createCheckoutSession, retrieveSession, stripeConfigured, verifyWebhookSignature } from './lib/stripe.js';
import { ID_TYPES, MIN_AGE, PROFESSIONS, SHIRT_SIZES, validateBooking } from './public/js/lib/validate.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, 'public');
const PORT = Number(process.env.PORT || 4321);
const HOST = process.env.HOST || '127.0.0.1';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'gmt-admin-2027';
const IS_DEMO = !stripeConfigured();

// ---------------------------------------------------------------- helpers
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json'
};

const PRETTY_ROUTES = {
  '/': '/index.html',
  '/book': '/book.html',
  '/booking': '/book.html',
  '/tickets': '/book.html',
  '/success': '/success.html',
  '/admin': '/admin.html'
};

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

async function readBody(req, limit = 120_000) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(Object.assign(new Error('Payload too large'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function baseUrlFor(req) {
  if (process.env.PUBLIC_BASE_URL) return process.env.PUBLIC_BASE_URL.replace(/\/$/, '');
  const proto = (req.headers['x-forwarded-proto'] || 'http').split(',')[0].trim();
  const host = req.headers['x-forwarded-host'] || req.headers.host || `${HOST}:${PORT}`;
  return `${proto}://${host}`;
}

function clientIp(req) {
  return (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || req.socket.remoteAddress || 'unknown';
}

// Very small in-memory throttle: 30 checkout attempts per IP per 10 minutes.
const attempts = new Map();
function throttle(req, max = 30, windowMs = 10 * 60_000) {
  const key = clientIp(req);
  const now = Date.now();
  const entry = attempts.get(key) || { count: 0, reset: now + windowMs };
  if (now > entry.reset) {
    entry.count = 0;
    entry.reset = now + windowMs;
  }
  entry.count += 1;
  attempts.set(key, entry);
  return entry.count <= max;
}

function publicRegistration(record) {
  return {
    ref: record.ref,
    status: record.status,
    paymentProvider: record.paymentProvider,
    createdAt: record.createdAt,
    paidAt: record.paidAt || null,
    passId: record.passId,
    passName: record.passName,
    passKind: record.passKind,
    quantity: record.quantity,
    total: record.total,
    subtotal: record.subtotal,
    discount: record.discount,
    currency: record.currency,
    customer: {
      firstName: record.registration?.firstName || '',
      lastName: record.registration?.lastName || '',
      email: record.registration?.email || ''
    },
    category: record.competitor?.category || null,
    extraCategory: record.competitor?.extraCategory || null,
    checkInCode: record.status === 'paid' ? record.checkInCode : null,
    demo: record.paymentProvider === 'demo'
  };
}

async function syncFromStripe(record) {
  if (!record?.stripeSessionId || record.paymentProvider !== 'stripe') return record;
  if (record.status === 'paid') return record;
  try {
    const session = await retrieveSession(record.stripeSessionId);
    if (session.payment_status === 'paid' || session.status === 'complete') {
      return await update(record.ref, {
        status: 'paid',
        paidAt: new Date().toISOString(),
        paymentIntentId: session.payment_intent || null,
        checkInCode: record.checkInCode || newCheckInCode()
      });
    }
    if (session.status === 'expired') {
      return await update(record.ref, { status: 'cancelled' });
    }
  } catch (err) {
    console.warn('[stripe] could not sync session', record.stripeSessionId, err.message);
  }
  return record;
}

// ------------------------------------------------------------------ config
function configPayload() {
  return buildConfig({ demoMode: IS_DEMO, hosting: 'server' });
}

// -------------------------------------------------------------------- APIs
async function handleApi(req, res, url) {
  const { pathname } = url;

  if (req.method === 'GET' && pathname === '/api/config') {
    return sendJson(res, 200, configPayload());
  }

  if (req.method === 'GET' && pathname === '/api/quote') {
    try {
      const q = quote({
        passId: url.searchParams.get('passId'),
        quantity: url.searchParams.get('quantity') || 1,
        addons: (url.searchParams.get('addons') || '').split(',').filter(Boolean),
        promoCode: url.searchParams.get('promoCode') || ''
      });
      return sendJson(res, 200, {
        lines: q.lines,
        subtotal: q.subtotal,
        discount: q.discount,
        total: q.total,
        appliedPromo: q.appliedPromo,
        formatted: {
          subtotal: formatMoney(q.subtotal),
          discount: formatMoney(q.discount),
          total: formatMoney(q.total)
        }
      });
    } catch (err) {
      return sendJson(res, 400, { error: err.message });
    }
  }

  if (req.method === 'POST' && pathname === '/api/checkout') {
    if (!throttle(req)) return sendJson(res, 429, { error: 'Too many attempts. Please try again in a few minutes.' });

    let payload;
    try {
      const raw = await readBody(req);
      payload = JSON.parse(raw.toString('utf8') || '{}');
    } catch (err) {
      return sendJson(res, err.status || 400, { error: 'Could not read the submitted form.' });
    }

    const { ok, errors, data } = validateBooking(payload);
    if (!ok) return sendJson(res, 422, { error: 'Please check the highlighted fields.', fields: errors });

    let q;
    try {
      q = quote({ passId: data.passId, quantity: data.quantity, addons: data.addons, promoCode: data.promoCode });
    } catch (err) {
      return sendJson(res, 400, { error: err.message });
    }

    if (data.addons.includes('extra-category') && !data.competitor) {
      return sendJson(res, 422, { error: 'Additional category requires competitor details.', fields: { extraCategory: 'Complete the competitor details.' } });
    }

    const ref = newReference();
    const createdAt = new Date().toISOString();
    const record = {
      ref,
      createdAt,
      updatedAt: createdAt,
      status: 'pending',
      paymentProvider: IS_DEMO ? 'demo' : 'stripe',
      stripeSessionId: null,
      paymentIntentId: null,
      checkInCode: null,
      currency: EVENT.currency,
      passId: data.passId,
      passName: data.passName,
      passKind: data.passKind,
      quantity: data.quantity,
      addons: data.addons,
      promoCode: q.appliedPromo?.code || '',
      lines: q.lines,
      subtotal: q.subtotal,
      discount: q.discount,
      total: q.total,
      registration: data.registration,
      competitor: data.competitor,
      consent: data.consent,
      userAgent: req.headers['user-agent'] || '',
      ip: clientIp(req)
    };

    if (IS_DEMO) {
      const saved = await create(record);
      return sendJson(res, 201, {
        demo: true,
        ref: saved.ref,
        total: saved.total,
        currency: saved.currency,
        redirectUrl: `/success.html?ref=${encodeURIComponent(saved.ref)}&demo=1`
      });
    }

    try {
      const session = await createCheckoutSession({
        ref,
        email: data.registration.email,
        lines: q.lines,
        currency: EVENT.currency,
        baseUrl: baseUrlFor(req),
        description: `${EVENT.name} ${EVENT.year} — ${data.passName}${data.competitor ? ` (${data.competitor.category})` : ''}`,
        metadata: { passName: data.passName }
      });

      record.stripeSessionId = session.id;
      await create(record);

      return sendJson(res, 201, {
        demo: false,
        ref,
        total: record.total,
        currency: record.currency,
        redirectUrl: session.url
      });
    } catch (err) {
      console.error('[stripe] checkout failed:', err.message);
      return sendJson(res, 502, { error: `Payment provider error: ${err.message}` });
    }
  }

  if (req.method === 'GET' && pathname.startsWith('/api/registration/')) {
    const ref = decodeURIComponent(pathname.replace('/api/registration/', ''));
    let record = await findByRef(ref);
    if (!record) return sendJson(res, 404, { error: 'Registration not found.' });
    record = await syncFromStripe(record);
    return sendJson(res, 200, publicRegistration(record));
  }

  if (req.method === 'POST' && pathname === '/api/demo/confirm') {
    if (!IS_DEMO) return sendJson(res, 403, { error: 'Demo payments are disabled.' });
    const raw = await readBody(req);
    const { ref } = JSON.parse(raw.toString('utf8') || '{}');
    const record = await findByRef(ref);
    if (!record) return sendJson(res, 404, { error: 'Registration not found.' });
    if (record.status === 'paid') return sendJson(res, 200, publicRegistration(record));
    const updated = await update(ref, {
      status: 'paid',
      paidAt: new Date().toISOString(),
      checkInCode: newCheckInCode(),
      paymentIntentId: `demo_${Date.now().toString(36)}`
    });
    return sendJson(res, 200, publicRegistration(updated));
  }

  if (req.method === 'POST' && pathname === '/api/stripe/webhook') {
    const secret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!secret) return sendJson(res, 501, { error: 'Webhook secret not configured.' });

    const raw = await readBody(req);
    const signature = req.headers['stripe-signature'];
    if (!verifyWebhookSignature(raw.toString('utf8'), signature, secret)) {
      return sendJson(res, 400, { error: 'Invalid signature.' });
    }

    let event;
    try {
      event = JSON.parse(raw.toString('utf8'));
    } catch {
      return sendJson(res, 400, { error: 'Invalid JSON.' });
    }

    const session = event?.data?.object;
    const ref = session?.client_reference_id || session?.metadata?.ref;

    if (ref && ['checkout.session.completed', 'checkout.session.async_payment_succeeded'].includes(event.type)) {
      const record = await findByRef(ref);
      if (record && record.status !== 'paid') {
        await update(ref, {
          status: 'paid',
          paidAt: new Date().toISOString(),
          paymentIntentId: session.payment_intent || null,
          checkInCode: newCheckInCode()
        });
      }
    }

    if (ref && ['checkout.session.expired', 'checkout.session.async_payment_failed'].includes(event.type)) {
      const record = await findByRef(ref);
      if (record && record.status === 'pending') await update(ref, { status: 'cancelled' });
    }

    if (event.type === 'charge.refunded' && session?.payment_intent) {
      const record = await findBySession(session.id);
      if (record) await update(record.ref, { status: 'refunded' });
    }

    return sendJson(res, 200, { received: true });
  }

  // ------------------------------------------------------------- admin API
  if (pathname.startsWith('/api/admin/')) {
    if (req.headers['x-admin-token'] !== ADMIN_TOKEN) {
      return sendJson(res, 401, { error: 'Invalid admin token.' });
    }

    if (req.method === 'GET' && pathname === '/api/admin/registrations') {
      const records = await list();
      const stats = records.reduce(
        (acc, r) => {
          acc.total += 1;
          if (r.status === 'paid') {
            acc.paid += 1;
            acc.revenue += r.total || 0;
          }
          if (r.passKind === 'competitor') acc.competitors += 1;
          return acc;
        },
        { total: 0, paid: 0, revenue: 0, competitors: 0 }
      );
      return sendJson(res, 200, { stats, records });
    }

    if (req.method === 'GET' && pathname === '/api/admin/export.csv') {
      const records = await list();
      const cols = [
        'ref', 'createdAt', 'status', 'passName', 'passKind', 'quantity', 'total', 'currency',
        'firstName', 'lastName', 'email', 'phone', 'country', 'city', 'dateOfBirth', 'idType', 'idNumber',
        'category', 'extraCategory', 'profession', 'shirtSize', 'checkInCode'
      ];
      const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const rows = records.map((r) =>
        [
          r.ref,
          r.createdAt,
          r.status,
          r.passName,
          r.passKind,
          r.quantity,
          (r.total / 100).toFixed(2),
          r.currency,
          r.registration?.firstName,
          r.registration?.lastName,
          r.registration?.email,
          r.registration?.phone,
          r.registration?.country,
          r.registration?.city,
          r.registration?.dateOfBirth,
          r.registration?.idType,
          r.registration?.idNumber,
          r.competitor?.category,
          r.competitor?.extraCategory,
          r.competitor?.profession,
          r.competitor?.shirtSize,
          r.checkInCode
        ]
          .map(cell)
          .join(',')
      );
      const csv = [cols.join(','), ...rows].join('\n');
      res.writeHead(200, {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': 'attachment; filename="amc2027-registrations.csv"',
        'Cache-Control': 'no-store'
      });
      return res.end(csv);
    }

    return sendJson(res, 404, { error: 'Unknown admin endpoint.' });
  }

  return sendJson(res, 404, { error: 'Not found' });
}

// ------------------------------------------------------------------ static
async function serveStatic(req, res, url) {
  let pathname = decodeURIComponent(url.pathname);
  pathname = PRETTY_ROUTES[pathname] || pathname;
  if (pathname.endsWith('/')) pathname += 'index.html';

  const filePath = path.normalize(path.join(PUBLIC_DIR, pathname));
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403).end('Forbidden');
    return;
  }

  try {
    const info = await stat(filePath);
    if (info.isDirectory()) throw Object.assign(new Error('dir'), { code: 'ENOENT' });
    const ext = path.extname(filePath).toLowerCase();
    const isHtml = ext === '.html';
    const immutable = /\/(img|fonts)\//.test(filePath);
    res.writeHead(200, {
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Content-Length': info.size,
      'Cache-Control': isHtml ? 'no-cache' : immutable ? 'public, max-age=31536000, immutable' : 'no-cache'
    });
    createReadStream(filePath).pipe(res);
  } catch {
    // SPA-ish fallback for unknown pretty routes, 404 page otherwise
    if (!path.extname(pathname)) {
      try {
        const html = await readFile(path.join(PUBLIC_DIR, '404.html'));
        res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' }).end(html);
        return;
      } catch {
        /* ignore */
      }
    }
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('404 — Not found');
  }
}

// ------------------------------------------------------------------ server
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');

  try {
    if (url.pathname.startsWith('/api/')) {
      await handleApi(req, res, url);
      return;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD' }).end('Method not allowed');
      return;
    }
    await serveStatic(req, res, url);
  } catch (err) {
    console.error('[server]', err);
    if (!res.headersSent) sendJson(res, 500, { error: 'Internal server error.' });
    else res.end();
  }
});

server.listen(PORT, HOST, () => {
  console.log(`\n  Albanian Massage Championship 2027`);
  console.log(`  → http://${HOST}:${PORT}`);
  console.log(`  → booking:  http://${HOST}:${PORT}/book`);
  console.log(`  → admin:    http://${HOST}:${PORT}/admin  (token: ${ADMIN_TOKEN})`);
  console.log(`  → payments: ${IS_DEMO ? 'DEMO MODE (no STRIPE_SECRET_KEY set)' : 'Stripe live/test keys detected'}\n`);
});
