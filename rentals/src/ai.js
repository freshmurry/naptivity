// ============================================================================
// ai.js — AI-native touches, grounded and labelled
// ============================================================================
// Three helpers, all constrained to facts the host/renter actually supplied:
//   1. polishDescription — rewrites a host's description using ONLY the
//      listing's real facts. The prompt forbids inventing amenities; if the
//      AI binding is unavailable, a deterministic template assembly from the
//      same facts is returned instead and labelled source: "template".
//   2. draftInquiryReply — a reply DRAFT for the host (never auto-sent).
//   3. (Price suggestions live in pricing.js suggestPrice — a transparent
//      heuristic, labelled an estimate, not ML.)
// Calls are rate-limited per user per day by the router (ai_calls table).
// ============================================================================

const MODEL = "@cf/meta/llama-3.1-8b-instruct";

async function runAI(env, system, user) {
  if (!env.AI) return null;
  try {
    const res = await env.AI.run(MODEL, {
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      max_tokens: 400,
      temperature: 0.4,
    });
    const text = (res && (res.response || res.text)) || "";
    return String(text).trim() || null;
  } catch {
    return null;
  }
}

function factsBlock(listing) {
  const amenities = safeJson(listing.amenities_json, []);
  return [
    "Type: " + listing.type,
    "Title: " + listing.title,
    "Location: " + listing.location_text,
    "Sleeps: " + listing.sleeps,
    "Rental mode: " + listing.rental_mode,
    "Amenities (complete list — do not add others): " + (amenities.join(", ") || "none listed"),
    "Host's draft description: " + (listing.description || "(none)"),
  ].join("\n");
}

export function safeJson(text, fallback) {
  try { const v = JSON.parse(text || ""); return v == null ? fallback : v; } catch { return fallback; }
}

// ---------------------------------------------------------------------------
// SECTION: DESCRIPTION POLISH
// ---------------------------------------------------------------------------
export async function polishDescription(env, listing) {
  const facts = factsBlock(listing);
  const ai = await runAI(env,
    "You polish rental listing descriptions. HARD RULES: use ONLY the facts given. " +
    "Never invent amenities, features, locations, or capabilities that are not listed. " +
    "Keep it under 120 words, warm and concrete, no hype words like 'luxury' unless the facts say so. " +
    "Return only the polished description text.",
    facts);
  if (ai) return { text: ai, source: "workers-ai" };
  const amenities = safeJson(listing.amenities_json, []);
  const text = (listing.description ? listing.description.trim() + " " : "") +
    "Sleeps " + listing.sleeps + " in " + listing.location_text + "." +
    (amenities.length ? " Amenities: " + amenities.join(", ") + "." : "") +
    (listing.rental_mode === "stationary_only"
      ? " This is a stationary stay — the unit stays in place for your whole visit."
      : listing.rental_mode === "movable"
        ? " This unit is rented for travel — take it on the road."
        : " Rent it stationary at a site, or take it on the road — your choice per booking.");
  return { text: text.trim(), source: "template" };
}

// ---------------------------------------------------------------------------
// SECTION: INQUIRY REPLY DRAFTS — for the host; never sent automatically.
// ---------------------------------------------------------------------------
export async function draftInquiryReply(env, listing, inquiryBody) {
  const facts = factsBlock(listing);
  const ai = await runAI(env,
    "You draft a short, friendly reply from a rental host to a prospective renter. " +
    "Use ONLY the listing facts given; if the renter asks about something not in the facts, " +
    "say you will confirm rather than inventing an answer. Under 90 words. Return only the draft.",
    facts + "\n\nRenter's message: " + inquiryBody);
  if (ai) return { text: ai, source: "workers-ai" };
  return {
    text: "Hi! Thanks for asking about \"" + listing.title + "\" in " + listing.location_text +
      ". It sleeps " + listing.sleeps + " and is available as " + listing.rental_mode.replace("_", " ") +
      ". Happy to answer anything else — and if you send your dates I can confirm availability right away.",
    source: "template",
  };
}
