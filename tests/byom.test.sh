#!/usr/bin/env bash
set -euo pipefail

# Exercita o contrato BYOM sem Docker e sem rede externa: o contêiner é
# substituído por um servidor local que fala o mesmo protocolo, e o docker por
# um dublê. Assim o teste roda em qualquer máquina, inclusive em CI.

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CLI="${PROJECT_ROOT}/public/poligome-byom-macos-linux.sh"
SERVE="${PROJECT_ROOT}/public/byom/serve.py"
DOCKERFILE="${PROJECT_ROOT}/public/byom/Dockerfile"
CONNECTOR="${PROJECT_ROOT}/public/poligome-sam-local.py"

TEMP_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/poligome-byom-tests.XXXXXX")"
STUB_PID=""
cleanup() {
  [[ -n "$STUB_PID" ]] && kill "$STUB_PID" >/dev/null 2>&1 || true
  rm -rf -- "$TEMP_ROOT"
}
trap cleanup EXIT HUP INT TERM

fail() {
  printf 'not ok - %s\n' "$*" >&2
  exit 1
}

pass() {
  printf 'ok - %s\n' "$*"
}

assert_contains() {
  case "$1" in
    *"$2"*) ;;
    *) fail "$3: trecho ausente: $2" ;;
  esac
}

PYTHON="$(command -v python3)" || fail "python3 é necessário para os testes do BYOM."

# O exemplo precisa de OpenCV, NumPy e Pillow. Fora de um ambiente preparado o
# python3 do sistema não os tem, então o teste procura um interpretador capaz
# entre os venvs que os instaladores criam e, se não achar, pula em vez de
# fingir que passou.
find_capable_python() {
  local candidate
  for candidate in \
    "$PYTHON" \
    "${POLIGOME_APP_DIR:-${HOME}/.poligome-sam}/venvs/sam2/bin/python"; do
    if [[ -x "$candidate" ]] &&
      "$candidate" -c 'import cv2, numpy; from PIL import Image' >/dev/null 2>&1; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  return 1
}

test_syntax() {
  bash -n "$CLI" || fail "a CLI do BYOM tem sintaxe inválida."
  "$PYTHON" -c "import ast,sys; ast.parse(open(sys.argv[1], encoding='utf-8').read())" "$SERVE" ||
    fail "serve.py tem sintaxe inválida."
  "$PYTHON" -c "import ast,sys; ast.parse(open(sys.argv[1], encoding='utf-8').read())" "$CONNECTOR" ||
    fail "o conector tem sintaxe inválida."
  pass "sintaxe da CLI, do exemplo e do conector"
}

test_dockerfile_contract() {
  local content
  content="$(cat "$DOCKERFILE")"
  assert_contains "$content" "EXPOSE 8080" "porta do contrato no Dockerfile"
  assert_contains "$content" 'CMD ["serve"]' "comando serve no Dockerfile"
  assert_contains "$content" "/opt/ml/model" "diretório de pesos do SageMaker no Dockerfile"
  # Sem digest, a tag 3.12-slim é reescrita e uma reconstrução futura daria outra
  # imagem. É o digest que faz o exemplo continuar existindo igual sem versionar
  # centenas de megabytes de tarball.
  case "$content" in
    *"FROM python:3.12-slim@sha256:"*) ;;
    *) fail "a imagem base do exemplo precisa estar fixada por digest, não só pela tag" ;;
  esac
  pass "Dockerfile de exemplo declara porta, comando serve, /opt/ml/model e base fixada por digest"
}

