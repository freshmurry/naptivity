// ============================================================================
// stripe.js — Stripe payments (TEST MODE) + Connect host payouts
// ============================================================================
// Design rules:
//  - The secret key is read from env.STRIPE_SECRET_KEY (a Worker secret) and
//    is NEVER logged, returned, or embedded in any response. Only its mode
//    prefix is inspected to label the integration test vs live.
//  - Unconfigured is a first-class state: every function degrades to a
//    structured { configured: false } result and bookings keep working in
//    "payments not configured" demo mode.
//  - Renter pays the platform via Checkout. The platform fee is taken as a
//    Connect application fee and the remainder is transferred to the host's
//    connected account — but ONLY when the host has completed Connect
//    onboarding; otherwise the charge is platform-only and the payout is a
//    recorded balance owed (stated honestly in the booking record).
//  - The security deposit is a manual-capture PaymentIntent (an authorization
//    hold, not a charge). A hold needs a payment method; in test mode the UI
//    passes Stripe's test payment method (pm_card_visa). Without one, the
//    hold is recorded as not created — production needs Stripe.js Elements
//    to collect the card, listed as a known gap in BUILD-LOG.md.
// ============================================================================

const API = "https://api.stripe.com/v1";

export function stripeState(env) {
  const key = (env && env.STRIPE_SECRET_KEY) || "";
  if (!key) return { configured: false, mode: null };
  return { configured: true, mode: key.startsWith("sk_test_") ? "test" : key.startsWith("sk_live_") ? "live" : "unknown" };
}

function encode(params, prefix, out) {
  out = out || [];
  for (const [k, v] of Object.entries(params || {})) {
    if (v === undefined || v === null) continue;
    const key = prefix ? prefix + "[" + k + "]" : k;
    if (Array.isArray(v)) {
      v.forEach((item, i) => {
        if (item && typeof item === "object") encode(item, key + "[" + i + "]", out);
        else out.push(key + "[" + i + "]=" + encodeURIComponent(String(item)));
      });
    } else if (typeof v === "object") {
      encode(v, key, out);
    } else {
      // Keys are composed by this module only (Stripe bracket syntax stays
      // literal); values are always encoded.
      out.push(key + "=" + encodeURIComponent(String(v)));
    }
  }
  return out;
}

async function stripePost(env, path, params) {
  const res = await fetch(API + path, {
    method: "POST",
    headers: {
      "Authorization": "Bearer " + env.STRIPE_SECRET_KEY,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: encode(params).join("&"),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error("Stripe " + path + " failed: " + ((data.error && data.error.message) || res.status));
  return data;
}

// ---------------------------------------------------------------------------
// SECTION: CHECKOUT — renter pays; fee + host transfer ride along when the
// host is Connect-onboarded.
// ---------------------------------------------------------------------------
export async function createCheckoutSession(env, { booking, listing, origin }) {
  if (!stripeState(env).configured) return { configured: false };
  const params = {
    mode: "payment",
    success_url: origin + "/?payment=success&booking=" + booking.id,
    cancel_url: origin + "/?payment=cancelled&booking=" + booking.id,
    "metadata": { booking_id: booking.id },
    line_items: [{
      quantity: 1,
      price_data: {
        currency: "usd",
        unit_amount: booking.total_cents,
        product_data: { name: "Naptivity rental — " + listing.title + " (" + booking.nights + " nights, " + booking.mode + ")" },
      },
    }],
  };
  const hostAccount = booking.host_stripe_account_id;
  if (hostAccount) {
    params.payment_intent_data = {
      application_fee_amount: booking.platform_fee_cents,
      transfer_data: { destination: hostAccount },
    };
  }
  const session = await stripePost(env, "/checkout/sessions", params);
  return { configured: true, sessionId: session.id, url: session.url, paymentIntentId: session.payment_intent || null, connectApplied: !!hostAccount };
}

// ---------------------------------------------------------------------------
// SECTION: DEPOSIT HOLD — manual-capture PaymentIntent (authorization only).
// ---------------------------------------------------------------------------
export async function createDepositHold(env, { booking, paymentMethodId }) {
  if (!stripeState(env).configured) return { status: "not_created", reason: "stripe_not_configured" };
  if (!booking.deposit_cents || booking.deposit_cents <= 0) return { status: "not_required", reason: "no_deposit" };
  if (!paymentMethodId) return { status: "not_created", reason: "no_payment_method_supplied" };
  try {
    const pi = await stripePost(env, "/payment_intents", {
      amount: booking.deposit_cents,
      currency: "usd",
      capture_method: "manual",
      payment_method: paymentMethodId,
      confirm: true,
      metadata: { booking_id: booking.id, kind: "security_deposit_hold" },
    });
    return { status: pi.status === "requires_capture" ? "authorized" : pi.status, paymentIntentId: pi.id };
  } catch (e) {
    return { status: "failed", reason: String(e.message || e).slice(0, 200) };
  }
}

// ---------------------------------------------------------------------------
// SECTION: CONNECT — host payout accounts (Express) + onboarding links.
// ---------------------------------------------------------------------------
export async function createConnectAccount(env, user) {
  if (!stripeState(env).configured) return { configured: false };
  const acct = await stripePost(env, "/accounts", {
    type: "express",
    email: user.email,
    capabilities: { transfers: { requested: true } },
    metadata: { user_id: user.id },
  });
  return { configured: true, accountId: acct.id };
}

export async function createAccountLink(env, accountId, origin) {
  if (!stripeState(env).configured) return { configured: false };
  const link = await stripePost(env, "/account_links", {
    account: accountId,
    type: "account_onboarding",
    refresh_url: origin + "/?connect=refresh",
    return_url: origin + "/?connect=done",
  });
  return { configured: true, url: link.url };
}

// ---------------------------------------------------------------------------
// SECTION: WEBHOOK — signature verification (HMAC-SHA256, 5-min tolerance).
// ---------------------------------------------------------------------------
export async function verifyWebhook(env, payload, sigHeader) {
  const secret = (env && env.STRIPE_WEBHOOK_SECRET) || "";
  if (!secret) return { verified: false, reason: "webhook_secret_not_configured" };
  const parts = {};
  for (const piece of String(sigHeader || "").split(",")) {
    const i = piece.indexOf("="); if (i > 0) parts[piece.slice(0, i).trim()] = piece.slice(i + 1).trim();
  }
  if (!parts.t || !parts.v1) return { verified: false, reason: "malformed_signature_header" };
  if (Math.abs(Date.now() / 1000 - Number(parts.t)) > 300) return { verified: false, reason: "timestamp_out_of_tolerance" };
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(parts.t + "." + payload));
  const hex = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
  let diff = 0; const a = hex, b = parts.v1;
  if (a.length !== b.length) return { verified: false, reason: "signature_mismatch" };
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0 ? { verified: true } : { verified: false, reason: "signature_mismatch" };
}
