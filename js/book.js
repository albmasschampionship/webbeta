/* Booking flow: pass selection → registration → Stripe payment. */

import { toast } from './main.js';

const state = {
  config: null,
  passId: null,
  quantity: 1,
  addons: new Set(),
  promo: '',
  step: 1,
  quote: null,
  submitting: false
};

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const money = (cents, currency = 'EUR') =>
  new Intl.NumberFormat('en-GB', { style: 'currency', currency }).format((cents || 0) / 100);

const form = $('#bookingForm');
const passList = $('#passList');
const addonList = $('#addonList');
const addonSection = $('#addonSection');
const competitorSection = $('#competitorSection');
const quantityInput = $('#quantity');
const qtyWrap = $('#qtyWrap');
const payBtn = $('#payBtn');

/* ------------------------------------------------------------------ config */
async function load() {
  try {
    const res = await fetch('/api/config');
    if (!res.ok) throw new Error('config');
    state.config = await res.json();
  } catch {
    toast('Could not load the booking configuration. Please refresh.');
    return;
  }

  if (state.config.demoMode) {
    const banner = $('#demoBanner');
    if (banner) banner.hidden = false;
  }

  fillCountries();
  fillCategories();
  renderPasses();

  const params = new URLSearchParams(location.search);
  const passParam = params.get('pass');
  const mode = params.get('mode');
  const preset = state.config.passes.find((p) => p.id === passParam);
  if (preset) selectPass(preset.id);
  else if (mode === 'competitor') selectPass('competitor-entry');
  else selectPass(state.config.passes[0].id);

  if (params.get('status') === 'cancelled') {
    toast('Payment cancelled — your details are still here, nothing was charged.');
  }

  restoreDraft();
  computeQuote();
}

function fillCountries() {
  const select = $('#country');
  if (!select) return;
  const frag = document.createDocumentFragment();
  for (const [code, name] of state.config.countries) {
    const opt = document.createElement('option');
    opt.value = code === 'MX2' ? 'MX' : code;
    opt.textContent = name;
    frag.appendChild(opt);
  }
  select.appendChild(frag);
  select.value = 'AL';
}

function fillCategories() {
  for (const id of ['category', 'extraCategory']) {
    const select = document.getElementById(id);
    if (!select) continue;
    const frag = document.createDocumentFragment();
    for (const cat of state.config.categories) {
      const opt = document.createElement('option');
      opt.value = cat.id;
      opt.textContent = cat.name;
      frag.appendChild(opt);
    }
    select.appendChild(frag);
  }
}

/* ------------------------------------------------------------------ passes */
function renderPasses() {
  passList.innerHTML = '';
  state.config.passes.forEach((pass) => {
    const isCompetitor = pass.kind === 'competitor';
    const label = document.createElement('label');
    label.className = `pass${isCompetitor ? ' pass--competitor' : ''}`;
    label.innerHTML = `
      <input type="radio" name="passId" value="${pass.id}" />
      <span class="pass__tick" aria-hidden="true"></span>
      <span>
        <span class="pass__name">${pass.name}
          ${pass.badge ? `<span class="tag${isCompetitor ? '' : ''}">${pass.badge}</span>` : ''}
          ${isCompetitor ? '<span class="tag tag--soft">Registration required</span>' : ''}
        </span>
        <span class="pass__desc">${pass.blurb}</span>
      </span>
      <span class="pass__price">${money(pass.price)}
        <small>${isCompetitor ? 'per competitor' : 'per person'}</small>
      </span>`;
    label.querySelector('input').addEventListener('change', () => selectPass(pass.id));
    passList.appendChild(label);
  });
}

