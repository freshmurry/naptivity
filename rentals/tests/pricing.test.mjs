// ============================================================================
// pricing.test.mjs — the pricing engine, proven with worked numbers.
// ============================================================================
import test from "node:test";
import assert from "node:assert/strict";
import { quote, settle, suggestPrice, nightsBetween, PricingError } from "../src/pricing.js";

// Mirrors the seeded camper van: both modes, $135/night, $85 delivery,
// $25/night site fee, 100 included mi/day, $0.75/mi overage, return-full
// fuel at $6.00/gal shortfall, $60 cleaning, $500 deposit.
const VAN = {
  rental_mode: "both", nightly_rate_cents: 13500, delivery_fee_cents: 8500,
  site_fee_cents: 2500, included_miles_per_day: 100, overage_cents_per_mile: 75,
  fuel_policy: "return_full", fuel_shortfall_cents_per_gallon: 600,
  cleaning_fee_cents: 6000, deposit_cents: 50000,
};
// Mirrors the seeded boat: stationary only, $210/night, $40/night site fee.
const BOAT = {
  rental_mode: "stationary_only", nightly_rate_cents: 21000, delivery_fee_cents: 0,
  site_fee_cents: 4000, included_miles_per_day: 0, overage_cents_per_mile: 0,
  fuel_policy: "return_full", fuel_shortfall_cents_per_gallon: 0,
  cleaning_fee_cents: 9000, deposit_cents: 100000,
};
// Mirrors the seeded RV: movable only, $165/night, 125 mi/day, $0.65/mi,
// per-gallon fuel at $5.50/gal, $75 cleaning.
const RV = {
  rental_mode: "movable", nightly_rate_cents: 16500, delivery_fee_cents: 0,
  site_fee_cents: 0, included_miles_per_day: 125, overage_cents_per_mile: 65,
  fuel_policy: "per_gallon", fuel_shortfall_cents_per_gallon: 550,
  cleaning_fee_cents: 7500, deposit_cents: 75000,
};

test("movable quote: 3 nights, 450 expected miles, 100/day included → 150 overage miles", () => {
  const q = quote(VAN, { mode: "movable", startDate: "2027-06-01", endDate: "2027-06-04", expectedMiles: 450 }, 12);
  assert.equal(q.nights, 3);
  assert.equal(q.baseCents, 40500);            // 3 × $135
  assert.equal(q.includedMilesTotal, 300);     // 3 × 100
  assert.equal(q.estOverageMiles, 150);        // 450 − 300
  assert.equal(q.estOverageCents, 11250);      // 150 × $0.75
  assert.equal(q.deliveryCents, 0);
  assert.equal(q.siteCents, 0);
  assert.equal(q.cleaningCents, 6000);
  assert.equal(q.totalCents, 57750);           // 40500 + 11250 + 6000
  assert.equal(q.platformFeeCents, 6930);      // 12% of 57750
  assert.equal(q.hostPayoutCents, 50820);
  assert.equal(q.depositCents, 50000);
  assert.match(q.fuelNote, /settled at return/);
});

test("movable quote under the included miles charges no overage", () => {
  const q = quote(RV, { mode: "movable", startDate: "2027-06-01", endDate: "2027-06-03", expectedMiles: 200 }, 12);
  assert.equal(q.includedMilesTotal, 250);
  assert.equal(q.estOverageMiles, 0);
  assert.equal(q.estOverageCents, 0);
  assert.equal(q.totalCents, 2 * 16500 + 7500);
});

test("stationary quote: flat math, zero mileage fields even when miles are passed", () => {
  const q = quote(VAN, { mode: "stationary", startDate: "2027-06-01", endDate: "2027-06-04", expectedMiles: 450 }, 12);
  assert.equal(q.totalCents, 40500 + 8500 + 3 * 2500 + 6000); // 62500
  assert.equal(q.deliveryCents, 8500);
  assert.equal(q.siteCents, 7500);
  assert.equal(q.includedMilesTotal, 0);
  assert.equal(q.estOverageMiles, 0);
  assert.equal(q.estOverageCents, 0);
  assert.equal(q.mileageIgnored, true);        // caller passed miles; not charged
  assert.equal(q.fuelNote, null);
  assert.equal(q.platformFeeCents, 7500);
  assert.equal(q.hostPayoutCents, 55000);
});

