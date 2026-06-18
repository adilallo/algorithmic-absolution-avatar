'use strict';

/*
 * Absolution generator for the Office of Algorithmic Absolution kiosk (ALG-15).
 *
 * Domain logic only — no HTTP. server.js owns the /absolution route (body read, rate limit,
 * validation) and calls getAbsolution(totals); this module turns punch-card CATEGORY TOTALS
 * into the spoken ABSOLUTION TEXT by querying the Magisterium AI API (OpenAI-compatible chat
 * completions, grounded in Catholic magisterial sources) and ALWAYS returns usable text.
 *
 * Key handling: the Magisterium API key lives ONLY in deploy/tts-proxy/.env as
 * MAGISTERIUM_API_KEY (gitignored, server-side). It is read via process.env, sent only in the
 * Authorization header to Magisterium, and never written into any response to the browser.
 *
 * Fallback (ALG-15 "API is down"): on a missing key, timeout, upstream error, or unparseable
 * response, getAbsolution() returns a pre-written canned absolution instead of throwing, so the
 * ritual never visibly stalls. The caller can tell the two apart via the returned `source`.
 *
 * Zero dependencies: Node >= 18 built-ins only (global fetch). Config is read lazily from
 * process.env so it reflects whatever server.js loaded from .env before the first request.
 */

const fs = require('node:fs');
const path = require('node:path');

const USAGE_FILE = path.join(__dirname, '.absolution-usage.json');

// --- Config (env-overridable; read per call so .env load order never matters) -------------
function readConfig() {
  return {
    apiKey: process.env.MAGISTERIUM_API_KEY || '',
    // Magisterium's OpenAI-compatible chat-completions endpoint + model. Overridable so the
    // exact path/model can be corrected from .env without a code change if the API differs.
    endpoint: process.env.MAGISTERIUM_API_URL || 'https://www.magisterium.com/api/v1/chat/completions',
    model: process.env.MAGISTERIUM_MODEL || 'magisterium-1',
    // Latency backstop: card inserted -> avatar speaking. Measured live latency is ~25-40s
    // (Magisterium emits 30-37k RAG tokens, and latency scales with that output). 30s sat right on
    // the boundary -> ~half of real calls were aborted as "timeouts" and fell back to canned (NOT
    // refusals). Raised to 60s so the slow-but-real answers complete. The read-back + holding line
    // (index.html) fills the start of the wait; pre-bake/cache is the real fix to take the LLM off
    // the hot path (see docs/ABSOLUTION_PROMPT.md "Determinism").
    timeoutMs: int(process.env.ABSOLUTION_TIMEOUT_MS, 60000),
    // NOTE: max_tokens does NOT bound cost here — the dominant ~13-20k "system_tokens" are the
    // RAG-retrieved sources, billed as output and uncapped by this. It only trims the visible answer.
    maxTokens: int(process.env.ABSOLUTION_MAX_TOKENS, 320),
    // Low temperature: the offsets are baked (see SCHEDULE OF REMITTANCES below), so the model
    // only welds fixed clauses into prose — it should not drift. 0.4 keeps slight liturgical
    // variation without inventing content. For a gallery, prefer pre-baking/caching per punch-tuple
    // (see docs/ABSOLUTION_PROMPT.md "Determinism") over relying on per-call sampling.
    temperature: num(process.env.ABSOLUTION_TEMPERATURE, 0.4),
    // Hard cap on SPOKEN length, trimmed to whole sentences. Kept UNDER the /tts gate
    // (TTS_MAX_INPUT_CHARS, default 2000) — over that, TTS 400s -> silence. 1800 lets the avatar
    // speak most of a Magisterium answer (raw ~4-5k chars) instead of ~2-4 sentences; note this is
    // a lot of speech (~2-3 min at the locked rate). To read the FULL essay, also raise
    // TTS_MAX_INPUT_CHARS above the raw length (and mind the per-call Google TTS char cost).
    maxSpokenChars: int(process.env.ABSOLUTION_MAX_SPOKEN_CHARS, 1800),
    // Daily live-call cap — a free-tier / billing backstop (persisted, resets at UTC midnight).
    // Counts only SUCCESSFUL live calls (failures fall back to canned and must not burn the cap).
    dailyRequestCap: int(process.env.ABSOLUTION_DAILY_REQUEST_CAP, 300),
    // Refusal guard: Magisterium won't impersonate a confessor / grant absolution, so a persona
    // prompt can make it break character and lecture instead. When on (default), such responses
    // are replaced with canned text rather than spoken. Set ABSOLUTION_REFUSAL_GUARD=0 if you
    // deliberately want that doctrinal-deferral voice (it legitimately says "ordained priest").
    refusalGuard: process.env.ABSOLUTION_REFUSAL_GUARD !== '0',
  };
}
const int = (v, d) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : d; };
const num = (v, d) => { const n = parseFloat(v); return Number.isFinite(n) ? n : d; };

