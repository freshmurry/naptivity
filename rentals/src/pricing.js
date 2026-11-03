// ============================================================================
// pricing.js — Naptivity Rentals pricing engine (PURE, no I/O, unit-tested)
// ============================================================================
// Two rental modes with deliberately different math:
//
//   STATIONARY ("stand-still"): the unit stays put (delivered to a site or
//   already on land / at a dock). Flat, predictable pricing:
//     nights x nightly rate + delivery/setup fee (once) + site fee (per
//     night) + cleaning fee. There is NO mileage in this mode, ever — the
//     quote object carries zero mileage fields and any expected-miles input
//     is ignored (and flagged), never charged.
//
//   MOVABLE: the renter takes the unit out.
//     nights x nightly rate + cleaning fee, plus mileage: the booking
//     includes `included_miles_per_day` per night; miles beyond that are
//     billed at `overage_cents_per_mile`. Fuel follows the listing's policy
//     ("return_full" or "per_gallon") and is settled at RETURN from the
//     recorded shortfall, never estimated into the booking total.
//   The booking-time total for movable is an ESTIMATE built from the
//   renter's expected miles; settle() recomputes the final total from the
//   actual odometer readings at return. The difference is the delta the
//   renter owes (or is credited).
//
// Platform fee: PLATFORM_FEE_PCT of the rental subtotal, deducted from the
// HOST payout. The renter total is never marked up, and the refundable
// security deposit is never part of the fee base.
// ============================================================================

export const LISTING_TYPES = [
  "rv", "camper_van", "bus_conversion", "travel_trailer", "boat", "yacht", "houseboat",
];

export const TYPE_LABELS = {
  rv: "RV / Motorhome",
  camper_van: "Camper Van",
  bus_conversion: "Bus Conversion",
  travel_trailer: "Travel Trailer",
  boat: "Boat",
  yacht: "Yacht",
  houseboat: "Houseboat",
};

export const LISTING_MODES = ["stationary_only", "movable", "both"];
export const BOOKING_MODES = ["stationary", "movable"];
export const FUEL_POLICIES = ["return_full", "per_gallon"];

export class PricingError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "PricingError";
    this.code = code;
  }
}

function assertInt(value, field) {
  if (!Number.isInteger(value) || value < 0) {
    throw new PricingError("VALIDATION", field + " must be a non-negative integer (cents/units)");
  }
}

// ---------------------------------------------------------------------------
// SECTION: DATE MATH — rental dates are YYYY-MM-DD text; nights are whole
// days between pickup and return dates (days are the correct unit here).
// ---------------------------------------------------------------------------
export function parseDate(text) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(text || ""));
  if (!m) throw new PricingError("INVALID_DATES", "Dates must be YYYY-MM-DD");
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const d = new Date(ms);
  if (d.getUTCFullYear() !== Number(m[1]) || d.getUTCMonth() !== Number(m[2]) - 1 || d.getUTCDate() !== Number(m[3])) {
    throw new PricingError("INVALID_DATES", "Not a real calendar date: " + text);
  }
  return ms;
}

export function nightsBetween(startDate, endDate) {
  const nights = Math.round((parseDate(endDate) - parseDate(startDate)) / 86400000);
  if (nights < 1) throw new PricingError("INVALID_DATES", "End date must be after start date (minimum 1 night)");
  if (nights > 90) throw new PricingError("INVALID_DATES", "Bookings are limited to 90 nights");
  return nights;
}

// ---------------------------------------------------------------------------
// SECTION: MODE RULES — which booking modes a listing permits.
// ---------------------------------------------------------------------------
export function allowedModes(listing) {
  if (listing.rental_mode === "stationary_only") return ["stationary"];
  if (listing.rental_mode === "movable") return ["movable"];
  if (listing.rental_mode === "both") return ["stationary", "movable"];
  throw new PricingError("VALIDATION", "Unknown listing rental_mode: " + listing.rental_mode);
}

