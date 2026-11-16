// Single source of truth for the event, the ticket catalogue and pricing.
// The browser receives this through GET /api/config, so the booking UI and the
// server can never disagree about what a pass costs.

export const EVENT = {
  name: 'Albanian Massage Championship',
  year: 2027,
  edition: 'III',
  tagline: 'Three days of hands-on excellence',
  start: '2027-05-21T09:00:00+02:00',
  end: '2027-05-23T23:00:00+02:00',
  datesLabel: '21 – 23 May 2027',
  venue: 'Palace of Congresses (Pallati i Kongreseve)',
  city: 'Tirana',
  country: 'Albania',
  address: 'Bulevardi Dëshmorët e Kombit, 1001 Tirana, Albania',
  currency: 'EUR',
  locale: 'en-GB',
  supportEmail: 'tickets@albanianmassagechampionship.com',
  supportPhone: '+355 69 000 2027',
  social: {
    instagram: 'https://www.instagram.com/globalmanualtherapy/',
    facebook: 'https://www.facebook.com/',
    youtube: 'https://www.youtube.com/'
  }
};

export const CATEGORIES = [
  { id: 'swedish', name: 'Swedish & Relaxation', icon: 'leaf', blurb: 'Flowing, classic full-body work judged on rhythm, pressure and client comfort.' },
  { id: 'deep-tissue', name: 'Deep Tissue & Myofascial', icon: 'layers', blurb: 'Slow, structural work on the deeper layers — precision over force.' },
  { id: 'sports', name: 'Sports & Recovery', icon: 'bolt', blurb: 'Pre- and post-event protocols, taping and return-to-play thinking.' },
  { id: 'hot-stone', name: 'Hot Stone & Thermal', icon: 'flame', blurb: 'Heat-driven sequences that show control of temperature and placement.' },
  { id: 'aroma', name: 'Aromatherapy & Oils', icon: 'drop', blurb: 'Blending, dilution safety and the sensory architecture of a treatment.' },
  { id: 'thai', name: 'Thai & Stretch', icon: 'stretch', blurb: 'Mat-based assisted stretching, body weight and breath coordination.' },
  { id: 'lymphatic', name: 'Lymphatic & Facial', icon: 'face', blurb: 'Light-touch drainage, facial sculpting and post-operative protocols.' },
  { id: 'cupping', name: 'Cupping & Instrument Assisted', icon: 'cup', blurb: 'Modern instrument work with evidence-based application and hygiene.' },
  { id: 'reflexology', name: 'Reflexology', icon: 'foot', blurb: 'Zone mapping, thumb technique and full-session choreography.' },
  { id: 'freestyle', name: 'Freestyle / Signature', icon: 'star', blurb: 'Your own method, your own story — the crowd favourite category.' }
];

export const PASSES = [
  {
    id: 'day-pass',
    name: 'Day Pass',
    kind: 'spectator',
    price: 2900,
    badge: null,
    blurb: 'One full competition day of your choice.',
    perks: [
      'Access to all competition halls for a single day',
      'Live scoring screen & commentary',
      'Free masterclass observation (subject to seats)',
      'Championship wristband'
    ]
  },
  {
    id: 'weekend-pass',
    name: 'Weekend Pass',
    kind: 'spectator',
    price: 5900,
    badge: 'Most popular',
    blurb: 'All three days, including the Grand Final.',
    perks: [
      'Full 3-day access, 21 – 23 May 2027',
      'Grand Final & Awards Ceremony seat',
      'Two open masterclasses included',
      'Championship tote + programme'
    ]
  },
  {
    id: 'vip-gala',
    name: 'VIP Gala Pass',
    kind: 'spectator',
    price: 14900,
    badge: 'Front row',
    blurb: 'Front-row seats and the gala dinner.',
    perks: [
      'Everything in the Weekend Pass',
      'Reserved front-row seating at the Final',
      'Gala dinner with competitors & jury',
      'Backstage lounge & meet-the-judges hour'
    ]
  },
  {
    id: 'competitor-entry',
    name: 'Competitor Entry',
    kind: 'competitor',
    price: 8900,
    badge: null,
    blurb: 'Your place on the floor — one category included.',
    perks: [
      'One competition category included',
      'Two competition days + Grand Final',
      'Certified scorecard & jury feedback',
      'Official competitor kit & certificate'
    ]
  }
];

// Paid add-ons. `extra-category` is only valid with the competitor entry.
export const EXTRAS = [
  { id: 'extra-category', name: 'Additional category', price: 4500, competitorOnly: true },
  { id: 'gala-guest', name: 'Gala dinner guest seat', price: 6900, competitorOnly: false },
  { id: 'workshop', name: 'Pre-championship workshop (20 May)', price: 3500, competitorOnly: false }
];

export const PROMO_CODES = [
  { code: 'EARLYBIRD15', type: 'percent', value: 15, appliesTo: ['day-pass', 'weekend-pass', 'vip-gala', 'competitor-entry'] },
  { code: 'GMTSTUDENT', type: 'percent', value: 25, appliesTo: ['day-pass', 'weekend-pass'] }
];

export const ADDONS_BY_PASS = {
  'day-pass': ['workshop'],
  'weekend-pass': ['workshop', 'gala-guest'],
  'vip-gala': ['workshop'],
  'competitor-entry': ['extra-category', 'workshop', 'gala-guest']
};

export function getPass(id) {
  return PASSES.find((p) => p.id === id) || null;
}

export function getExtra(id) {
  return EXTRAS.find((e) => e.id === id) || null;
}

function findPromo(code) {
  if (!code) return null;
  return PROMO_CODES.find((p) => p.code === String(code).trim().toUpperCase()) || null;
}

/**
 * Server-side authoritative price calculation.
 * @param {{passId:string, quantity?:number, addons?:string[], promoCode?:string}} input
 */
export function quote({ passId, quantity = 1, addons = [], promoCode = '' } = {}) {
  const pass = getPass(passId);
  if (!pass) throw new Error('Unknown pass');

  const qty = Math.min(Math.max(Number.parseInt(quantity, 10) || 1, 1), 6);
  const allowed = ADDONS_BY_PASS[pass.id] || [];
  const chosen = [...new Set(addons.filter((a) => allowed.includes(a)))];

  const lines = [{ sku: pass.id, label: pass.name, qty, unit: pass.price, total: pass.price * qty }];

  for (const id of chosen) {
    const extra = getExtra(id);
    if (!extra) continue;
    if (extra.competitorOnly && pass.kind !== 'competitor') continue;
    const extraQty = id === 'extra-category' ? 1 : qty;
    lines.push({ sku: extra.id, label: extra.name, qty: extraQty, unit: extra.price, total: extra.price * extraQty });
  }

  const subtotal = lines.reduce((sum, l) => sum + l.total, 0);

  const promo = findPromo(promoCode);
  let discount = 0;
  let appliedPromo = null;
  if (promo && promo.appliesTo.includes(pass.id)) {
    discount = Math.round((subtotal * promo.value) / 100);
    appliedPromo = { code: promo.code, type: promo.type, value: promo.value, label: `${promo.value}% off` };
  }

  const total = Math.max(subtotal - discount, 0);
  return { lines, subtotal, discount, appliedPromo, total, quantity: qty, pass };
}

export function formatMoney(cents, currency = EVENT.currency) {
  return new Intl.NumberFormat(EVENT.locale, { style: 'currency', currency }).format(cents / 100);
}
