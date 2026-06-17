# Kiosk proxy (ALG-8 TTS + ALG-15 absolution)

A zero-dependency Node server that does three things on **one `127.0.0.1` origin**:

1. **Serves the repo root as static files** — replaces `python3 -m http.server` so the kiosk page and the `/tts` + `/absolution` endpoints share an origin (no CORS).
2. **`POST /tts`** — injects the Google Cloud TTS API key **server-side** and forwards the request to Google. The browser never sees the key.
3. **`POST /absolution`** (ALG-15) — takes punch-card category totals and returns the absolution **text** for the avatar to speak, by querying the Magisterium AI API with a key injected **server-side**. See [absolution.js](absolution.js).

Both keys live only in `deploy/tts-proxy/.env` (gitignored) — `GOOGLE_TTS_API_KEY` and `MAGISTERIUM_API_KEY`. They are read via `process.env`, never written into a response, and never served as a static file. So the keys appear in **neither client source nor the network tab** — the done-when for ALG-8 and the key-storage requirement of ALG-15.

## Run

```bash
cp deploy/tts-proxy/.env.example deploy/tts-proxy/.env   # then set GOOGLE_TTS_API_KEY
node deploy/tts-proxy/server.js                           # serves http://127.0.0.1:8765/
```

`deploy/start-avatar.sh` launches this automatically; on the Pi, systemd runs that script.

## How it stays correct (TalkingHead contract)

TalkingHead builds its request as `fetch(ttsEndpoint + (ttsApikey ? "?key="+ttsApikey : ""))`. The client (`index.html`) sets `ttsEndpoint: "/tts"` and **omits `ttsApikey`**, so it POSTs the unmodified Google-shaped body to `/tts` with no key. The proxy:

- forwards to **`v1beta1/text:synthesize`** (v1 omits `timepoints` and would silently break lip-sync),
- appends `?key=<real key>` server-side,
- validates a parsed copy but **forwards the original request bytes** (so `enableTimePointing` and SSML encoding reach Google untouched),
- returns Google's JSON **verbatim** — `audioContent` (base64) + `timepoints` (`[{markName, timeSeconds}]`) — which TalkingHead needs for audio and lip-sync.

## Access control & abuse limits

- **`127.0.0.1`-bind is the primary control** — nothing off-box can reach the proxy, the same boundary the static server already relied on. (Any secret the browser could hold would itself be extractable, so a browser token would only be a speed bump.)
- **Rate limiting** — global token bucket (burst 60, ~2/s) + per-IP (burst 60, ~5/s) + a concurrency cap (`TTS_MAX_INFLIGHT`, 24). Sized so one long absolution — which TalkingHead splits into many per-sentence `/tts` calls — isn't throttled into silence.
- **Daily character cap** (`TTS_DAILY_CHAR_CAP`, default 200000, persisted to `.usage.json`, resets UTC midnight) — the real billing backstop. Long ~1800-char reads consume it ~3–4× faster; tune to your Google free tier for production.
- **Voice / language / length allowlists** — pins synthesis to the cheap Standard voices and bounds per-request cost; blocks forcing expensive Studio/WaveNet voices.

Configure all of these via env vars (see `.env.example`). As defense in depth, also restrict the Google key to the Text-to-Speech API and set a Cloud billing budget alert.

## Absolution endpoint (ALG-15)

`POST /absolution` accepts **which punch-card categories were declared** and returns the **spoken text** for the avatar to read. The avatar app calls it same-origin via `window.requestAbsolution(punched)` (in `index.html`), which passes the text to `window.avatarSpeak()`. A dev **harm-picker UI** in `index.html` (hidden in production) drives this end-to-end for testing — checkboxes for the ten categories + a "Request absolution" button. On request, the avatar **reads the declared harms back and speaks a holding line first** (TalkingHead queues speech), filling the ~25 s LLM wait, then speaks the response.

