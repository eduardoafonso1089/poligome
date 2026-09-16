#!/usr/bin/env bash
set -euo pipefail

POLIGOME_SAM_INSTALLER_API=2

DEFAULT_SITE_URL="https://www.poligome.com"
DEFAULT_ASSET_BASE_URL="https://raw.githubusercontent.com/eduardoafonso1089/poligome/main/public"
DEFAULT_CONNECTOR_URL="${DEFAULT_ASSET_BASE_URL}/poligome-sam-local.py"
DEFAULT_CONNECTOR_SHA256="7472518d71da52344526984ab166633abdae1f4e732a17ed79f70997a0b8ed47"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SITE_URL="${POLIGOME_SITE_URL:-${DEFAULT_SITE_URL}}"
SITE_URL="${SITE_URL%/}"
ASSET_BASE_URL="${POLIGOME_ASSET_BASE_URL:-${DEFAULT_ASSET_BASE_URL}}"
ASSET_BASE_URL="${ASSET_BASE_URL%/}"
APP_DIR="${HOME}/.poligome-sam"
VENVS_DIR="${APP_DIR}/venvs"
MODELS_DIR="${APP_DIR}/models"
CONNECTOR="${APP_DIR}/poligome-sam-local.py"
SELECTED_MODEL_FILE="${APP_DIR}/selected-model.txt"
PENDING_MODEL_FILE="${APP_DIR}/pending-model.txt"
PORT="7860"
STARTUP_TIMEOUT="${POLIGOME_STARTUP_TIMEOUT:-1800}"
# auto escolhe CUDA, depois MPS, depois CPU. Forçar cpu é a saída de quem tem
# uma GPU que o PyTorch enxerga mas que não aguenta o modelo.
DEVICE="${POLIGOME_DEVICE:-auto}"

SAM2_REVISION="2b90b9f5ceec907a1c18123530e92e794ad901a4"
SAM3_REVISION="8f0b7f4d4e7eda2ed606ebde6702c93359ad01da"
# As rodas oficiais do PyTorch CUDA 12.8 trazem kernels de sm_70 em diante.
SAM3_MIN_COMPUTE_MAJOR=7

usage() {
  cat <<'EOF'
Poligome SAM local — instalador para macOS/Linux

Uso:
  bash poligome-sam-macos-linux.sh [MODELO]
  bash poligome-sam-macos-linux.sh --help

Modelos aceitos:
  sam2.1-hiera-tiny
  sam2.1-hiera-small
  sam2.1-hiera-base-plus
  sam2.1-hiera-large
  medsam2-latest             (alias aceito: medsam2)
  medsam2-ct-lesion          (alias aceito: medsam2-ct)
  medsam2-mri-liver-lesion   (alias aceito: medsam2-mri)
  medsam2-us-heart           (alias aceito: medsam2-us)
  medsam2-2411
  sam3-concepts              (alias aceito: sam3)

Sem MODELO, o instalador abre um menu. SAM 3 exige Linux, GPU NVIDIA,
Python 3.12+ e acesso aprovado ao checkpoint gated da Meta no Hugging Face.

Variáveis opcionais:
  POLIGOME_SITE_URL        URL HTTPS aberta no navegador e aceita no CORS
  POLIGOME_ASSET_BASE_URL  origem HTTPS pública dos arquivos do instalador
  POLIGOME_CONNECTOR_PATH  conector local explícito para desenvolvimento/offline
  POLIGOME_STARTUP_TIMEOUT segundos máximos para o primeiro carregamento (padrão: 1800)
  POLIGOME_DEVICE          auto (padrão), cpu, cuda ou mps
EOF
}

fail() {
  printf '\nErro: %s\n' "$*" >&2
  exit 1
}

normalize_model() {
  local normalized
  normalized="$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')"
  case "$normalized" in
    sam2.1-hiera-tiny|sam2.1-hiera-small|sam2.1-hiera-base-plus|sam2.1-hiera-large|\
    medsam2-latest|medsam2-ct-lesion|medsam2-mri-liver-lesion|medsam2-us-heart|\
    medsam2-2411|sam3-concepts)
      printf '%s\n' "$normalized"
      ;;
    sam3)
      printf '%s\n' "sam3-concepts"
      ;;
    medsam2)
      printf '%s\n' "medsam2-latest"
      ;;
    medsam2-ct)
      printf '%s\n' "medsam2-ct-lesion"
      ;;
    medsam2-mri)
      printf '%s\n' "medsam2-mri-liver-lesion"
      ;;
    medsam2-us)
      printf '%s\n' "medsam2-us-heart"
      ;;
    *)
      return 1
      ;;
  esac
}

