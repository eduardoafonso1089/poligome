#!/usr/bin/env bash
# Teste de ponta a ponta do Poligome num Ubuntu de verdade, do jeito que um
# usuário faria a partir de https://poligome.com:
#
#   1. instala o SAM 2.1 Small com o instalador publicado no site;
#   2. confere o conector como o navegador o vê (CORS, rede privada, só 127.0.0.1);
#   3. segmenta a imagem da demo;
#   4. instala um segundo modelo com o conector no ar e troca para ele, como o
#      botão "Carregar este modelo" faz, e confere a recusa de um modelo ausente;
#   5. fecha o conector e religa pelo iniciador, que deve lembrar o modelo;
#   6. BYOM: sobe os dois exemplos em Docker e anota a imagem por eles;
#   7. Poligome Runtime: segue os comandos do site e roda uma pré-anotação.
#
# No fim deixa tudo no ar e imprime o roteiro do que só dá para ver no navegador.
#
# Por padrão tudo vai para uma pasta própria (HOME isolado): nenhuma instalação
# que você já tenha em ~/.poligome-sam é tocada. Ao terminar os testes no
# navegador, `bash teste-ubuntu.sh --parar` desliga tudo e `--limpar` apaga a pasta.
#
# Uso:
#   bash teste-ubuntu.sh                 # teste completo, isolado
#   bash teste-ubuntu.sh --sem-byom      # pula o BYOM (sem Docker)
#   bash teste-ubuntu.sh --sem-runtime   # pula o Poligome Runtime
#   bash teste-ubuntu.sh --home-real     # usa o seu HOME (primeira instalação de verdade)
#   bash teste-ubuntu.sh --parar         # desliga o que o último teste deixou no ar
#   bash teste-ubuntu.sh --limpar        # desliga e apaga a pasta do último teste

set -uo pipefail

SITE="${POLIGOME_SITE_URL:-https://poligome.com}"
SITE="${SITE%/}"
ORIGIN="https://poligome.com"
REAL_HOME="$HOME"
STATE_FILE="${REAL_HOME}/.poligome-teste-ubuntu"
SAM_PORT=7860
RUNTIME_PORT=7861
BYOM_PORTS=(8080 8081)
MAIN_MODEL="sam2.1-hiera-small"
SECOND_MODEL="sam2.1-hiera-tiny"
ABSENT_MODEL="sam2.1-hiera-base-plus"

WITH_BYOM=1
WITH_RUNTIME=1
USE_REAL_HOME=0
ACTION="test"

for argument in "$@"; do
  case "$argument" in
    --sem-byom) WITH_BYOM=0 ;;
    --sem-runtime) WITH_RUNTIME=0 ;;
    --home-real) USE_REAL_HOME=1 ;;
    --parar) ACTION="stop" ;;
    --limpar) ACTION="clean" ;;
    -h|--help) sed -n '2,29p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) printf 'Opção desconhecida: %s (use --help)\n' "$argument" >&2; exit 2 ;;
  esac
done

if [[ -t 1 ]]; then
  GREEN=$'\e[32m'; RED=$'\e[31m'; YELLOW=$'\e[33m'; BOLD=$'\e[1m'; DIM=$'\e[2m'; RESET=$'\e[0m'
else
  GREEN=""; RED=""; YELLOW=""; BOLD=""; DIM=""; RESET=""
fi

PASSED=0
FAILED=0
SKIPPED=0
FAILURES=()

section() { printf '\n%s== %s ==%s\n' "$BOLD" "$*" "$RESET"; }
info() { printf '   %s%s%s\n' "$DIM" "$*" "$RESET"; }
pass() { PASSED=$((PASSED + 1)); printf '  %s✔%s %s\n' "$GREEN" "$RESET" "$*"; }
fail() { FAILED=$((FAILED + 1)); FAILURES+=("$*"); printf '  %s✘ %s%s\n' "$RED" "$*" "$RESET"; }
skip() { SKIPPED=$((SKIPPED + 1)); printf '  %s– %s%s\n' "$YELLOW" "$*" "$RESET"; }
# check "descrição" comando...: passa se o comando terminar com 0.
check() { local label="$1"; shift; if "$@" >/dev/null 2>&1; then pass "$label"; else fail "$label"; fi; }

# ---------------------------------------------------------------- parar/limpar

