#!/usr/bin/env bash
#
# ops/enumerate-gcp.sh — READ-ONLY GCP enumeration + diff against the
# Required_GCP_Resource_Set (simplify-to-cloud-minimal spec R11.2, R11.3; design C5).
#
# Lists the resources actually present in the live GCP project — Cloud Run
# services + jobs, Cloud Scheduler jobs, Secret Manager secrets, Artifact
# Registry repositories + images, service accounts, and the IAM policy
# bindings — and DIFFS the live set against ops/required-resources.manifest.json,
# classifying each resource as KEPT (a member of the Required_GCP_Resource_Set)
# or ORPHANED (an Orphaned_GCP_Resource, i.e. a deletion candidate).
#
# SAFETY — this script is STRICTLY READ-ONLY. It issues ONLY `list`, `describe`,
# and `get-iam-policy` commands. It contains NO create, NO update, NO delete,
# NO add/remove-iam-policy-binding, and NO deploy. It NEVER mutates any GCP
# resource and NEVER prints a secret value (secrets are listed by NAME only).
# The actual deletions are the SEPARATE, operator-approved task 7.2.
#
# Usage:
#   ops/enumerate-gcp.sh                 # human-readable report + kept/orphaned diff
#   ops/enumerate-gcp.sh --json          # dump raw live resource names as JSON blocks
#
# Requires: gcloud (authenticated), and the manifest alongside this script.

set -euo pipefail

PROJECT="trade-assistant-508806"
REGION="europe-west1"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MANIFEST="${HERE}/required-resources.manifest.json"

JSON_MODE="no"
if [[ "${1:-}" == "--json" ]]; then
  JSON_MODE="yes"
fi

if ! command -v gcloud >/dev/null 2>&1; then
  echo "ERROR: gcloud not found on PATH. Install/authenticate the Cloud SDK first." >&2
  exit 1
fi
if [[ ! -f "${MANIFEST}" ]]; then
  echo "ERROR: manifest not found at ${MANIFEST}" >&2
  exit 1
fi

# --- keep-list extracted from the manifest (names only) ----------------------
# Pure text extraction; no secret values are read. `grep -o` keeps this
# dependency-free (no jq required). If jq is available it is NOT required.
manifest_names() {
  # $1 = a JSON key whose string value should be collected ("name"/"email"/etc.)
  grep -oE "\"$1\"[[:space:]]*:[[:space:]]*\"[^\"]+\"" "${MANIFEST}" \
    | sed -E "s/.*:[[:space:]]*\"([^\"]+)\".*/\1/"
}

# The kept Secret Manager secret names are exactly those under secretManagerSecrets.
KEEP_SECRETS="$(sed -n '/"secretManagerSecrets"/,/"secretManagerSecretsNote"/p' "${MANIFEST}" \
  | grep -oE '"name"[[:space:]]*:[[:space:]]*"[^"]+"' \
  | sed -E 's/.*"([^"]+)".*/\1/' | sort -u)"

KEEP_JOBS="scheduled-daily-run"
KEEP_SERVICES=""   # the simplified system keeps NO Cloud Run service (read-proxy removed)
KEEP_SCHEDULERS="scheduled-daily-run-session-close"
KEEP_SAS="$(printf '%s\n' \
  'job-runtime@trade-assistant-508806.iam.gserviceaccount.com' \
  'scheduler-invoker@trade-assistant-508806.iam.gserviceaccount.com' \
  'gh-deploy@trade-assistant-508806.iam.gserviceaccount.com' | sort -u)"

# --- helpers -----------------------------------------------------------------
hr() { printf '%s\n' "------------------------------------------------------------"; }

# classify LIVE names (stdin, one per line) against a kept-set ($1 = kept list)
classify() {
  local kept="$1"
  local label="$2"
  local name
  while IFS= read -r name; do
    [[ -z "${name}" ]] && continue
    if grep -qxF "${name}" <<<"${kept}"; then
      printf '  KEEP     %s\n' "${name}"
    else
      printf '  ORPHANED %s   <-- deletion candidate (task 7.2)\n' "${name}"
    fi
  done
}

echo "GCP read-only enumeration — project ${PROJECT} (region ${REGION})"
echo "Diffed against ${MANIFEST}"
echo "READ-ONLY: list/describe/get-iam-policy only — no mutation."
hr

# --- 1. Cloud Run jobs -------------------------------------------------------
echo "[1] Cloud Run JOBS (gcloud run jobs list)"
RUN_JOBS="$(gcloud run jobs list --project "${PROJECT}" --region "${REGION}" \
  --format='value(metadata.name)' 2>/dev/null || true)"
if [[ "${JSON_MODE}" == "yes" ]]; then printf '%s\n' "${RUN_JOBS}"; else
  printf '%s\n' "${RUN_JOBS}" | classify "${KEEP_JOBS}" "jobs"; fi
hr

# --- 2. Cloud Run services ---------------------------------------------------
echo "[2] Cloud Run SERVICES (gcloud run services list) — expect NONE kept"
RUN_SVCS="$(gcloud run services list --project "${PROJECT}" --region "${REGION}" \
  --format='value(metadata.name)' 2>/dev/null || true)"