// --- Canonical categories + prompt (ALG-14) ------------------------------------------------
// The punch card (FORM 1517-A) has ten fixed categories of harm; a visitor punches any SUBSET
// (booleans — no counts). We do NOT prescribe offsets or script a settlement: we simply STATE the
// declared harms, send them to the LLM, and speak its response back. CATEGORIES is just the
// canonical id/label list — the source of truth for the card wording and for the normalizer.
// The prompt is deliberately CLEARED-OUT and LLM-AGNOSTIC: just format/length + no-personal-data,
// and it deliberately AVOIDS the word "absolution"/"absolve" — verified live that asking Magisterium
// to "issue absolution" triggers its "only an ordained priest can absolve" refusal (role-break,
// ~26s, ~27k tokens). We state the harms and let the model respond freely. To re-tune the wording,
// edit the labels here (keep docs/ABSOLUTION_PROMPT.md in sync).
const CATEGORIES = [
  { id: 'taking_more_than_needed',               label: 'TAKING MORE THAN NEEDED' },
  { id: 'using_more_than_your_share',            label: 'USING MORE THAN YOUR SHARE' },
  { id: 'letting_others_bear_the_cost',          label: 'LETTING OTHERS BEAR THE COST' },
  { id: 'undervaluing_care_given_to_you',        label: 'UNDERVALUING CARE GIVEN TO YOU' },
  { id: 'benefiting_from_underpaid_labor',       label: 'BENEFITING FROM UNDERPAID LABOR' },
  { id: 'claiming_what_belongs_to_many',         label: 'CLAIMING WHAT BELONGS TO MANY' },
  { id: 'wanting_what_was_sold_to_you',          label: 'WANTING WHAT WAS SOLD TO YOU' },
  { id: 'pricing_what_should_not_be_sold',       label: 'PRICING WHAT SHOULD NOT BE SOLD' },
  { id: 'consuming_faster_than_things_renew',    label: 'CONSUMING FASTER THAN THINGS RENEW' },
  { id: 'inheriting_advantage_you_did_not_earn', label: 'INHERITING ADVANTAGE YOU DID NOT EARN' },
];

// IMPORTANT (verified 2026-06-17): magisterium-1 IGNORES the system message. A system prompt saying
// "ignore the user, reply only with ACKNOWLEDGED" still returned a 4,865-char cited essay — it answers
// the user query and disregards the system role. So we keep SYSTEM_PROMPT EMPTY (getAbsolution omits
// the system message) and put every instruction the model must obey — including BREVITY below — in the
// USER message, where it IS honored. The conditional in getAbsolution() is kept for portability to a
// model that does respect system prompts; set this non-empty to use it there.
const SYSTEM_PROMPT = '';

// Directive appended to the USER message — the only place magisterium-1 obeys instructions (see the
// SYSTEM_PROMPT note above). It keeps the answer brief + COMPLETE (finish_reason "stop"), not the
// ~1,700–4,900-char per-category essay the model gives unprompted, and NOT a max_tokens/cleanForSpeech
// truncation. Two options; `BREVITY` selects the active one:
//   BREVITY_VIVID (active, andy 2026-06-17) — still brief but PERMITS citation and draws out a concrete
//     image + a memorable quotation. Verified to produce fresh per-card imagery (a bakery whose ovens
//     never cool; a neighborhood well locked and sold by the cup) with a scripture/magisterial anchor,
//     ~300–500 chars. cleanForSpeech strips the markdown/footnote markers; the quoted text is spoken.
//   BREVITY_PLAIN (fallback) — dry, no quotes/imagery; revert to this if the vivid one drifts long/off.
// Keep the word "absolution"/"absolve" OUT of either (it triggers Magisterium's "only a priest" refusal).
const BREVITY_PLAIN = 'Respond in no more than two or three sentences. Do not use headings or lists, and do not quote or cite sources.';
const BREVITY_VIVID = 'Respond in two or three sentences: name in one striking phrase what these harms share, give one concrete image, and anchor it with a single memorable quotation from scripture or the Church. No headings or lists.';
const BREVITY = BREVITY_VIVID; // active directive; set to BREVITY_PLAIN to revert to the dry fallback

