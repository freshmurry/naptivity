// ============================================================================
// index.js — Naptivity Rentals Worker (router + API)
// ============================================================================
// Sections: helpers → static/PWA → auth → listings/search → quote/bookings
// lifecycle → reviews/inquiries → host (earnings/Connect) → AI → webhook.
// Money is integer cents everywhere; the pricing engine (pricing.js) is the
// single source of pricing truth — routes never recompute prices by hand.
// ============================================================================
import { dbAll, dbFirst, dbRun, ensureSchema, newId, nowISO, todayISO } from "./db.js";
import { hashPassword, verifyPassword, createSession, destroySession, currentUser, isAdminUser } from "./auth.js";
import { quote, settle, suggestPrice, PricingError, LISTING_TYPES, LISTING_MODES, FUEL_POLICIES } from "./pricing.js";
import { stripeState, createCheckoutSession, createDepositHold, createConnectAccount, createAccountLink, verifyWebhook } from "./stripe.js";
import { polishDescription, draftInquiryReply, safeJson } from "./ai.js";
import { renderAppHtml } from "./ui.js";
import { MANIFEST, SERVICE_WORKER } from "./pwa.js";
import { ICON_192_B64, ICON_512_B64 } from "./icons.js";

// ---------------------------------------------------------------------------
// SECTION: HELPERS
// ---------------------------------------------------------------------------
function json(data, status, headers) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: Object.assign({ "Content-Type": "application/json" }, headers || {}),
  });
}
function err(message, status, code) {
  return json({ error: message, code: code || "ERROR" }, status || 400);
}
async function bodyJson(request) {
  try { return await request.json(); } catch { return {}; }
}
function feePct(env) {
  const n = Number((env && env.PLATFORM_FEE_PCT) || 12);
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : 12;
}
function listingOut(row) {
  if (!row) return null;
  return {
    id: row.id, host_id: row.host_id, host_name: row.host_name || null,
    type: row.type, title: row.title, description: row.description,
    location_text: row.location_text, sleeps: row.sleeps,
    amenities: safeJson(row.amenities_json, []), photos: safeJson(row.photos_json, []),
    rental_mode: row.rental_mode, nightly_rate_cents: row.nightly_rate_cents,
    delivery_fee_cents: row.delivery_fee_cents, site_fee_cents: row.site_fee_cents,
    included_miles_per_day: row.included_miles_per_day, overage_cents_per_mile: row.overage_cents_per_mile,
    fuel_policy: row.fuel_policy, fuel_shortfall_cents_per_gallon: row.fuel_shortfall_cents_per_gallon,
    cleaning_fee_cents: row.cleaning_fee_cents, deposit_cents: row.deposit_cents,
    instant_book: row.instant_book === 1, insurance_attested: row.insurance_attested === 1,
    license_attested: row.license_attested === 1, status: row.status, created_at: row.created_at,
    rating_avg: row.rating_avg != null ? Math.round(row.rating_avg * 10) / 10 : null,
    rating_count: row.rating_count || 0,
  };
}
function bookingOut(row) {
  if (!row) return null;
  const out = Object.assign({}, row);
  out.estimate = safeJson(row.estimate_json, {});
  delete out.estimate_json;
  return out;
}
async function requireUser(env, request) {
  const user = await currentUser(env, request);
  if (!user) throw { httpStatus: 401, message: "Log in required", code: "AUTH_REQUIRED" };
  return user;
}
async function getListing(env, id) {
  return dbFirst(env,
    `SELECT l.*, u.name AS host_name,
       (SELECT AVG(rating) FROM reviews r WHERE r.listing_id = l.id AND r.direction = 'renter_to_host') AS rating_avg,
       (SELECT COUNT(*) FROM reviews r WHERE r.listing_id = l.id AND r.direction = 'renter_to_host') AS rating_count
     FROM listings l JOIN users u ON u.id = l.host_id WHERE l.id = ?`, id);
}
const ACTIVE_BOOKING_STATES = "('pending','confirmed','active')";
async function datesTaken(env, listingId, start, end) {
  const row = await dbFirst(env,
    `SELECT id FROM bookings WHERE listing_id = ? AND status IN ${ACTIVE_BOOKING_STATES} AND start_date < ? AND end_date > ? LIMIT 1`,
    listingId, end, start);
  return !!row;
}

// ---------------------------------------------------------------------------
// SECTION: STATIC + PWA + PHOTOS
// ---------------------------------------------------------------------------
function b64Bytes(b64) { return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)); }

