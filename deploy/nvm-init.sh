#!/usr/bin/env bash
# Shared nvm bootstrap for the dex-pair-verify deploy scripts (run.sh, pipeline.sh,
# beacon-writer.sh, fulfilment-watcher.sh). SOURCE this — do not execute it — AFTER
# sourcing dex-pair-verify.env (it needs $NODE_VERSION in scope). On return the
# requested Node is selected; a missing nvm aborts the calling script (exit 1).
export NVM_DIR="${NVM_DIR:-$HOME/.nvm}"
if [ -s "$NVM_DIR/nvm.sh" ]; then
  # shellcheck source=/dev/null
  . "$NVM_DIR/nvm.sh"
else
  echo "nvm not found at $NVM_DIR/nvm.sh" >&2
  exit 1
fi
nvm use "$NODE_VERSION" >/dev/null
