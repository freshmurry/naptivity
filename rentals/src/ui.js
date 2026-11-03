// ============================================================================
// ui.js — Naptivity Rentals front end (vanilla JS, mobile-first PWA shell)
// ============================================================================
// One HTML document; all interactivity is wired with addEventListener (no
// inline handlers). Views: Explore, Listing detail + booking, Trips,
// Host dashboard, Account. The honest-copy rules live here in the open:
// Naptivity provides NO insurance, licensing, or roadside assistance —
// hosts attest to their own coverage and renters are told to verify theirs.
// ============================================================================

const CSS = `
:root{--navy:#0d2233;--navy2:#14344d;--amber:#f5a623;--ink:#12212e;--mut:#5b7182;--line:#dbe5ec;--bg:#f4f8fa;--card:#fff;--ok:#1c7c43;--bad:#b3261e;--radius:14px}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;background:var(--bg);color:var(--ink);padding-bottom:76px}
a{color:var(--navy2)}
header{position:sticky;top:0;z-index:20;background:var(--navy);color:#fff;padding:10px 16px;display:flex;align-items:center;gap:10px}
header .logo{font-weight:800;font-size:20px;letter-spacing:.3px}header .logo span{color:var(--amber)}
header .tag{font-size:11px;color:#bcd; display:none}
@media(min-width:640px){header .tag{display:block}}
main{max-width:860px;margin:0 auto;padding:14px}
h1{font-size:22px;margin:8px 0}h2{font-size:18px;margin:16px 0 8px}h3{font-size:15px;margin:10px 0 6px}
.card{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);padding:14px;margin:0 0 12px}
.listing{display:flex;gap:12px;cursor:pointer}
.listing img,.ph{width:104px;height:88px;object-fit:cover;border-radius:10px;flex:none;background:linear-gradient(135deg,var(--navy2),#2b5a7a);color:#fff;display:flex;align-items:center;justify-content:center;font-size:30px}
.listing .meta{font-size:13px;color:var(--mut)}
.price{font-weight:800;font-size:16px}
.chip{display:inline-block;padding:2px 9px;border-radius:999px;font-size:11px;font-weight:700;background:#e8f0f5;color:var(--navy2);margin:0 4px 4px 0}
.chip.amber{background:#fdf0d3;color:#8a5b00}.chip.green{background:#e2f3e8;color:var(--ok)}
label{display:block;font-size:13px;font-weight:600;margin:10px 0 4px}
input,select,textarea{width:100%;padding:11px;border:1px solid var(--line);border-radius:10px;font-size:15px;background:#fff}
textarea{min-height:80px}
.btn{display:inline-block;width:100%;padding:13px;border:0;border-radius:12px;background:var(--amber);color:#231a00;font-weight:800;font-size:15px;cursor:pointer;text-align:center}
.btn.navy{background:var(--navy);color:#fff}.btn.ghost{background:#fff;border:1px solid var(--line);color:var(--ink)}
.btn.small{width:auto;padding:8px 14px;font-size:13px}.btn:disabled{opacity:.5}
.row{display:flex;gap:10px}.row>*{flex:1}
table.lines{width:100%;border-collapse:collapse;font-size:14px}
table.lines td{padding:5px 0;border-bottom:1px dashed var(--line)}table.lines td:last-child{text-align:right;font-weight:600}
.total{font-size:17px;font-weight:800}
.note{font-size:12.5px;color:var(--mut);line-height:1.5}
.warn{background:#fff6e0;border:1px solid #f0d48a;border-radius:10px;padding:10px 12px;font-size:13px;line-height:1.5}
.err{background:#fdecea;border:1px solid #f2b8b2;border-radius:10px;padding:10px 12px;font-size:13.5px;color:var(--bad)}
.okbox{background:#e9f6ee;border:1px solid #a9d8bb;border-radius:10px;padding:10px 12px;font-size:13.5px;color:var(--ok)}
nav.tabs{position:fixed;left:0;right:0;bottom:0;background:#fff;border-top:1px solid var(--line);display:flex;z-index:30}
nav.tabs button{flex:1;background:none;border:0;padding:9px 0 11px;font-size:11.5px;font-weight:700;color:var(--mut);cursor:pointer}
nav.tabs button.active{color:var(--navy)}nav.tabs button .ic{display:block;font-size:19px}
.stars{color:var(--amber);font-size:14px}
.hide{display:none!important}
.seg{display:flex;border:1px solid var(--line);border-radius:10px;overflow:hidden}
.seg button{flex:1;padding:10px;background:#fff;border:0;font-weight:700;cursor:pointer;font-size:14px}
.seg button.active{background:var(--navy);color:#fff}
footer{max-width:860px;margin:0 auto;padding:8px 14px 20px}
`;