choose_model() {
  local choice
  printf '\nEscolha o modelo que deseja instalar e usar:\n\n' >&2
  printf '  1) SAM 2.1 Hiera Tiny      (~156 MB; imagem/vídeo)\n' >&2
  printf '  2) SAM 2.1 Hiera Small     (~184 MB; recomendado)\n' >&2
  printf '  3) SAM 2.1 Hiera Base+     (~324 MB; imagem/vídeo)\n' >&2
  printf '  4) SAM 2.1 Hiera Large     (~898 MB; imagem/vídeo)\n' >&2
  printf '  5) MedSAM2                 (~156 MB; imagem médica geral)\n' >&2
  printf '  6) MedSAM2 lesão em TC     (~156 MB; tomografia)\n' >&2
  printf '  7) MedSAM2 lesão em RM     (~156 MB; fígado)\n' >&2
  printf '  8) MedSAM2 ecocardiograma  (~156 MB; ultrassom)\n' >&2
  printf '  9) MedSAM2 2411            (~156 MB; versão anterior)\n' >&2
  printf ' 10) SAM 3 Concepts          (~3,45 GB; Linux + NVIDIA)\n\n' >&2
  printf 'Digite 1–10 ou o ID completo: ' >&2
  IFS= read -r choice || fail "não foi possível ler a escolha. Informe o ID como primeiro argumento."
  case "$choice" in
    1) printf '%s\n' "sam2.1-hiera-tiny" ;;
    2) printf '%s\n' "sam2.1-hiera-small" ;;
    3) printf '%s\n' "sam2.1-hiera-base-plus" ;;
    4) printf '%s\n' "sam2.1-hiera-large" ;;
    5) printf '%s\n' "medsam2-latest" ;;
    6) printf '%s\n' "medsam2-ct-lesion" ;;
    7) printf '%s\n' "medsam2-mri-liver-lesion" ;;
    8) printf '%s\n' "medsam2-us-heart" ;;
    9) printf '%s\n' "medsam2-2411" ;;
    10) printf '%s\n' "sam3-concepts" ;;
    *) normalize_model "$choice" || fail "modelo inválido: ${choice}" ;;
  esac
}

python_meets() {
  local command_name="$1"
  local major="$2"
  local minor="$3"
  command -v "$command_name" >/dev/null 2>&1 || return 1
  "$command_name" -c "import sys; raise SystemExit(0 if sys.version_info >= (${major}, ${minor}) else 1)" >/dev/null 2>&1
}

find_python() {
  local major="$1"
  local minor="$2"
  local candidate
  for candidate in python3.13 python3.12 python3.11 python3.10 python3 python; do
    if python_meets "$candidate" "$major" "$minor"; then
      command -v "$candidate"
      return 0
    fi
  done
  return 1
}