stop_everything() {
  [[ -f "$STATE_FILE" ]] || { printf 'Nenhum teste anterior registrado em %s.\n' "$STATE_FILE"; return 0; }
  # shellcheck disable=SC1090
  source "$STATE_FILE"
  printf 'Desligando o que o teste em %s deixou no ar...\n' "${TEST_HOME:-?}"
  if [[ -f "${TEST_HOME}/pids" ]]; then
    while read -r pid; do
      [[ -n "$pid" ]] && kill -- "-${pid}" 2>/dev/null
    done <"${TEST_HOME}/pids"
    : >"${TEST_HOME}/pids"
  fi
  if [[ -f "${TEST_HOME}/Downloads/poligome-byom-macos-linux.sh" ]] && command -v docker >/dev/null 2>&1; then
    for model in byom-otsu byom-watershed; do
      DOCKER_CONFIG="${DOCKER_CONFIG:-${REAL_HOME}/.docker}" HOME="$TEST_HOME" bash "${TEST_HOME}/Downloads/poligome-byom-macos-linux.sh" stop --model-id "$model" >/dev/null 2>&1 || true
    done
  fi
  sleep 2
  # Reforço: o que ainda ouve nas portas do teste e roda de dentro da pasta do
  # teste também é dele (um conector relançado por troca de modelo, por exemplo).
  if command -v ss >/dev/null 2>&1; then
    for port in "$SAM_PORT" "$RUNTIME_PORT"; do
      for pid in $(ss -ltnpH "sport = :${port}" 2>/dev/null | grep -o 'pid=[0-9]*' | cut -d= -f2 | sort -u); do
        if [[ -n "${TEST_HOME:-}" ]] && tr '\0' ' ' <"/proc/${pid}/cmdline" 2>/dev/null | grep -Fq "$TEST_HOME"; then
          kill -- "-$(ps -o pgid= -p "$pid" | tr -d ' ')" 2>/dev/null || kill "$pid" 2>/dev/null
        fi
      done
    done
    sleep 2
  fi
  for port in "$SAM_PORT" "$RUNTIME_PORT" "${BYOM_PORTS[@]}"; do
    port_in_use "$port" && printf '  A porta %s continua ocupada.\n' "$port"
  done
  printf 'Pronto.\n'
}

port_in_use() {
  (exec 3<>"/dev/tcp/127.0.0.1/$1") 2>/dev/null
}

if [[ "$ACTION" == "stop" ]]; then
  stop_everything
  exit 0
fi
if [[ "$ACTION" == "clean" ]]; then
  stop_everything
  if [[ -f "$STATE_FILE" ]]; then
    # shellcheck disable=SC1090
    source "$STATE_FILE"
    if [[ "${TEST_HOME:-}" == "$REAL_HOME" ]]; then
      printf 'O último teste usou o seu HOME real: nada foi apagado.\n'
      printf 'Para remover a instalação: rm -rf ~/.poligome-sam ~/poligome-runtime\n'
    elif [[ -n "${TEST_HOME:-}" && -d "$TEST_HOME" && "$TEST_HOME" == "$REAL_HOME"/poligome-teste-* ]]; then
      rm -rf "$TEST_HOME" && printf 'Pasta %s apagada.\n' "$TEST_HOME"
    fi
    rm -f "$STATE_FILE"
  fi
  printf 'As imagens Docker dos exemplos BYOM continuam no Docker (docker image ls | grep poligome).\n'
  exit 0
fi

# ---------------------------------------------------------------- ambiente

if (( USE_REAL_HOME )); then
  TEST_HOME="$REAL_HOME"
  if [[ -e "${REAL_HOME}/.poligome-sam" ]]; then
    printf '%sJá existe ~/.poligome-sam.%s Com --home-real o teste seria de uma reinstalação, não de\n' "$RED" "$RESET"
    printf 'uma primeira instalação. Renomeie a pasta (mv ~/.poligome-sam ~/.poligome-sam.bak) ou rode sem --home-real.\n'
    exit 2
  fi
else
  TEST_HOME="${REAL_HOME}/poligome-teste-$(date +%Y%m%d-%H%M%S)"
fi
LOGS="${TEST_HOME}/logs"
DOWNLOADS="${TEST_HOME}/Downloads"
APP_DIR="${TEST_HOME}/.poligome-sam"
mkdir -p "$LOGS" "$DOWNLOADS"
: >"${TEST_HOME}/pids"
printf 'TEST_HOME=%q\n' "$TEST_HOME" >"$STATE_FILE"

# Os instaladores abrem o site no navegador; com o HOME trocado o Firefox criaria
# um perfil novo dentro da pasta do teste. O roteiro do navegador vem no fim.
SHIM="${TEST_HOME}/.sem-navegador"
mkdir -p "$SHIM"
printf '#!/bin/sh\nexit 0\n' >"${SHIM}/xdg-open"
chmod +x "${SHIM}/xdg-open"
# O Docker guarda o contexto em ~/.docker: sem isto, trocar o HOME o perderia.
export DOCKER_CONFIG="${DOCKER_CONFIG:-${REAL_HOME}/.docker}"

# Roda um comando como se o HOME fosse a pasta do teste.
in_test_home() { HOME="$TEST_HOME" PATH="${SHIM}:${PATH}" "$@"; }

SAM_BASE="http://127.0.0.1:${SAM_PORT}"
RUNTIME_BASE="http://127.0.0.1:${RUNTIME_PORT}"
IMAGE="${DOWNLOADS}/park-aerial.jpg"

