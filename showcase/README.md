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

From the repo root:

```bash
./deploy/start-avatar.sh
```

This starts the proxy (if needed) and opens both windows — oracle kiosk (`?production=1&showcase=1`) and the punch-card form. Put the oracle fullscreen on the external display; keep the form on the visitor screen.

Both URLs must be the **same origin** (`127.0.0.1:8765`) — that is what lets the card reach the avatar. The card's bottom-right `link:` readout shows `received by oracle` once the avatar window has acknowledged a submission; if it says *oracle window not detected*, the oracle window isn't open with `?showcase` on the same origin.

Click **Punch a new card** on the card after each visitor to reset.

## Teardown (back to avatar-only for the final install)

1. Delete this `showcase/` folder.
2. In `../index.html`, delete the block between `===== SHOWCASE BRIDGE =====` and
   `===== END SHOWCASE BRIDGE =====`.

That's it — `index.html` is back to the pure oracle (run it without `?showcase`).