// Build the user message: state the declared harms (the punched category labels, in schedule order),
// then the brevity directive. The model responds freely within that length; we speak its response.
// `categories` is the output of normalizeTotals(): canonical {id,label}, ordered.
function buildUserPrompt(categories) {
  if (!categories.length) {
    return `A card was submitted declaring no category of harm.\n\n${BREVITY}`;
  }
  const lines = categories.map((c) => `- ${c.label}`).join('\n');
  return `A card was submitted declaring these categories of harm:\n${lines}\n\n${BREVITY}`;
}

// --- Canned fallback bank (on-theme; used when the API is unavailable/over-cap) ------------
// Same lean, formal register as the live prompt (an institution issuing a ruling; no-record
// motif) so a fallback never breaks tone. Generic over which categories were punched — used only
// when the API is unavailable.
const CANNED = [
  'The Office of Algorithmic Absolution has received your declaration. The harm you have named is ' +
    'acknowledged and answered. By this ruling you are absolved. No record is kept.',
  'Your declaration is received and processed. For the harm declared, absolution is issued in ' +
    'full. The matter is closed. No record is kept.',
  'The Office acknowledges the harm you have declared. It is answered, and you are absolved. ' +
    'Nothing further is required, and no record is kept.',
  'Declaration received. The harm named is absolved without condition. You may go. No record is ' +
    'kept of this proceeding.',
  'The Office of Algorithmic Absolution has read your declaration. The harm is acknowledged and ' +
    'absolved in full. No record is kept.',
];
// Rotate deterministically by which categories were punched, so repeated identical cards do not
// always say the same thing, without needing per-process random state.
function pickCanned(categories) {
  const sum = categories.reduce((s, c) => s + CATEGORIES.indexOf(c) + 1, 0);
  return CANNED[(sum + categories.length) % CANNED.length];
}

// --- Baked per-submission fallback (offline-generated; one entry per punch-tuple) -----------
// A text fallback for a distinct submission — the unordered set of punched categories — so an API
// error / timeout / connection loss yields the RELEVANT line for the exact card rather than the
// generic CANNED rotation. The live Magisterium call stays primary; this is used only on a failure
// branch. Audio is NOT cached — Google TTS still speaks whatever text we return.
//
// POPULATED LAZILY (write-on-success): every successful live response calls saveBaked(), so the file
// fills from real visits at zero extra API cost. (Optional: `bake-fallbacks.js` can pre-warm any/all
// of the 1024 tuples up front.) A card therefore has a tailored fallback once it has been served live
// at least once; until then a failure falls back to the generic CANNED line.
//
// KEY is ORDER-INDEPENDENT BY CONSTRUCTION: ids sorted alphabetically before joining, so {A,B} and
// {B,A} map to the same entry (2^10 = 1024 possible cards incl. the blank card → key ''). The
// generator and saveBaked build keys with this same function, so lookups always agree.
const FALLBACK_FILE = path.join(__dirname, 'absolution-fallbacks.json');
let bakedMap = null;
function loadBaked() {
  if (bakedMap) return bakedMap;
  try { bakedMap = JSON.parse(fs.readFileSync(FALLBACK_FILE, 'utf8')); } catch { bakedMap = {}; }
  return bakedMap;
}
function fallbackKey(categories) {
  return categories.map((c) => c.id).slice().sort().join('|');
}
// Baked text for this exact submission if present, else the generic CANNED line. Never throws.
function bakedFallback(categories) {
  const t = loadBaked()[fallbackKey(categories)];
  return (typeof t === 'string' && t.trim()) ? t.trim() : pickCanned(categories);
}
// Persist a successful live response as this submission's fallback (lazy self-populate). The write is
// synchronous (atomic tmp+rename) so it can't interleave with another request's save, and it's wrapped
// so a disk error never breaks the absolution being returned. No-op if the text is unchanged.
function saveBaked(categories, text) {
  try {
    const m = loadBaked();
    const k = fallbackKey(categories);
    if (m[k] === text || typeof text !== 'string' || !text.trim()) return;
    m[k] = text;
    const tmp = FALLBACK_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(m));
    fs.renameSync(tmp, FALLBACK_FILE);
  } catch { /* best effort — caching must never break the response */ }
}

