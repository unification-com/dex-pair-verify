#!/usr/bin/env bash
# Start the dex-pair-verify BEACON writer (root heartbeat + leaf/fulfilment/re-anchor drip).
# systemd ExecStart target. exec's the worker so systemd supervises it directly (clean SIGINT stop).
# Run ONE instance only — a single signing account means a serial nonce; a second would clash.
# BEACON_* config is read from the repo-root .env (loaded by lib/env), same as the web app.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(dirname "$DIR")"
# shellcheck source=/dev/null
source "$DIR/dex-pair-verify.env"
# shellcheck source=/dev/null
source "$DIR/nvm-init.sh"

cd "$APP_DIR"
exec node_modules/.bin/tsx worker/beacon-writer/index.ts