const SHELL = `<!DOCTYPE html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Naptivity — RV, Camper & Boat Rentals</title>
<meta name="description" content="Rent RVs, camper vans, bus conversions, boats and yachts from local hosts. Stationary stays or road trips, priced transparently.">
<meta name="theme-color" content="#0d2233">
<link rel="manifest" href="/manifest.webmanifest">
<link rel="icon" href="/icon-192.png">
<link rel="apple-touch-icon" href="/icon-192.png">
<style>${CSS}</style>
</head>
<body>
<header>
  <div class="logo">Napt<span>ivity</span></div>
  <div class="tag">RVs · camper vans · boats — rent the adventure, skip the purchase.</div>
</header>
<main id="app"><div class="card">Loading…</div></main>
<footer>
  <p class="note"><strong>Honest fine print:</strong> Naptivity is a marketplace, not an insurer or rental company.
  Naptivity does <strong>not</strong> provide insurance, licensing, registration, or roadside assistance.
  Hosts must attest that their own insurance and permits allow renting their unit; renters are responsible for
  verifying their own coverage before any trip. Prices shown are estimates until a booking is confirmed;
  movable rentals settle mileage and fuel at return from actual readings.</p>
</footer>
<nav class="tabs" id="tabs">
  <button data-view="explore" class="active"><span class="ic">🧭</span>Explore</button>
  <button data-view="trips"><span class="ic">🧳</span>Trips</button>
  <button data-view="host"><span class="ic">🔑</span>Host</button>
  <button data-view="account"><span class="ic">👤</span>Account</button>
</nav>
<script>
"use strict";
/* __CLIENT_JS__ */
</script>
</body></html>`;

