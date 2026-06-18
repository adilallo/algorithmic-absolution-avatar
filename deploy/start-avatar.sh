#!/usr/bin/env bash
# Start the TTS proxy and launch the presentation (oracle kiosk + punch-card form).
# Intended for Raspberry Pi 5 (oracle-only via AVATAR_ORACLE_ONLY=1); also for local showcase demos.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
PORT="${AVATAR_PORT:-8765}"
BASE="http://127.0.0.1:${PORT}"
ORACLE_URL="${BASE}/?production=1&showcase=1"
FORM_URL="${BASE}/showcase/form-1517a.html"

cd "${REPO_ROOT}"

if ! command -v node >/dev/null 2>&1; then
  echo "node is required to run the TTS proxy (deploy/tts-proxy/server.js)." >&2
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

# Start the TTS proxy (it also serves the static files) if not already listening.
# The proxy reads its Google key from deploy/tts-proxy/.env — never from a served file.
if ! curl -sf "http://127.0.0.1:${PORT}/tts/health" >/dev/null 2>&1; then
  PORT="${PORT}" node "${REPO_ROOT}/deploy/tts-proxy/server.js" &
  SERVER_PID=$!
  trap 'kill "${SERVER_PID}" 2>/dev/null || true' EXIT
  sleep 1
fi

CHROMIUM_FLAGS=(
  --noerrdialogs
  --disable-infobars
  --disable-session-crashed-bubble
  --no-first-run
  --disable-translate
  --autoplay-policy=no-user-gesture-required
)

# Final install (Pi altar display only): AVATAR_ORACLE_ONLY=1 skips the showcase form.
if [[ "${AVATAR_ORACLE_ONLY:-}" == "1" ]]; then
  ORACLE_URL="${BASE}/?production=1"
  exec "${CHROMIUM}" "${CHROMIUM_FLAGS[@]}" --kiosk --app="${ORACLE_URL}"
fi

echo "Presentation mode:"
echo "  Oracle (kiosk):  ${ORACLE_URL}"
echo "  Punch-card form: ${FORM_URL}"
echo "Put the oracle fullscreen on the external display; keep the form on the visitor screen."
echo "Tap the oracle screen once before the first submission (enables audio in this window)."

launch_kiosk() {
  local url="$1"
  if [[ "$(uname -s)" == "Darwin" ]]; then
    # New Chrome instance so --autoplay-policy and other flags actually apply.
    open -na "Google Chrome" --args \
      "${CHROMIUM_FLAGS[@]}" \
      --kiosk \
      --app="${url}"
  else
    "${CHROMIUM}" "${CHROMIUM_FLAGS[@]}" --kiosk --app="${url}"
  fi
}

if [[ "$(uname -s)" == "Darwin" ]]; then
  launch_kiosk "${FORM_URL}" &
  sleep 1
  launch_kiosk "${ORACLE_URL}"
  if [[ -n "${SERVER_PID:-}" ]]; then wait "${SERVER_PID}"; fi
else
  "${CHROMIUM}" "${CHROMIUM_FLAGS[@]}" --kiosk --app="${FORM_URL}" &
  sleep 1
  exec "${CHROMIUM}" "${CHROMIUM_FLAGS[@]}" --kiosk --app="${ORACLE_URL}"
fi
