# Office of Algorithmic Absolution — Talking Avatar

Talking-head avatar software for **Office of Algorithmic Absolution**, a kinetic installation where participants confess via punch card and receive algorithmic absolution from a screen above the altar. This repo covers only that avatar: a browser-based 3D character that speaks LLM-generated text aloud with lip sync.

Built on [TalkingHead](https://github.com/met4citizen/TalkingHead) (Three.js + Google Cloud TTS). In production, absolution text comes from upstream; the included text input UI is for local dev and rehearsal.

## Setup

1. Set the TTS key **server-side** (never in the browser): copy `deploy/tts-proxy/.env.example` to `deploy/tts-proxy/.env` and set `GOOGLE_TTS_API_KEY` (a [Google Cloud Text-to-Speech](https://cloud.google.com/text-to-speech/docs/before-you-begin) key).
2. Copy `config.example.js` to `config.js`. It holds **no secrets** — just the production flag and the avatar URL. Add a TalkingHead-compatible GLB at `avatar.glb` (Mixamo-style rig + ARKit + Oculus visemes — e.g. a [Ready Player Me](https://readyplayer.me/) export with `?morphTargets=ARKit,Oculus+Visemes,...` appended), or set `window.TALKINGHEAD_AVATAR_URL` in `config.js`.
3. Run the proxy, which serves the page **and** the `/tts` endpoint from one origin (ES modules will not load from `file://`):

```bash
node deploy/tts-proxy/server.js
```

Open `http://127.0.0.1:8765/`, type text, press Enter or click **Speak**. See [deploy/tts-proxy/README.md](deploy/tts-proxy/README.md) for how the proxy keeps the key off the client.

## Production / kiosk

Production hides dev controls and runs fullscreen for the altar screen. See [deploy/README.md](deploy/README.md) for full Pi setup.

1. In `config.js`, set `window.TALKINGHEAD_PRODUCTION = true` (or use `?production=1` on the URL for testing).
2. Launch presentation mode (oracle kiosk + punch-card form):

```bash
./deploy/start-avatar.sh
```

For the final altar install (oracle only, no form): `AVATAR_ORACLE_ONLY=1 ./deploy/start-avatar.sh`

3. Upstream systems trigger speech via the browser global (devtools for testing):

```js
avatarSpeak("Test absolution.");
```

## Notes

- `config.js`, `avatar.glb`, and `deploy/tts-proxy/.env` are gitignored — they stay local.
- The Google TTS key lives only in `deploy/tts-proxy/.env` (server-side) and never reaches the browser — no key in client source or the network tab (ALG-8). The proxy follows TalkingHead's "Appendix B" pattern.
