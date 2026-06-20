'use strict';

/*
 * DEV-ONLY preview generator for the harm-tester scene (absolution-harm-tester.html).
 *
 * This is scaffolding for trying out a candidate prompt/temperature WITHOUT touching the
 * production path. It does NOT modify absolution.js: it reuses that module's CATEGORIES,
 * normalizeTotals, cleanForSpeech, looksLikeRefusal and readConfig, but builds the user
 * message from a CALLER-SUPPLIED directive + temperature so the page can sculpt them live.
 *
 * Differences from the shipping getAbsolution() (deliberate, because this is a tuning tool):
 *   - no fallback cache write (saveBaked) and no daily-cap accounting — every call is a fresh probe;
 *   - returns rich diagnostics (raw + cleaned text, latency, finish_reason, refusal flag, tokens);
 *   - the directive/temperature come from the request, defaulting to the V6 recommendation below.
 *
 * Loopback-only, same key handling as everything else (server.js injects MAGISTERIUM_API_KEY).
 */

const A = require('./absolution');

// Default to whatever the PRODUCTION path currently uses (now the V6 BREVITY_RIDDLE + temp 1.2), so the
// tester mirrors live out of the box. Still fully editable in the page for trying new candidates.
const DEFAULT_DIRECTIVE = A.BREVITY;
const DEFAULT_TEMPERATURE = A.readConfig().temperature;

function buildUserMessage(categories, directive) {
  const dir = (typeof directive === 'string' && directive.trim()) ? directive.trim() : DEFAULT_DIRECTIVE;
  if (!categories.length) return `A card was submitted declaring no category of harm.\n\n${dir}`;
  const lines = categories.map((c) => `- ${c.label}`).join('\n');
  return `A card was submitted declaring these categories of harm:\n${lines}\n\n${dir}`;
}

// One fresh probe. NEVER throws — returns { ok, ... } so the tester always renders something.
async function previewAbsolution(req) {
  const cfg = A.readConfig();
  const categories = A.normalizeTotals(req && req.punched);
  const directive = req && req.directive;
  const temperature = Number.isFinite(+(req && req.temperature)) ? +req.temperature : DEFAULT_TEMPERATURE;
  const userMsg = buildUserMessage(categories, directive);
  const t0 = Date.now();

  if (!cfg.apiKey) {
    return { ok: false, error: 'no_api_key', userMsg, declared: categories.map((c) => c.label) };
  }

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), cfg.timeoutMs);
  try {
    const r = await fetch(cfg.endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${cfg.apiKey}` },
      body: JSON.stringify({
        model: cfg.model,
        messages: [{ role: 'user', content: userMsg }],
        max_tokens: cfg.maxTokens,
        temperature,
        stream: false,
      }),
      signal: ac.signal,
    });
    const bodyText = await r.text();
    const ms = Date.now() - t0;
    if (!r.ok) {
      return { ok: false, error: `http_${r.status}`, status: r.status, latencyMs: ms, userMsg, declared: categories.map((c) => c.label) };
    }
    let data; try { data = JSON.parse(bodyText); } catch { data = null; }
    const choice = data && data.choices && data.choices[0];
    const raw = choice && choice.message && typeof choice.message.content === 'string' ? choice.message.content.trim() : '';
    if (!raw) {
      return { ok: false, error: 'empty_response', latencyMs: ms, userMsg, declared: categories.map((c) => c.label) };
    }
    const spoken = A.cleanForSpeech(raw, cfg.maxSpokenChars);
    const u = (data && data.usage) || {};
    return {
      ok: true,
      text: spoken,
      raw,
      rawLen: raw.length,
      spokenLen: spoken.length,
      latencyMs: ms,
      finishReason: (choice && choice.finish_reason) || 'stop',
      refusal: A.looksLikeRefusal(raw),
      temperature,
      tokens: { in: u.prompt_tokens ?? null, out: u.completion_tokens ?? null, total: u.total_tokens ?? null },
      declared: categories.map((c) => c.label),
      userMsg,
    };
  } catch (e) {
    const timedOut = e.name === 'AbortError';
    return { ok: false, error: timedOut ? 'timeout' : ('fetch_error: ' + e.message), latencyMs: Date.now() - t0, userMsg, declared: categories.map((c) => c.label) };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { previewAbsolution, DEFAULT_DIRECTIVE, DEFAULT_TEMPERATURE };