# Roda um comando como se o HOME fosse a pasta do teste, num grupo de processos
# próprio, para poder desligá-lo inteiro depois. Imprime o PID do grupo.
start_background() {
  local log="$1"; shift
  # setsid direto, e não pela função in_test_home: uma função em segundo plano
  # vira um subshell, e o $! seria o dele, não o do grupo a desligar depois.
  (cd "$DOWNLOADS" || exit 1
    HOME="$TEST_HOME" PATH="${SHIM}:${PATH}" setsid "$@" </dev/null >"$log" 2>&1 &
    printf '%s\n' "$!")
}

# Espera até `cond` passar, o processo morrer ou o prazo acabar.
wait_until() {
  local seconds="$1" pid="$2"; shift 2
  local deadline=$((SECONDS + seconds))
  while (( SECONDS < deadline )); do
    "$@" && return 0
    if [[ -n "$pid" ]] && ! kill -0 "$pid" 2>/dev/null; then
      "$@"
      return
    fi
    sleep 3
  done
  return 1
}

json_get() {
  # json_get URL 'expressão python sobre d' [cabeçalhos curl...]
  local url="$1" expression="$2"; shift 2
  curl -s --max-time 10 "$@" "$url" | python3 -c "import json,sys; d=json.load(sys.stdin); print($expression)" 2>/dev/null
}

sam_ready_with() {
  [[ "$(json_get "${SAM_BASE}/health" 'd.get("status"), d.get("model_id")')" == "ready $1" ]]
}

kill_group() {
  kill -- "-$1" 2>/dev/null
  sed -i "/^$1\$/d" "${TEST_HOME}/pids"
}

predict_body() {
  # Corpo do /predict com a imagem em data URL e um ponto, como o editor manda.
  python3 - "$IMAGE" "$1" <<'PY'
import base64, json, sys
image, model = sys.argv[1:]
data = base64.b64encode(open(image, "rb").read()).decode()
print(json.dumps({
    "image": f"data:image/jpeg;base64,{data}",
    "model_id": model,
    "points": [{"x": 600, "y": 390, "label": 1}],
    "multimask_output": True,
}))
PY
}

predict_ok() {
  # predict_ok MODELO -> imprime segundos; falha se não houver polígono.
  local model="$1" started response
  predict_body "$model" >"${LOGS}/predict-body.json"
  started=$SECONDS
  response="$(curl -s --max-time 300 -H "Origin: ${ORIGIN}" -H 'Content-Type: application/json' \
    --data-binary "@${LOGS}/predict-body.json" "${SAM_BASE}/predict")"
  printf '%s' "$response" >"${LOGS}/predict-${model}.json"
  python3 -c 'import json,sys; d=json.load(sys.stdin); p=d.get("polygon") or []; sys.exit(0 if len(p) >= 3 else 1)' <<<"$response" 2>/dev/null ||
    return 1
  printf '%s' "$((SECONDS - started))"
}

header_of() {
  # header_of MÉTODO URL NOME-DO-CABEÇALHO [cabeçalhos curl...]
  local method="$1" url="$2" name="$3"; shift 3
  curl -s -o /dev/null -D - -X "$method" --max-time 10 "$@" "$url" | tr -d '\r' |
    awk -v name="$(printf '%s' "$name" | tr '[:upper:]' '[:lower:]')" -F': ' 'tolower($1) == name { print $2 }'
}

status_of() {
  local method="$1" url="$2"; shift 2
  curl -s -o /dev/null -w '%{http_code}' -X "$method" --max-time 10 "$@" "$url"
}

printf '%sTeste do Poligome no Ubuntu%s — %s\n' "$BOLD" "$RESET" "$(date '+%d/%m/%Y %H:%M')"
printf 'Pasta do teste: %s\n' "$TEST_HOME"
printf 'Logs: %s\n' "$LOGS"

# ---------------------------------------------------------------- 0. pré-requisitos

section "0. Pré-requisitos"
OS_LINE="$(. /etc/os-release 2>/dev/null && printf '%s' "${PRETTY_NAME:-Linux}")"
info "Sistema: ${OS_LINE:-desconhecido} · $(uname -m)"
[[ "$OS_LINE" == Ubuntu* ]] || info "Não é Ubuntu: o teste segue, mas foi pensado para Ubuntu."

for tool in curl python3; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    fail "$tool não encontrado (sudo apt install $tool)"
    printf '\nSem %s o teste não consegue continuar.\n' "$tool"
    exit 1
  fi
done
info "Python: $(python3 --version 2>&1)"

for port in "$SAM_PORT" "$RUNTIME_PORT" "${BYOM_PORTS[@]}"; do
  if port_in_use "$port"; then
    fail "porta ${port} já está ocupada — feche o conector, runtime ou contêiner que estiver nela"
    printf '\nLibere as portas %s, %s, 8080 e 8081 e rode de novo.\n' "$SAM_PORT" "$RUNTIME_PORT"
    exit 1
  fi
done
pass "portas ${SAM_PORT}, ${RUNTIME_PORT}, 8080 e 8081 livres"

free_gb="$(df -Pk "$TEST_HOME" | awk 'NR == 2 { printf "%d", $4 / 1048576 }')"
if (( free_gb >= 10 )); then pass "espaço livre: ${free_gb} GB"; else fail "espaço livre: ${free_gb} GB (recomendado: 10 GB)"; fi

