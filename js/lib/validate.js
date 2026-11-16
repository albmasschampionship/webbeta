import { CATEGORIES, getPass } from './catalog.js';
import { COUNTRY_CODES } from './countries.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;
const ID_RE = /^[A-Za-z0-9\-\/]{4,32}$/;
const URL_RE = /^(https?:\/\/)?[\w.-]+\.[a-z]{2,}(\/\S*)?$/i;
export const MIN_AGE = 18;

const COMPETITION_START = new Date('2027-05-21T00:00:00+02:00');

export const ID_TYPES = ['passport', 'national-id', 'residence-permit', 'driving-licence'];
export const PROFESSIONS = [
  'massage-therapist',
  'physiotherapist',
  'osteopath',
  'chiropractor',
  'beauty-aesthetician',
  'sports-therapist',
  'student',
  'other'
];
export const SHIRT_SIZES = ['XS', 'S', 'M', 'L', 'XL', 'XXL', '3XL'];

function str(value, max = 200) {
  if (value === undefined || value === null) return '';
  return String(value).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function isTrue(value) {
  return value === true || value === 'true' || value === 'on' || value === 1 || value === '1';
}

export function ageOn(dobString, date = COMPETITION_START) {
  const dob = new Date(`${dobString}T00:00:00Z`);
  if (Number.isNaN(dob.getTime())) return null;
  let age = date.getUTCFullYear() - dob.getUTCFullYear();
  const monthDiff = date.getUTCMonth() - dob.getUTCMonth();
  if (monthDiff < 0 || (monthDiff === 0 && date.getUTCDate() < dob.getUTCDate())) age -= 1;
  return age;
}

/**
 * Validates and normalises a booking + registration payload.
 * Returns { ok, errors, data } where data is a clean, storable record.
 */
export function validateBooking(payload = {}) {
  const errors = {};

  const passId = str(payload.passId, 40);
  const pass = getPass(passId);
  if (!pass) errors.passId = 'Please choose a pass.';

  const quantity = Number.parseInt(payload.quantity, 10) || 1;
  if (quantity < 1 || quantity > 6) errors.quantity = 'Choose between 1 and 6 passes.';

  const addons = Array.isArray(payload.addons) ? payload.addons.map((a) => str(a, 40)).filter(Boolean) : [];
  const promoCode = str(payload.promoCode, 24).toUpperCase();

  const reg = payload.registration && typeof payload.registration === 'object' ? payload.registration : {};

  // ---- Personal details -------------------------------------------------
  const firstName = str(reg.firstName, 60);
  if (firstName.length < 2) errors.firstName = 'Enter your first name (at least 2 characters).';
  else if (!/^[\p{L}\s'.-]+$/u.test(firstName)) errors.firstName = 'Use letters only.';

  const lastName = str(reg.lastName, 60);
  if (lastName.length < 2) errors.lastName = 'Enter your last name (at least 2 characters).';
  else if (!/^[\p{L}\s'.-]+$/u.test(lastName)) errors.lastName = 'Use letters only.';

  const email = str(reg.email, 160).toLowerCase();
  if (!EMAIL_RE.test(email)) errors.email = 'Enter a valid email address.';

  const phone = str(reg.phone, 32);
  const phoneDigits = phone.replace(/[^\d]/g, '');
  if (phoneDigits.length < 7 || phoneDigits.length > 16) errors.phone = 'Enter a reachable phone number with country code.';

  const country = str(reg.country, 2).toUpperCase();
  if (!COUNTRY_CODES.has(country)) errors.country = 'Select your country.';

  const city = str(reg.city, 80);
  if (city.length < 2) errors.city = 'Enter your city.';

  const dateOfBirth = str(reg.dateOfBirth, 10);
  const age = /^\d{4}-\d{2}-\d{2}$/.test(dateOfBirth) ? ageOn(dateOfBirth) : null;
  if (age === null) errors.dateOfBirth = 'Enter your date of birth.';
  else if (age < MIN_AGE) errors.dateOfBirth = `You must be at least ${MIN_AGE} on 21 May 2027.`;
  else if (age > 100) errors.dateOfBirth = 'Please check your date of birth.';

  const idType = str(reg.idType, 24);
  if (!ID_TYPES.includes(idType)) errors.idType = 'Select your ID document type.';

  const idNumber = str(reg.idNumber, 32).toUpperCase();
  if (!ID_RE.test(idNumber)) errors.idNumber = 'Enter the document number (4–32 letters or digits).';

  const gender = str(reg.gender, 24);

  // ---- Emergency contact ------------------------------------------------
  const emergencyName = str(reg.emergencyName, 120);
  if (emergencyName.length < 3) errors.emergencyName = 'Enter an emergency contact name.';
  const emergencyPhone = str(reg.emergencyPhone, 32);
  if (emergencyPhone.replace(/[^\d]/g, '').length < 7) errors.emergencyPhone = 'Enter an emergency contact phone number.';
  const emergencyRelation = str(reg.emergencyRelation, 40);
  if (emergencyRelation.length < 2) errors.emergencyRelation = 'Tell us how we can reach this person.';

  // ---- Competitor-only details -----------------------------------------
  let competitor = null;
  if (pass?.kind === 'competitor' || addons.includes('extra-category')) {
    const profession = str(reg.profession, 40);
    if (!PROFESSIONS.includes(profession)) errors.profession = 'Select your professional background.';

    const yearsExperience = Number.parseInt(reg.yearsExperience, 10);
    if (!Number.isFinite(yearsExperience) || yearsExperience < 0 || yearsExperience > 60) {
      errors.yearsExperience = 'Years of experience must be between 0 and 60.';
    }

    const qualification = str(reg.qualification, 200);
    if (qualification.length < 4) errors.qualification = 'Name your diploma, school or certification.';

    const category = str(reg.category, 40);
    if (!CATEGORIES.some((c) => c.id === category)) errors.category = 'Choose your competition category.';

    let extraCategory = str(reg.extraCategory, 40);
    if (extraCategory) {
      if (!CATEGORIES.some((c) => c.id === extraCategory) || extraCategory === category) {
        errors.extraCategory = 'Pick a second, different category (or leave it empty).';
      }
      if (!addons.includes('extra-category')) {
        errors.extraCategory = 'Add the additional category to your order before selecting it.';
      }
      if (pass?.kind !== 'competitor') errors.extraCategory = 'Additional categories are for competitors only.';
    } else {
      extraCategory = '';
      if (addons.includes('extra-category')) errors.extraCategory = 'Choose the additional category you want to enter.';
    }

    const insuranceProvider = str(reg.insuranceProvider, 120);
    if (insuranceProvider.length < 2) errors.insuranceProvider = 'Enter your insurance provider.';

    const insurancePolicyNo = str(reg.insurancePolicyNo, 60);
    if (insurancePolicyNo.length < 3) errors.insurancePolicyNo = 'Enter your policy number.';

    const shirtSize = str(reg.shirtSize, 4).toUpperCase();
    if (!SHIRT_SIZES.includes(shirtSize)) errors.shirtSize = 'Select your competitor kit size.';

    const federationNumber = str(reg.federationNumber, 60);
    const portfolioUrl = str(reg.portfolioUrl, 200);
    if (portfolioUrl && !URL_RE.test(portfolioUrl)) errors.portfolioUrl = 'Enter a valid link (https://…).';

    competitor = {
      profession,
      yearsExperience,
      qualification,
      category,
      extraCategory,
      insuranceProvider,
      insurancePolicyNo,
      shirtSize,
      federationNumber,
      portfolio: portfolioUrl
    };
  }

  // ---- Consents ---------------------------------------------------------
  const consent = {
    terms: isTrue(reg.acceptTerms),
    privacy: isTrue(reg.acceptPrivacy),
    media: isTrue(reg.mediaConsent),
    health: isTrue(reg.healthDeclaration)
  };
  if (!consent.terms) errors.acceptTerms = 'You must accept the competition & ticketing terms.';
  if (!consent.privacy) errors.acceptPrivacy = 'You must accept the privacy policy.';
  if (!consent.health) errors.healthDeclaration = 'Please confirm the health & safety declaration.';

  const notes = str(reg.notes, 600);

  const data = {
    passId,
    passName: pass?.name || passId,
    passKind: pass?.kind || 'spectator',
    quantity,
    addons,
    promoCode,
    registration: {
      firstName,
      lastName,
      email,
      phone,
      country,
      city,
      dateOfBirth,
      age,
      idType,
      idNumber,
      gender,
      emergencyName,
      emergencyPhone,
      emergencyRelation,
      notes
    },
    competitor,
    consent
  };

  return { ok: Object.keys(errors).length === 0, errors, data };
}