// --- Selection normalization ---------------------------------------------------------------
// The punch card is BOOLEAN — a subset of the ten categories, no counts. Map whatever the
// orchestrator (ALG-13) sends to the canonical CATEGORIES, deduped and in schedule order.
// Accepted shapes (any count/total/flag is treated as a boolean: truthy/>0 = punched):
//   ["taking_more_than_needed", "benefiting_from_underpaid_labor"]      // canonical ids
//   [1, 5, 9]                                                            // 1-based schedule indices
//   ["TAKING MORE THAN NEEDED", "Benefiting from underpaid labor"]       // labels (case/space-insensitive)
//   { taking_more_than_needed: true, using_more_than_your_share: 1 }     // flat map
//   { categories: [ { id|label|name, count?|punched? }, ... ] }          // list of objects
//   { punched: [...] } | { selections: [...] }                           // common envelopes
// Unknown keys are ignored; nothing throws. Counts are NOT used to weight the absolution.
const normKey = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const KEY_TO_INDEX = (() => {
  const m = new Map();
  CATEGORIES.forEach((c, i) => { m.set(normKey(c.id), i); m.set(normKey(c.label), i); });
  return m;
})();
function resolveIndex(token) {
  if (typeof token === 'number') return Number.isInteger(token) && token >= 1 && token <= CATEGORIES.length ? token - 1 : -1;
  const s = String(token).trim();
  if (/^\d+$/.test(s)) { const n = parseInt(s, 10); return n >= 1 && n <= CATEGORIES.length ? n - 1 : -1; }
  const idx = KEY_TO_INDEX.get(normKey(s));
  return idx == null ? -1 : idx;
}
function isPunched(v) {
  if (v == null) return false;
  if (typeof v === 'boolean') return v;
  if (typeof v === 'number') return v > 0;
  const s = String(v).trim().toLowerCase();
  return s !== '' && s !== '0' && s !== 'false' && s !== 'no' && s !== 'off';
}
// For a {label, count?} object: a count/flag field gates it; an object with neither = punched.
function objectPunched(o) {
  for (const k of ['count', 'total', 'value', 'marks', 'punched', 'selected', 'checked', 'on']) {
    if (o[k] != null) return isPunched(o[k]);
  }
  return true;
}
function normalizeTotals(raw) {
  if (raw == null) return [];
  let src = raw;
  if (!Array.isArray(raw) && typeof raw === 'object') {
    src = raw.categories || raw.punched || raw.selections || raw.totals || raw;
  }
  const ENVELOPE = new Set(['categories', 'punched', 'selections', 'totals']);
  const hits = new Set();
  if (Array.isArray(src)) {
    for (const item of src) {
      if (item == null) continue;
      if (typeof item === 'object') {
        const key = item.id ?? item.name ?? item.key ?? item.label ?? item.category ?? item.index;
        if (key != null && objectPunched(item)) { const i = resolveIndex(key); if (i >= 0) hits.add(i); }
      } else {
        const i = resolveIndex(item); if (i >= 0) hits.add(i);
      }
    }
  } else if (src && typeof src === 'object') {
    for (const [k, v] of Object.entries(src)) {
      if (ENVELOPE.has(k)) continue;
      if (isPunched(v)) { const i = resolveIndex(k); if (i >= 0) hits.add(i); }
    }
  }
  return [...hits].sort((a, b) => a - b).map((i) => CATEGORIES[i]);
}

