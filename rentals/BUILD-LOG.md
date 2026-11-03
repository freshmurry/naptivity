# BUILD LOG — Naptivity Rentals Marketplace

**Date:** 2026-11-03 · **Branch:** `rebuild/rentals-marketplace` (from `master` @ 17d19bb; `master` untouched)
**Scope:** Ground-up transform of Naptivity into an RV / camper van / bus conversion / travel trailer / boat / yacht / houseboat rental marketplace. The 2016 Rails code contributes the name only (~0% reuse, per the 2026-11-02 assessment).

## Architecture

Single Cloudflare Worker (ES modules, heading-commented sections), no framework:

| File | Role |
|---|---|
| `src/index.js` | Router + all API handlers (auth, listings, quote, bookings lifecycle, reviews, inquiries, host, AI, webhook, photos) |
| `src/pricing.js` | **Pure pricing engine** — the only place prices are computed. Quote (both modes), settlement, mode enforcement, price-suggestion heuristic |
| `src/auth.js` | PBKDF2-SHA256 (100k iters) passwords; D1 sessions storing only the SHA-256 hash of the token; 14-day cookie |
| `src/db.js` | D1 helpers, self-creating schema (mirrors `migrations/0001_init.sql`), demo seed (only into an empty DB) |
| `src/stripe.js` | Stripe REST client: Checkout, Connect Express + account links, manual-capture deposit holds, webhook HMAC verification. Key never logged/returned; only its mode prefix is read |
| `src/ai.js` | Workers AI (`@cf/meta/llama-3.1-8b-instruct`) polish + reply drafts with deterministic template fallbacks, source-labelled |
| `src/ui.js` | Mobile-first SPA (vanilla JS, addEventListener only, bottom tab bar) |
| `src/pwa.js` | Web app manifest + service worker (shell cache-first, API network-only) |
| `src/icons.js` | Generated PNG icons (192/512, `scripts/gen-icons.mjs`) |

Bindings: D1 (`DB`), R2 (`PHOTOS`, photo uploads; URL photos also supported), Workers AI (`AI`). Vars: `PLATFORM_FEE_PCT` (default 12), `AI_DAILY_LIMIT` (default 20/user/day).

## Domain rules implemented

- **Modes:** listing `rental_mode` ∈ {stationary_only, movable, both}; booking mode chosen per booking when both. Mode violations raise `MODE_NOT_ALLOWED` in the engine, the quote endpoint, and booking creation.
- **Stationary pricing:** nights × nightly + delivery (once) + site fee × nights + cleaning. The quote object carries **zero** mileage fields; an expected-miles input is ignored and flagged (`mileageIgnored`), never charged.
- **Movable pricing:** nights × nightly + cleaning + overage ((expected − nights × included/day)⁺ × per-mile). Fuel is **never** estimated — settled at return from the recorded shortfall under the listing policy. Unit rates are snapshotted into the booking (`estimate_json.unitRates`) so a mid-trip listing edit cannot change a settlement.
- **Settlement:** actual miles = return − pickup odometer (return < pickup rejected). delta = final − estimate is returned openly (negative = renter credit).
- **Availability:** overlapping bookings in pending/confirmed/active block dates, in both booking creation (409) and date-filtered search.
- **Payments:** renter pays via Stripe Checkout; platform fee is a Connect application fee with destination transfer **only when the host finished Connect onboarding** — otherwise the charge is platform-only and the payout stands as a recorded balance (the booking/UI say so). Deposit = manual-capture PaymentIntent hold when a payment method is supplied (`pm_card_visa` in the demo flow). Everything degrades to labelled demo mode with no key configured.
- **Reviews:** two-way, only after `completed`, one per direction per booking (DB unique constraint).
- **Honest copy:** hosts must attest insurance + licensing to publish; the platform's non-role (no insurance/licensing/roadside) is stated in the footer, listing form, and booking panel.

## Verification evidence

