// Copy this file to `config.js` (same folder). `config.js` is gitignored.
//
// NO SECRETS GO HERE — config.js is served to the browser. The Google Cloud TTS API key
// now lives ONLY server-side, in deploy/tts-proxy/.env (see deploy/tts-proxy/.env.example).
// The page calls TTS through the same-origin proxy at /tts, so the key is never in client
// source or the network tab (ALG-8).

// Optional: point the client at a different proxy origin (default is same-origin "/tts").
// window.TALKINGHEAD_TTS_PROXY = "/tts";

// Production kiosk: hide dev controls, enable visitor hardening.
// On the Pi, set to true in local config.js. Or append ?production=1 to the URL for testing.
window.TALKINGHEAD_PRODUCTION = false;

// Avatar: the CRT-oracle deliverable, committed in the repo and served from the root.
// This is the production avatar for the Office of Algorithmic Absolution.
window.TALKINGHEAD_AVATAR_URL = "docs/base/oracle-icon-heart.glb";
// To use a different avatar, point this at any TalkingHead-compatible GLB
// (Mixamo rig + ARKit + Oculus visemes), a local path or an https URL. Unset it to
// fall back to ./avatar.glb dropped in this folder.
