#!/usr/bin/env bash
# Start the dex-pair-verify web server. systemd ExecStart target.
# exec's Node so systemd supervises the server process directly (clean SIGINT stop).
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(dirname "$DIR")"
# shellcheck source=/dev/null
source "$DIR/dex-pair-verify.env"

export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [ -s "$NVM_DIR/nvm.sh" ]; then
  # shellcheck source=/dev/null
  . "$NVM_DIR/nvm.sh"
else
  echo "nvm not found at $NVM_DIR/nvm.sh" >&2
  exit 1
fi
nvm use "$NODE_VERSION" >/dev/null

cd "$APP_DIR"
exec node_modules/.bin/next start -H "$HOST" -p "$PORT"