Request body — the punch card is **boolean** (a subset of the ten Form 1517-A categories; no counts). The orchestrator (ALG-13) sends **which categories were punched**, in any of these shapes (`normalizeTotals` maps them all to the canonical schedule; any count/flag is read as a boolean, unknown keys ignored):

```jsonc
// canonical ids (recommended)
{ "punched": ["taking_more_than_needed", "benefiting_from_underpaid_labor"] }
// 1-based schedule indices
[1, 5, 9]
// labels (case/space-insensitive)
{ "categories": ["Taking more than needed", "Pricing what should not be sold"] }
// flat map (truthy = punched)
{ "taking_more_than_needed": true, "consuming_faster_than_things_renew": 1 }
```

The ten canonical ids/labels are `CATEGORIES` in [absolution.js](absolution.js). The prompt simply **states the declared harms and speaks back the LLM's response** — no scripted offsets. Full prompt template: [docs/ABSOLUTION_PROMPT.md](../../docs/ABSOLUTION_PROMPT.md).

Response:

```json
{ "text": "These declarations are received and recorded...", "source": "magisterium", "model": "magisterium-1" }
```

- **`source: "magisterium"`** — generated live by the LLM. **`source: "fallback"`** — a pre-written canned line (see below).
- **Provider/model:** Magisterium AI, `magisterium-1` (OpenAI-compatible, grounded in Catholic magisterial sources). Endpoint/model are env-overridable. ⚠️ **Live caveat (ALG-14):** currently **no system prompt** is sent (experiment) — just the declared harms. Magisterium still answers with source-citing Catholic catechesis (~25 s, ~30k tokens), not a short reply; and the word *"absolution"* must stay out of anything sent or it refuses outright. The setup is LLM-agnostic — port to a general (non-RAG) model for a short, fast, cheap reply. See [docs/ABSOLUTION_PROMPT.md](../../docs/ABSOLUTION_PROMPT.md#magisterium--portability).
- **API-key storage:** `MAGISTERIUM_API_KEY` in `.env` only — server-side, never in the browser.
- **Latency budget (card → speech):** measured live latency is **~25 s** — Magisterium's RAG retrieval is slow. The proxy waits at most `ABSOLUTION_TIMEOUT_MS` (default **30 s**) then falls back to canned. ⚠️ Open UX problem: ~25 s of silence after a card is inserted is past gallery patience. The real fixes are a **holding utterance** while waiting and/or **caching/pre-baking** responses (the input space is tiny) to take the LLM off the hot path. TTS adds ~1–2 s.
- **Fallback when the API is down:** missing key, timeout, upstream error, empty response, or over the daily cap → a canned liturgical absolution (`source:"fallback"`), so the ritual never visibly stalls. The client (`index.html`) has its own canned line too, covering the case where the proxy itself is unreachable.
- **Cost backstop:** `ABSOLUTION_DAILY_REQUEST_CAP` (default **300** live calls/day, persisted to `.absolution-usage.json`); over the cap it serves canned text instead of spending quota.

Test it (no key needed — returns canned; with a key — returns live text):

```bash
curl -s -X POST http://127.0.0.1:8765/absolution \
  -H 'Content-Type: application/json' \
  -d '{"punched":["taking_more_than_needed","benefiting_from_underpaid_labor"]}' | python3 -m json.tool
curl -s http://127.0.0.1:8765/absolution/health | python3 -m json.tool
```

## Endpoints

| Method | Path                 | Purpose                                                       |
| ------ | -------------------- | ------------------------------------------------------------- |
| POST   | `/tts`               | Forward a TalkingHead TTS request to Google.                  |
| GET    | `/tts/health`        | Liveness + `{keyConfigured}`.                                 |
| POST   | `/absolution`        | Category totals → absolution text (Magisterium, ALG-15).      |
| GET    | `/absolution/health` | Liveness + `{keyConfigured, model, dailyRequests, …}`.        |
| GET    | `/*`                 | Static files from the repo root.                              |
