# Showcase — two-screen punch-card demo (Denver, 2026-06)

Temporary UI for showing the oracle live. **Not part of the final install** — the real
installation drives the avatar from the physical card reader, which calls the same
`window.requestAbsolution()` this page uses. To remove the whole showcase, see *Teardown* below.

## What it is

- `form-1517a.html` — a standalone recreation of the printed Form 1517-A punch card
  (click any categories, click **Submit**). It posts the punched card to the avatar over a
  same-origin `BroadcastChannel("absolution")`.
- A small **showcase bridge** in `../index.html` (fenced `===== SHOWCASE BRIDGE =====`, active
  only with `?showcase`) receives that message and calls `window.requestAbsolution({ punched })`,
  so the oracle reads the card back and speaks the absolution.

## Run it (one MacBook + one external monitor)

1. Start the proxy (serves everything on one origin, injects the API keys server-side):
   ```bash
   node deploy/tts-proxy/server.js
   ```
2. **External monitor — the oracle.** Open and put this window fullscreen:
   ```
   http://127.0.0.1:8765/?production=1&showcase=1
   ```
3. **Laptop screen — the confession station.** Open this and give the visitor the mouse:
   ```
   http://127.0.0.1:8765/showcase/form-1517a.html
   ```

Both URLs must be the **same origin** (both `127.0.0.1:8765`) — that is what lets the card
reach the avatar. The card's bottom-right `link:` readout shows `received by oracle` once the
avatar window has acknowledged a submission; if it says *oracle window not detected*, the avatar
window isn't open with `?showcase` on the same origin.

Click **Punch a new card** on the card after each visitor to reset.

## Teardown (back to avatar-only for the final install)

1. Delete this `showcase/` folder.
2. In `../index.html`, delete the block between `===== SHOWCASE BRIDGE =====` and
   `===== END SHOWCASE BRIDGE =====`.

That's it — `index.html` is back to the pure oracle (run it without `?showcase`).