if command -v nvidia-smi >/dev/null 2>&1 && nvidia-smi -L >/dev/null 2>&1; then
  GPU="$(nvidia-smi --query-gpu=name,compute_cap --format=csv,noheader 2>/dev/null | head -n 1)"
  info "GPU NVIDIA: ${GPU} (abaixo de 7.0 o instalador avisa e segue em CPU)"
  HAS_NVIDIA=1
else
  info "Sem GPU NVIDIA: o esperado é tudo em CPU, com o torch de CPU."
  HAS_NVIDIA=0
fi

VENV_OK=1
python3 -c 'import ensurepip, venv' >/dev/null 2>&1 || VENV_OK=0
(( VENV_OK )) && info "Módulo venv do Python: presente" ||
  info "Módulo venv do Python: AUSENTE — o instalador deve mandar instalar python3.X-venv"

if (( WITH_BYOM )); then
  if ! command -v docker >/dev/null 2>&1; then
    skip "BYOM: Docker não instalado (https://docs.docker.com/engine/install/ubuntu/) — pulado"
    WITH_BYOM=0
  elif ! docker info >/dev/null 2>&1; then
    skip "BYOM: sem acesso ao Docker (inicie o serviço ou: sudo usermod -aG docker \$USER e entre de novo) — pulado"
    WITH_BYOM=0
  else
    pass "Docker acessível ($(docker version --format '{{.Server.Version}}' 2>/dev/null))"
  fi
fi
if (( WITH_RUNTIME )); then
  if ! command -v git >/dev/null 2>&1; then
    skip "Runtime: git não instalado (sudo apt install git) — pulado"; WITH_RUNTIME=0
  elif ! command -v python3.12 >/dev/null 2>&1; then
    skip "Runtime: o site pede Python 3.12 e python3.12 não existe aqui — pulado"; WITH_RUNTIME=0
  else
    pass "git e python3.12 presentes para o Runtime"
  fi
fi

curl -fsSL --max-time 60 -o "$IMAGE" "${SITE}/demo/park-aerial.jpg" &&
  pass "imagem de teste baixada do site (demo/park-aerial.jpg)" ||
  { fail "não foi possível baixar ${SITE}/demo/park-aerial.jpg"; exit 1; }

# ---------------------------------------------------------------- 1. instalação do SAM

section "1. Instalar o SAM (${MAIN_MODEL}) pelo site"
info "Como no site: baixar poligome-sam-macos-linux.sh e rodar bash poligome-sam-macos-linux.sh ${MAIN_MODEL}"
if ! curl -fsSL --max-time 60 -o "${DOWNLOADS}/poligome-sam-macos-linux.sh" "${SITE}/poligome-sam-macos-linux.sh"; then
  fail "não foi possível baixar o instalador de ${SITE}"
  exit 1
fi
pass "instalador baixado do site"

if (( ! VENV_OK )); then
  (cd "$DOWNLOADS" && in_test_home timeout 300 bash poligome-sam-macos-linux.sh "$MAIN_MODEL" </dev/null >"${LOGS}/sam-install-sem-venv.log" 2>&1)
  if grep -q 'sudo apt install python3\.[0-9]*-venv' "${LOGS}/sam-install-sem-venv.log"; then
    pass "sem o venv, o instalador para e diz o comando exato"
    grep -o 'sudo apt install python3\.[0-9]*-venv' "${LOGS}/sam-install-sem-venv.log" | head -n 1 | sed 's/^/     → /'
  else
    fail "sem o venv, o instalador não disse o comando a rodar (veja ${LOGS}/sam-install-sem-venv.log)"
  fi
  [[ ! -e "${APP_DIR}/venvs/sam2/bin/python" ]] &&
    pass "a tentativa sem venv não deixou ambiente pela metade" ||
    fail "a tentativa sem venv deixou ${APP_DIR}/venvs/sam2 pela metade"
  printf '\nInstale o pacote indicado acima e rode este teste de novo.\n'
  exit 1
fi

started=$SECONDS
SAM_PID="$(start_background "${LOGS}/sam-install.log" bash poligome-sam-macos-linux.sh "$MAIN_MODEL")"
printf '%s\n' "$SAM_PID" >>"${TEST_HOME}/pids"
info "Instalando (a primeira vez baixa ~1-4 GB). Acompanhe: tail -f ${LOGS}/sam-install.log"
if wait_until 2700 "$SAM_PID" grep -qE 'instalado, carregado e selecionado|^Erro:' "${LOGS}/sam-install.log" &&
  grep -q 'instalado, carregado e selecionado' "${LOGS}/sam-install.log"; then
  pass "instalação concluída em $(( (SECONDS - started) / 60 )) min $(( (SECONDS - started) % 60 )) s"
else
  fail "a instalação não terminou (veja ${LOGS}/sam-install.log)"
  tail -n 15 "${LOGS}/sam-install.log" | sed 's/^/     /'
  printf '\nSem o SAM instalado o resto do teste não faz sentido.\n'
  exit 1
