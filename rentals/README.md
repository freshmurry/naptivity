# Naptivity Rentals — RV, Camper, Boat & Yacht Rental Marketplace

A mobile-first, installable PWA built as a single Cloudflare Worker with D1,
R2, Workers AI, and Stripe (test mode). Rebuilt from scratch on the
`rebuild/rentals-marketplace` branch of `freshmurry/naptivity` — the 2016
Rails dorm-rental code on `master` is untouched history.

**The idea:** people building camper vans, bus conversions, and owning RVs,
boats, and yachts rent them out as a side hustle; renters get the adventure
without buying the vehicle.

## The core innovation: two rental modes, priced honestly

Every listing is **stationary_only**, **movable**, or **both** (the renter
chooses per booking when both):

- **Stationary ("stand-still")** — the unit stays put (delivered to a site,
  or already on land / at a dock). Flat predictable pricing:
  `nights × nightly + delivery/setup fee + site fee/night + cleaning`.
  No mileage exists in this mode, ever.
- **Movable** — the renter takes it out:
  `nights × nightly + cleaning`, with `included miles/day` in the price and
  a per-mile overage rate beyond that. Fuel follows the listing's policy
  (`return_full` or `per_gallon`). The booking total is an **estimate** from
  the renter's expected miles; at return, odometer readings settle the final
  bill exactly, and the renter sees the delta before booking.

A stationary-only listing cannot be booked as movable — enforced in the
pricing engine and covered by tests.

## What's inside

- Search/filter by type, rental style, location text, and dates (listings
  with conflicting bookings drop out).
- Host dashboard: listings CRUD (with insurance/licensing attestation),
  bookings inbox, pickup/return settlement, earnings, Stripe Connect
  onboarding.
- Renter trips view, two-way reviews after completed trips, inquiries.
- AI touches (rate-limited, labelled): description polish that may only use
  the host's real facts, a transparent price-suggestion heuristic, and
  inquiry reply drafts. Template fallbacks run when Workers AI is absent.
- Payments: Stripe Checkout for the renter, Connect destination transfers
  with a configurable platform fee (`PLATFORM_FEE_PCT`, default 12%, taken
  from the host payout — never added to the renter's total), and a
  manual-capture PaymentIntent as the security-deposit hold. **Test mode.**
  With no `STRIPE_SECRET_KEY` set, the app runs in an honest
  "payments not configured" demo mode.
- Honest copy: Naptivity provides **no** insurance, licensing, or roadside
  assistance. Hosts attest their own coverage/permits; renters are told to
  verify theirs. This is stated in the UI, the listing form, and bookings.

## Demo data (seeded on first run, only when the DB is empty)

| Listing | Type | Mode | Why it's there |
|---|---|---|---|
| Wanderer — Sprinter Camper Van | camper_van | both | demos both pricing modes |
| Sunseeker — 30 ft Class C RV | rv | movable | mileage + fuel settlement |
| Harbor Lights — 34 ft Cabin Cruiser | boat | stationary_only | at the dock; movable booking is refused |

Demo accounts (delete before any real use):
`host@demo.naptivity.app` / `demo-host-2026` ·
`renter@demo.naptivity.app` / `demo-renter-2026`

## Run it

```bash
npm test                 # 32 tests: pricing engine + full API integration
npm run dev              # wrangler dev (local D1)
```

## Deploy to production (Lawrence's Cloudflare account)

```bash
wrangler d1 create naptivity-db            # paste the ID into wrangler.toml
wrangler r2 bucket create naptivity-photos
wrangler secret put STRIPE_SECRET_KEY      # test-mode key (sk_test_...)
wrangler secret put STRIPE_WEBHOOK_SECRET  # optional, for webhook confirmations
wrangler deploy
```

See BUILD-LOG.md for architecture, test evidence, and known gaps.