function selectPass(passId) {
  const pass = state.config.passes.find((p) => p.id === passId);
  if (!pass) return;
  state.passId = passId;
  const input = passList.querySelector(`input[value="${passId}"]`);
  if (input) input.checked = true;

  const isCompetitor = pass.kind === 'competitor';
  competitorSection.hidden = !isCompetitor;
  qtyWrap.style.display = isCompetitor ? 'none' : '';
  if (isCompetitor) setQuantity(1);
  else if (state.quantity < 1) setQuantity(1);

  // Extra category only makes sense for competitors
  if (!isCompetitor) state.addons.delete('extra-category');
  const extra = $('#extraCategory');
  if (extra) {
    extra.disabled = !state.addons.has('extra-category');
    if (extra.disabled) extra.value = '';
  }

  renderAddons(passId);
  updateTabs();
  computeQuote();
  saveDraft();
}

function setQuantity(n) {
  state.quantity = Math.min(Math.max(n, 1), state.config?.maxQuantity || 6);
  quantityInput.value = String(state.quantity);
  computeQuote();
  saveDraft();
}

function renderAddons(passId) {
  const allowed = state.config.addonsByPass[passId] || [];
  addonList.innerHTML = '';
  if (!allowed.length) {
    addonSection.hidden = true;
    return;
  }
  addonSection.hidden = false;
  allowed.forEach((id) => {
    const extra = state.config.extras.find((e) => e.id === id);
    if (!extra) return;
    const row = document.createElement('label');
    row.className = 'addon';
    row.innerHTML = `
      <input type="checkbox" value="${extra.id}" ${state.addons.has(extra.id) ? 'checked' : ''} />
      <span class="addon__name">${extra.name}${extra.id === 'extra-category' ? ' <span class="tag tag--soft">+€45</span>' : ''}</span>
      <span class="addon__price">${money(extra.price)}</span>`;
    const box = row.querySelector('input');
    box.addEventListener('change', () => {
      if (box.checked) state.addons.add(extra.id);
      else state.addons.delete(extra.id);
      if (extra.id === 'extra-category') {
        const extraSelect = $('#extraCategory');
        extraSelect.disabled = !box.checked;
        if (!box.checked) extraSelect.value = '';
      }
      computeQuote();
      saveDraft();
    });
    addonList.appendChild(row);
  });
}

/* ------------------------------------------------------------------ quote */
let quoteTimer;
function computeQuote() {
  clearTimeout(quoteTimer);
  quoteTimer = setTimeout(fetchQuote, 140);
}

