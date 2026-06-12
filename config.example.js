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

// Avatar: by default the page loads ./avatar.glb from this folder.
// Drop a TalkingHead-compatible GLB there (Mixamo rig + ARKit + Oculus visemes,
// e.g. a Ready Player Me export with ?morphTargets=ARKit,Oculus+Visemes,...).
// To load from a URL instead, uncomment and set:
// window.TALKINGHEAD_AVATAR_URL = "https://example.com/your-avatar.glb";
