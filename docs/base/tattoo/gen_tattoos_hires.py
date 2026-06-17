#!/usr/bin/env python3
"""
HIGHER-RES tattoo maps. Same artwork as gen_tattoos.py, but instead of upscaling
the 1254px reference (soft), we VECTORISE the gold linework with OpenCV contour
tracing and render it crisp at 4096. Shapes stay exactly as the reference; edges
become resolution-independent (smooth, no source pixelation).

Pipeline: extract gold @2x source -> island clip + head/heart/pelvis erase ->
binarise -> trace contours (CCOMP, so ring-holes are preserved) -> light smooth
-> fill at 8192 (outers white, holes black) -> downsample to 4096 -> apply the
committed 'relief' style (dark relief edge in base color, dim gold emissive).

Outputs *_hires.png. The 2048 'relief' set is left untouched as the backup.
"""
import os
import numpy as np
import cv2
from PIL import Image
from scipy import ndimage

OUT = os.path.dirname(os.path.abspath(__file__))
REF = os.path.join(OUT, "ref_atlas.png")
UVL = os.path.join(OUT, "oracle_uv_layout.png")
HEADMASK = os.path.join(OUT, "mask_head.png")

SRC = 3762          # trace working res (3x the 1254 source -> more contour detail)
RENDER = 11286      # supersampled fill res (3x SRC -> AA does the smoothing)
OUT_RES = 4096      # final texture res (2x the current 2048)

# 'relief' style (matches the committed look)
LINE = np.array([210, 160, 54], np.float32)     # base-color line
RELIEF = np.array([48, 30, 8], np.float32)       # dark relief edge
EMISC = np.array([210, 160, 54], np.float32)     # emissive colour
EMIS_GAIN = 0.42
RELIEF_PX = 4                                    # relief edge width @4096
# erases (u, v_from_top, rx, ry)
HEART = (0.378, 0.300, 0.058, 0.072)
PELVIC = (0.378, 0.574, 0.050, 0.056)


def gold_alpha(arr):
    arr = arr.astype(np.float32)
    r, g, b = arr[..., 0], arr[..., 1], arr[..., 2]
    sat = (arr.max(2) - arr.min(2)) / (arr.max(2) + 1e-3)
    return (np.clip((r - b - 25) / 115, 0, 1) * np.clip((sat - 0.16) / 0.22, 0, 1)
            * (g < r) * (g > b * 0.9))


# 1. extract + clip + erase at SRC
a = gold_alpha(np.asarray(Image.open(REF).convert("RGB").resize((SRC, SRC), Image.LANCZOS)))
isl = np.asarray(Image.open(UVL).convert("L").resize((SRC, SRC))) > 40
a *= ndimage.binary_dilation(isl, iterations=max(1, int(0.004 * SRC)))
a *= ~(np.asarray(Image.open(HEADMASK).convert("L").resize((SRC, SRC), Image.NEAREST)) > 128)
yy, xx = np.mgrid[0:SRC, 0:SRC].astype(np.float32)
for (u, v, rx, ry) in (HEART, PELVIC):
    a *= (((xx - u * SRC) / (rx * SRC)) ** 2 + ((yy - v * SRC) / (ry * SRC)) ** 2 > 1.0)

# 2. binarise + trace (no morphological close -> keeps fine strokes from fattening)
mask = (a > 0.28).astype(np.uint8) * 255
contours, hier = cv2.findContours(mask, cv2.RETR_CCOMP, cv2.CHAIN_APPROX_TC89_KCOS)

# 3. (near-identity) render at RENDER -- the 3x supersample + INTER_AREA downscale
#    does the smoothing, so we keep shapes faithful instead of gaussian-blobbing them.
scale = RENDER / SRC


def smooth(cnt):
    pts = cnt.reshape(-1, 2).astype(np.float32)
    if len(pts) >= 14:                                 # kill only sub-pixel jitter
        pts = np.stack([ndimage.gaussian_filter1d(pts[:, 0], 0.8, mode="wrap"),
                        ndimage.gaussian_filter1d(pts[:, 1], 0.8, mode="wrap")], 1)
    return np.round(pts * scale).astype(np.int32)


canvas = np.zeros((RENDER, RENDER), np.uint8)
hier = hier[0] if hier is not None else []
for col in (255, 0):                                  # pass 1: outer fills, pass 2: holes
    for i, c in enumerate(contours):
        is_hole = hier[i][3] != -1
        if (col == 0) == is_hole:
            cv2.fillPoly(canvas, [smooth(c)], col, lineType=cv2.LINE_AA)

core = cv2.resize(canvas, (OUT_RES, OUT_RES), interpolation=cv2.INTER_AREA).astype(np.float32) / 255.0

# 4. relief style at OUT_RES
solid = core > 0.30
relief = (ndimage.binary_dilation(solid, iterations=RELIEF_PX) & ~solid).astype(np.float32)

em = np.zeros((OUT_RES, OUT_RES, 3), np.float32)
for c in range(3):
    em[..., c] = EMISC[c] * EMIS_GAIN * core
Image.fromarray(em.astype(np.uint8), "RGB").save(os.path.join(OUT, "oracle_tattoo_emissive_hires.png"))

bc = np.ones((OUT_RES, OUT_RES, 3), np.float32) * 255.0
for c in range(3):
    bc[..., c] = bc[..., c] * (1 - relief) + RELIEF[c] * relief
for c in range(3):
    bc[..., c] = bc[..., c] * (1 - core) + LINE[c] * core
Image.fromarray(bc.astype(np.uint8), "RGB").save(os.path.join(OUT, "oracle_tattoo_basecolor_hires.png"))

print("wrote HI-RES @", OUT_RES, "| traced", len(contours), "contours")
