#!/usr/bin/env node
'use strict';

/*
 * TTS proxy + static server for the Office of Algorithmic Absolution kiosk (ALG-8).
 *
 * Two jobs on ONE 127.0.0.1 origin (so the browser is same-origin with /tts — no CORS):
 *   1. Serve the repo root as static files (replaces `python3 -m http.server`).
 *   2. POST /tts  — validate + rate-limit, inject the Google key SERVER-SIDE, forward the
 *      verbatim TalkingHead body to Google Cloud TTS v1beta1, and return Google's JSON
 *      response UNCHANGED (audioContent + timepoints) so lip-sync keeps working.
 *
 * The Google key lives ONLY in deploy/tts-proxy/.env (gitignored) and is read from
 * process.env.GOOGLE_TTS_API_KEY. It is never written into any HTTP response and never
 * served as a static file, so it appears in neither client source nor the network tab.
 *
 * Zero dependencies: Node >= 18 built-ins only (global fetch). Run: `node server.js`.
 */

const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const absolution = require('./absolution'); // ALG-15: punch-card totals -> absolution text (Magisterium)

// --- Paths -----------------------------------------------------------------
const PROXY_DIR = __dirname;                               // deploy/tts-proxy
const REPO_ROOT = path.resolve(PROXY_DIR, '..', '..');     // repo root served as static
const USAGE_FILE = path.join(PROXY_DIR, '.usage.json');
// Canonical (symlink- and case-resolved) roots — used to enforce containment so that
// neither symlinks nor case variation (e.g. /DEPLOY/... on case-insensitive APFS) can
// reach the proxy dir / .env or escape the repo root.
const realpathOr = (p) => { try { return fs.realpathSync(p); } catch { return p; } };
const REAL_REPO_ROOT = realpathOr(REPO_ROOT);
const REAL_PROXY_DIR = realpathOr(PROXY_DIR);

// --- Load .env (no dependency) ---------------------------------------------
loadDotEnv(path.join(PROXY_DIR, '.env'));

// --- Config (env-overridable) ----------------------------------------------
const PORT = parseInt(process.env.PORT || '8765', 10);
const HOST = process.env.HOST || '127.0.0.1';             // loopback only = the real access control
const TTS_ENDPOINT = process.env.TTS_ENDPOINT ||
  'https://eu-texttospeech.googleapis.com/v1beta1/text:synthesize'; // MUST be v1beta1 (v1 drops timepoints)
const API_KEY = process.env.GOOGLE_TTS_API_KEY || '';

const list = (v, d) => (v || d).split(',').map((s) => s.trim()).filter(Boolean);
// Pin to the cheap Standard tier voices we actually ship. Blocks an attacker forcing
// expensive Studio/WaveNet/Neural2 voices onto the bill.
const ALLOWED_VOICES = list(process.env.TTS_ALLOWED_VOICES,
  // FREE-tier (Standard) en-US female voices only — they honor server-side pitch and stay in
  // Google's free monthly allotment. Premium tiers (Neural2/WaveNet/Studio/Chirp) are blocked
  // here so a stray request can't incur premium billing.
  'en-US-Standard-C,en-US-Standard-E,en-US-Standard-F,en-US-Standard-G,en-US-Standard-H');
const ALLOWED_LANGS = list(process.env.TTS_ALLOWED_LANGS, 'en-GB,en-US');
const MAX_INPUT_CHARS = parseInt(process.env.TTS_MAX_INPUT_CHARS || '2000', 10); // spoken chars per request
const DAILY_CHAR_CAP = parseInt(process.env.TTS_DAILY_CHAR_CAP || '200000', 10); // billing backstop (resets UTC midnight). Raised from 50000: the 1800-char reads burn it ~3-4x faster. NOTE: still a real Google-TTS-billing guard — tune to the free tier for production.
const MAX_BODY_BYTES = parseInt(process.env.TTS_MAX_BODY_BYTES || '262144', 10); // 256 KB
const MAX_INFLIGHT = parseInt(process.env.TTS_MAX_INFLIGHT || '24', 10); // a long absolution splits into ~15-20 /tts chunks (1 per sentence); 2 starved them -> 429 -> silence
const FETCH_TIMEOUT_MS = parseInt(process.env.TTS_FETCH_TIMEOUT_MS || '15000', 10); // upstream call cap
const ABS_MAX_INFLIGHT = parseInt(process.env.ABSOLUTION_MAX_INFLIGHT || '2', 10);  // /absolution concurrency cap

// --- Rate limiting: token buckets (in-memory; one process) -----------------
const globalBucket = makeBucket(60, 2);       // burst 60, ~2/s — one long absolution = ~15-20 /tts chunks
const ipBuckets = new Map();                  // per-IP: burst 60, ~5/s (set in ipBucket() below)
const IP_BUCKET_CAP = 5000;                   // prune idle buckets past this (loopback => ~1 entry)
let inFlight = 0;
let absInFlight = 0;
let usage = loadUsage();

