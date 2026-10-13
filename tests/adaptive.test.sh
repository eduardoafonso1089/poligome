#!/usr/bin/env bash
set -euo pipefail

# Testes do Adaptive AI (LoRA local no SAM 2). Precisam de PyTorch, NumPy,
# OpenCV e Pillow; o venv sam2 que o instalador cria tem todos. Sem um
# interpretador capaz, o teste diz isso e sai sem fingir que passou.
#
#   POLIGOME_ADAPTIVE_PYTHON=/caminho/python bash tests/adaptive.test.sh

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

find_capable_python() {
  local candidate
  for candidate in \
    "${POLIGOME_ADAPTIVE_PYTHON:-}" \
    "$(command -v python3 || true)" \
    "${POLIGOME_APP_DIR:-${HOME}/.poligome-sam}/venvs/sam2/bin/python"; do
    if [[ -n "$candidate" && -x "$candidate" ]] &&
      "$candidate" -c 'import torch, numpy, cv2; from PIL import Image' >/dev/null 2>&1; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  return 1
}

if ! PYTHON="$(find_capable_python)"; then
  printf 'skip - Adaptive AI: nenhum python com torch, numpy, opencv e pillow (defina POLIGOME_ADAPTIVE_PYTHON).\n'
  exit 0
fi

cd "$PROJECT_ROOT"
"$PYTHON" -c "import ast,sys; ast.parse(open('public/poligome-sam-adaptive.py', encoding='utf-8').read())"
"$PYTHON" tests/adaptive-lora.test.py
