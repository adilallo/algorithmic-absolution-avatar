#!/usr/bin/env bash
# Start the avatar static server and launch Chromium in kiosk mode.
# Intended for Raspberry Pi 5; also usable locally to simulate production.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
PORT="${AVATAR_PORT:-8765}"
URL="http://127.0.0.1:${PORT}/?production=1"

cd "${REPO_ROOT}"

if ! command -v python3 >/dev/null 2>&1; then
  echo "python3 is required to serve static files." >&2
  exit 1
fi

# Resolve Chromium binary (Pi vs macOS vs Linux)
CHROMIUM=""
for candidate in chromium-browser chromium google-chrome "Google Chrome"; do
  if command -v "${candidate}" >/dev/null 2>&1; then
    CHROMIUM="${candidate}"
    break
  fi
done
if [[ -z "${CHROMIUM}" && -x "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" ]]; then
  CHROMIUM="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
fi
if [[ -z "${CHROMIUM}" ]]; then
  echo "Chromium or Chrome not found. Install Chromium or set CHROMIUM=/path/to/browser." >&2
  exit 1
fi

# Start static server if not already listening
if ! curl -sf "http://127.0.0.1:${PORT}/" >/dev/null 2>&1; then
  python3 -m http.server "${PORT}" --bind 127.0.0.1 &
  SERVER_PID=$!
  trap 'kill "${SERVER_PID}" 2>/dev/null || true' EXIT
  sleep 1
fi

exec "${CHROMIUM}" \
  --kiosk \
  --noerrdialogs \
  --disable-infobars \
  --disable-session-crashed-bubble \
  --no-first-run \
  --disable-translate \
  --app="${URL}"
