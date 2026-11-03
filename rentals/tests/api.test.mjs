// ============================================================================
// api.test.mjs — end-to-end Worker tests against a real SQLite-backed D1.
// No Stripe secret, no AI binding, no R2 in this env ON PURPOSE: the suite
// also proves the graceful unconfigured states (payments off, AI template
// fallback, photo upload 503) that a fresh deployment starts in.
// ============================================================================
import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import { makeD1 } from "./d1-adapter.mjs";

const env = {
  DB: makeD1(),
  PLATFORM_FEE_PCT: "12",
  ADMIN_EMAILS: "lawrencemurry@yahoo.com",
  AI_DAILY_LIMIT: "20",
  // STRIPE_SECRET_KEY, AI, PHOTOS intentionally absent.
};

async function call(path, opts) {
  opts = opts || {};
  const headers = {};
  if (opts.body) headers["Content-Type"] = "application/json";
  if (opts.cookie) headers["Cookie"] = opts.cookie;
  if (opts.headers) Object.assign(headers, opts.headers);
  const res = await worker.fetch(new Request("https://naptivity.test" + path, {
    method: opts.method || "GET", headers,
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  }), env);
  const text = await res.text();
  let j; try { j = JSON.parse(text); } catch { j = { raw: text }; }
  return { status: res.status, json: j, headers: res.headers, text };
}
function cookieFrom(r) {
  const sc = r.headers.get("set-cookie");
  assert.ok(sc, "expected a session cookie");
  return sc.split(";")[0];
}

let van, boat, rv, renterCookie, hostCookie, vanBookingId, boatBookingId;

test("health reports honest unconfigured states", async () => {
  const r = await call("/api/health");
  assert.equal(r.status, 200);
  assert.equal(r.json.storage, "d1");
  assert.equal(r.json.stripe.configured, false);
  assert.equal(r.json.ai, "template-fallback");
  assert.equal(r.json.photos, "unconfigured");
});

test("app shell, manifest and service worker serve", async () => {
  const home = await call("/");
  assert.equal(home.status, 200);
  assert.match(home.text, /Naptivity/);
  assert.match(home.text, /does <strong>not<\/strong> provide insurance/);
  const man = await call("/manifest.webmanifest");
  assert.equal(man.json.short_name, "Naptivity");
  assert.equal(man.json.display, "standalone");
  const sw = await call("/sw.js");
  assert.match(sw.text, /naptivity-shell/);
  const icon = await worker.fetch(new Request("https://naptivity.test/icon-192.png"), env);
  assert.equal(icon.status, 200);
  assert.equal(icon.headers.get("Content-Type"), "image/png");
});

test("seed data: three demo listings, one per mode shape", async () => {
  const r = await call("/api/listings");
  assert.equal(r.status, 200);
  assert.equal(r.json.listings.length, 3);
  van = r.json.listings.find((l) => l.type === "camper_van");
  boat = r.json.listings.find((l) => l.type === "boat");
  rv = r.json.listings.find((l) => l.type === "rv");
  assert.equal(van.rental_mode, "both");
  assert.equal(boat.rental_mode, "stationary_only");
  assert.equal(rv.rental_mode, "movable");
  assert.equal(van.included_miles_per_day, 100);
  assert.equal(van.overage_cents_per_mile, 75);
});

test("search filters by mode and type", async () => {
  const stat = await call("/api/listings?mode=stationary");
  assert.deepEqual(stat.json.listings.map((l) => l.type).sort(), ["boat", "camper_van"]);
  const mov = await call("/api/listings?mode=movable");
  assert.deepEqual(mov.json.listings.map((l) => l.type).sort(), ["camper_van", "rv"]);
  const boats = await call("/api/listings?type=boat");
  assert.equal(boats.json.listings.length, 1);
});