async function handlePhotos(env, request, key, listingId) {
  if (request.method === "GET") {
    if (!env.PHOTOS) return err("Photo storage is not configured on this deployment", 503, "PHOTOS_NOT_CONFIGURED");
    const obj = await env.PHOTOS.get(key);
    if (!obj) return err("Photo not found", 404, "NOT_FOUND");
    return new Response(obj.body, { headers: { "Content-Type": (obj.httpMetadata && obj.httpMetadata.contentType) || "image/jpeg", "Cache-Control": "public, max-age=86400" } });
  }
  if (request.method === "POST") {
    const user = await requireUser(env, request);
    const listing = await getListing(env, listingId);
    if (!listing) return err("Listing not found", 404, "NOT_FOUND");
    if (listing.host_id !== user.id && !isAdminUser(env, user)) return err("Only the host can add photos", 403, "FORBIDDEN");
    if (!env.PHOTOS) return err("Photo storage (R2) is not configured on this deployment; use a photo URL instead", 503, "PHOTOS_NOT_CONFIGURED");
    const type = request.headers.get("Content-Type") || "image/jpeg";
    if (!type.startsWith("image/")) return err("Upload must be an image", 400, "VALIDATION");
    const buf = await request.arrayBuffer();
    if (buf.byteLength > 8 * 1024 * 1024) return err("Image too large (8 MB max)", 400, "VALIDATION");
    const ext = type.includes("png") ? "png" : type.includes("webp") ? "webp" : "jpg";
    const photoKey = "listings/" + listingId + "/" + newId() + "." + ext;
    await env.PHOTOS.put(photoKey, buf, { httpMetadata: { contentType: type } });
    const photos = safeJson(listing.photos_json, []);
    photos.push("/photos/" + photoKey);
    await dbRun(env, "UPDATE listings SET photos_json = ? WHERE id = ?", JSON.stringify(photos), listingId);
    return json({ ok: true, photo: "/photos/" + photoKey, photos });
  }
  return err("Method not allowed", 405, "METHOD");
}