// --- Static MIME types -----------------------------------------------------
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.gif': 'image/gif', '.ico': 'image/x-icon', '.glb': 'model/gltf-binary',
  '.gltf': 'model/gltf+json', '.bin': 'application/octet-stream', '.wasm': 'application/wasm',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.txt': 'text/plain; charset=utf-8',
  '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.wav': 'audio/wav', '.map': 'application/json',
};

const server = http.createServer(async (req, res) => {
  let pathname = '/';
  try { pathname = decodeURIComponent(new URL(req.url, `http://${HOST}`).pathname); }
  catch { return send(res, 400, 'text/plain', 'Bad request'); }

  if (pathname === '/tts/health') {
    return sendJson(res, 200, { ok: true, keyConfigured: !!API_KEY }); // no usage counts in the public payload
  }
  if (pathname === '/tts') {
    if (req.method === 'OPTIONS') return send(res, 204, 'text/plain', ''); // same-origin: no CORS headers
    if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
    return handleTts(req, res);
  }
  if (pathname === '/absolution/health') {
    return sendJson(res, 200, { ok: true, ...absolution.health() }); // never includes the key
  }
  if (pathname === '/absolution/categories') {
    // Canonical id+label list for the dev harm-picker UI (keeps it in sync with absolution.js).
    return sendJson(res, 200, { categories: absolution.CATEGORIES });
  }
  if (pathname === '/absolution') {
    if (req.method === 'OPTIONS') return send(res, 204, 'text/plain', '');
    if (req.method !== 'POST') return sendJson(res, 405, { error: 'Method not allowed' });
    return handleAbsolution(req, res);
  }
  if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { error: 'Method not allowed' });
  return serveStatic(req, res, pathname);
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`[tts-proxy] ${HOST}:${PORT} already in use; retrying in 2s`);
    setTimeout(() => server.listen(PORT, HOST), 2000);
  } else {
    console.error('[tts-proxy] server error:', e.message);
    process.exit(1);
  }
});

server.listen(PORT, HOST, () => {
  console.log(`[tts-proxy] static + /tts + /absolution listening on http://${HOST}:${PORT}  (root: ${REPO_ROOT})`);
  if (!process.env.MAGISTERIUM_API_KEY) {
    console.warn('[absolution] WARNING: MAGISTERIUM_API_KEY is not set — /absolution serves canned fallback text only.');
    console.warn('[absolution] Set it in deploy/tts-proxy/.env (copy from .env.example) to enable the LLM.');
  }
  if (HOST !== '127.0.0.1' && HOST !== '::1' && HOST !== 'localhost') {
    console.warn(`[tts-proxy] WARNING: bound to ${HOST} (not loopback). The key-protection and rate-limit`);
    console.warn('[tts-proxy] model assumes 127.0.0.1-only access — add real auth before exposing this.');
  }
  if (!API_KEY) {
    console.warn('[tts-proxy] WARNING: GOOGLE_TTS_API_KEY is not set. Static files serve, but POST /tts returns 503.');
    console.warn('[tts-proxy] Set it in deploy/tts-proxy/.env (copy from .env.example).');
  }
});