test("auth: register, login, bad password, demo host login", async () => {
  const reg = await call("/api/auth/register", { method: "POST", body: { name: "Test Renter", email: "renter@test.dev", password: "test-pass-123" } });
  assert.equal(reg.status, 201);
  renterCookie = cookieFrom(reg);
  const dup = await call("/api/auth/register", { method: "POST", body: { name: "Dup", email: "renter@test.dev", password: "test-pass-123" } });
  assert.equal(dup.status, 409);
  const bad = await call("/api/auth/login", { method: "POST", body: { email: "renter@test.dev", password: "wrong-password" } });
  assert.equal(bad.status, 401);
  const host = await call("/api/auth/login", { method: "POST", body: { email: "host@demo.naptivity.app", password: "demo-host-2026" } });
  assert.equal(host.status, 200);
  hostCookie = cookieFrom(host);
  const me = await call("/api/auth/me", { cookie: renterCookie });
  assert.equal(me.json.user.email, "renter@test.dev");
});

test("listing creation requires insurance + license attestation", async () => {
  const noAttest = await call("/api/listings", { method: "POST", cookie: renterCookie, body: {
    title: "Test Trailer", type: "travel_trailer", rental_mode: "both", fuel_policy: "return_full",
    nightly_rate_cents: 9000, sleeps: 4, insurance_attested: false, license_attested: true } });
  assert.equal(noAttest.status, 400);
  assert.equal(noAttest.json.code, "ATTESTATION_REQUIRED");
  const ok = await call("/api/listings", { method: "POST", cookie: renterCookie, body: {
    title: "Test Trailer", type: "travel_trailer", rental_mode: "both", fuel_policy: "return_full",
    nightly_rate_cents: 9000, sleeps: 4, included_miles_per_day: 50, overage_cents_per_mile: 50,
    fuel_shortfall_cents_per_gallon: 500, cleaning_fee_cents: 4000, deposit_cents: 30000,
    insurance_attested: true, license_attested: true } });
  assert.equal(ok.status, 201);
});

test("quote endpoint: movable van estimate matches the worked example", async () => {
  const r = await call("/api/quote", { method: "POST", body: {
    listing_id: van.id, mode: "movable", start_date: "2027-06-01", end_date: "2027-06-04", expected_miles: 450 } });
  assert.equal(r.status, 200);
  assert.equal(r.json.estimate.totalCents, 57750);
  assert.equal(r.json.estimate.estOverageMiles, 150);
});

test("booking: movable van booking snapshots the estimate (pending, host approves)", async () => {
  const r = await call("/api/bookings", { method: "POST", cookie: renterCookie, body: {
    listing_id: van.id, mode: "movable", start_date: "2027-06-01", end_date: "2027-06-04", expected_miles: 450, demo_test_card: true } });
  assert.equal(r.status, 201);
  vanBookingId = r.json.booking.id;
  assert.equal(r.json.booking.status, "pending");       // van is not instant-book
  assert.equal(r.json.booking.total_cents, 57750);
  assert.equal(r.json.booking.included_miles_total, 300);
  assert.equal(r.json.booking.expected_miles, 450);
  assert.equal(r.json.payment.configured, false);       // graceful: no Stripe here
});

test("booking: overlapping dates are refused", async () => {
  const r = await call("/api/bookings", { method: "POST", cookie: renterCookie, body: {
    listing_id: van.id, mode: "stationary", start_date: "2027-06-02", end_date: "2027-06-05" } });
  assert.equal(r.status, 409);
  assert.equal(r.json.code, "DATES_UNAVAILABLE");
});

test("booking: stationary-only boat REFUSES a movable booking", async () => {
  const r = await call("/api/bookings", { method: "POST", cookie: renterCookie, body: {
    listing_id: boat.id, mode: "movable", start_date: "2027-07-10", end_date: "2027-07-12", expected_miles: 40 } });
  assert.equal(r.status, 400);
  assert.equal(r.json.code, "MODE_NOT_ALLOWED");
});

