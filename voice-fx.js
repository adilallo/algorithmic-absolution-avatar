// Absolution voice effects (ALG-9) — SHARED by index.html (production) and
// oracle-voice-audition.html (tuning), so what you dial in is exactly what ships.
//
// A cheap Web Audio chain spliced at TalkingHead's persistent
//   audioSpeechGainNode -> audioReverbNode
// edge. The per-utterance speech source reconnects upstream at the analyser, so the splice
// survives across utterances. All DSP runs on the audio thread, OFF the 60fps GPU budget.
// Re-installed idempotently because TalkingHead can rebuild its graph and does NOT persist reverb.
//
// Signal: speechGain -> highpass -> warmth(lowshelf) -> presence-dip(peaking) -> [ dry path ]
//                                                                              \-> [ saturation -> bandpass -> wet ]
//         both rejoin at TalkingHead's convolver (the reverb), which -> destination.
// Reverb is the in-line convolver: the IR has a unity DIRECT spike at t=0 (keeps the voice
// intelligible) plus a decaying-noise tail scaled by `revAmt` (the reverb amount).

// Full parameter set (every knob the audition tool exposes):
//   hp      high-pass cutoff Hz (removes pitch-down rumble)
//   warm    low-shelf gain dB @200Hz (chest/body/authority)
//   dip     peaking gain dB @3kHz (negative = more detached/less forward)
//   sat     waveshaper saturation 0..~0.5 (transmission grit; 0 = clean)
//   wet     transmission-band send gain 0..~0.7 (intercom color; 0 = none)
//   bpFreq  transmission band-pass centre Hz
//   bpQ     transmission band-pass Q
//   revAmt  reverb tail amount 0..~0.8 (0 = dry)
//   revLen  reverb tail length seconds (~RT60)
// A preset MAY also carry ttsPitch/ttsRate/ttsVoice — TTS request params (not audio-graph FX). Most
// presets omit them (FX-only) and leave whatever pitch/rate the avatar was created with. When present,
// applyTtsParams() writes them onto head.avatar so selecting the preset reproduces the full voice.
// Only `clear` (the shipping voice) carries them today.
export const VOICE_PRESETS = {
  // SHIPPING production voice (dialed in by the artist): near-dry, warm, present — a close, intelligible
  // read with only a hint of room. The one preset that carries its own ttsPitch/ttsRate/ttsVoice, so
  // selecting it reproduces the full dialed-in sound. index.html ships this by default.
  clear:        { hp: 75,  warm: 16, dip: 0,  sat: 0.0,  wet: 0.05, bpFreq: 2300, bpQ: 1.9, revAmt: 0.05, revLen: 0.25, ttsVoice: "en-US-Standard-C", ttsPitch: -5, ttsRate: 0.80 },
  // Prior production look (ALG-9): deep + slow + warm + reverberant, a low boxy "transmission" tint.
  // Pairs with ttsVoice en-US-Standard-C, ttsPitch -6.5, ttsRate 0.82.
  absolution:   { hp: 90,  warm: 10, dip: -4, sat: 0.1,  wet: 0.15, bpFreq: 500,  bpQ: 0.6, revAmt: 0.75, revLen: 0.65 },
  dry:          { hp: 90,  warm: 3,  dip: -2, sat: 0.0,  wet: 0.0,  bpFreq: 1700, bpQ: 0.8, revAmt: 0.0,  revLen: 0.6 },
  chamber:      { hp: 90,  warm: 4,  dip: -2, sat: 0.0,  wet: 0.0,  bpFreq: 1700, bpQ: 0.8, revAmt: 0.28, revLen: 0.6 },
  transmission: { hp: 120, warm: 3,  dip: -2, sat: 0.25, wet: 0.5,  bpFreq: 1500, bpQ: 0.9, revAmt: 0.18, revLen: 0.35 },
  oracle:       { hp: 90,  warm: 4,  dip: -3, sat: 0.12, wet: 0.4,  bpFreq: 1700, bpQ: 0.8, revAmt: 0.4,  revLen: 0.85 },
};