fi

check "conector pronto com ${MAIN_MODEL}" sam_ready_with "$MAIN_MODEL"
DEVICE_REPORTED="$(json_get "${SAM_BASE}/health" 'd.get("device")')"
HOST_REPORTED="$(json_get "${SAM_BASE}/health" 'd.get("host")')"
info "Rodando em: ${DEVICE_REPORTED} · host informado ao editor: ${HOST_REPORTED}"
EXPECTED_HOST="Linux"
grep -Eqi 'wsl2|microsoft-standard' /proc/sys/kernel/osrelease 2>/dev/null && EXPECTED_HOST="WSL2"
[[ "$HOST_REPORTED" == "$EXPECTED_HOST" ]] && pass "o conector se apresenta como ${EXPECTED_HOST}" ||
  fail "host informado: ${HOST_REPORTED} (esperado: ${EXPECTED_HOST})"
TORCH_VERSION="$("${APP_DIR}/venvs/sam2/bin/python" -c 'import torch; print(torch.__version__)' 2>/dev/null)"
info "torch ${TORCH_VERSION} · ambiente: $(du -sh "${APP_DIR}/venvs/sam2" 2>/dev/null | cut -f1)"
if (( ! HAS_NVIDIA )); then
  [[ "$TORCH_VERSION" == *+cpu ]] && pass "sem NVIDIA, instalou o torch de CPU (sem os ~4 GB de CUDA)" ||
    fail "sem NVIDIA, o torch instalado foi ${TORCH_VERSION} (esperado: +cpu)"
fi
if grep -qE 'DeprecationWarning|FutureWarning|Traceback' "${LOGS}/sam-install.log"; then
  fail "o terminal do usuário mostrou avisos ou erros técnicos (veja ${LOGS}/sam-install.log)"
  grep -E 'DeprecationWarning|FutureWarning|Traceback' "${LOGS}/sam-install.log" | head -n 3 | sed 's/^/     /'
else
  pass "terminal sem avisos técnicos (DeprecationWarning/FutureWarning)"
fi

# ---------------------------------------------------------------- 2. o conector visto pelo navegador

section "2. Conector como o navegador o vê"
[[ "$(header_of GET "${SAM_BASE}/health" access-control-allow-origin -H "Origin: ${ORIGIN}")" == "$ORIGIN" ]] &&
  pass "poligome.com pode ler o conector (CORS)" || fail "o conector não libera poligome.com no CORS"
preflight="$(status_of OPTIONS "${SAM_BASE}/predict" -H "Origin: ${ORIGIN}" -H 'Access-Control-Request-Method: POST' \
  -H 'Access-Control-Request-Headers: content-type' -H 'Access-Control-Request-Private-Network: true')"
[[ "$preflight" == 200 ]] && pass "pré-verificação de rede privada do Chrome aceita (200)" ||
  fail "pré-verificação de rede privada do Chrome recusada (HTTP ${preflight})"
foreign="$(status_of OPTIONS "${SAM_BASE}/predict" -H 'Origin: https://site-estranho.example' -H 'Access-Control-Request-Method: POST')"
[[ "$foreign" == 403 ]] && pass "outro site é barrado (403)" || fail "outro site não foi barrado (HTTP ${foreign})"
if command -v ss >/dev/null 2>&1; then
  # Só a coluna do endereço local: a do outro lado é sempre 0.0.0.0:* num socket ouvindo.
  listening="$(ss -ltnH "sport = :${SAM_PORT}" | awk '{print $4}' | sort -u | tr '\n' ' ')"
  if [[ "$listening" == "127.0.0.1:${SAM_PORT} " ]]; then
    pass "o conector escuta só em 127.0.0.1"
  else
    fail "o conector escuta em: ${listening:-nada} (esperado: só 127.0.0.1:${SAM_PORT})"
  fi
fi

# ---------------------------------------------------------------- 3. segmentar

section "3. Segmentar a imagem da demo"
if seconds="$(predict_ok "$MAIN_MODEL")"; then
  pass "${MAIN_MODEL} devolveu um contorno em ${seconds} s"
else
  fail "${MAIN_MODEL} não devolveu contorno (veja ${LOGS}/predict-${MAIN_MODEL}.json)"
fi

# ---------------------------------------------------------------- 4. segundo modelo e troca

section "4. Segundo modelo com o conector no ar, e troca pelo editor"
info "Como no site, com o conector aberto: bash poligome-sam-macos-linux.sh ${SECOND_MODEL}"
started=$SECONDS
if (cd "$DOWNLOADS" && in_test_home timeout 1200 bash poligome-sam-macos-linux.sh "$SECOND_MODEL" </dev/null >"${LOGS}/sam-install-second.log" 2>&1); then
  pass "${SECOND_MODEL} instalado em $((SECONDS - started)) s sem derrubar nada"
else
  fail "a instalação de ${SECOND_MODEL} falhou (veja ${LOGS}/sam-install-second.log)"
  tail -n 8 "${LOGS}/sam-install-second.log" | sed 's/^/     /'