const CLIENT_JS = `
var $app = document.getElementById("app");
var state = { me: null, view: "explore", listings: [], detail: null };
var TYPE_ICON = { rv: "🚐", camper_van: "🚐", bus_conversion: "🚌", travel_trailer: "🏕️", boat: "⛵", yacht: "🛥️", houseboat: "🏠" };
var TYPE_LABEL = { rv: "RV / Motorhome", camper_van: "Camper Van", bus_conversion: "Bus Conversion", travel_trailer: "Travel Trailer", boat: "Boat", yacht: "Yacht", houseboat: "Houseboat" };
function money(c) { return "$" + (Number(c || 0) / 100).toFixed(2); }
function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
function todayPlus(days) { var d = new Date(Date.now() + days * 86400000); return d.toISOString().slice(0, 10); }
function api(path, opts) {
  opts = opts || {};
  return fetch(path, { method: opts.method || "GET", headers: { "Content-Type": "application/json" }, body: opts.body ? JSON.stringify(opts.body) : undefined, credentials: "same-origin" })
    .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok) throw new Error(j.error || ("HTTP " + r.status)); return j; }); });
}
function toast(msg, cls) { var d = document.createElement("div"); d.className = cls || "okbox"; d.textContent = msg; $app.prepend(d); setTimeout(function () { d.remove(); }, 5000); window.scrollTo(0, 0); }
function modeChips(l) {
  var out = "";
  if (l.rental_mode === "stationary_only") out += '<span class="chip green">🏠 Stationary stay</span>';
  if (l.rental_mode === "movable") out += '<span class="chip amber">🛣️ Road trip</span>';
  if (l.rental_mode === "both") out += '<span class="chip green">🏠 Stationary</span><span class="chip amber">🛣️ or Road trip</span>';
  if (l.instant_book) out += '<span class="chip">⚡ Instant book</span>';
  return out;
}
function setView(v) {
  state.view = v;
  document.querySelectorAll("#tabs button").forEach(function (b) { b.classList.toggle("active", b.dataset.view === v); });
  if (v === "explore") renderExplore();
  if (v === "trips") renderTrips();
  if (v === "host") renderHost();
  if (v === "account") renderAccount();
}
document.querySelectorAll("#tabs button").forEach(function (b) { b.addEventListener("click", function () { setView(b.dataset.view); }); });

/* ---------------- EXPLORE ---------------- */
function renderExplore() {
  $app.innerHTML =
    '<h1>Rent the adventure.</h1>' +
    '<p class="note">Campers, RVs, bus conversions, boats and yachts owned by people near you. ' +
    'Park it and stay put — or take it on the road. Every price shows its math.</p>' +
    '<div class="card"><div class="row">' +
    '<div><label>Search</label><input id="f-q" placeholder="City, lake, marina…"></div>' +
    '<div><label>Type</label><select id="f-type"><option value="">All types</option>' +
    Object.keys(TYPE_LABEL).map(function (t) { return '<option value="' + t + '">' + TYPE_LABEL[t] + "</option>"; }).join("") + "</select></div></div>" +
    '<div class="row"><div><label>Rental style</label><select id="f-mode"><option value="">Either</option><option value="stationary">Stationary stay</option><option value="movable">Road trip</option></select></div>' +
    '<div><label>From</label><input id="f-start" type="date"></div><div><label>To</label><input id="f-end" type="date"></div></div>' +
    '<p style="margin:12px 0 0"><button class="btn navy" id="f-go">Search rentals</button></p></div>' +
    '<div id="results"><div class="card">Loading rentals…</div></div>';
  document.getElementById("f-go").addEventListener("click", loadListings);
  loadListings();
}
function loadListings() {
  var q = new URLSearchParams();
  [["q", "f-q"], ["type", "f-type"], ["mode", "f-mode"], ["start", "f-start"], ["end", "f-end"]].forEach(function (p) {
    var el = document.getElementById(p[1]); if (el && el.value) q.set(p[0], el.value);
  });
  api("/api/listings?" + q.toString()).then(function (j) {
    state.listings = j.listings;
    var box = document.getElementById("results");
    if (!j.listings.length) { box.innerHTML = '<div class="card">No rentals match. Try widening the dates or clearing filters.</div>'; return; }
    box.innerHTML = j.listings.map(function (l) {
      var photo = l.photos && l.photos.length ? '<img src="' + esc(l.photos[0]) + '" alt="">' : '<div class="ph">' + (TYPE_ICON[l.type] || "🚐") + "</div>";
      return '<div class="card listing" data-id="' + l.id + '">' + photo + '<div><strong>' + esc(l.title) + '</strong>' +
        '<div class="meta">' + esc(TYPE_LABEL[l.type] || l.type) + " · " + esc(l.location_text) + " · Sleeps " + l.sleeps + "</div>" +
        '<div style="margin:4px 0">' + modeChips(l) + "</div>" +
        '<span class="price">' + money(l.nightly_rate_cents) + "</span> <span class='meta'>/ night</span>" +
        (l.rating_avg ? ' <span class="stars">★ ' + l.rating_avg + "</span> <span class='meta'>(" + l.rating_count + ")</span>" : "") +
        "</div></div>";
    }).join("");
    box.querySelectorAll(".listing").forEach(function (el) { el.addEventListener("click", function () { openListing(el.dataset.id); }); });
  }).catch(function (e) { document.getElementById("results").innerHTML = '<div class="err">' + esc(e.message) + "</div>"; });
}

/* ---------------- LISTING DETAIL + BOOKING ---------------- */
function openListing(id) {
  api("/api/listings/" + id).then(function (j) {
    var l = j.listing; state.detail = l;
    var modes = l.rental_mode === "both" ? ["stationary", "movable"] : l.rental_mode === "stationary_only" ? ["stationary"] : ["movable"];
    var photo = l.photos && l.photos.length ? '<img src="' + esc(l.photos[0]) + '" style="width:100%;height:230px;object-fit:cover;border-radius:12px" alt="">' : '<div class="ph" style="width:100%;height:180px;font-size:56px">' + (TYPE_ICON[l.type] || "🚐") + "</div>";
    $app.innerHTML =
      '<p><a href="#" id="back">← All rentals</a></p>' + photo +
      '<h1>' + esc(l.title) + "</h1>" +
      '<p class="note">' + esc(TYPE_LABEL[l.type] || l.type) + " · " + esc(l.location_text) + " · Sleeps " + l.sleeps + " · Hosted by " + esc(l.host_name || "host") + "</p>" +
      "<div>" + modeChips(l) + "</div>" +
      '<div class="card"><p style="margin:0;line-height:1.55">' + esc(l.description) + "</p>" +
      (l.amenities && l.amenities.length ? '<p style="margin:10px 0 0">' + l.amenities.map(function (a) { return '<span class="chip">' + esc(a) + "</span>"; }).join("") + "</p>" : "") + "</div>" +
      '<div class="card"><h3 style="margin-top:0">Book this ' + (l.type === "boat" || l.type === "yacht" || l.type === "houseboat" ? "stay" : "trip") + "</h3>" +
      '<label>How will you use it?</label><div class="seg" id="b-modes">' +
      modes.map(function (m, i) { return '<button data-m="' + m + '" class="' + (i === 0 ? "active" : "") + '">' + (m === "stationary" ? "🏠 Stationary" : "🛣️ Road trip") + "</button>"; }).join("") + "</div>" +
      '<div class="row"><div><label>Start</label><input id="b-start" type="date" value="' + todayPlus(7) + '"></div>' +
      '<div><label>End</label><input id="b-end" type="date" value="' + todayPlus(10) + '"></div></div>' +
      '<div id="b-miles-wrap"><label>Expected miles (road trip)</label><input id="b-miles" type="number" min="0" value="450">' +
      '<p class="note">Included: ' + l.included_miles_per_day + ' mi/day. Extra miles are ' + money(l.overage_cents_per_mile) + '/mi. ' +
      'The final bill uses the actual odometer at return; fuel follows the "' + esc(l.fuel_policy) + '" policy (' + money(l.fuel_shortfall_cents_per_gallon) + '/gal shortfall).</p></div>' +
      '<div id="b-estimate"><p class="note">Pick dates to see the full price breakdown.</p></div>' +
      '<button class="btn" id="b-book">Request to book</button>' +
      '<p class="note">' + (l.instant_book ? "⚡ Instant book — confirmed immediately." : "The host approves requests before anything is charged.") +
      " Security deposit: " + money(l.deposit_cents) + " (authorization hold at pickup, not a charge).</p>" +
      '<div class="warn"><strong>Insurance &amp; licensing:</strong> Naptivity does not provide insurance, licensing, or roadside assistance. ' +
      "The host has attested their coverage and permits allow this rental. Verify your own coverage before the trip.</div></div>" +
      '<div class="card"><h3 style="margin-top:0">Ask the host</h3><textarea id="inq-body" placeholder="Dates, questions, plans…"></textarea>' +
      '<p style="margin:10px 0 0"><button class="btn ghost small" id="inq-send">Send inquiry</button></p></div>' +
      '<div id="reviews"></div>';
    document.getElementById("back").addEventListener("click", function (e) { e.preventDefault(); setView("explore"); });
    var mode = modes[0];
    function syncMode() {
      document.getElementById("b-miles-wrap").classList.toggle("hide", mode !== "movable");
      refreshQuote();
    }
    document.querySelectorAll("#b-modes button").forEach(function (b) {
      b.addEventListener("click", function () {
        mode = b.dataset.m;
        document.querySelectorAll("#b-modes button").forEach(function (x) { x.classList.toggle("active", x === b); });
        syncMode();
      });
    });
    ["b-start", "b-end", "b-miles"].forEach(function (id2) { document.getElementById(id2).addEventListener("change", refreshQuote); });
    function refreshQuote() {
      var body = { listing_id: l.id, mode: mode, start_date: document.getElementById("b-start").value, end_date: document.getElementById("b-end").value, expected_miles: Number(document.getElementById("b-miles").value || 0) };
      api("/api/quote", { method: "POST", body: body }).then(function (q) {
        document.getElementById("b-estimate").innerHTML = estimateHtml(q.estimate);
      }).catch(function (e) { document.getElementById("b-estimate").innerHTML = '<div class="err">' + esc(e.message) + "</div>"; });
    }
    document.getElementById("b-book").addEventListener("click", function () {
      if (!state.me) { setView("account"); toast("Log in or create an account to book.", "warn"); return; }
      var body = { listing_id: l.id, mode: mode, start_date: document.getElementById("b-start").value, end_date: document.getElementById("b-end").value, expected_miles: Number(document.getElementById("b-miles").value || 0), demo_test_card: true };
      api("/api/bookings", { method: "POST", body: body }).then(function (j) {
        if (j.payment && j.payment.url) { toast("Booking created — redirecting to secure checkout…"); location.href = j.payment.url; return; }
        toast(j.booking.status === "confirmed" ? "Booked! Find it under Trips." : "Request sent — the host will confirm. Track it under Trips.");
        setView("trips");
      }).catch(function (e) { toast(e.message, "err"); });
    });
    document.getElementById("inq-send").addEventListener("click", function () {
      if (!state.me) { setView("account"); toast("Log in to message the host.", "warn"); return; }
      api("/api/inquiries", { method: "POST", body: { listing_id: l.id, body: document.getElementById("inq-body").value } })
        .then(function () { toast("Inquiry sent to the host."); document.getElementById("inq-body").value = ""; })
        .catch(function (e) { toast(e.message, "err"); });
    });
    api("/api/listings/" + id + "/reviews").then(function (j) {
      if (!j.reviews.length) return;
      document.getElementById("reviews").innerHTML = '<div class="card"><h3 style="margin-top:0">Reviews</h3>' + j.reviews.map(function (r) {
        return '<p style="margin:6px 0"><span class="stars">' + "★".repeat(r.rating) + '</span> <span class="note">' + esc(r.author_name || "") + '</span><br>' + esc(r.body) + "</p>";
      }).join("") + "</div>";
    }).catch(function () {});
    syncMode();
  }).catch(function (e) { toast(e.message, "err"); });
}
function estimateHtml(q) {
  var rows = q.lines.map(function (ln) { return "<tr><td>" + esc(ln.label) + "</td><td>" + (ln.cents ? money(ln.cents) : "Included") + "</td></tr>"; }).join("");
  return '<table class="lines">' + rows +
    '<tr><td class="total">' + (q.mode === "movable" ? "Estimated total" : "Total") + '</td><td class="total">' + money(q.totalCents) + "</td></tr></table>" +
    '<p class="note">Platform fee (' + q.platformFeePct + '%) is paid by the host out of their payout (' + money(q.platformFeeCents) + ") — it is never added to your total. " +
    "Deposit " + money(q.depositCents) + " is a hold, not a charge." + (q.fuelNote ? " " + esc(q.fuelNote) : "") +
    (q.mileageIgnored ? " Miles are not charged on stationary stays." : "") + "</p>";
}
`;