# Sobe o serve.py de exemplo direto, sem contêiner: o contrato é o mesmo.
start_stub_container() {
  local port="$1"
  PORT="$port" METHOD="${METHOD:-otsu}" "$CAPABLE_PYTHON" "$SERVE" serve >"${TEMP_ROOT}/stub.log" 2>&1 &
  STUB_PID=$!
  local attempt
  for attempt in $(seq 1 60); do
    if [[ "$(curl -s -o /dev/null -w '%{http_code}' --max-time 2 "http://127.0.0.1:${port}/ping" 2>/dev/null)" == "200" ]]; then
      return 0
    fi
    kill -0 "$STUB_PID" >/dev/null 2>&1 || fail "o exemplo encerrou antes de ficar pronto: $(cat "${TEMP_ROOT}/stub.log")"
    sleep 1
  done
  fail "o exemplo não respondeu /ping em 60s."
}

free_port() {
  "$PYTHON" - <<'PY'
import socket
with socket.socket() as probe:
    probe.bind(("127.0.0.1", 0))
    print(probe.getsockname()[1])
PY
}

test_contract_roundtrip() {
  if ! CAPABLE_PYTHON="$(find_capable_python)"; then
    printf 'ok - # SKIP contrato /invocations: nenhum Python com OpenCV, NumPy e Pillow disponível\n'
    return 0
  fi
  local port
  port="$(free_port)"
  start_stub_container "$port"

  local result
  result="$("$CAPABLE_PYTHON" - "$port" <<'PY'
import base64, io, json, sys, urllib.error, urllib.request
from PIL import Image, ImageDraw

port = sys.argv[1]
image = Image.new("RGB", (200, 160), (18, 20, 30))
drawing = ImageDraw.Draw(image)
drawing.ellipse([20, 20, 80, 80], fill=(235, 200, 90))
drawing.rectangle([110, 40, 180, 130], fill=(210, 220, 240))
buffer = io.BytesIO()
image.save(buffer, format="PNG")
data_url = "data:image/png;base64," + base64.b64encode(buffer.getvalue()).decode()


def call(body):
    request = urllib.request.Request(
        f"http://127.0.0.1:{port}/invocations",
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            return response.status, json.load(response)
    except urllib.error.HTTPError as error:
        return error.code, json.load(error)


status, document = call({"image": data_url, "file_name": "amostra.png", "width": 200, "height": 160})
assert status == 200, f"inferencia devolveu {status}"
for key in ("images", "categories", "annotations"):
    assert key in document, f"COCO sem a chave {key}"
assert document["images"][0]["file_name"] == "amostra.png", "file_name nao foi devolvido"
assert document["images"][0]["width"] == 200 and document["images"][0]["height"] == 160
assert document["annotations"], "nenhuma anotacao para uma imagem com duas formas"
assert document["categories"], "COCO sem categorias"

category_ids = {category["id"] for category in document["categories"]}
for annotation in document["annotations"]:
    assert annotation["category_id"] in category_ids, "category_id fora das categorias declaradas"
    polygon = annotation["segmentation"][0]
    assert len(polygon) >= 6 and len(polygon) % 2 == 0, "poligono invalido"
    assert max(polygon[0::2]) <= 200 and max(polygon[1::2]) <= 160, "poligono fora da imagem"
    assert len(annotation["bbox"]) == 4, "bbox invalida"
    assert len(annotation["keypoints"]) == 3, "keypoints fora do formato COCO"
    assert annotation["keypoints"][2] == 2, "visibilidade do keypoint deveria ser 2"

status, payload = call({})
assert status == 400, f"sem imagem devolveu {status}"
assert payload.get("detail"), "erro sem campo detail"

print("ok")
PY
)" || fail "o teste de contrato falhou."
  [[ "$result" == *ok* ]] || fail "o teste de contrato nao confirmou: ${result}"

  kill "$STUB_PID" >/dev/null 2>&1 || true
  STUB_PID=""
  pass "contrato /ping e /invocations devolve COCO com poligono, caixa e ponto"
}

test_methods_and_metadata() {
  if ! CAPABLE_PYTHON="$(find_capable_python)"; then
    printf 'ok - # SKIP metodos e /metadata: nenhum Python com OpenCV, NumPy e Pillow disponivel\n'
    return 0
  fi
  local port
  port="$(free_port)"
  METHOD=watershed start_stub_container "$port"

  local result
  result="$("$CAPABLE_PYTHON" - "$port" <<'METODO'
import base64, io, json, sys, urllib.request
from PIL import Image, ImageDraw

port = sys.argv[1]

with urllib.request.urlopen(f"http://127.0.0.1:{port}/metadata", timeout=30) as response:
    assert response.status == 200, "metadata deveria responder 200"
    document = json.load(response)
assert document["categories"], "/metadata sem categorias"
assert document["categories"][0]["name"] == "instancia", "watershed deveria rotular instancia"
assert set(document["geometry"]) == {"polygon", "bbox", "keypoints"}, "geometria declarada incompleta"
assert document["description"], "/metadata sem descricao"

# Dois circulos que se encostam: o caso que separa watershed de Otsu.
image = Image.new("RGB", (320, 200), (16, 18, 28))
drawing = ImageDraw.Draw(image)
drawing.ellipse([50, 50, 170, 170], fill=(235, 200, 95))
drawing.ellipse([165, 50, 285, 170], fill=(235, 200, 95))
buffer = io.BytesIO()
image.save(buffer, format="PNG")
data_url = "data:image/png;base64," + base64.b64encode(buffer.getvalue()).decode()

request = urllib.request.Request(
    f"http://127.0.0.1:{port}/invocations",
    data=json.dumps({"image": data_url, "file_name": "duas.png", "width": 320, "height": 200}).encode(),
    headers={"Content-Type": "application/json"},
    method="POST",
)
with urllib.request.urlopen(request, timeout=120) as response:
    coco = json.load(response)
count = len(coco["annotations"])
assert count == 2, f"watershed deveria separar em 2 instancias, veio {count}"
print("ok")
METODO
)" || fail "o teste de metodos falhou."
  [[ "$result" == *ok* ]] || fail "o teste de metodos nao confirmou: ${result}"

  kill "$STUB_PID" >/dev/null 2>&1 || true
  STUB_PID=""
  pass "METHOD=watershed separa objetos encostados e /metadata descreve as classes"
}

test_shipped_examples() {
  local dir="${PROJECT_ROOT}/public/byom/examples"
  [[ -d "$dir" ]] || fail "os exemplos oficiais sumiram de public/byom/examples."

  local expected=(byom-otsu byom-watershed)
  local name
  for name in "${expected[@]}"; do
    [[ -f "${dir}/${name}.json" ]] || fail "o exemplo ${name}.json não está versionado."
  done

  # Os registros versionados precisam obedecer às mesmas regras do conector, ou
  # instalá-los deixaria a lista com entradas que ele recusa em silêncio.
  "$PYTHON" - "$dir" "$CLI" <<'EXEMPLOS'
import json, pathlib, re, sys

directory = pathlib.Path(sys.argv[1])
cli = pathlib.Path(sys.argv[2]).read_text(encoding="utf-8")
pattern = re.compile(r"^byom-[a-z0-9][a-z0-9._-]{0,62}$")

ports = {}
for path in sorted(directory.glob("*.json")):
    document = json.loads(path.read_text(encoding="utf-8"))
    model_id = document["model_id"]
    assert pattern.fullmatch(model_id), f"id invalido: {model_id}"
    assert path.stem == model_id, f"{path.name} nao casa com o model_id {model_id}"
    endpoint = document["endpoint"]
    assert re.fullmatch(r"http://127\.0\.0\.1:\d{1,5}", endpoint), f"endpoint invalido: {endpoint}"
    port = endpoint.rsplit(":", 1)[1]
    assert port not in ports, f"porta {port} repetida entre {ports[port]} e {model_id}"
    ports[port] = model_id
    assert document.get("notes"), f"{model_id} sem anotacao explicando o exemplo"
    assert document.get("env"), f"{model_id} sem env; os dois exemplos saem da mesma imagem"
    assert document["image"] in cli, f"a imagem {document['image']} nao e a que a CLI constroi"

assert len(ports) >= 2, "os exemplos precisam de portas distintas para rodarem juntos"
EXEMPLOS

  # O comando examples precisa continuar existindo, senão os arquivos versionados
  # viram documentação morta.
  assert_contains "$(cat "$CLI")" "cmd_examples()" "comando examples na CLI"
  assert_contains "$(cat "$CLI")" "examples) cmd_examples" "roteamento do comando examples"
  pass "exemplos oficiais versionados, com portas distintas e instaláveis pela CLI"
}

# Dublê de docker: aceita inspect e build, para exercitar register sem Docker.
install_docker_stub() {
  local bin_dir="${TEMP_ROOT}/bin"
  mkdir -p "$bin_dir"
  cat >"${bin_dir}/docker" <<'STUB'
#!/usr/bin/env bash
case "$1" in
  info) exit 0 ;;
  image) exit 0 ;;
  ps) printf '' ;;
  *) exit 0 ;;