require_https() {
  local url="$1"
  local remainder
  local authority
  [[ "$url" == https://* ]] || fail "download recusado porque a URL não usa HTTPS: $url"
  [[ "$url" != *'?'* && "$url" != *'#'* && ! "$url" =~ [[:space:]] ]] ||
    fail "URL HTTPS inválida; consultas, fragmentos e espaços não são aceitos: $url"
  remainder="${url#https://}"
  authority="${remainder%%/*}"
  [[ -n "$authority" && "$authority" != *'@'* ]] ||
    fail "URL HTTPS inválida; host ausente ou credenciais embutidas: $url"
}

download_to_file() {
  local url="$1"
  local destination="$2"
  require_https "$url"
  mkdir -p "$(dirname "$destination")"
  if command -v curl >/dev/null 2>&1; then
    curl --fail --location --proto '=https' --proto-redir '=https' --retry 3 --retry-delay 2 --progress-bar "$url" --output "$destination" || return 1
  elif command -v wget >/dev/null 2>&1; then
    wget --https-only --tries=3 --show-progress "$url" --output-document="$destination" || return 1
  else
    fail "instale curl ou wget para continuar."
  fi
  [[ -s "$destination" ]]
}

download_atomic() {
  local url="$1"
  local destination="$2"
  local expected_size="${3:-0}"
  local partial="${destination}.part"
  rm -f "$partial"
  if ! download_to_file "$url" "$partial"; then
    rm -f "$partial"
    fail "não foi possível baixar o arquivo esperado de ${url}."
  fi
  if ! file_has_size "$partial" "$expected_size"; then
    local actual_size
    actual_size="$(file_size "$partial")"
    rm -f "$partial"
    fail "o download de ${url} ficou incompleto (${actual_size} bytes; esperado: ${expected_size})."
  fi
  mv -f "$partial" "$destination"
}

file_size() {
  local path="$1"
  [[ -f "$path" ]] || {
    printf '0\n'
    return 0
  }
  LC_ALL=C wc -c <"$path" | tr -d '[:space:]'
}

file_has_size() {
  local path="$1"
  local expected_size="$2"
  local actual_size
  [[ -f "$path" && "$expected_size" =~ ^[1-9][0-9]*$ ]] || return 1
  actual_size="$(file_size "$path")"
  [[ "$actual_size" == "$expected_size" ]]
}

file_sha256() {
  local path="$1"
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$path" | awk '{print $1}'
  elif command -v shasum >/dev/null 2>&1; then
    shasum -a 256 "$path" | awk '{print $1}'
  else
    return 1
  fi
}

connector_is_compatible() {
  local path="$1"
  [[ -f "$path" && -s "$path" ]] &&
    grep -Fqx 'API_VERSION = 2' "$path" &&
    grep -Fq -- '"--model"' "$path"
}

download_connector() {
  local url
  local expected_sha256=""
  local partial="${CONNECTOR}.part"
  local adjacent_connector="${SCRIPT_DIR}/poligome-sam-local.py"
  mkdir -p "$(dirname "$partial")"
  rm -f "$partial"
  if [[ -n "${POLIGOME_CONNECTOR_PATH:-}" ]]; then
    [[ -f "$POLIGOME_CONNECTOR_PATH" && -s "$POLIGOME_CONNECTOR_PATH" ]] ||
      fail "POLIGOME_CONNECTOR_PATH não aponta para um arquivo de conector válido."
    printf 'Instalando o conector local informado em POLIGOME_CONNECTOR_PATH...\n'
    if ! cp "$POLIGOME_CONNECTOR_PATH" "$partial"; then
      rm -f "$partial"
      fail "não foi possível copiar o conector local para ${partial}."
    fi
  elif [[ -f "$adjacent_connector" && -s "$adjacent_connector" ]]; then
    printf 'Instalando o conector distribuído junto do instalador...\n'
    expected_sha256="$DEFAULT_CONNECTOR_SHA256"
    if ! cp "$adjacent_connector" "$partial"; then
      rm -f "$partial"
      fail "não foi possível copiar o conector distribuído para ${partial}."
    fi
  else
    if [[ -n "${POLIGOME_ASSET_BASE_URL:-}" ]]; then
      url="${ASSET_BASE_URL}/poligome-sam-local.py"
    else
      url="$DEFAULT_CONNECTOR_URL"
      expected_sha256="$DEFAULT_CONNECTOR_SHA256"
    fi
    require_https "$url"
    printf 'Baixando o conector canônico do Poligome da origem pública...\n'
    if ! download_to_file "$url" "$partial"; then
      rm -f "$partial"
      if connector_is_compatible "$CONNECTOR"; then
        printf 'A origem pública não respondeu; reutilizando o conector local compatível.\n'
        return 0
      fi
      fail "não foi possível baixar o conector de ${url}."
    fi
  fi
  if ! connector_is_compatible "$partial"; then
    rm -f "$partial"
    if [[ -z "${POLIGOME_CONNECTOR_PATH:-}" && ! -s "$adjacent_connector" ]] &&
      connector_is_compatible "$CONNECTOR"; then
      printf 'A origem pública forneceu uma versão incompatível; reutilizando o conector local compatível.\n'
      return 0
    fi
    fail "a origem forneceu um conector incompatível com a API 2 e a opção --model. Tente novamente após atualizar o Poligome."
  fi
  if [[ -n "$expected_sha256" ]]; then
    local actual_sha256
    actual_sha256="$(file_sha256 "$partial")" || {
      rm -f "$partial"
      fail "sha256sum ou shasum é necessário para validar o conector versionado."
    }
    if [[ "$actual_sha256" != "$expected_sha256" ]]; then
      rm -f "$partial"
      fail "a soma SHA-256 do conector versionado não corresponde ao artefato publicado."
    fi
  fi
  chmod 600 "$partial"
  mv -f "$partial" "$CONNECTOR"
}

cache_current_installer() {
  local source_installer="${SCRIPT_DIR}/$(basename "${BASH_SOURCE[0]}")"
  local cached_installer="${APP_DIR}/bin/poligome-sam-macos-linux.sh"
  local partial="${cached_installer}.part"
  [[ -f "$source_installer" && -s "$source_installer" ]] ||
    fail "não foi possível localizar o próprio instalador para habilitar a retomada automática."
  grep -Fqx 'POLIGOME_SAM_INSTALLER_API=2' "$source_installer" ||
    fail "o instalador atual não possui o marcador de compatibilidade esperado."
  mkdir -p "$(dirname "$cached_installer")"
  rm -f "$partial"
  if ! cp "$source_installer" "$partial"; then
    rm -f "$partial"
    fail "não foi possível guardar o instalador para retomada automática."
  fi
  chmod 700 "$partial"
  mv -f "$partial" "$cached_installer"
}

open_site() {
  if command -v open >/dev/null 2>&1; then
    open "$SITE_URL" >/dev/null 2>&1 || true
  elif command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$SITE_URL" >/dev/null 2>&1 || true
  fi
}

server_state() {
  "$PYTHON" - "$MODEL_ID" "$PORT" <<'PY' 2>/dev/null
import json
import sys
import urllib.request

expected_model, port = sys.argv[1:]
try:
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with opener.open(f"http://127.0.0.1:{port}/health", timeout=2) as response:
        payload = json.load(response)
except Exception:
    print("offline")
    raise SystemExit(0)
if payload.get("service") != "Poligome SAM local" or payload.get("api_version") != 2:
    print("mismatch")
elif payload.get("model_id") != expected_model:
    print("mismatch")
elif payload.get("status") in {"loading", "ready", "error"}:
    print(payload["status"])
else:
    print("unhealthy")
PY
}

server_error_message() {
  "$PYTHON" - "$PORT" <<'PY' 2>/dev/null || true
import json
import sys
import urllib.request

try:
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with opener.open(f"http://127.0.0.1:{sys.argv[1]}/health", timeout=2) as response:
        payload = json.load(response)
except Exception:
    raise SystemExit(0)
message = str(payload.get("error") or "erro não detalhado").replace("\n", " ")
print(message[:500])
PY
}

local_port_is_in_use() {
  "$PYTHON" - "$PORT" <<'PY' >/dev/null 2>&1
import socket
import sys

sock = socket.socket()
sock.settimeout(1)
try:
    result = sock.connect_ex(("127.0.0.1", int(sys.argv[1])))
finally:
    sock.close()
raise SystemExit(0 if result == 0 else 1)
PY
}

set_model_metadata() {
  MODEL_ID="$1"
  MODEL_CONFIG=""
  case "$MODEL_ID" in
    sam2.1-hiera-tiny)
      FAMILY="sam2"
      CHECKPOINT_NAME="sam2.1_hiera_tiny.pt"
      CHECKPOINT_URL="https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_tiny.pt"
      CHECKPOINT_SIZE=156008466
      MODEL_CONFIG="configs/sam2.1/sam2.1_hiera_t.yaml"
      ;;
    sam2.1-hiera-small)
      FAMILY="sam2"
      CHECKPOINT_NAME="sam2.1_hiera_small.pt"
      CHECKPOINT_URL="https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_small.pt"
      CHECKPOINT_SIZE=184416285
      MODEL_CONFIG="configs/sam2.1/sam2.1_hiera_s.yaml"
      ;;
    sam2.1-hiera-base-plus)
      FAMILY="sam2"
      CHECKPOINT_NAME="sam2.1_hiera_base_plus.pt"
      CHECKPOINT_URL="https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_base_plus.pt"
      CHECKPOINT_SIZE=323606802
      MODEL_CONFIG="configs/sam2.1/sam2.1_hiera_b+.yaml"
      ;;
    sam2.1-hiera-large)
      FAMILY="sam2"
      CHECKPOINT_NAME="sam2.1_hiera_large.pt"
      CHECKPOINT_URL="https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_large.pt"
      CHECKPOINT_SIZE=898083611
      MODEL_CONFIG="configs/sam2.1/sam2.1_hiera_l.yaml"
      ;;
    medsam2-latest)
      FAMILY="sam2"
      CHECKPOINT_NAME="MedSAM2_latest.pt"
      CHECKPOINT_URL="https://huggingface.co/wanglab/MedSAM2/resolve/main/MedSAM2_latest.pt"
      CHECKPOINT_SIZE=156040129
      MODEL_CONFIG="configs/sam2.1/sam2.1_hiera_t.yaml"
      ;;
    medsam2-ct-lesion)
      FAMILY="sam2"
      CHECKPOINT_NAME="MedSAM2_CTLesion.pt"
      CHECKPOINT_URL="https://huggingface.co/wanglab/MedSAM2/resolve/main/MedSAM2_CTLesion.pt"
      CHECKPOINT_SIZE=156041079
      MODEL_CONFIG="configs/sam2.1/sam2.1_hiera_t.yaml"
      ;;
    medsam2-mri-liver-lesion)
      FAMILY="sam2"
      CHECKPOINT_NAME="MedSAM2_MRI_LiverLesion.pt"
      CHECKPOINT_URL="https://huggingface.co/wanglab/MedSAM2/resolve/main/MedSAM2_MRI_LiverLesion.pt"
      CHECKPOINT_SIZE=156044532
      MODEL_CONFIG="configs/sam2.1/sam2.1_hiera_t.yaml"
      ;;
    medsam2-us-heart)
      FAMILY="sam2"
      CHECKPOINT_NAME="MedSAM2_US_Heart.pt"
      CHECKPOINT_URL="https://huggingface.co/wanglab/MedSAM2/resolve/main/MedSAM2_US_Heart.pt"
      CHECKPOINT_SIZE=156041079
      MODEL_CONFIG="configs/sam2.1/sam2.1_hiera_t.yaml"
      ;;
    medsam2-2411)
      FAMILY="sam2"
      CHECKPOINT_NAME="MedSAM2_2411.pt"
      CHECKPOINT_URL="https://huggingface.co/wanglab/MedSAM2/resolve/main/MedSAM2_2411.pt"
      CHECKPOINT_SIZE=156039179
      MODEL_CONFIG="configs/sam2.1/sam2.1_hiera_t.yaml"
      ;;
    sam3-concepts)
      FAMILY="sam3"
      CHECKPOINT_NAME="sam3.pt"
      CHECKPOINT_URL=""
      CHECKPOINT_SIZE=3450062241
      ;;
    *)
      fail "modelo inválido: ${MODEL_ID}"
      ;;
  esac
  VENV_DIR="${VENVS_DIR}/${FAMILY}"
  PYTHON="${VENV_DIR}/bin/python"
  CHECKPOINT="${MODELS_DIR}/${MODEL_ID}/${CHECKPOINT_NAME}"
}

