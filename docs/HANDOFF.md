# Avatar handoff — Office of Algorithmic Absolution

**Status as of 2026-06-12.** This document is written for the next agent/developer picking up the avatar work. It covers what exists, how it was built, what's left, and the gotchas.

---

## 1. TL;DR — where we are

We have a **blank, androgynous, TalkingHead-compatible avatar base** built from MPFB (MakeHuman for Blender):

- **`docs/base/oracle-mpfb.glb`** — the deliverable. 2.3 MB. Mixamo-named rig (root object `Armature`, 57 bones, all 25 TalkingHead-required bones, no `mixamorig` prefix) + **all 52 ARKit blendshapes + 15 Oculus visemes**. Verified: it **loads in TalkingHead** (`showAvatar` resolves cleanly, TalkingHead expands it to 72 morphs) and the visemes deform the mouth correctly (jawOpen, viseme_aa, mouthClose etc. all confirmed in Blender).
- **`docs/base/oracle-mpfb-working.blend`** — the Blender source for that GLB (11 MB). Open this to iterate.
- It is intentionally **blank**: default white material (no skin tone), **no hair, no clothes** (per direction: get the motions working first, refine the look later).

**The one known bug:** in TalkingHead the **head/chin tilts down into the neck**. The mesh rest pose is correct in Blender — this is a **bone roll/axis mismatch** (see §4.1). Top priority to fix.

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
