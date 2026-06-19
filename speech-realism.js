// Speech-realism layer (ALG — voice-realism pass, 2026-06-19) for the Office of Algorithmic
// Absolution avatar. SHARED by oracle-voice-audition.html (tuning) and, once dialed in, by
// index.html (production) — same single-source pattern as voice-fx.js, so what you audition is
// exactly what ships.
//
// Three independent, toggleable levers — all on TalkingHead's SUPPORTED surface (the only internal
// touch is reading/queuing through head.speechQueue + the public isSpeaking flag; no method is
// monkey-patched). Every lever respects the hieratic gaze-lock: nothing here moves head/neck bones.
//
//   1. speakShaped()         Viseme intensity + closure shaping. TalkingHead's text path bakes a
//                            STATIC 0.6 peak into every viseme (PP/FF 0.9); a slow oracle voice reads
//                            "mushy" at 0.6. We lift non-closure visemes toward `visemeLevel` for a
//                            fuller, more dynamic mouth, keeping labial closures (PP/FF) crisp. All of
//                            TalkingHead's TTS chunking + <mark> timepoint alignment is preserved.
//   2. installAudioFacial()  Audio-COUPLED micro-motion: reads real speech loudness off the head's
//                            AnalyserNode each frame and drives a subtle additive browInnerUp + jawOpen,
//                            plus a blink at speech->silence gaps. No word timing needed; couples to the
//                            actual audio, so it tracks the voice exactly and never desyncs.
//   3. setAffect()           A solemn brow/mouth baseline held while speaking, released after.
//
// Plus helpers: loadReverbIR()/clearReverbIR() (audition a real chapel impulse in the convolver) and
// cleanForSpeechClient() (a client mirror of the proposed absolution.js cleanForSpeech upgrades, so
// the prosody/cadence change can be heard in the preview before it's baked server-side).

export const REALISM_DEFAULTS = {
  // --- mouth (visemes) ---
  visemeLevel: 0.85,   // peak amplitude for non-closure visemes (TalkingHead default 0.6; 1.0 = full)
  closureBoost: true,  // keep PP/FF labial closures crisp (>= 0.95) so plosives still "pop"
  adaptive: true,      // duration-adaptive intensity: longer-held mouth shapes open MORE, brief ones stay tight
  adaptiveAmt: 0.30,   // extra openness a fully-held viseme gets above visemeLevel (capped at 1.0)
  jawMode: 'viseme',   // jaw motion source: 'viseme' (opens with open vowels -> reads as speech, RECOMMENDED)
                       //   | 'audio' (raw loudness -> can look chewy on consonants) | 'off'
  jawCouple: 0.22,     // jawOpen depth coupled to open vowels when jawMode === 'viseme'
  // --- audio-coupled face ---
  audioFacial: true,
  browAmt: 0.16,       // max additive browInnerUp at full speech loudness
  browAsym: 0.30,      // L/R brow asymmetry 0..1 (0 = mechanically symmetric; faces are never symmetric)
  jawAmt: 0.12,        // max additive jawOpen at full loudness — jawMode 'audio' ONLY
  gain: 1.0,           // loudness sensitivity multiplier (tune per voice/level)
  gapBlink: true,      // blink at speech->silence boundaries (clause/sentence gaps)
  // --- eyes ---
  saccade: true,       // continuous sub-degree eye micro-darts so the gaze isn't dead-still
  saccadeAmt: 0.045,   // dart amplitude (gaze-lock-safe; well below a real gaze shift)
  gazeDown: true,      // brief contemplative look-down at sentence-end gaps (within the gaze-lock)
  gazeDownAmt: 0.06,   // how far the eyes drop during a gap
  // --- breath / settle ---
  preBreath: true,     // a held beat (soft blink + faint inhale-brow) before the first word reads as drawing breath
  preBreathMs: 450,    // length of that settle
  // --- affect baseline ---
  affect: true,
  affectBrow: 0.10,    // solemn inner-brow lift held during speech
  affectFrown: 0.07,   // faint mouth-frown gravity (sacred, not sad)
};

// Per-viseme jaw-opening weight. Open vowels drop the jaw; labial/closed consonants keep it shut,
// so the jaw tracks the mouth shapes instead of raw volume. Keyed by BOTH naming conventions
// (TalkingHead's RPM-style I/O/U and the avatar's Oculus-style ih/oh/ou) so the lookup never misses.
const JAW_W = {
  aa: 1.0, O: 0.82, oh: 0.82, U: 0.55, ou: 0.55, E: 0.5, I: 0.35, ih: 0.35,
  CH: 0.25, DD: 0.25, kk: 0.22, RR: 0.2, TH: 0.16, nn: 0.12, SS: 0.1, FF: 0.06, PP: 0.0, sil: 0.0,
};