// ---------------------------------------------------------------------------
// SECTION: AUTH ROUTES
// ---------------------------------------------------------------------------
async function handleAuth(env, request, action) {
  if (action === "me") {
    const user = await currentUser(env, request);
    return json({ user: user ? { id: user.id, email: user.email, name: user.name, is_admin: user.is_admin === 1, stripe_account_id: user.stripe_account_id || null } : null });
  }
  if (action === "logout") {
    await destroySession(env, request);
    return json({ ok: true }, 200, { "Set-Cookie": "naptivity_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0" });
  }
  const body = await bodyJson(request);
  const email = String(body.email || "").trim().toLowerCase();
  const password = String(body.password || "");
  if (action === "register") {
    const name = String(body.name || "").trim();
    if (!name || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return err("A name and a valid email are required", 400, "VALIDATION");
    if (password.length < 8) return err("Password must be at least 8 characters", 400, "VALIDATION");
    const existing = await dbFirst(env, "SELECT id FROM users WHERE email = ?", email);
    if (existing) return err("That email is already registered — log in instead", 409, "EMAIL_TAKEN");
    const count = await dbFirst(env, "SELECT COUNT(*) AS n FROM users");
    const id = newId();
    await dbRun(env, "INSERT INTO users (id, email, name, password_hash, is_admin, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      id, email, name, await hashPassword(password), count && count.n === 0 ? 1 : 0, nowISO());
    const cookie = await createSession(env, request, id);
    return json({ user: { id, email, name } }, 201, { "Set-Cookie": cookie });
  }
  if (action === "login") {
    const user = await dbFirst(env, "SELECT * FROM users WHERE email = ?", email);
    if (!user || !(await verifyPassword(password, user.password_hash))) return err("Email or password is wrong", 401, "BAD_CREDENTIALS");
    const cookie = await createSession(env, request, user.id);
    return json({ user: { id: user.id, email: user.email, name: user.name } }, 200, { "Set-Cookie": cookie });
  }
  return err("Unknown auth action", 404, "NOT_FOUND");
}

// ---------------------------------------------------------------------------
// SECTION: LISTING ROUTES — search, detail, create, update
// ---------------------------------------------------------------------------
async function handleListings(env, request, url) {
  const q = (url.searchParams.get("q") || "").trim().toLowerCase();
  const type = url.searchParams.get("type") || "";
  const mode = url.searchParams.get("mode") || "";
  const start = url.searchParams.get("start") || "";
  const end = url.searchParams.get("end") || "";
  let rows = await dbAll(env,
    `SELECT l.*, u.name AS host_name,
       (SELECT AVG(rating) FROM reviews r WHERE r.listing_id = l.id AND r.direction = 'renter_to_host') AS rating_avg,
       (SELECT COUNT(*) FROM reviews r WHERE r.listing_id = l.id AND r.direction = 'renter_to_host') AS rating_count
     FROM listings l JOIN users u ON u.id = l.host_id WHERE l.status = 'active' ORDER BY l.created_at DESC`);
  rows = rows.filter((l) =>
    (!q || (l.title + " " + l.location_text + " " + l.description).toLowerCase().includes(q)) &&
    (!type || l.type === type) &&
    (!mode || (mode === "stationary" ? l.rental_mode !== "movable" : l.rental_mode !== "stationary_only")));
  if (start && end) {
    const taken = await dbAll(env,
      `SELECT DISTINCT listing_id FROM bookings WHERE status IN ${ACTIVE_BOOKING_STATES} AND start_date < ? AND end_date > ?`, end, start);
    const takenSet = new Set(taken.map((r) => r.listing_id));
    rows = rows.filter((l) => !takenSet.has(l.id));
  }
  return json({ listings: rows.map(listingOut) });
}

function validateListingInput(body, partial) {
  const out = {};
  const has = (k) => body[k] !== undefined;
  if (!partial || has("title")) { out.title = String(body.title || "").trim(); if (!out.title) throw new PricingError("VALIDATION", "Title is required"); }
  if (!partial || has("type")) { if (!LISTING_TYPES.includes(body.type)) throw new PricingError("VALIDATION", "Type must be one of: " + LISTING_TYPES.join(", ")); out.type = body.type; }
  if (!partial || has("rental_mode")) { if (!LISTING_MODES.includes(body.rental_mode)) throw new PricingError("VALIDATION", "rental_mode must be one of: " + LISTING_MODES.join(", ")); out.rental_mode = body.rental_mode; }
  if (!partial || has("fuel_policy")) { if (!FUEL_POLICIES.includes(body.fuel_policy)) throw new PricingError("VALIDATION", "fuel_policy must be one of: " + FUEL_POLICIES.join(", ")); out.fuel_policy = body.fuel_policy; }
  const centsFields = ["nightly_rate_cents", "delivery_fee_cents", "site_fee_cents", "overage_cents_per_mile", "fuel_shortfall_cents_per_gallon", "cleaning_fee_cents", "deposit_cents"];
  for (const f of centsFields) {
    if (!partial || has(f)) {
      const v = body[f] === undefined && !partial ? 0 : Number(body[f]);
      if (!Number.isInteger(v) || v < 0) throw new PricingError("VALIDATION", f + " must be a non-negative integer (cents)");
      out[f] = v;
    }
  }
  if (!partial || has("nightly_rate_cents")) { if (!(out.nightly_rate_cents > 0)) throw new PricingError("VALIDATION", "nightly_rate_cents must be greater than zero"); }
  if (!partial || has("included_miles_per_day")) { const v = body.included_miles_per_day === undefined && !partial ? 0 : Number(body.included_miles_per_day); if (!Number.isInteger(v) || v < 0) throw new PricingError("VALIDATION", "included_miles_per_day must be a non-negative integer"); out.included_miles_per_day = v; }
  if (!partial || has("sleeps")) { const v = body.sleeps === undefined && !partial ? 2 : Number(body.sleeps); if (!Number.isInteger(v) || v < 1 || v > 40) throw new PricingError("VALIDATION", "sleeps must be 1–40"); out.sleeps = v; }
  if (has("description")) out.description = String(body.description || "");
  if (has("location_text")) out.location_text = String(body.location_text || "");
  if (has("amenities")) out.amenities_json = JSON.stringify(Array.isArray(body.amenities) ? body.amenities.map(String).slice(0, 30) : []);
  if (has("photos")) out.photos_json = JSON.stringify(Array.isArray(body.photos) ? body.photos.map(String).slice(0, 12) : []);
  if (has("instant_book")) out.instant_book = body.instant_book ? 1 : 0;
  if (has("insurance_attested")) out.insurance_attested = body.insurance_attested ? 1 : 0;
  if (has("license_attested")) out.license_attested = body.license_attested ? 1 : 0;
  return out;
}

async function handleCreateListing(env, request) {
  const user = await requireUser(env, request);
  const body = await bodyJson(request);
  const v = validateListingInput(body, false);
  if (!v.insurance_attested || !v.license_attested) {
    return err("Hosts must attest that their insurance allows renting this unit and that they hold any required licenses/permits. Naptivity provides neither.", 400, "ATTESTATION_REQUIRED");
  }
  const id = newId();
  await dbRun(env,
    `INSERT INTO listings (id, host_id, type, title, description, location_text, sleeps, amenities_json, photos_json,
       rental_mode, nightly_rate_cents, delivery_fee_cents, site_fee_cents, included_miles_per_day,
       overage_cents_per_mile, fuel_policy, fuel_shortfall_cents_per_gallon, cleaning_fee_cents, deposit_cents,
       instant_book, insurance_attested, license_attested, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)`,
    id, user.id, v.type, v.title, v.description || "", v.location_text || "", v.sleeps || 2,
    v.amenities_json || "[]", v.photos_json || "[]", v.rental_mode, v.nightly_rate_cents,
    v.delivery_fee_cents || 0, v.site_fee_cents || 0, v.included_miles_per_day || 0,
    v.overage_cents_per_mile || 0, v.fuel_policy, v.fuel_shortfall_cents_per_gallon || 0,
    v.cleaning_fee_cents || 0, v.deposit_cents || 0, v.instant_book || 0,
    v.insurance_attested, v.license_attested, nowISO());
  return json({ listing: listingOut(await getListing(env, id)) }, 201);
}

async function handleUpdateListing(env, request, id) {
  const user = await requireUser(env, request);
  const listing = await getListing(env, id);
  if (!listing) return err("Listing not found", 404, "NOT_FOUND");
  if (listing.host_id !== user.id && !isAdminUser(env, user)) return err("Only the host can edit this listing", 403, "FORBIDDEN");
  const body = await bodyJson(request);
  const v = validateListingInput(body, true);
  const keys = Object.keys(v);
  if (!keys.length) return err("Nothing to update", 400, "VALIDATION");
  await dbRun(env, "UPDATE listings SET " + keys.map((k) => k + " = ?").join(", ") + " WHERE id = ?", ...keys.map((k) => v[k]), id);
  return json({ listing: listingOut(await getListing(env, id)) });
}

// ---------------------------------------------------------------------------
// SECTION: QUOTE — public; the pricing engine is the only math allowed.
// ---------------------------------------------------------------------------
async function handleQuote(env, request) {
  const body = await bodyJson(request);
  const listing = await getListing(env, String(body.listing_id || ""));
  if (!listing || listing.status !== "active") return err("Listing not found", 404, "NOT_FOUND");
  const est = quote(listing, {
    mode: body.mode,
    startDate: body.start_date,
    endDate: body.end_date,
    expectedMiles: body.expected_miles,
  }, feePct(env));
  return json({ estimate: est });
}

// ---------------------------------------------------------------------------
// SECTION: BOOKINGS — create (mode-enforced, availability-checked), host
// approval, pickup/return with odometer settlement, cancel.
// ---------------------------------------------------------------------------
async function attemptPayment(env, request, booking, listing) {
  const origin = new URL(request.url).origin;
  const result = { configured: stripeState(env).configured, url: null, deposit_hold: { status: booking.deposit_hold_status } };
  if (!result.configured) return result;
  try {
    const session = await createCheckoutSession(env, { booking, listing, origin });
    if (session.configured) {
      result.url = session.url;
      await dbRun(env, "UPDATE bookings SET stripe_checkout_session_id = ?, stripe_payment_intent_id = ? WHERE id = ?",
        session.sessionId, session.paymentIntentId, booking.id);
    }
  } catch (e) {
    result.error = String(e.message || e).slice(0, 200);
  }
  return result;
}

async function handleCreateBooking(env, request) {
  const user = await requireUser(env, request);
  const body = await bodyJson(request);
  const listing = await getListing(env, String(body.listing_id || ""));
  if (!listing || listing.status !== "active") return err("Listing not found", 404, "NOT_FOUND");
  if (listing.host_id === user.id) return err("You cannot book your own listing", 400, "CANNOT_BOOK_OWN");
  const est = quote(listing, {
    mode: body.mode,
    startDate: body.start_date,
    endDate: body.end_date,
    expectedMiles: body.expected_miles,
  }, feePct(env));
  // Freeze the unit rates into the snapshot: settlement at return must use
  // booking-time rates even if the host edits the listing mid-trip.
  est.unitRates = {
    nightly: listing.nightly_rate_cents, cleaning: listing.cleaning_fee_cents,
    includedPerDay: listing.included_miles_per_day, overagePerMile: listing.overage_cents_per_mile,
    fuelPerGallon: listing.fuel_shortfall_cents_per_gallon,
  };
  if (await datesTaken(env, listing.id, body.start_date, body.end_date)) {
    return err("Those dates are already booked for this unit", 409, "DATES_UNAVAILABLE");
  }
  const host = await dbFirst(env, "SELECT stripe_account_id FROM users WHERE id = ?", listing.host_id);
  const id = newId();
  const status = listing.instant_book === 1 ? "confirmed" : "pending";
  await dbRun(env,
    `INSERT INTO bookings (id, listing_id, renter_id, host_id, mode, start_date, end_date, nights, expected_miles,
       status, base_cents, delivery_cents, site_cents, cleaning_cents, included_miles_total, est_overage_miles,
       est_overage_cents, total_cents, deposit_cents, platform_fee_cents, host_payout_cents, estimate_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    id, listing.id, user.id, listing.host_id, est.mode, body.start_date, body.end_date, est.nights,
    est.mode === "movable" ? (body.expected_miles == null ? 0 : Number(body.expected_miles)) : null,
    status, est.baseCents, est.deliveryCents, est.siteCents, est.cleaningCents, est.includedMilesTotal,
    est.estOverageMiles, est.estOverageCents, est.totalCents, est.depositCents, est.platformFeeCents,
    est.hostPayoutCents, JSON.stringify(est), nowISO());

  const booking = await dbFirst(env, "SELECT * FROM bookings WHERE id = ?", id);
  booking.host_stripe_account_id = host ? host.stripe_account_id : null;
  let payment = { configured: stripeState(env).configured, url: null, deposit_hold: { status: "not_created" } };
  if (status === "confirmed") {
    payment = await attemptPayment(env, request, booking, listing);
    // Deposit hold: only with a supplied payment method (test card in demo).
    const pm = body.demo_test_card ? "pm_card_visa" : body.payment_method_id;
    if (pm) {
      const hold = await createDepositHold(env, { booking, paymentMethodId: pm });
      payment.deposit_hold = hold;
      await dbRun(env, "UPDATE bookings SET deposit_hold_status = ? WHERE id = ?", hold.status, id);
    }
  }
  const fresh = await dbFirst(env, "SELECT * FROM bookings WHERE id = ?", id);
  return json({ booking: bookingOut(fresh), estimate: est, payment }, 201);
}

async function loadBookingFor(env, request, id, role) {
  const user = await requireUser(env, request);
  const booking = await dbFirst(env, "SELECT * FROM bookings WHERE id = ?", id);
  if (!booking) throw { httpStatus: 404, message: "Booking not found", code: "NOT_FOUND" };
  if (role === "host" && booking.host_id !== user.id && !isAdminUser(env, user)) throw { httpStatus: 403, message: "Only the host can do that", code: "FORBIDDEN" };
  if (role === "renter" && booking.renter_id !== user.id && !isAdminUser(env, user)) throw { httpStatus: 403, message: "Only the renter can do that", code: "FORBIDDEN" };
  if (role === "party" && booking.host_id !== user.id && booking.renter_id !== user.id && !isAdminUser(env, user)) throw { httpStatus: 403, message: "Not your booking", code: "FORBIDDEN" };
  return { user, booking };
}

async function handleBookingAction(env, request, id, action) {
  const body = await bodyJson(request);
  if (action === "approve" || action === "decline") {
    const { booking } = await loadBookingFor(env, request, id, "host");
    if (booking.status !== "pending") return err("Booking is not pending", 409, "BAD_STATE");
    const next = action === "approve" ? "confirmed" : "declined";
    await dbRun(env, "UPDATE bookings SET status = ? WHERE id = ?", next, id);
    let payment = null;
    if (next === "confirmed") {
      const listing = await getListing(env, booking.listing_id);
      const host = await dbFirst(env, "SELECT stripe_account_id FROM users WHERE id = ?", booking.host_id);
      booking.host_stripe_account_id = host ? host.stripe_account_id : null;
      payment = await attemptPayment(env, request, booking, listing);
    }
    return json({ booking: bookingOut(await dbFirst(env, "SELECT * FROM bookings WHERE id = ?", id)), payment });
  }
  if (action === "cancel") {
    const { booking } = await loadBookingFor(env, request, id, "party");
    if (!["pending", "confirmed"].includes(booking.status)) return err("This booking can no longer be cancelled", 409, "BAD_STATE");
    await dbRun(env, "UPDATE bookings SET status = 'cancelled' WHERE id = ?", id);
    return json({ booking: bookingOut(await dbFirst(env, "SELECT * FROM bookings WHERE id = ?", id)) });
  }
  if (action === "pickup") {
    const { booking } = await loadBookingFor(env, request, id, "host");
    if (booking.status !== "confirmed") return err("Booking is not confirmed", 409, "BAD_STATE");
    let odometer = null;
    if (booking.mode === "movable") {
      odometer = Number(body.odometer);
      if (!Number.isInteger(odometer) || odometer < 0) return err("A pickup odometer reading is required for road-trip rentals", 400, "VALIDATION");
    }
    await dbRun(env, "UPDATE bookings SET status = 'active', pickup_odometer = ? WHERE id = ?", odometer, id);
    return json({ booking: bookingOut(await dbFirst(env, "SELECT * FROM bookings WHERE id = ?", id)) });
  }
  if (action === "return") {
    const { booking } = await loadBookingFor(env, request, id, "host");
    if (booking.status !== "active") return err("Booking is not active", 409, "BAD_STATE");
    const listing = await getListing(env, booking.listing_id);
    if (booking.mode === "stationary") {
      await dbRun(env,
        "UPDATE bookings SET status = 'completed', settled = 1, final_total_cents = ?, fuel_cents = 0 WHERE id = ?",
        booking.total_cents, id);
      return json({ booking: bookingOut(await dbFirst(env, "SELECT * FROM bookings WHERE id = ?", id)) });
    }
    const returnOdo = Number(body.odometer);
    if (!Number.isInteger(returnOdo) || returnOdo < booking.pickup_odometer) {
      return err("Return odometer must be a number at or above the pickup reading (" + booking.pickup_odometer + ")", 400, "VALIDATION");
    }
    const actualMiles = returnOdo - booking.pickup_odometer;
    const est = safeJson(booking.estimate_json, {});
    const snap = est.unitRates;
    const settleListing = snap ? {
      nightly_rate_cents: snap.nightly, cleaning_fee_cents: snap.cleaning,
      included_miles_per_day: snap.includedPerDay, overage_cents_per_mile: snap.overagePerMile,
      fuel_shortfall_cents_per_gallon: snap.fuelPerGallon,
    } : listing;
    const result = settle(settleListing, {
      mode: booking.mode, nights: booking.nights,
      totalCents: booking.total_cents, platformFeePct: est.platformFeePct != null ? est.platformFeePct : feePct(env),
    }, { actualMiles, fuelShortfallGallons: Number(body.fuel_shortfall_gallons || 0) });
    await dbRun(env,
      `UPDATE bookings SET status = 'completed', settled = 1, return_odometer = ?, actual_miles = ?,
         fuel_shortfall_gallons = ?, fuel_cents = ?, final_total_cents = ?, platform_fee_cents = ?, host_payout_cents = ?
       WHERE id = ?`,
      returnOdo, result.actualMiles, result.fuelShortfallGallons, result.fuelCents,
      result.finalTotalCents, result.platformFeeCents, result.hostPayoutCents, id);
    return json({ booking: bookingOut(await dbFirst(env, "SELECT * FROM bookings WHERE id = ?", id)), settlement: result });
  }
  return err("Unknown booking action", 404, "NOT_FOUND");
}

async function handleMyBookings(env, request) {
  const user = await requireUser(env, request);
  const rows = await dbAll(env,
    `SELECT b.*, l.title AS listing_title,
       EXISTS(SELECT 1 FROM reviews r WHERE r.booking_id = b.id AND r.author_id = b.renter_id) AS my_review_done
     FROM bookings b JOIN listings l ON l.id = b.listing_id WHERE b.renter_id = ? ORDER BY b.created_at DESC`, user.id);
  return json({ bookings: rows.map((r) => { const o = bookingOut(r); o.my_review_done = r.my_review_done === 1; return o; }) });
}

// ---------------------------------------------------------------------------
// SECTION: REVIEWS — two-way, only after a completed trip, one per direction.
// ---------------------------------------------------------------------------
async function handleCreateReview(env, request, bookingId) {
  const user = await requireUser(env, request);
  const body = await bodyJson(request);
  const booking = await dbFirst(env, "SELECT * FROM bookings WHERE id = ?", bookingId);
  if (!booking) return err("Booking not found", 404, "NOT_FOUND");
  if (booking.status !== "completed") return err("Reviews open after the trip is completed", 409, "BAD_STATE");
  let direction, subject;
  if (booking.renter_id === user.id) { direction = "renter_to_host"; subject = booking.host_id; }
  else if (booking.host_id === user.id) { direction = "host_to_renter"; subject = booking.renter_id; }
  else return err("Not your booking", 403, "FORBIDDEN");
  const rating = Number(body.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) return err("Rating must be 1–5", 400, "VALIDATION");
  try {
    await dbRun(env,
      "INSERT INTO reviews (id, booking_id, listing_id, author_id, subject_user_id, direction, rating, body, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      newId(), bookingId, booking.listing_id, user.id, subject, direction, rating, String(body.body || "").slice(0, 2000), nowISO());
  } catch {
    return err("You have already reviewed this trip", 409, "ALREADY_REVIEWED");
  }
  return json({ ok: true }, 201);
}

async function handleListingReviews(env, listingId) {
  const rows = await dbAll(env,
    `SELECT r.*, u.name AS author_name FROM reviews r JOIN users u ON u.id = r.author_id
     WHERE r.listing_id = ? AND r.direction = 'renter_to_host' ORDER BY r.created_at DESC`, listingId);
  return json({ reviews: rows });
}

// ---------------------------------------------------------------------------
// SECTION: INQUIRIES — renter asks, host replies (AI draft is a draft).
// ---------------------------------------------------------------------------
async function handleCreateInquiry(env, request) {
  const user = await requireUser(env, request);
  const body = await bodyJson(request);
  const listing = await getListing(env, String(body.listing_id || ""));
  if (!listing) return err("Listing not found", 404, "NOT_FOUND");
  if (listing.host_id === user.id) return err("You host this listing", 400, "VALIDATION");
  const text = String(body.body || "").trim();
  if (!text) return err("Write a message first", 400, "VALIDATION");
  const id = newId();
  await dbRun(env, "INSERT INTO inquiries (id, listing_id, renter_id, host_id, body, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    id, listing.id, user.id, listing.host_id, text.slice(0, 2000), nowISO());
  return json({ inquiry: { id } }, 201);
}

// ---------------------------------------------------------------------------
// SECTION: HOST — dashboard data, earnings, Stripe Connect onboarding.
// ---------------------------------------------------------------------------
async function handleHost(env, request, part) {
  const user = await requireUser(env, request);
  if (part === "listings") {
    const rows = await dbAll(env,
      `SELECT l.*, u.name AS host_name,
         (SELECT AVG(rating) FROM reviews r WHERE r.listing_id = l.id AND r.direction = 'renter_to_host') AS rating_avg,
         (SELECT COUNT(*) FROM reviews r WHERE r.listing_id = l.id AND r.direction = 'renter_to_host') AS rating_count
       FROM listings l JOIN users u ON u.id = l.host_id WHERE l.host_id = ? ORDER BY l.created_at DESC`, user.id);
    return json({ listings: rows.map(listingOut) });
  }
  if (part === "bookings") {
    const rows = await dbAll(env,
      `SELECT b.*, l.title AS listing_title, u.name AS renter_name FROM bookings b
       JOIN listings l ON l.id = b.listing_id JOIN users u ON u.id = b.renter_id
       WHERE b.host_id = ? ORDER BY b.created_at DESC`, user.id);
    return json({ bookings: rows.map(bookingOut) });
  }
  if (part === "inquiries") {
    const rows = await dbAll(env,
      `SELECT i.*, l.title AS listing_title, u.name AS renter_name FROM inquiries i
       JOIN listings l ON l.id = i.listing_id JOIN users u ON u.id = i.renter_id
       WHERE i.host_id = ? ORDER BY i.created_at DESC`, user.id);
    return json({ inquiries: rows });
  }
  if (part === "earnings") {
    const row = await dbFirst(env,
      `SELECT COALESCE(SUM(host_payout_cents), 0) AS payout, COUNT(*) AS n FROM bookings
       WHERE host_id = ? AND status IN ('confirmed','active','completed')`, user.id);
    const me = await dbFirst(env, "SELECT stripe_account_id FROM users WHERE id = ?", user.id);
    return json({
      payout_cents: row ? row.payout : 0,
      booking_count: row ? row.n : 0,
      stripe_account_id: me ? me.stripe_account_id : null,
      stripe: stripeState(env),
    });
  }
  if (part === "connect") {
    const state = stripeState(env);
    if (!state.configured) return json({ configured: false, message: "Stripe is not configured on this deployment (no STRIPE_SECRET_KEY secret set). Bookings and payout balances still work in demo mode." });
    let accountId = user.stripe_account_id;
    if (!accountId) {
      const acct = await createConnectAccount(env, user);
      accountId = acct.accountId;
      await dbRun(env, "UPDATE users SET stripe_account_id = ? WHERE id = ?", accountId, user.id);
    }
    const link = await createAccountLink(env, accountId, new URL(request.url).origin);
    return json({ configured: true, url: link.url, account_id: accountId });
  }
  return err("Unknown host resource", 404, "NOT_FOUND");
}

// ---------------------------------------------------------------------------
// SECTION: AI — rate-limited per user per day (ai_calls table).
// ---------------------------------------------------------------------------
async function aiBudgetOk(env, userId) {
  const limit = Number(env.AI_DAILY_LIMIT || 20);
  const row = await dbFirst(env, "SELECT count FROM ai_calls WHERE user_id = ? AND day = ?", userId, todayISO());
  if (row && row.count >= limit) return false;
  await dbRun(env,
    `INSERT INTO ai_calls (user_id, day, count) VALUES (?, ?, 1)
     ON CONFLICT(user_id, day) DO UPDATE SET count = count + 1`, userId, todayISO());
  return true;
}

async function handleAi(env, request, part) {
  const user = await requireUser(env, request);
  const body = await bodyJson(request);
  if (part === "suggest-price") {
    // Transparent heuristic (pricing.js) — not an AI call, not rate-limited.
    return json({ suggestion: suggestPrice({ type: body.type, rentalMode: body.rental_mode, sleeps: body.sleeps }) });
  }
  if (!(await aiBudgetOk(env, user.id))) return err("Daily AI limit reached for this account", 429, "AI_RATE_LIMIT");
  if (part === "polish") {
    const listing = await getListing(env, String(body.listing_id || ""));
    if (!listing) return err("Listing not found", 404, "NOT_FOUND");
    if (listing.host_id !== user.id && !isAdminUser(env, user)) return err("Only the host can polish this listing", 403, "FORBIDDEN");
    return json({ polished: await polishDescription(env, listing) });
  }
  if (part === "reply-draft") {
    const inquiry = await dbFirst(env, "SELECT * FROM inquiries WHERE id = ?", String(body.inquiry_id || ""));
    if (!inquiry) return err("Inquiry not found", 404, "NOT_FOUND");
    if (inquiry.host_id !== user.id && !isAdminUser(env, user)) return err("Only the host can draft a reply", 403, "FORBIDDEN");
    const listing = await getListing(env, inquiry.listing_id);
    return json({ draft: await draftInquiryReply(env, listing, inquiry.body) });
  }
  return err("Unknown AI action", 404, "NOT_FOUND");
}

// ---------------------------------------------------------------------------
// SECTION: STRIPE WEBHOOK
// ---------------------------------------------------------------------------
async function handleWebhook(env, request) {
  const payload = await request.text();
  const verdict = await verifyWebhook(env, payload, request.headers.get("Stripe-Signature"));
  if (!verdict.verified) {
    if (verdict.reason === "webhook_secret_not_configured") return json({ received: false, reason: verdict.reason });
    return err("Webhook signature verification failed: " + verdict.reason, 400, "WEBHOOK_SIGNATURE");
  }
  let event = {};
  try { event = JSON.parse(payload); } catch { return err("Bad payload", 400, "VALIDATION"); }
  if (event.type === "checkout.session.completed") {
    const session = event.data && event.data.object;
    const bookingId = session && session.metadata && session.metadata.booking_id;
    if (bookingId && session.payment_intent) {
      await dbRun(env, "UPDATE bookings SET stripe_payment_intent_id = ? WHERE id = ?", session.payment_intent, bookingId);
    }
  }
  return json({ received: true });
}

// ---------------------------------------------------------------------------
// SECTION: ROUTER
// ---------------------------------------------------------------------------
export default {
  async fetch(request, env) {
    try {
      if (env.DB) await ensureSchema(env);
      const url = new URL(request.url);
      const path = url.pathname;
      const method = request.method;

      if (path === "/" && method === "GET") {
        return new Response(renderAppHtml(), { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-cache" } });
      }
      if (path === "/manifest.webmanifest") return json(MANIFEST, 200, { "Content-Type": "application/manifest+json" });
      if (path === "/sw.js") return new Response(SERVICE_WORKER, { headers: { "Content-Type": "application/javascript", "Cache-Control": "no-cache" } });
      if (path === "/icon-192.png") return new Response(b64Bytes(ICON_192_B64), { headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=86400" } });
      if (path === "/icon-512.png") return new Response(b64Bytes(ICON_512_B64), { headers: { "Content-Type": "image/png", "Cache-Control": "public, max-age=86400" } });
      if (path === "/api/health") {
        return json({
          ok: true, app: "naptivity-rentals", version: "1.0.0",
          storage: env.DB ? "d1" : "unavailable",
          photos: env.PHOTOS ? "r2" : "unconfigured",
          ai: env.AI ? "workers-ai" : "template-fallback",
          stripe: stripeState(env),
        });
      }

      const photoMatch = /^\/photos\/(.+)$/.exec(path);
      if (photoMatch && method === "GET") return await handlePhotos(env, request, photoMatch[1]);
      const photoUpload = /^\/api\/listings\/([^/]+)\/photos$/.exec(path);
      if (photoUpload && method === "POST") return await handlePhotos(env, request, null, photoUpload[1]);

      const authMatch = /^\/api\/auth\/([a-z]+)$/.exec(path);
      if (authMatch) return await handleAuth(env, request, authMatch[1]);

      if (path === "/api/listings" && method === "GET") return await handleListings(env, request, url);
      if (path === "/api/listings" && method === "POST") return await handleCreateListing(env, request);
      const listingMatch = /^\/api\/listings\/([^/]+)$/.exec(path);
      if (listingMatch && method === "GET") {
        const listing = await getListing(env, listingMatch[1]);
        return listing && listing.status === "active" ? json({ listing: listingOut(listing) }) : err("Listing not found", 404, "NOT_FOUND");
      }
      if (listingMatch && method === "PATCH") return await handleUpdateListing(env, request, listingMatch[1]);
      const listingReviews = /^\/api\/listings\/([^/]+)\/reviews$/.exec(path);
      if (listingReviews && method === "GET") return await handleListingReviews(env, listingReviews[1]);

      if (path === "/api/quote" && method === "POST") return await handleQuote(env, request);
      if (path === "/api/bookings" && method === "POST") return await handleCreateBooking(env, request);
      if (path === "/api/bookings/mine" && method === "GET") return await handleMyBookings(env, request);
      const bookingAction = /^\/api\/bookings\/([^/]+)\/(approve|decline|cancel|pickup|return)$/.exec(path);
      if (bookingAction && method === "POST") return await handleBookingAction(env, request, bookingAction[1], bookingAction[2]);
      const reviewMatch = /^\/api\/bookings\/([^/]+)\/reviews$/.exec(path);
      if (reviewMatch && method === "POST") return await handleCreateReview(env, request, reviewMatch[1]);

      if (path === "/api/inquiries" && method === "POST") return await handleCreateInquiry(env, request);
      const inquiryReply = /^\/api\/inquiries\/([^/]+)\/reply$/.exec(path);
      if (inquiryReply && method === "POST") {
        const user = await requireUser(env, request);
        const body = await bodyJson(request);
        const inq = await dbFirst(env, "SELECT * FROM inquiries WHERE id = ?", inquiryReply[1]);
        if (!inq) return err("Inquiry not found", 404, "NOT_FOUND");
        if (inq.host_id !== user.id && !isAdminUser(env, user)) return err("Only the host can reply", 403, "FORBIDDEN");
        await dbRun(env, "UPDATE inquiries SET reply_body = ? WHERE id = ?", String(body.reply_body || "").slice(0, 2000), inquiryReply[1]);
        return json({ ok: true });
      }

      const hostMatch = /^\/api\/host\/([a-z]+)$/.exec(path);
      if (hostMatch && (method === "GET" ? hostMatch[1] !== "connect" : hostMatch[1] === "connect")) return await handleHost(env, request, hostMatch[1]);
      const aiMatch = /^\/api\/ai\/([a-z-]+)$/.exec(path);
      if (aiMatch && method === "POST") return await handleAi(env, request, aiMatch[1]);
      if (path === "/api/stripe/webhook" && method === "POST") return await handleWebhook(env, request);

      return err("Not found: " + method + " " + path, 404, "NOT_FOUND");
    } catch (e) {
      if (e instanceof PricingError) return err(e.message, 400, e.code);
      if (e && e.httpStatus) return err(e.message, e.httpStatus, e.code);
      return err("Internal error: " + String((e && e.message) || e).slice(0, 300), 500, "INTERNAL");
    }
  },
};