test("booking: stationary boat booking has NO mileage anywhere", async () => {
  const r = await call("/api/bookings", { method: "POST", cookie: renterCookie, body: {
    listing_id: boat.id, mode: "stationary", start_date: "2027-07-10", end_date: "2027-07-12", expected_miles: 999 } });
  assert.equal(r.status, 201);
  boatBookingId = r.json.booking.id;
  assert.equal(r.json.booking.status, "confirmed");     // boat is instant-book
  assert.equal(r.json.booking.total_cents, 59000);
  assert.equal(r.json.booking.expected_miles, null);
  assert.equal(r.json.booking.included_miles_total, 0);
  assert.equal(r.json.booking.est_overage_cents, 0);
});

test("booking: hosts cannot book their own listing; anonymous cannot book", async () => {
  const own = await call("/api/bookings", { method: "POST", cookie: hostCookie, body: {
    listing_id: van.id, mode: "stationary", start_date: "2027-09-01", end_date: "2027-09-03" } });
  assert.equal(own.status, 400);
  assert.equal(own.json.code, "CANNOT_BOOK_OWN");
  const anon = await call("/api/bookings", { method: "POST", body: {
    listing_id: van.id, mode: "stationary", start_date: "2027-09-01", end_date: "2027-09-03" } });
  assert.equal(anon.status, 401);
});

test("lifecycle: approve → pickup → return settles with actual miles + fuel", async () => {
  const approve = await call("/api/bookings/" + vanBookingId + "/approve", { method: "POST", cookie: hostCookie, body: {} });
  assert.equal(approve.json.booking.status, "confirmed");
  const pickup = await call("/api/bookings/" + vanBookingId + "/pickup", { method: "POST", cookie: hostCookie, body: { odometer: 50000 } });
  assert.equal(pickup.json.booking.status, "active");
  const ret = await call("/api/bookings/" + vanBookingId + "/return", { method: "POST", cookie: hostCookie, body: { odometer: 50450, fuel_shortfall_gallons: 4 } });
  assert.equal(ret.status, 200);
  assert.equal(ret.json.settlement.actualMiles, 450);
  assert.equal(ret.json.settlement.overageCents, 11250);
  assert.equal(ret.json.settlement.fuelCents, 2400);
  assert.equal(ret.json.settlement.finalTotalCents, 60150);
  assert.equal(ret.json.settlement.deltaCents, 2400);
  assert.equal(ret.json.booking.status, "completed");
  assert.equal(ret.json.booking.settled, 1);
});

test("lifecycle: stationary boat check-in/out completes at the quoted total", async () => {
  const pickup = await call("/api/bookings/" + boatBookingId + "/pickup", { method: "POST", cookie: hostCookie, body: {} });
  assert.equal(pickup.json.booking.status, "active");
  const ret = await call("/api/bookings/" + boatBookingId + "/return", { method: "POST", cookie: hostCookie, body: {} });
  assert.equal(ret.json.booking.status, "completed");
  assert.equal(ret.json.booking.final_total_cents, 59000);
});

test("return odometer below pickup is rejected", async () => {
  const b = await call("/api/bookings", { method: "POST", cookie: renterCookie, body: {
    listing_id: rv.id, mode: "movable", start_date: "2027-08-01", end_date: "2027-08-03", expected_miles: 100 } });
  assert.equal(b.status, 201);
  assert.equal(b.json.booking.status, "confirmed");     // RV is instant-book
  const id = b.json.booking.id;
  await call("/api/bookings/" + id + "/pickup", { method: "POST", cookie: hostCookie, body: { odometer: 80000 } });
  const bad = await call("/api/bookings/" + id + "/return", { method: "POST", cookie: hostCookie, body: { odometer: 79999 } });
  assert.equal(bad.status, 400);
  const good = await call("/api/bookings/" + id + "/return", { method: "POST", cookie: hostCookie, body: { odometer: 80300, fuel_shortfall_gallons: 0 } });
  assert.equal(good.json.settlement.actualMiles, 300);
  assert.equal(good.json.settlement.overageMiles, 50);  // 300 − 2×125 included
  assert.equal(good.json.settlement.overageCents, 3250);
});

