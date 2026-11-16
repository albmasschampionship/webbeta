/* ---------------------------------------------------------------------------
 * Static build shim (GitHub Pages).
 *
 * GitHub Pages only serves files — there is no Node process, so /api/* does not
 * exist there. This module installs a browser-side implementation of the same
 * API surface the page scripts already use:
 *
 *   GET  /api/config                 → catalog from lib/catalog.js
 *   GET  /api/quote                  → same pricing logic as the server
 *   POST /api/checkout               → validates + stores the registration locally
 *   GET  /api/registration/:ref      → reads it back
 *   POST /api/demo/confirm           → marks the demo payment as paid
 *   GET  /api/admin/registrations    → list + stats for this browser
 *   GET  /api/admin/export.csv       → CSV of this browser's registrations
 *
 * Everything is computed with the real modules from /lib, so prices, promo
 * codes and validation rules cannot drift from the Node server.
 *
 * Limits, by design: registrations live in localStorage of the visitor's
 * browser and payments are simulated. For real Stripe payments deploy the
 * included Node server (see README) — the static build is the showcase.
 * ------------------------------------------------------------------------ */

import { EVENT, formatMoney, quote } from './lib/catalog.js';
import { buildConfig } from './lib/config.js';
import { validateBooking } from './lib/validate.js';

const STORE_KEY = 'amc27-registrations';
const ADMIN_TOKEN = 'gmt-admin-2027';
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

window.AMC_STATIC = true;

/* ------------------------------------------------------------------ helpers */
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
  });
}

function token(length) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < length; i += 1) out += ALPHABET[bytes[i] % ALPHABET.length];
  return out;
}

function readAll() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORE_KEY) || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeAll(records) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(records));
  } catch {
    /* private mode / quota — the flow still completes for this session */
  }
}