fi
grep -q 'continua no ar com outro modelo' "${LOGS}/sam-install-second.log" &&
  pass "o instalador explica que a troca se faz pelo editor" ||
  fail "o instalador não disse como ativar o novo modelo"
check "o conector seguiu com ${MAIN_MODEL} enquanto isso" sam_ready_with "$MAIN_MODEL"
installed="$(json_get "${SAM_BASE}/models" '" ".join(sorted(m["model_id"] for m in d.get("models", []) if m.get("installed")))')"
info "Instalados segundo o conector: ${installed}"
[[ " $installed " == *" $SECOND_MODEL "* && " $installed " == *" $MAIN_MODEL "* ]] &&
  pass "a lista do editor mostra os dois como instalados" || fail "a lista do editor não mostra os dois modelos"

load() {
  curl -s -o "${LOGS}/load-$1.json" -w '%{http_code}' --max-time 20 -H "Origin: ${ORIGIN}" \
    -H 'Content-Type: application/json' -d "{\"model_id\":\"$1\"}" "${SAM_BASE}/load"
}

started=$SECONDS
code="$(load "$SECOND_MODEL")"
if [[ "$code" == 200 ]] && wait_until 240 "" sam_ready_with "$SECOND_MODEL"; then
  pass "troca para ${SECOND_MODEL} em $((SECONDS - started)) s (botão \"Carregar este modelo\")"
  if seconds="$(predict_ok "$SECOND_MODEL")"; then pass "${SECOND_MODEL} segmenta (${seconds} s)"; else fail "${SECOND_MODEL} não segmentou"; fi
else
  fail "a troca para ${SECOND_MODEL} não completou (HTTP ${code}; veja ${LOGS}/sam-install.log)"
fi

code="$(load "$ABSENT_MODEL")"
if [[ "$code" == 409 ]] && grep -q 'não está instalado' "${LOGS}/load-${ABSENT_MODEL}.json"; then
  pass "pedir ${ABSENT_MODEL} (não instalado) é recusado com explicação"
else
  fail "pedido de modelo não instalado: HTTP ${code} — $(head -c 200 "${LOGS}/load-${ABSENT_MODEL}.json")"
fi
check "a recusa não derrubou o modelo em uso" sam_ready_with "$SECOND_MODEL"

started=$SECONDS
code="$(load "$MAIN_MODEL")"
if [[ "$code" == 200 ]] && wait_until 240 "" sam_ready_with "$MAIN_MODEL"; then
  pass "volta para ${MAIN_MODEL} em $((SECONDS - started)) s"
else
  fail "a volta para ${MAIN_MODEL} não completou (HTTP ${code})"
fi
[[ "$(head -n 1 "${APP_DIR}/selected-model.txt" 2>/dev/null)" == "$MAIN_MODEL" ]] &&
  pass "a escolha ficou salva para a próxima vez" || fail "selected-model.txt não guardou ${MAIN_MODEL}"

# ---------------------------------------------------------------- 5. fechar e religar

section "5. Fechar o terminal e religar pelo iniciador"
kill_group "$SAM_PID"
if wait_until 30 "" bash -c "! (exec 3<>/dev/tcp/127.0.0.1/${SAM_PORT}) 2>/dev/null"; then
  pass "fechar o terminal desliga o conector"
else
  fail "o conector continuou no ar depois de fechar o terminal"
fi
if curl -fsSL --max-time 60 -o "${DOWNLOADS}/poligome-sam-start-macos-linux.sh" "${SITE}/poligome-sam-start-macos-linux.sh"; then
  started=$SECONDS
  SAM_PID="$(start_background "${LOGS}/sam-start.log" bash poligome-sam-start-macos-linux.sh)"
  printf '%s\n' "$SAM_PID" >>"${TEST_HOME}/pids"
  if wait_until 600 "$SAM_PID" sam_ready_with "$MAIN_MODEL"; then
    pass "o iniciador religou com ${MAIN_MODEL} em $((SECONDS - started)) s, sem baixar nada de novo"
  else
    fail "o iniciador não religou o conector (veja ${LOGS}/sam-start.log)"
    tail -n 8 "${LOGS}/sam-start.log" | sed 's/^/     /'
  fi
else
  fail "não foi possível baixar o iniciador do site"
fi

# ---------------------------------------------------------------- 6. BYOM