export function satCurve(amount) {
  const n = 1024, c = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    c[i] = amount <= 0 ? x : Math.tanh(x * (1 + amount * 3)) / Math.tanh(1 + amount * 3);
  }
  return c;
}

// IR = unity direct spike + decaying-noise tail * revAmt. revAmt 0 => pure dry passthrough.
export function makeIR(ctx, secs, revAmt) {
  const len = Math.max(1, Math.floor(ctx.sampleRate * Math.max(0.02, secs)));
  const b = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const d = b.getChannelData(ch);
    d[0] = 1; // direct sound — keeps consonants crisp
    for (let i = 1; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.exp(-3.2 * i / len) * revAmt;
  }
  return b;
}

// Build the chain once on the head's audio graph. Idempotent: returns the existing chain if the
// graph is intact, rebuilds if TalkingHead recreated audioReverbNode. Returns the fx object or null.
export function installVoiceFX(head) {
  const ctx = head.audioCtx;
  if (!ctx || !head.audioSpeechGainNode || !head.audioReverbNode) return null;
  const existing = head.__voiceFx;
  if (existing && existing.reverb === head.audioReverbNode) return existing;
  const inTap = head.audioSpeechGainNode, out = head.audioReverbNode;
  try { inTap.disconnect(); } catch (e) {}
  const hp = ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 90;
  const warm = ctx.createBiquadFilter(); warm.type = "lowshelf"; warm.frequency.value = 200;
  const dip = ctx.createBiquadFilter(); dip.type = "peaking"; dip.frequency.value = 3000; dip.Q.value = 1;
  const shaper = ctx.createWaveShaper(); shaper.oversample = "4x";
  const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = 1700; bp.Q.value = 0.8;
  const dry = ctx.createGain(); dry.gain.value = 1; const wet = ctx.createGain(); wet.gain.value = 0;
  inTap.connect(hp); hp.connect(warm); warm.connect(dip);
  dip.connect(dry); dry.connect(out);                            // clean, intelligible path (always on)
  dip.connect(shaper); shaper.connect(bp); bp.connect(wet); wet.connect(out); // colored "transmission" send
  const fx = { hp, warm, dip, shaper, bp, dry, wet, reverb: out };
  head.__voiceFx = fx;
  return fx;
}

// Write a full parameter set onto the (installed) chain. Cheap; safe to call live from sliders.
export function applyVoiceParams(head, p) {
  const fx = installVoiceFX(head), ctx = head.audioCtx;
  if (!fx || !ctx) return;
  fx.hp.frequency.value = p.hp;
  fx.warm.gain.value = p.warm;
  fx.dip.gain.value = p.dip;
  fx.shaper.curve = satCurve(p.sat);
  fx.bp.frequency.value = p.bpFreq; fx.bp.Q.value = p.bpQ ?? 0.8;
  fx.wet.gain.value = p.wet;
  head.audioReverbNode.buffer = makeIR(ctx, p.revLen, p.revAmt);
}

// Apply the TTS request params a preset MAY carry (ttsPitch/ttsRate/ttsVoice) onto head.avatar, so
// the next utterance is synthesized with them. These are NOT audio-graph FX (applyVoiceParams handles
// those) — they go to Google TTS via TalkingHead. FX-only presets omit these keys, so this is a no-op
// for them and the avatar keeps whatever pitch/rate it was created with.
export function applyTtsParams(head, p) {
  if (!head || !head.avatar || !p) return;
  if (p.ttsVoice != null) head.avatar.ttsVoice = p.ttsVoice;
  if (p.ttsPitch != null) head.avatar.ttsPitch = p.ttsPitch;
  if (p.ttsRate  != null) head.avatar.ttsRate  = p.ttsRate;
}
