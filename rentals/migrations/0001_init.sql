-- ============================================================================
-- Naptivity Rentals — D1 schema (migration 0001)
-- The Worker also self-creates these tables (CREATE TABLE IF NOT EXISTS) on
-- first request; this file is the canonical schema record. Dates are ISO
-- text (YYYY-MM-DD for rental dates, full ISO timestamps for created_at).
-- All money is integer cents. No mileage columns exist on stationary flows.
-- ============================================================================

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  is_admin INTEGER NOT NULL DEFAULT 0,
  stripe_account_id TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS listings (
  id TEXT PRIMARY KEY,
  host_id TEXT NOT NULL,
  type TEXT NOT NULL,               -- rv | camper_van | bus_conversion | travel_trailer | boat | yacht | houseboat
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  location_text TEXT NOT NULL DEFAULT '',
  sleeps INTEGER NOT NULL DEFAULT 2,
  amenities_json TEXT NOT NULL DEFAULT '[]',
  photos_json TEXT NOT NULL DEFAULT '[]',
  rental_mode TEXT NOT NULL DEFAULT 'both',  -- stationary_only | movable | both
  nightly_rate_cents INTEGER NOT NULL,
  -- Stationary ("stand-still") pricing: flat and predictable. No mileage, ever.
  delivery_fee_cents INTEGER NOT NULL DEFAULT 0,
  site_fee_cents INTEGER NOT NULL DEFAULT 0,          -- per night
  -- Movable pricing: included miles per day + per-mile overage + fuel policy.
  included_miles_per_day INTEGER NOT NULL DEFAULT 0,
  overage_cents_per_mile INTEGER NOT NULL DEFAULT 0,
  fuel_policy TEXT NOT NULL DEFAULT 'return_full',    -- return_full | per_gallon
  fuel_shortfall_cents_per_gallon INTEGER NOT NULL DEFAULT 0,
  cleaning_fee_cents INTEGER NOT NULL DEFAULT 0,
  deposit_cents INTEGER NOT NULL DEFAULT 0,
  instant_book INTEGER NOT NULL DEFAULT 0,
  -- Honest-copy attestations: the PLATFORM provides no insurance/licensing.
  insurance_attested INTEGER NOT NULL DEFAULT 0,
  license_attested INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS bookings (
  id TEXT PRIMARY KEY,
  listing_id TEXT NOT NULL,
  renter_id TEXT NOT NULL,
  host_id TEXT NOT NULL,
  mode TEXT NOT NULL,               -- stationary | movable (chosen per booking)
  start_date TEXT NOT NULL,
  end_date TEXT NOT NULL,
  nights INTEGER NOT NULL,
  expected_miles INTEGER,           -- movable only; NULL for stationary
  status TEXT NOT NULL DEFAULT 'pending',  -- pending|confirmed|active|completed|declined|cancelled
  -- Estimate snapshot, frozen at booking time by the pricing engine.
  base_cents INTEGER NOT NULL DEFAULT 0,
  delivery_cents INTEGER NOT NULL DEFAULT 0,
  site_cents INTEGER NOT NULL DEFAULT 0,
  cleaning_cents INTEGER NOT NULL DEFAULT 0,
  included_miles_total INTEGER NOT NULL DEFAULT 0,
  est_overage_miles INTEGER NOT NULL DEFAULT 0,
  est_overage_cents INTEGER NOT NULL DEFAULT 0,
  total_cents INTEGER NOT NULL DEFAULT 0,
  deposit_cents INTEGER NOT NULL DEFAULT 0,
  platform_fee_cents INTEGER NOT NULL DEFAULT 0,
  host_payout_cents INTEGER NOT NULL DEFAULT 0,
  estimate_json TEXT NOT NULL DEFAULT '{}',
  -- Settlement actuals (movable), recorded at pickup / return.
  pickup_odometer INTEGER,
  return_odometer INTEGER,
  actual_miles INTEGER,
  fuel_shortfall_gallons REAL,
  fuel_cents INTEGER,
  final_total_cents INTEGER,
  settled INTEGER NOT NULL DEFAULT 0,
  stripe_checkout_session_id TEXT,
  stripe_payment_intent_id TEXT,
  deposit_hold_status TEXT NOT NULL DEFAULT 'not_created',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reviews (
  id TEXT PRIMARY KEY,
  booking_id TEXT NOT NULL,
  listing_id TEXT NOT NULL,
  author_id TEXT NOT NULL,
  subject_user_id TEXT NOT NULL,
  direction TEXT NOT NULL,          -- renter_to_host | host_to_renter
  rating INTEGER NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  UNIQUE (booking_id, direction)
);

CREATE TABLE IF NOT EXISTS inquiries (
  id TEXT PRIMARY KEY,
  listing_id TEXT NOT NULL,
  renter_id TEXT NOT NULL,
  host_id TEXT NOT NULL,
  body TEXT NOT NULL,
  reply_body TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ai_calls (
  user_id TEXT NOT NULL,
  day TEXT NOT NULL,
  count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, day)
);
