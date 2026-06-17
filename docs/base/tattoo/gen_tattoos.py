#!/usr/bin/env python3
"""
Full-body gold Catholic tattoos for the Oracle (OracleSkin / "Human", UVMap).

REFERENCE-EXTRACTION pipeline (2026-06-16). The artist's reference atlas
(`ref_atlas.png`, the gold-on-wireframe UV sheet) was painted *directly on our
real unwrap* -- the island outlines AND the grid singularities (breasts, navel,
back, buttocks) co-register with `oracle_uv_layout.png` (measured island IoU
~0.935 under identity). So instead of re-stamping a handful of procedural
emblems, we replicate the WHOLE design 1:1:

  1. extract the gold linework from the reference (R-B "goldness" -> soft alpha),
  2. map it identity onto the real UV (same normalized coords),
  3. clip to the island mask (kills wireframe/shading bleed outside islands),
  4. erase the whole HEAD island -- the big right island is the HEAD (verified:
     u>0.66 maps to world z up to 1.66), the two left ovals are the EARS, and the
     bottom-right piece is the scalp. The reference's "back-style" art there would
     land on the head/face, so it is masked off (`mask_head.png`) -> the face,
     head and ears stay clean porcelain.
  5. erase ONLY the central flaming-heart glyph -- it is a 3D model
     (SacredHeart); the surrounding halo/text ring is kept to frame it,
  6. recolour to flat project gold and write emissive (gold/black) + basecolor
     (gold/white) at 2048.

The previous stamp-at-anchors generator is kept as `gen_tattoos.stamp-bak.py`.
Re-run, then in Blender reload both images on OracleSkin and re-export the GLB.
"""
import os
import numpy as np
from PIL import Image
from scipy import ndimage

OUT = os.path.dirname(os.path.abspath(__file__))
REF = os.path.join(OUT, "ref_atlas.png")            # artist reference (gold UV atlas)
UVL = os.path.join(OUT, "oracle_uv_layout.png")     # real exported UV layout (island mask)
HEADMASK = os.path.join(OUT, "mask_head.png")        # head/face/ear island -> keep clean
RES = 2048                                          # final texture size
SS = 2                                              # supersample factor for extraction
W = RES * SS
GOLD = np.array([228, 170, 55], np.float32)         # reference diagnostic gold

# Tattoo STYLE. The preview skin is pale porcelain (color 0.88/0.84/0.80) and the
# base-color map is KEPT, so albedo = skin * basecolor-map -> DARK base-color lines
# read as albedo (bloom can't wash albedo), while the emissive map adds glow.
# Bright gold emissive on near-white skin blooms out and disappears; darker/richer
# pigment + modest emissive reads. Select with env TAT_STYLE.
#   line: base-color line RGB (darker = reads more)   emis/emis_gain: glow colour*strength
#   relief: dark edge RGB in base-color (crisps lines on white)   weight: line-thicken px
STYLES = {
    "gold":    dict(line=(228, 170, 55), emis=(228, 170, 55), emis_gain=1.00, relief=None,         relief_w=0, weight=0),
    "antique": dict(line=(146, 100, 28), emis=(176, 128, 44), emis_gain=0.40, relief=None,         relief_w=0, weight=2),
    "relief":  dict(line=(210, 160, 54), emis=(210, 160, 54), emis_gain=0.42, relief=(48, 30, 8),  relief_w=3, weight=2),
    "bronze":  dict(line=(84,  54,  16), emis=(150, 96,  34), emis_gain=0.16, relief=None,         relief_w=0, weight=3),
}
STYLE = os.environ.get("TAT_STYLE", "relief")
STY = STYLES[STYLE]

# Central flaming-heart glyph to ERASE (it is the 3D SacredHeart mesh).
# (u, v_from_top, rx, ry) in normalized UV. Tuned so the outer halo/text ring
# (radius ~0.085) survives and only the heart+crown+little-cross are removed.
HEART = (0.378, 0.300, 0.058, 0.072)
KEEP_HEART_RING = True                              # set False to also drop the ring

# The reference's big cross+laurel+monstrance "diagram" was authored on the HEAD
# island (the artist read it as a back). Per direction it is relocated to the
# FRONT lower torso so it reads head-on: the small pelvic cross-in-circle is
# removed and the richer MONSTRANCE medallion (lifted off the head, saved as
# emblems/brush_monstrance.png) is stamped in its place.
RELOCATE_DIAGRAM = False                            # OFF: artist found the pelvic medallion too noisy
ERASE_PELVIC_EMBLEM = True                           # also drop the reference's simple cross-in-circle
PELVIC_ERASE = (0.378, 0.574, 0.050, 0.056)         # u, v_from_top, rx, ry (hugs the disc, spares chains)
MONSTRANCE = dict(u=0.378, v=0.575, w=0.118)        # centre + target width (UV)


def load_rgb(path, size):
    return np.asarray(Image.open(path).convert("RGB").resize((size, size), Image.LANCZOS)).astype(np.float32)


# ---------- 1. gold extraction -> soft alpha ----------
ref = load_rgb(REF, W)
r, g, b = ref[:, :, 0], ref[:, :, 1], ref[:, :, 2]
mx, mn = ref.max(2), ref.min(2)
sat = (mx - mn) / (mx + 1e-3)
# "goldness": gold has R >> B and G between; greys/whites have R~G~B (->0), black ->0.
rb = r - b
alpha = np.clip((rb - 25.0) / (140.0 - 25.0), 0.0, 1.0)
# gate out warm-but-greyish AI shading and reflected-light blobs
alpha *= np.clip((sat - 0.16) / 0.22, 0.0, 1.0)
alpha *= (g < r).astype(np.float32)          # gold is never green-dominant
alpha *= (g > b * 0.9).astype(np.float32)    # but G sits above B (orange-gold hue)

