// Copy this file to `config.js` (same folder) and set your key.
// `config.js` is gitignored so the key never ends up in source control.
//
// You need a Google Cloud API key with the Cloud Text-to-Speech API enabled:
//   https://cloud.google.com/text-to-speech/docs/before-you-begin
//
// Note: client-side API keys are only safe for local/private experiments.
// For anything public, put the key behind a proxy (see TalkingHead Appendix B).

window.TALKINGHEAD_TTS_APIKEY = "your-key-here";

// Production kiosk: hide dev controls, enable visitor hardening.
// On the Pi, set to true in local config.js. Or append ?production=1 to the URL for testing.
window.TALKINGHEAD_PRODUCTION = false;

// Avatar: the CRT-oracle deliverable, committed in the repo and served from the root.
// This is the production avatar for the Office of Algorithmic Absolution.
window.TALKINGHEAD_AVATAR_URL = "docs/base/oracle-mpfb.glb";
// To use a different avatar, point this at any TalkingHead-compatible GLB
// (Mixamo rig + ARKit + Oculus visemes), a local path or an https URL. Unset it to
// fall back to ./avatar.glb dropped in this folder.