test("reviews: two-way after completion, duplicates refused, rating aggregates", async () => {
  const r1 = await call("/api/bookings/" + vanBookingId + "/reviews", { method: "POST", cookie: renterCookie, body: { rating: 5, body: "Great van, honest pricing." } });
  assert.equal(r1.status, 201);
  const dup = await call("/api/bookings/" + vanBookingId + "/reviews", { method: "POST", cookie: renterCookie, body: { rating: 4, body: "again" } });
  assert.equal(dup.status, 409);
  const hostRev = await call("/api/bookings/" + vanBookingId + "/reviews", { method: "POST", cookie: hostCookie, body: { rating: 5, body: "Great renter." } });
  assert.equal(hostRev.status, 201);
  const pub = await call("/api/listings/" + van.id + "/reviews");
  assert.equal(pub.json.reviews.length, 1);
  assert.equal(pub.json.reviews[0].rating, 5);
  const detail = await call("/api/listings/" + van.id);
  assert.equal(detail.json.listing.rating_avg, 5);
  assert.equal(detail.json.listing.rating_count, 1);
});

test("inquiries + AI reply draft (template fallback, labelled)", async () => {
  const inq = await call("/api/inquiries", { method: "POST", cookie: renterCookie, body: { listing_id: van.id, body: "Is the van OK for a dog?" } });
  assert.equal(inq.status, 201);
  const inbox = await call("/api/host/inquiries", { cookie: hostCookie });
  assert.equal(inbox.json.inquiries.length, 1);
  const draft = await call("/api/ai/reply-draft", { method: "POST", cookie: hostCookie, body: { inquiry_id: inbox.json.inquiries[0].id } });
  assert.equal(draft.status, 200);
  assert.equal(draft.json.draft.source, "template");
  assert.ok(draft.json.draft.text.length > 20);
  const reply = await call("/api/inquiries/" + inbox.json.inquiries[0].id + "/reply", { method: "POST", cookie: hostCookie, body: { reply_body: draft.json.draft.text } });
  assert.equal(reply.json.ok, true);
});

test("AI polish uses only listing facts (template fallback) and suggest-price is a labelled heuristic", async () => {
  const p = await call("/api/ai/polish", { method: "POST", cookie: hostCookie, body: { listing_id: van.id } });
  assert.equal(p.status, 200);
  assert.equal(p.json.polished.source, "template");
  assert.match(p.json.polished.text, /Bend, Oregon/);
  const s = await call("/api/ai/suggest-price", { method: "POST", cookie: hostCookie, body: { type: "camper_van", rental_mode: "both", sleeps: 2 } });
  assert.equal(s.json.suggestion.midCents, 12600);
  assert.equal(s.json.suggestion.isEstimate, true);
});

test("host earnings + Connect degrade honestly without Stripe", async () => {
  const e = await call("/api/host/earnings", { cookie: hostCookie });
  assert.equal(e.status, 200);
  assert.ok(e.json.payout_cents > 0);
  assert.equal(e.json.stripe.configured, false);
  const c = await call("/api/host/connect", { method: "POST", cookie: hostCookie, body: {} });
  assert.equal(c.json.configured, false);
  assert.match(c.json.message, /not configured/);
});

test("photo upload without R2 returns a clear 503", async () => {
  const res = await worker.fetch(new Request("https://naptivity.test/api/listings/" + van.id + "/photos", {
    method: "POST", headers: { "Content-Type": "image/png", "Cookie": hostCookie }, body: new Uint8Array([137, 80, 78, 71]),
  }), env);
  assert.equal(res.status, 503);
  const j = await res.json();
  assert.equal(j.code, "PHOTOS_NOT_CONFIGURED");
});

test("renter trips view shows settled final total", async () => {
  const trips = await call("/api/bookings/mine", { cookie: renterCookie });
  const vanTrip = trips.json.bookings.find((b) => b.id === vanBookingId);
  assert.equal(vanTrip.final_total_cents, 60150);
  assert.equal(vanTrip.my_review_done, true);
});