// Viseme NAME mismatch fix. TalkingHead's lipsync-en emits Ready-Player-Me viseme names
// (viseme_I / viseme_O / viseme_U); this project's custom MPFB/Blender avatar carries the Oculus
// names (viseme_ih / viseme_oh / viseme_ou). Unmapped, the close/round-vowel visemes write to morphs
// that don't exist -> silent no-ops -> the mouth never rounds/spreads. Remap to whatever the avatar
// actually has. Bidirectional so it's correct whichever convention the loaded GLB uses.
const VISEME_ALIAS = { I: 'ih', O: 'oh', U: 'ou', ih: 'I', oh: 'O', ou: 'U' };
function avatarVisemeKey(head, key) {            // key like 'viseme_I'
  if (!head.mtAvatar || (key in head.mtAvatar)) return key;
  const alt = VISEME_ALIAS[key.slice(7)];        // 'viseme_'.length === 7
  return (alt && ('viseme_' + alt) in head.mtAvatar) ? 'viseme_' + alt : key;
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// ---- 1. Viseme intensity + closure shaping --------------------------------------------------
// Speak through the normal text path, but block TalkingHead's internal auto-start first (by holding
// isSpeaking true — startSpeaking() early-returns while speaking) so NOTHING is dequeued/processed
// during speakText. That leaves every freshly-queued viseme template mutable; we rescale its baked
// 0.6/0.9 peak, then release the flag and start the queue ourselves. Idempotent (it SETS, not scales),
// so re-running over already-shaped items is harmless. If the avatar was already speaking, we just
// shape the new tail and let the running queue pick it up.
export function speakShaped(head, text, R = REALISM_DEFAULTS, opt = null) {
  const level = clamp(R.visemeLevel ?? 0.85, 0.6, 1.0);
  const start = head.speechQueue.length;
  const wasSpeaking = head.isSpeaking;
  if (!wasSpeaking) head.isSpeaking = true;          // guard out speakText's internal startSpeaking()
  try {
    head.speakText(text, opt);
  } finally {
    for (let i = start; i < head.speechQueue.length; i++) {
      const item = head.speechQueue[i];
      if (!item || !Array.isArray(item.anim)) continue;
      for (const a of item.anim) {
        if (a?.template?.name !== 'viseme' || !a.vs) continue;
        // Rebuild vs so we can RENAME viseme keys to the avatar's morphs (I/O/U -> ih/oh/ou) — a plain
        // amplitude edit in place would leave the dead RPM-named key untouched and the mouth silent.
        const newVs = {};
        for (const k in a.vs) {
          if (!k.startsWith('viseme_')) { newVs[k] = a.vs[k]; continue; }
          const arr = a.vs[k];
          if (!Array.isArray(arr) || typeof arr[1] !== 'number') { newVs[k] = arr; continue; }
          const name = k.slice(7);                         // TalkingHead's viseme id, e.g. 'U'
          const ak = avatarVisemeKey(head, k);             // the morph the avatar actually has
          const isClosure = (ak === 'viseme_PP' || ak === 'viseme_FF');
          // Duration-adaptive: the viseme's hold (its span in the word, from the 3-point ts) lifts its
          // peak above `level` — long vowels open more, glancing shapes stay tight. Self-limiting, so it
          // adds dynamics without over-exposing the coarse mouth. ts is still normalized here (pre-TTS).
          let peak = level;
          if (R.adaptive && Array.isArray(a.ts) && a.ts.length >= 3) {
            const hold = a.ts[2] - a.ts[1];          // = this viseme's duration as a fraction of its word
            peak = Math.min(1.0, level + (R.adaptiveAmt ?? 0.30) * clamp(hold / 0.45, 0, 1));
          }
          arr[1] = isClosure ? (R.closureBoost ? Math.max(arr[1], 0.95) : arr[1]) : peak;
          newVs[ak] = arr;
          // Couple the jaw to the vowel shapes: a jawOpen keyframe on this viseme's own 3-point timing,
          // scaled by open-vowel weight (vowels drop the jaw, consonants close it). 'audio'/'off' skip.
          if (R.jawMode === 'viseme') {
            newVs.jawOpen = [null, (JAW_W[name] ?? 0) * (R.jawCouple ?? 0.22), 0];
          }
        }
        a.vs = newVs;
      }
    }
    if (!wasSpeaking) { head.isSpeaking = false; head.startSpeaking(); }
  }
}

// ---- 2. Audio-coupled facial micro-motion ---------------------------------------------------
// One rAF loop reading the head's AnalyserNode (fftSize 256). While isSpeaking, map low-mid speech
// energy -> additive browInnerUp + jawOpen via setFixedValue (a fixed overlay that releases cleanly
// to null). A run of near-silent frames after audible speech triggers a single blink (the natural
// place blinks land). Returns a controller; call setOpts() to retune live, stop() to remove.
export function installAudioFacial(head, R = REALISM_DEFAULTS) {
  const an = head.audioAnalyzerNode;
  if (!an) return { stop() {}, setOpts() {} };
  const bins = new Uint8Array(an.frequencyBinCount);
  const opts = { ...R };
  let raf = 0, silent = 0, blinked = false, released = true;
  let wasSilent = true, accent = 0;          // phrase-onset accent envelope (frames)
  let sacTimer = 0;                          // micro-saccade countdown (frames)

  const loud = () => {
    an.getByteFrequencyData(bins);
    // bins 2..~34 cover the vocal fundamental + first formants at this fftSize/SR.
    let s = 0, n = Math.min(bins.length, 34), c = 0;
    for (let i = 2; i < n; i++) { s += bins[i]; c++; }
    return clamp((s / (c * 200)) * (opts.gain ?? 1), 0, 1);   // 0..1 perceptual-ish loudness
  };

  const release = () => {
    if (released) return;
    if (opts.jawMode === 'audio') head.setFixedValue('jawOpen', null, 160);
    head.setFixedValue('browInnerUp', null, 220);   // -> baseline (affect) or 0
    head.setFixedValue('browOuterUpLeft', null, 220);
    head.setFixedValue('browOuterUpRight', null, 220);
    released = true; silent = 0; blinked = false; wasSilent = true; accent = 0;
  };

  const loop = () => {
    raf = requestAnimationFrame(loop);
    const speaking = head.isSpeaking;
    const L = speaking ? loud() : 0;
    const inGap = speaking && L < 0.05;                  // a within-utterance silence = clause/sentence end

    // (A) EYES: contemplative look-DOWN during sentence-end gaps; otherwise continuous micro-saccades.
    // Both stay sub-degree / within the gaze-lock — no head motion.
    if (opts.gazeDown && inGap) {
      head.setFixedValue('eyesRotateX', opts.gazeDownAmt ?? 0.06, 240);   // ease the eyes down
      head.setFixedValue('eyesRotateY', 0, 240);
      sacTimer = 0;                                       // re-arm a dart the instant speech resumes
    } else if (opts.saccade) {
      if (--sacTimer <= 0) {
        const a = opts.saccadeAmt ?? 0.045;
        const centre = Math.random() < 0.45;
        head.setFixedValue('eyesRotateY', centre ? 0 : (Math.random() * 2 - 1) * a, 45);
        head.setFixedValue('eyesRotateX', centre ? 0 : (Math.random() * 2 - 1) * a * 0.5, 45);
        sacTimer = 40 + Math.floor(Math.random() * 70);   // ~0.7–1.8s between darts @60fps
      }
    }

    // (B) Speech-coupled brow / jaw / blink.
    if (!speaking) { release(); return; }
    released = false;

    if (opts.audioFacial) {
      const browBase = opts.affect ? (opts.affectBrow ?? 0.10) : 0;
      const brow = browBase + L * (opts.browAmt ?? 0.16) + (accent > 0 ? (accent / 14) * 0.12 : 0);
      const asym = opts.browAsym ?? 0.30;
      head.setFixedValue('browInnerUp', brow);
      head.setFixedValue('browOuterUpLeft',  brow * 0.5 * (1 + asym));
      head.setFixedValue('browOuterUpRight', brow * 0.5 * (1 - asym));
    }
    if (opts.jawMode === 'audio' && opts.audioFacial) {
      head.setFixedValue('jawOpen', L * (opts.jawAmt ?? 0.12));
    }
    if (accent > 0) accent--;

    // gaps -> blink + arm the next phrase-onset accent
    if (L < 0.05) {
      if (++silent === 5 && !blinked) { if (opts.gapBlink) blink(head); blinked = true; }
      wasSilent = true;
    } else {
      if (wasSilent) accent = 14;        // speech resumed -> brief brow accent on the new phrase
      silent = 0; blinked = false; wasSilent = false;
    }
  };
  raf = requestAnimationFrame(loop);
  return {
    stop() { cancelAnimationFrame(raf); release(); head.setFixedValue('eyesRotateY', null, 200); head.setFixedValue('eyesRotateX', null, 200); },
    setOpts(o) {
      const prevJaw = opts.jawMode;
      Object.assign(opts, o);
      // leaving 'audio' jaw mode: drop any lingering fixed jawOpen so the viseme-coupled jaw is free
      if (prevJaw === 'audio' && opts.jawMode !== 'audio') head.setFixedValue('jawOpen', null, 120);
      if (!opts.saccade) { head.setFixedValue('eyesRotateY', null, 200); head.setFixedValue('eyesRotateX', null, 200); }
    },
  };
}

// A single human-paced blink (~250ms): snap closed, brief hold, ease open back to baseline.
export function blink(head) {
  head.setFixedValue('eyeBlinkLeft', 1, 40);
  head.setFixedValue('eyeBlinkRight', 1, 40);
  setTimeout(() => {
    head.setFixedValue('eyeBlinkLeft', null, 130);
    head.setFixedValue('eyeBlinkRight', null, 130);
  }, 90);
}

// A held beat before the first word — reads as drawing breath / gathering to speak. A soft blink plus a
// faint inhale-brow that releases as speech begins, then a stillness pause. Await this before speaking.
export async function preSpeechSettle(head, R = REALISM_DEFAULTS) {
  blink(head);
  const browBase = (R.affect ? (R.affectBrow ?? 0.10) : 0) + 0.06;
  head.setFixedValue('browInnerUp', browBase, 220);
  await new Promise(r => setTimeout(r, Math.max(0, R.preBreathMs ?? 450)));
  head.setFixedValue('browInnerUp', null, 200);   // the audio-coupled loop takes over as speech starts
}

// ---- 3. Solemn affect baseline --------------------------------------------------------------
// neutral mood's baseline only sets eyesLookDown:0.1, so these don't fight it. NOTE: setMood() rebuilds
// ALL baselines (wiping this) — re-apply after any setMood call.
export function setAffect(head, on, R = REALISM_DEFAULTS) {
  const brow = on ? (R.affectBrow ?? 0.10) : null;
  const frown = on ? (R.affectFrown ?? 0.07) : null;
  head.setBaselineValue('browInnerUp', brow);
  head.setBaselineValue('mouthFrownLeft', frown);
  head.setBaselineValue('mouthFrownRight', frown);
}

// ---- Reverb impulse-response loader (chapel IR) ---------------------------------------------
// Decode a measured impulse (wav/mp3) into TalkingHead's convolver — far more convincing than
// voice-fx's synthetic exponential-noise tail. Sets head.__irLoaded so voice-fx's applyVoiceParams
// won't clobber it on the next slider move (see voice-fx.js).
export async function loadReverbIR(head, arrayBuffer) {
  const buf = await head.audioCtx.decodeAudioData(arrayBuffer.slice(0));
  if (head.audioReverbNode) head.audioReverbNode.buffer = buf;
  head.__irLoaded = true;
  return buf.duration;
}
export function clearReverbIR(head) { head.__irLoaded = false; }

// ---- Client mirror of the proposed absolution.js cleanForSpeech upgrades --------------------
// Spelling out digits/abbreviations and isolating em-dashes is the highest-leverage prosody lever
// (it's the only one that survives TalkingHead's text escaping). This lets the preview HEAR the
// change before it's baked into absolution.js on the server. Conservative on purpose.
const ONES = ['zero','one','two','three','four','five','six','seven','eight','nine','ten','eleven',
  'twelve','thirteen','fourteen','fifteen','sixteen','seventeen','eighteen','nineteen'];
const TENS = ['','','twenty','thirty','forty','fifty','sixty','seventy','eighty','ninety'];
function intToWords(n) {
  n = parseInt(n, 10);
  if (!Number.isFinite(n)) return String(n);
  if (n < 0) return 'minus ' + intToWords(-n);
  if (n < 20) return ONES[n];
  if (n < 100) return TENS[Math.floor(n / 10)] + (n % 10 ? '-' + ONES[n % 10] : '');
  if (n < 1000) return ONES[Math.floor(n / 100)] + ' hundred' + (n % 100 ? ' ' + intToWords(n % 100) : '');
  if (n < 1000000) return intToWords(Math.floor(n / 1000)) + ' thousand' + (n % 1000 ? ' ' + intToWords(n % 1000) : '');
  return String(n); // leave very large numbers alone
}
const ABBREV = [
  [/\bSt\.\s/g, 'Saint '], [/\bMt\.\s/g, 'Mount '], [/\bDr\.\s/g, 'Doctor '],
  [/\bNo\.\s*/g, 'number '], [/\bvs\.?\b/gi, 'versus'], [/\b&\b/g, 'and'],
  [/(\d)\s*%/g, '$1 percent'], [/\$\s*(\d)/g, '$1 dollars'], [/\bca\.\s/gi, 'about '],
];
export function cleanForSpeechClient(s) {
  let out = String(s);
  for (const [re, to] of ABBREV) out = out.replace(re, to);
  out = out.replace(/\d+/g, (m) => intToWords(m));          // standalone integers -> words
  out = out.replace(/\s*[—–]\s*/g, ' — ');                  // isolate em/en dashes so TTS -> <break>
  out = out.replace(/\s{2,}/g, ' ').trim();
  return out;
}
