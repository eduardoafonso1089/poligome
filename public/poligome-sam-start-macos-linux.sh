#!/usr/bin/env bash
set -euo pipefail

POLIGOME_SAM_STARTER_API=2

DEFAULT_SITE_URL="https://poligome.com"
DEFAULT_ASSET_BASE_URL="https://raw.githubusercontent.com/eduardoafonso1089/poligome/main/public"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SITE_URL="${POLIGOME_SITE_URL:-${DEFAULT_SITE_URL}}"
SITE_URL="${SITE_URL%/}"
ASSET_BASE_URL="${POLIGOME_ASSET_BASE_URL:-${DEFAULT_ASSET_BASE_URL}}"
ASSET_BASE_URL="${ASSET_BASE_URL%/}"
APP_DIR="${HOME}/.poligome-sam"
SELECTED_MODEL_FILE="${APP_DIR}/selected-model.txt"
PENDING_MODEL_FILE="${APP_DIR}/pending-model.txt"
CONNECTOR="${APP_DIR}/poligome-sam-local.py"
INSTALLER_CACHE="${APP_DIR}/bin/poligome-sam-macos-linux.sh"
PORT="7860"
STARTUP_TIMEOUT="${POLIGOME_STARTUP_TIMEOUT:-1800}"
# auto escolhe CUDA, depois MPS, depois CPU. Forçar cpu é a saída de quem tem
# uma GPU que o PyTorch enxerga mas que não aguenta o modelo.
DEVICE="${POLIGOME_DEVICE:-auto}"
SITE_ORIGIN=""