export function assertModeAllowed(listing, mode) {
  if (!BOOKING_MODES.includes(mode)) {
    throw new PricingError("VALIDATION", "Booking mode must be one of: " + BOOKING_MODES.join(", "));
  }
  if (!allowedModes(listing).includes(mode)) {
    throw new PricingError(
      "MODE_NOT_ALLOWED",
      "This listing is " + listing.rental_mode.replace("_", " ") +
      " and cannot be booked as " + mode + "."
    );
  }
}

// ---------------------------------------------------------------------------
// SECTION: QUOTE — booking-time price for either mode. For movable this is
// an estimate driven by expectedMiles; fuel is NEVER estimated (settled at
// return). Returns a frozen, line-itemised breakdown safe to snapshot.
// ---------------------------------------------------------------------------
export function quote(listing, input, feePct) {
  assertModeAllowed(listing, input.mode);
  const nights = nightsBetween(input.startDate, input.endDate);
  const pct = Number.isFinite(feePct) && feePct >= 0 ? feePct : 12;

  assertInt(listing.nightly_rate_cents, "nightly_rate_cents");
  assertInt(listing.cleaning_fee_cents, "cleaning_fee_cents");
  assertInt(listing.deposit_cents, "deposit_cents");

  const base = nights * listing.nightly_rate_cents;
  const lines = [
    { label: "$" + (listing.nightly_rate_cents / 100).toFixed(2) + " x " + nights + " night" + (nights === 1 ? "" : "s"), cents: base },
  ];
  let delivery = 0, site = 0;
  let includedMilesTotal = 0, estOverageMiles = 0, estOverageCents = 0;
  let mileageIgnored = false;

  if (input.mode === "stationary") {
    assertInt(listing.delivery_fee_cents, "delivery_fee_cents");
    assertInt(listing.site_fee_cents, "site_fee_cents");
    delivery = listing.delivery_fee_cents || 0;
    site = nights * (listing.site_fee_cents || 0);
    if (delivery > 0) lines.push({ label: "Delivery & setup (one-time)", cents: delivery });
    if (site > 0) lines.push({ label: "Site fee x " + nights + " night" + (nights === 1 ? "" : "s"), cents: site });
    // Stationary means stationary: miles are not a pricing input in this
    // mode. If a caller passed some anyway, say so and charge nothing.
    if (input.expectedMiles != null && Number(input.expectedMiles) > 0) mileageIgnored = true;
  } else {
    assertInt(listing.included_miles_per_day, "included_miles_per_day");
    assertInt(listing.overage_cents_per_mile, "overage_cents_per_mile");
    const expected = input.expectedMiles == null ? 0 : Number(input.expectedMiles);
    if (!Number.isFinite(expected) || expected < 0) {
      throw new PricingError("VALIDATION", "expectedMiles must be a non-negative number");
    }
    includedMilesTotal = nights * (listing.included_miles_per_day || 0);
    estOverageMiles = Math.max(0, Math.round(expected) - includedMilesTotal);
    estOverageCents = estOverageMiles * (listing.overage_cents_per_mile || 0);
    lines.push({ label: "Included miles (" + includedMilesTotal + " mi)", cents: 0 });
    if (estOverageCents > 0) {
      lines.push({
        label: "Estimated mileage overage (" + estOverageMiles + " mi over included)",
        cents: estOverageCents,
      });
    }
  }

  const cleaning = listing.cleaning_fee_cents || 0;
  if (cleaning > 0) lines.push({ label: "Cleaning fee", cents: cleaning });

  const total = base + delivery + site + cleaning + estOverageCents;
  const platformFee = Math.round(total * pct / 100);
  const hostPayout = total - platformFee;

  return {
    mode: input.mode,
    nights,
    lines,
    baseCents: base,
    deliveryCents: delivery,
    siteCents: site,
    cleaningCents: cleaning,
    includedMilesTotal,
    estOverageMiles,
    estOverageCents,
    mileageIgnored,
    fuelPolicy: input.mode === "movable" ? (listing.fuel_policy || "return_full") : null,
    fuelNote: input.mode === "movable"
      ? "Fuel is settled at return under the \"" + (listing.fuel_policy || "return_full") +
        "\" policy and is not included in this estimate."
      : null,
    totalCents: total,
    depositCents: listing.deposit_cents || 0,
    platformFeePct: pct,
    platformFeeCents: platformFee,
    hostPayoutCents: hostPayout,
  };
}

