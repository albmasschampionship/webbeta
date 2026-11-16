/* Minimal admin console for the registration database. */

import { toast } from './main.js';

const $ = (sel) => document.querySelector(sel);
const money = (cents, currency = 'EUR') =>
  new Intl.NumberFormat('en-GB', { style: 'currency', currency }).format((cents || 0) / 100);

let token = sessionStorage.getItem('amc27-admin') || '';

async function fetchData() {
  if (!token) return;
  try {
    const res = await fetch('/api/admin/registrations', { headers: { 'x-admin-token': token } });
    if (res.status === 401) throw new Error('That token is not valid.');
    if (!res.ok) throw new Error('Could not load registrations.');
    const data = await res.json();
    render(data);
  } catch (err) {
    $('#error').hidden = false;
    $('#error').textContent = err.message;
    $('#stats').hidden = true;
  }
}

function render({ stats, records }) {
  $('#error').hidden = true;
  $('#stats').hidden = false;
  $('#statTotal').textContent = stats.total;
  $('#statPaid').textContent = stats.paid;
  $('#statRevenue').textContent = money(stats.revenue);
  $('#statCompetitors').textContent = stats.competitors;
  $('#csvBtn').disabled = false;
  $('#refreshBtn').disabled = false;

  if (!records.length) {
    $('#rows').innerHTML =
      '<tr><td colspan="10" style="padding:28px;text-align:center;color:var(--muted)">No registrations yet.</td></tr>';
    return;
  }

  $('#rows').innerHTML = records
    .map((r) => {
      const cat = r.competitor?.category
        ? r.competitor.category.replace(/-/g, ' ')
        : '—';
      return `<tr>
      <td><b style="font-family:var(--ff-display)">${r.ref}</b></td>
      <td>${new Date(r.createdAt).toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' })}</td>
      <td>${escapeHtml(r.registration?.firstName || '')} ${escapeHtml(r.registration?.lastName || '')}</td>
      <td>${escapeHtml(r.registration?.email || '')}</td>
      <td>${escapeHtml(r.registration?.country || '')}</td>
      <td>${escapeHtml(r.passName)}${r.quantity > 1 ? ` ×${r.quantity}` : ''}</td>
      <td style="text-transform:capitalize">${cat}</td>
      <td>${money(r.total)}</td>
      <td><span class="pill pill--${r.status}">${r.status}</span></td>
      <td style="font-family:var(--ff-display);letter-spacing:.08em">${r.checkInCode || '—'}</td>
    </tr>`;
    })
    .join('');
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function exportCsv() {
  try {
    const res = await fetch('/api/admin/export.csv', { headers: { 'x-admin-token': token } });
    if (!res.ok) throw new Error('Export failed.');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'amc2027-registrations.csv';
    a.click();
    URL.revokeObjectURL(url);
    toast('CSV exported.');
  } catch (err) {
    toast(err.message);
  }
}

$('#loginBtn').addEventListener('click', () => {
  token = $('#token').value.trim();
  if (!token) return toast('Enter the admin token.');
  sessionStorage.setItem('amc27-admin', token);
  fetchData();
});
$('#token').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') $('#loginBtn').click();
});
$('#refreshBtn').addEventListener('click', fetchData);
$('#csvBtn').addEventListener('click', exportCsv);

if (token) {
  $('#token').value = token;
  fetchData();
}
