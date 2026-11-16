# Albanian Massage Championship — Tirana 2027

Website, ticketing and competitor registration for the **III Albanian Massage Championship —
14–16 May 2027, Palace of Congresses, Tirana**, open to all nationalities.

The visual identity follows the official artwork in `Logos/` (badge, "Tirana 2027" announcement):
Albanian red and gold-leaf on cream paper, Playfair Display for the display lines (with the gold
italic "Tirana 2027"), Archivo for everything else, and the Tirana skyline as the hero anchor.

![Landing page](docs/preview-home.jpg)

## Brand assets

| Source | Used as |
| --- | --- |
| `Logos/Logo.jpg` | circular badge, cut out to `public/assets/brand/logo-badge*.png` (nav, footer, favicon, ticket) |
| `Logos/colors.jpg` | colour/typography reference and the hero skyline band, cropped to `public/assets/brand/tirana-band.jpg` |
| — | palette `--red-600 #b21018`, `--gold #d9a441`, `--cream #faf2e2` in `public/css/site.css` |

No framework, no build step, no runtime dependencies: plain HTML/CSS/JS + a small Node server.

---

## Two ways to run it

| | **GitHub Pages** (`public/` as files) | **Node app** (repo root) |
| --- | --- | --- |
| Purpose | Public showcase, shareable demo | Real event: live ticketing |
| Payments | Simulated in the browser | **Stripe Checkout** (cards, 3-D Secure) |
| Registrations | `localStorage` of the visitor | Server-side JSON store + admin console |
| Email / webhook | — | Stripe webhook, ready for your provider |
| Needs hosting | none | any Node host (Docker/Render/VPS) |

Everything is one codebase: the same `public/` folder runs on Pages and is served by the Node app.

---

## 1. Publish to GitHub Pages (5 minutes)

`public/` is the website. It uses **relative URLs only**, so it works at
`https://<you>.github.io/<repo>/` (or any sub-folder) without configuration — no build step.

```bash
cd albanian-massage-championship-2027
git init
git add .
git commit -m "Albanian Massage Championship 2027 — website + booking"
git branch -M main
git remote add origin https://github.com/<you>/<repo>.git
git push -u origin main
```

Then in the repository: **Settings → Pages → Build and deployment → Source: GitHub Actions.**
The included workflow (`.github/workflows/pages.yml`) uploads `public/` and publishes it.

> **Deploying by hand?** Upload the **contents of `public/`** (not the folder itself) to the
> branch/folder your Pages site serves, and make sure `index.html` sits next to `css/`, `js/` and
> `assets/`. Never point Pages at the repository root — that folder holds the Node app.

Preview exactly what Pages will serve:

```bash
npm run preview   # http://127.0.0.1:4173  (plain files, no /api)
```

### What works on Pages

GitHub Pages only serves files, so there is no `/api`. `public/js/static-api.js` is loaded by every
page; it calls the real endpoint first and only falls back to a browser-side implementation when
nothing answers. The fallback reuses the same modules the server uses
(`public/js/lib/catalog.js`, `validate.js`, `config.js`), so prices, promo codes and validation
rules match exactly.

**Works on Pages**

* the whole marketing site, mobile menu, gallery, FAQ, countdown
* pass selection, add-ons, promo codes (`EARLYBIRD15`, `GMTSTUDENT`) with correct live totals
* the complete registration form, including competitor fields, with per-field validation
* confirmation page with ticket, booking reference and check-in code (print / add to calendar)
* `/admin.html` — lists the bookings made **in that browser** (token `gmt-admin-2027`), CSV export

**Does not work on Pages** (by design, and labelled in the UI)

* real card payments — the payment step is simulated and says so
* bookings are stored in the visitor's browser only: nothing is emailed, nothing is collected
  centrally, and the admin console only sees that browser's bookings

For real money you need the Node app below.

## 2. Run the full app (real Stripe payments)

```bash
npm start          # http://127.0.0.1:4321
```

Starts in **demo mode** until you add a Stripe key: the whole flow works, payments are simulated
and registrations are written to `data/registrations.json`.

```bash
cp .env.example .env
# STRIPE_SECRET_KEY=sk_test_…      ← from https://dashboard.stripe.com/test/apikeys
# PUBLIC_BASE_URL=http://127.0.0.1:4321
npm start
```

The booking page now redirects to Stripe Checkout; nothing changes in the UI.

* **Test cards** — `4242 4242 4242 4242` (success), `4000 0025 0000 3155` (3-D Secure),
  `4000 0000 0000 9995` (declined). Any future expiry, any CVC.
* **Webhook** (recommended) — endpoint `POST /api/stripe/webhook`, events
  `checkout.session.completed`, `checkout.session.expired`, `checkout.session.async_payment_succeeded`,
  `checkout.session.async_payment_failed`, `charge.refunded`; put the signing secret in
  `STRIPE_WEBHOOK_SECRET`. Without a webhook the confirmation page still resolves the payment by
  polling Stripe server-side, so local development needs no tunnel.
* **Admin** — `/admin`, token from `ADMIN_TOKEN` (default `gmt-admin-2027`, change it in `.env`).

### Deploy the Node app

```bash
docker build -t amc2027 .
docker run -p 4321:4321 --env-file .env -v "$PWD/data:/app/data" amc2027
```