// --- POST /tts handler -----------------------------------------------------
async function handleTts(req, res) {
  if (!API_KEY) return sendJson(res, 503, { error: 'TTS proxy has no GOOGLE_TTS_API_KEY configured (deploy/tts-proxy/.env).' });

  const ip = req.socket.remoteAddress || 'local';

  let raw;
  try { raw = await readBody(req, MAX_BODY_BYTES); }
  catch (e) { return sendJson(res, e.code === 413 ? 413 : 400, { error: e.code === 413 ? 'Payload too large' : 'Failed to read body' }); }

  // Validate a PARSED COPY, but forward the ORIGINAL bytes (so enableTimePointing / SSML
  // encoding reach Google untouched — re-serializing risks silently breaking lip-sync).
  let body;
  try { body = JSON.parse(raw.toString('utf8')); }
  catch { return sendJson(res, 400, { error: 'Body must be JSON' }); }

  const text = body && body.input && (body.input.ssml || body.input.text);
  if (typeof text !== 'string' || !text.length) return sendJson(res, 400, { error: 'Missing input.ssml or input.text' });
  // Measure SPOKEN length (strip SSML tags) for the per-request gate so legitimate long
  // single sentences aren't rejected for <mark> markup. (Billing/cap below counts raw chars.)
  const spoken = body.input.ssml ? text.replace(/<[^>]+>/g, '') : text;
  if (spoken.length > MAX_INPUT_CHARS) return sendJson(res, 400, { error: `Input exceeds ${MAX_INPUT_CHARS} chars` });

  const voiceName = body.voice && body.voice.name;
  if (voiceName && !ALLOWED_VOICES.includes(voiceName)) {
    console.warn(`[tts-proxy] 400 disallowed voice=${voiceName}`);
    return sendJson(res, 400, { error: `Voice not allowed: ${voiceName}` });
  }
  const lang = body.voice && body.voice.languageCode;
  if (lang && !ALLOWED_LANGS.includes(lang)) return sendJson(res, 400, { error: `Language not allowed: ${lang}` });

  // Daily character cap (billing backstop, persisted across restarts). Counts raw request
  // chars (~ Google's SSML-inclusive billing), conservatively higher than spoken length.
  rollUsage();
  if (usage.chars + text.length > DAILY_CHAR_CAP) {
    console.warn(`[tts-proxy] 429 daily cap reached (${usage.chars}/${DAILY_CHAR_CAP})`);
    return sendJson(res, 429, { error: 'Daily TTS character cap reached' });
  }

  // Concurrency + rate limit LAST, so cheap rejections above don't spend tokens/slots.
  if (inFlight >= MAX_INFLIGHT) return sendJson(res, 429, { error: 'Too many concurrent TTS requests' });
  if (!take(globalBucket) || !take(ipBucket(ip))) {
    console.warn(`[tts-proxy] 429 rate-limited ip=${ip}`);
    return sendJson(res, 429, { error: 'Rate limit exceeded' });
  }

  inFlight++;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), FETCH_TIMEOUT_MS);
  try {
    const g = await fetch(`${TTS_ENDPOINT}?key=${encodeURIComponent(API_KEY)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: raw, // original bytes, unchanged
      signal: ac.signal,
    });
    const buf = Buffer.from(await g.arrayBuffer());
    if (g.status === 200) {
      usage.chars += text.length;
      saveUsage();
      res.writeHead(200, { 'Content-Type': g.headers.get('content-type') || 'application/json', 'Cache-Control': 'no-store' });
      res.end(buf);
      console.log(`[tts-proxy] /tts -> 200 chars=${text.length} voice=${voiceName || '-'} dayTotal=${usage.chars}`);
    } else {
      // Don't echo Google's error body to the client; keep the detail server-side only.
      console.warn(`[tts-proxy] google status=${g.status} body=${buf.toString('utf8').slice(0, 300)}`);
      sendJson(res, g.status >= 500 ? 502 : 400, { error: 'TTS upstream error', status: g.status });
    }
  } catch (e) {
    const timedOut = e.name === 'AbortError';
    console.error('[tts-proxy] upstream error:', timedOut ? `timeout after ${FETCH_TIMEOUT_MS}ms` : e.message);
    sendJson(res, timedOut ? 504 : 502, { error: timedOut ? 'TTS upstream timeout' : 'TTS upstream request failed' });
  } finally {
    clearTimeout(timer);
    inFlight--;
  }
}

// --- POST /absolution handler (ALG-15) -------------------------------------
// Accepts punch-card category totals and returns absolution text for the avatar to speak.
// getAbsolution() never throws — on a missing key, timeout, or upstream error it returns a
// canned absolution (source:"fallback") so the ritual never stalls. The Magisterium key is
// injected server-side inside absolution.js and never reaches this response.
async function handleAbsolution(req, res) {
  const ip = req.socket.remoteAddress || 'local';

  let raw;
  try { raw = await readBody(req, MAX_BODY_BYTES); }
  catch (e) { return sendJson(res, e.code === 413 ? 413 : 400, { error: e.code === 413 ? 'Payload too large' : 'Failed to read body' }); }

  let totals;
  try { totals = raw.length ? JSON.parse(raw.toString('utf8')) : {}; }
  catch { return sendJson(res, 400, { error: 'Body must be JSON (category totals)' }); }

  if (absInFlight >= ABS_MAX_INFLIGHT) return sendJson(res, 429, { error: 'Too many concurrent absolution requests' });
  // Use only the per-IP bucket here, NOT the shared globalBucket: each absolution is immediately
  // followed by a /tts call to speak it, and they must not compete for the same global tokens (which
  // could let the absolution succeed but rate-limit /tts -> a mute avatar). Concurrency + the daily
  // cap are the real backstops for /absolution.
  if (!take(ipBucket(ip))) {
    console.warn(`[absolution] 429 rate-limited ip=${ip}`);
    return sendJson(res, 429, { error: 'Rate limit exceeded' });
  }

  absInFlight++;
  try {
    const result = await absolution.getAbsolution(totals);
    // Return only what the client needs to speak; keep diagnostics server-side.
    sendJson(res, 200, { text: result.text, source: result.source, model: result.model });
  } catch (e) {
    // Defensive: getAbsolution shouldn't throw, but never leave the ritual without words.
    console.error('[absolution] unexpected error:', e.message);
    sendJson(res, 200, { text: absolution.bakedFallback([]), source: 'fallback', model: null });
  } finally {
    absInFlight--;
  }
}

// --- Static file serving (path-traversal, symlink & case safe) -------------
async function serveStatic(req, res, pathname) {
  if (pathname === '/') pathname = '/index.html';

  // Reject any dotfile segment (.env, .git, .usage.json, .DS_Store, ...). Case-independent.
  if (pathname.split('/').some((seg) => seg.startsWith('.') && seg !== '.' && seg !== '..')) {
    return send(res, 404, 'text/plain', 'Not found');
  }

  const resolved = path.resolve(REPO_ROOT, '.' + pathname);
  // Canonicalize (resolves symlinks AND case on case-insensitive filesystems), then enforce
  // containment against the canonical roots: must be under the repo root, never the proxy dir.
  let realPath;
  try { realPath = await fsp.realpath(resolved); }
  catch { return send(res, 404, 'text/plain', 'Not found'); }
  if (!isInside(realPath, REAL_REPO_ROOT)) return send(res, 403, 'text/plain', 'Forbidden');
  if (realPath === REAL_PROXY_DIR || isInside(realPath, REAL_PROXY_DIR)) return send(res, 404, 'text/plain', 'Not found');

  let st;
  try { st = await fsp.stat(realPath); }
  catch { return send(res, 404, 'text/plain', 'Not found'); }
  if (st.isDirectory()) return send(res, 404, 'text/plain', 'Not found');

  const type = MIME[path.extname(realPath).toLowerCase()] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': type, 'Content-Length': st.size, 'Cache-Control': 'no-cache' });
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(realPath).on('error', () => { if (!res.headersSent) send(res, 500, 'text/plain', 'Read error'); else res.end(); }).pipe(res);
}

// --- Helpers ---------------------------------------------------------------
function isInside(child, parent) {
  if (child === parent) return true;
  const rel = path.relative(parent, child);
  return !!rel && !rel.startsWith('..') && !path.isAbsolute(rel);
}

function makeBucket(capacity, refillPerSec) { return { tokens: capacity, last: Date.now(), capacity, refillPerSec }; }
function take(b) {
  const now = Date.now();
  b.tokens = Math.min(b.capacity, b.tokens + ((now - b.last) / 1000) * b.refillPerSec);
  b.last = now;
  if (b.tokens >= 1) { b.tokens -= 1; return true; }
  return false;
}
function ipBucket(ip) {
  let b = ipBuckets.get(ip);
  if (!b) {
    if (ipBuckets.size >= IP_BUCKET_CAP) {
      // Lazily evict idle buckets (refilled back to capacity carry no rate-limit state).
      const now = Date.now();
      for (const [k, v] of ipBuckets) {
        if (Math.min(v.capacity, v.tokens + ((now - v.last) / 1000) * v.refillPerSec) >= v.capacity) ipBuckets.delete(k);
      }
    }
    b = makeBucket(60, 5);
    ipBuckets.set(ip, b);
  }
  return b;
}

function readBody(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = []; let len = 0; let done = false;
    req.on('data', (c) => {
      if (done) return;
      len += c.length;
      if (len > maxBytes) { done = true; const e = new Error('too large'); e.code = 413; reject(e); return; } // don't destroy the shared socket
      chunks.push(c);
    });
    req.on('end', () => { if (!done) resolve(Buffer.concat(chunks)); });
    req.on('error', (e) => { if (!done) { done = true; reject(e); } });
  });
}

function todayUTC() { return new Date().toISOString().slice(0, 10); }
function loadUsage() {
  try { const u = JSON.parse(fs.readFileSync(USAGE_FILE, 'utf8')); if (u && u.date === todayUTC()) return u; } catch { /* ignore */ }
  return { date: todayUTC(), chars: 0 };
}
function rollUsage() { const d = todayUTC(); if (usage.date !== d) usage = { date: d, chars: 0 }; }
function saveUsage() {
  try { const tmp = USAGE_FILE + '.tmp'; fs.writeFileSync(tmp, JSON.stringify(usage)); fs.renameSync(tmp, USAGE_FILE); } // atomic
  catch { /* best effort */ }
}

function loadDotEnv(file) {
  let txt;
  try { txt = fs.readFileSync(file, 'utf8'); } catch { return; }
  for (const line of txt.split(/\r?\n/)) {
    if (line.trim().startsWith('#')) continue;
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let val = m[2];
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = val;
  }
}

function send(res, status, type, body) {
  if (res.writableEnded || res.destroyed) return;
  res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store' });
  res.end(body);
}
function sendJson(res, status, obj) { send(res, status, 'application/json; charset=utf-8', JSON.stringify(obj)); }

for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 500); });
