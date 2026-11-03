#!/usr/bin/env bash
# Run one dex-pair-verify yarn script once (e.g. `pipeline`, `source-health`), logging to
# $LOG_ROOT/YYYY-MM/<log-name>-YYYY-MM-DD.log and skipping if a previous run of the same
# script still holds its lock. Intended to be driven from cron (see crontab.example).
# No -e: we want to capture the script's exit status rather than abort on it.
#   yarn-job.sh <yarn-script> [log-name, default: the script name]
set -uo pipefail

job="${1:?usage: yarn-job.sh <yarn-script> [log-name]}"
log_name="${2:-$job}"

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="$(dirname "$DIR")"
# shellcheck source=/dev/null
source "$DIR/dex-pair-verify.env"

log_dir="$LOG_ROOT/$(date +%Y-%m)"
log_file="$log_dir/$log_name-$(date +%Y-%m-%d).log"
mkdir -p "$log_dir"
exec >>"$log_file" 2>&1   # everything from here is logged

echo "=== $job invoked $(date -Is) ==="

# Skip if a previous run is still going (best effort; runs anyway if flock absent).
if command -v flock >/dev/null 2>&1; then
  exec 9>"$log_dir/.$job.lock"
  flock -n 9 || { echo "another run holds the lock, skipping"; exit 0; }
fi

# shellcheck source=/dev/null
source "$DIR/nvm-init.sh"

cd "$APP_DIR" || { echo "cannot cd to $APP_DIR"; exit 1; }

echo "=== yarn $job started $(date -Is) ==="
yarn "$job"
status=$?
echo "=== yarn $job finished $(date -Is) (exit $status) ==="
exit "$status"