esac
STUB
  chmod +x "${bin_dir}/docker"
  printf '%s\n' "$bin_dir"
}

test_registration() {
  local app_dir="${TEMP_ROOT}/app"
  local bin_dir
  bin_dir="$(install_docker_stub)"
  mkdir -p "$app_dir"

  local output
  output="$(PATH="${bin_dir}:${PATH}" POLIGOME_APP_DIR="$app_dir" \
    bash "$CLI" register --model-id byom-teste --image imagem-teste --name "Teste" 2>&1)" ||
    fail "register falhou: ${output}"
  local registration="${app_dir}/byom/byom-teste.json"
  [[ -f "$registration" ]] || fail "register não gravou ${registration}"
  local content
  content="$(cat "$registration")"
  assert_contains "$content" '"model_id": "byom-teste"' "model_id no registro"
  assert_contains "$content" '"endpoint": "http://127.0.0.1:8080"' "endpoint local no registro"

  # IDs sem o prefixo byom- precisam ser recusados, senão colidiriam com o catálogo.
  if PATH="${bin_dir}:${PATH}" POLIGOME_APP_DIR="$app_dir" \
    bash "$CLI" register --model-id sam2.1-hiera-small --image imagem-teste >/dev/null 2>&1; then
    fail "register aceitou um id fora do espaço byom-"
  fi

  output="$(PATH="${bin_dir}:${PATH}" POLIGOME_APP_DIR="$app_dir" bash "$CLI" list 2>&1)"
  assert_contains "$output" "byom-teste" "list mostra o modelo registrado"

  output="$(PATH="${bin_dir}:${PATH}" POLIGOME_APP_DIR="$app_dir" bash "$CLI" remove --model-id byom-teste 2>&1)"
  [[ ! -f "$registration" ]] || fail "remove não apagou o registro"
  pass "register valida o id, e list e remove operam o registro"
}

