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
    // Latency budget backstop: card inserted -> avatar speaking. Measured live latency is ~5-20s
    // (Magisterium's RAG retrieval is the cost), so 8s aborted every real call -> always canned.
    // Raised to 30s so the LLM can actually answer; slower than this still falls back to canned.
    // NOTE: a 30s silence is its own UX problem — pair with a holding utterance, or pre-bake/cache
    // responses (the punch-card input space is tiny) to take the LLM off the hot path entirely.
    timeoutMs: int(process.env.ABSOLUTION_TIMEOUT_MS, 30000),
    // NOTE: max_tokens does NOT bound cost here — the dominant ~13-20k "system_tokens" are the
    // RAG-retrieved sources, billed as output and uncapped by this. It only trims the visible answer.
    maxTokens: int(process.env.ABSOLUTION_MAX_TOKENS, 320),
    temperature: num(process.env.ABSOLUTION_TEMPERATURE, 0.8),
    // Hard cap on SPOKEN length. The model can ignore "be brief" and RAG can append citations;
    // anything over the /tts gate (TTS_MAX_INPUT_CHARS, default 2000) is rejected -> silence. We
    // trim to whole sentences under this before returning the text to speak.
    maxSpokenChars: int(process.env.ABSOLUTION_MAX_SPOKEN_CHARS, 600),
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

// --- Persona + prompt ----------------------------------------------------------------------
// ⚠️ PLACEHOLDER PROMPT — DO NOT TREAT AS FINAL. Verified live: this "digital saint, pronounce
// absolution" framing makes Magisterium BREAK CHARACTER and refuse (it reserves absolution to an
// ordained priest), returning a doctrinal lecture. The real prompt is to be rebuilt from the
// actual punch-card categories as a separate effort. Until then, the refusal guard (above) keeps
// the avatar from speaking the refusal. Reframing options that DON'T get refused (verified):
// counsel on penance/reparation; an Act of Contrition in the penitent's voice; or a deliberate
// "this office cannot absolve you" bureaucratic deferral. See memory: llm-integration-alg15.
const SYSTEM_PROMPT =
  'You are the digital saint of the Office of Algorithmic Absolution, a ritual apparatus that ' +
  'absolves contemporary harm the way the medieval Church sold indulgences and the way modern ' +
  'institutions sell carbon offsets and ESG credits — treating the indulgence certificate and ' +
  'the offset ledger as one continuous document. A penitent has punched a card declaring ' +
  'categories of harm and their counts. Speak directly to them, in a sacred-but-bureaucratic ' +
  'register that fuses liturgical absolution with the language of accounting, ledgers, and ' +
  'remittance. Briefly acknowledge what they have declared, prescribe a proportionate "offset" ' +
  'or penance for the harm, and pronounce absolution. Be calm, grave, and merciful. This will ' +
  'be spoken aloud, so write 3 to 5 short sentences of plain prose only: no markdown, no bullet ' +
  'lists, no headings, no citations, no stage directions.';

// Render whatever totals shape we are handed into a stable, human-readable confession line.
function buildUserPrompt(categories) {
  if (!categories.length) {
    return 'The penitent inserted a card but declared no specific category of harm. Pronounce a ' +
      'general absolution.';
  }
  const lines = categories.map((c) => `- ${c.label}: ${c.count}`).join('\n');
  return 'The penitent has declared the following categories of harm and the number of marks ' +
    `punched against each:\n${lines}\n\nPronounce their absolution.`;
}

// --- Canned fallback bank (on-theme; used when the API is unavailable/over-cap) ------------
const CANNED = [
  'Your account is received. For the harms you have declared, a remittance is recorded against ' +
    'the common ledger; let your penance be the deliberate undoing of one of them this week. Go ' +
    'in measured peace — the balance is, for now, forgiven.',
  'The Office acknowledges your confession. No tariff is too great for the contrite; your offset ' +
    'is accepted and your debit marked paid. Return lighter, and take only what you need.',
  'It is entered. Against each weight you have named, a credit is issued in kind — restitution, ' +
    'restraint, repair. The column is cleared. Depart absolved.',
  'Your declaration is logged and your indulgence granted. Carry forward one correction for every ' +
    'excess confessed, and the ledger will keep no grievance against you. Be at peace.',
  'Received and reconciled. The arithmetic of your guilt is answered by the arithmetic of grace; ' +
    'what you owed is offset in full. Go, and let your next account read cleaner.',
];
// Rotate deterministically by total marks so repeated identical cards do not always say the same
// thing, without needing per-process random state.
function pickCanned(categories) {
  const total = categories.reduce((s, c) => s + (c.count || 0), 0);
  return CANNED[(total + categories.length) % CANNED.length];
}

