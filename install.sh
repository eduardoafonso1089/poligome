#!/usr/bin/env bash
set -euo pipefail
MIN_NODE_VERSION="22.13.0"
command -v node >/dev/null 2>&1 || { echo "[Poligome] Node.js >= $MIN_NODE_VERSION is required." >&2; exit 1; }
command -v npm >/dev/null 2>&1 || { echo "[Poligome] npm is required." >&2; exit 1; }
node -e "const [a,b,c]=process.versions.node.split('.').map(Number); if (a<22 || (a===22 && (b<13 || (b===13 && c<0)))) process.exit(1)" || { echo "[Poligome] Node.js >= $MIN_NODE_VERSION is required (found $(node -v))." >&2; exit 1; }
cd "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
echo "[Poligome] Installing locked dependencies..."
npm ci
echo "[Poligome] Installation complete. Run: npm run dev"