function publicView(record) {
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

/* ------------------------------------------------------------------- routes */
async function handleApi(url, init) {
  const path = url.pathname;
  const method = (init?.method || 'GET').toUpperCase();

  if (method === 'GET' && path === '/api/config') {
    return json(buildConfig({ demoMode: true, hosting: 'static' }));
  }

  if (method === 'GET' && path === '/api/quote') {
    try {
      const q = quote({
        passId: url.searchParams.get('passId'),
        quantity: url.searchParams.get('quantity') || 1,
        addons: (url.searchParams.get('addons') || '').split(',').filter(Boolean),
        promoCode: url.searchParams.get('promoCode') || ''
      });
      return json({
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
      return json({ error: err.message }, 400);
    }
  }

  if (method === 'POST' && path === '/api/checkout') {
    let payload;
    try {
      payload = JSON.parse(init?.body ? String(init.body) : '{}');
    } catch {
      return json({ error: 'Could not read the submitted form.' }, 400);
    }

    const { ok, errors, data } = validateBooking(payload);
    if (!ok) return json({ error: 'Please check the highlighted fields.', fields: errors }, 422);

    let q;
    try {
      q = quote({ passId: data.passId, quantity: data.quantity, addons: data.addons, promoCode: data.promoCode });
    } catch (err) {
      return json({ error: err.message }, 400);
    }

    const ref = `AMC27-${token(6)}`;
    const createdAt = new Date().toISOString();
    const record = {
      ref,
      createdAt,
      updatedAt: createdAt,
      status: 'pending',
      paymentProvider: 'demo',
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
      consent: data.consent
    };

    const records = readAll();
    records.push(record);
    writeAll(records);

    return json(
      {
        demo: true,
        ref,
        total: record.total,
        currency: record.currency,
        redirectUrl: `success.html?ref=${encodeURIComponent(ref)}&demo=1`
      },
      201
    );
  }

  if (method === 'GET' && path.startsWith('/api/registration/')) {
    const ref = decodeURIComponent(path.replace('/api/registration/', ''));
    const record = readAll().find((r) => r.ref === ref);
    if (!record) return json({ error: 'Registration not found.' }, 404);
    return json(publicView(record));
  }

  if (method === 'POST' && path === '/api/demo/confirm') {
    const body = JSON.parse(init?.body ? String(init.body) : '{}');
    const records = readAll();
    const index = records.findIndex((r) => r.ref === body.ref);
    if (index === -1) return json({ error: 'Registration not found.' }, 404);
    if (records[index].status !== 'paid') {
      records[index] = {
        ...records[index],
        status: 'paid',
        paidAt: new Date().toISOString(),
        paymentIntentId: `demo_${Date.now().toString(36)}`,
        checkInCode: `${token(4)}-${token(4)}`,
        updatedAt: new Date().toISOString()
      };
      writeAll(records);
    }
    return json(publicView(records[index]));
  }

  if (path.startsWith('/api/admin/')) {
    const header = init?.headers instanceof Headers ? init.headers.get('x-admin-token') : init?.headers?.['x-admin-token'];
    if (header !== ADMIN_TOKEN) return json({ error: 'Invalid admin token.' }, 401);

    const records = readAll().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

    if (method === 'GET' && path === '/api/admin/registrations') {
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
      return json({ stats, records, storage: 'localStorage' });
    }

    if (method === 'GET' && path === '/api/admin/export.csv') {
      const cols = [
        'ref', 'createdAt', 'status', 'passName', 'passKind', 'quantity', 'total', 'currency',
        'firstName', 'lastName', 'email', 'phone', 'country', 'city', 'dateOfBirth', 'idType', 'idNumber',
        'category', 'extraCategory', 'profession', 'shirtSize', 'checkInCode'
      ];
      const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const rows = records.map((r) =>
        [
          r.ref, r.createdAt, r.status, r.passName, r.passKind, r.quantity,
          (r.total / 100).toFixed(2), r.currency,
          r.registration?.firstName, r.registration?.lastName, r.registration?.email,
          r.registration?.phone, r.registration?.country, r.registration?.city,
          r.registration?.dateOfBirth, r.registration?.idType, r.registration?.idNumber,
          r.competitor?.category, r.competitor?.extraCategory, r.competitor?.profession,
          r.competitor?.shirtSize, r.checkInCode
        ]
          .map(cell)
          .join(',')
      );
      const csv = [cols.join(','), ...rows].join('\n');
      return new Response(csv, {
        status: 200,
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': 'attachment; filename="amc2027-registrations.csv"',
          'Cache-Control': 'no-store'
        }
      });
    }

    return json({ error: 'Unknown admin endpoint.' }, 404);
  }

  return json({ error: 'Not found' }, 404);
}

/* -------------------------------------------------------------- interception */
const nativeFetch = window.fetch.bind(window);

window.fetch = (input, init) => {
  const raw = typeof input === 'string' ? input : input?.url || '';
  let url;
  try {
    url = new URL(raw, location.href);
  } catch {
    return nativeFetch(input, init);
  }
  if (!url.pathname.startsWith('/api/')) return nativeFetch(input, init);
  return handleApi(url, init);
};

/* Absolute links (e.g. /book written by the page scripts) must become relative
   on a project Pages URL such as https://user.github.io/repo/. */
const PAGE_MAP = {
  '/': 'index.html',
  '/book': 'book.html',
  '/booking': 'book.html',
  '/tickets': 'book.html',
  '/success': 'success.html',
  '/admin': 'admin.html'
};

document.addEventListener('click', (event) => {
  const link = event.target.closest?.('a[href^="/"]');
  if (!link) return;
  const href = link.getAttribute('href');
  let url;
  try {
    url = new URL(href, location.href);
  } catch {
    return;
  }
  const base = PAGE_MAP[url.pathname] || (url.pathname.endsWith('.html') ? url.pathname.slice(1) : null);
  if (!base) return;
  event.preventDefault();
  location.href = `${base}${url.search}${url.hash}`;
});

/* The static build cannot take real payments — say so where it matters. */
document.addEventListener('DOMContentLoaded', () => {
  const banner = document.getElementById('demoBanner');
  if (banner) {
    banner.innerHTML = `
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>
      <div><b>Preview build (GitHub Pages).</b> This is a static demo — card payment is simulated and your
      registration is stored in this browser only, never sent anywhere. The full version with live Stripe
      checkout runs on the Node server included in the repository.</div>`;
  }

  document.querySelectorAll('[data-static-text]').forEach((el) => {
    el.textContent = el.dataset.staticText;
  });

  const status = document.getElementById('summaryStatus');
  if (status) status.textContent = 'Demo';
});