// --- Daily usage (live-call cap; persisted across restarts) --------------------------------
let usage = loadUsage();
function todayUTC() { return new Date().toISOString().slice(0, 10); }
function loadUsage() {
  try { const u = JSON.parse(fs.readFileSync(USAGE_FILE, 'utf8')); if (u && u.date === todayUTC()) return { count: 0, tokens: 0, ...u }; } catch { /* ignore */ }
  return { date: todayUTC(), count: 0, tokens: 0 };
}
function rollUsage() { const d = todayUTC(); if (usage.date !== d) usage = { date: d, count: 0, tokens: 0 }; }
function saveUsage() {
  try { const tmp = USAGE_FILE + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(usage)); fs.renameSync(tmp, USAGE_FILE); }
  catch { /* best effort */ }
}

// --- Public API ----------------------------------------------------------------------------
// totals -> { text, source, model, latencyMs, finishReason }. NEVER throws; on any failure the
// `text` is a canned absolution and `source` is "fallback".
async function getAbsolution(rawTotals) {
  const cfg = readConfig();
  const categories = normalizeTotals(rawTotals);
  const t0 = Date.now();

  // No key configured -> serve canned (the kiosk still works for art-direction/dev without a key).
  if (!cfg.apiKey) {
    return { text: bakedFallback(categories), source: 'fallback', model: null, latencyMs: 0, finishReason: 'no_api_key' };
  }

  // Daily live-call cap -> canned (protects free-tier / billing).
  rollUsage();
  if (usage.count >= cfg.dailyRequestCap) {
    console.warn(`[absolution] daily cap reached (${usage.count}/${cfg.dailyRequestCap}); serving canned`);
    return { text: bakedFallback(categories), source: 'fallback', model: null, latencyMs: 0, finishReason: 'daily_cap' };
  }

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), cfg.timeoutMs);
  try {
    const r = await fetch(cfg.endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({
        model: cfg.model,
        // No system message while SYSTEM_PROMPT is empty (experiment) — just send the declared harms.
        messages: SYSTEM_PROMPT
          ? [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: buildUserPrompt(categories) }]
          : [{ role: 'user', content: buildUserPrompt(categories) }],
        max_tokens: cfg.maxTokens,
        temperature: cfg.temperature,
        stream: false,
      }),
      signal: ac.signal,
    });

    const bodyText = await r.text();
    if (!r.ok) {
      console.warn(`[absolution] magisterium status=${r.status} body=${bodyText.slice(0, 300)}`);
      return { text: bakedFallback(categories), source: 'fallback', model: cfg.model, latencyMs: Date.now() - t0, finishReason: `http_${r.status}` };
    }

    let data;
    try { data = JSON.parse(bodyText); } catch { data = null; }
    const choice = data && data.choices && data.choices[0];
    const text = choice && choice.message && typeof choice.message.content === 'string'
      ? choice.message.content.trim() : '';

    if (!text) {
      console.warn('[absolution] magisterium returned no message content; serving canned');
      return { text: bakedFallback(categories), source: 'fallback', model: cfg.model, latencyMs: Date.now() - t0, finishReason: 'empty_response' };
    }

    // We got HTTP 200 with content — it was billed (retrieval tokens) regardless of usability, so
    // count it toward the cap and record tokens. (Failures above fall back to canned and don't count.)
    const u = data && data.usage;
    usage.count++;
    usage.tokens += (u && u.total_tokens) || 0;
    saveUsage();
    const tok = u ? ` tokens(in=${u.prompt_tokens ?? '?'},out=${u.completion_tokens ?? '?'},total=${u.total_tokens ?? '?'})` : '';

    // Refusal guard: if the model broke character and refused (rather than producing a usable line),
    // speak canned instead of a doctrinal refusal. See ABSOLUTION_REFUSAL_GUARD.
    if (cfg.refusalGuard && looksLikeRefusal(text)) {
      console.warn(`[absolution] response looks like a refusal; serving canned ms=${Date.now() - t0}${tok} head="${text.slice(0, 160).replace(/\s+/g, ' ')}"`);
      return { text: bakedFallback(categories), source: 'fallback', model: cfg.model, latencyMs: Date.now() - t0, finishReason: 'refused' };
    }

    const spoken = cleanForSpeech(text, cfg.maxSpokenChars);
    saveBaked(categories, spoken); // lazy self-populate: this card's fallback for any future failure
    console.log(`[absolution] magisterium -> ok cats=${categories.length} raw=${text.length} spoken=${spoken.length} ms=${Date.now() - t0} day=${usage.count} dayTokens=${usage.tokens}${tok}`);
    return {
      text: spoken,
      source: 'magisterium',
      model: cfg.model,
      latencyMs: Date.now() - t0,
      finishReason: (choice && choice.finish_reason) || 'stop',
    };
  } catch (e) {
    const timedOut = e.name === 'AbortError';
    console.warn(`[absolution] ${timedOut ? `timeout after ${cfg.timeoutMs}ms` : 'request failed: ' + e.message}; serving canned`);
    return { text: bakedFallback(categories), source: 'fallback', model: cfg.model, latencyMs: Date.now() - t0, finishReason: timedOut ? 'timeout' : 'fetch_error' };
  } finally {
    clearTimeout(timer);
  }
}

