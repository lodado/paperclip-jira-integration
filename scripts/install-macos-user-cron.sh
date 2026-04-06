#!/bin/sh
# Copy poll script to ~/Library/... so macOS cron can run it (Desktop/Documents TCC).
set -eu
REPO_ROOT=$(CDPATH= cd -- "$(dirname "$0")/.." && pwd)
DEST="${HOME}/Library/Application Support/papaclip-jira-kdl"
mkdir -p "$DEST"
cp "$REPO_ROOT/scripts/jira-poll-local-cron.sh" "$DEST/jira-poll-local-cron.sh"
chmod +x "$DEST/jira-poll-local-cron.sh"
printf '\nInstalled: %s/jira-poll-local-cron.sh\n' "$DEST"
printf 'Crontab line (5 min):\n'
printf '*/5 * * * * "%s/jira-poll-local-cron.sh"\n' "$DEST"
printf '\nThen: crontab -e  (paste the line). Re-run this script after git pull if the script changes.\n'