**Automated tests — 32 passed / 0 failed** (`npm test`):
- `tests/pricing.test.mjs` (11): worked numbers — 3 nights / 450 mi / 100 incl. per day → 150 overage mi, $577.50 total; stationary van $625.00 with zero mileage; boat $590.00; mode refusals both directions; settlement +$24.00 delta (fuel) and −$76.50 credit case; stationary settlement refusal; heuristic suggestion.
- `tests/api.test.mjs` (21): full Worker integration against a real SQLite-backed D1 adapter (`tests/d1-adapter.mjs`, node:sqlite) — seed, search filters, auth, attestation gate, quote endpoint, booking snapshot, overlap 409, **boat movable refusal (400 MODE_NOT_ALLOWED)**, stationary booking with `expected_miles: null`, own-listing/anonymous guards, approve→pickup→return settlement over HTTP ($601.50 final, delta $24.00), stationary check-in/out, bad-odometer rejection, reviews + rating aggregate, inquiry + AI draft (template source), polish (template source, facts-only), earnings, Connect/photo graceful 503s, trips view.

**Live smoke — served app under `wrangler dev --local` (real workerd + local D1), all checks passed:** health (storage d1), 3 seeded listings, registration, quote math ($577.50 / 150 over mi / 300 included), van movable booking created with matching snapshot, **boat movable booking refused (400 MODE_NOT_ALLOWED)**, boat stationary booking $590.00 with zero mileage fields, app shell + manifest serving.

**Bug found and fixed during the build:** route handlers were dispatched with `return handler(...)` inside the router's try block, so async rejections bypassed the catch and escaped as unhandled errors instead of JSON responses. All 16 dispatches are now `return await handler(...)`; the failing-then-passing tests above are the regression evidence.

## Deployment state

- **Public preview deploy: BLOCKED, attempted twice.** `wrangler deploy --temporary` fails because (a) the committed config's D1 ID is an intentional fails-closed placeholder, and (b) this environment's shared temporary Cloudflare account allows only **one** D1 database, currently held by a parallel build's database (`vibecodeforstartup-agg`, created 2026-11-03 06:55 UTC) — deleting another workstream's resource was not an option. The app was instead verified served under workerd locally (above).
- **Production deploy (Lawrence's account), ~5 minutes:**
  1. `wrangler d1 create naptivity-db` → paste the real ID into `rentals/wrangler.toml`
  2. `wrangler r2 bucket create naptivity-photos`
  3. `wrangler secret put STRIPE_SECRET_KEY` (test key) and optionally `STRIPE_WEBHOOK_SECRET`; register the webhook endpoint (`/api/stripe/webhook`, `checkout.session.completed`) in the Stripe dashboard
  4. `cd rentals && wrangler deploy`
- `wrangler.preview.toml` (no R2 binding) exists for credential-less preview environments once a D1 slot is available.

## Stripe state (names only)

`STRIPE_SECRET_KEY` — not set in this environment; app verified in unconfigured demo mode. `STRIPE_WEBHOOK_SECRET` — optional, unset. Code paths for Checkout/Connect/holds/webhook are implemented and unit-exercised only up to the unconfigured boundary; **live test-mode calls were not made** (no key available here) — first production step is a test-mode booking with the demo card to verify session creation end to end.

## Known gaps (honest)

1. **Deposit holds need Stripe.js Elements** in production to collect a real card for the manual-capture hold; today a hold is created only when a payment-method ID is supplied (demo uses `pm_card_visa`).
2. **Settlement deltas are computed and recorded, not auto-charged/refunded.** Charging the renter's card for a positive delta (or refunding a credit) needs an off-session payment flow + renter consent language; the amounts and audit trail are in place.
3. **Stripe flows unverified against the live Stripe API** (see above) — the encoder and payloads follow the documented form API, but no real session has been created yet.
4. **Demo seed accounts** (`host@`/`renter@demo.naptivity.app`, passwords in README) exist so the demo is clickable; delete them before real use. Seeding only happens into an empty listings table.
5. **Photos:** R2 upload works when bound; seeded listings intentionally ship without photos (the UI renders a type placeholder) rather than hotlinking stock imagery.
6. No email/push notifications, no messaging threads beyond listing inquiries, no admin console beyond the first-user/ADMIN_EMAILS admin flag, no i18n. Search is text + filters over D1 rows (fine at demo scale; a search index is future work).
7. Workers AI polish was verified through its template fallback in this environment (no AI binding under `wrangler dev --local`); the Workers AI call path is the same shape used by the CRO agent build and falls back safely on any error.