usage() {
  cat <<'EOF'
Poligome SAM local — iniciar ou retomar o modelo selecionado

Uso:
  bash poligome-sam-start-macos-linux.sh
  bash poligome-sam-start-macos-linux.sh --help

O iniciador usa o modelo salvo em ~/.poligome-sam/selected-model.txt. Uma
instalação interrompida é retomada por ~/.poligome-sam/pending-model.txt.
Sem nenhum estado salvo, o menu do instalador é aberto automaticamente.

Variáveis opcionais:
  POLIGOME_SITE_URL        URL HTTPS aberta no navegador e aceita no CORS
  POLIGOME_ASSET_BASE_URL  origem HTTPS pública dos arquivos do instalador
  POLIGOME_INSTALLER_PATH  instalador local explícito para desenvolvimento/offline
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

configure_site_origin() {
  local remainder
  local authority
  require_https "$SITE_URL"
  remainder="${SITE_URL#https://}"
  authority="${remainder%%/*}"
  if [[ "$authority" == *:443 ]]; then
    authority="${authority%:443}"
  fi
  SITE_ORIGIN="https://${authority}"
}

download_to_file() {
  local url="$1"
  local destination="$2"
  require_https "$url"
  mkdir -p "$(dirname "$destination")"
  if command -v curl >/dev/null 2>&1; then
    curl --fail --location --proto '=https' --proto-redir '=https' --retry 3 --retry-delay 2 \
      --progress-bar "$url" --output "$destination" || return 1
  elif command -v wget >/dev/null 2>&1; then
    wget --https-only --tries=3 --show-progress "$url" --output-document="$destination" || return 1
  else
    fail "instale curl ou wget para retomar a instalação."
  fi
  [[ -s "$destination" ]]
}

validate_installer() {
  local path="$1"
  local first_line
  [[ -f "$path" && -s "$path" ]] || return 1
  IFS= read -r first_line <"$path" || return 1
  [[ "$first_line" == '#!/usr/bin/env bash' ]] || return 1
  bash -n "$path" >/dev/null 2>&1 || return 1
  grep -Fxq -- 'POLIGOME_SAM_INSTALLER_API=2' "$path" || return 1
}

cache_installer_from_file() {
  local source="$1"
  local partial="${INSTALLER_CACHE}.part.$$"
  validate_installer "$source" ||
    fail "o caminho informado não contém um instalador Unix API 2 válido."
  mkdir -p "$(dirname "$INSTALLER_CACHE")"
  if ! cp "$source" "$partial"; then
    rm -f "$partial"
    fail "não foi possível copiar o instalador local para o cache."
  fi
  if ! validate_installer "$partial"; then
    rm -f "$partial"
    fail "a cópia do instalador local falhou na validação."
  fi
  chmod 700 "$partial"
  mv -f "$partial" "$INSTALLER_CACHE"
}

ensure_installer() {
  local sibling_installer="${SCRIPT_DIR}/poligome-sam-macos-linux.sh"
  local installer_url="${ASSET_BASE_URL}/poligome-sam-macos-linux.sh"
  local partial="${INSTALLER_CACHE}.part.$$"

  if [[ -n "${POLIGOME_INSTALLER_PATH:-}" ]]; then
    printf 'Usando o instalador local informado em POLIGOME_INSTALLER_PATH...\n'
    cache_installer_from_file "$POLIGOME_INSTALLER_PATH"
    return 0
  fi

  if validate_installer "$INSTALLER_CACHE"; then
    chmod 700 "$INSTALLER_CACHE"
    return 0
  fi

  if validate_installer "$sibling_installer"; then
    printf 'Usando o instalador API 2 encontrado ao lado deste iniciador...\n'
    cache_installer_from_file "$sibling_installer"
    return 0
  fi

  require_https "$ASSET_BASE_URL"
  printf 'Baixando o instalador canônico do Poligome para o cache local...\n'
  mkdir -p "$(dirname "$INSTALLER_CACHE")"
  if ! download_to_file "$installer_url" "$partial"; then
    rm -f "$partial"
    fail "não foi possível baixar o instalador de ${ASSET_BASE_URL}."
  fi
  if ! validate_installer "$partial"; then
    rm -f "$partial"
    fail "a origem forneceu um instalador Unix incompatível ou inválido."
  fi
  chmod 700 "$partial"
  mv -f "$partial" "$INSTALLER_CACHE"
}

resume_installation() {
  local model_id="$1"
  local reason="$2"
  local installer_env=(POLIGOME_SITE_URL="$SITE_URL")
  if [[ -n "${POLIGOME_ASSET_BASE_URL:-}" ]]; then
    installer_env+=(POLIGOME_ASSET_BASE_URL="$ASSET_BASE_URL")
  fi
  printf '\n%s\n' "$reason"
  ensure_installer
  if [[ -n "$model_id" ]]; then
    printf 'Retomando a instalação de %s...\n\n' "$model_id"
    exec env "${installer_env[@]}" bash "$INSTALLER_CACHE" "$model_id"
  fi
  printf 'Abrindo o menu de instalação...\n\n'
  exec env "${installer_env[@]}" bash "$INSTALLER_CACHE"
}

read_saved_model() {
  local path="$1"
  local label="$2"
  local raw_model_id
  raw_model_id="$(tr -d '\r\n' <"$path")"
  normalize_model "$raw_model_id" || fail "${label} contém um ID inválido: ${raw_model_id}"
}

open_site() {
  if command -v open >/dev/null 2>&1; then
    open "$SITE_URL" >/dev/null 2>&1 || true
  elif command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$SITE_URL" >/dev/null 2>&1 || true
  fi
}

set_model_metadata() {
  MODEL_ID="$1"
  MODEL_CONFIG=""
  case "$MODEL_ID" in
    sam2.1-hiera-tiny)
      FAMILY="sam2"
      CHECKPOINT_NAME="sam2.1_hiera_tiny.pt"
      CHECKPOINT_SIZE=156008466
      MODEL_CONFIG="configs/sam2.1/sam2.1_hiera_t.yaml"
      ;;
    sam2.1-hiera-small)
      FAMILY="sam2"
      CHECKPOINT_NAME="sam2.1_hiera_small.pt"
      CHECKPOINT_SIZE=184416285
      MODEL_CONFIG="configs/sam2.1/sam2.1_hiera_s.yaml"
      ;;
    sam2.1-hiera-base-plus)
      FAMILY="sam2"
      CHECKPOINT_NAME="sam2.1_hiera_base_plus.pt"
      CHECKPOINT_SIZE=323606802
      MODEL_CONFIG="configs/sam2.1/sam2.1_hiera_b+.yaml"
      ;;
    sam2.1-hiera-large)
      FAMILY="sam2"
      CHECKPOINT_NAME="sam2.1_hiera_large.pt"
      CHECKPOINT_SIZE=898083611
      MODEL_CONFIG="configs/sam2.1/sam2.1_hiera_l.yaml"
      ;;
    medsam2-latest)
      FAMILY="sam2"
      CHECKPOINT_NAME="MedSAM2_latest.pt"
      CHECKPOINT_SIZE=156040129
      MODEL_CONFIG="configs/sam2.1/sam2.1_hiera_t.yaml"
      ;;
    medsam2-ct-lesion)
      FAMILY="sam2"
      CHECKPOINT_NAME="MedSAM2_CTLesion.pt"
      CHECKPOINT_SIZE=156041079
      MODEL_CONFIG="configs/sam2.1/sam2.1_hiera_t.yaml"
      ;;
    medsam2-mri-liver-lesion)
      FAMILY="sam2"
      CHECKPOINT_NAME="MedSAM2_MRI_LiverLesion.pt"
      CHECKPOINT_SIZE=156044532
      MODEL_CONFIG="configs/sam2.1/sam2.1_hiera_t.yaml"
      ;;
    medsam2-us-heart)
      FAMILY="sam2"
      CHECKPOINT_NAME="MedSAM2_US_Heart.pt"
      CHECKPOINT_SIZE=156041079
      MODEL_CONFIG="configs/sam2.1/sam2.1_hiera_t.yaml"
      ;;
    medsam2-2411)
      FAMILY="sam2"
      CHECKPOINT_NAME="MedSAM2_2411.pt"
      CHECKPOINT_SIZE=156039179
      MODEL_CONFIG="configs/sam2.1/sam2.1_hiera_t.yaml"
      ;;
    sam3-concepts)
      FAMILY="sam3"
      CHECKPOINT_NAME="sam3.pt"
      CHECKPOINT_SIZE=3450062241
      ;;
    *)
      fail "modelo salvo inválido: ${MODEL_ID}"
      ;;
  esac

  VENV_DIR="${APP_DIR}/venvs/${FAMILY}"
  PYTHON="${VENV_DIR}/bin/python"
  CHECKPOINT="${APP_DIR}/models/${MODEL_ID}/${CHECKPOINT_NAME}"
}

