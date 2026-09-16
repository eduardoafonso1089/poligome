#!/usr/bin/env bash
set -euo pipefail

# Exercita os instaladores sem criar venvs reais, instalar pacotes ou acessar a
# rede. Os executáveis externos relevantes são substituídos por dublês locais.

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
INSTALLER="${PROJECT_ROOT}/public/poligome-sam-macos-linux.sh"
STARTER="${PROJECT_ROOT}/public/poligome-sam-start-macos-linux.sh"
WINDOWS_INSTALLER="${PROJECT_ROOT}/public/poligome-sam-windows.bat"
WINDOWS_STARTER="${PROJECT_ROOT}/public/poligome-sam-start-windows.bat"
CONNECTOR_SOURCE="${PROJECT_ROOT}/public/poligome-sam-local.py"
SERVICE="${PROJECT_ROOT}/public/poligome-sam-service-linux.sh"

MODELS=(
  sam2.1-hiera-tiny
  sam2.1-hiera-small
  sam2.1-hiera-base-plus
  sam2.1-hiera-large
  medsam2-latest
  medsam2-ct-lesion
  medsam2-mri-liver-lesion
  medsam2-us-heart
  medsam2-2411
  sam3-concepts
)

declare -A MODEL_FAMILY=(
  [sam2.1-hiera-tiny]=sam2
  [sam2.1-hiera-small]=sam2
  [sam2.1-hiera-base-plus]=sam2
  [sam2.1-hiera-large]=sam2
  [medsam2-latest]=sam2
  [medsam2-ct-lesion]=sam2
  [medsam2-mri-liver-lesion]=sam2
  [medsam2-us-heart]=sam2
  [medsam2-2411]=sam2
  [sam3-concepts]=sam3
)

declare -A CHECKPOINT_NAME=(
  [sam2.1-hiera-tiny]=sam2.1_hiera_tiny.pt
  [sam2.1-hiera-small]=sam2.1_hiera_small.pt
  [sam2.1-hiera-base-plus]=sam2.1_hiera_base_plus.pt
  [sam2.1-hiera-large]=sam2.1_hiera_large.pt
  [medsam2-latest]=MedSAM2_latest.pt
  [medsam2-ct-lesion]=MedSAM2_CTLesion.pt
  [medsam2-mri-liver-lesion]=MedSAM2_MRI_LiverLesion.pt
  [medsam2-us-heart]=MedSAM2_US_Heart.pt
  [medsam2-2411]=MedSAM2_2411.pt
  [sam3-concepts]=sam3.pt
)

declare -A CHECKPOINT_URL=(
  [sam2.1-hiera-tiny]=https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_tiny.pt
  [sam2.1-hiera-small]=https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_small.pt
  [sam2.1-hiera-base-plus]=https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_base_plus.pt
  [sam2.1-hiera-large]=https://dl.fbaipublicfiles.com/segment_anything_2/092824/sam2.1_hiera_large.pt
  [medsam2-latest]=https://huggingface.co/wanglab/MedSAM2/resolve/main/MedSAM2_latest.pt
  [medsam2-ct-lesion]=https://huggingface.co/wanglab/MedSAM2/resolve/main/MedSAM2_CTLesion.pt
  [medsam2-mri-liver-lesion]=https://huggingface.co/wanglab/MedSAM2/resolve/main/MedSAM2_MRI_LiverLesion.pt
  [medsam2-us-heart]=https://huggingface.co/wanglab/MedSAM2/resolve/main/MedSAM2_US_Heart.pt
  [medsam2-2411]=https://huggingface.co/wanglab/MedSAM2/resolve/main/MedSAM2_2411.pt
  [sam3-concepts]=""
)

declare -A CHECKPOINT_SIZE=(
  [sam2.1-hiera-tiny]=156008466
  [sam2.1-hiera-small]=184416285
  [sam2.1-hiera-base-plus]=323606802
  [sam2.1-hiera-large]=898083611
  [medsam2-latest]=156040129
  [medsam2-ct-lesion]=156041079
  [medsam2-mri-liver-lesion]=156044532
  [medsam2-us-heart]=156041079
  [medsam2-2411]=156039179
  [sam3-concepts]=3450062241
)

declare -A MODEL_CONFIG=(
  [sam2.1-hiera-tiny]=configs/sam2.1/sam2.1_hiera_t.yaml
  [sam2.1-hiera-small]=configs/sam2.1/sam2.1_hiera_s.yaml
  [sam2.1-hiera-base-plus]=configs/sam2.1/sam2.1_hiera_b+.yaml
  [sam2.1-hiera-large]=configs/sam2.1/sam2.1_hiera_l.yaml
  [medsam2-latest]=configs/sam2.1/sam2.1_hiera_t.yaml
  [medsam2-ct-lesion]=configs/sam2.1/sam2.1_hiera_t.yaml
  [medsam2-mri-liver-lesion]=configs/sam2.1/sam2.1_hiera_t.yaml
  [medsam2-us-heart]=configs/sam2.1/sam2.1_hiera_t.yaml
  [medsam2-2411]=configs/sam2.1/sam2.1_hiera_t.yaml
  [sam3-concepts]=""
)

declare -A READY_FILE=(
  [sam2]=.poligome-sam2-2b90b9f5ceec907a1c18123530e92e794ad901a4.ok
  [sam3]=.poligome-sam3-8f0b7f4d4e7eda2ed606ebde6702c93359ad01da.ok
)

TEMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/poligome-sam-tests.XXXXXX")"
trap 'rm -rf -- "$TEMP_ROOT"' EXIT HUP INT TERM

fail() {
  printf 'not ok - %s\n' "$*" >&2
  exit 1
}

pass() {
  printf 'ok - %s\n' "$*"
}

assert_contains() {
  local haystack="$1"
  local needle="$2"
  local context="$3"
  [[ "$haystack" == *"$needle"* ]] ||
    fail "${context}: trecho ausente: ${needle}"
}

assert_before() {
  local haystack="$1"
  local first="$2"
  local second="$3"
  local context="$4"
  assert_contains "$haystack" "$first" "$context"
  assert_contains "$haystack" "$second" "$context"
  [[ "${haystack#*"$first"}" == *"$second"* ]] ||
    fail "${context}: ordem inválida; '${first}' deve vir antes de '${second}'"
}

assert_file_line() {
  local expected="$1"
  local file="$2"
  local context="$3"
  grep -Fqx -- "$expected" "$file" || {
    printf 'Log de %s:\n' "$context" >&2
    sed -n '1,120p' "$file" >&2
    fail "${context}: chamada esperada não encontrada"
  }
}

assert_no_unexpected_work() {
  local log="$1"
  local context="$2"
  if grep -Eq '^(unexpected-network|unexpected-pip|unexpected-venv)' "$log"; then
    printf 'Log de %s:\n' "$context" >&2
    sed -n '1,120p' "$log" >&2
    fail "${context}: tentou acessar a rede, instalar pacotes ou criar um venv"
  fi
}

assert_installer_cache() {
  local app_dir="$1"
  local context="$2"
  local cached_installer="${app_dir}/bin/poligome-sam-macos-linux.sh"
  [[ -x "$cached_installer" ]] || fail "${context}: instalador API 2 não foi guardado como executável"
  grep -Fqx 'POLIGOME_SAM_INSTALLER_API=2' "$cached_installer" ||
    fail "${context}: cache do instalador não possui o marcador API 2"
  bash -n "$cached_installer" || fail "${context}: instalador em cache tem sintaxe inválida"
}

