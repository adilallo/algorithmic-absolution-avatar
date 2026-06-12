# Office of Algorithmic Absolution — Talking Avatar

Talking-head avatar software for **Office of Algorithmic Absolution**, a kinetic installation where participants confess via punch card and receive algorithmic absolution from a screen above the altar. This repo covers only that avatar: a browser-based 3D character that speaks LLM-generated text aloud with lip sync.

Built on [TalkingHead](https://github.com/met4citizen/TalkingHead) (Three.js + Google Cloud TTS). In production, absolution text comes from upstream; the included text input UI is for local dev and rehearsal.

## Setup

1. Copy `config.example.js` to `config.js` and set a [Google Cloud Text-to-Speech](https://cloud.google.com/text-to-speech/docs/before-you-begin) API key.
2. Add a TalkingHead-compatible GLB at `avatar.glb` (Mixamo-style rig + ARKit + Oculus visemes — e.g. a [Ready Player Me](https://readyplayer.me/) export with `?morphTargets=ARKit,Oculus+Visemes,...` appended). Or set `window.TALKINGHEAD_AVATAR_URL` in `config.js` to load from a URL instead.
3. Serve over HTTP (ES modules will not load from `file://`):

```bash
python3 -m http.server 8765
```

Open `http://127.0.0.1:8765/`, type text, press Enter or click **Speak**.

## Production / kiosk

Production hides dev controls and runs fullscreen for the altar screen. See [deploy/README.md](deploy/README.md) for full Pi setup.

1. In `config.js`, set `window.TALKINGHEAD_PRODUCTION = true` (or use `?production=1` on the URL for testing).
2. Serve the repo and launch kiosk mode:

```bash
./deploy/start-avatar.sh
```

3. Upstream systems trigger speech via the browser global (devtools for testing):

```js
avatarSpeak("Test absolution.");
```

## Notes

- `config.js` and `avatar.glb` are gitignored — they stay local.
- Client-side API keys are fine for local experiments only. For anything public, proxy TTS through your backend (see TalkingHead Appendix B).