const CLIENT_JS_2 = `
/* ---------------- TRIPS ---------------- */
function renderTrips() {
  if (!state.me) { renderAccount("Log in to see your trips."); return; }
  $app.innerHTML = "<h1>Your trips</h1><div id='trips'><div class='card'>Loading…</div></div>";
  api("/api/bookings/mine").then(function (j) {
    var box = document.getElementById("trips");
    if (!j.bookings.length) { box.innerHTML = '<div class="card">No trips yet. Find something with wheels (or a hull) under Explore.</div>'; return; }
    box.innerHTML = j.bookings.map(function (b) {
      var canReview = b.status === "completed" && !b.my_review_done;
      return '<div class="card"><strong>' + esc(b.listing_title) + '</strong> <span class="chip">' + esc(b.status) + '</span>' +
        '<div class="meta note">' + esc(b.start_date) + " → " + esc(b.end_date) + " · " + b.nights + " nights · " + (b.mode === "movable" ? "🛣️ Road trip" : "🏠 Stationary") + "</div>" +
        (b.settled ? '<p class="note">Final total <strong>' + money(b.final_total_cents) + "</strong> (actual miles " + b.actual_miles + " · fuel " + money(b.fuel_cents || 0) + ")</p>"
          : '<p class="note">Estimated total <strong>' + money(b.total_cents) + "</strong>" + (b.mode === "movable" ? " — mileage &amp; fuel settle at return." : "") + "</p>") +
        (b.status === "pending" || b.status === "confirmed" ? '<button class="btn ghost small" data-cancel="' + b.id + '">Cancel booking</button>' : "") +
        (canReview ? '<div style="margin-top:10px"><label>Your review</label><select id="rv-stars-' + b.id + '"><option>5</option><option>4</option><option>3</option><option>2</option><option>1</option></select>' +
          '<textarea id="rv-body-' + b.id + '" placeholder="How was it?"></textarea><p style="margin:8px 0 0"><button class="btn small" data-review="' + b.id + '">Post review</button></p></div>' : "") +
        "</div>";
    }).join("");
    box.querySelectorAll("[data-cancel]").forEach(function (btn) { btn.addEventListener("click", function () {
      api("/api/bookings/" + btn.dataset.cancel + "/cancel", { method: "POST", body: {} }).then(function () { toast("Booking cancelled."); renderTrips(); }).catch(function (e) { toast(e.message, "err"); });
    }); });
    box.querySelectorAll("[data-review]").forEach(function (btn) { btn.addEventListener("click", function () {
      var id = btn.dataset.review;
      api("/api/bookings/" + id + "/reviews", { method: "POST", body: { rating: Number(document.getElementById("rv-stars-" + id).value), body: document.getElementById("rv-body-" + id).value } })
        .then(function () { toast("Review posted. Thanks!"); renderTrips(); }).catch(function (e) { toast(e.message, "err"); });
    }); });
  }).catch(function (e) { toast(e.message, "err"); });
}

/* ---------------- HOST ---------------- */
function renderHost() {
  if (!state.me) { renderAccount("Log in to host your rig, van, or boat."); return; }
  $app.innerHTML = "<h1>Host dashboard</h1><div id='host'><div class='card'>Loading…</div></div>";
  Promise.all([api("/api/host/earnings"), api("/api/host/listings"), api("/api/host/bookings"), api("/api/host/inquiries")]).then(function (rs) {
    var earn = rs[0], mine = rs[1].listings, books = rs[2].bookings, inqs = rs[3].inquiries;
    var html = '<div class="card"><h3 style="margin-top:0">Earnings</h3>' +
      '<p class="note">Booked host payouts (after the ' + 'platform fee): <span class="price">' + money(earn.payout_cents) + '</span> across ' + earn.booking_count + ' bookings.</p>' +
      (earn.stripe_account_id ? '<p class="note">Stripe Connect: <strong>on file</strong> — payouts route to your account.</p>'
        : '<p class="note">Stripe Connect: not set up — payouts are tracked as a platform balance until you connect.</p><button class="btn navy small" id="connect-btn">Set up payouts (Stripe test mode)</button>') +
      "</div>";
    html += '<div class="card"><h3 style="margin-top:0">Bookings inbox</h3>' + (books.length ? books.map(function (b) {
      return '<div style="border-top:1px solid var(--line);padding:10px 0"><strong>' + esc(b.listing_title) + '</strong> <span class="chip">' + esc(b.status) + '</span>' +
        '<div class="note">' + esc(b.renter_name || "") + " · " + esc(b.start_date) + " → " + esc(b.end_date) + " · " + (b.mode === "movable" ? "🛣️ Road trip" : "🏠 Stationary") + " · est. " + money(b.total_cents) + " · your payout " + money(b.host_payout_cents) + "</div>" +
        (b.status === "pending" ? '<button class="btn small" data-approve="' + b.id + '">Approve</button> <button class="btn ghost small" data-decline="' + b.id + '">Decline</button>' : "") +
        (b.status === "confirmed" && b.mode === "movable" ? '<div class="row"><div><label>Pickup odometer</label><input type="number" id="odo-' + b.id + '"></div></div><p style="margin:8px 0 0"><button class="btn navy small" data-pickup="' + b.id + '">Record pickup</button></p>' : "") +
        (b.status === "confirmed" && b.mode === "stationary" ? '<p style="margin:8px 0 0"><button class="btn navy small" data-checkin="' + b.id + '">Check in (start stay)</button></p>' : "") +
        (b.status === "active" && b.mode === "movable" ? '<div class="row"><div><label>Return odometer</label><input type="number" id="rodo-' + b.id + '"></div><div><label>Fuel shortfall (gal)</label><input type="number" step="0.1" min="0" id="fuel-' + b.id + '" value="0"></div></div><p style="margin:8px 0 0"><button class="btn small" data-return="' + b.id + '">Record return &amp; settle</button></p>' : "") +
        (b.status === "active" && b.mode === "stationary" ? '<p style="margin:8px 0 0"><button class="btn small" data-checkout="' + b.id + '">Check out (end stay)</button></p>' : "") +
        (b.settled ? '<p class="note">Settled: final ' + money(b.final_total_cents) + " · actual miles " + b.actual_miles + " · fuel " + money(b.fuel_cents || 0) + "</p>" : "") +
        "</div>";
    }).join("") : '<p class="note">No bookings yet.</p>') + "</div>";
    html += '<div class="card"><h3 style="margin-top:0">Inquiries</h3>' + (inqs.length ? inqs.map(function (q) {
      return '<div style="border-top:1px solid var(--line);padding:10px 0"><strong>' + esc(q.listing_title) + '</strong><p style="margin:4px 0">' + esc(q.body) + '</p>' +
        (q.reply_body ? '<p class="note">Your reply: ' + esc(q.reply_body) + "</p>" :
          '<textarea id="inq-reply-' + q.id + '" placeholder="Reply…"></textarea><p style="margin:8px 0 0"><button class="btn ghost small" data-draft="' + q.id + '">✨ Draft with AI</button> <button class="btn small" data-send-reply="' + q.id + '">Save reply</button></p>') + "</div>";
    }).join("") : '<p class="note">No inquiries yet.</p>') + "</div>";
    html += '<div class="card"><h3 style="margin-top:0">Your listings</h3>' + (mine.length ? mine.map(function (l) {
      return '<p style="margin:6px 0"><strong>' + esc(l.title) + '</strong> <span class="note">' + money(l.nightly_rate_cents) + "/night · " + esc(l.rental_mode) + '</span> <button class="btn ghost small" data-edit="' + l.id + '">Edit</button></p>';
    }).join("") : '<p class="note">None yet — list your first unit below.</p>') + "</div>";
    html += listingFormHtml(null);
    document.getElementById("host").innerHTML = html;
    wireHost(rs);
  }).catch(function (e) { toast(e.message, "err"); });
}
function wireHost(rs) {
  var cb = document.getElementById("connect-btn");
  if (cb) cb.addEventListener("click", function () {
    api("/api/host/connect", { method: "POST", body: {} }).then(function (j) {
      if (j.url) { toast("Opening Stripe Connect onboarding (test mode)…"); location.href = j.url; }
      else toast(j.message || "Stripe is not configured on this deployment yet.", "warn");
      renderHost();
    }).catch(function (e) { toast(e.message, "err"); });
  });
  var host = document.getElementById("host");
  function act(sel, fn) { host.querySelectorAll(sel).forEach(function (b) { b.addEventListener("click", function () { fn(b); }); }); }
  act("[data-approve]", function (b) { api("/api/bookings/" + b.dataset.approve + "/approve", { method: "POST", body: {} }).then(function () { toast("Approved."); renderHost(); }).catch(function (e) { toast(e.message, "err"); }); });
  act("[data-decline]", function (b) { api("/api/bookings/" + b.dataset.decline + "/decline", { method: "POST", body: {} }).then(function () { toast("Declined."); renderHost(); }).catch(function (e) { toast(e.message, "err"); }); });
  act("[data-pickup]", function (b) { api("/api/bookings/" + b.dataset.pickup + "/pickup", { method: "POST", body: { odometer: Number(document.getElementById("odo-" + b.dataset.pickup).value) } }).then(function () { toast("Pickup recorded."); renderHost(); }).catch(function (e) { toast(e.message, "err"); }); });
  act("[data-checkin]", function (b) { api("/api/bookings/" + b.dataset.checkin + "/pickup", { method: "POST", body: {} }).then(function () { toast("Stay started."); renderHost(); }).catch(function (e) { toast(e.message, "err"); }); });
  act("[data-return]", function (b) { api("/api/bookings/" + b.dataset.return + "/return", { method: "POST", body: { odometer: Number(document.getElementById("rodo-" + b.dataset.return).value), fuel_shortfall_gallons: Number(document.getElementById("fuel-" + b.dataset.return).value || 0) } }).then(function (j) { toast("Settled: final total " + money(j.settlement.finalTotalCents) + " (delta " + money(j.settlement.deltaCents) + ")."); renderHost(); }).catch(function (e) { toast(e.message, "err"); }); });
  act("[data-checkout]", function (b) { api("/api/bookings/" + b.dataset.checkout + "/return", { method: "POST", body: {} }).then(function () { toast("Stay completed."); renderHost(); }).catch(function (e) { toast(e.message, "err"); }); });
  act("[data-draft]", function (b) { api("/api/ai/reply-draft", { method: "POST", body: { inquiry_id: b.dataset.draft } }).then(function (j) { document.getElementById("inq-reply-" + b.dataset.draft).value = j.draft.text; toast("Draft ready (" + j.draft.source + ") — edit before saving."); }).catch(function (e) { toast(e.message, "err"); }); });
  act("[data-send-reply]", function (b) { api("/api/inquiries/" + b.dataset.sendReply + "/reply", { method: "POST", body: { reply_body: document.getElementById("inq-reply-" + b.dataset.sendReply).value } }).then(function () { toast("Reply saved."); renderHost(); }).catch(function (e) { toast(e.message, "err"); }); });
  act("[data-edit]", function (b) {
    var l = rs[1].listings.find(function (x) { return x.id === b.dataset.edit; });
    document.getElementById("listing-form-wrap").innerHTML = listingFormHtml(l);
    wireListingForm(l);
    window.scrollTo(0, document.getElementById("listing-form-wrap").offsetTop);
  });
  wireListingForm(null);
}
function listingFormHtml(l) {
  l = l || {};
  function v(k, d) { return l[k] != null ? l[k] : d; }
  function dollars(k, d) { return l[k] != null ? (l[k] / 100) : d; }
  return '<div id="listing-form-wrap"><div class="card"><h3 style="margin-top:0">' + (l.id ? "Edit listing" : "List a unit") + '</h3>' +
    '<input type="hidden" id="lf-id" value="' + (l.id || "") + '">' +
    '<label>Title</label><input id="lf-title" value="' + esc(v("title", "")) + '">' +
    '<div class="row"><div><label>Type</label><select id="lf-type">' + Object.keys(TYPE_LABEL).map(function (t) { return '<option value="' + t + '"' + (v("type", "camper_van") === t ? " selected" : "") + ">" + TYPE_LABEL[t] + "</option>"; }).join("") + '</select></div>' +
    '<div><label>Location</label><input id="lf-loc" value="' + esc(v("location_text", "")) + '"></div></div>' +
    '<div class="row"><div><label>Sleeps</label><input id="lf-sleeps" type="number" min="1" value="' + v("sleeps", 2) + '"></div>' +
    '<div><label>Nightly rate ($)</label><input id="lf-nightly" type="number" min="1" value="' + dollars("nightly_rate_cents", 120) + '"></div></div>' +
    '<label>Rental mode</label><select id="lf-mode"><option value="both">Both — renter chooses</option><option value="stationary_only">Stationary only (stand-still)</option><option value="movable">Movable only (road trip)</option></select>' +
    '<label>Description</label><textarea id="lf-desc">' + esc(v("description", "")) + '</textarea>' +
    '<p style="margin:6px 0"><button class="btn ghost small" id="lf-polish" type="button">✨ Polish with AI (uses only your facts)</button> ' +
    '<button class="btn ghost small" id="lf-suggest" type="button">💲 Suggest a price</button></p><div id="lf-suggest-out"></div>' +
    '<label>Amenities (comma separated)</label><input id="lf-amen" value="' + esc((l.amenities || []).join(", ")) + '">' +
    '<label>Photo URL (optional)</label><input id="lf-photo" value="' + esc((l.photos && l.photos[0]) || "") + '">' +
    '<h3>Stationary pricing</h3><div class="row"><div><label>Delivery/setup fee ($)</label><input id="lf-delivery" type="number" min="0" value="' + dollars("delivery_fee_cents", 0) + '"></div>' +
    '<div><label>Site fee / night ($)</label><input id="lf-site" type="number" min="0" value="' + dollars("site_fee_cents", 0) + '"></div></div>' +
    '<h3>Road-trip pricing</h3><div class="row"><div><label>Included miles / day</label><input id="lf-miles" type="number" min="0" value="' + v("included_miles_per_day", 100) + '"></div>' +
    '<div><label>Overage ($ / mile)</label><input id="lf-over" type="number" step="0.01" min="0" value="' + dollars("overage_cents_per_mile", 0.65) + '"></div></div>' +
    '<div class="row"><div><label>Fuel policy</label><select id="lf-fuel"><option value="return_full">Return with full tank</option><option value="per_gallon">Charge per gallon short</option></select></div>' +
    '<div><label>Fuel shortfall ($ / gal)</label><input id="lf-fuelrate" type="number" step="0.01" min="0" value="' + dollars("fuel_shortfall_cents_per_gallon", 5.5) + '"></div></div>' +
    '<div class="row"><div><label>Cleaning fee ($)</label><input id="lf-clean" type="number" min="0" value="' + dollars("cleaning_fee_cents", 50) + '"></div>' +
    '<div><label>Security deposit ($)</label><input id="lf-deposit" type="number" min="0" value="' + dollars("deposit_cents", 500) + '"></div></div>' +
    '<label><input type="checkbox" id="lf-instant" style="width:auto" ' + (l.instant_book ? "checked" : "") + '> Instant book</label>' +
    '<div class="warn"><label><input type="checkbox" id="lf-ins" style="width:auto" ' + (l.insurance_attested ? "checked" : "") + '> I attest my insurance allows renting this unit</label>' +
    '<label><input type="checkbox" id="lf-lic" style="width:auto" ' + (l.license_attested ? "checked" : "") + '> I attest I hold any licenses/permits required to rent it out</label>' +
    '<p class="note" style="margin:6px 0 0">Naptivity provides no insurance or licensing — these attestations are your responsibility as host.</p></div>' +
    '<p style="margin:12px 0 0"><button class="btn" id="lf-save">Save listing</button></p></div></div>';
}
function wireListingForm(l) {
  var modeSel = document.getElementById("lf-mode");
  if (l && l.rental_mode) modeSel.value = l.rental_mode;
  var fuelSel = document.getElementById("lf-fuel");
  if (l && l.fuel_policy) fuelSel.value = l.fuel_policy;
  function num(id) { return Number(document.getElementById(id).value || 0); }
  function cents(id) { return Math.round(num(id) * 100); }
  document.getElementById("lf-suggest").addEventListener("click", function () {
    api("/api/ai/suggest-price", { method: "POST", body: { type: document.getElementById("lf-type").value, rental_mode: modeSel.value, sleeps: num("lf-sleeps") } })
      .then(function (j) { document.getElementById("lf-suggest-out").innerHTML = '<div class="okbox">Suggested nightly: <strong>' + money(j.suggestion.lowCents) + " – " + money(j.suggestion.highCents) + '</strong> (mid ' + money(j.suggestion.midCents) + ')<br><span class="note">' + esc(j.suggestion.basis) + "</span></div>"; })
      .catch(function (e) { toast(e.message, "err"); });
  });
  document.getElementById("lf-polish").addEventListener("click", function () {
    var id = document.getElementById("lf-id").value;
    if (!id) { toast("Save the listing first, then polish its description.", "warn"); return; }
    api("/api/ai/polish", { method: "POST", body: { listing_id: id } }).then(function (j) {
      document.getElementById("lf-desc").value = j.polished.text; toast("Polished (" + j.polished.source + ") — review, then Save.");
    }).catch(function (e) { toast(e.message, "err"); });
  });
  document.getElementById("lf-save").addEventListener("click", function () {
    var body = {
      title: document.getElementById("lf-title").value, type: document.getElementById("lf-type").value,
      location_text: document.getElementById("lf-loc").value, sleeps: num("lf-sleeps"),
      nightly_rate_cents: cents("lf-nightly"), rental_mode: modeSel.value,
      description: document.getElementById("lf-desc").value,
      amenities: document.getElementById("lf-amen").value.split(",").map(function (s) { return s.trim(); }).filter(Boolean),
      photos: document.getElementById("lf-photo").value ? [document.getElementById("lf-photo").value] : [],
      delivery_fee_cents: cents("lf-delivery"), site_fee_cents: cents("lf-site"),
      included_miles_per_day: num("lf-miles"), overage_cents_per_mile: cents("lf-over"),
      fuel_policy: fuelSel.value, fuel_shortfall_cents_per_gallon: cents("lf-fuelrate"),
      cleaning_fee_cents: cents("lf-clean"), deposit_cents: cents("lf-deposit"),
      instant_book: document.getElementById("lf-instant").checked,
      insurance_attested: document.getElementById("lf-ins").checked,
      license_attested: document.getElementById("lf-lic").checked,
    };
    var id = document.getElementById("lf-id").value;
    api(id ? "/api/listings/" + id : "/api/listings", { method: id ? "PATCH" : "POST", body: body })
      .then(function () { toast("Listing saved."); renderHost(); }).catch(function (e) { toast(e.message, "err"); });
  });
}

/* ---------------- ACCOUNT ---------------- */
function renderAccount(msg) {
  if (state.me) {
    $app.innerHTML = "<h1>Account</h1><div class='card'><p><strong>" + esc(state.me.name) + "</strong><br><span class='note'>" + esc(state.me.email) + "</span></p>" +
      '<button class="btn ghost" id="logout">Log out</button></div>';
    document.getElementById("logout").addEventListener("click", function () {
      api("/api/auth/logout", { method: "POST", body: {} }).then(function () { state.me = null; toast("Logged out."); setView("explore"); });
    });
    return;
  }
  $app.innerHTML = "<h1>Welcome</h1>" + (msg ? '<div class="warn">' + esc(msg) + "</div>" : "") +
    '<div class="card"><div class="seg" id="auth-seg"><button data-a="login" class="active">Log in</button><button data-a="register">Create account</button></div>' +
    '<div id="auth-name-wrap" class="hide"><label>Name</label><input id="a-name" autocomplete="name"></div>' +
    '<label>Email</label><input id="a-email" type="email" autocomplete="email">' +
    '<label>Password</label><input id="a-pass" type="password" autocomplete="current-password">' +
    '<p style="margin:14px 0 0"><button class="btn" id="a-go">Log in</button></p>' +
    '<p class="note">Demo accounts (seeded): host@demo.naptivity.app / demo-host-2026 · renter@demo.naptivity.app / demo-renter-2026</p></div>';
  var modeA = "login";
  document.querySelectorAll("#auth-seg button").forEach(function (b) { b.addEventListener("click", function () {
    modeA = b.dataset.a;
    document.querySelectorAll("#auth-seg button").forEach(function (x) { x.classList.toggle("active", x === b); });
    document.getElementById("auth-name-wrap").classList.toggle("hide", modeA === "login");
    document.getElementById("a-go").textContent = modeA === "login" ? "Log in" : "Create account";
  }); });
  document.getElementById("a-go").addEventListener("click", function () {
    var body = { email: document.getElementById("a-email").value, password: document.getElementById("a-pass").value, name: document.getElementById("a-name").value };
    api("/api/auth/" + (modeA === "login" ? "login" : "register"), { method: "POST", body: body }).then(function (j) {
      state.me = j.user; toast("Welcome, " + j.user.name + "!"); setView("explore");
    }).catch(function (e) { toast(e.message, "err"); });
  });
}

/* ---------------- INIT ---------------- */
if ("serviceWorker" in navigator) { navigator.serviceWorker.register("/sw.js").catch(function () {}); }
api("/api/auth/me").then(function (j) { state.me = j.user || null; }).catch(function () {}).then(function () { renderExplore(); });
`;

// ---------------------------------------------------------------------------
// SECTION: EXPORT — shell with the client bundle inlined.
// ---------------------------------------------------------------------------
export function renderAppHtml() {
  return SHELL.replace("/* __CLIENT_JS__ */", CLIENT_JS + "\n" + CLIENT_JS_2);
}