MOCK_BIN="${TEMP_ROOT}/mock-bin"
mkdir -p "$MOCK_BIN"

cat >"${MOCK_BIN}/python" <<'MOCK_PYTHON'
#!/usr/bin/env bash
set -u
python_log_line="python"
for python_arg in "$@"; do
  python_log_line+=$'\t'"$python_arg"
done
printf '%s\n' "$python_log_line" >>"${POLIGOME_TEST_LOG:?}"
if [[ "${1:-}" == - && $# -eq 3 ]]; then
  probe_program="$(cat)"
  printf 'health-model-probe\t%s\n' "${2:-}" >>"$POLIGOME_TEST_LOG"
  if [[ "${POLIGOME_TEST_HEALTH_MATCH:-}" == "${2:-}" ]]; then
    [[ "$probe_program" == *'print("offline")'* ]] && printf 'ready\n'
    exit 0
  fi
  if [[ -f "${POLIGOME_TEST_LOG}.connector-running" &&
        "$(<"${POLIGOME_TEST_LOG}.connector-running")" == "${2:-}" ]]; then
    : >"${POLIGOME_TEST_LOG}.connector-stop"
    printf 'health-model-ready\t%s\n' "${2:-}" >>"$POLIGOME_TEST_LOG"
    [[ "$probe_program" == *'print("offline")'* ]] && printf 'ready\n'
    exit 0
  fi
  [[ "$probe_program" == *'print("offline")'* ]] && {
    printf 'offline\n'
    exit 0
  }
  exit 1
fi
if [[ "${1:-}" == - && $# -eq 2 ]]; then
  printf 'port-probe\t%s\n' "${2:-}" >>"$POLIGOME_TEST_LOG"
  [[ "${POLIGOME_TEST_PORT_IN_USE:-}" == 1 ]] && exit 0
  exit 1
fi
if [[ "${1:-}" == *poligome-sam-local.py && "${2:-}" == --model ]]; then
  if [[ -n "${POLIGOME_TEST_CONNECTOR_FAIL_BEFORE_READY:-}" ]]; then
    exit "$POLIGOME_TEST_CONNECTOR_FAIL_BEFORE_READY"
  fi
  printf '%s\n' "${3:-}" >"${POLIGOME_TEST_LOG}.connector-running"
  for _attempt in {1..500}; do
    [[ -e "${POLIGOME_TEST_LOG}.connector-stop" ]] &&
      exit "${POLIGOME_TEST_CONNECTOR_EXIT:-0}"
    sleep 0.01
  done
  exit 95
fi
if [[ "${1:-}" == "-m" && "${2:-}" == "pip" ]]; then
  if [[ "${POLIGOME_TEST_ALLOW_SAM3_REPAIR:-}" == 1 &&
        " $* " == *" setuptools<81 "* &&
        " $* " == *" einops "* &&
        " $* " == *" psutil "* &&
        " $* " == *" pycocotools "* ]]; then
    : >"${POLIGOME_TEST_LOG}.sam3-repaired"
    printf 'sam3-repair\t%s\n' "$*" >>"$POLIGOME_TEST_LOG"
    exit 0
  fi
  printf 'unexpected-pip\t%s\n' "$*" >>"$POLIGOME_TEST_LOG"
  exit 97
fi
if [[ "${1:-}" == "-m" && "${2:-}" == "venv" ]]; then
  printf 'unexpected-venv\t%s\n' "$*" >>"$POLIGOME_TEST_LOG"
  exit 98
fi
if [[ "${1:-}" == -c ]]; then
  if [[ "${POLIGOME_TEST_ALLOW_SAM3_REPAIR:-}" == 1 &&
        "$2" == *"import einops"* &&
        ! -e "${POLIGOME_TEST_LOG}.sam3-repaired" ]]; then
    printf 'missing-sam3-runtime-dependencies\n' >>"$POLIGOME_TEST_LOG"
    exit 1
  fi
  case "${POLIGOME_TEST_FAIL_DEEP_IMPORT:-}" in
    sam2)
      if [[ "$2" == *"from sam2.build_sam import build_sam2"* &&
            "$2" == *"from sam2.sam2_image_predictor import SAM2ImagePredictor"* ]]; then
        printf 'deep-import-failed\tsam2\n' >>"$POLIGOME_TEST_LOG"
        exit 1
      fi
      ;;
    sam3)
      if [[ "$2" == *"from sam3.model.sam3_image_processor import Sam3Processor"* &&
            "$2" == *"from sam3.model_builder import build_sam3_image_model"* ]]; then
        printf 'deep-import-failed\tsam3\n' >>"$POLIGOME_TEST_LOG"
        exit 1
      fi
      ;;
  esac
fi
exit 0
MOCK_PYTHON

cat >"${MOCK_BIN}/curl" <<'MOCK_CURL'
#!/usr/bin/env bash
set -u
if [[ " $* " == *" http://127.0.0.1:7860/health "* ]]; then
  printf 'health-check\n' >>"${POLIGOME_TEST_LOG:?}"
  exit 22
fi
url=""
destination=""
while (( $# > 0 )); do
  case "$1" in
    --output)
      destination="${2:-}"
      shift 2
      ;;
    https://*)
      url="$1"
      shift
      ;;
    *)
      shift
      ;;
  esac
done
if [[ -n "${POLIGOME_TEST_EXPECTED_DOWNLOAD:-}" &&
      "$url" == "$POLIGOME_TEST_EXPECTED_DOWNLOAD" &&
      -n "$destination" ]]; then
  mkdir -p "$(dirname "$destination")"
  truncate -s "${POLIGOME_TEST_DOWNLOAD_SIZE_OVERRIDE:-${POLIGOME_TEST_EXPECTED_SIZE:?}}" "$destination"
  printf 'download\t%s\t%s\n' "$url" "$destination" >>"${POLIGOME_TEST_LOG:?}"
  exit 0
fi
printf 'unexpected-network\tcurl\t%s\n' "$url" >>"${POLIGOME_TEST_LOG:?}"
exit 96
MOCK_CURL

cat >"${MOCK_BIN}/wget" <<'MOCK_WGET'
#!/usr/bin/env bash
printf 'unexpected-network\twget\t%s\n' "$*" >>"${POLIGOME_TEST_LOG:?}"
exit 96
MOCK_WGET

cat >"${MOCK_BIN}/uname" <<'MOCK_UNAME'
#!/usr/bin/env bash
printf '%s\n' "${POLIGOME_TEST_UNAME:-Linux}"
MOCK_UNAME

cat >"${MOCK_BIN}/nvidia-smi" <<'MOCK_NVIDIA'
#!/usr/bin/env bash
printf 'nvidia-smi\t%s\n' "$*" >>"${POLIGOME_TEST_LOG:?}"
exit 0
MOCK_NVIDIA

cat >"${MOCK_BIN}/hf" <<'MOCK_HF'
#!/usr/bin/env bash
set -u
if [[ "${1:-}" == auth && "${2:-}" == whoami ]]; then
  printf 'hf-auth\twhoami\n' >>"${POLIGOME_TEST_LOG:?}"
  exit 0
fi
if [[ "${1:-}" == download && $# -eq 5 && "${4:-}" == --local-dir ]]; then
  requested="${2}/${3}"
  if [[ "$requested" == "${POLIGOME_TEST_EXPECTED_HF:-}" ]]; then
    mkdir -p "$5"
    truncate -s "${POLIGOME_TEST_DOWNLOAD_SIZE_OVERRIDE:-${POLIGOME_TEST_EXPECTED_SIZE:?}}" "$5/$3"
    printf 'hf-download\t%s\t%s\n' "$requested" "$5/$3" >>"${POLIGOME_TEST_LOG:?}"
    exit 0
  fi
fi
printf 'unexpected-network\thf\t%s\n' "$*" >>"${POLIGOME_TEST_LOG:?}"
exit 96
MOCK_HF

cat >"${MOCK_BIN}/open" <<'MOCK_OPEN'
#!/usr/bin/env bash
printf 'open\t%s\n' "$*" >>"${POLIGOME_TEST_LOG:?}"
exit 0
MOCK_OPEN

cat >"${MOCK_BIN}/xdg-open" <<'MOCK_XDG_OPEN'
#!/usr/bin/env bash
printf 'xdg-open\t%s\n' "$*" >>"${POLIGOME_TEST_LOG:?}"
exit 0
MOCK_XDG_OPEN

chmod 700 "${MOCK_BIN}"/*
for python_name in python3.13 python3.12 python3.11 python3.10 python3; do
  ln -s python "${MOCK_BIN}/${python_name}"
done

run_isolated() {
  local home_dir="$1"
  local log="$2"
  shift 2
  env -i \
    HOME="$home_dir" \
    PATH="${MOCK_BIN}:/usr/bin:/bin" \
    POLIGOME_SITE_URL="https://poligome.test" \
    POLIGOME_ASSET_BASE_URL="https://assets.poligome.test/public" \
    POLIGOME_CONNECTOR_PATH="$CONNECTOR_SOURCE" \
    POLIGOME_INSTALLER_PATH="${POLIGOME_INSTALLER_PATH:-}" \
    POLIGOME_TEST_LOG="$log" \
    POLIGOME_TEST_EXPECTED_DOWNLOAD="${POLIGOME_TEST_EXPECTED_DOWNLOAD:-}" \
    POLIGOME_TEST_EXPECTED_HF="${POLIGOME_TEST_EXPECTED_HF:-}" \
    POLIGOME_TEST_EXPECTED_SIZE="${POLIGOME_TEST_EXPECTED_SIZE:-}" \
    POLIGOME_TEST_DOWNLOAD_SIZE_OVERRIDE="${POLIGOME_TEST_DOWNLOAD_SIZE_OVERRIDE:-}" \
    POLIGOME_TEST_ALLOW_SAM3_REPAIR="${POLIGOME_TEST_ALLOW_SAM3_REPAIR:-}" \
    POLIGOME_TEST_FAIL_DEEP_IMPORT="${POLIGOME_TEST_FAIL_DEEP_IMPORT:-}" \
    POLIGOME_TEST_HEALTH_MATCH="${POLIGOME_TEST_HEALTH_MATCH:-}" \
    POLIGOME_TEST_PORT_IN_USE="${POLIGOME_TEST_PORT_IN_USE:-}" \
    POLIGOME_TEST_CONNECTOR_EXIT="${POLIGOME_TEST_CONNECTOR_EXIT:-}" \
    POLIGOME_TEST_CONNECTOR_FAIL_BEFORE_READY="${POLIGOME_TEST_CONNECTOR_FAIL_BEFORE_READY:-}" \
    "$@"
}

expected_connector_call() {
  local model="$1"
  local app_dir="$2"
  local checkpoint="${app_dir}/models/${model}/${CHECKPOINT_NAME[$model]}"
  local call="python"
  call+=$'\t'"${app_dir}/poligome-sam-local.py"
  call+=$'\t--model\t'"${model}"
  call+=$'\t--checkpoint\t'"${checkpoint}"
  if [[ -n "${MODEL_CONFIG[$model]}" ]]; then
    call+=$'\t--model-config\t'"${MODEL_CONFIG[$model]}"
  fi
  call+=$'\t--device\tauto\t--port\t7860'
  printf '%s\n' "$call"
}

prepare_model_home() {
  local model="$1"
  local home_dir="$2"
  local family="${MODEL_FAMILY[$model]}"
  local app_dir="${home_dir}/.poligome-sam"
  local venv_dir="${app_dir}/venvs/${family}"
  local checkpoint="${app_dir}/models/${model}/${CHECKPOINT_NAME[$model]}"
  mkdir -p "${venv_dir}/bin" "$(dirname "$checkpoint")"
  ln -s "$MOCK_BIN/python" "${venv_dir}/bin/python"
  if [[ "$family" == sam3 ]]; then
    ln -s "$MOCK_BIN/hf" "${venv_dir}/bin/hf"
  fi
  : >"${venv_dir}/${READY_FILE[$family]}"
}

create_sparse_checkpoint() {
  local model="$1"
  local home_dir="$2"
  local checkpoint="${home_dir}/.poligome-sam/models/${model}/${CHECKPOINT_NAME[$model]}"
  mkdir -p "$(dirname "$checkpoint")"
  truncate -s "${CHECKPOINT_SIZE[$model]}" "$checkpoint"
}

test_bash_model() {
  local model="$1"
  local safe_model="${model//[^[:alnum:]]/_}"
  local home_dir="${TEMP_ROOT}/home-${safe_model}"
  local app_dir="${home_dir}/.poligome-sam"
  local install_log="${TEMP_ROOT}/${safe_model}-install.log"
  local start_log="${TEMP_ROOT}/${safe_model}-start.log"
  local output
  local expected_call
  local checkpoint="${app_dir}/models/${model}/${CHECKPOINT_NAME[$model]}"

  prepare_model_home "$model" "$home_dir"
  : >"$install_log"
  if ! output="$(
    POLIGOME_TEST_EXPECTED_DOWNLOAD="${CHECKPOINT_URL[$model]}" \
    POLIGOME_TEST_EXPECTED_HF="facebook/sam3/${CHECKPOINT_NAME[$model]}" \
    POLIGOME_TEST_EXPECTED_SIZE="${CHECKPOINT_SIZE[$model]}" \
      run_isolated "$home_dir" "$install_log" bash "$INSTALLER" "$model" 2>&1
  )"; then
    printf '%s\n' "$output" >&2
    fail "instalador Bash falhou para ${model}"
  fi

  [[ "$(tr -d '\r\n' <"${app_dir}/selected-model.txt")" == "$model" ]] ||
    fail "${model}: seleção não foi persistida corretamente"
  [[ ! -e "${app_dir}/pending-model.txt" ]] ||
    fail "${model}: instalação concluída deixou pending-model.txt para trás"
  cmp -s "$CONNECTOR_SOURCE" "${app_dir}/poligome-sam-local.py" ||
    fail "${model}: conector local não foi instalado integralmente"
  assert_installer_cache "$app_dir" "instalação de ${model}"
  [[ -s "$checkpoint" ]] || fail "${model}: checkpoint simulado não foi ativado"
  [[ "$(stat -c %s "$checkpoint")" == "${CHECKPOINT_SIZE[$model]}" ]] ||
    fail "${model}: checkpoint não preservou o tamanho oficial exato"
  [[ "$(stat -c %b "$checkpoint")" -le 16 ]] ||
    fail "${model}: dublê de checkpoint deixou de ser sparse"
  if [[ "$model" == sam3-concepts ]]; then
    assert_file_line $'hf-auth\twhoami' "$install_log" "autenticação de ${model}"
    assert_file_line $'hf-download\tfacebook/sam3/sam3.pt\t'"${app_dir}/downloads/${model}/sam3.pt" "$install_log" "download de ${model}"
  else
    assert_file_line $'download\t'"${CHECKPOINT_URL[$model]}"$'\t'"${checkpoint}.part" "$install_log" "download de ${model}"
  fi
  expected_call="$(expected_connector_call "$model" "$app_dir")"
  assert_file_line "$expected_call" "$install_log" "instalação de ${model}"
  assert_no_unexpected_work "$install_log" "instalação de ${model}"
  if find "$app_dir" -type f -name '*.part' -print -quit | grep -q .; then
    fail "${model}: arquivo parcial permaneceu após a instalação"
  fi

  : >"$start_log"
  if ! output="$(run_isolated "$home_dir" "$start_log" bash "$STARTER" 2>&1)"; then
    printf '%s\n' "$output" >&2
    fail "iniciador Bash falhou para ${model}"
  fi
  assert_file_line "$expected_call" "$start_log" "inicialização de ${model}"
  assert_no_unexpected_work "$start_log" "inicialização de ${model}"
  pass "Bash instala e inicia ${model} sem rede"
}

test_partial_installation_auto_resume() {
  local model="sam2.1-hiera-small"
  local home_dir="${TEMP_ROOT}/home-partial"
  local app_dir="${home_dir}/.poligome-sam"
  local interrupted_log="${TEMP_ROOT}/partial-interrupted.log"
  local resume_log="${TEMP_ROOT}/partial-resume.log"
  local output

  # Provoca uma interrupção real depois do cache/pending e antes do commit.
  prepare_model_home "$model" "$home_dir"
  create_sparse_checkpoint "$model" "$home_dir"
  : >"$interrupted_log"
  if output="$(
    POLIGOME_TEST_FAIL_DEEP_IMPORT="sam2" \
      run_isolated "$home_dir" "$interrupted_log" bash "$INSTALLER" "$model" 2>&1
  )"; then
    fail "falha profunda simulada não interrompeu a instalação de ${model}"
  fi
  [[ ! -e "${app_dir}/selected-model.txt" ]] ||
    fail "instalação interrompida foi promovida a seleção concluída"
  [[ "$(tr -d '\r\n' <"${app_dir}/pending-model.txt")" == "$model" ]] ||
    fail "instalação interrompida não preservou pending-model.txt"
  assert_installer_cache "$app_dir" "instalação interrompida de ${model}"

  # Sem override e sem rede, o iniciador deve preferir o cache API 2 criado pela
  # própria instalação interrompida.
  : >"$resume_log"
  if ! output="$(run_isolated "$home_dir" "$resume_log" bash "$STARTER" 2>&1)"; then
    printf '%s\n' "$output" >&2
    fail "iniciador não retomou automaticamente o estado parcial de ${model}"
  fi
  [[ "$(tr -d '\r\n' <"${app_dir}/selected-model.txt")" == "$model" ]] ||
    fail "retomada não persistiu ${model} como seleção concluída"
  [[ ! -e "${app_dir}/pending-model.txt" ]] ||
    fail "retomada concluída deixou pending-model.txt para trás"
  assert_file_line "$(expected_connector_call "$model" "$app_dir")" "$resume_log" "retomada de ${model}"
  assert_no_unexpected_work "$resume_log" "retomada de ${model}"
  pass "iniciador retoma pending-model automaticamente sem trabalho pesado"
}

test_selected_incomplete_auto_resume() {
  local model="sam2.1-hiera-small"
  local home_dir="${TEMP_ROOT}/home-selected-incomplete"
  local app_dir="${home_dir}/.poligome-sam"
  local log="${TEMP_ROOT}/selected-incomplete-resume.log"
  local output

  prepare_model_home "$model" "$home_dir"
  create_sparse_checkpoint "$model" "$home_dir"
  printf '%s\n' "$model" >"${app_dir}/selected-model.txt"
  : >"$log"
  if ! output="$(
    POLIGOME_INSTALLER_PATH="$INSTALLER" \
      run_isolated "$home_dir" "$log" bash "$STARTER" 2>&1
  )"; then
    printf '%s\n' "$output" >&2
    fail "iniciador não reparou instalação selecionada incompleta de ${model}"
  fi
  cmp -s "$CONNECTOR_SOURCE" "${app_dir}/poligome-sam-local.py" ||
    fail "retomada de ${model} não restaurou o conector"
  [[ ! -e "${app_dir}/pending-model.txt" ]] ||
    fail "retomada de seleção incompleta deixou estado pendente"
  assert_file_line "$(expected_connector_call "$model" "$app_dir")" "$log" "retomada da seleção ${model}"
  assert_no_unexpected_work "$log" "retomada da seleção ${model}"
  pass "iniciador repara automaticamente uma seleção incompleta"
}

test_empty_state_delegates_to_installer_menu() {
  local model="sam2.1-hiera-base-plus"
  local home_dir="${TEMP_ROOT}/home-empty-selection"
  local app_dir="${home_dir}/.poligome-sam"
  local log="${TEMP_ROOT}/empty-selection.log"
  local output

  # Há artefatos reaproveitáveis, mas nenhuma intenção persistida. O starter não
  # tenta inferir a variante: delega ao menu do instalador, preservando stdin.
  prepare_model_home "$model" "$home_dir"
  create_sparse_checkpoint "$model" "$home_dir"
  : >"$log"
  if ! output="$(
    printf '3\n' |
      POLIGOME_INSTALLER_PATH="$INSTALLER" \
        run_isolated "$home_dir" "$log" bash "$STARTER" 2>&1
  )"; then
    printf '%s\n' "$output" >&2
    fail "iniciador sem estado não delegou ao menu do instalador"
  fi
  [[ "$(tr -d '\r\n' <"${app_dir}/selected-model.txt")" == "$model" ]] ||
    fail "menu delegado não selecionou ${model}"
  [[ ! -e "${app_dir}/pending-model.txt" ]] ||
    fail "menu delegado deixou estado pendente após sucesso"
  assert_file_line "$(expected_connector_call "$model" "$app_dir")" "$log" "menu delegado"
  assert_no_unexpected_work "$log" "menu delegado"
  pass "estado vazio abre o menu do instalador sem inferir variante"
}

test_sam3_runtime_dependency_repair() {
  local model="sam3-concepts"
  local home_dir="${TEMP_ROOT}/home-sam3-repair"
  local app_dir="${home_dir}/.poligome-sam"
  local log="${TEMP_ROOT}/sam3-repair.log"
  local output
  local repair_line

  prepare_model_home "$model" "$home_dir"
  create_sparse_checkpoint "$model" "$home_dir"
  : >"$log"
  if ! output="$(
    POLIGOME_TEST_ALLOW_SAM3_REPAIR=1 \
      run_isolated "$home_dir" "$log" bash "$INSTALLER" "$model" 2>&1
  )"; then
    printf '%s\n' "$output" >&2
    fail "SAM 3 não reparou dependências transitivas ausentes"
  fi
  repair_line="$(grep -F $'sam3-repair\t' "$log" || true)"
  assert_contains "$repair_line" "setuptools<81" "reparo de dependências SAM 3"
  assert_contains "$repair_line" "einops" "reparo de dependências SAM 3"
  assert_contains "$repair_line" "psutil" "reparo de dependências SAM 3"
  assert_contains "$repair_line" "pycocotools" "reparo de dependências SAM 3"
  [[ "$(tr -d '\r\n' <"${app_dir}/selected-model.txt")" == "$model" ]] ||
    fail "reparo de dependências SAM 3 não concluiu a seleção"
  assert_no_unexpected_work "$log" "reparo de dependências SAM 3"
  pass "SAM 3 repara automaticamente dependências transitivas ausentes"
}

test_ready_markers_require_deep_imports() {
  local models=(sam2.1-hiera-tiny sam2.1-hiera-large sam3-concepts)
  local model
  local family
  local safe_model
  local home_dir
  local app_dir
  local log
  local output

  for model in "${models[@]}"; do
    family="${MODEL_FAMILY[$model]}"
    safe_model="${model//[^[:alnum:]]/_}"
    home_dir="${TEMP_ROOT}/home-deep-${safe_model}"
    app_dir="${home_dir}/.poligome-sam"
    log="${TEMP_ROOT}/deep-${safe_model}.log"
    prepare_model_home "$model" "$home_dir"
    create_sparse_checkpoint "$model" "$home_dir"
    : >"$log"
    if output="$(
      POLIGOME_TEST_FAIL_DEEP_IMPORT="$family" \
        run_isolated "$home_dir" "$log" bash "$INSTALLER" "$model" 2>&1
    )"; then
      fail "marker ${family} foi aceito apesar da falha no import profundo"
    fi
    assert_file_line $'deep-import-failed\t'"$family" "$log" "smoke import ${family}"
    grep -Fq 'unexpected-pip' "$log" ||
      fail "${family}: falha profunda não acionou reinstalação do runtime"
    [[ ! -e "${app_dir}/selected-model.txt" ]] ||
      fail "${family}: runtime inválido foi promovido a seleção concluída"
    [[ "$(tr -d '\r\n' <"${app_dir}/pending-model.txt")" == "$model" ]] ||
      fail "${family}: falha não preservou o modelo pendente para retomada"
  done
  pass "markers de runtime exigem imports profundos nas duas famílias"
}

test_truncated_download_is_fail_closed() {
  local model="sam2.1-hiera-tiny"
  local home_dir="${TEMP_ROOT}/home-truncated-download"
  local app_dir="${home_dir}/.poligome-sam"
  local checkpoint="${app_dir}/models/${model}/${CHECKPOINT_NAME[$model]}"
  local log="${TEMP_ROOT}/truncated-download.log"
  local output

  prepare_model_home "$model" "$home_dir"
  : >"$log"
  if output="$(
    POLIGOME_TEST_EXPECTED_DOWNLOAD="${CHECKPOINT_URL[$model]}" \
    POLIGOME_TEST_EXPECTED_SIZE="${CHECKPOINT_SIZE[$model]}" \
    POLIGOME_TEST_DOWNLOAD_SIZE_OVERRIDE=17 \
      run_isolated "$home_dir" "$log" bash "$INSTALLER" "$model" 2>&1
  )"; then
    fail "download truncado de ${model} foi aceito"
  fi
  assert_contains "$output" "esperado: ${CHECKPOINT_SIZE[$model]}" "diagnóstico de download truncado"
  [[ ! -e "$checkpoint" && ! -e "${checkpoint}.part" ]] ||
    fail "download truncado deixou checkpoint final ou parcial"
  [[ ! -e "${app_dir}/selected-model.txt" ]] ||
    fail "download truncado foi promovido a seleção concluída"
  [[ "$(tr -d '\r\n' <"${app_dir}/pending-model.txt")" == "$model" ]] ||
    fail "download truncado não preservou a intenção de retomada"
  pass "download truncado falha fechado, limpa .part e preserva pending"
}

test_health_requires_matching_model() {
  local model="sam2.1-hiera-base-plus"
  local home_dir="${TEMP_ROOT}/home-health-match"
  local app_dir="${home_dir}/.poligome-sam"
  local log="${TEMP_ROOT}/health-match.log"
  local expected_call
  local output

  prepare_model_home "$model" "$home_dir"
  create_sparse_checkpoint "$model" "$home_dir"
  : >"$log"
  if ! output="$(
    POLIGOME_TEST_HEALTH_MATCH="$model" \
      run_isolated "$home_dir" "$log" bash "$INSTALLER" "$model" 2>&1
  )"; then
    printf '%s\n' "$output" >&2
    fail "health válido do modelo selecionado não foi reutilizado"
  fi
  assert_file_line $'health-model-probe\t'"$model" "$log" "health de ${model}"
  expected_call="$(expected_connector_call "$model" "$app_dir")"
  if grep -Fqx -- "$expected_call" "$log"; then
    fail "conector foi duplicado apesar de health/model_id compatíveis"
  fi
  [[ "$(tr -d '\r\n' <"${app_dir}/selected-model.txt")" == "$model" ]] ||
    fail "health compatível não preservou a seleção"

  home_dir="${TEMP_ROOT}/home-health-mismatch"
  app_dir="${home_dir}/.poligome-sam"
  log="${TEMP_ROOT}/health-mismatch.log"
  prepare_model_home "$model" "$home_dir"
  create_sparse_checkpoint "$model" "$home_dir"
  : >"$log"
  if output="$(
    POLIGOME_TEST_HEALTH_MATCH="outro-modelo" \
    POLIGOME_TEST_PORT_IN_USE=1 \
      run_isolated "$home_dir" "$log" bash "$INSTALLER" "$model" 2>&1
  )"; then
    fail "porta ocupada por outro modelo foi tratada como health compatível"
  fi
  assert_contains "$output" "porta 7860 já está ocupada" "conflito de modelo/porta"
  if grep -Fqx -- "$(expected_connector_call "$model" "$app_dir")" "$log"; then
    fail "conector iniciou sobre uma porta ocupada por outro modelo"
  fi
  pass "health só reutiliza processo com serviço, API, status e modelo compatíveis"
}

test_connector_must_be_ready_before_commit() {
  local model="sam2.1-hiera-tiny"
  local home_dir="${TEMP_ROOT}/home-connector-not-ready"
  local app_dir="${home_dir}/.poligome-sam"
  local log="${TEMP_ROOT}/connector-not-ready.log"
  local output

  prepare_model_home "$model" "$home_dir"
  create_sparse_checkpoint "$model" "$home_dir"
  : >"$log"
  if output="$(
    POLIGOME_TEST_CONNECTOR_FAIL_BEFORE_READY=41 \
      run_isolated "$home_dir" "$log" bash "$INSTALLER" "$model" 2>&1
  )"; then
    fail "conector encerrado antes de ready foi promovido a instalação concluída"
  fi
  [[ ! -e "${app_dir}/selected-model.txt" ]] ||
    fail "conector sem health ready criou selected-model.txt"
  [[ "$(tr -d '\r\n' <"${app_dir}/pending-model.txt")" == "$model" ]] ||
    fail "falha do conector antes de ready não preservou pending-model.txt"
  assert_installer_cache "$app_dir" "falha do conector de ${model}"
  assert_file_line "$(expected_connector_call "$model" "$app_dir")" "$log" "conector sem ready"
  assert_no_unexpected_work "$log" "conector sem ready"
  pass "selected só é confirmado após health API 2/ready do modelo exato"
}

test_connector_exit_is_propagated() {
  local model="sam2.1-hiera-tiny"
  local home_dir="${TEMP_ROOT}/home-connector-exit"
  local app_dir="${home_dir}/.poligome-sam"
  local install_log="${TEMP_ROOT}/connector-exit-install.log"
  local start_log="${TEMP_ROOT}/connector-exit-start.log"
  local output
  local status

  prepare_model_home "$model" "$home_dir"
  create_sparse_checkpoint "$model" "$home_dir"
  : >"$install_log"
  if output="$(
    POLIGOME_TEST_CONNECTOR_EXIT=23 \
      run_isolated "$home_dir" "$install_log" bash "$INSTALLER" "$model" 2>&1
  )"; then
    status=0
  else
    status=$?
  fi
  [[ "$status" == 23 ]] || {
    printf '%s\n' "$output" >&2
    fail "instalador retornou ${status}, esperava o código 23 do conector"
  }
  [[ "$(tr -d '\r\n' <"${app_dir}/selected-model.txt")" == "$model" ]] ||
    fail "health ready não confirmou seleção antes da saída 23 do conector"

  : >"$start_log"
  if output="$(
    POLIGOME_TEST_CONNECTOR_EXIT=29 \
      run_isolated "$home_dir" "$start_log" bash "$STARTER" 2>&1
  )"; then
    status=0
  else
    status=$?
  fi
  [[ "$status" == 29 ]] || {
    printf '%s\n' "$output" >&2
    fail "iniciador retornou ${status}, esperava o código 29 do conector"
  }
  assert_no_unexpected_work "$install_log" "saída do conector no instalador"
  assert_no_unexpected_work "$start_log" "saída do conector no iniciador"
  pass "installer e starter propagam a saída do conector após ready"
}

label_body() {
  local file="$1"
  local wanted_label="$2"
  awk -v wanted_label="$wanted_label" '
    { sub(/\r$/, "") }
    $0 == wanted_label { reading = 1; next }
    reading && /^:[[:alnum:]_]+$/ { exit }
    reading { print }
  ' "$file"
}

assert_model_list_matches() {
  local context="$1"
  shift
  local actual=("$@")
  [[ "${#actual[@]}" -eq "${#MODELS[@]}" ]] ||
    fail "${context}: esperava ${#MODELS[@]} modelos, encontrou ${#actual[@]}"
  local index
  for index in "${!MODELS[@]}"; do
    [[ "${actual[$index]}" == "${MODELS[$index]}" ]] ||
      fail "${context}: posição ${index} contém '${actual[$index]}', esperava '${MODELS[$index]}'"
  done
}

test_windows_static_matrix() {
  local installer_metadata
  local starter_metadata
  local installer_normalization
  local starter_normalization
  local choose_body
  local installer_source
  local starter_source
  local installer_wsl
  local starter_wsl
  local installer_wsl_urls
  local starter_wsl_urls
  local starter_health
  local stage_selection
  local commit_selection
  local file
  local model
  local block
  local count
  local index

  installer_metadata="$(label_body "$WINDOWS_INSTALLER" :set_model_metadata)"
  starter_metadata="$(label_body "$WINDOWS_STARTER" :set_model_metadata)"
  installer_normalization="$(label_body "$WINDOWS_INSTALLER" :normalize_model_id)"
  starter_normalization="$(label_body "$WINDOWS_STARTER" :normalize_model_id)"
  choose_body="$(label_body "$WINDOWS_INSTALLER" :choose_model)"
  installer_source="$(<"$WINDOWS_INSTALLER")"
  starter_source="$(<"$WINDOWS_STARTER")"
  installer_wsl="$(label_body "$WINDOWS_INSTALLER" :install_wsl_model)"
  starter_wsl="$(label_body "$WINDOWS_STARTER" :start_wsl_model)"
  installer_wsl_urls="$(label_body "$WINDOWS_INSTALLER" :enable_wsl_urls)"
  starter_wsl_urls="$(label_body "$WINDOWS_STARTER" :enable_wsl_urls)"
  starter_health="$(label_body "$WINDOWS_STARTER" :server_status)"
  stage_selection="$(label_body "$WINDOWS_INSTALLER" :stage_windows_selection)"
  commit_selection="$(label_body "$WINDOWS_INSTALLER" :commit_windows_selection)"

  assert_contains "$installer_metadata" 'set "FAMILY=wsl"' "instalador Windows resolve tudo no WSL2"
  assert_contains "$starter_metadata" 'set "FAMILY=wsl"' "iniciador Windows resolve tudo no WSL2"

  for index in "${!MODELS[@]}"; do
    model="${MODELS[$index]}"
    for file in "$WINDOWS_INSTALLER" "$WINDOWS_STARTER"; do
      if [[ "$file" == "$WINDOWS_INSTALLER" ]]; then
        block="$(grep -F -- "if /I \"!MODEL_ID!\"==\"${model}\"" <<<"$installer_metadata" || true)"
        count="$(grep -Fc -- "if /I \"!MODEL_ID!\"==\"${model}\" exit /b 0" <<<"$installer_metadata" || true)"
      else
        block="$(grep -F -- "if /I \"!MODEL_ID!\"==\"${model}\"" <<<"$starter_metadata" || true)"
        count="$(grep -Fc -- "if /I \"!MODEL_ID!\"==\"${model}\" exit /b 0" <<<"$starter_metadata" || true)"
      fi
      [[ "$count" == 1 ]] || fail "$(basename "$file"): ${model} deve ter exatamente um bloco de metadados"
      [[ -n "$block" ]] || fail "$(basename "$file"): bloco ausente para ${model}"
    done

    assert_contains "$installer_normalization" "if /I \"!MODEL_ID!\"==\"${model}\" (" "canonicalização do instalador Windows/${model}"
    assert_contains "$starter_normalization" "if /I \"!MODEL_ID!\"==\"${model}\" (" "canonicalização do iniciador Windows/${model}"

    block="$(awk -v opening="if \"!MODEL_CHOICE!\"==\"$((index + 1))\" (" '
      $0 == opening { reading = 1 }
      reading { print }
      reading && $0 == ")" { exit }
    ' <<<"$choose_body")"
    assert_contains "$block" "set \"MODEL_ID=${model}\"" "menu Windows, opção $((index + 1))"
  done

  assert_contains "$installer_normalization" 'if /I "!MODEL_ID!"=="sam3" (' "alias SAM 3 no instalador Windows"
  assert_contains "$starter_normalization" 'if /I "!MODEL_ID!"=="sam3" (' "alias SAM 3 no iniciador Windows"
  assert_contains "$installer_source" 'goto :install_wsl_model' "roteamento WSL do instalador Windows"
  assert_contains "$starter_source" 'goto :start_wsl_model' "roteamento WSL do iniciador Windows"
  assert_contains "$installer_source" 'set "POLIGOME_SAM_WINDOWS_INSTALLER_API=2"' "marker do instalador Windows"
  assert_contains "$starter_source" 'set "POLIGOME_SAM_WINDOWS_STARTER_API=2"' "marker do iniciador Windows"

  assert_before "$installer_source" 'call :cache_windows_installer' 'call :stage_windows_selection' "cache do BAT antes do estado pendente"
  assert_before "$installer_source" 'call :stage_windows_selection' 'goto :install_wsl_model' "pending antes de qualquer instalação Windows"
  assert_contains "$stage_selection" '>"!PENDING_MODEL_FILE!.part" echo !MODEL_ID!' "gravação atômica de pending no Windows"
  assert_contains "$stage_selection" 'move /Y "!PENDING_MODEL_FILE!.part" "!PENDING_MODEL_FILE!"' "ativação atômica de pending no Windows"
  assert_contains "$commit_selection" 'move /Y "!PENDING_MODEL_FILE!" "!SELECTED_MODEL_FILE!"' "commit pending→selected no Windows"
  assert_before "$installer_wsl" 'bash $runner !MODEL_ID!' 'call :commit_windows_selection' "commit Windows somente após sucesso WSL"
  assert_contains "$starter_source" 'if exist "%PENDING_MODEL_FILE%" (' "detecção de pending no iniciador Windows"
  assert_contains "$starter_source" 'call "!INSTALLER!" "!MODEL_ID!"' "retomada Windows com modelo pendente"
  assert_contains "$starter_source" 'exit /b !RESUME_EXIT!' "propagação do resultado da retomada Windows"
  assert_contains "$starter_source" 'set "CACHED_INSTALLER=%APP_DIR%\bin\poligome-sam-windows.bat"' "fallback para BAT Windows em cache"
  assert_contains "$starter_source" 'POLIGOME_SAM_WINDOWS_INSTALLER_API=2' "validação exata do BAT Windows em cache"
  for block in "$starter_health"; do
    assert_contains "$block" "Poligome SAM local" "identidade do health Windows"
    assert_contains "$block" "api_version" "versão do health Windows"
    assert_contains "$block" "model_id" "modelo do health Windows"
    assert_contains "$block" "loading" "estado loading do health Windows"
    assert_contains "$block" "ready" "estado ready do health Windows"
  done
  assert_contains "$starter_source" 'if "!SERVER_STATUS!"=="2" goto :connector_conflict' "conflito de modelo no iniciador Windows"

  assert_contains "$starter_source" 'if errorlevel 1 goto :wsl_start_error' "falha do conector WSL2 tratada no iniciador Windows"
  assert_contains "$installer_source" 'if errorlevel 1 goto :wsl_install_error' "falha da instalação WSL2 tratada no instalador Windows"
  assert_contains "$starter_source" 'set "RESUME_EXIT=!ERRORLEVEL!"' "captura da saída da retomada Windows"

  for block in "$installer_wsl_urls" "$starter_wsl_urls"; do
    assert_contains "$block" 'set "POLIGOME_SITE_URL=!SITE_URL!"' "site propagado ao WSL"
    assert_contains "$block" 'if defined ASSET_BASE_OVERRIDDEN (' "override de assets condicionado no WSL"
    assert_contains "$block" 'set "POLIGOME_ASSET_BASE_URL=!ASSET_BASE_URL!"' "override explícito propagado ao WSL"
    assert_contains "$block" 'set "POLIGOME_ASSET_BASE_URL="' "asset default removido antes do WSL"
    assert_contains "$block" 'set "WSLENV=!WSL_URL_VARIABLES!' "lista condicional exportada ao WSL"
  done
  assert_contains "$installer_wsl" '$POLIGOME_BOOTSTRAP_ASSET_BASE_URL/poligome-sam-macos-linux.sh' "bootstrap do instalador WSL separado do override do conector"
  assert_contains "$starter_wsl" '$POLIGOME_BOOTSTRAP_ASSET_BASE_URL/poligome-sam-start-macos-linux.sh' "bootstrap do iniciador WSL separado do override do conector"
  [[ "$installer_wsl" != *'POLIGOME_ASSET_BASE_URL=$POLIGOME_ASSET_BASE_URL bash'* ]] ||
    fail "instalador WSL força asset default e contorna o pin do conector"
  [[ "$starter_wsl" != *'POLIGOME_ASSET_BASE_URL=$POLIGOME_ASSET_BASE_URL bash'* ]] ||
    fail "iniciador WSL força asset default e contorna o pin do conector"
  assert_contains "$installer_wsl" 'valid_installer $final' "fallback para instalador WSL em cache"
  assert_contains "$starter_wsl" 'valid_launcher $final' "fallback para iniciador WSL em cache"
  assert_contains "$installer_wsl" "grep -Fxq 'POLIGOME_SAM_INSTALLER_API=2'" "marker exato do instalador WSL"
  assert_contains "$starter_wsl" "grep -Fxq 'POLIGOME_SAM_STARTER_API=2'" "marker exato do iniciador WSL"
  assert_contains "$installer_wsl" 'monitor_commit & monitor_pid=' "espelhamento assíncrono da seleção WSL pronta"
  assert_contains "$installer_wsl" 'mv -f $POLIGOME_WINDOWS_PENDING_FILE $POLIGOME_WINDOWS_SELECTED_FILE' "commit Windows no ready confirmado pelo Bash"
  assert_contains "$installer_wsl_urls" 'POLIGOME_WINDOWS_PENDING_FILE/p:POLIGOME_WINDOWS_SELECTED_FILE/p' "tradução segura dos caminhos de estado Windows para WSL"
  assert_contains "$installer_wsl" "--proto '=https' --proto-redir '=https'" "HTTPS restrito no instalador WSL"
  assert_contains "$starter_wsl" "--proto '=https' --proto-redir '=https'" "HTTPS restrito no iniciador WSL"
  for file in "$WINDOWS_INSTALLER" "$WINDOWS_STARTER"; do
    # Sem --exec o wsl.exe passa o comando pelo shell padrão da distribuição,
    # que expande o script uma vez antes do bash: as variáveis atribuídas
    # dentro dele chegam vazias e a linha morre em erro de sintaxe.
    [[ "$(grep -c 'wsl\.exe -- bash -lc' "$file")" == 0 ]] ||
      fail "$(basename "$file"): chamada ao WSL precisa de --exec, senão o script é expandido duas vezes"
    [[ "$(grep -c 'wsl\.exe --exec bash -lc' "$file")" -gt 0 ]] ||
      fail "$(basename "$file"): nenhuma chamada wsl.exe --exec encontrada"
    count=0
    while IFS= read -r block; do
      count=$((count + 1))
      bash -n -c "$block" || fail "$(basename "$file"): bloco bash -lc do WSL possui sintaxe inválida"
      # O \r de um checkout Windows é removido acima; se ele chegasse aqui, o
      # bash -n reprovaria o bloco em vez de deixá-lo passar sem conferência.
    done < <(tr -d '\r' <"$file" | sed -n 's/^wsl\.exe --exec bash -lc "\(.*\)"$/\1/p')
    [[ "$count" -gt 0 ]] ||
      fail "$(basename "$file"): nenhum bloco bash -lc foi extraído para conferência de sintaxe"
  done
  pass "BATs preservam matriz, transação, roteamento WSL2, health e cache"
}

test_sam3_autocast() {
  local connector
  connector="$(cat "$CONNECTOR_SOURCE")"
  # O SAM 3 gera ativações em bfloat16 sem declarar autocast próprio, então o
  # dtype passa a depender do estado ambiente da thread. Como o conector carrega
  # o modelo na thread do carregador e atende em outra, sem este autocast toda
  # inferência morre com "mat1 and mat2 must have the same dtype". O checkpoint
  # é gated e não dá para exercitar isso em CI, então a garantia é de código.
  assert_contains "$connector" 'def _autocast(self):' "helper de autocast no adaptador do SAM 3"
  assert_contains "$connector" 'self._torch.autocast("cuda", dtype=self._torch.bfloat16)' "autocast bfloat16 declarado"
  assert_contains "$connector" 'with self._torch.inference_mode(), self._autocast():' "autocast aplicado na inferência"
  local applied
  applied="$(grep -c 'with self._torch.inference_mode(), self._autocast():' "$CONNECTOR_SOURCE")"
  [[ "$applied" -ge 2 ]] ||
    fail "o autocast do SAM 3 precisa cobrir set_image e predict; encontrado em ${applied} lugar(es)"
  pass "SAM 3 declara autocast bfloat16 em set_image e predict"
}

test_cross_artifact_matrix() {
  local app_models=()
  local connector_models=()
  # O sed abaixo não ancora o fim da linha, então um checkout com CRLF deixava
  # o \r colado no ID e a comparação falhava exibindo dois valores idênticos.
  mapfile -t app_models < <(
    sed -n '/^export const SAM_MODELS = \[/,/^] as const satisfies/p' "${PROJECT_ROOT}/app/lib/sam-models.ts" |
      sed -n 's/^[[:space:]]*id: "\([^"]*\)",/\1/p' | tr -d '\r'
  )
  mapfile -t connector_models < <(
    sed -n '/^MODEL_SPECS = {/,/^}/p' "$CONNECTOR_SOURCE" |
      sed -n 's/^    "\([^"]*\)": ModelSpec.*/\1/p' | tr -d '\r'
  )
  assert_model_list_matches "catálogo da aplicação" "${app_models[@]}"
  assert_model_list_matches "conector Python" "${connector_models[@]}"
  pass "catálogo, conector e instaladores usam os mesmos ${#MODELS[@]} IDs"
}

test_pinned_default_connector() {
  local installer_source
  local connector_sha
  installer_source="$(<"$INSTALLER")"
  connector_sha="$(sha256sum "$CONNECTOR_SOURCE" | awk '{print $1}')"
  # A integridade vem do SHA-256, não do endereço: o hash do arquivo é
  # conhecido antes de commitar, enquanto o hash de um commit só existe
  # depois dele — fixar a URL num commit fazia ela nascer apontando para a
  # revisão anterior, e no caso do renome do produto para um caminho que
  # nunca existiu. A URL passa a derivar da base de assets, e é o SHA que
  # garante que o arquivo baixado é este.
  assert_contains "$installer_source" \
    'DEFAULT_CONNECTOR_URL="${DEFAULT_ASSET_BASE_URL}/poligome-sam-local.py"' \
    "URL do conector derivada da base de assets"
  assert_contains "$installer_source" \
    'DEFAULT_ASSET_BASE_URL="https://raw.githubusercontent.com/eduardoafonso1089/poligome/main/public"' \
    "base de assets no repositório publicado"
  assert_contains "$installer_source" \
    "DEFAULT_CONNECTOR_SHA256=\"${connector_sha}\"" \
    "SHA-256 do conector padrão"
  assert_contains "$installer_source" 'if [[ "$actual_sha256" != "$expected_sha256" ]]' \
    "verificação do conector versionado"
  pass "conector padrão vem da base publicada e é conferido por SHA-256"
}

# O serviço de usuário resolve o modelo a cada arranque com uma lista própria,
# que ficou parada nos cinco modelos que existiam quando ela foi escrita. Com um
# MedSAM2 selecionado o serviço entrava em laço de falha, dizendo apenas
# "selected-model.txt inválido". Nada na suíte olhava para esse arquivo.
test_service_covers_every_model() {
  local service_source model
  service_source="$(<"$SERVICE")"
  for model in "${MODELS[@]}"; do
    assert_contains "$service_source" "  ${model})" "serviço de usuário reconhece ${model}"
  done
  assert_contains "$service_source" 'selected-model.txt inválido' "serviço recusa modelo desconhecido"
  pass "serviço de usuário reconhece os ${#MODELS[@]} modelos do catálogo"
}

# auto resolve para CUDA sempre que o PyTorch enxerga uma GPU, mesmo quando ela
# não tem VRAM para o modelo, e não havia como pedir CPU por fora.
test_device_is_choosable() {
  local file source
  for file in "$INSTALLER" "$STARTER" "$SERVICE"; do
    source="$(<"$file")"
    assert_contains "$source" 'POLIGOME_DEVICE' "$(basename "$file") aceita POLIGOME_DEVICE"
    assert_contains "$source" 'auto|cpu|cuda|mps)' "$(basename "$file") valida o dispositivo pedido"
    [[ "$source" != *'--device auto'* ]] ||
      fail "$(basename "$file"): ainda fixa --device auto, ignorando a escolha do usuário"
  done
  for file in "$WINDOWS_INSTALLER" "$WINDOWS_STARTER"; do
    source="$(tr -d '\r' <"$file")"
    assert_contains "$source" 'if defined POLIGOME_DEVICE' \
      "$(basename "$file") propaga POLIGOME_DEVICE ao WSL"
  done
  pass "dispositivo é escolhível pelo usuário nos cinco iniciadores"
}

# torch.cuda.is_available() responde "sim" numa placa antiga demais, e só o
# carregamento revela que não há kernel para ela. Sem conferir a capability
# antes, o usuário baixa cerca de 11 GB para receber
# "no kernel image is available for execution on the device".
test_sam3_rejects_old_gpu() {
  local installer_source
  installer_source="$(<"$INSTALLER")"
  assert_contains "$installer_source" 'SAM3_MIN_COMPUTE_MAJOR=7' "mínimo de capability declarado"
  assert_contains "$installer_source" '--query-gpu=compute_cap' "capability consultada pelo nvidia-smi"
  assert_contains "$installer_source" 'torch.cuda.get_arch_list()' "arquiteturas compiladas conferidas no PyTorch"
  # a consulta precisa vir antes do download, senão não evita nada
  assert_before "$installer_source" '--query-gpu=compute_cap' 'ensure_checkpoint' \
    "capability conferida antes de baixar o checkpoint"
  pass "SAM 3 recusa GPU antiga antes de baixar runtime e checkpoint"
}

bash -n "$INSTALLER" "$STARTER" "$SERVICE"
pass "sintaxe dos scripts Bash"

for model in "${MODELS[@]}"; do
  test_bash_model "$model"
done

test_partial_installation_auto_resume
test_selected_incomplete_auto_resume
test_empty_state_delegates_to_installer_menu
test_sam3_runtime_dependency_repair
test_ready_markers_require_deep_imports
test_truncated_download_is_fail_closed
test_health_requires_matching_model
test_connector_must_be_ready_before_commit
test_connector_exit_is_propagated
test_windows_static_matrix
test_sam3_autocast
test_cross_artifact_matrix
test_pinned_default_connector
test_service_covers_every_model
test_device_is_choosable
test_sam3_rejects_old_gpu

printf '\nTodos os testes locais dos instaladores SAM passaram.\n'