// ---------------------------------------------------------------------------
// SECTION: SETTLEMENT — final movable total from ACTUAL return readings.
// final = nightly base + cleaning + actual overage + fuel shortfall charge.
// delta = final - booked estimate total (positive: renter owes more).
// Stationary bookings never settle mileage: settle() refuses them.
// ---------------------------------------------------------------------------
export function settle(listing, booking, actuals) {
  if (booking.mode !== "movable") {
    throw new PricingError("MODE_NOT_ALLOWED", "Stationary bookings have no mileage settlement");
  }
  const nights = booking.nights;
  const actualMiles = Number(actuals && actuals.actualMiles);
  if (!Number.isFinite(actualMiles) || actualMiles < 0) {
    throw new PricingError("VALIDATION", "actualMiles must be a non-negative number");
  }
  const includedMilesTotal = nights * (listing.included_miles_per_day || 0);
  const overageMiles = Math.max(0, Math.round(actualMiles) - includedMilesTotal);
  const overageCents = overageMiles * (listing.overage_cents_per_mile || 0);

  const gallons = Number((actuals && actuals.fuelShortfallGallons) || 0);
  if (!Number.isFinite(gallons) || gallons < 0) {
    throw new PricingError("VALIDATION", "fuelShortfallGallons must be a non-negative number");
  }
  const fuelCents = Math.round(gallons * (listing.fuel_shortfall_cents_per_gallon || 0));

  const base = nights * listing.nightly_rate_cents;
  const cleaning = listing.cleaning_fee_cents || 0;
  const finalTotal = base + cleaning + overageCents + fuelCents;
  const platformFee = Math.round(finalTotal * (booking.platformFeePct != null ? booking.platformFeePct : 12) / 100);

  return {
    actualMiles: Math.round(actualMiles),
    includedMilesTotal,
    overageMiles,
    overageCents,
    fuelShortfallGallons: gallons,
    fuelCents,
    baseCents: base,
    cleaningCents: cleaning,
    finalTotalCents: finalTotal,
    deltaCents: finalTotal - booking.totalCents,
    platformFeeCents: platformFee,
    hostPayoutCents: finalTotal - platformFee,
  };
}

// ---------------------------------------------------------------------------
// SECTION: PRICE SUGGESTION — a transparent heuristic, NOT machine learning
// and NOT a valuation. Baseline nightly medians by type, adjusted for mode
// and sleeping capacity. Always labelled an estimate in the UI.
// ---------------------------------------------------------------------------
const TYPE_BASELINE_NIGHTLY_CENTS = {
  rv: 14500, camper_van: 12000, bus_conversion: 11000, travel_trailer: 8500,
  boat: 22000, yacht: 65000, houseboat: 18000,
};

export function suggestPrice(input) {
  const baseline = TYPE_BASELINE_NIGHTLY_CENTS[input.type];
  if (!baseline) throw new PricingError("VALIDATION", "Unknown listing type: " + input.type);
  const modeFactor = input.rentalMode === "stationary_only" ? 0.9 : input.rentalMode === "both" ? 1.05 : 1.0;
  const sleeps = Math.max(1, Math.min(16, Number(input.sleeps) || 2));
  const capacityFactor = Math.max(0.8, Math.min(1.5, 1 + 0.05 * (sleeps - 2)));
  const mid = Math.round(baseline * modeFactor * capacityFactor / 100) * 100;
  return {
    lowCents: Math.round(mid * 0.85 / 100) * 100,
    midCents: mid,
    highCents: Math.round(mid * 1.15 / 100) * 100,
    basis: "Heuristic estimate: typical nightly baseline for " + (TYPE_LABELS[input.type] || input.type) +
      ", adjusted x" + modeFactor.toFixed(2) + " for rental mode and x" + capacityFactor.toFixed(2) +
      " for sleeping capacity (" + sleeps + "). Not a valuation; check comparable local listings.",
    isEstimate: true,
  };
}
