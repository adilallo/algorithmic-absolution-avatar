# Production kiosk deployment

Scripts and systemd unit for running the avatar in fullscreen kiosk mode on **Raspberry Pi 5**. Written for Pi deployment; test locally before installing on hardware.

Tracks [ALG-6](https://linear.app/algorithmic-absolution/issue/ALG-6/configure-production-kiosk-browser-mode).

## Prerequisites

- Clone this repo on the target machine
- Copy `config.example.js` to `config.js` and set:
  - `TALKINGHEAD_TTS_APIKEY` — Google Cloud TTS key (see ALG-8 for production proxy)
  - `TALKINGHEAD_PRODUCTION = true`
- Add `avatar.glb` or set `TALKINGHEAD_AVATAR_URL` in `config.js`
- Network access for CDN (Three.js, TalkingHead) and Google TTS

## Local simulation (no Pi)

From the repo root:

```bash
chmod +x deploy/start-avatar.sh
./deploy/start-avatar.sh
```

Or manually:

```bash
python3 -m http.server 8765 --bind 127.0.0.1
```

Then launch Chromium/Chrome:

```bash
chromium-browser \
  --kiosk --noerrdialogs --disable-infobars --disable-session-crashed-bubble \
  --no-first-run --disable-translate \
  --app=http://127.0.0.1:8765/?production=1
```

On macOS, use Google Chrome with the same flags.

### Verify locally

- [ ] Dev mode (`http://127.0.0.1:8765/`) shows text input and Speak button
- [ ] Production mode (`?production=1`) hides controls, full-bleed layout, cursor hidden
- [ ] Kiosk launch has no browser chrome
- [ ] In production, devtools console: `avatarSpeak("Test absolution.")` triggers speech
- [ ] Broken avatar URL in production reloads page after ~3s

## Raspberry Pi 5 install (when hardware is available)

1. Install Raspberry Pi OS (64-bit) with desktop enabled
2. Clone repo to `/home/pi/algorithmic-absolution-avatar`
3. Create `config.js` with production settings (see above)
4. Make script executable: `chmod +x deploy/start-avatar.sh`
5. Edit `deploy/avatar-kiosk.service` if paths or user differ
6. Install systemd unit:

```bash
sudo cp deploy/avatar-kiosk.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable avatar-kiosk.service
sudo systemctl start avatar-kiosk.service
```

For graphical session autostart (alternative to systemd), add a `.desktop` file under `~/.config/autostart/` that runs `deploy/start-avatar.sh`.

### Pi validation checklist (pending hardware)

- [ ] Boot autostart after power cycle
- [ ] Kiosk fills altar display at target resolution (ALG-5)
- [ ] OS-level keyboard disabled or no keyboard attached
- [ ] Cursor hidden at OS level (`unclutter` or similar) if CSS `cursor: none` is insufficient
- [ ] Kill Chromium process → service restarts automatically
- [ ] Network loss/recovery handled acceptably

## Production integration

Upstream systems call speech via the browser global:

```js
avatarSpeak("Your algorithmic absolution text here.");
```

Wiring from punch-card / LLM pipeline is tracked in [ALG-13](https://linear.app/algorithmic-absolution/issue/ALG-13/wire-punch-card-submission-to-avatar-speech-pipeline).

## Notes

- Static server uses `python3 -m http.server` for simplicity. A production Pi may swap in nginx or Caddy later.
- Three.js and TalkingHead load from CDN; the Pi needs internet at startup unless assets are vendored.
- Client-side TTS API key in `config.js` is acceptable for private install until [ALG-8](https://linear.app/algorithmic-absolution/issue/ALG-8/set-up-tts-api-proxy-for-production) ships a proxy.