async function fetchQuote() {
  if (!state.passId) return;
  const params = new URLSearchParams({
    passId: state.passId,
    quantity: String(state.quantity),
    addons: [...state.addons].join(',')
  });
  if (state.promo) params.set('promoCode', state.promo);

  try {
    const res = await fetch(`/api/quote?${params}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'quote');
    state.quote = data;
    renderSummary();
  } catch {
    toast('Could not update the price. Please try again.');
  }
}

function renderSummary() {
  const q = state.quote;
  const lines = $('#summaryLines');
  if (!q) {
    lines.innerHTML = '<div class="summary__line"><span>No pass selected yet</span><span>—</span></div>';
    return;
  }

  lines.innerHTML = q.lines
    .map(
      (line) => `<div class="summary__line">
        <span>${line.label}${line.qty > 1 ? `<small>${line.qty} × ${money(line.unit)}</small>` : ''}</span>
        <span>${money(line.total)}</span>
      </div>`
    )
    .join('');

  $('#sumSubtotal').textContent = money(q.subtotal);
  $('#sumTotal').textContent = money(q.total);

  const discountRow = $('#sumDiscountRow');
  if (q.discount > 0) {
    discountRow.hidden = false;
    $('#sumDiscount').textContent = `−${money(q.discount)}`;
    $('#promoMsg').textContent = `${q.appliedPromo.code} applied — ${q.appliedPromo.label}`;
    $('#promoMsg').className = 'promo-msg ok';
  } else {
    discountRow.hidden = true;
    if (state.promo) {
      $('#promoMsg').textContent = 'That code is not valid for this pass.';
      $('#promoMsg').className = 'promo-msg bad';
    }
  }
  $('#summaryStatus').textContent = state.passId ? 'Ready' : 'Draft';
}

/* ------------------------------------------------------------------- steps */
function updateTabs() {
  $$('.step').forEach((el) => {
    const n = Number(el.dataset.step);
    el.classList.toggle('is-active', n === state.step);
    el.classList.toggle('is-done', n < state.step);
    el.querySelector('.step__num').textContent = n < state.step ? '✓' : String(n);
  });
  $$('.form-block').forEach((block) => {
    block.classList.toggle('is-active', Number(block.dataset.block) === state.step);
  });
}

function goStep(n) {
  if (n > state.step) {
    if (state.step === 1 && !state.passId) {
      toast('Choose a pass to continue.');
      return;
    }
    if (state.step === 2 && !validateStep2()) return;
  }
  if (n === 3) renderReview();
  state.step = n;
  updateTabs();
  $('#stepper').scrollIntoView({ behavior: 'smooth', block: 'start' });
  saveDraft();
}

function setError(field, message) {
  const wrapper = field.closest('.field');
  if (!wrapper) return;
  wrapper.classList.add('has-error');
  const slot = wrapper.querySelector('.field__error');
  if (slot) slot.textContent = message;
}

function clearErrors() {
  $$('.field.has-error').forEach((f) => f.classList.remove('has-error'));
}

function validateStep2() {
  clearErrors();
  const v = (name) => (form.elements[name]?.value || '').trim();
  const errors = [];
  const fail = (name, msg) => {
    errors.push(name);
    const el = form.elements[name];
    if (el) setError(el, msg);
  };

  if (v('firstName').length < 2) fail('firstName', 'Enter your first name.');
  if (v('lastName').length < 2) fail('lastName', 'Enter your last name.');
  if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(v('email'))) fail('email', 'Enter a valid email address.');
  if (v('phone').replace(/\D/g, '').length < 7) fail('phone', 'Enter a phone number with country code.');
  if (!v('country')) fail('country', 'Select your country.');
  if (v('city').length < 2) fail('city', 'Enter your city.');

  const dob = v('dateOfBirth');
  if (!dob) fail('dateOfBirth', 'Enter your date of birth.');
  else {
    const d = new Date(`${dob}T00:00:00Z`);
    const ref = new Date('2027-05-21T00:00:00Z');
    let age = ref.getUTCFullYear() - d.getUTCFullYear();
    const m = ref.getUTCMonth() - d.getUTCMonth();
    if (m < 0 || (m === 0 && ref.getUTCDate() < d.getUTCDate())) age -= 1;
    if (age < 18) fail('dateOfBirth', 'You must be at least 18 on 21 May 2027.');
  }

  if (!v('idType')) fail('idType', 'Select your ID document type.');
  if (v('idNumber').length < 4) fail('idNumber', 'Enter the document number.');
  if (v('emergencyName').length < 3) fail('emergencyName', 'Enter an emergency contact.');
  if (v('emergencyPhone').replace(/\D/g, '').length < 7) fail('emergencyPhone', 'Enter an emergency phone number.');
  if (v('emergencyRelation').length < 2) fail('emergencyRelation', 'Tell us how to reach this person.');

  const pass = state.config.passes.find((p) => p.id === state.passId);
  if (pass?.kind === 'competitor' || state.addons.has('extra-category')) {
    if (!v('profession')) fail('profession', 'Select your professional background.');
    const years = Number(v('yearsExperience'));
    if (!Number.isFinite(years) || v('yearsExperience') === '' || years < 0 || years > 60) {
      fail('yearsExperience', 'Years of experience must be between 0 and 60.');
    }
    if (v('qualification').length < 4) fail('qualification', 'Name your diploma or certification.');
    if (!v('category')) fail('category', 'Choose your competition category.');
    if (state.addons.has('extra-category') && !v('extraCategory')) fail('extraCategory', 'Choose your second category.');
    if (v('insuranceProvider').length < 2) fail('insuranceProvider', 'Enter your insurance provider.');
    if (v('insurancePolicyNo').length < 3) fail('insurancePolicyNo', 'Enter your policy number.');
    if (!v('shirtSize')) fail('shirtSize', 'Select your kit size.');
    if (v('portfolioUrl') && !/^(https?:\/\/)?[\w.-]+\.[a-z]{2,}(\/\S*)?$/i.test(v('portfolioUrl'))) {
      fail('portfolioUrl', 'Enter a valid link.');
    }
  }

  if (errors.length) {
    const first = form.elements[errors[0]];
    first?.closest('.field')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    first?.focus({ preventScroll: true });
    toast('Please complete the highlighted fields.');
    return false;
  }
  return true;
}

/* ------------------------------------------------------------------ review */
function readForm() {
  const data = {};
  for (const el of form.elements) {
    if (!el.name) continue;
    if (el.type === 'radio') {
      if (el.checked) data[el.name] = el.value;
      continue;
    }
    if (el.type === 'checkbox') data[el.name] = el.checked;
    else data[el.name] = el.value.trim ? el.value.trim() : el.value;
  }
  return data;
}

function renderReview() {
  const d = readForm();
  const pass = state.config.passes.find((p) => p.id === state.passId);
  const catName = (id) => state.config.categories.find((c) => c.id === id)?.name || '—';
  const rows = [
    ['Attendee', `${d.firstName} ${d.lastName}`],
    ['Email', d.email],
    ['Phone', d.phone],
    ['Country / city', `${state.config.countries.find(([code]) => code === d.country)?.[1] || d.country} · ${d.city}`],
    ['Pass', `${pass?.name}${state.quantity > 1 ? ` × ${state.quantity}` : ''}`]
  ];
  if (pass?.kind === 'competitor') {
    rows.push(['Category', catName(d.category) + (d.extraCategory ? ` + ${catName(d.extraCategory)}` : '')]);
  }
  rows.push(['Total', money(state.quote?.total || 0)]);

  $('#reviewBox').innerHTML = rows
    .map(
      ([k, val]) => `<div style="display:flex;justify-content:space-between;gap:18px;padding:10px 0;border-bottom:1px dashed var(--line);font-size:.9rem">
        <span style="color:var(--muted)">${k}</span>
        <span style="font-weight:600;text-align:right">${val || '—'}</span>
      </div>`
    )
    .join('');
}

/* ------------------------------------------------------------------ submit */
form.addEventListener('submit', async (e) => {
  e.preventDefault();
  if (state.submitting) return;

  clearErrors();
  if (!validateStep2()) {
    state.step = 2;
    updateTabs();
    return;
  }

  const d = readForm();
  const consentErrors = [];
  if (!d.acceptTerms) consentErrors.push(['acceptTerms', 'You must accept the terms.']);
  if (!d.acceptPrivacy) consentErrors.push(['acceptPrivacy', 'You must accept the privacy policy.']);
  if (!d.healthDeclaration) consentErrors.push(['healthDeclaration', 'Please confirm the declaration.']);
  if (consentErrors.length) {
    consentErrors.forEach(([name, msg]) => setError(form.elements[name], msg));
    form.elements[consentErrors[0][0]].closest('.field')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    toast('Please accept the required declarations.');
    return;
  }

  const pass = state.config.passes.find((p) => p.id === state.passId);
  const isCompetitor = pass?.kind === 'competitor';

  const payload = {
    passId: state.passId,
    quantity: isCompetitor ? 1 : state.quantity,
    addons: [...state.addons],
    promoCode: state.promo,
    registration: {
      firstName: d.firstName,
      lastName: d.lastName,
      email: d.email,
      phone: d.phone,
      country: d.country,
      city: d.city,
      dateOfBirth: d.dateOfBirth,
      gender: d.gender,
      idType: d.idType,
      idNumber: d.idNumber,
      emergencyName: d.emergencyName,
      emergencyPhone: d.emergencyPhone,
      emergencyRelation: d.emergencyRelation,
      notes: d.notes,
      acceptTerms: d.acceptTerms,
      acceptPrivacy: d.acceptPrivacy,
      mediaConsent: d.mediaConsent,
      healthDeclaration: d.healthDeclaration,
      ...(isCompetitor || state.addons.has('extra-category')
        ? {
            profession: d.profession,
            yearsExperience: d.yearsExperience,
            qualification: d.qualification,
            category: d.category,
            extraCategory: d.extraCategory,
            insuranceProvider: d.insuranceProvider,
            insurancePolicyNo: d.insurancePolicyNo,
            shirtSize: d.shirtSize,
            federationNumber: d.federationNumber,
            portfolioUrl: d.portfolioUrl
          }
        : {})
    }
  };

  state.submitting = true;
  payBtn.disabled = true;
  const label = $('#payBtnLabel');
  const original = label.textContent;
  label.textContent = 'Redirecting to secure payment…';

  try {
    const res = await fetch('/api/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) {
      if (data.fields) {
        Object.entries(data.fields).forEach(([name, msg]) => {
          const el = form.elements[name];
          if (el) setError(el, msg);
        });
        const first = Object.keys(data.fields)[0];
        form.elements[first]?.closest('.field')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      throw new Error(data.error || 'Booking failed.');
    }

    localStorage.removeItem('amc27-draft');
    window.location.assign(data.redirectUrl);
  } catch (err) {
    toast(err.message || 'Something went wrong. Please try again.');
    label.textContent = original;
    payBtn.disabled = false;
    state.submitting = false;
  }
});

/* ------------------------------------------------------------------ wiring */
$$('[data-next]').forEach((btn) => btn.addEventListener('click', () => goStep(Number(btn.dataset.next))));
$$('[data-back]').forEach((btn) => btn.addEventListener('click', () => goStep(Number(btn.dataset.back))));

$$('[data-qty]').forEach((btn) =>
  btn.addEventListener('click', () => setQuantity(state.quantity + Number(btn.dataset.qty)))
);

$('#applyPromo')?.addEventListener('click', () => {
  const code = $('#promoCode').value.trim().toUpperCase();
  state.promo = code;
  if (!code) {
    $('#promoMsg').textContent = '';
  }
  computeQuote();
  saveDraft();
});

$('#promoCode')?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    $('#applyPromo').click();
  }
});

form.addEventListener('input', saveDraft);
form.addEventListener('change', saveDraft);

// Clear a field's error as soon as the visitor starts fixing it.
form.addEventListener('input', (e) => {
  const wrapper = e.target.closest('.field.has-error');
  if (wrapper && e.target.value) wrapper.classList.remove('has-error');
});
form.addEventListener('change', (e) => {
  const wrapper = e.target.closest('.field.has-error');
  if (!wrapper) return;
  if (e.target.type === 'checkbox' || e.target.value) wrapper.classList.remove('has-error');
});

/* ------------------------------------------------------------------- draft */
function saveDraft() {
  try {
    const data = readForm();
    delete data.acceptTerms;
    delete data.acceptPrivacy;
    delete data.healthDeclaration;
    delete data.mediaConsent;
    localStorage.setItem(
      'amc27-draft',
      JSON.stringify({ passId: state.passId, quantity: state.quantity, addons: [...state.addons], promo: state.promo, data })
    );
  } catch {
    /* storage full / disabled — not critical */
  }
}

function restoreDraft() {
  let draft;
  try {
    draft = JSON.parse(localStorage.getItem('amc27-draft') || 'null');
  } catch {
    return;
  }
  if (!draft || draft.paid) return;

  if (draft.passId && state.config.passes.some((p) => p.id === draft.passId)) {
    (draft.addons || []).forEach((a) => {
      if ((state.config.addonsByPass[draft.passId] || []).includes(a)) state.addons.add(a);
    });
    state.promo = draft.promo || '';
    if (draft.promo) $('#promoCode').value = draft.promo;
    selectPass(draft.passId);
    if (draft.quantity) setQuantity(draft.quantity);
  }

  if (draft.data) {
    Object.entries(draft.data).forEach(([key, value]) => {
      if (key === 'passId' || key === 'quantity') return;
      const el = form.elements[key];
      if (!el || el.type === 'checkbox' || el.type === 'radio') return;
      if (el.tagName === 'SELECT' && value && ![...el.options].some((o) => o.value === value)) return;
      el.value = value;
    });
  }
}

load();
