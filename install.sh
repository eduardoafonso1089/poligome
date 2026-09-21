#!/usr/bin/env bash
set -euo pipefail

MIN_NODE_VERSION="22.13.0"
NODE_VERSION="22.13.1"

node_is_compatible() {
  command -v node >/dev/null 2>&1 && node -e '
    const [major, minor, patch] = process.versions.node.split(".").map(Number);
    process.exit(major > 22 || (major === 22 && (minor > 13 || (minor === 13 && patch >= 0))) ? 0 : 1);
  '
}

node_path_is_compatible() {
  [[ -x "$1" ]] && "$1" -e '
    const [major, minor, patch] = process.versions.node.split(".").map(Number);
    process.exit(major > 22 || (major === 22 && (minor > 13 || (minor === 13 && patch >= 0))) ? 0 : 1);
  '
}

download_file() {
  local destination="$1" url="$2"
  if command -v curl >/dev/null 2>&1; then
    curl --fail --location --retry 3 --connect-timeout 15 --output "$destination" "$url"
  elif command -v wget >/dev/null 2>&1; then
    wget --output-document="$destination" "$url"
  else
    echo "[Poligome] curl or wget is required to download Node.js. Install one and run this script again." >&2
    return 1
  fi
}

verify_sha256() {
  local expected="$1" archive="$2"
  if command -v sha256sum >/dev/null 2>&1; then
    printf '%s  %s\n' "$expected" "$archive" | sha256sum --check --status
  elif command -v shasum >/dev/null 2>&1; then
    [[ "$expected" == "$(shasum -a 256 "$archive" | awk '{print $1}')" ]]
  else
    echo "[Poligome] sha256sum or shasum is required to verify the Node.js download." >&2
    return 1
  fi
}

install_local_node() {
  local architecture archive cache_root checksum_file expected_checksum node_directory staging_directory temporary_directory
  case "$(uname -m)" in
    x86_64) architecture="x64" ;;
    aarch64|arm64) architecture="arm64" ;;
    *) echo "[Poligome] Unsupported Linux architecture: $(uname -m). Install Node.js >= $MIN_NODE_VERSION manually." >&2; return 1 ;;
  esac

  command -v tar >/dev/null 2>&1 || { echo "[Poligome] tar is required to unpack Node.js. Install it and run this script again." >&2; return 1; }
  cache_root="${XDG_CACHE_HOME:-${HOME:?HOME is required}/.cache}/poligome"
  node_directory="$cache_root/node-v$NODE_VERSION-linux-$architecture"

  if ! node_path_is_compatible "$node_directory/bin/node" || [[ ! -x "$node_directory/bin/npm" ]]; then
    mkdir -p "$cache_root"
    temporary_directory="$(mktemp -d "$cache_root/.node-v$NODE_VERSION-linux-$architecture.XXXXXX")"
    archive="$temporary_directory/node-v$NODE_VERSION-linux-$architecture.tar.xz"
    checksum_file="$temporary_directory/SHASUMS256.txt"
    staging_directory="$temporary_directory/node"
    echo "[Poligome] Downloading Node.js v$NODE_VERSION for Linux $architecture..."
    if ! download_file "$checksum_file" "https://nodejs.org/dist/v$NODE_VERSION/SHASUMS256.txt" || ! download_file "$archive" "https://nodejs.org/dist/v$NODE_VERSION/node-v$NODE_VERSION-linux-$architecture.tar.xz"; then
      rm -rf "$temporary_directory"
      return 1
    fi
    expected_checksum="$(awk -v archive="$(basename "$archive")" '$2 == archive { print $1 }' "$checksum_file")"
    if [[ -z "$expected_checksum" ]] || ! verify_sha256 "$expected_checksum" "$archive"; then
      echo "[Poligome] Node.js download verification failed." >&2
      rm -rf "$temporary_directory"
      return 1
    fi
    mkdir -p "$staging_directory"
    if ! tar -xJf "$archive" -C "$staging_directory" --strip-components=1 || ! node_path_is_compatible "$staging_directory/bin/node" || [[ ! -x "$staging_directory/bin/npm" ]]; then
      echo "[Poligome] Downloaded Node.js archive is incomplete or incompatible." >&2
      rm -rf "$temporary_directory"
      return 1
    fi
    rm -rf "$node_directory"
    if ! mv "$staging_directory" "$node_directory"; then
      rm -rf "$temporary_directory"
      return 1
    fi
    rm -rf "$temporary_directory"
  fi

  export PATH="$node_directory/bin:$PATH"
  export POLIGOME_NODE_BIN="$node_directory/bin"
}

if ! node_is_compatible; then
  found_version="$(node -v 2>/dev/null || echo 'not found')"
  echo "[Poligome] Node.js >= $MIN_NODE_VERSION is required (found $found_version)."
  install_local_node
fi

if ! node_is_compatible; then
  echo "[Poligome] Node.js >= $MIN_NODE_VERSION is required after automatic setup (found $(node -v 2>/dev/null || echo 'not found'))." >&2
  exit 1
fi
command -v npm >/dev/null 2>&1 || { echo "[Poligome] npm is required but was not provided by Node.js." >&2; exit 1; }

cd "$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
echo "[Poligome] Installing locked dependencies..."
npm ci
if [[ -n "${POLIGOME_NODE_BIN:-}" ]]; then
  echo "[Poligome] Installation complete. Run: PATH=\"$POLIGOME_NODE_BIN:\$PATH\" npm run dev"
else
  echo "[Poligome] Installation complete. Run: npm run dev"
fi
