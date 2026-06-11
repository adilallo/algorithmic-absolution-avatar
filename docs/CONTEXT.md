# Project context

Living reference for installation constraints, hardware targets, and decisions that affect how this avatar is built and deployed. Update this document as we learn more; link related Linear issues where relevant.

**Related:** [ALG-5 — Define target display resolution and PC specs](https://linear.app/algorithmic-absolution/issue/ALG-5/define-target-display-resolution-and-pc-specs)

---

## Installation (brief)

**Office of Algorithmic Absolution** is a kinetic installation: participants confess via punch card and receive algorithmic absolution from a talking avatar on a screen above the altar. This repo is only the avatar layer — a browser-based 3D character (TalkingHead / Three.js) that speaks LLM-generated text with lip sync. In production, text comes from upstream; the text input UI is for local dev and rehearsal.

---

## Hardware & display spec

Tracks [ALG-5](https://linear.app/algorithmic-absolution/issue/ALG-5/define-target-display-resolution-and-pc-specs). **Done when:** resolution, refresh rate, and a confirmed or recommended build are documented here and can sustain **60 fps** avatar rendering in a **fullscreen browser**.

### Target compute — confirmed

| Item | Value | Notes |
|------|-------|-------|
| Device | **Raspberry Pi 5** | Confirmed target PC for the avatar |
| CPU | Broadcom BCM2712, quad Cortex-A76 @ 2.4 GHz | Pi 5 reference spec |
| GPU | VideoCore VII | WebGL via Chromium; no discrete GPU |
| RAM | **TBD** — 4 GB or 8 GB | 8 GB safer if the machine runs other services or heavy browser tabs |
| Storage | **TBD** | SD vs NVMe (Pi 5 supports M.2 HAT); affects reliability for a long-running install |
| OS | **TBD** — likely Raspberry Pi OS (64-bit) | Needs a recent Chromium with working WebGL2 |
| Browser | **TBD** — likely Chromium in kiosk / fullscreen | Must match production launch mode for perf testing |
| Network | **TBD** | Required for Google Cloud TTS in current stack; may change if TTS is proxied locally |

### Display & physical install — open

| Item | Value | Notes |
|------|-------|-------|
| Screen size (diagonal) | **TBD** | |
| Mounting height (above altar) | **TBD** | Affects perceived scale of the avatar / camera framing |
| Typical viewing distance | **TBD** | Informs how tight the TalkingHead camera should feel |
| Resolution | **TBD** | e.g. 1920×1080 — lock once display is chosen |
| Aspect ratio | **TBD** | Depends on panel; common options 16:9, 16:10, 4:3 |
| Orientation | **TBD** | Portrait vs landscape — ticket calls this out explicitly |
| Refresh rate | **TBD** | Target 60 Hz if panel supports it (matches perf goal) |
| Connection | **TBD** | Pi 5: micro-HDMI; verify cable length and EDID at install site |

### Machine role — open

| Item | Value | Notes |
|------|-------|-------|
| Dedicated vs shared | **TBD** | Does this Pi run **only** the avatar browser, or also punch-card / LLM / other install software? |

### Performance target

- **60 fps** sustained while the avatar is visible and animating, **fullscreen**, on the **Pi 5** build above.
- Validate on real hardware early; Pi 5 can drive 4K@60 for video but **Three.js + morph targets + TTS** may need a lower internal resolution or quality settings.
- Dev machines can exceed Pi perf; treat Pi 5 as the ceiling for asset weight, shadow quality, and effects.

### Open questions (for ALG-5)

1. What physical display is mounted above the altar (size, model, native resolution)?
2. Portrait or landscape? What aspect ratio should the avatar layout assume?
3. 4 GB or 8 GB Pi 5 — and is the Pi dedicated to the avatar or shared?
4. Local-only operation vs always-on internet (TTS API, future LLM upstream)?
5. Acceptable fallback if 60 fps is not reachable at native resolution (e.g. 720p render, reduced morph count)?

### Decisions log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-06-10 | Target PC is **Raspberry Pi 5** | Stated project constraint |
| — | *(pending)* | Resolution, refresh rate, RAM, dedicated/shared, orientation |

---

## Software stack (current)

| Layer | Choice |
|-------|--------|
| Avatar runtime | [TalkingHead](https://github.com/met4citizen/TalkingHead) 1.7 (CDN) |
| 3D | Three.js 0.180 (CDN) |
| TTS | Google Cloud Text-to-Speech (client key in dev; proxy recommended for production) |
| Avatar asset | GLB with ARKit + Oculus visemes (e.g. Ready Player Me export) |
| Serve | Static HTTP (e.g. `python3 -m http.server` in dev; kiosk browser in prod) |

---

## Changelog

- **2026-06-10** — Created context doc; seeded ALG-5 with Pi 5 confirmed, other fields TBD.
