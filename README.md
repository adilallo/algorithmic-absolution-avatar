# TalkingHead kiosk

Browser-based talking avatar using [TalkingHead](https://github.com/met4citizen/TalkingHead) (Three.js + Google Cloud TTS + lip sync).

## Setup

1. Copy `config.example.js` to `config.js` and set a [Google Cloud Text-to-Speech](https://cloud.google.com/text-to-speech/docs/before-you-begin) API key.
2. Add a TalkingHead-compatible GLB at `avatar.glb` (Mixamo-style rig + ARKit + Oculus visemes — e.g. a [Ready Player Me](https://readyplayer.me/) export with `?morphTargets=ARKit,Oculus+Visemes,...` appended). Or set `window.TALKINGHEAD_AVATAR_URL` in `config.js` to load from a URL instead.
3. Serve over HTTP (ES modules will not load from `file://`):

```bash
python3 -m http.server 8765
```

Open `http://127.0.0.1:8765/`, type text, press Enter or click **Speak**.

## Notes

- `config.js` and `avatar.glb` are gitignored — they stay local.
- Client-side API keys are fine for local experiments only. For anything public, proxy TTS through your backend (see TalkingHead Appendix B).
