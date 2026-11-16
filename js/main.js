/* Global site behaviour: navigation, reveal animations, countdown, toasts. */

const nav = document.getElementById('nav');
const burger = document.getElementById('burger');
const mobileMenu = document.getElementById('mobileMenu');

function onScroll() {
  if (!nav) return;
  if (nav.dataset.stuck === 'always') {
    nav.classList.add('is-stuck');
    return;
  }
  nav.classList.toggle('is-stuck', window.scrollY > 24);
}
onScroll();
window.addEventListener('scroll', onScroll, { passive: true });

if (burger && mobileMenu) {
  const close = () => {
    mobileMenu.classList.remove('is-open');
    burger.setAttribute('aria-expanded', 'false');
    document.body.classList.remove('no-scroll');
  };
  burger.addEventListener('click', () => {
    const open = mobileMenu.classList.toggle('is-open');
    burger.setAttribute('aria-expanded', String(open));
    document.body.classList.toggle('no-scroll', open);
    if (open) {
      [...mobileMenu.querySelectorAll('a')].forEach((a, i) => {
        a.style.transitionDelay = `${0.06 * i + 0.05}s`;
      });
    }
  });
  mobileMenu.addEventListener('click', (e) => {
    if (e.target.closest('a') || e.target === mobileMenu) close();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
  });
}

/* Scroll reveal */
const revealEls = [...document.querySelectorAll('.reveal')];
if (revealEls.length) {
  if (!('IntersectionObserver' in window)) {
    revealEls.forEach((el) => el.classList.add('is-in'));
  } else {
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('is-in');
            io.unobserve(entry.target);
          }
        });
      },
      { rootMargin: '0px 0px -8% 0px', threshold: 0.08 }
    );
    revealEls.forEach((el, i) => {
      el.style.transitionDelay = `${Math.min(i % 5, 4) * 70}ms`;
      io.observe(el);
    });
  }
}

/* Countdown to the opening ceremony: 21 May 2027, 09:00 (Europe/Tirane) */
const countdown = document.getElementById('countdown');
if (countdown) {
  const target = new Date('2027-05-21T09:00:00+02:00').getTime();
  const fields = {
    days: countdown.querySelector('[data-cd="days"]'),
    hours: countdown.querySelector('[data-cd="hours"]'),
    minutes: countdown.querySelector('[data-cd="minutes"]'),
    seconds: countdown.querySelector('[data-cd="seconds"]')
  };
  const pad = (n) => String(n).padStart(2, '0');
  const tick = () => {
    const diff = Math.max(target - Date.now(), 0);
    const days = Math.floor(diff / 86_400_000);
    const hours = Math.floor((diff % 86_400_000) / 3_600_000);
    const minutes = Math.floor((diff % 3_600_000) / 60_000);
    const seconds = Math.floor((diff % 60_000) / 1000);
    if (fields.days) fields.days.textContent = String(days);
    if (fields.hours) fields.hours.textContent = pad(hours);
    if (fields.minutes) fields.minutes.textContent = pad(minutes);
    if (fields.seconds) fields.seconds.textContent = pad(seconds);
  };
  tick();
  setInterval(tick, 1000);
}

/* Toast helper (also exposed for other scripts) */
let toastTimer;
export function toast(message, duration = 3200) {
  const el = document.getElementById('toast');
  if (!el) return;
  el.textContent = message;
  el.classList.add('is-visible');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('is-visible'), duration);
}
window.__toast = toast;

/* Header year stamp */
document.querySelectorAll('[data-year]').forEach((el) => {
  el.textContent = new Date().getFullYear();
});
