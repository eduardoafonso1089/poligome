#!/usr/bin/env bash
set -euo pipefail

# Poligome BYOM — traga o seu próprio modelo em contêiner.
#
# O contrato imita o do SageMaker para reaproveitar contêineres já empacotados
# lá: a imagem sobe com `serve`, escuta em 8080, responde GET /ping quando está
# pronta e recebe a inferência em POST /invocations. Este script cuida do
# registro e do ciclo de vida do contêiner; o conector do Poligome descobre os
# modelos registrados sozinho.

APP_DIR="${POLIGOME_APP_DIR:-${HOME}/.poligome-sam}"
REGISTRY_DIR="${APP_DIR}/byom"
CONTAINER_PREFIX="poligome-byom"
DEFAULT_PORT=8080
START_TIMEOUT="${POLIGOME_BYOM_START_TIMEOUT:-120}"

usage() {
  cat <<'EOF'
Poligome BYOM — modelos em contêiner trazidos por você

Uso:
  bash poligome-byom-macos-linux.sh <comando> [opções]

Comandos:
  examples  [--path DIR]                   constrói e registra os dois exemplos oficiais
  build     --path DIR --image NOME        constrói a imagem a partir de um Dockerfile
  register  --model-id ID --image NOME     registra o modelo e o deixa visível no Poligome
            [--name "Rótulo"] [--port N] [--env CHAVE=VALOR]...
  start     --model-id ID                  sobe o contêiner e espera o /ping responder
  stop      --model-id ID                  encerra o contêiner
  status    [--model-id ID]                mostra registro, contêiner e /ping
  list                                     lista os modelos registrados
  logs      --model-id ID [--follow]       mostra a saída do contêiner
  remove    --model-id ID [--purge]        remove o registro (com --purge, apaga o contêiner)

O ID precisa começar com "byom-" para nunca colidir com um modelo oficial.

Variáveis opcionais:
  POLIGOME_APP_DIR            raiz das instalações (padrão: ~/.poligome-sam)
  POLIGOME_BYOM_START_TIMEOUT segundos de espera pelo /ping (padrão: 120)
EOF
}

fail() {
  printf '\nErro: %s\n' "$*" >&2
  exit 1
}

require_docker() {
  command -v docker >/dev/null 2>&1 ||
    fail "docker não foi encontrado no PATH. Instale o Docker antes de usar o BYOM."
  docker info >/dev/null 2>&1 ||
    fail "o daemon do Docker não respondeu. Inicie o Docker e tente de novo."
}

validate_model_id() {
  local id="$1"
  [[ -n "$id" ]] || fail "informe --model-id."
  [[ "$id" =~ ^byom-[a-z0-9][a-z0-9._-]{0,62}$ ]] ||
    fail "model-id inválido: ${id}. Use o prefixo byom- seguido de letras minúsculas, números, ponto, hífen ou sublinhado."
}

registration_file() {
  printf '%s\n' "${REGISTRY_DIR}/$1.json"
}

container_name() {
  printf '%s\n' "${CONTAINER_PREFIX}-${1#byom-}"
}

require_registration() {
  local file
  file="$(registration_file "$1")"
  [[ -f "$file" ]] || fail "modelo ${1} não está registrado. Rode o comando register antes."
  printf '%s\n' "$file"
}

read_field() {
  # Lê um campo do registro sem exigir jq, que não é padrão em toda máquina.
  python3 -c '
import json, sys
with open(sys.argv[1], encoding="utf-8") as handle:
    print(json.load(handle).get(sys.argv[2], "") or "")
' "$1" "$2"
}

port_from_endpoint() {
  local endpoint="$1"
  case "$endpoint" in
    *:[0-9]*) printf '%s\n' "${endpoint##*:}" ;;
    *) printf '%s\n' "$DEFAULT_PORT" ;;
  esac
}

