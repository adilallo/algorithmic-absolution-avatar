# Avatar handoff — Office of Algorithmic Absolution

**Status as of 2026-06-12.** This document is written for the next agent/developer picking up the avatar work. It covers what exists, how it was built, what's left, and the gotchas.

---

## ⚡ OPEN WORK — pick up here (updated 2026-06-12)

**Read this section first.** It lists everything still to do so you can start immediately. Detail/history is in the rest of the doc.

### Current state in one paragraph
The avatar is the MPFB oracle at **`docs/base/oracle-mpfb.glb`** (source: `docs/base/oracle-mpfb-working.blend`, open in the connected Blender). Done & verified: head-tilt fixed (single-neck topology), mid skin material, CRT render-layer tuned + framed (`oracle-preview.html`), Pi half-res bloom, **arm/shoulder bone-roll fixed** (deltoids no longer collapse), idle tuned (gaze-locked, calm), **legs/pelvis bone-roll fixed** (round 3 — collapse gone, verified before/after under TalkingHead), and the **oracle is now the production avatar** (`config.js` → `docs/base/oracle-mpfb.glb`, verified the kiosk loads it), and the **CRT grade is now ported into the production `index.html`** (round 4 — see §4 block; verified in dev + production, lip-sync confirmed through the grade). **Nothing structural is open** — remaining work is the deferred look (hair/collar, §4.5), optional polish (§4 #4), and on-Pi 60fps validation (ALG-21). (The mouth is **RESOLVED 2026-06-13, round 3e** — both the see-through corner holes and the jagged/fragmented open mouth are fixed; root cause was three concentric free loops, not a corner-only defect. See round 3e under §4. Artist: "looking pretty good.")

### TODO (prioritized)

1. **Mouth — ✅ RESOLVED 2026-06-13 (round 3e — see §4 block).** Both the see-through corner holes **and** the jagged/fragmented open mouth are fixed. Root cause was **three concentric free loops** (upper margin / lip-contact seam / a wider inner-cavity rim), not a corner-only defect — so rounds 3c (repaint) and 3d (corner weld) below patched only the symptom and did not hold. The 3e fix: weld redundant corner dups (all-68-key-coincident only) + Laplacian-smooth the rim loops with the same delta across all 68 keys + additive triangle-fan seal at each commissure. Verified in Blender (watertight see-through test) and the kiosk (clean load, clean open mouth). History below is the v3 topology rebuild; v5 narrowed the opening; **v6 cleaned the closed-mouth corner "fragments"** the artist flagged — they were dark vertex-paint (not holes; corners verified watertight), repainted so dark = the cut line corner-to-corner + occluded interior only. mouthfix_v2 (vertex-color-only, no cut) still did not read as opening and showed artifacts, because the **lips were a fused sealed surface that was never physically separated** — `jawOpen` just stretched the sealed skin into a protruding flap, and the "gaps above the upper lip" the artist saw were v2's dark-oval paint + distorted geometry, not mesh holes. **v3 actually opens the mouth** (details in the round-3b/v3 block under §4): (a) **ripped the lip-contact seam** — traced a Dijkstra crease path from corner to corner and `edge_split` it, so the upper and lower lip are topologically separate (coincident at rest → looks closed; lower drops freely → real opening); (b) `jawOpen` = **jaw hinge** about X at `(y=0.02,z=1.55)`, `ANGLE=0.22·weight`, lower lip+chin+jaw rotate down/back, **upper lip + nose pinned to weight 0** (no nose distortion), lateral corner-taper so the commissures stay shut; (c) **occlusion-based dark vertex color** (`Col`/COLOR_0) — verts hidden from the front at rest are painted dark, so the opening reads as a dark mouth without darkening the closed lips; (d) the 5 open visemes recomposed from the new hinge + pucker/stretch. **Verified live in the kiosk (real Google-TTS path): clean closed mouth at rest, lips part with a dark interior during speech, upper lip/nose stable, zero console errors.** **Known tradeoff (artist call):** thick sealed MakeHuman lips can't separate *fully* without ragged face-deletion, so at large opens the inner contact can show faint light strips behind the clean front rim — chose a clean REST + dark interior, which the CRT grade will further hide. Tunable: `ANGLE` (open amount), `corner_taper` extent, dark value. Recipe in the **`lipfix`** text datablock (now the v3 record). **The old v2 "set lipfix to 0 to revert" path is obsolete** — `jawOpen`/visemes were rebuilt and the mesh was re-cut; revert by reloading `docs/base/oracle-mpfb.backup-prefix.glb` or `/tmp/oracle-premouthcut-backup/`.

2. **Port the CRT render-layer into the production kiosk (`index.html`) — ✅ DONE 2026-06-13 (round 4 — see §4 block).** The full render-layer (`EffectComposer` chain with half-res bloom, `head.render` monkeypatch, rim-light halo, telephoto head-and-shoulders framing, dim cool lighting on the constructor, and the baked `window.ORACLE` knobs) was lifted from `oracle-preview.html` into `index.html` via `setupOracleRenderLayer()`, called after `showAvatar()`. **Decision (artist sub-question): the grade applies in BOTH dev and production** — dev just overlays the Speak controls so you preview the real shipped look; `oracle-preview.html` or `ORACLE.mono=0; ORACLE.bloom=0` still give a raw view, and it's a one-line gate (`if (isProduction) setupOracleRenderLayer()`) to make it production-only. Verified live in both modes (zero console errors, look matches the preview) and the morph/lip-sync path renders correctly through the composer (drove `jawOpen`/`viseme_aa` — clean dark-interior open under the grade). **Still pending:** real on-Pi 60fps validation (ALG-21), and the `fov:10` telephoto framing may want a small re-tune for the actual kiosk monitor's aspect ratio (vertically aspect-robust, so the head height holds; wider/narrower screens just show more/less dark void).

3. **Hair + clothes (deferred look work).** Plan: download MPFB hair/clothing asset packs from makehumancommunity.org, fit + weight them, dress the avatar (dark high-collar so shoulders fade to black + backlit wavy hair for the halo), render, evaluate; try a different approach (hair cards, etc.) if not liked. Artist is open to keeping it bald/unclothed too. See §4.5.

4. **Optional polish.** (a) Custom `oracle` mood to suppress TalkingHead's 5–30 s pose/weight-shift cycle (clone the `neutral` mood in `head.animMoods`, collapse the `pose` alt-list to one symmetric standing pose). (b) Pin the importmap from `TalkingHead@1.7` (floating) to `@1.7.0` exactly for kiosk reproducibility. (c) Low priority, don't show at head-and-shoulders framing: residual rest-*direction* mismatches that bone-roll can't absorb — `LeftUpLeg`/`RightUpLeg` ~21° (re-aim the thigh bone if a full-body shot ever needs it), `Shoulder` clavicle ~20°, thumb/finger 5–45°.

**✅ DONE this session (round 3) — see the round-3 status block under §4:** legs/pelvis bone-roll fix (was #1), and oracle-as-production-avatar (was #3).

### Methods & assets the next agent should reuse
- **TalkingHead 1.7 key fact:** it writes ABSOLUTE bone-local quaternions from RPM/"brunette"-frame pose templates every frame and **never reads the avatar's rest roll** — so any roll mismatch (arms, now hips) must be fixed **at the rig**, not via poses/animation. Mixamo can drive the BODY (name-matched, strip `mixamorig`, scale 0.01) but NOT the mouth (morph-driven). Breathing is a bone-scale channel (`chestInhale` → Spine1/Neck/Arm scale), not a mesh morph — no breathing morph needed.
- **Re-roll recipe (used for arms + legs; hips deliberately skipped — see round 3):** re-import `avatar.glb` (brunette) → extract per-bone world Z `(armature.matrix_world @ bone.matrix_local).col[2]` → delete import → EDIT mode `align_roll(brunette_world_z)` → verify the bone's world-Z angle delta vs brunette drops → re-export. Roll-only, preserves weights/A-pose; re-export refreshes bind matrices. **Caveat:** `align_roll` fixes only the *roll* component — where a bone's rest *direction* also differs from brunette (UpLeg ~21°, clavicle ~23°, Hips ~90°), a residual remains that only re-aiming the bone could remove.
- **Mouth re-tune state:** `lipfix` text datablock in the .blend (JSON of applied amounts per morph; idempotent — set to 0 and re-run to revert).
- **Backups:** `docs/base/oracle-mpfb.backup-prefix.{glb,blend}` predate ALL fixes — reloading them loses every fix; prefer surgical edits. (The `.blend` source is kept in sync with the GLB after each fix.)
- **Re-export flags (load-bearing):** select `Armature`+`Human`+`MouthCavity` all unhidden, `export_format='GLB', use_selection=True, export_yup=True, export_skins=True, export_morph=True, export_morph_normal=False, export_morph_tangent=False, export_apply=False, export_def_bones=False, export_vertex_color='ACTIVE'`. (`export_morph_normal=False` keeps the file ~2.4 MB; leaving it True tripled it. `export_vertex_color='ACTIVE'` is required so the mouth's dark `Col`/COLOR_0 attribute ships.)
- **Preview/verify:** Blender MCP is connected. ⚠️ **Two-repo gotcha:** the work lives in `~/Documents/GitHub/algorithmic-absolution-avatar`, but the **preview tool reads `.claude/launch.json` from the *primary* working dir** `~/Desktop/Raphael Project/Algorithmic-Absolution-Avatar` — that's the launch.json whose configs the preview server actually runs. It has `"oracle"` (serves `/tmp/oserve`, port 8768), `"kiosk"` (serves `/tmp/kioskserve`, port 8769), and `"approot"` (serves the GitHub **repo root**, port 8772 — added round 3, the faithful way to test the real `index.html`+`config.js`). After a Blender re-export, copy the GLB into `/tmp/oserve/avatar.glb` (etc.) and reload.
- **Full-body / arbitrary camera in `oracle-preview.html`:** the preview bakes a telephoto head-and-shoulders camera, and TalkingHead's view system + `setView()` fight manual `camera.position` overrides. To frame the **full body** (e.g. to inspect legs/pelvis), the reliable trick: `head.stop()` (halt the loop), set `head.camera` (fov/position/lookAt + `updateProjectionMatrix`), `head.scene.updateMatrixWorld(true)`, then `head.renderer.setRenderTarget(null); head.renderer.render(head.scene, head.camera)` — a one-off **raw** render (also bypasses the CRT grade for clean geometry). `head.start()` to resume. Hold a morph with `window.__head.setBaselineValue('viseme_aa', 0.6)`. Tune mouth geometry fastest by setting `shape_key.value` in Blender and OpenGL-rendering the mouth (no export/reload loop).

---

## 1. TL;DR — where we are

We have a **blank, androgynous, TalkingHead-compatible avatar base** built from MPFB (MakeHuman for Blender):

- **`docs/base/oracle-mpfb.glb`** — the deliverable. 2.3 MB. Mixamo-named rig (root object `Armature`, 57 bones, all 25 TalkingHead-required bones, no `mixamorig` prefix) + **all 52 ARKit blendshapes + 15 Oculus visemes**. Verified: it **loads in TalkingHead** (`showAvatar` resolves cleanly, TalkingHead expands it to 72 morphs) and the visemes deform the mouth correctly (jawOpen, viseme_aa, mouthClose etc. all confirmed in Blender).
- **`docs/base/oracle-mpfb-working.blend`** — the Blender source for that GLB (11 MB). Open this to iterate.
- It is intentionally **blank**: default white material (no skin tone), **no hair, no clothes** (per direction: get the motions working first, refine the look later).

**Update 2026-06-12 — items 4.1–4.4 are DONE** (see the Status block under §4). The head-tilt bug is **fixed**; its real root cause was rig **topology** (a 3-bone MakeHuman neck where TalkingHead drives only a single `Neck`), **not** the bone-roll guess originally written here. Lip-sync, the CRT look + a skin material, and a Pi-5 perf pass are also done. Remaining: hair/collar (§4.5) and on-Pi validation.

---

## 2. Project context (the look we're aiming for)

- **Installation:** "Office of Algorithmic Absolution" — visitors confess via punch card; an avatar on a screen above an altar delivers algorithmic absolution. This repo is **only the avatar layer** (browser, TalkingHead 1.7 + Three.js 0.180 + Google Cloud TTS). In production, speech text arrives from upstream via `window.avatarSpeak(text)`.
- **Target look = "CRT oracle":** androgynous, solemn, backlit; monochrome **steel‑blue** with **CRT scanlines, vignette, film grain, soft bloom**, like a transmission on an old video monitor. Reference image: **`docs/refs/oracle-reference.png`**. (Earlier the look was framed as a Knowledge Navigator agent; that's superseded by this CRT‑oracle reference.)
- **Hair:** explicitly **deferred** — no hair for now.
- **Hard constraint:** runs on a **Raspberry Pi 5** (VideoCore VII, WebGL via Chromium, no discrete GPU) at **60 fps fullscreen**. Keep the asset light (the 2.3 MB base is good; watch post-processing cost).

---

## 3. Key files

| Path | What it is |
|------|-----------|
| `docs/base/oracle-mpfb.glb` | **The avatar deliverable** (MPFB base, Mixamo + visemes). |
| `docs/base/oracle-mpfb-working.blend` | Blender source for the GLB. Scene = `Armature` + `Human`. |
| `docs/refs/oracle-reference.png` | The CRT‑oracle look reference image. |
| `oracle-preview.html` | **CRT render-layer prototype** (see §5). Standalone page; applies the blue/scanline/vignette/grain/bloom + backlight treatment over a TalkingHead avatar. Tunable live via `window.ORACLE.*`. |
| `index.html` | The production kiosk (loads `./avatar.glb`, `window.avatarSpeak`, `?production=1`). **Has pre-existing uncommitted WIP — left untouched.** |
| `avatar.glb` | Restored TalkingHead sample (`brunette.glb`). **Reference only**, gitignored. NOTE: an earlier 20 MB sample here was accidentally overwritten and lost; this is the canonical TalkingHead sample re-downloaded. |
| `docs/CONTEXT.md` | Existing hardware/kiosk context doc (Pi 5 spec, ALG-* Linear issues). |

### Branch layout (committed locally, not pushed)

- **`oracle-look`** — the avatar work: `oracle-mpfb.glb` + `oracle-mpfb-working.blend`, `oracle-preview.html`, `docs/refs/`, `docs/HANDOFF.md`. Start here for avatar/oracle work.
- **`adilallo/alg-6-configure-kiosk-mode`** — the ALG-6 kiosk work: production mode in `index.html`, `README`, `config.example.js`, `docs/CONTEXT.md`, `deploy/`.

Both branch off `master` and are **local only — not yet pushed**. They're independent, so `oracle-look`'s `index.html` is the *pre-ALG-6* version (no production mode); if you need the full kiosk to test lip-sync, merge `adilallo/alg-6-configure-kiosk-mode` (or work from it). `avatar.glb` and `config.js` are gitignored; `.claude/` (local preview tooling) is left untracked.

---

## 4. TODO (prioritized)

### Status — 2026-06-12 (items 4.1–4.4 complete)

- **4.1 Head tilt — ✅ FIXED.** Root cause was **topology, not bone roll**. Our rig had a 3-bone MakeHuman neck (`Neck`→`Neck1`→`Neck2`→`Head`) where `Neck2` leaned ~63° forward at rest; TalkingHead 1.7 only ever drives the bones literally named `Neck` and `Head` (absolute local-quaternion replacement, `talkinghead.mjs` ~1554), so the undriven `Neck2` lean stayed baked in and tipped the head down once TalkingHead overwrote `Head`. Fix: merged `Neck1`/`Neck2` vertex weights into `Neck` (ADD), collapsed to a single `Neck`→`Head`, cleaned rolls, and re-pointed the eye bones to the RPM `+Z`-up convention. Verified in TalkingHead: head sits level (Head world-up went from ~63° forward to ~18°, which renders as a calm direct gaze). Bone count 57→55; all 67 morphs + skin preserved. Backups: `docs/base/oracle-mpfb.backup-prefix.glb` and `…working.backup-prefix.blend` (safe to delete once you're happy).
- **4.2 Lip-sync — ✅ VERIFIED end-to-end.** Real Google-TTS path through `index.html` (`avatarSpeak` → TTS → audio + viseme timing → morphs). 9 distinct visemes fired with strong peaks plus coarticulation `mouth*` shapes; gaze saccades present (morph-driven).
- **4.3 CRT look + skin — ✅ DONE.** Added a mid warm-skin material (`OracleSkin`) to the GLB (pure white was blowing out under bloom). Retuned `oracle-preview.html` for the MPFB base and **baked the values into the file**: `cameraView:"head"` + explicit telephoto head-and-shoulders framing (fov 10, cam `(0,1.60,2.95)`, target `(0,1.55,0)`), lights ambient `0.20`/direct `1.4`, bloom `0.55`@thresh `0.72`, rim `22`, vignette `1.7`. Result matches the CRT-oracle reference (sans hair).
- **4.4 Pi-5 perf — ✅ optimization done; on-Pi validation still pending (ALG-21).** Render load is tiny (~27k tris, 1 skinned mesh, 72 morphs). The EffectComposer runs at CSS resolution; UnrealBloom is the dominant pass, so it now renders at **half resolution** (~4× cheaper, visually identical). Real 60 fps fullscreen confirmation needs the actual Pi 5.

### Status — 2026-06-12 (round 2: shoulders, mouth, idle)

Two further bugs the artist flagged, both fixed (kept the MPFB base; chose targeted fixes over regenerating the avatar). Backed by two adversarially-verified research workflows reading TalkingHead 1.7 source.

- **Concave shoulders — ✅ FIXED (bone-roll, like the neck).** The base mesh is fine at rest; TalkingHead writes absolute bone-local rotations authored in the RPM/"brunette" frame every frame and never reads our rest roll, so our **arm-chain bones (MakeHuman roll, ~90° off)** collapsed the deltoid when posed. Fix: `align_roll`'d `Shoulder`/`Arm`/`ForeArm`/`Hand` + all 30 finger bones (mirrored L/R) to brunette's world Z axes, re-exported. Verified: `Arm` 91.5°→5.5°, `ForeArm`→6.5°, `Hand`→6.7°; deltoids now render full and natural. Residuals left as-is (don't show): `Shoulder` clavicle ~20° (its rest *direction* differs ~23° from brunette, beyond what roll can absorb) and thumb/finger rolls 5–45° (irrelevant for a static head-and-shoulders oracle).
- **Lips don't open — ⚠️ PARTIAL / still broken (see OPEN WORK #2).** The cross-mesh viseme *transfer* low-pass-filtered away the lip-parting differential: `jawOpen` dropped the chin ~30 mm but the lower-lip seam edge only followed ~2 mm (`viseme_aa` <1 mm) — lips stayed kissed shut. Attempted fix: identified the **278 lower-lip verts** (mouth region with downward `jawOpen` motion) and translated them down — `jawOpen` +9 mm, plus a lip-drop + a blend of the fixed `jawOpen` into the open vowels (`viseme_aa/E/ih/oh/ou`). Result per the artist watching it live: **the lips move more but the mouth still does not read as opening, and the edit STRETCHED THE NOSE DOWN (a regression).** My static Blender/CRT screenshots looked open, but the live speech result does not. So this is unfinished and introduced an artifact — see OPEN WORK #2 for the diagnosis and the clean redo. Re-tune state is in the `lipfix` text datablock in the .blend (JSON of applied per-morph amounts; idempotent — set values to 0 and re-export to fully revert). Mixamo is irrelevant to the mouth (morph-driven) — confirmed.
- **Idle animation — ✅ tuned (config only).** The body "animation" is TalkingHead's procedural idle (not a clip). Added `showAvatar` options for a calm, gaze-locked oracle: `avatarIdleEyeContact 0.85` (was 0.2), `avatarIdleHeadMove 0.2` (was 0.5), `avatarSpeakingEyeContact 0.9`, `avatarSpeakingHeadMove 0.3` — in both `index.html` and `oracle-preview.html`. Breathing already works (it's a bone-scale channel, not a morph — no GLB change needed). *Not yet done (optional):* a custom `oracle` mood to suppress the 5–30 s pose/weight-shift cycle, and pinning the importmap to `TalkingHead@1.7.0` exactly.
- **Resolved in round 3:** the oracle is now the production avatar (see the round-3 block).

### Status — 2026-06-12 (round 3: legs/pelvis bone-roll + production avatar)

- **Legs/pelvis collapse — ✅ FIXED (bone-roll, like the shoulders).** Confirmed the diagnosis with a fresh research pass on the **actual TalkingHead 1.7 source**: poses are absolute bone-local quaternions (rest roll never read — re-confirmed); the **default standing pose is `poseTemplates['side']`** (`this.poseName="side"`), which authors `LeftUpLeg.rotation.z ≈ 2.983` / `RightUpLeg.z ≈ 2.912` (≈±π — the convention for Mixamo thigh bones pointing down) and drives the legs every frame. Our leg chain was rolled ~160–175° off → that absolute thigh rotation twisted our thighs → pelvis "collapse." **Fix:** `align_roll`'d `LeftUpLeg/LeftLeg/LeftFoot/LeftToeBase` + Right mirror to brunette's world-Z, re-exported. Verified roll-Z deltas vs brunette: UpLeg 158.7°→**21.1°**, Leg 175°→**5.0°**, Foot 168.5°→**10.7°**, Toe 171.5°→**4.9°** (deltas baked into the GLB, confirmed by re-importing the export). **Verified before/after in TalkingHead** at full-body framing: the twisted/pinched thighs are now smooth and natural. The **UpLeg ~21° residual is a rest-*direction* mismatch** (its bone direction differs 21° from brunette; `align_roll` only fixes roll) — not visually objectionable, left as a residual like the clavicle (see polish #4c).
- **Hips — deliberately NOT touched.** Our `Hips` differs from brunette by ~90° in *direction* (not just roll), which `align_roll` can't fix. But TalkingHead drives `Hips` only with a *tiny* absolute rotation (`side`: `{-0.003,-0.017,0.1}` rad ≈ 5.7° max) + small sway, so the wrong-axis error is negligible and the body already stands upright (head level, shoulders fine). Re-aiming the body-root bone is the riskiest possible edit (it rotates everything under it) for a tilt that's both tiny and outside the head-and-shoulders shot — so it was left alone. Re-aim only if a full-body shot ever demands it.
- **Oracle is now the production avatar — ✅ DONE.** `config.js` and committed `config.example.js` set `window.TALKINGHEAD_AVATAR_URL = "docs/base/oracle-mpfb.glb"`. `deploy/start-avatar.sh` serves the **repo root**, so that relative path resolves locally and on the Pi. The gitignored brunette `avatar.glb` (roll reference) is **untouched** — nothing was overwritten. Verified: serving the repo root, `index.html` resolves the oracle URL, `showAvatar` succeeds (`avatarSpeak` ready, canvas present, **zero console errors**), and the kiosk renders the fixed MPFB oracle. **Caveat → new TODO #2:** `index.html` renders the avatar **raw** — the CRT grade is still only in `oracle-preview.html`.
- **Housekeeping:** the `.blend` shrank 13 MB → ~2.4 MB on save — this is benign orphan removal (`orphans_purge` cleared accumulated brunette-import datablocks from prior re-roll sessions); the live scene + GLB round-trip intact (55 bones, 68 shape keys, `OracleSkin`). Pre-fix safety backups for this round: `/tmp/oracle-prehips-backup/` (PREHIPS `.glb`+`.blend` + brunette ref), plus Blender's auto `oracle-mpfb-working.blend1` (the pre-purge 13 MB version). The `backup-prefix.{glb,blend}` files still predate ALL fixes.

### Status — 2026-06-12 (round 3b: mouth rebuild — mouthfix_v2)

The old mouth attempt was discarded and rebuilt from scratch (the old `lipfix` "set values to 0 to revert" path is **obsolete** — `jawOpen` and the open visemes were overwritten, not boosted). New approach, all in `oracle-mpfb-working.blend`, reproducibility record in the **`lipfix` text datablock** (now JSON of the v2 params/recipe, `use_fake_user=True`):

- **`jawOpen` = jaw-hinge.** Lower-lip + chin + jaw verts rotate down/back about an X-axis hinge at `(y=0.02, z=1.55)` by `ANGLE=0.13·weight`. The weight field is built analytically (vertical band across the seam `z≈1.498`, lateral taper to the corners, front-only) then Laplacian-smoothed (4 iters) with **upper-lip verts and all verts `z≥1.52` (philtrum/nose) pinned to 0** — so the nose/upper lip provably do not move (this was the artist's "nose doubling" bug). `jawOpen = Basis + hinge`, idempotent.
- **Dark interior = vertex color, not a material.** A `POINT` color attribute `Col` (exported as `COLOR_0`, which glTF multiplies into baseColor and Three.js honors via `material.vertexColors`) darkens a smooth oval (`CZ=1.492, RX=0.034, RZ=0.017`, min value 0.06) around the mouth. Smooth per-vertex → **no jaggedness** (per-face material darkening was tried first and looked ragged — rejected). Export needs `export_vertex_color='ACTIVE'`.
- **`MouthCavity`** — a dark ellipsoid mesh (material `MouthDark`) behind the lips, weighted 100% to the `Head` bone, exported alongside (3 objects now: `Armature`+`Human`+`MouthCavity`). Backs deeper opens so you never see through to lit skin/void. TalkingHead renders the extra mesh fine.
- **Open visemes recomposed.** `viseme_aa/E/ih/oh/ou = Basis + a·(new jawOpen hinge) + b·mouthPucker + c·(mouthStretchL+R)` (coeffs in the record) so speech opens cleanly with rounding/spread. Consonant/closure visemes (`PP/FF/…`) were untouched (already clean).
- **Verified** in TalkingHead at the 0.6 viseme cap (jawOpen and viseme_aa): clean dark open, nose unaffected, smooth. **Needs the artist's live-speech sign-off** and possible coefficient tuning (open amount, dark-oval extent, closed-mouth shading). Re-export flags: same load-bearing set **plus** `export_vertex_color='ACTIVE'`; select all three objects.

### Status — 2026-06-12 (round 3c: mouth corner fragments — mouthfix_v6)

The artist reported, after iterating to **v5** (live `lipfix` record had narrowed the opening + a "hard clamp" attempt), that the closed mouth still showed **dark angular fragments at the bottom of each commissure** and asked to "make sure our cut is from one corner to the other." The artist described them as **holes**. Diagnosis + fix this round (paint-only; **no geometry change → all 68 shape keys preserved**):

- **They are NOT mesh holes — they are dark vertex-paint.** Verified three ways: (1) a front ray-cast over the corner grid finds it **fully covered by front-facing faces** (0 see-through pixels, even with `jawOpen=0.6`); (2) backface-cull renders are **identical** to no-cull (a real hole would differ); (3) the dark tracks the `Col` paint. The corner geometry is watertight. The 3 boundary loops at the mouth are just the intended **coincident `edge_split` rip** (104 duplicate vert pairs running corner-to-corner; commissure tips are single shared verts) — no extra gap. (There ARE ~120 near-zero-area "sliver" faces and unwelded coincident corner pairs; if a true see-through is ever confirmed from a below/angled view, weld the coincident pairs at `|x|>=0.034` — static under the jawOpen corner-taper, so shape-key-safe — to clear the slivers.)
- **Why it read as fragments:** the occlusion-based dark paint over-reached onto front-visible corner verts. At the commissure the topology fans radially, so dark inner-roll verts (the lips' own inner roll, `y≈-0.13`, normals pointing back so a naive front test calls them "occluded") project to a **blob below/beside each corner**.
- **Fix (the rule, now the `lipfix` v6 record):** dark = **the rip-seam/cut verts (corner-to-corner) + the occluded-at-rest interior** (which is what reads when the mouth opens). **Lighten every other front-visible-at-rest dark vert** — the corner fans, the below-lip flecks, and the commissure inner-roll blobs — using a BVHTree front-visibility ray test. Then **taper** the dark line's last few mm into each commissure (`|x|>0.036` smooth fade to skin) so it ends clean with no terminal dot.
- **Result:** a **clean continuous thin dark line from one commissure to the other**, no corner shards, closed mouth clean, and the **opening still reads with a full dark interior**. Verified live in `oracle-preview` (CRT grade, zero console errors — closed mouth clean, `jawOpen 0.5 + viseme_aa 0.45` opens with dark interior) and in Blender solid+vertex-color renders.
- **State note:** the separate `MouthCavity` mesh referenced in the v2 block above is **gone** in the live file — the scene is now just **`Armature` + `Human`** (2 objects; the `MouthInterior` material slot exists but has 0 faces). **Re-export selects those 2 objects**, same load-bearing flags **+ `export_vertex_color='ACTIVE'`**. GLB re-exported to `docs/base/oracle-mpfb.glb` (2.5 MB) and `.blend` saved in sync.

### Status — 2026-06-13 (round 3e: mouth RESOLVED — unified cause, not a corner-only defect) ✅

**This supersedes rounds 3c/3d.** Round 3d's corner weld did **not** hold — the artist still saw see-through holes head-on **and** a jagged/fragmented OPEN mouth. The corners were a *symptom*, not the disease.

- **Real root cause (one defect, both symptoms):** the lip region had **THREE concentric free boundary loops**, none joined to each other — `UP` (upper-lip outer margin, ~all pinned, y≈-0.153), `LO` (the lip-contact seam that parts, pinned+moving twins, y≈-0.149), and `MID` (inner-cavity rim, y≈-0.142, **wider**: x±0.0333 vs the lips' ±0.029). The cavity rim poking laterally past the lips = the **see-through corner holes** when closed; `LO` **and** `MID` each having a lower arc that drops separately under `jawOpen` (plus a z-zigzag/sawtooth in the rim verts) = the **layered, jagged, fragmented opening**.
- **The fix (in-place, all shape-key-safe, verified):** (1) **weld** the ~20 truly-redundant duplicate verts at the corners — only pairs coincident across **all 68 shape keys** *and* jaw-disp < 0.5 mm, so the openable-seam twins (which separate up to 27 mm) are auto-excluded; (2) **smooth the rim loops** — compute a de-zigzag Laplacian offset on the Basis and add the *identical* per-vert delta to all 68 key_blocks, so every pose (closed, open, every viseme) gets a clean rim while the relative motion/deltas are preserved exactly; (3) **seal each commissure** with an explicit additive triangle fan from the lip-tip vertex over the cavity's lateral corner arc — `bmesh.faces.new` by index, **no new/moved verts**, so the shape-key fingerprint stays byte-identical. Mesh 13436→13416 v, +44 faces.
- **Verified:** Blender — closed clean, open smooth, **corners watertight** (Workbench SINGLE-color + backface-cull + magenta-bg test → zero bleed-through), `mouthPucker`/`viseme_aa`/`jawOpen` all intact, 68 keys preserved. Kiosk — loaded `oracle-mpfb.glb` in `oracle-preview.html?url=docs/base/oracle-mpfb.glb`, **zero console errors**, clean closed mouth, and `head.setFixedValue('jawOpen',0.7)` shows a clean open mouth with sealed corners. Artist: "looking pretty good."
- **Export:** select `Armature`+`Human` (2 objects), standard load-bearing flags **+ `export_vertex_color='ACTIVE'` and `export_all_vertex_colors=False`** (the latter avoids a duplicate `COLOR_1` — the exporter otherwise ships the single `Col` attribute twice). Result matches the original structure: `COLOR_0`, 67 morph targets, 57 nodes. GLB → `docs/base/oracle-mpfb.glb`, `.blend` saved in sync.
- **Backups (gitignored, local only):** `docs/base/oracle-mpfb-working.precornerseal-20260613.blend` and `docs/base/oracle-mpfb.backup-precornerfix-20260613.glb` (pre-3e state).
- **⚠️ Tooling lessons:** (a) Auto-fill operators ALL FAIL on this lens topology — `fill_holes`→0 faces, `triangle_fill`→0 faces, `mesh.fill` via vert-selection→over-fills 500+ junk faces, `bridge_edge_loops`→**deletes** ~120 verts. Use explicit `bmesh.faces.new` by index + targeted `remove_doubles(use_unselected=False)` + manual per-key Laplacian smoothing. (b) **Do NOT give the Workflow tool / subagents Blender MCP access** — a subagent sent an unbounded loop that pinned Blender's main thread and it OOM-crashed mid-session. Keep all Blender work on the main loop, cap every traversal, scope queries locally. Harden each session: set `prefs.edit.undo_memory_limit` (it defaulted to **0 = unlimited**) + `undo_steps=12`, and `orphans_purge` after import/export. Save backups to the repo, not `/tmp` (cleared on reboot).

### Status — 2026-06-13 (round 4: CRT render-layer ported into production `index.html`) ✅

The CRT grade now ships in the production kiosk, not just the `oracle-preview.html` prototype. **This closes the last structural TODO (#2).**

- **What was ported** (all from `oracle-preview.html` → `index.html`): the `three`/`three/addons` postprocessing imports; the baked `window.ORACLE` knob object; the constructor's dim cool lighting (`lightAmbientColor 0x4a5d82 @0.20`, `lightDirectColor 0x88a6da @1.4`, `phi 1.0/theta 1.4`, `lightSpotIntensity 0`) and `cameraView:"head"` (was `"upper"`); and a new `setupOracleRenderLayer()` that reproduces the scene dressing (`scene.background 0x05080e` + a `0xbcd4ff` rim SpotLight at `(0,1.85,-0.9)` targeting the `Head` bone), the telephoto framing (`fov 10`, cam `(0,1.60,2.95)`, `controls.target (0,1.55,0)`), the `EffectComposer` chain (`RenderPass → UnrealBloomPass → OutputPass → CRT ShaderPass`) with the **half-res bloom** Pi optimization, and the `head.render` monkeypatch that drives the composer + syncs the `ORACLE` knobs each frame.
- **Where it runs:** `setupOracleRenderLayer()` is called after `await head.showAvatar()` in **both** dev and production. Dev mode is unchanged except the grade now applies (Speak controls + `window.__head` still exposed only in dev); production still hides controls, sets `cursor:none`, withholds `__head`, and keeps the reload-on-error recovery.
- **Robustness (from the adversarial review):** functional wiring is sequenced FIRST — `window.avatarSpeak` (the upstream integration contract) is defined, and dev controls enabled, **before** the grade — and `setupOracleRenderLayer()` is wrapped in its own `try/catch`. So a cosmetic render-layer failure (e.g. a WebGL/pass-constructor issue on the Pi) degrades to the raw avatar with working speech instead of taking `avatarSpeak` down with it.
- **Verified live** (served from the repo root, `approot` config, port 8772): dev `index.html` and production `index.html?production=1` both render the full grade with **zero console errors**, `render` is patched to the composer (`fov 10`, bg `#05080e`, `ORACLE` present), and the **morph/lip-sync path renders correctly through the composer** — driving `__head.setFixedValue('jawOpen',0.7)` + `viseme_aa` shows a clean dark-interior open mouth under the CRT grade. Look matches `oracle-preview.html`.
- **Review result:** a 3-lens adversarial review (parity / runtime correctness / hardening+perf, 15 agents) confirmed the port is a faithful value-for-value reproduction with the half-res bloom preserved, no new per-frame allocations, and hardening intact; the only confirmed finding was the avatarSpeak-ordering robustness issue above, which is fixed.
- **Still pending:** on-Pi 60fps validation (ALG-21); a possible small `fov` re-tune for the real kiosk monitor aspect ratio (vertically aspect-robust — head height holds — so this is minor). `oracle-preview.html` is kept as the live look-tuning sandbox.

### Status — 2026-06-13 (round 3d: corner holes were REAL — geometry weld) [SUPERSEDED by 3e]

**Correction to 3c:** the artist confirmed (after the v6 paint pass) that the corner darks were **genuine see-through holes**, not just paint. The paint pass had been *masking* them — lightening the corner verts removed the dark that hid the real gaps, so they then stood out clearly. Root cause: the `edge_split` rip left **unwelded coincident duplicate verts at each commissure** → cracks/slivers/zero-area faces that read through to the dark interior. (Detection method that worked: compare boundary verts to coincident partners; lone/untwinned boundary at the corners = the gaps. Front-only ray-casts had missed them.)

- **Fix (geometry, shape-key-safe):** in the **static corner zone `|x| >= 0.028`** (the jawOpen corner-taper makes drop ≈ 0 there, so welding can't affect the opening), edit-mode `remove_doubles(threshold=0.0016)` merged **20 duplicate verts**; then `fill_holes(sides=6)` + `normals_make_consistent` (needed 0 extra faces). Mesh **13456→13436 verts** (13352 faces), now watertight at the commissures. The **v6 paint was transferred back by vertex position** (exact, max dist 0 — the merge only collapsed coincident verts).
- **Verified:** loads in `oracle-preview` with **zero console errors**, closed mouth shows a clean line with no corner holes, and the **opening is unaffected** (still opens cleanly with a dark interior). GLB re-exported + `.blend` saved. Pre-weld backup: `/tmp/oracle-prehole-fix.{blend,glb}`.
- **If holes somehow persist** from a specific viewing angle: weld is currently scoped to `|x|>=0.028`; widen the merge threshold or extend inboard, but stay `>= ~0.026` to avoid welding the openable center. Get a screenshot from the artist's exact view to target.

### 4.1 Fix the head/chin angle (HIGH — blocks "looks right")
**Symptom:** in TalkingHead the head/chin tilts down into the neck. **Not** present in the Blender rest pose (the mesh sits upright), so it's TalkingHead applying its neutral head pose along the wrong axes.
**Root cause:** the rig's bones were renamed from MakeHuman to Mixamo names, but they keep **MakeHuman bone rolls/orientations**. TalkingHead's README explicitly says to match bone **axes and rolls** to its reference avatars (`avatars/brunette.glb` A-pose, `avatars/brunette-t.glb` T-pose).
**Fix approach:**
1. Open `oracle-mpfb-working.blend`. Also import `brunette.glb` (TalkingHead sample / the restored `avatar.glb`) as the **roll reference**.
2. Compare rest-pose bone matrices/rolls of `Neck`, `Neck1`, `Neck2`, `Head` (and the `Spine` chain) between our `Armature` and brunette's. Set our bone **rolls** (Edit Mode → Bone → Roll, or `bone.roll`) to match brunette's convention.
3. Also compare overall **rest pose** (brunette is A-pose). If our pose differs materially, TalkingHead animations may apply oddly.
4. Re-export (see §6 export options) and reload in `oracle-preview.html`; iterate until the head sits level.

### 4.2 Verify lip-sync end-to-end (HIGH)
We confirmed the morphs **load and deform**, but not a full speech→viseme→render loop. Wire up Google TTS (`config.js` key) in `index.html`, speak a phrase, and confirm the mouth lip-syncs. Or drive visemes via the TalkingHead API. Confirm all 15 `viseme_*` read correctly (not just jawOpen).

### 4.3 The CRT-oracle look (MEDIUM — after motions)
- The render-layer treatment already exists in `oracle-preview.html` (§5). It was tuned against the **old** RPM avatar; **retune it for the MPFB avatar**: use `cameraView: "head"` (the MPFB head sits higher than the old avatar — `"upper"` framed the chest), and re-tune exposure. The artist liked it **slightly overexposed/luminous** (not a flat blob, not too dim) — landed around `rim ~34, bloom 0.85 @ threshold 0.62, ambient 0.55, direct 4.2` on the old avatar; redo against this one.
- Add a **skin material** (currently default white). Under the blue grade fine detail is hidden, but a mid skin tone reads better than pure white.

### 4.4 Pi-5 performance pass (MEDIUM)
Validate 60 fps fullscreen on the Pi 5 with the avatar + post-processing chain. Bloom is the most expensive pass — measure and dial down if needed.

### 4.5 Hair / collar / final look (LATER)
Deferred by direction. When ready, see the reference: loose wavy backlit hair (the "halo") + high collar. (A vetted from-scratch hair-card generation approach was explored; MPFB also has procedural hair but its hair/skin/clothes are **separate asset-pack downloads** from makehumancommunity.org.)

---

## 5. The CRT render-layer (how `oracle-preview.html` works)

TalkingHead exposes its Three.js internals as plain fields (`head.renderer`, `head.scene`, `head.camera`, `head.lightAmbient/lightDirect/lightSpot`), and its renderer uses `alpha:true`. The treatment is injected **without forking TalkingHead**:
- After `showAvatar`, build an `EffectComposer(head.renderer)` with `RenderPass → UnrealBloomPass → OutputPass → CRT ShaderPass` (custom shader: luminance→blue tint, scanlines, vignette, grain).
- Add a blue **rim/back light** behind/above the head for the halo.
- **Monkeypatch `head.render = () => composer.render()`** so TalkingHead's own render loop drives the composer.
- All knobs live in `window.ORACLE` (tint, mono, scanIntensity, vignette, grain, bloom, rimIntensity) and are read each frame — tweak live in the browser console.

This is base-independent, so it drops onto the MPFB avatar once framing/material are sorted.

---

## 6. How the avatar was built (to reproduce/iterate)

Built via the **Blender MCP** (official Blender Lab connector) driving **Blender 5.1.2** + **MPFB2 v2.0.15**. The working order (order matters — each was a trap):

1. `bpy.ops.mpfb.create_human()` — needs a VIEW_3D area/region context override; do **not** pin `object=` in the override.
2. Androgyny: set the two `*universal*` macro shape keys to `0.5`.
3. **Bake** the macro blend by reading the **depsgraph-evaluated** mesh (disable the "Hide helpers" MASK modifier first so vert counts match). Do **not** linearly sum the macro shape-key deltas — MakeHuman macros don't compose linearly and the naive sum overshoots ~2× and splays the face.
4. `add_standard_rig()` — **before** `delete_helpers` (it averages joint-helper geometry to place bones; deleting first → ZeroDivisionError).
5. `delete_helpers()` — removes MakeHuman helper geometry (19158→13380 verts) + the mask. The helper geometry is the "strips over the face" if left in.
6. Rename the 137 MakeHuman bones → Mixamo (root→Hips, spine05/03/01→Spine/Spine1/Spine2, neck01-03→Neck/Neck1/Neck2, head→Head, eye.L/R→Left/RightEye, clavicle→Shoulder, upperarm01→Arm, lowerarm01→ForeArm, wrist→Hand, fingers, legs; merge twist/extra/face bones' vertex groups into kept bones to preserve weights; armature object → `Armature`).
7. Import the reference RPM avatar; transfer 52 ARKit + 15 visemes from its `AvatarHead` onto the MPFB face via **BVHTree barycentric nearest-surface, per-axis-affine delta transfer** scoped to head-region verts (z ≥ 1.40).
8. Export GLB: select `Armature` + `Human` **both unhidden** (hidden objects are skipped → armature won't export, skins=0), `use_selection=True, export_yup=True, export_skins=True, export_morph=True, export_apply=False, export_def_bones=False`.

**Export options for re-export (load-bearing):** `export_format='GLB'`, `use_selection=True` (only Armature+Human → root node is `Armature`), `export_yup=True`, `export_skins=True`, `export_morph=True`, `export_apply=False` (so shape keys survive), `export_def_bones=False`.

---

## 7. Environment & tooling gotchas

- **Blender MCP** (Blender Lab connector): a "run Python in Blender" bridge. Blender must be **open** with the MCP add-on **server started** (listens on **localhost:9876**), else calls fail. The connector is wired into both Claude Desktop and Claude Code.
- **Headless context:** for `bpy.ops` needing a viewport, build the override from `bpy.data.window_managers[0].windows[0].screen` (NOT `bpy.context.screen`, which `read_homefile` nulls). Don't pin `object=` for `armature_add`-type ops.
- **Screenshot tool** (`get_screenshot_of_area_as_image`) errors in this build — use `bpy.ops.render.opengl(write_still=True, view_context=True)` to a PNG, then read the file. To frame the head, set `region_3d.view_location`/`view_distance` manually (the avatar is full-body; `view_selected` frames the whole body).
- **MPFB** assets (hair/skin/clothes) are **not bundled** — separate downloads from makehumancommunity.org.
- **`avatar.glb` is gitignored** — never `cp` a file onto it through a symlink (that's how the original was lost).

---

## 8. Quick verification recipe

```bash
# serve a dir whose index = oracle-preview.html and avatar.glb = the MPFB base
mkdir -p /tmp/oserve && cp oracle-preview.html /tmp/oserve/index.html \
  && cp docs/base/oracle-mpfb.glb /tmp/oserve/avatar.glb
python3 -m http.server 8770 --directory /tmp/oserve
# open http://127.0.0.1:8770/  — HUD shows "ready" when TalkingHead has loaded it.
# In the console: window.ORACLE.mono=0; window.ORACLE.bloom=0  (to see the raw avatar)
#                 window.__head.setView('head')                 (to frame the head)
```
Verified facts to expect: `Armature` root, 57 joints, all 25 required Mixamo bones, 67 morphs (TalkingHead expands to 72).
