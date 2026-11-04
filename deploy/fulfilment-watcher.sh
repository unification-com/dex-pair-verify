#!/usr/bin/env bash
# Start the dex-pair-verify OoO fulfilment watcher (read-only: watches each Router's
# RequestFulfilled event and enqueues receipt hashes for the beacon writer to drip).
# systemd ExecStart target. exec's the worker so systemd supervises it directly (clean SIGINT stop).
# Holds no signing key. Config (BEACON_WATCH_* / OOO_ROUTER_*) is read from the repo-root .env.
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(dirname "$DIR")"
# shellcheck source=/dev/null
source "$DIR/dex-pair-verify.env"
# shellcheck source=/dev/null
source "$DIR/nvm-init.sh"

cd "$APP_DIR"
exec node_modules/.bin/tsx worker/fulfilment-watcher/index.ts
