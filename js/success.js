/* Confirmation page: resolves the registration, renders the ticket. */

import { toast } from './main.js';

const params = new URLSearchParams(location.search);
const ref = params.get('ref');
const sessionId = params.get('session_id');
const isDemoParam = params.get('demo') === '1';
const isStatic = Boolean(window.AMC_STATIC);

const $ = (sel) => document.querySelector(sel);
const money = (cents, currency = 'EUR') =>
  new Intl.NumberFormat('en-GB', { style: 'currency', currency }).format((cents || 0) / 100);

function showState({ tone = 'pending', title, text, actions = '' }) {
  const wrap = $('#stateMsg');
  const icons = {
    pending: '#i-clock',
    failed: '#i-alert',
    ok: '#i-check'
  };
  const cls = { pending: 'status-orb--pending', failed: 'status-orb--failed', ok: '' }[tone] || '';
  wrap.innerHTML = `
    <div class="panel status-card">
      <div class="status-orb ${cls}"><svg width="30" height="30"><use href="${icons[tone] || '#i-clock'}"/></svg></div>
      <h2>${title}</h2>
      <p>${text}</p>
      ${actions}
    </div>`;
  wrap.hidden = false;
}

async function fetchRegistration() {
  const res = await fetch(`/api/registration/${encodeURIComponent(ref)}`);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Registration not found.');
  }
  return res.json();
}

async function waitForPayment() {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const record = await fetchRegistration();
    if (record.status === 'paid') return record;
    if (record.status === 'cancelled' || record.status === 'refunded') return record;
    await new Promise((r) => setTimeout(r, 2500));
  }
  return fetchRegistration();
}

function render(record) {
  $('#stateMsg').hidden = true;
  $('#content').hidden = false;

  const paid = record.status === 'paid';
  const name = `${record.customer.firstName} ${record.customer.lastName}`.trim();

  $('#tName').textContent = name || '—';
  $('#tPass').textContent = record.quantity > 1 ? `${record.passName} × ${record.quantity}` : record.passName;
  $('#tRef').textContent = record.ref;
  $('#tTotal').textContent = money(record.total, record.currency);

  let category = '—';
  if (record.category) {
    const cat = record.category.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
    category = record.extraCategory ? `${cat} + second category` : cat;
  }
  $('#tCat').textContent = category;

  const stamp = $('#stamp');
  stamp.textContent = paid ? 'Paid · valid' : 'Awaiting payment';
  stamp.classList.toggle('is-pending', !paid);

  $('#tCode').textContent = record.checkInCode || '—';

  $('#okTitle').textContent = paid ? "You're in!" : 'Payment not completed';
  $('#okText').textContent = paid
    ? isStatic
      ? 'Preview build: your registration is saved in this browser only — nothing was sent or charged.'
      : `A confirmation has been sent to ${record.customer.email}.`
    : isStatic
      ? 'This preview could not complete the simulated payment. Try the booking form again.'
      : 'Your reservation is on hold. Complete the payment to receive your check-in code.';

  const rows = [
    ['Booking reference', record.ref],
    ['Status', paid ? (record.demo ? 'Paid (demo)' : 'Paid') : record.status],
    ['Pass', record.passName],
    ['Total', money(record.total, record.currency)],
    ['Payment', record.paymentProvider === 'stripe' ? 'Stripe · card' : 'Demo (simulated)']
  ];
  if (sessionId) rows.push(['Session', sessionId.slice(-12)]);

  $('#kvList').innerHTML = rows
    .map(([k, v]) => `<div><dt>${k}</dt><dd>${v}</dd></div>`)
    .join('');

  if (!paid) {
    const cta = document.querySelector('.status-card .btn');
    if (cta) {
      cta.textContent = 'Retry payment';
      cta.href = '/book' + (record.passId ? `?pass=${record.passId}` : '');
    }
  }

  buildCalendar(record);
  window.__record = record;
}

function buildCalendar(record) {
  const start = '20270521T070000Z'; // 09:00 Europe/Tirane (CEST, UTC+2)
  const end = '20270523T210000Z';
  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Global Manual Therapy//AMC 2027//EN',
    'BEGIN:VEVENT',
    `UID:${record.ref}@albanianmassagechampionship.com`,
    `DTSTAMP:${start}`,
    `DTSTART:${start}`,
    `DTEND:${end}`,
    'SUMMARY:Albanian Massage Championship 2027',
    'LOCATION:Palace of Congresses\\, Bulevardi Dëshmorët e Kombit\\, Tirana\\, Albania',
    `DESCRIPTION:Pass: ${record.passName}\\nReference: ${record.ref}\\nCheck-in code: ${record.checkInCode || 'pending'}`,
    'END:VEVENT',
    'END:VCALENDAR'
  ].join('\r\n');

  $('#icsBtn').addEventListener('click', () => {
    const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `amc2027-${record.ref}.ics`;
    a.click();
    URL.revokeObjectURL(url);
    toast('Calendar file downloaded.');
  });
}

$('#printBtn')?.addEventListener('click', () => window.print());

(async function init() {
  if (!ref) {
    showState({
      tone: 'failed',
      title: 'No booking reference',
      text: 'This page needs a booking reference. If you have just paid, check your email for the confirmation link.',
      actions: '<a class="btn btn--grad" href="/book">Go to booking</a>'
    });
    return;
  }

  try {
    let record = await fetchRegistration();

    // In demo mode, simulate the payment confirmation on this page.
    if (record.status === 'pending' && record.demo && (isDemoParam || record.paymentProvider === 'demo')) {
      const res = await fetch('/api/demo/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ref })
      });
      if (res.ok) record = await res.json();
    }

    if (record.status === 'pending' && record.paymentProvider === 'stripe') {
      showState({
        tone: 'pending',
        title: 'Confirming your payment…',
        text: 'Stripe has your payment and we are waiting for the confirmation. This page updates automatically.'
      });
      record = await waitForPayment();
    }

    if (record.status === 'cancelled') {
      showState({
        tone: 'failed',
        title: 'Payment was cancelled',
        text: 'Nothing has been charged. Your registration details are still saved in this browser — you can pick up where you left off.',
        actions: '<a class="btn btn--grad" href="/book">Return to booking</a>'
      });
      return;
    }

    render(record);
  } catch (err) {
    showState({
      tone: 'failed',
      title: 'We could not find that booking',
      text: err.message || 'Please check the link in your confirmation email.',
      actions: '<a class="btn btn--grad" href="/book">Back to booking</a>'
    });
  }
})();