test_connector_registry() {
  local app_dir="${TEMP_ROOT}/registry"
  mkdir -p "${app_dir}/byom"
  cat >"${app_dir}/byom/byom-valido.json" <<'JSON'
{"model_id": "byom-valido", "name": "Válido", "image": "img", "endpoint": "http://127.0.0.1:8081"}
JSON
  cat >"${app_dir}/byom/byom-remoto.json" <<'JSON'
{"model_id": "byom-remoto", "name": "Remoto", "image": "img", "endpoint": "http://exemplo.com:8080"}
JSON
  cat >"${app_dir}/byom/byom-quebrado.json" <<'JSON'
{ isto nao e json
JSON

  local registry_python
  registry_python="$(find_capable_python)" || registry_python="$PYTHON"

  local output
  output="$("$registry_python" - "$CONNECTOR" "$app_dir" <<'PY'
import importlib.util, os, sys
from pathlib import Path

# O conector importa cv2, numpy e fastapi; sem eles o teste apenas relata.
try:
    spec = importlib.util.spec_from_file_location("connector", sys.argv[1])
    module = importlib.util.module_from_spec(spec)
    # @dataclass resolve o modulo pelo sys.modules durante a execucao, entao o
    # registro precisa vir antes do exec_module.
    sys.modules["connector"] = module
    spec.loader.exec_module(module)
except ImportError as error:
    print(f"skip {error}")
    raise SystemExit(0)

module._app_dir = Path(sys.argv[2])
found = module.byom_registrations()
assert "byom-valido" in found, "registro válido não foi lido"
assert "byom-remoto" not in found, "endpoint remoto deveria ser recusado"
assert "byom-quebrado" not in found, "JSON inválido deveria ser ignorado"
assert found["byom-valido"].endpoint == "http://127.0.0.1:8081"
assert found["byom-valido"].name == "Válido"
# BYOM não entra no catálogo de troca do SAM: são caminhos separados.
assert "byom-valido" not in module.MODEL_SPECS, "BYOM não deveria entrar no catálogo do SAM"
print("ok")
PY
)" || fail "a leitura do registro pelo conector falhou: ${output}"
  output="$(printf '%s\n' "$output" | tail -n 1)"
  case "$output" in
    ok*) pass "conector lê registros válidos e recusa endpoint remoto e JSON quebrado" ;;
    skip*) printf 'ok - # SKIP conector sem dependências instaladas (%s)\n' "${output#skip }" ;;
    *) fail "resultado inesperado do conector: ${output}" ;;
  esac
}

test_catalog_alignment() {
  local models_ts="${PROJECT_ROOT}/app/lib/sam-models.ts"
  local content
  content="$(cat "$models_ts")"
  assert_contains "$content" 'BYOM_MODEL_ID_PATTERN' "padrão de id BYOM no catálogo"
  assert_contains "$content" 'export type ByomModel' "tipo do modelo BYOM anunciado pelo conector"
  # O padrão do catálogo e o do conector precisam aceitar exatamente os mesmos ids.
  "$PYTHON" - "$models_ts" "$CONNECTOR" <<'PY'
import re, sys

catalog = open(sys.argv[1], encoding="utf-8").read()
connector = open(sys.argv[2], encoding="utf-8").read()
ts = re.search(r"BYOM_MODEL_ID_PATTERN = /\^(.+)\$/;", catalog).group(1)
py = re.search(r'BYOM_ID_PATTERN = re\.compile\(r"\^(.+)\$"\)', connector).group(1)
assert ts == py, f"padrões divergentes: TypeScript {ts!r} vs Python {py!r}"
PY
  pass "catálogo e conector aceitam o mesmo formato de id BYOM"
}

test_syntax
test_dockerfile_contract
test_contract_roundtrip
test_methods_and_metadata
test_shipped_examples
test_registration
test_connector_registry
test_catalog_alignment

printf '\nTodos os testes locais do BYOM passaram.\n'
