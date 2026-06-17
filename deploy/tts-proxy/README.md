# TTS proxy (ALG-8)

A zero-dependency Node server that does two things on **one `127.0.0.1` origin**:

1. **Serves the repo root as static files** — replaces `python3 -m http.server` so the kiosk page and the `/tts` endpoint share an origin (no CORS).
2. **`POST /tts`** — injects the Google Cloud TTS API key **server-side** and forwards the request to Google. The browser never sees the key.

The key lives only in `deploy/tts-proxy/.env` (gitignored) as `GOOGLE_TTS_API_KEY`. It is read via `process.env`, never written into a response, and never served as a static file. After this proxy, the Google key appears in **neither client source nor the network tab** — the done-when for ALG-8.

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
- **Rate limiting** — global token bucket (~10 req/min) + per-IP (1 req/s, burst 5) + a concurrency cap.
- **Daily character cap** (`TTS_DAILY_CHAR_CAP`, persisted to `.usage.json`) — the real billing backstop.
- **Voice / language / length allowlists** — pins synthesis to the cheap Standard voices and bounds per-request cost; blocks forcing expensive Studio/WaveNet voices.

Configure all of these via env vars (see `.env.example`). As defense in depth, also restrict the Google key to the Text-to-Speech API and set a Cloud billing budget alert.

## Endpoints

| Method | Path          | Purpose                                          |
| ------ | ------------- | ------------------------------------------------ |
| POST   | `/tts`        | Forward a TalkingHead TTS request to Google.     |
| GET    | `/tts/health` | Liveness + `{keyConfigured, dailyChars}`.        |
| GET    | `/*`          | Static files from the repo root.                 |
