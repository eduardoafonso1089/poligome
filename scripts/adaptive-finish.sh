#!/usr/bin/env bash
set -euo pipefail

# Termina a validação do Adaptive AI. Ver docs/adaptive-ai-next-steps.md.
#
#   bash scripts/adaptive-finish.sh experiments <checkpoint-sam2.1.pt> [saida]
#   bash scripts/adaptive-finish.sh sam3-smoke <url-do-conector> [saida]
#   bash scripts/adaptive-finish.sh tests
#
# PYTHON pode apontar para o venv do instalador (~/.poligome-sam/venvs/sam2/bin/python
# ou .../venvs/sam3/bin/python); precisa de torch, numpy, opencv e pillow.

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PYTHON="${PYTHON:-python3}"
cd "$ROOT"

case "${1:-}" in
  experiments)
    checkpoint="${2:?informe o checkpoint do SAM 2.1 (ex.: sam2.1_hiera_tiny.pt)}"
    out="${3:-resultados-adaptive}"
    mkdir -p "$out"
    "$PYTHON" scripts/adaptive-experiments.py --checkpoint "$checkpoint" --out "$out" \
      --device "${POLIGOME_ADAPTIVE_DEVICE:-cpu}" --only main half overfit encoder 2>&1 | tee "$out/experiments.log"
    printf 'Resultados em %s/results.json\n' "$out"
    ;;
  sam3-smoke)
    base="${2:-http://127.0.0.1:7860}"
    out="${3:-resultados-adaptive}"
    mkdir -p "$out"
    "$PYTHON" scripts/adaptive-smoke.py --base "$base" --expect-family sam3 --domain nuclei --images 24 \
      --max-epochs 6 --strategy decoder --report "$out/sam3-smoke.json" 2>&1 | tee "$out/sam3-smoke.log"
    ;;
  tests)
    POLIGOME_ADAPTIVE_PYTHON="$PYTHON" bash tests/adaptive.test.sh
    if "$PYTHON" -c "import importlib.util, sys; sys.exit(importlib.util.find_spec('sam3') is None)" >/dev/null 2>&1; then
      POLIGOME_TEST_SAM3=1 "$PYTHON" tests/adaptive-lora.test.py -k Sam3IntegrationTests
    else
      printf 'skip - pacote sam3 ausente; testes do SAM 3 não rodaram.\n'
    fi
    npm run test:unit
    ;;
  *)
    sed -n '3,12p' "$0"
    exit 2
    ;;
esac
