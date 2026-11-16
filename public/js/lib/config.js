// Builds the public configuration payload shared by the Node server and the
// static (GitHub Pages) build, so both always describe the same event.
import { ADDONS_BY_PASS, CATEGORIES, EVENT, EXTRAS, PASSES, PROMO_CODES } from './catalog.js';
import { COUNTRIES } from './countries.js';
import { ID_TYPES, MIN_AGE, PROFESSIONS, SHIRT_SIZES } from './validate.js';

export function buildConfig({ demoMode = false, hosting = 'server' } = {}) {
  return {
    event: EVENT,
    passes: PASSES,
    extras: EXTRAS,
    addonsByPass: ADDONS_BY_PASS,
    categories: CATEGORIES,
    promos: PROMO_CODES.map(({ code }) => ({ code })),
    countries: COUNTRIES,
    professions: PROFESSIONS,
    idTypes: ID_TYPES,
    shirtSizes: SHIRT_SIZES,
    minAge: MIN_AGE,
    currency: EVENT.currency,
    demoMode,
    hosting,
    maxQuantity: 6
  };
}
