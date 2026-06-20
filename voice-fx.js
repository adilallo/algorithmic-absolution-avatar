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
  // SHIPPING production voice (dialed in by the artist, 2026-06-20): Neural2-C pitched -6, slow (0.80),
  // high-passed and near-dry, with a real chapel impulse (docs/base/IR.wav, revLen 1.5) and the master
  // output stage (vol 1, compressor thresh -20 / ratio 3) leveling/clip-protecting. The one preset that
  // carries its own ttsPitch/ttsRate/ttsVoice + master params, so selecting it reproduces the full sound.
  // index.html ships this by default (and loads the IR + speech-realism layer).
  clear:        { hp: 150, warm: -1, dip: 1, sat: 0, wet: 0, bpFreq: 200, bpQ: 0.3, revAmt: 0.05, revLen: 1.5, vol: 1, compThresh: -20, compRatio: 3, ttsVoice: "en-US-Neural2-C", ttsPitch: -6, ttsRate: 0.80 },
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

// Shape a LOADED impulse (measured chapel etc.) with the SAME knobs as the synthetic one: trim/fade the
// tail to `secs` (revLen), scale the wet by `amt` (revAmt), and keep a unity direct spike so the dry voice
// stays intelligible. This is what gives the reverb sliders control over a loaded IR — without it the IR
// would play at a fixed level. raw = the decoded AudioBuffer stored on head.__irRaw by loadReverbIR().
export function processLoadedIR(ctx, raw, secs, amt) {
  const sr = ctx.sampleRate;
  const len = Math.max(1, Math.min(raw.length, Math.floor(sr * Math.max(0.02, secs))));
  const fade = Math.min(len - 1, Math.floor(sr * 0.02)) || 0;   // 20ms fade at the truncation (no click)
  const out = ctx.createBuffer(raw.numberOfChannels, len, sr);
  for (let c = 0; c < raw.numberOfChannels; c++) {
    const src = raw.getChannelData(c), dst = out.getChannelData(c);
    for (let i = 0; i < len; i++) {
      let g = amt;
      if (fade && i > len - fade) g *= (len - i) / fade;
      dst[i] = src[i] * g;
    }
    dst[0] += 1; // direct spike: the dry voice passes through unconvolved (revAmt 0 => fully dry)
  }
  return out;
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
  // Master output stage: reverb -> compressor (leveler/limiter) -> masterGain -> destination. Catches the
  // reverb's peaks (no limiter before = clipping risk) and sets overall loudness. TRANSPARENT by default
  // (ratio 1, threshold 0, unity gain) so production is unchanged until applyVoiceParams sets real values.
  try { out.disconnect(); } catch (e) {}                         // was reverb -> destination; reroute it
  const comp = ctx.createDynamicsCompressor();
  comp.knee.value = 12; comp.attack.value = 0.004; comp.release.value = 0.25;
  comp.threshold.value = 0; comp.ratio.value = 1;                // 1:1 = passthrough until configured
  const master = ctx.createGain(); master.gain.value = 1;
  out.connect(comp); comp.connect(master); master.connect(ctx.destination);
  const fx = { hp, warm, dip, shaper, bp, dry, wet, reverb: out, comp, master };
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
  // Reverb amount/length drive BOTH the synthetic tail AND a loaded impulse. loadReverbIR() stores the raw
  // IR on head.__irRaw; here revAmt scales its wet level and revLen trims its tail (a unity direct spike
  // keeps the dry voice). clearReverbIR() drops __irRaw and we fall back to the synthetic tail.
  head.audioReverbNode.buffer = (head.__irLoaded && head.__irRaw)
    ? processLoadedIR(ctx, head.__irRaw, p.revLen, p.revAmt)
    : makeIR(ctx, p.revLen, p.revAmt);
  // Master output stage. Defaults keep it transparent (vol 1, ratio 1, threshold 0) so a preset that
  // omits these — e.g. production's "clear" — sounds exactly as before; the lab sets real values.
  if (fx.master) fx.master.gain.value = p.vol ?? 1;
  if (fx.comp) { fx.comp.threshold.value = p.compThresh ?? 0; fx.comp.ratio.value = p.compRatio ?? 1; }
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