check_platform() {
  OS_NAME="$(uname -s)"
  case "$OS_NAME" in
    Linux|Darwin) ;;
    *) fail "sistema não suportado por este instalador: ${OS_NAME}" ;;
  esac

  if [[ "$OS_NAME" == "Darwin" ]]; then
    # O PyTorch 2.5.1+ publica wheels de macOS apenas para arm64: em Macs Intel
    # o pip falharia com "no matching distribution" no meio da instalação.
    local arch
    arch="$(uname -m)"
    [[ "$arch" == "arm64" ]] ||
      fail "no macOS, o SAM 2.1 exige um Mac Apple Silicon: o PyTorch 2.5.1+ não publica mais wheels para Intel (${arch}). Use Linux, ou um Mac M1 ou mais novo."
    local macos_major
    macos_major="$(sw_vers -productVersion 2>/dev/null | cut -d. -f1)"
    if [[ "$macos_major" =~ ^[0-9]+$ ]] && (( macos_major < 14 )); then
      fail "no macOS, o PyTorch atual exige macOS 14 ou mais novo; esta máquina roda ${macos_major}. Atualize o sistema ou use Linux."
    fi
  fi

  if [[ "$MODEL_ID" == "sam3-concepts" ]]; then
    if [[ "$OS_NAME" == "Darwin" ]]; then
      fail "SAM 3 não é oferecido no macOS: o upstream exige Linux, GPU NVIDIA e CUDA 12.6+. Escolha um modelo SAM 2.1."
    fi
    command -v nvidia-smi >/dev/null 2>&1 ||
      fail "SAM 3 exige uma GPU NVIDIA disponível no Linux; nvidia-smi não foi encontrado."
    nvidia-smi -L >/dev/null 2>&1 ||
      fail "SAM 3 exige uma GPU NVIDIA funcional; nvidia-smi não conseguiu acessá-la."
    # Ter CUDA não basta: as rodas oficiais do PyTorch CUDA 12.8 trazem kernels
    # de sm_70 para cima, e numa placa mais antiga torch.cuda.is_available()
    # responde "sim" mas toda execução morre com
    # "no kernel image is available for execution on the device". Perguntar a
    # capability aqui custa nada e evita baixar o runtime e o checkpoint —
    # cerca de 11 GB — para só então descobrir isso.
    local capability major minor gpu_name
    capability="$(nvidia-smi --query-gpu=compute_cap --format=csv,noheader 2>/dev/null | head -n 1 | tr -d '[:space:]')"
    if [[ "$capability" =~ ^([0-9]+)\.([0-9]+)$ ]]; then
      major="${BASH_REMATCH[1]}"
      minor="${BASH_REMATCH[2]}"
      if (( major < SAM3_MIN_COMPUTE_MAJOR )); then
        gpu_name="$(nvidia-smi --query-gpu=name --format=csv,noheader 2>/dev/null | head -n 1)"
        fail "SAM 3 exige uma GPU com capability ${SAM3_MIN_COMPUTE_MAJOR}.0 ou maior; ${gpu_name:-esta GPU} tem ${major}.${minor}. O PyTorch CUDA 12.8 não publica kernels para ela, e o modelo não chegaria a carregar. Escolha um SAM 2.1 ou MedSAM2, que rodam nesta máquina."
      fi
    fi
  fi
}