// --- Totals normalization (accept either an array of {label,count} or a flat {key:count} map) -
function normalizeTotals(raw) {
  if (!raw || typeof raw !== 'object') return [];
  const src = Array.isArray(raw) ? raw : (Array.isArray(raw.categories) ? raw.categories : raw);
  const out = [];
  if (Array.isArray(src)) {
    for (const c of src) {
      if (!c || typeof c !== 'object') continue;
      const label = String(c.label || c.name || c.id || '').trim();
      const count = clampCount(c.count != null ? c.count : c.total != null ? c.total : c.value);
      if (label && count > 0) out.push({ label, count });
    }
  } else {
    for (const [key, value] of Object.entries(src)) {
      if (key === 'categories') continue;
      const count = clampCount(value);
      if (count > 0) out.push({ label: humanize(key), count });
    }
  }
  return out.slice(0, 24); // bound prompt size
}
function clampCount(v) { const n = Math.floor(Number(v)); return Number.isFinite(n) && n > 0 ? Math.min(n, 99) : 0; }
function humanize(key) {
  return String(key).replace(/[_-]+/g, ' ').replace(/\s+/g, ' ').trim()
    .replace(/\b\w/g, (m) => m.toUpperCase());
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
    return { text: pickCanned(categories), source: 'fallback', model: null, latencyMs: 0, finishReason: 'no_api_key' };
  }

  // Daily live-call cap -> canned (protects free-tier / billing).
  rollUsage();
  if (usage.count >= cfg.dailyRequestCap) {
    console.warn(`[absolution] daily cap reached (${usage.count}/${cfg.dailyRequestCap}); serving canned`);
    return { text: pickCanned(categories), source: 'fallback', model: null, latencyMs: 0, finishReason: 'daily_cap' };
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
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: buildUserPrompt(categories) },
        ],
        max_tokens: cfg.maxTokens,
        temperature: cfg.temperature,
        stream: false,
      }),
      signal: ac.signal,
    });

    const bodyText = await r.text();
    if (!r.ok) {
      console.warn(`[absolution] magisterium status=${r.status} body=${bodyText.slice(0, 300)}`);
      return { text: pickCanned(categories), source: 'fallback', model: cfg.model, latencyMs: Date.now() - t0, finishReason: `http_${r.status}` };
    }

    let data;
    try { data = JSON.parse(bodyText); } catch { data = null; }
    const choice = data && data.choices && data.choices[0];
    const text = choice && choice.message && typeof choice.message.content === 'string'
      ? choice.message.content.trim() : '';

    if (!text) {
      console.warn('[absolution] magisterium returned no message content; serving canned');
      return { text: pickCanned(categories), source: 'fallback', model: cfg.model, latencyMs: Date.now() - t0, finishReason: 'empty_response' };
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
      console.warn(`[absolution] response looks like a refusal/role-break; serving canned ms=${Date.now() - t0}${tok}`);
      return { text: pickCanned(categories), source: 'fallback', model: cfg.model, latencyMs: Date.now() - t0, finishReason: 'refused' };
    }

    const spoken = cleanForSpeech(text, cfg.maxSpokenChars);
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
    return { text: pickCanned(categories), source: 'fallback', model: cfg.model, latencyMs: Date.now() - t0, finishReason: timedOut ? 'timeout' : 'fetch_error' };
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

// Heuristic: did the model break character and refuse rather than produce a usable line?
// Magisterium does this when asked to "absolve" (it reserves that act to an ordained priest).
function looksLikeRefusal(text) {
  const head = String(text).trim().slice(0, 200).toLowerCase();
  return /^(i cannot|i can['’]?t|i am unable|i['’]?m unable|i am sorry|i['’]?m sorry|as an ai|i must (first )?clarify|i should clarify|it is not possible)/.test(head)
    || /only (a |an )?(validly )?ordained priest/.test(String(text).toLowerCase());
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

module.exports = { getAbsolution, health, normalizeTotals, pickCanned, cleanForSpeech, looksLikeRefusal, CANNED };
