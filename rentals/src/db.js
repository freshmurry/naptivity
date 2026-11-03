// ============================================================================
// db.js — D1 helpers, schema bootstrap, demo seed data
// ============================================================================
// The Worker self-creates its tables (CREATE TABLE IF NOT EXISTS) on first
// request, mirroring the migration file under migrations/. Seed data is
// inserted only when the listings table is completely empty.
// ============================================================================

export function nowISO() { return new Date().toISOString(); }
export function todayISO() { return new Date().toISOString().slice(0, 10); }
export function newId() { return crypto.randomUUID(); }

export async function dbRun(env, sql, ...params) {
  return env.DB.prepare(sql).bind(...params).run();
}
export async function dbFirst(env, sql, ...params) {
  return env.DB.prepare(sql).bind(...params).first();
}
export async function dbAll(env, sql, ...params) {
  const res = await env.DB.prepare(sql).bind(...params).all();
  return res.results || [];
}

// ---------------------------------------------------------------------------
// SECTION: SCHEMA — kept in sync with migrations/0001_init.sql
// ---------------------------------------------------------------------------
const SCHEMA_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS users (
     id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
     password_hash TEXT NOT NULL, is_admin INTEGER NOT NULL DEFAULT 0,
     stripe_account_id TEXT, created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS sessions (
     token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL,
     created_at TEXT NOT NULL, expires_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS listings (
     id TEXT PRIMARY KEY, host_id TEXT NOT NULL, type TEXT NOT NULL,
     title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
     location_text TEXT NOT NULL DEFAULT '', sleeps INTEGER NOT NULL DEFAULT 2,
     amenities_json TEXT NOT NULL DEFAULT '[]', photos_json TEXT NOT NULL DEFAULT '[]',
     rental_mode TEXT NOT NULL DEFAULT 'both', nightly_rate_cents INTEGER NOT NULL,
     delivery_fee_cents INTEGER NOT NULL DEFAULT 0, site_fee_cents INTEGER NOT NULL DEFAULT 0,
     included_miles_per_day INTEGER NOT NULL DEFAULT 0, overage_cents_per_mile INTEGER NOT NULL DEFAULT 0,
     fuel_policy TEXT NOT NULL DEFAULT 'return_full', fuel_shortfall_cents_per_gallon INTEGER NOT NULL DEFAULT 0,
     cleaning_fee_cents INTEGER NOT NULL DEFAULT 0, deposit_cents INTEGER NOT NULL DEFAULT 0,
     instant_book INTEGER NOT NULL DEFAULT 0, insurance_attested INTEGER NOT NULL DEFAULT 0,
     license_attested INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'active',
     created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS bookings (
     id TEXT PRIMARY KEY, listing_id TEXT NOT NULL, renter_id TEXT NOT NULL, host_id TEXT NOT NULL,
     mode TEXT NOT NULL, start_date TEXT NOT NULL, end_date TEXT NOT NULL, nights INTEGER NOT NULL,
     expected_miles INTEGER, status TEXT NOT NULL DEFAULT 'pending',
     base_cents INTEGER NOT NULL DEFAULT 0, delivery_cents INTEGER NOT NULL DEFAULT 0,
     site_cents INTEGER NOT NULL DEFAULT 0, cleaning_cents INTEGER NOT NULL DEFAULT 0,
     included_miles_total INTEGER NOT NULL DEFAULT 0, est_overage_miles INTEGER NOT NULL DEFAULT 0,
     est_overage_cents INTEGER NOT NULL DEFAULT 0, total_cents INTEGER NOT NULL DEFAULT 0,
     deposit_cents INTEGER NOT NULL DEFAULT 0, platform_fee_cents INTEGER NOT NULL DEFAULT 0,
     host_payout_cents INTEGER NOT NULL DEFAULT 0, estimate_json TEXT NOT NULL DEFAULT '{}',
     pickup_odometer INTEGER, return_odometer INTEGER, actual_miles INTEGER,
     fuel_shortfall_gallons REAL, fuel_cents INTEGER, final_total_cents INTEGER,
     settled INTEGER NOT NULL DEFAULT 0, stripe_checkout_session_id TEXT,
     stripe_payment_intent_id TEXT, deposit_hold_status TEXT NOT NULL DEFAULT 'not_created',
     created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS reviews (
     id TEXT PRIMARY KEY, booking_id TEXT NOT NULL, listing_id TEXT NOT NULL,
     author_id TEXT NOT NULL, subject_user_id TEXT NOT NULL, direction TEXT NOT NULL,
     rating INTEGER NOT NULL, body TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL,
     UNIQUE (booking_id, direction))`,
  `CREATE TABLE IF NOT EXISTS inquiries (
     id TEXT PRIMARY KEY, listing_id TEXT NOT NULL, renter_id TEXT NOT NULL, host_id TEXT NOT NULL,
     body TEXT NOT NULL, reply_body TEXT, created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS ai_calls (
     user_id TEXT NOT NULL, day TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 0,
     PRIMARY KEY (user_id, day))`,
];

const initializedDbs = new WeakSet();

export async function ensureSchema(env) {
  if (!env.DB || initializedDbs.has(env.DB)) return;
  initializedDbs.add(env.DB);
  for (const stmt of SCHEMA_STATEMENTS) await env.DB.prepare(stmt).run();
  await seedDemoData(env);
}

// ---------------------------------------------------------------------------
// SECTION: DEMO SEED — 3 listings chosen so BOTH pricing modes demo at once:
//   1. camper van, mode "both"        (renter picks per booking)
//   2. RV, movable only               (mileage + fuel settlement)
//   3. boat, stationary_only          (at the dock; movable booking refused)
// Demo accounts exist ONLY so the seeded listings have a host and the demo
// is clickable end to end. Passwords are published in the README on purpose
// for the demo; DELETE these accounts before any real-world use.
// ---------------------------------------------------------------------------
export const DEMO_HOST = { email: "host@demo.naptivity.app", password: "demo-host-2026", name: "Demo Host (Maya)" };
export const DEMO_RENTER = { email: "renter@demo.naptivity.app", password: "demo-renter-2026", name: "Demo Renter (Sam)" };

async function seedDemoData(env) {
  const existing = await dbFirst(env, "SELECT COUNT(*) AS n FROM listings");
  if (existing && existing.n > 0) return;
  const { hashPassword } = await import("./auth.js");

  const hostId = newId(), renterId = newId(), ts = nowISO();
  await dbRun(env, "INSERT INTO users (id, email, name, password_hash, is_admin, created_at) VALUES (?, ?, ?, ?, 0, ?)",
    hostId, DEMO_HOST.email, DEMO_HOST.name, await hashPassword(DEMO_HOST.password), ts);
  await dbRun(env, "INSERT INTO users (id, email, name, password_hash, is_admin, created_at) VALUES (?, ?, ?, ?, 0, ?)",
    renterId, DEMO_RENTER.email, DEMO_RENTER.name, await hashPassword(DEMO_RENTER.password), ts);

  const listings = [
    {
      id: newId(), host_id: hostId, type: "camper_van",
      title: "Wanderer — 2021 Sprinter Camper Van Conversion",
      description: "Self-built Sprinter conversion with a full bed, swivel seats, roof solar, a two-burner galley and an outdoor shower. Take it on the road, or have it delivered and set up at your site for a stand-still weekend.",
      location_text: "Bend, Oregon", sleeps: 2,
      amenities: ["Solar + lithium power", "Full bed", "Galley kitchen", "Outdoor shower", "Heater", "Camp chairs"],
      rental_mode: "both", nightly_rate_cents: 13500,
      delivery_fee_cents: 8500, site_fee_cents: 2500,
      included_miles_per_day: 100, overage_cents_per_mile: 75,
      fuel_policy: "return_full", fuel_shortfall_cents_per_gallon: 600,
      cleaning_fee_cents: 6000, deposit_cents: 50000, instant_book: 0,
    },
    {
      id: newId(), host_id: hostId, type: "rv",
      title: "Sunseeker — 30 ft Class C RV, sleeps 6",
      description: "Family-ready Class C with bunk beds, a full kitchen, bathroom and shower, bike rack and a generator. Drives like a big van. Road trips only — this one is made to move.",
      location_text: "Austin, Texas", sleeps: 6,
      amenities: ["Bunk beds", "Full kitchen", "Bathroom + shower", "Generator", "Bike rack", "Awning"],
      rental_mode: "movable", nightly_rate_cents: 16500,
      delivery_fee_cents: 0, site_fee_cents: 0,
      included_miles_per_day: 125, overage_cents_per_mile: 65,
      fuel_policy: "per_gallon", fuel_shortfall_cents_per_gallon: 550,
      cleaning_fee_cents: 7500, deposit_cents: 75000, instant_book: 1,
    },
    {
      id: newId(), host_id: hostId, type: "boat",
      title: "Harbor Lights — 34 ft Cabin Cruiser (at the dock)",
      description: "A floating stay at the marina: sleep aboard, cook in the galley, watch the sunset from the flybridge. This listing is stationary only — the boat stays at its slip in the marina for the whole stay and does not leave the dock.",
      location_text: "San Diego, California", sleeps: 4,
      amenities: ["Marina slip included", "Galley", "Flybridge lounge", "Shore power + AC", "2 cabins"],
      rental_mode: "stationary_only", nightly_rate_cents: 21000,
      delivery_fee_cents: 0, site_fee_cents: 4000,
      included_miles_per_day: 0, overage_cents_per_mile: 0,
      fuel_policy: "return_full", fuel_shortfall_cents_per_gallon: 0,
      cleaning_fee_cents: 9000, deposit_cents: 100000, instant_book: 1,
    },
  ];

  for (const l of listings) {
    await dbRun(env,
      `INSERT INTO listings (id, host_id, type, title, description, location_text, sleeps,
         amenities_json, photos_json, rental_mode, nightly_rate_cents, delivery_fee_cents,
         site_fee_cents, included_miles_per_day, overage_cents_per_mile, fuel_policy,
         fuel_shortfall_cents_per_gallon, cleaning_fee_cents, deposit_cents, instant_book,
         insurance_attested, license_attested, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, '[]', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 1, 'active', ?)`,
      l.id, l.host_id, l.type, l.title, l.description, l.location_text, l.sleeps,
      JSON.stringify(l.amenities), l.rental_mode, l.nightly_rate_cents, l.delivery_fee_cents,
      l.site_fee_cents, l.included_miles_per_day, l.overage_cents_per_mile, l.fuel_policy,
      l.fuel_shortfall_cents_per_gallon, l.cleaning_fee_cents, l.deposit_cents, l.instant_book, ts);
  }
}