prepare_venv() {
  local minimum_minor
  local incompatible_backup
  case "$FAMILY" in
    sam2) minimum_minor=10 ;;
    sam3) minimum_minor=12 ;;
    *) fail "família de runtime inválida: ${FAMILY}" ;;
  esac

  if [[ -x "$PYTHON" ]] &&
    ! "$PYTHON" -c "import sys; raise SystemExit(0 if sys.version_info >= (3, ${minimum_minor}) else 1)" >/dev/null 2>&1; then
    incompatible_backup="${VENV_DIR}.incompatible-$(date +%Y%m%d%H%M%S)-$$"
    printf 'Preservando o ambiente Python incompatível em %s e recriando o runtime...\n' "$incompatible_backup"
    mv "$VENV_DIR" "$incompatible_backup" ||
      fail "não foi possível preservar o ambiente Python incompatível."
  fi

  if [[ ! -x "$PYTHON" ]]; then
    local system_python
    system_python="$(find_python 3 "$minimum_minor")" ||
      fail "Python 3.${minimum_minor}+ não foi encontrado. Instale essa versão do Python e execute novamente."
    printf 'Criando ambiente isolado da família %s com %s...\n' "$FAMILY" "$system_python"
    mkdir -p "$VENVS_DIR"
    "$system_python" -m venv "$VENV_DIR" ||
      fail "não foi possível criar o ambiente virtual. No Linux, instale também o pacote python3-venv."
  fi

  "$PYTHON" -c "import sys; raise SystemExit(0 if sys.version_info >= (3, ${minimum_minor}) else 1)" >/dev/null 2>&1 ||
    fail "o ambiente ${VENV_DIR} não pôde ser criado com Python 3.${minimum_minor}+."
}