if [[ "${JSON_MODE}" == "yes" ]]; then printf '%s\n' "${RUN_SVCS}"; else
  printf '%s\n' "${RUN_SVCS}" | classify "${KEEP_SERVICES}" "services"; fi
hr

# --- 3. Cloud Scheduler jobs -------------------------------------------------
echo "[3] Cloud SCHEDULER jobs (gcloud scheduler jobs list)"
SCHED_JOBS="$(gcloud scheduler jobs list --project "${PROJECT}" --location "${REGION}" \
  --format='value(name)' 2>/dev/null | sed -E 's#.*/##' || true)"
if [[ "${JSON_MODE}" == "yes" ]]; then printf '%s\n' "${SCHED_JOBS}"; else
  printf '%s\n' "${SCHED_JOBS}" | classify "${KEEP_SCHEDULERS}" "schedulers"; fi
hr

# --- 4. Secret Manager secrets ----------------------------------------------
echo "[4] SECRET MANAGER secrets (gcloud secrets list) — NAMES ONLY, no values"
SECRETS="$(gcloud secrets list --project "${PROJECT}" \
  --format='value(name)' 2>/dev/null | sed -E 's#.*/##' || true)"
if [[ "${JSON_MODE}" == "yes" ]]; then printf '%s\n' "${SECRETS}"; else
  printf '%s\n' "${SECRETS}" | classify "${KEEP_SECRETS}" "secrets"; fi
hr

# --- 5. Artifact Registry repositories + images ------------------------------
echo "[5] ARTIFACT REGISTRY repositories (gcloud artifacts repositories list)"
AR_REPOS="$(gcloud artifacts repositories list --project "${PROJECT}" --location "${REGION}" \
  --format='value(name)' 2>/dev/null | sed -E 's#.*/##' || true)"
printf '%s\n' "${AR_REPOS}" | sed 's/^/  repo: /'
echo "    (per-repo images — read-only describe; retention enforced only in task 7.2)"
while IFS= read -r repo; do
  [[ -z "${repo}" ]] && continue
  echo "  images in ${repo} (gcloud artifacts docker images list):"
  gcloud artifacts docker images list "${REGION}-docker.pkg.dev/${PROJECT}/${repo}" \
    --project "${PROJECT}" --include-tags \
    --format='value(package,tags,createTime)' 2>/dev/null | sed 's/^/    /' || true
done <<<"${AR_REPOS}"
hr

# --- 6. Service accounts -----------------------------------------------------
echo "[6] SERVICE ACCOUNTS (gcloud iam service-accounts list)"
SAS="$(gcloud iam service-accounts list --project "${PROJECT}" \
  --format='value(email)' 2>/dev/null || true)"
if [[ "${JSON_MODE}" == "yes" ]]; then printf '%s\n' "${SAS}"; else
  # The job-runtime SA email is a GitHub var (not committed); it is KEPT when it
  # is the SA the Cloud Run Job actually runs as. We mark the two known-by-name
  # SAs KEEP and leave others for operator review against the live Job binding.
  printf '%s\n' "${SAS}" | classify "${KEEP_SAS}" "service-accounts"
  echo "  NOTE: the Job runtime SA (deploy.yml RUNTIME_SERVICE_ACCOUNT) is KEPT;"
  echo "        confirm its live email below, then treat any OTHER SA as a review candidate."
fi
hr

# --- 7. Project IAM policy bindings -----------------------------------------
echo "[7] PROJECT IAM policy bindings (gcloud projects get-iam-policy) — read-only"
gcloud projects get-iam-policy "${PROJECT}" \
  --flatten='bindings[].members' \
  --format='table(bindings.role, bindings.members)' 2>/dev/null \
  | sed 's/^/  /' || true
hr

# --- 8. Resource-level invoker binding (the Scheduler -> Job grant) ---------
echo "[8] Cloud Run Job IAM policy for scheduled-daily-run (get-iam-policy) — read-only"
gcloud run jobs get-iam-policy scheduled-daily-run \
  --project "${PROJECT}" --region "${REGION}" \
  --format='table(bindings.role, bindings.members)' 2>/dev/null \
  | sed 's/^/  /' || true
hr

# --- 9. Workload Identity Federation pools/providers -------------------------
echo "[9] WORKLOAD IDENTITY FEDERATION pools + providers (list) — read-only"
POOLS="$(gcloud iam workload-identity-pools list --project "${PROJECT}" --location=global \
  --format='value(name)' 2>/dev/null | sed -E 's#.*/##' || true)"
printf '%s\n' "${POOLS}" | sed 's/^/  pool: /'
while IFS= read -r pool; do
  [[ -z "${pool}" ]] && continue
  gcloud iam workload-identity-pools providers list \
    --project "${PROJECT}" --location=global --workload-identity-pool="${pool}" \
    --format='value(name)' 2>/dev/null | sed -E 's#.*/##' | sed "s#^#    provider (${pool}): #" || true
done <<<"${POOLS}"
hr

echo "Enumeration complete. Lines marked ORPHANED are Orphaned_GCP_Resource"
echo "candidates; their deletion is the SEPARATE operator-approved task 7.2."
echo "This script performed NO mutation."