ping_ok() {
  local endpoint="$1"
  [[ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 3 "${endpoint}/ping" 2>/dev/null)" == "200" ]]
}

# Os exemplos oficiais são versionados junto do código, em byom/examples, para
# que a lista não dependa do que existe na máquina de quem escreveu o contrato.
EXAMPLE_IMAGE="poligome-byom-exemplo"

cmd_examples() {
  local path=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --path) path="${2:-}"; shift 2 ;;
      *) fail "opção desconhecida para examples: $1" ;;
    esac
  done
  if [[ -z "$path" ]]; then
    path="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/byom"
  fi
  [[ -f "${path}/Dockerfile" ]] ||
    fail "não há Dockerfile em ${path}. Aponte --path para o diretório byom do repositório."
  local registry_source="${path}/examples"
  [[ -d "$registry_source" ]] ||
    fail "não há exemplos em ${registry_source}."
  require_docker

  printf 'Construindo a imagem dos exemplos (%s)...\n' "$EXAMPLE_IMAGE"
  # O docker build escreve o progresso em stderr; guardar e só mostrar em caso
  # de falha mantém a saída legível sem esconder o erro.
  local build_log="${TMPDIR:-/tmp}/poligome-byom-build.$$.log"
  if ! docker build -t "$EXAMPLE_IMAGE" "$path" >"$build_log" 2>&1; then
    printf '\n' >&2
    tail -20 "$build_log" >&2
    rm -f "$build_log"
    fail "docker build falhou."
  fi
  rm -f "$build_log"

  mkdir -p "$REGISTRY_DIR"
  local file base
  for file in "${registry_source}"/*.json; do
    [[ -e "$file" ]] || fail "nenhum exemplo encontrado em ${registry_source}."
    base="$(basename "$file")"
    # O registro do usuário manda: reinstalar os exemplos não apaga uma
    # anotação nem uma porta que alguém já tenha ajustado à mão.
    if [[ -f "${REGISTRY_DIR}/${base}" ]]; then
      printf '  %s já registrado; mantendo o seu registro.\n' "${base%.json}"
    else
      cp "$file" "${REGISTRY_DIR}/${base}"
      printf '  %s registrado.\n' "${base%.json}"
    fi
  done

  printf '\nSubindo os exemplos...\n'
  for file in "${registry_source}"/*.json; do
    base="$(basename "$file" .json)"
    cmd_start --model-id "$base" || printf '  %s não subiu; use logs --model-id %s para ver o motivo.\n' "$base" "$base"
  done
}

cmd_build() {
  local path="" image=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --path) path="${2:-}"; shift 2 ;;
      --image) image="${2:-}"; shift 2 ;;
      *) fail "opção desconhecida para build: $1" ;;
    esac
  done
  [[ -n "$path" ]] || fail "informe --path com o diretório que contém o Dockerfile."
  [[ -n "$image" ]] || fail "informe --image com o nome da imagem a construir."
  [[ -f "${path}/Dockerfile" ]] || fail "não há Dockerfile em ${path}."
  require_docker
  printf 'Construindo %s a partir de %s...\n' "$image" "$path"
  docker build -t "$image" "$path" || fail "docker build falhou."
  printf '\nImagem %s pronta. Registre com:\n' "$image"
  printf '  bash poligome-byom-macos-linux.sh register --model-id byom-SEU-ID --image %s\n' "$image"
}

cmd_register() {
  local model_id="" image="" name="" port="$DEFAULT_PORT"
  local env_pairs=()
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --model-id) model_id="${2:-}"; shift 2 ;;
      --image) image="${2:-}"; shift 2 ;;
      --name) name="${2:-}"; shift 2 ;;
      --port) port="${2:-}"; shift 2 ;;
      --env) env_pairs+=("${2:-}"); shift 2 ;;
      *) fail "opção desconhecida para register: $1" ;;
    esac
  done
  validate_model_id "$model_id"
  [[ -n "$image" ]] || fail "informe --image com o nome da imagem já construída."
  [[ "$port" =~ ^[0-9]{1,5}$ ]] && ((port >= 1 && port <= 65535)) ||
    fail "porta inválida: ${port}."
  require_docker
  docker image inspect "$image" >/dev/null 2>&1 ||
    fail "a imagem ${image} não existe localmente. Construa antes com o comando build ou com docker build."

  mkdir -p "$REGISTRY_DIR"
  local file
  file="$(registration_file "$model_id")"
  POLIGOME_MODEL_ID="$model_id" \
  POLIGOME_NAME="${name:-$model_id}" \
  POLIGOME_IMAGE="$image" \
  POLIGOME_PORT="$port" \
  POLIGOME_ENV="$(printf '%s\n' "${env_pairs[@]+"${env_pairs[@]}"}")" \
  python3 -c '
import json, os, sys

environment = {}
for line in os.environ.get("POLIGOME_ENV", "").splitlines():
    line = line.strip()
    if not line:
        continue
    if "=" not in line:
        raise SystemExit("--env espera CHAVE=VALOR; recebido: " + line)
    key, value = line.split("=", 1)
    if not key:
        raise SystemExit("--env com chave vazia: " + line)
    environment[key] = value

document = {
    "model_id": os.environ["POLIGOME_MODEL_ID"],
    "name": os.environ["POLIGOME_NAME"],
    "image": os.environ["POLIGOME_IMAGE"],
    "endpoint": "http://127.0.0.1:" + os.environ["POLIGOME_PORT"],
    "env": environment,
}
with open(sys.argv[1], "w", encoding="utf-8") as handle:
    json.dump(document, handle, ensure_ascii=False, indent=2)
    handle.write("\n")
' "$file" || fail "o registro não foi criado; corrija o problema apontado acima."

  printf '\nModelo %s registrado em %s\n' "$model_id" "$file"
  printf 'Suba o contêiner com:\n'
  printf '  bash poligome-byom-macos-linux.sh start --model-id %s\n' "$model_id"
}

cmd_start() {
  local model_id=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --model-id) model_id="${2:-}"; shift 2 ;;
      *) fail "opção desconhecida para start: $1" ;;
    esac
  done
  validate_model_id "$model_id"
  local file image endpoint port container
  file="$(require_registration "$model_id")"
  image="$(read_field "$file" image)"
  endpoint="$(read_field "$file" endpoint)"
  port="$(port_from_endpoint "$endpoint")"
  container="$(container_name "$model_id")"
  require_docker

  if ping_ok "$endpoint"; then
    printf 'O modelo %s já está respondendo em %s.\n' "$model_id" "$endpoint"
    return 0
  fi

  docker rm -f "$container" >/dev/null 2>&1 || true
  # As variáveis guardadas no registro voltam aqui, para que dois modelos saiam
  # da mesma imagem mudando só a configuração.
  local env_args=()
  local pair
  while IFS= read -r pair; do
    [[ -n "$pair" ]] && env_args+=(-e "$pair")
  done < <(python3 -c '
import json, sys
with open(sys.argv[1], encoding="utf-8") as handle:
    for key, value in (json.load(handle).get("env") or {}).items():
        print(f"{key}={value}")
' "$file")
  printf 'Subindo %s a partir de %s na porta %s...\n' "$model_id" "$image" "$port"
  # A publicação fica presa a 127.0.0.1 de propósito: o contêiner não deve ficar
  # exposto na rede, porque a inferência precisa permanecer local.
  docker run -d --name "$container" -p "127.0.0.1:${port}:8080" \
    "${env_args[@]+"${env_args[@]}"}" "$image" serve >/dev/null ||
    fail "docker run falhou para a imagem ${image}."

  local deadline=$((SECONDS + START_TIMEOUT))
  while ((SECONDS < deadline)); do
    if ping_ok "$endpoint"; then
      printf 'Pronto: %s respondeu 200 em %s/ping.\n' "$model_id" "$endpoint"
      printf 'No editor, abra o modelo de IA e rode este BYOM sobre a imagem.\n'
      return 0
    fi
    if [[ -z "$(docker ps -q -f "name=^${container}$")" ]]; then
      printf '\nO contêiner encerrou antes de ficar pronto. Últimas linhas do log:\n' >&2
      docker logs --tail 20 "$container" >&2 || true
      fail "o contêiner ${container} não permaneceu no ar."
    fi
    sleep 1
  done
  fail "o contêiner não respondeu em ${endpoint}/ping dentro de ${START_TIMEOUT}s."
}

cmd_stop() {
  local model_id=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --model-id) model_id="${2:-}"; shift 2 ;;
      *) fail "opção desconhecida para stop: $1" ;;
    esac
  done
  validate_model_id "$model_id"
  require_registration "$model_id" >/dev/null
  require_docker
  local container
  container="$(container_name "$model_id")"
  docker rm -f "$container" >/dev/null 2>&1 ||
    fail "não havia contêiner ${container} para encerrar."
  printf 'Contêiner de %s encerrado.\n' "$model_id"
}

print_status_line() {
  local model_id="$1" file endpoint image container state ping
  file="$(registration_file "$model_id")"
  endpoint="$(read_field "$file" endpoint)"
  image="$(read_field "$file" image)"
  container="$(container_name "$model_id")"
  state="parado"
  if command -v docker >/dev/null 2>&1 && [[ -n "$(docker ps -q -f "name=^${container}$" 2>/dev/null)" ]]; then
    state="no ar"
  fi
  ping="sem resposta"
  ping_ok "$endpoint" && ping="200"
  printf '  %-28s %-26s %-9s %-12s %s\n' "$model_id" "$image" "$state" "$ping" "$endpoint"
}

cmd_list() {
  [[ -d "$REGISTRY_DIR" ]] || { printf 'Nenhum modelo BYOM registrado.\n'; return 0; }
  local files=("${REGISTRY_DIR}"/*.json)
  [[ -e "${files[0]}" ]] || { printf 'Nenhum modelo BYOM registrado.\n'; return 0; }
  printf '\n  %-28s %-26s %-9s %-12s %s\n' "MODEL-ID" "IMAGEM" "CONTÊINER" "/ping" "ENDPOINT"
  local file base
  for file in "${files[@]}"; do
    base="$(basename "$file" .json)"
    print_status_line "$base"
  done
  printf '\n'
}

cmd_status() {
  local model_id=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --model-id) model_id="${2:-}"; shift 2 ;;
      *) fail "opção desconhecida para status: $1" ;;
    esac
  done
  [[ -n "$model_id" ]] || { cmd_list; return 0; }
  validate_model_id "$model_id"
  require_registration "$model_id" >/dev/null
  printf '\n  %-28s %-26s %-9s %-12s %s\n' "MODEL-ID" "IMAGEM" "CONTÊINER" "/ping" "ENDPOINT"
  print_status_line "$model_id"
  printf '\n'
}

cmd_logs() {
  local model_id="" follow=0
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --model-id) model_id="${2:-}"; shift 2 ;;
      --follow) follow=1; shift ;;
      *) fail "opção desconhecida para logs: $1" ;;
    esac
  done
  validate_model_id "$model_id"
  require_registration "$model_id" >/dev/null
  require_docker
  local container
  container="$(container_name "$model_id")"
  if ((follow)); then
    docker logs -f "$container"
  else
    docker logs --tail 50 "$container"
  fi
}

cmd_remove() {
  local model_id="" purge=0
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --model-id) model_id="${2:-}"; shift 2 ;;
      --purge) purge=1; shift ;;
      *) fail "opção desconhecida para remove: $1" ;;
    esac
  done
  validate_model_id "$model_id"
  local file
  local purged=0
  file="$(require_registration "$model_id")"
  if ((purge)) && command -v docker >/dev/null 2>&1; then
    docker rm -f "$(container_name "$model_id")" >/dev/null 2>&1 && purged=1
  fi
  rm -f "$file"
  printf 'Registro de %s removido.\n' "$model_id"
  # Só afirma ter apagado o contêiner quando o docker rm de fato apagou um:
  # sem Docker no PATH, ou sem contêiner com esse nome, não há o que apagar e
  # dizer o contrário manda o usuário procurar um resto que não existe.
  if ((purge)); then
    if ((purged)); then
      printf 'O contêiner também foi apagado. A imagem continua no Docker.\n'
    else
      printf 'Não havia contêiner desse modelo para apagar.\n'
    fi
  fi
}

main() {
  [[ $# -gt 0 ]] || { usage; exit 1; }
  local command="$1"
  shift
  case "$command" in
    examples) cmd_examples "$@" ;;
    build) cmd_build "$@" ;;
    register) cmd_register "$@" ;;
    start) cmd_start "$@" ;;
    stop) cmd_stop "$@" ;;
    status) cmd_status "$@" ;;
    list) cmd_list "$@" ;;
    logs) cmd_logs "$@" ;;
    remove) cmd_remove "$@" ;;
    -h|--help|help) usage ;;
    *) usage; fail "comando desconhecido: ${command}" ;;
  esac
}

main "$@"