install_runtime() {
  local ready_file
  case "$FAMILY" in
    sam2) ready_file="${VENV_DIR}/.poligome-sam2-${SAM2_REVISION}.ok" ;;
    sam3) ready_file="${VENV_DIR}/.poligome-sam3-${SAM3_REVISION}.ok" ;;
  esac

  if [[ "$FAMILY" == "sam3" && -f "$ready_file" ]] &&
    { ! hf_available ||
      ! "$PYTHON" -c 'import einops, huggingface_hub, pkg_resources, psutil, pycocotools' >/dev/null 2>&1; }; then
    printf 'Completando dependências de runtime omitidas pelo pacote oficial do SAM 3...\n'
    "$PYTHON" -m pip install --upgrade "setuptools<81" einops huggingface_hub psutil pycocotools
  fi

  if [[ -f "$ready_file" ]]; then
    if "$PYTHON" -c 'import cv2, fastapi, torch, uvicorn' >/dev/null 2>&1; then
      case "$FAMILY" in
        sam2) "$PYTHON" -c 'from sam2.build_sam import build_sam2; from sam2.sam2_image_predictor import SAM2ImagePredictor' >/dev/null 2>&1 && return 0 ;;
        sam3) "$PYTHON" -c 'from sam3.model.sam3_image_processor import Sam3Processor; from sam3.model_builder import build_sam3_image_model' >/dev/null 2>&1 && return 0 ;;
      esac
    fi
  fi

  printf 'Instalando dependências oficiais da família %s. Isso pode demorar...\n' "$FAMILY"
  "$PYTHON" -m pip install --upgrade pip wheel
  if [[ "$FAMILY" == "sam3" ]]; then
    # O SAM 3 fixado acima ainda importa pkg_resources, removido no setuptools 81+.
    "$PYTHON" -m pip install --upgrade "setuptools<81"
  else
    "$PYTHON" -m pip install --upgrade setuptools
  fi
  case "$FAMILY" in
    sam2)
      "$PYTHON" -m pip install "torch>=2.5.1" "torchvision>=0.20.1"
      SAM2_BUILD_CUDA=0 "$PYTHON" -m pip install "https://github.com/facebookresearch/sam2/archive/${SAM2_REVISION}.zip"
      "$PYTHON" -m pip install fastapi uvicorn pillow opencv-python-headless numpy
      ;;
    sam3)
      "$PYTHON" -m pip install torch==2.10.0 torchvision --index-url https://download.pytorch.org/whl/cu128
      "$PYTHON" -m pip install "https://github.com/facebookresearch/sam3/archive/${SAM3_REVISION}.zip"
      # A revisão oficial usa estes pacotes no import principal, mas os declara
      # somente como extras (ou não os declara) no pyproject.
      "$PYTHON" -m pip install fastapi uvicorn pillow einops huggingface_hub psutil pycocotools "opencv-python-headless<4.12" "numpy<2"
      ;;
  esac
  printf 'Verificando imports do runtime %s...\n' "$FAMILY"
  case "$FAMILY" in
    sam2) "$PYTHON" -c 'import cv2, fastapi, torch, uvicorn; from sam2.build_sam import build_sam2; from sam2.sam2_image_predictor import SAM2ImagePredictor' ;;
    sam3) "$PYTHON" -c 'import cv2, fastapi, huggingface_hub, pkg_resources, torch, uvicorn; from sam3.model.sam3_image_processor import Sam3Processor; from sam3.model_builder import build_sam3_image_model' ;;
  esac || fail "as dependências da família ${FAMILY} foram instaladas, mas o teste de importação acima falhou."
  touch "$ready_file"
}

verify_runtime_device() {
  local diagnostico
  if [[ "$FAMILY" == "sam3" ]]; then
    "$PYTHON" -c 'import torch; raise SystemExit(0 if torch.cuda.is_available() else 1)' >/dev/null 2>&1 ||
      fail "o PyTorch do SAM 3 não conseguiu usar a GPU NVIDIA. Confirme driver e compatibilidade CUDA 12.6+."
    # torch.cuda.is_available() responde "sim" mesmo quando a instalação não tem
    # kernel para a arquitetura da placa. Nesse caso o carregamento morre com
    # "no kernel image is available for execution on the device", que não diz o
    # que houve. Comparar a capability com a lista de arquiteturas compiladas
    # transforma isso numa frase que o usuário entende.
    diagnostico="$("$PYTHON" - <<'PY' 2>/dev/null
import torch

major, minor = torch.cuda.get_device_capability(0)
compiladas = [a for a in torch.cuda.get_arch_list() if a.startswith("sm_")]
suportadas = {int(a.removeprefix("sm_")) for a in compiladas}
if suportadas and (major * 10 + minor) not in suportadas:
    print(
        f"{torch.cuda.get_device_name(0)} tem capability {major}.{minor}, "
        f"e este PyTorch traz kernels apenas para {', '.join(compiladas)}"
    )
PY
)" || true
    [[ -z "$diagnostico" ]] ||
      fail "a GPU não é compatível com o PyTorch instalado para o SAM 3: ${diagnostico}. O modelo não chegaria a carregar. Escolha um SAM 2.1 ou MedSAM2, que rodam nesta máquina."
  fi
}

checkpoint_is_valid() {
  file_has_size "$CHECKPOINT" "$CHECKPOINT_SIZE"
}

# O console script `hf` grava o caminho absoluto do interpretador no shebang, de
# modo que ele para de funcionar se a pasta do app for renomeada ou movida —
# aconteceu na renomeação de visionlabel para poligome, e o erro que aparecia era
# "arquivo requerido não encontrado", que não diz nada sobre a causa.
hf_available() {
  "$PYTHON" -c 'import huggingface_hub' >/dev/null 2>&1
}

