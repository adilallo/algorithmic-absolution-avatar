#!/usr/bin/env node
'use strict';

/*
 * Bake per-submission fallback text for the Office of Algorithmic Absolution kiosk.
 *
 * For EACH distinct punch-tuple (the unordered subset of the 10 categories — 2^10 = 1024 cards,
 * incl. the blank card) this calls Magisterium once with the SAME user message the live path builds
 * (`buildUserPrompt`, which carries the active BREVITY directive), cleans it for speech, and stores
 * it in absolution-fallbacks.json keyed by `fallbackKey` (alphabetically-sorted ids → order-
 * independent). absolution.js loads that file and serves the matching entry whenever a live call
 * fails (error / timeout / connection loss / refusal / over-cap). Text only — Google TTS speaks it.
 *
 * Calls Magisterium DIRECTLY (not via the proxy) so the proxy's per-day cap doesn't block the bake.
 * RESUMABLE: re-running skips tuples already in the JSON. Saves incrementally, so a crash/429 storm
 * loses nothing. Tunable via env:
 *   BAKE_CONCURRENCY (default 3)  — parallel in-flight calls (keep low; Magisterium rate-limits)
 *   BAKE_LIMIT       (default 0)  — bake at most N missing tuples this run (0 = all). Use for sampling.
 *   BAKE_RETRIES     (default 4)  — attempts per tuple on 429/5xx/timeout (exponential backoff).
 *
 * Run from deploy/tts-proxy:  node bake-fallbacks.js
 */

const fs = require('node:fs');
const path = require('node:path');
const A = require('./absolution');

// Load .env for MAGISTERIUM_API_KEY (server.js normally does this; the bake runs standalone).
loadDotEnv(path.join(__dirname, '.env'));
const cfg = A.readConfig();
if (!cfg.apiKey) { console.error('[bake] MAGISTERIUM_API_KEY not set in deploy/tts-proxy/.env — aborting.'); process.exit(1); }

const OUT = path.join(__dirname, 'absolution-fallbacks.json');
const CONCURRENCY = Math.max(1, parseInt(process.env.BAKE_CONCURRENCY || '3', 10));
const LIMIT = parseInt(process.env.BAKE_LIMIT || '0', 10);            // 0 = all
const RETRIES = Math.max(1, parseInt(process.env.BAKE_RETRIES || '4', 10));

const CATS = A.CATEGORIES;
const N = CATS.length;

// All 2^N subsets (bit i set => category i punched). Schedule-ordered subset; fallbackKey sorts it.
const tuples = [];
for (let mask = 0; mask < (1 << N); mask++) {
  tuples.push(CATS.filter((_, i) => mask & (1 << i)));
}

// Resume: load existing entries, bake only what's missing.
let out = {};
try { out = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch { out = {}; }
let todo = tuples.filter((cats) => !(A.fallbackKey(cats) in out));
if (LIMIT > 0) todo = todo.slice(0, LIMIT);

console.log(`[bake] ${N} categories -> ${tuples.length} tuples; ${Object.keys(out).length} already baked; ` +
  `baking ${todo.length}${LIMIT ? ` (LIMIT=${LIMIT})` : ''} at concurrency ${CONCURRENCY}.`);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const backoff = (attempt) => Math.min(30000, 800 * Math.pow(2, attempt - 1)) + Math.floor(attempt * 137); // jittered

let done = 0, live = 0, canned = 0, errors = 0, saveDirty = 0;
function maybeSave(force) {
  if (!force && ++saveDirty < 10) return;
  saveDirty = 0;
  const tmp = OUT + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(out, null, 0));
  fs.renameSync(tmp, OUT); // atomic
}

async function bakeOne(cats) {
  const userMsg = A.buildUserPrompt(cats); // same message the live path sends (incl. BREVITY)
  for (let attempt = 1; attempt <= RETRIES; attempt++) {
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), cfg.timeoutMs);
    try {
      const r = await fetch(cfg.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${cfg.apiKey}` },
        body: JSON.stringify({ model: cfg.model, messages: [{ role: 'user', content: userMsg }],
          temperature: cfg.temperature, max_tokens: cfg.maxTokens, stream: false }),
        signal: ac.signal,
      });
      clearTimeout(timer);
      if (r.status === 429 || r.status >= 500) { await sleep(backoff(attempt)); continue; }
      const d = await r.json().catch(() => null);
      const c = d && d.choices && d.choices[0];
      let text = c && c.message && typeof c.message.content === 'string' ? c.message.content.trim() : '';
      if (!text || A.looksLikeRefusal(text)) {
        if (attempt < RETRIES) { await sleep(backoff(attempt)); continue; } // retry empties/refusals
        return { text: A.pickCanned(cats), kind: 'canned' };                // never bake a refusal
      }
      return { text: A.cleanForSpeech(text, cfg.maxSpokenChars), kind: 'live' };
    } catch (e) {
      clearTimeout(timer);
      if (attempt < RETRIES) { await sleep(backoff(attempt)); continue; }
      return null; // give up this tuple this run; resume will retry it later
    }
  }
  return null;
}

async function worker(queue) {
  while (queue.length) {
    const cats = queue.shift();
    const key = A.fallbackKey(cats);
    const res = await bakeOne(cats);
    done++;
    if (!res) { errors++; console.warn(`[bake] FAIL ${done}/${todo.length} key="${key}" (will retry on resume)`); continue; }
    out[key] = res.text;
    if (res.kind === 'live') live++; else canned++;
    maybeSave(false);
    if (done % 25 === 0 || done === todo.length) {
      console.log(`[bake] ${done}/${todo.length} (live=${live} canned=${canned} err=${errors})`);
    }
  }
}

(async () => {
  const queue = todo.slice();
  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker(queue)));
  maybeSave(true);
  console.log(`[bake] DONE. total entries now ${Object.keys(out).length}/${tuples.length} ` +
    `(this run: live=${live} canned=${canned} err=${errors}). -> ${OUT}`);
})();

// Minimal .env loader (no deps) — mirrors server.js.
function loadDotEnv(file) {
  let txt; try { txt = fs.readFileSync(file, 'utf8'); } catch { return; }
  for (const line of txt.split(/\r?\n/)) {
    if (line.trim().startsWith('#')) continue;
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let val = m[2];
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = val;
  }
}
