#!/usr/bin/env bash
# Posts a JUnit XML or Playwright JSON report to the Test Management Hub.
#
#   HUB_URL=http://localhost:4000 HUB_PROJECT_ID=1 \
#     scripts/publish-results.sh target/surefire-reports/TEST-CartApiTest.xml "API regression" staging 2.6.0
#
# Arguments: <report file> [run name] [environment] [build]
# Optional env: HUB_PLATFORM (platform for auto-created cases, default API), HUB_RUN_ID (add to an open run).
set -euo pipefail

report="${1:?usage: publish-results.sh <report file> [run name] [environment] [build]}"
url="${HUB_URL:-http://localhost:4000}"
project="${HUB_PROJECT_ID:-1}"

args=(-F "file=@${report}" -F "platform=${HUB_PLATFORM:-API}" -F "executedBy=${HUB_EXECUTED_BY:-ci}")
if [[ -n "${HUB_RUN_ID:-}" ]]; then
  args+=(-F "runId=${HUB_RUN_ID}")
else
  args+=(-F "runName=${2:-Automated results $(date -u +%Y-%m-%dT%H:%MZ)}" -F "environment=${3:-}" -F "build=${4:-}")
fi

curl --fail-with-body --silent --show-error -X POST "${args[@]}" "${url}/api/projects/${project}/imports"
echo
