#!/usr/bin/env bash
# Start the dex-pair-verify web server. systemd ExecStart target.
# exec's Node so systemd supervises the server process directly (clean SIGINT stop).
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(dirname "$DIR")"
# shellcheck source=/dev/null
source "$DIR/dex-pair-verify.env"

# shellcheck source=/dev/null
source "$DIR/nvm-init.sh"

cd "$APP_DIR"
exec node_modules/.bin/next start -H "$HOST" -p "$PORT"
