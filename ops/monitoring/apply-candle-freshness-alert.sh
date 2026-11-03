#!/usr/bin/env bash
#
# ops/monitoring/apply-candle-freshness-alert.sh — apply the committed
# Candle_Freshness_Stage degraded alert (daily-candle-freshness-and-cleanup
# Phase 2b) to Cloud Monitoring in project trade-assistant-508806.
#
# What it does (idempotent):
#   1. Ensure the EMAIL notification channel from
#      candle-freshness-notification-channel.json exists; resolve its id.
#   2. Substitute that channel id into candle-freshness-alert-policy.json and
#      create the alert policy (or update it if one with the same displayName
#      already exists).
#
# The alert is LOG-BASED: it fires when the daily Cloud Run Job emits a
# `candle_freshness.degraded` (severity ERROR) log line — the signal that one or
# more pairs were left behind after the freshness stage (the silent-degrade the
# Oct-8 incident exposed). The daily run itself stays fail-safe/exit-0.
#
# SAFETY: this is a MUTATING ops script (it creates/updates a notification
# channel + alert policy). It writes NO secret value. Run it only with operator
# approval, under the Live Cloud Execution Protocol. It needs the gcloud `alpha`
# component for `gcloud alpha monitoring` (the script installs nothing; if the
# component is absent gcloud will prompt / the operator installs it first with
# `gcloud components install alpha`).
#
# Usage:
#   ops/monitoring/apply-candle-freshness-alert.sh          # apply
#   ops/monitoring/apply-candle-freshness-alert.sh --dry-run # print planned actions only

set -euo pipefail

PROJECT="trade-assistant-508806"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CHANNEL_JSON="${HERE}/candle-freshness-notification-channel.json"
POLICY_JSON="${HERE}/candle-freshness-alert-policy.json"

DRY_RUN="no"
if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN="yes"
fi

if ! command -v gcloud >/dev/null 2>&1; then
  echo "ERROR: gcloud not found on PATH. Install/authenticate the Cloud SDK first." >&2
  exit 1
fi

EMAIL="$(python3 -c "import json,sys; print(json.load(open('${CHANNEL_JSON}'))['labels']['email_address'])")"
CHANNEL_DISPLAY="$(python3 -c "import json,sys; print(json.load(open('${CHANNEL_JSON}'))['displayName'])")"
POLICY_DISPLAY="$(python3 -c "import json,sys; print(json.load(open('${POLICY_JSON}'))['displayName'])")"

echo "Project:            ${PROJECT}"
echo "Notification email: ${EMAIL}"
echo "Channel displayName:${CHANNEL_DISPLAY}"
echo "Policy displayName: ${POLICY_DISPLAY}"
echo

# --- 1. Ensure the email notification channel exists, resolve its id. --------
CHANNEL_ID="$(gcloud alpha monitoring channels list \
  --project="${PROJECT}" \
  --filter="type=email AND labels.email_address=${EMAIL}" \
  --format="value(name)" 2>/dev/null | head -n1 || true)"

if [[ -z "${CHANNEL_ID}" ]]; then
  echo "Notification channel not found — will CREATE it."
  # Strip the documentation-only `_comment` field (the API rejects unknown
  # fields) into a temp payload before sending.
  TMP_CHANNEL="$(mktemp)"
  trap 'rm -f "${TMP_CHANNEL:-}" "${TMP_POLICY:-}"' EXIT
  python3 - "${CHANNEL_JSON}" "${TMP_CHANNEL}" <<'PY'
import json, sys
src, out = sys.argv[1], sys.argv[2]
channel = json.load(open(src))
channel.pop("_comment", None)
json.dump(channel, open(out, "w"), indent=2)
PY
  if [[ "${DRY_RUN}" == "yes" ]]; then
    echo "[dry-run] gcloud alpha monitoring channels create --channel-content-from-file=${TMP_CHANNEL}"
  else
    CHANNEL_ID="$(gcloud alpha monitoring channels create \
      --project="${PROJECT}" \
      --channel-content-from-file="${TMP_CHANNEL}" \
      --format="value(name)")"
    echo "Created channel: ${CHANNEL_ID}"
  fi
else
  echo "Reusing existing channel: ${CHANNEL_ID}"
fi

# --- 2. Substitute the channel id into the policy + create/update it. --------
TMP_POLICY="$(mktemp)"
trap 'rm -f "${TMP_POLICY}"' EXIT
python3 - "${POLICY_JSON}" "${CHANNEL_ID:-__NOTIFICATION_CHANNEL__}" "${TMP_POLICY}" <<'PY'
import json, sys
src, channel, out = sys.argv[1], sys.argv[2], sys.argv[3]
policy = json.load(open(src))
policy.pop("_comment", None)
policy["notificationChannels"] = [channel]
json.dump(policy, open(out, "w"), indent=2)
PY

EXISTING_POLICY="$(gcloud alpha monitoring policies list \
  --project="${PROJECT}" \
  --filter="displayName=\"${POLICY_DISPLAY}\"" \
  --format="value(name)" 2>/dev/null | head -n1 || true)"

if [[ -z "${EXISTING_POLICY}" ]]; then
  echo "Alert policy not found — will CREATE it."
  if [[ "${DRY_RUN}" == "yes" ]]; then
    echo "[dry-run] gcloud alpha monitoring policies create --policy-from-file=${TMP_POLICY}"
  else
    gcloud alpha monitoring policies create \
      --project="${PROJECT}" \
      --policy-from-file="${TMP_POLICY}"
    echo "Alert policy created."
  fi
else
  echo "Alert policy exists (${EXISTING_POLICY}) — will UPDATE it."
  if [[ "${DRY_RUN}" == "yes" ]]; then
    echo "[dry-run] gcloud alpha monitoring policies update ${EXISTING_POLICY} --policy-from-file=${TMP_POLICY}"
  else
    gcloud alpha monitoring policies update "${EXISTING_POLICY}" \
      --project="${PROJECT}" \
      --policy-from-file="${TMP_POLICY}"
    echo "Alert policy updated."
  fi
fi

echo
echo "Done. A test can be forced by emitting a candle_freshness.degraded log line"
echo "(i.e. a daily run that leaves a pair behind), or via the Monitoring console."