validate_platform() {
  local os_name
  os_name="$(uname -s)"
  case "$os_name" in
    Linux|Darwin) ;;
    *) fail "sistema não suportado por este iniciador: ${os_name}" ;;
  esac
  if [[ "$os_name" == "Darwin" && "$(uname -m)" != "arm64" ]]; then
    fail "no macOS, o SAM 2.1 exige um Mac Apple Silicon; o PyTorch atual não publica wheels para Intel."
  fi
  if [[ "$MODEL_ID" == "sam3-concepts" ]]; then
    [[ "$os_name" == "Linux" ]] ||
      fail "SAM 3 não é disponibilizado no macOS; selecione um modelo SAM 2.1."
    command -v nvidia-smi >/dev/null 2>&1 && nvidia-smi -L >/dev/null 2>&1 ||
      fail "SAM 3 exige uma GPU NVIDIA funcional no Linux."
  fi
}

validate_checkpoint() {
  local actual_size
  if [[ ! -s "$CHECKPOINT" ]]; then
    REPAIR_REASON="checkpoint de ${MODEL_ID} ausente ou vazio"
    return 1
  fi
  actual_size="$(wc -c <"$CHECKPOINT" | tr -d '[:space:]')"
  if [[ "$actual_size" != "$CHECKPOINT_SIZE" ]]; then
    REPAIR_REASON="checkpoint de ${MODEL_ID} incompleto: ${actual_size} bytes; esperado ${CHECKPOINT_SIZE}"
    return 1
  fi
}

runtime_is_complete() {
  REPAIR_REASON=""

  if [[ ! -x "$PYTHON" ]]; then
    REPAIR_REASON="ambiente da família ${FAMILY} não encontrado"
    return 1
  fi
  if ! "$PYTHON" -c "import sys; raise SystemExit(0 if sys.version_info >= (3, ${MINIMUM_PYTHON_MINOR}) else 1)" >/dev/null 2>&1; then
    REPAIR_REASON="runtime ${FAMILY} usa Python anterior a 3.${MINIMUM_PYTHON_MINOR}"
    return 1
  fi
  if [[ ! -s "$CONNECTOR" ]]; then
    REPAIR_REASON="conector canônico ausente ou vazio"
    return 1
  fi

  case "$FAMILY" in
    sam2)
      if ! "$PYTHON" -c 'import cv2, fastapi, torch, uvicorn; from sam2.build_sam import build_sam2; from sam2.sam2_image_predictor import SAM2ImagePredictor' >/dev/null 2>&1; then
        REPAIR_REASON="dependências profundas do runtime SAM 2.1 estão incompletas"
        return 1
      fi
      ;;
    sam3)
      if ! "$PYTHON" -c 'import cv2, fastapi, huggingface_hub, pkg_resources, torch, uvicorn; from sam3.model.sam3_image_processor import Sam3Processor; from sam3.model_builder import build_sam3_image_model' >/dev/null 2>&1; then
        REPAIR_REASON="dependências profundas do runtime SAM 3 estão incompletas"
        return 1
      fi
      if ! "$PYTHON" -c 'import re, torch; version=lambda value: tuple(map(int, re.match(r"^(\d+)\.(\d+)", value or "0.0").groups())); raise SystemExit(0 if torch.cuda.is_available() and version(torch.__version__) >= (2, 7) and version(torch.version.cuda) >= (12, 6) else 1)' >/dev/null 2>&1; then
        REPAIR_REASON="runtime SAM 3 não oferece PyTorch 2.7+ com CUDA 12.6+ funcional"
        return 1
      fi
      ;;
  esac

  if ! grep -Fqx 'API_VERSION = 2' "$CONNECTOR" ||
    ! grep -Fq -- '"--model"' "$CONNECTOR"; then
    REPAIR_REASON="conector instalado não implementa a API 2 com --model"
    return 1
  fi
  validate_checkpoint
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

