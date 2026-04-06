#!/bin/sh
# Local Jira poll for cron: no URL-encoded JQL in crontab (avoids cron % parsing).
# Override with env: JIRA_POLL_CRON_BASE_URL, JIRA_POLL_CRON_JQL, JIRA_POLL_CRON_LOG,
# JIRA_POLL_SECRET or CRON_SECRET (when next start / Bearer required).
set -eu

BASE_URL="${JIRA_POLL_CRON_BASE_URL:-http://127.0.0.1:9997/integrations/jira/poll}"

if [ -n "${JIRA_POLL_CRON_JQL:-}" ]; then
  JQL="$JIRA_POLL_CRON_JQL"
else
  JQL='assignee = currentUser() AND statusCategory = "To Do" AND project = JUNGLETFT'
fi

LOG="${JIRA_POLL_CRON_LOG:-${HOME}/Library/Logs/papaclip-jira-poll.log}"
DIR=$(dirname "$LOG")
mkdir -p "$DIR"

AUTH=""
if [ -n "${JIRA_POLL_SECRET:-}" ]; then
  AUTH="$JIRA_POLL_SECRET"
elif [ -n "${CRON_SECRET:-}" ]; then
  AUTH="$CRON_SECRET"
fi

run() {
  if [ -n "$AUTH" ]; then
    /usr/bin/curl -sS -w "\nHTTP:%{http_code}\n" -G "$BASE_URL" \
      --data-urlencode "jqlOnly=1" \
      --data-urlencode "jql=$JQL" \
      -H "Authorization: Bearer $AUTH" \
      >>"$LOG" 2>&1
  else
    /usr/bin/curl -sS -w "\nHTTP:%{http_code}\n" -G "$BASE_URL" \
      --data-urlencode "jqlOnly=1" \
      --data-urlencode "jql=$JQL" \
      >>"$LOG" 2>&1
  fi
}

run
