#!/usr/bin/env bash
# Run the dex-pair-verify data pipeline once from cron (see crontab.example). Kept as its own
# entry point so existing cron lines and the dex-pair-verify-YYYY-MM-DD.log name stay unchanged.
exec /bin/bash "$(dirname "${BASH_SOURCE[0]}")/yarn-job.sh" pipeline dex-pair-verify