wait_for_existing_model() {
  local deadline=$((SECONDS + STARTUP_TIMEOUT))
  local state
  printf 'O conector já está carregando %s; aguardando o modelo ficar pronto...\n' "$MODEL_ID"
  while (( SECONDS < deadline )); do
    state="$(server_state)"
    case "$state" in
      ready)
        printf 'O conector de %s está pronto na porta %s.\n' "$MODEL_ID" "$PORT"
        open_site
        return 0
        ;;
      loading) sleep 2 ;;
      error)
        fail "o conector falhou ao carregar ${MODEL_ID}: $(server_error_message)"
        ;;
      *)
        fail "o conector que estava carregando ${MODEL_ID} deixou de responder corretamente."
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
  local error_message
  local connector_status
  while (( SECONDS < deadline )); do
    state="$(server_state)"
    case "$state" in
      ready)
        printf 'O conector de %s está pronto na porta %s.\n' "$MODEL_ID" "$PORT"
        open_site
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
if (( $# != 0 )); then
  usage >&2
  fail "este iniciador não recebe modelo; a seleção vem do estado local."
fi

[[ "$STARTUP_TIMEOUT" =~ ^[1-9][0-9]*$ ]] ||
  fail "POLIGOME_STARTUP_TIMEOUT deve ser um número inteiro positivo de segundos."

case "$DEVICE" in
  auto|cpu|cuda|mps) ;;
  *) fail "POLIGOME_DEVICE aceita auto, cpu, cuda ou mps; recebido: ${DEVICE}" ;;
esac

configure_site_origin

if [[ -f "$PENDING_MODEL_FILE" ]]; then
  PENDING_MODEL_ID="$(read_saved_model "$PENDING_MODEL_FILE" "pending-model.txt")"
  resume_installation "$PENDING_MODEL_ID" \
    "Uma instalação interrompida de ${PENDING_MODEL_ID} foi encontrada."
fi

if [[ ! -f "$SELECTED_MODEL_FILE" ]]; then
  resume_installation "" \
    "Nenhum modelo foi selecionado ainda; o instalador escolherá e preparará um modelo."
fi

MODEL_ID="$(read_saved_model "$SELECTED_MODEL_FILE" "selected-model.txt")"
set_model_metadata "$MODEL_ID"
validate_platform
MINIMUM_PYTHON_MINOR=10
[[ "$FAMILY" == "sam3" ]] && MINIMUM_PYTHON_MINOR=12

if ! runtime_is_complete; then
  resume_installation "$MODEL_ID" \
    "A instalação de ${MODEL_ID} precisa ser retomada: ${REPAIR_REASON}."
fi

printf '\n==========================================\n'
printf ' Poligome SAM — %s\n' "$MODEL_ID"
printf '==========================================\n\n'

case "$(server_state)" in
  ready)
    printf 'O conector de %s já está pronto na porta %s.\n' "$MODEL_ID" "$PORT"
    open_site
    exit 0
    ;;
  loading)
    wait_for_existing_model
    exit 0
    ;;
  error)
    fail "o conector de ${MODEL_ID} está em erro: $(server_error_message). Encerre a janela antiga e execute novamente."
    ;;
  mismatch|unhealthy)
    fail "a porta ${PORT} já está ocupada por outro modelo, serviço ou conector incompatível. Encerre-o e execute novamente."
    ;;
  offline) ;;
  *) fail "não foi possível interpretar o estado do conector local." ;;
esac
if local_port_is_in_use; then
  fail "a porta ${PORT} já está ocupada por outro processo. Encerre-o e execute novamente."
fi

run_connector_transactionally