# Confere o shebang sem executar nada: invocar o script só para testá-lo teria
# efeito colateral, e um interpretador ausente é exatamente o sintoma a detectar.
hf_console_usable() {
  local script="$1"
  local shebang interpreter
  [[ -x "$script" ]] || return 1
  IFS= read -r shebang <"$script" || return 1
  case "$shebang" in
    '#!'*) interpreter="${shebang#\#!}" ;;
    *) return 0 ;;
  esac
  interpreter="${interpreter%% *}"
  [[ -x "$interpreter" ]]
}

run_hf() {
  local script="${VENV_DIR}/bin/hf"
  if hf_console_usable "$script"; then
    "$script" "$@"
    return
  fi
  # Sem o console script utilizável, o entry point resolvido pelo próprio pacote
  # continua valendo e não depende de caminho gravado em disco.
  "$PYTHON" - "$@" <<'PYTHON_HF'
import sys
from importlib.metadata import distribution

try:
    entry = next(
        candidate
        for candidate in distribution("huggingface_hub").entry_points
        if candidate.group == "console_scripts" and candidate.name == "hf"
    )
except Exception as error:  # pacote antigo ou instalação quebrada
    raise SystemExit(f"não foi possível localizar o CLI do Hugging Face: {error}")

sys.argv = ["hf", *sys.argv[1:]]
entry.load()()
PYTHON_HF
}

download_sam3_checkpoint() {
  local staging_dir="${APP_DIR}/downloads/${MODEL_ID}"
  local staged_checkpoint="${staging_dir}/${CHECKPOINT_NAME}"
  hf_available || fail "o pacote huggingface_hub não está instalado no ambiente do SAM 3."
  printf '\nSAM 3 usa um checkpoint gated da Meta.\n'
  printf 'Solicite acesso em https://huggingface.co/facebook/sam3 e aceite a licença antes de continuar.\n'
  if ! run_hf auth whoami >/dev/null 2>&1; then
    printf 'A autenticação será feita pelo CLI oficial do Hugging Face; o Poligome não lê nem armazena seu token.\n'
    run_hf auth login || fail "autenticação no Hugging Face não concluída."
  fi
  mkdir -p "$(dirname "$CHECKPOINT")" "$staging_dir"
  rm -f "$staged_checkpoint" "${CHECKPOINT}.part"
  if ! run_hf download facebook/sam3 "$CHECKPOINT_NAME" --local-dir "$staging_dir"; then
    fail "não foi possível baixar o checkpoint gated. Confirme a aprovação de acesso à conta no Hugging Face."
  fi
  if ! file_has_size "$staged_checkpoint" "$CHECKPOINT_SIZE"; then
    local actual_size
    actual_size="$(file_size "$staged_checkpoint")"
    rm -f "$staged_checkpoint"
    fail "o checkpoint retornado pelo Hugging Face ficou incompleto (${actual_size} bytes; esperado: ${CHECKPOINT_SIZE})."
  fi
  mv -f "$staged_checkpoint" "${CHECKPOINT}.part"
  mv -f "${CHECKPOINT}.part" "$CHECKPOINT"
}

ensure_checkpoint() {
  if checkpoint_is_valid; then
    return 0
  fi
  if [[ -f "$CHECKPOINT" ]]; then
    printf 'O checkpoint existente está incompleto ou não corresponde ao arquivo oficial; baixando uma cópia íntegra.\n'
  fi
  printf 'Baixando checkpoint oficial %s...\n' "$CHECKPOINT_NAME"
  if [[ "$FAMILY" == "sam3" ]]; then
    download_sam3_checkpoint
  else
    download_atomic "$CHECKPOINT_URL" "$CHECKPOINT" "$CHECKPOINT_SIZE"
  fi
  checkpoint_is_valid || fail "o checkpoint instalado não passou na validação final de tamanho."
}

save_pending_selection() {
  local partial="${PENDING_MODEL_FILE}.part"
  printf '%s\n' "$MODEL_ID" >"$partial"
  mv -f "$partial" "$PENDING_MODEL_FILE"
}

save_selection() {
  local partial="${SELECTED_MODEL_FILE}.part"
  printf '%s\n' "$MODEL_ID" >"$partial"
  mv -f "$partial" "$SELECTED_MODEL_FILE"
  rm -f "$PENDING_MODEL_FILE"
}

complete_installation() {
  save_selection
  printf '\nModelo %s instalado, carregado e selecionado.\n' "$MODEL_ID"
  printf 'A seleção foi salva em %s.\n' "$SELECTED_MODEL_FILE"
  open_site
}

wait_for_existing_model() {
  local deadline=$((SECONDS + STARTUP_TIMEOUT))
  local state
  printf 'O conector já está carregando %s; aguardando o modelo ficar pronto...\n' "$MODEL_ID"
  while (( SECONDS < deadline )); do
    state="$(server_state)"
    case "$state" in
      ready)
        complete_installation
        return 0
        ;;
      loading) sleep 2 ;;
      error)
        fail "o conector falhou ao carregar ${MODEL_ID}: $(server_error_message)"
        ;;
      *) fail "o conector que estava carregando ${MODEL_ID} deixou de responder corretamente."
        ;;
    esac
  done
  fail "o carregamento de ${MODEL_ID} excedeu ${STARTUP_TIMEOUT} segundos."
}