`Dockerfile` binds `0.0.0.0` and health-checks `/api/config`. On Render/Fly/Railway: set
`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `ADMIN_TOKEN`, `PUBLIC_BASE_URL`, and mount a disk
for `/app/data`. Any TLS reverse proxy in front is fine (`X-Forwarded-*` is respected).

---

## The booking flow

**Step 1 — pass.** Day €29 · Weekend €59 · VIP Gala €149 · Competitor Entry €89, plus add-ons
(second category €45, gala guest €69, pre-championship workshop on 13 May €35) and promo codes
(`EARLYBIRD15` −15 %, `GMTSTUDENT` −25 % on spectator passes).

**Step 2 — registration file.** Required for every attendee:

* identity — first/last name, date of birth (18+ on 14 May 2027), ID type + document number
* contact — email, phone with country code, country, city
* safety — emergency contact name, phone, relationship
* *competitors only* — professional background, years of experience, diploma/certification,
  competition category (+ optional second category), insurance provider and policy number,
  kit size, federation number (optional), portfolio link (optional)

**Step 3 — review, consent, payment.** Terms, privacy and health declaration are mandatory; media
consent is optional. Prices are always recalculated server-side (`lib/catalog.js`) — the browser
can never set its own amount. Validation runs twice: in the browser for instant feedback and in
`lib/validate.js` on the server, whose per-field errors are mapped back onto the form.

### API (Node build)

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/config` | Event, passes, extras, categories, countries — drives the UI |
| `GET` | `/api/quote` | Server-side price for pass + quantity + add-ons + promo |
| `POST` | `/api/checkout` | Validate registration, store it, create the Stripe session |
| `GET` | `/api/registration/:ref` | Status lookup used by the confirmation page |
| `POST` | `/api/demo/confirm` | Demo mode only: marks a booking paid |
| `POST` | `/api/stripe/webhook` | Signed Stripe events |
| `GET` | `/api/admin/registrations` | JSON list + stats (`x-admin-token`) |
| `GET` | `/api/admin/export.csv` | CSV export (`x-admin-token`) |

---

## Project structure

```
server.js                 zero-dependency HTTP server + API routes
lib/store.js              JSON-file persistence (atomic, serialised)
lib/stripe.js             Stripe Checkout + webhook signature verification
lib/env.js                tiny .env loader

public/                   THE WEBSITE — serve it or publish it as-is
  index.html              landing page
  book.html               three-step booking flow
  success.html            confirmation + ticket
  admin.html              registrations console
  css/site.css            design system and all styles
  js/*.js                 page scripts (ES modules)
  js/static-api.js        fallback /api when there is no backend
  js/lib/catalog.js       event facts, passes, extras, promo codes, pricing
  js/lib/config.js        config payload shared by the server and the browser
  js/lib/validate.js      registration validation (used by both)
  assets/brand/           logo badge (PNG, transparent), Tirana skyline band
  assets/img/             event photography
  assets/fonts/           Playfair Display + Archivo woff2 subsets

.github/workflows/pages.yml   publishes public/ to GitHub Pages
Dockerfile                full app in a container
data/                     registrations.json (git-ignored)
docs/                     preview screenshots
```

## Editing content

* **Dates, venue, contact details, social links** → `EVENT` in `lib/catalog.js`.
* **Brand** → colours and type live in `public/css/site.css` (`:root`); swap the badge by replacing
  `public/assets/brand/logo-badge*.png` and the hero skyline in `public/assets/brand/tirana-band.jpg`.
* **Prices, passes, add-ons, promo codes** → `PASSES`, `EXTRAS`, `PROMO_CODES` in the same file;
  the landing page repeats the headline prices in `public/index.html` (`#tickets`) — keep both in
  sync.
* **Categories** → `CATEGORIES` (the booking form is generated from it).
* **Jury, schedule, partners, gallery, FAQ, copy** → static markup in `public/index.html`.
* Everything the browser needs lives in `public/`. The server-only modules are `server.js` and
  `lib/store.js`, `lib/stripe.js`, `lib/env.js`.

---

## Sources and content status

Researched from public sources:

* Instagram — <https://www.instagram.com/globalmanualtherapy/> (Global Manual Therapy, the account
  behind the reference site; Instagram serves a login wall to non-logged-in clients, so the profile
  name and G.M.T. branding were the anchors)
* Marca, *“Albania concluye el campeonato de masajes…”*, 25 Apr 2026 —
  <https://www.marca.com/tiramillas/sociedad/2026/04/25/albania-concluye-campeonato-masajes-dando-hablar-deja-tecnica-toca-emociones.html>
* Shkodra Zone, *“Shkodra mirëpret Kampionatin e parë shqiptar të Masazhit”*, 15 Sep 2025 —
  <https://shkodrazone.com/2025/09/15/shkodra-mirepret-kampionatin-e-pare-shqiptar-te-masazhit/>
  (first edition in Shkodra, 70+ participants, organiser Vitjola Petani)
* Veriu Sport — <https://veriusport.al/shkodra-organizatore-e-kampionatin-e-pare-shqiptar-te-masazhit-mbi-70-pjesemarres-nga-shqiperia-dhe-shtete-te-tjera/>

**Placeholders to confirm with the organiser before going live** — no 2027 edition is published yet,
so these are proposals: the venue and capacity, all ticket/entry prices,
add-on prices and promo codes, the category list, programme times, jury names and portraits,
partner logos (rendered as typographic tiles), legal pages (`#` links) and the contact email/phone.

Imagery is licensed stock (Unsplash) used as temporary art direction — replace with real event
photography. Jury portraits are stock photos: do not publish them as real people.

## Browser support

Chromium/Edge/Safari/Firefox current. Uses CSS `:has()` for selected states, native `<details>` for
the FAQ, `IntersectionObserver` for reveals, and self-hosted fonts with `latin` + `latin-ext`
subsets (Albanian `ë`/`ç` render offline). Animations respect `prefers-reduced-motion`.