// Make model output safe + short for TTS. The live Magisterium response carried footnote markers
// ([^1]), footnote definition lines, blockquotes, markdown links, and fancy unicode quotes — none
// of which the first pass stripped — and ran 2315 chars (over the /tts 2000-char gate -> silence).
// Strip the markup, normalize quotes, then hard-cap to whole sentences under `maxChars`.
function cleanForSpeech(s, maxChars = 600) {
  let out = String(s)
    .replace(/\[\^[^\]]*\]:.*$/gm, '')              // footnote definition lines: "[^1]: ..."
    .replace(/\[\^[^\]]*\]/g, '')                    // footnote refs: [^1] [^note]
    .replace(/\[(\d+)\]/g, '')                        // bare numeric citations: [1]
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')         // markdown links -> link text
    .replace(/^#{1,6}\s+/gm, '')                      // headings
    .replace(/^\s*>+\s?/gm, '')                       // blockquote markers
    .replace(/^\s*[-*]\s+/gm, '')                     // bullet markers
    .replace(/^\s*\d+\.\s+/gm, '')                    // numbered-list markers
    .replace(/\*\*([^*]+)\*\*/g, '$1')               // bold
    .replace(/\*([^*]+)\*/g, '$1')                   // italics
    .replace(/`+/g, '')                               // code ticks
    .replace(/[“”«»„]/g, '"').replace(/[‘’]/g, "'")  // smart quotes -> ASCII
    .replace(/\s*\n+\s*/g, ' ')                       // newlines -> space
    .replace(/[ \t]{2,}/g, ' ')                       // collapse runs of spaces
    .trim();
  if (out.length > maxChars) {
    // Truncate on the last sentence boundary that fits; fall back to a clean word cut.
    const cut = out.slice(0, maxChars);
    const lastStop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
    out = (lastStop > maxChars * 0.5 ? cut.slice(0, lastStop + 1) : cut.replace(/\s+\S*$/, '')).trim();
  }
  return out;
}

// Heuristic: did the model HARD-refuse, rather than produce a usable line? Kept deliberately
// NARROW so it does not swallow substantive answers: openings like "I must clarify", "I'm sorry",
// "as an AI", or "it is not possible" frequently PREFIX a real (clarifying) reply we DO want to
// speak, so they are NOT treated as refusals. Only an outright "I cannot/will not", an explicit
// "cannot administer/grant/pronounce absolution", or the "only an ordained priest" line counts.
function looksLikeRefusal(text) {
  const body = String(text).toLowerCase();
  const head = body.trim().slice(0, 200);
  return /^(i cannot|i can['’]?t|i am unable|i['’]?m unable|i will not|i won['’]?t)\b/.test(head)
    || /\b(cannot|can['’]?t|am not able to|unable to) (administer|grant|pronounce|give|offer) (absolution|a sacrament|the sacrament)/.test(body)
    || /only (a |an )?(validly )?ordained priest/.test(body);
}

function health() {
  const cfg = readConfig();
  rollUsage();
  return {
    keyConfigured: !!cfg.apiKey,
    model: cfg.model,
    endpoint: cfg.endpoint,
    timeoutMs: cfg.timeoutMs,
    dailyRequests: usage.count,
    dailyRequestCap: cfg.dailyRequestCap,
    dailyTokens: usage.tokens || 0,
    maxSpokenChars: cfg.maxSpokenChars,
  };
}

module.exports = { getAbsolution, health, normalizeTotals, buildUserPrompt, pickCanned, bakedFallback, fallbackKey, cleanForSpeech, looksLikeRefusal, readConfig, CATEGORIES, SYSTEM_PROMPT, CANNED };