# ---------- 2/3. clip to the real island mask ----------
uvl = load_rgb(UVL, W)
island = uvl.max(2) > 40
island = ndimage.binary_dilation(island, iterations=max(1, int(0.004 * W)))
alpha *= island.astype(np.float32)

# ---------- 4. erase the whole HEAD island (face/head/ears stay clean) ----------
head = np.asarray(Image.open(HEADMASK).convert("L").resize((W, W), Image.NEAREST)) > 128
alpha *= (~head).astype(np.float32)

# ---------- 5. erase the central heart glyph ----------
hu, hv, hrx, hry = HEART
yy, xx = np.mgrid[0:W, 0:W].astype(np.float32)
ell = ((xx - hu * W) / (hrx * W)) ** 2 + ((yy - hv * W) / (hry * W)) ** 2
alpha *= (ell > 1.0).astype(np.float32)

# ---------- 5b. erase the pelvic cross-in-circle emblem (keep the pelvis clean) ----------
if ERASE_PELVIC_EMBLEM:
    eu, ev, erx, ery = PELVIC_ERASE
    e2 = ((xx - eu * W) / (erx * W)) ** 2 + ((yy - ev * W) / (ery * W)) ** 2
    alpha *= (e2 > 1.0).astype(np.float32)

# ---------- 6. (optional) relocate the "diagram" to the front lower torso ----------
# OFF by default: artist found the pelvic medallion too noisy, so the pelvis keeps
# the reference's original simple cross-in-circle. Flip RELOCATE_DIAGRAM to re-enable.
yy, xx = np.mgrid[0:W, 0:W].astype(np.float32)
if RELOCATE_DIAGRAM:
    pu, pv, prx, pry = PELVIC_ERASE
    ell2 = ((xx - pu * W) / (prx * W)) ** 2 + ((yy - pv * W) / (pry * W)) ** 2
    alpha *= (ell2 > 1.0).astype(np.float32)

    mb = Image.open(os.path.join(OUT, "emblems", "brush_monstrance.png")).convert("RGBA")
    tw = int(MONSTRANCE["w"] * W); th = int(tw * mb.height / mb.width)
    ma = np.asarray(mb.resize((tw, th), Image.LANCZOS))[:, :, 3].astype(np.float32) / 255.0
    x0 = int(MONSTRANCE["u"] * W) - tw // 2; y0 = int(MONSTRANCE["v"] * W) - th // 2
    xs0, ys0 = max(0, x0), max(0, y0); xs1, ys1 = min(W, x0 + tw), min(W, y0 + th)
    alpha[ys0:ys1, xs0:xs1] = np.maximum(alpha[ys0:ys1, xs0:xs1],
                                         ma[ys0 - y0:ys1 - y0, xs0 - x0:xs1 - x0])
    alpha *= island.astype(np.float32)              # keep the stamp on-island

# ---------- 7. compose emissive + basecolor in the chosen STYLE ----------
core = np.clip(alpha, 0, 1)
if STY["weight"] > 1:
    core = np.clip(ndimage.maximum_filter(core, size=STY["weight"]), 0, 1)

relief = None
if STY["relief"] is not None:
    solid = core > 0.30
    relief = (ndimage.binary_dilation(solid, iterations=STY["relief_w"]) & ~solid).astype(np.float32)

# EMISSIVE (glow): dim core only, no relief -> modest bloom
E = np.array(STY["emis"], np.float32) * STY["emis_gain"]
em = np.zeros((W, W, 3), np.float32)
for c in range(3):
    em[..., c] = E[c] * core
Image.fromarray(em.astype(np.uint8), "RGB").resize((RES, RES), Image.LANCZOS).save(
    os.path.join(OUT, "oracle_tattoo_emissive.png"))

# BASECOLOR (albedo): white skin, dark/rich lines (+ optional dark relief edge)
L = np.array(STY["line"], np.float32)
bc = np.ones((W, W, 3), np.float32) * 255.0
if relief is not None:
    R = np.array(STY["relief"], np.float32)
    for c in range(3):
        bc[..., c] = bc[..., c] * (1 - relief) + R[c] * relief
for c in range(3):
    bc[..., c] = bc[..., c] * (1 - core) + L[c] * core
Image.fromarray(bc.astype(np.uint8), "RGB").resize((RES, RES), Image.LANCZOS).save(
    os.path.join(OUT, "oracle_tattoo_basecolor.png"))

# diagnostic art (gold-on-transparent, used by checks/overlays)
rgba = np.zeros((W, W, 4), np.float32)
rgba[..., 0], rgba[..., 1], rgba[..., 2] = GOLD[0], GOLD[1], GOLD[2]
rgba[..., 3] = core * 255.0
Image.fromarray(rgba.astype(np.uint8), "RGBA").resize((RES, RES), Image.LANCZOS).save(
    os.path.join(OUT, "oracle_tattoo_art.png"))
print("wrote tattoos @", RES, "| STYLE =", STYLE, "| heart ring kept:", KEEP_HEART_RING)