run_connector_transactionally() {
  local args=(
    "$CONNECTOR"
    --model "$MODEL_ID"
    --checkpoint "$CHECKPOINT"
  )
  if [[ -n "$MODEL_CONFIG" ]]; then
    args+=(--model-config "$MODEL_CONFIG")
  fi
  args+=(--device "$DEVICE" --port "$PORT")
  printf 'Iniciando o conector e aguardando %s ficar pronto...\n' "$MODEL_ID"
  POLIGOME_ALLOWED_ORIGINS="${SITE_ORIGIN},http://localhost:5173,http://127.0.0.1:5173" \
    "$PYTHON" "${args[@]}" &
  CONNECTOR_PID=$!

  cleanup_connector() {
    if kill -0 "$CONNECTOR_PID" >/dev/null 2>&1; then
      kill -TERM "$CONNECTOR_PID" >/dev/null 2>&1 || true
      wait "$CONNECTOR_PID" >/dev/null 2>&1 || true
    fi
  }
  interrupt_connector() {
    cleanup_connector
    exit 130
  }
  trap cleanup_connector EXIT
  trap interrupt_connector HUP INT TERM

  local deadline=$((SECONDS + STARTUP_TIMEOUT))
  local state
  local connector_status
  while (( SECONDS < deadline )); do
    state="$(server_state)"
    case "$state" in
      ready)
        complete_installation
        printf 'Mantenha este terminal aberto enquanto usar o SAM.\n\n'
        if wait "$CONNECTOR_PID"; then
          connector_status=0
        else
          connector_status=$?
        fi
        trap - EXIT HUP INT TERM
        return "$connector_status"
        ;;
      error)
        local error_message
        error_message="$(server_error_message)"
        cleanup_connector
        trap - EXIT HUP INT TERM
        fail "o modelo ${MODEL_ID} não conseguiu carregar: ${error_message}"
        ;;
      mismatch|unhealthy)
        cleanup_connector
        trap - EXIT HUP INT TERM
        fail "a porta ${PORT} respondeu com um serviço ou modelo diferente durante a inicialização."
        ;;
      loading|offline) ;;
    esac
    if ! kill -0 "$CONNECTOR_PID" >/dev/null 2>&1; then
      if wait "$CONNECTOR_PID"; then
        connector_status=0
      else
        connector_status=$?
      fi
      trap - EXIT HUP INT TERM
      fail "o conector terminou antes de ${MODEL_ID} ficar pronto (código ${connector_status})."
    fi
    sleep 2
  done

  cleanup_connector
  trap - EXIT HUP INT TERM
  fail "o carregamento de ${MODEL_ID} excedeu ${STARTUP_TIMEOUT} segundos."
}

if [[ "${1:-}" == "--help" || "${1:-}" == "-h" ]]; then
  usage
  exit 0
fi
if (( $# > 1 )); then
  usage >&2
  fail "informe no máximo um modelo."
fi

[[ "$STARTUP_TIMEOUT" =~ ^[1-9][0-9]*$ ]] ||
  fail "POLIGOME_STARTUP_TIMEOUT deve ser um número inteiro positivo de segundos."

case "$DEVICE" in
  auto|cpu|cuda|mps) ;;
  *) fail "POLIGOME_DEVICE aceita auto, cpu, cuda ou mps; recebido: ${DEVICE}" ;;
esac

require_https "$SITE_URL"
site_authority="${SITE_URL#https://}"
site_authority="${site_authority%%/*}"
if [[ "$site_authority" == *:443 ]]; then
  site_authority="${site_authority%:443}"
fi
SITE_ORIGIN="https://${site_authority}"
if [[ -z "${POLIGOME_CONNECTOR_PATH:-}" ]]; then
  require_https "$ASSET_BASE_URL"
fi

if [[ $# -eq 1 ]]; then
  MODEL_ID="$(normalize_model "$1")" || {
    usage >&2
    fail "modelo inválido: $1"
  }
else
  MODEL_ID="$(choose_model)"
fi

set_model_metadata "$MODEL_ID"
check_platform

printf '\n==========================================\n'
printf ' Poligome SAM local — %s\n' "$MODEL_ID"
printf '==========================================\n\n'

mkdir -p "$APP_DIR" "$VENVS_DIR" "$MODELS_DIR"
cache_current_installer
save_pending_selection
download_connector
prepare_venv
install_runtime
verify_runtime_device
ensure_checkpoint

case "$(server_state)" in
  ready)
    complete_installation
    printf '\nO modelo %s já está carregado pelo conector na porta %s.\n' "$MODEL_ID" "$PORT"
    exit 0
    ;;
  loading)
    wait_for_existing_model
    exit 0
    ;;
  error|mismatch|unhealthy)
    fail "a porta ${PORT} já está ocupada por um conector com erro, outro modelo ou outro serviço. Feche-o e execute novamente."
    ;;
  offline) ;;
esac
if local_port_is_in_use; then
  fail "a porta ${PORT} já está ocupada por outro processo. Feche-o e execute novamente."
fi

run_connector_transactionally