section "6. BYOM: meus modelos em contêiner"
if (( WITH_BYOM )); then
  info "Como no site: bash poligome-byom-macos-linux.sh examples"
  if curl -fsSL --max-time 60 -o "${DOWNLOADS}/poligome-byom-macos-linux.sh" "${SITE}/poligome-byom-macos-linux.sh"; then
    started=$SECONDS
    if (cd "$DOWNLOADS" && in_test_home timeout 1800 bash poligome-byom-macos-linux.sh examples </dev/null >"${LOGS}/byom-examples.log" 2>&1); then
      pass "exemplos construídos e no ar em $((SECONDS - started)) s"
    else
      fail "o comando examples falhou (veja ${LOGS}/byom-examples.log)"
      tail -n 8 "${LOGS}/byom-examples.log" | sed 's/^/     /'
    fi
    for port in "${BYOM_PORTS[@]}"; do
      [[ "$(status_of GET "http://127.0.0.1:${port}/ping")" == 200 ]] && pass "contêiner na porta ${port} responde /ping" ||
        fail "contêiner na porta ${port} não responde /ping"
    done
    ready="$(json_get "${SAM_BASE}/byom/models" '" ".join(sorted(m["model_id"] for m in d.get("models", []) if m.get("ready")))' -H "Origin: ${ORIGIN}")"
    [[ "$ready" == *byom-otsu* && "$ready" == *byom-watershed* ]] &&
      pass "o editor enxerga os dois contêineres prontos (Conexões: 2 de 2)" ||
      fail "o conector não lista os contêineres prontos (lista: ${ready:-vazia})"
    python3 - "$IMAGE" >"${LOGS}/byom-body.json" <<'PY'
import base64, json, sys
data = base64.b64encode(open(sys.argv[1], "rb").read()).decode()
print(json.dumps({"model_id": "byom-otsu", "image": f"data:image/jpeg;base64,{data}", "file_name": "park-aerial.jpg"}))
PY
    started=$SECONDS
    code="$(curl -s -o "${LOGS}/byom-annotate.json" -w '%{http_code}' --max-time 300 -H "Origin: ${ORIGIN}" \
      -H 'Content-Type: application/json' --data-binary "@${LOGS}/byom-body.json" "${SAM_BASE}/byom/annotate")"
    count="$(python3 -c 'import json,sys; print(len(json.load(open(sys.argv[1]))["coco"]["annotations"]))' "${LOGS}/byom-annotate.json" 2>/dev/null)"
    if [[ "$code" == 200 && "${count:-0}" -gt 0 ]]; then
      pass "pré-anotar com Exemplo Otsu criou ${count} anotações em $((SECONDS - started)) s"
    else
      fail "pré-anotar com Exemplo Otsu: HTTP ${code} (veja ${LOGS}/byom-annotate.json)"
    fi
    check "a CLI lista os modelos registrados" in_test_home bash "${DOWNLOADS}/poligome-byom-macos-linux.sh" list
  else
    fail "não foi possível baixar a CLI do BYOM do site"
  fi
else
  skip "BYOM não testado"
fi

# ---------------------------------------------------------------- 7. Runtime

section "7. Poligome Runtime (modelos Nativos)"
if (( WITH_RUNTIME )); then
  RUNTIME_DIR="${TEST_HOME}/poligome-runtime"
  info "Como no site: git clone, python3.12 -m venv .venv, pip install ..., examples/serve_runtime.py"
  started=$SECONDS
  if (
    set -e
    cd "$TEST_HOME"
    export HOME="$TEST_HOME"
    git clone -q https://github.com/eduardoafonso1089/poligome-runtime.git
    cd poligome-runtime
    python3.12 -m venv .venv
    .venv/bin/python -m pip install -q --upgrade pip
    .venv/bin/python -m pip install -q torch torchvision --index-url https://download.pytorch.org/whl/cpu
    .venv/bin/python -m pip install -q -e ".[server]" -e adapters/fasterrcnn
  ) >"${LOGS}/runtime-install.log" 2>&1; then
    pass "runtime instalado em $(( (SECONDS - started) / 60 )) min $(( (SECONDS - started) % 60 )) s"
    started=$SECONDS
    RUNTIME_PID="$(cd "$RUNTIME_DIR" || exit 1
      HOME="$TEST_HOME" PATH="${SHIM}:${PATH}" setsid .venv/bin/python examples/serve_runtime.py --adapter fasterrcnn --device cpu \
        </dev/null >"${LOGS}/runtime.log" 2>&1 &
      printf '%s' "$!")"
    printf '%s\n' "$RUNTIME_PID" >>"${TEST_HOME}/pids"
    runtime_ready() { [[ "$(json_get "${RUNTIME_BASE}/health" 'd.get("service"), d.get("status"), d.get("protocol")')" == "poligome-runtime ready 1.0" ]]; }
    if wait_until 900 "$RUNTIME_PID" runtime_ready; then
      pass "runtime no ar em ${RUNTIME_BASE} após $((SECONDS - started)) s (inclui baixar os pesos)"
      [[ "$(header_of GET "${RUNTIME_BASE}/health" access-control-allow-origin -H "Origin: ${ORIGIN}")" == "$ORIGIN" ]] &&
        pass "poligome.com pode ler o runtime (CORS)" || fail "o runtime não libera poligome.com no CORS"
      name="$(json_get "${RUNTIME_BASE}/describe" 'd.get("name")')"
      [[ -n "$name" ]] && pass "modelo nativo anunciado: ${name}" || fail "o runtime não respondeu /describe"
      code="$(curl -s -o "${LOGS}/runtime-image.json" -w '%{http_code}' --max-time 60 -X PUT -H "Origin: ${ORIGIN}" \
        -H 'Content-Type: image/jpeg' --data-binary "@${IMAGE}" "${RUNTIME_BASE}/images/teste-ubuntu")"
      [[ "$code" == 200 ]] && pass "imagem enviada ao runtime" || fail "envio da imagem ao runtime: HTTP ${code}"
      started=$SECONDS
      curl -sN --max-time 600 -H "Origin: ${ORIGIN}" -H 'Content-Type: application/json' \
        -d '{"image":{"id":"teste-ubuntu"}}' "${RUNTIME_BASE}/infer" >"${LOGS}/runtime-infer.txt" 2>&1
      result="$(python3 - "${LOGS}/runtime-infer.txt" <<'PY'
import json, sys
progress, final, error = 0, None, None
for line in open(sys.argv[1], encoding="utf-8", errors="replace"):
    if not line.startswith("data:"):
        continue
    event = json.loads(line[5:].strip() or "{}")
    if event.get("type") == "progress":
        progress += 1
    elif event.get("type") == "result" and not event.get("partial"):
        final = len(event.get("annotations", []))
    elif event.get("type") == "error":
        error = event["error"].get("message")
print(f"{progress} {final if final is not None else 'none'} {error or ''}")
PY
)"
      read -r progress_events final_count error_message <<<"$result"
      if [[ "$final_count" != none ]]; then
        pass "pré-anotação nativa terminou em $((SECONDS - started)) s: ${final_count} caixas, ${progress_events} avisos de progresso"
      else
        fail "pré-anotação nativa sem resultado final ${error_message:+($error_message)} (veja ${LOGS}/runtime-infer.txt)"
      fi
      curl -s -o /dev/null -X DELETE "${RUNTIME_BASE}/images/teste-ubuntu"
    else
      fail "o runtime não ficou pronto (veja ${LOGS}/runtime.log)"
      tail -n 8 "${LOGS}/runtime.log" | sed 's/^/     /'
    fi
  else
    fail "a instalação do runtime falhou (veja ${LOGS}/runtime-install.log)"
    tail -n 8 "${LOGS}/runtime-install.log" | sed 's/^/     /'
  fi
