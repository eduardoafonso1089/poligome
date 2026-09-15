#!/usr/bin/env bash
# Functional tier: drives the built editor in a real browser.
#
# These audits used to run only inside the interaction-audit workflow, against a
# playwright installed with `npm install --no-save playwright@1.55.0`. The
# version lived in a YAML string instead of the lockfile, and nobody could run
# them locally. Playwright is a devDependency now and this script is the one
# entry point, used identically by a contributor and by CI.
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(cd "${script_dir}/.." && pwd)"
port="${AUDIT_PORT:-4174}"
base="http://127.0.0.1:${port}"
serve_root="${root}/out"

cd "${root}"

if [[ ! -x node_modules/.bin/vinext ]]; then
  echo "Dependencies are missing. Run npm ci first." >&2
  exit 69
fi

# The static export is what production serves. vinext start is not usable here:
# with trailingSlash: true it answers 308 for /demo/*.jpg and the demo cannot load.
if [[ ! -d "${serve_root}" ]]; then
  echo "[audit] building the static export"
  npm run build:pages
fi

if [[ ! -d "${serve_root}" ]]; then
  echo "Expected a static export at ${serve_root}." >&2
  exit 69
fi

cleanup() {
  if [[ -n "${server_pid:-}" ]]; then kill "${server_pid}" 2>/dev/null || true; fi
}
trap cleanup EXIT

echo "[audit] serving ${serve_root} on ${base}"
python3 -m http.server "${port}" --bind 127.0.0.1 --directory "${serve_root}" >/dev/null 2>&1 &
server_pid=$!

for _ in $(seq 1 40); do
  if curl -LfsS "${base}/annotate/" >/dev/null 2>&1; then break; fi
  sleep 1
done
if ! curl -LfsS "${base}/annotate/" >/dev/null 2>&1; then
  echo "The audit server never answered on ${base}." >&2
  exit 69
fi

export AUDIT_BASE_URL="${base}"

audits=(
  "run-demo-entry-audit.mjs"
  "image-reorder-audit.mjs"
  "mobile-restored-demo-state-audit.mjs"
  "run-editor-interaction-audit.mjs"
  "mobile-toolbar-layout-audit.mjs"
)
full_demo_audits=(
  "mobile-full-interaction-audit.mjs"
  "mobile-command-interaction-audit.mjs"
  "editor-advanced-interaction-audit.mjs"
)

failed=()
for audit in "${audits[@]}"; do
  echo "[audit] ${audit}"
  node "scripts/${audit}" || failed+=("${audit}")
done
for audit in "${full_demo_audits[@]}"; do
  echo "[audit] ${audit} (full demo)"
  node "scripts/run-audit-with-full-demo.mjs" "${audit}" || failed+=("${audit}")
done

if [[ "${#failed[@]}" -gt 0 ]]; then
  printf '[audit] FAILED: %s\n' "${failed[@]}" >&2
  exit 1
fi
echo "[audit] all interaction audits passed"