test("stationary boat quote: nightly + site + cleaning only", () => {
  const q = quote(BOAT, { mode: "stationary", startDate: "2027-07-10", endDate: "2027-07-12" }, 12);
  assert.equal(q.totalCents, 2 * 21000 + 2 * 4000 + 9000); // 59000
  assert.equal(q.depositCents, 100000);
});

test("mode enforcement: stationary-only boat refuses a movable quote", () => {
  assert.throws(
    () => quote(BOAT, { mode: "movable", startDate: "2027-07-10", endDate: "2027-07-12", expectedMiles: 10 }, 12),
    (e) => e instanceof PricingError && e.code === "MODE_NOT_ALLOWED");
});

test("mode enforcement: movable-only RV refuses a stationary quote", () => {
  assert.throws(
    () => quote(RV, { mode: "stationary", startDate: "2027-07-10", endDate: "2027-07-12" }, 12),
    (e) => e instanceof PricingError && e.code === "MODE_NOT_ALLOWED");
});

test("invalid mode and invalid dates are rejected", () => {
  assert.throws(() => quote(VAN, { mode: "teleport", startDate: "2027-06-01", endDate: "2027-06-02" }, 12), /mode/i);
  assert.throws(() => nightsBetween("2027-06-04", "2027-06-04"), (e) => e.code === "INVALID_DATES");
  assert.throws(() => nightsBetween("2027-02-28", "2027-02-30"), (e) => e.code === "INVALID_DATES");
  assert.equal(nightsBetween("2027-06-01", "2027-06-04"), 3);
});

test("settlement: 450 actual miles + 4 gal shortfall settles above the estimate by the fuel charge", () => {
  const est = quote(VAN, { mode: "movable", startDate: "2027-06-01", endDate: "2027-06-04", expectedMiles: 450 }, 12);
  const s = settle(VAN, { mode: "movable", nights: 3, totalCents: est.totalCents, platformFeePct: 12 },
    { actualMiles: 450, fuelShortfallGallons: 4 });
  assert.equal(s.overageMiles, 150);
  assert.equal(s.overageCents, 11250);
  assert.equal(s.fuelCents, 2400);             // 4 gal × $6.00
  assert.equal(s.finalTotalCents, 60150);      // 40500 + 6000 + 11250 + 2400
  assert.equal(s.deltaCents, 2400);            // exactly the fuel shortfall
  assert.equal(s.hostPayoutCents, 60150 - Math.round(60150 * 0.12));
});

test("settlement: driving under the included miles produces a credit delta", () => {
  const est = quote(VAN, { mode: "movable", startDate: "2027-06-01", endDate: "2027-06-04", expectedMiles: 450 }, 12);
  const s = settle(VAN, { mode: "movable", nights: 3, totalCents: est.totalCents, platformFeePct: 12 },
    { actualMiles: 280, fuelShortfallGallons: 6 });
  assert.equal(s.overageMiles, 0);             // 280 < 300 included
  assert.equal(s.fuelCents, 3600);             // 6 gal × $6.00
  assert.equal(s.finalTotalCents, 50100);
  assert.equal(s.deltaCents, -7650);           // renter is credited back
});

test("settlement refuses stationary bookings outright", () => {
  assert.throws(
    () => settle(VAN, { mode: "stationary", nights: 3, totalCents: 62500, platformFeePct: 12 }, { actualMiles: 0, fuelShortfallGallons: 0 }),
    (e) => e.code === "MODE_NOT_ALLOWED");
});

test("price suggestion is a labelled heuristic with a sane range", () => {
  const s = suggestPrice({ type: "camper_van", rentalMode: "both", sleeps: 2 });
  assert.equal(s.isEstimate, true);
  assert.equal(s.midCents, 12600);             // 12000 × 1.05 × 1.00
  assert.ok(s.lowCents < s.midCents && s.midCents < s.highCents);
  assert.match(s.basis, /Heuristic estimate/);
});