else
  skip "Runtime não testado"
fi

# ---------------------------------------------------------------- resumo

section "Resumo"
printf '  %s%d passaram%s · %s%d falharam%s · %d pulados\n' "$GREEN" "$PASSED" "$RESET" "$RED" "$FAILED" "$RESET" "$SKIPPED"
for failure in "${FAILURES[@]+"${FAILURES[@]}"}"; do printf '  %s✘ %s%s\n' "$RED" "$failure" "$RESET"; done
printf '  Logs em %s\n' "$LOGS"

cat <<EOF

${BOLD}Agora no navegador${RESET} (o SAM$( (( WITH_BYOM )) && printf ', os contêineres')$( (( WITH_RUNTIME )) && printf ' e o runtime') continuam no ar)
Use o Chrome numa janela anônima, para ele perguntar de novo pela rede local.
Abra ${SITE}/annotate/ e confira:

  1. Clique em IA. O rodapé diz "Permita o acesso à rede local" e o Chrome mostra o
     aviso junto ao endereço. Clique em Permitir: em poucos segundos, sem clicar em
     mais nada, o rodapé muda para "Pronto · ${MAIN_MODEL} · ${DEVICE_REPORTED}".
  2. Feche, clique em "Experimentar demo" e aperte S: a ferramenta SAM liga. Clique
     num telhado: a proposta aparece em segundos. "Salvar e editar" adiciona o
     polígono. Aperte S de novo: volta para a seleção.
  3. IA → SAM 2.1 Hiera Tiny (marcado "instalado") → "Carregar este modelo": troca
     em ~10 s e o modal fecha.
  4. IA → SAM 2.1 Hiera Base+ (não instalado): o rodapé diz "Modelo não instalado"
     e o botão é "Verificar e usar", não "Carregar este modelo".
EOF
(( WITH_BYOM )) && cat <<'EOF'
  5. Com o SAM ligado, Pré-anotar → Exemplo Otsu → Pré-anotar: o cartão
     "N anotações criadas" aparece ACIMA da barra do SAM, sem cobrir Salvar/Reiniciar.
     Desfazer remove tudo de uma vez.
EOF
(( WITH_RUNTIME )) && cat <<'EOF'
  6. Pré-anotar → Faster R-CNN (COCO) → Pré-anotar: aparece o progresso por parte
     e depois as caixas.
EOF
cat <<EOF
  7. IA → Conexões: Conector "Conectado · em ${HOST_REPORTED}"$( (( WITH_RUNTIME )) && printf ', Runtime "Conectado"')$( (( WITH_BYOM )) && printf ', Contêineres "2 de 2 no ar"').
  8. Repita o passo 1 numa janela anônima nova clicando em "Bloquear": o rodapé
     diz "Acesso à rede local bloqueado" e explica como liberar.

Quando terminar:  bash $0 --parar   (desliga tudo)
                  bash $0 --limpar  (desliga e apaga ${TEST_HOME})
EOF

exit $(( FAILED > 0 ))
