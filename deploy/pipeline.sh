#!/usr/bin/env bash
# Run the dex-pair-verify data pipeline once, logging to $LOG_ROOT/YYYY-MM/.
# Intended to be driven from cron (see crontab.example). No -e: we want to
# capture the pipeline's exit status rather than abort on it.
set -uo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(dirname "$DIR")"
# shellcheck source=/dev/null
source "$DIR/dex-pair-verify.env"

log_dir="$LOG_ROOT/$(date +%Y-%m)"
log_file="$log_dir/dex-pair-verify-$(date +%Y-%m-%d).log"
mkdir -p "$log_dir"
exec >>"$log_file" 2>&1   # everything from here is logged

echo "=== pipeline invoked $(date -Is) ==="

# Skip if a previous run is still going (best effort; runs anyway if flock absent).
if command -v flock >/dev/null 2>&1; then
  exec 9>"$log_dir/.pipeline.lock"
  flock -n 9 || { echo "another run holds the lock, skipping"; exit 0; }
fi

export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [ -s "$NVM_DIR/nvm.sh" ]; then
  # shellcheck source=/dev/null
  . "$NVM_DIR/nvm.sh"
else
  echo "nvm not found at $NVM_DIR/nvm.sh"
  exit 1
fi
nvm use "$NODE_VERSION" >/dev/null

cd "$APP_DIR" || { echo "cannot cd to $APP_DIR"; exit 1; }

echo "=== yarn pipeline started $(date -Is) ==="
yarn pipeline
status=$?
echo "=== yarn pipeline finished $(date -Is) (exit $status) ==="
exit "$status"
