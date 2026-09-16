#!/usr/bin/env python3
"""Contêiner BYOM de referência do Poligome.

Implementa o contrato completo — GET /ping e POST /invocations na porta 8080 —
e devolve um documento COCO já rotulado. Traz dois métodos, escolhidos pela
variável de ambiente METHOD, para mostrar que uma mesma imagem pode servir a
vários modelos registrados:

  otsu       limiar de Otsu; objetos encostados viram uma região só
  watershed  watershed sobre a transformada de distância; separa objetos que
             se tocam em instâncias distintas. SEED_FACTOR ajusta o quanto ele
             insiste em separar

Nenhum dos dois compete com o SAM: existem para ser um molde executável, pequeno
e sem GPU.

Para trocar o modelo, substitua predict() e mantenha o resto: o Poligome só
depende do formato de entrada e do COCO de saída, não do que roda aqui.

Os pesos, quando houver, devem ser lidos de /opt/ml/model, igual ao SageMaker.
"""

from __future__ import annotations

import base64
import binascii
import io
import json
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import cv2
import numpy as np
from PIL import Image

PORT = int(os.environ.get("PORT", "8080"))
MODEL_DIR = os.environ.get("MODEL_DIR", "/opt/ml/model")
MAX_BODY_BYTES = 96 * 1024 * 1024
# Dois métodos no mesmo contêiner mostram que uma imagem pode servir a vários
# modelos registrados: basta subir cada um numa porta com METHOD diferente.
METHOD = os.environ.get("METHOD", "otsu").strip().lower()
# Fração do máximo da transformada de distância que vira semente do watershed.
# O limiar é relativo ao pico da transformada, então o quanto ele tolera de
# sobreposição acompanha o tamanho do objeto — não há um número de pixels que
# valha para qualquer imagem. Medido nesta implementação com dois círculos, a
# maior sobreposição que ainda sai como duas instâncias:
#
#   diâmetro    0,5      0,6      0,8
#     60 px     5 px     5 px    15 px
#     90 px     5 px    10 px    30 px
#    180 px    20 px    30 px   >40 px
#
# Subir o fator separa mais, ao custo de sementes menores, que descartam
# objetos pequenos. 0,6 é o meio-termo.
SEED_FACTOR = float(os.environ.get("SEED_FACTOR", "0.6"))


def _decode_image(value: str) -> np.ndarray:
    if not isinstance(value, str) or not value:
        raise ValueError("o campo image é obrigatório")
    payload = value.split(",", 1)[1] if value.startswith("data:") else value
    try:
        blob = base64.b64decode(payload, validate=True)
    except (binascii.Error, ValueError) as error:
        raise ValueError(f"image não é base64 válido: {error}") from error
    with Image.open(io.BytesIO(blob)) as handle:
        handle.load()
        return np.asarray(handle.convert("RGB"))


MIN_REGION_AREA = 64
MAX_REGIONS = 64
# Um contorno com muitos vértices deixa o SVG do editor pesado sem ganho visual;
# o épsilon é relativo ao perímetro, então acompanha o tamanho da região.
CONTOUR_EPSILON_RATIO = 0.004


def _polygon_from_contour(contour: np.ndarray) -> list[float]:
    perimeter = cv2.arcLength(contour, True)
    simplified = cv2.approxPolyDP(contour, CONTOUR_EPSILON_RATIO * perimeter, True)
    if len(simplified) < 3:
        simplified = contour
    return [float(value) for point in simplified.reshape(-1, 2) for value in point]


def _foreground_mask(image: np.ndarray) -> np.ndarray:
    """Separa objeto de fundo por limiar de Otsu."""
    gray = cv2.cvtColor(image, cv2.COLOR_RGB2GRAY)
    blurred = cv2.GaussianBlur(gray, (5, 5), 0)
    _, binary = cv2.threshold(blurred, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    # O fundo costuma ser a classe majoritária; se ele ficou branco, inverte para
    # que as regiões de interesse sejam sempre o primeiro plano.
    if float(np.count_nonzero(binary)) > binary.size / 2:
        binary = cv2.bitwise_not(binary)
    return binary


def _region_from_contour(contour: np.ndarray, label: str, image: np.ndarray) -> dict | None:
    area = float(cv2.contourArea(contour))
    if area < MIN_REGION_AREA:
        return None
    moments = cv2.moments(contour)
    if moments["m00"] == 0:
        return None
    x, y, width, height = cv2.boundingRect(contour)
    return {
        "label": label,
        "polygon": _polygon_from_contour(contour),
        "bbox": [float(x), float(y), float(width), float(height)],
        "area": area,
        "centroid": (moments["m10"] / moments["m00"], moments["m01"] / moments["m00"]),
        "score": round(min(1.0, area / float(image.shape[0] * image.shape[1])), 4),
    }


def predict_otsu(image: np.ndarray) -> list[dict]:
    """Contornos externos do primeiro plano separado por Otsu.

    Objetos encostados viram uma região só, porque o limiar não sabe onde um
    termina e o outro começa.
    """
    binary = _foreground_mask(image)
    contours, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    regions = []
    for contour in sorted(contours, key=cv2.contourArea, reverse=True)[:MAX_REGIONS]:
        # O exemplo não classifica de verdade; um modelo real devolveria aqui a
        # classe prevista, e é ela que vira o rótulo da anotação no editor.
        region = _region_from_contour(contour, "regiao", image)
        if region:
            regions.append(region)
    return regions


def predict_watershed(image: np.ndarray) -> list[dict]:
    """Watershed sobre a transformada de distância.

    Resolve o que o Otsu não resolve: dois objetos que se tocam viram duas
    instâncias, porque cada máximo da distância vira uma semente própria.
    """
    binary = _foreground_mask(image)
    kernel = np.ones((3, 3), np.uint8)
    opened = cv2.morphologyEx(binary, cv2.MORPH_OPEN, kernel, iterations=2)

    sure_background = cv2.dilate(opened, kernel, iterations=3)
    distance = cv2.distanceTransform(opened, cv2.DIST_L2, 5)
    _, sure_foreground = cv2.threshold(distance, SEED_FACTOR * distance.max(), 255, 0)
    sure_foreground = np.uint8(sure_foreground)
    unknown = cv2.subtract(sure_background, sure_foreground)

    count, markers = cv2.connectedComponents(sure_foreground)
    # O watershed do OpenCV reserva 0 para desconhecido e -1 para as bordas, então
    # os rótulos começam em 1.
    markers = markers + 1
    markers[unknown == 255] = 0
    markers = cv2.watershed(cv2.cvtColor(image, cv2.COLOR_RGB2BGR), markers)

    regions = []
    for marker in range(2, count + 2):
        instance = np.uint8(markers == marker) * 255
        if not instance.any():
            continue
        contours, _ = cv2.findContours(instance, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        for contour in contours:
            region = _region_from_contour(contour, "instancia", image)
            if region:
                regions.append(region)
    regions.sort(key=lambda item: item["area"], reverse=True)
    return regions[:MAX_REGIONS]


METHODS = {"otsu": predict_otsu, "watershed": predict_watershed}


def predict(image: np.ndarray) -> list[dict]:
    """Substitua esta função pelo seu modelo; o contrato é o que está em volta."""
    method = METHODS.get(METHOD)
    if method is None:
        raise ValueError(f"METHOD desconhecido: {METHOD}. Use um de: {', '.join(sorted(METHODS))}.")
    return method(image)


def to_coco(regions: list[dict], file_name: str, width: int, height: int) -> dict:
    """Monta o documento COCO que o Poligome renderiza."""
    labels = []
    for region in regions:
        if region["label"] not in labels:
            labels.append(region["label"])
    categories = [{"id": index + 1, "name": name} for index, name in enumerate(labels)]
    category_ids = {category["name"]: category["id"] for category in categories}

    annotations = []
    for index, region in enumerate(regions):
        centroid_x, centroid_y = region["centroid"]
        annotations.append({
            "id": index + 1,
            "image_id": 1,
            "category_id": category_ids[region["label"]],
            "segmentation": [region["polygon"]],
            "bbox": region["bbox"],
            "area": region["area"],
            "iscrowd": 0,
            "score": region["score"],
            # keypoints usa o formato do COCO: x, y e visibilidade 2.
            "keypoints": [float(centroid_x), float(centroid_y), 2],
            "num_keypoints": 1,
        })

    return {
        "images": [{"id": 1, "file_name": file_name, "width": width, "height": height}],
        "categories": categories,
        "annotations": annotations,
    }


METHOD_METADATA = {
    "otsu": {
        "task": "Segmentação de regiões por limiar global",
        "description": (
            "Converte a imagem para cinza, aplica um desfoque gaussiano e separa objeto de fundo "
            "pelo limiar de Otsu, devolvendo o contorno externo de cada região conectada."
        ),
        "category": "regiao",
        "supercategory": "generico",
        "limitations": (
            "Objetos que se encostam viram uma região só, e imagens com iluminação irregular "
            "confundem o limiar global. Não classifica: todas as regiões saem com a mesma classe."
        ),
        "parameters": {},
    },
    "watershed": {
        "task": "Segmentação de instâncias por watershed",
        "description": (
            "Parte do mesmo primeiro plano do Otsu, calcula a transformada de distância e usa cada "
            "máximo como semente do watershed, então objetos que se tocam viram instâncias separadas."
        ),
        "category": "instancia",
        "supercategory": "generico",
        "limitations": (
            "Herda os limites do Otsu na separação inicial. SEED_FACTOR alto separa mais, mas "
            "encolhe as sementes e descarta objetos pequenos; baixo demais funde instâncias."
        ),
        "parameters": {"SEED_FACTOR": str(SEED_FACTOR)},
    },
}


def metadata() -> dict:
    """Descreve o modelo sem executá-lo.

    O endpoint é opcional no contrato: quando existe, o Poligome usa estes dados
    para explicar na tela o que o contêiner faz e quais classes ele exporta,
    antes da primeira execução.
    """
    entry = METHOD_METADATA.get(METHOD, {})
    return {
        "name": f"Exemplo {METHOD}",
        "task": entry.get("task"),
        "description": entry.get("description"),
        "limitations": entry.get("limitations"),
        "categories": [
            {
                "id": 1,
                "name": entry.get("category", "regiao"),
                "supercategory": entry.get("supercategory", "generico"),
            }
        ],
        "geometry": ["polygon", "bbox", "keypoints"],
        "parameters": entry.get("parameters", {}),
        "min_area_px": MIN_REGION_AREA,
        "max_regions": MAX_REGIONS,
    }


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, fmt: str, *args) -> None:  # o log padrão polui a saída
        sys.stderr.write(f"[byom] {fmt % args}\n")

    def _send_json(self, status: int, payload: dict) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:
        if self.path.rstrip("/") == "/metadata":
            self._send_json(200, metadata())
            return
        if self.path.rstrip("/") == "/ping":
            # 200 significa pronto para receber inferência. Se o seu modelo
            # carrega devagar, responda 503 até terminar de carregar.
            self._send_json(200, {"status": "ok", "method": METHOD, "model_dir": MODEL_DIR})
            return
        self._send_json(404, {"detail": "rota desconhecida"})

    def do_POST(self) -> None:
        if self.path.rstrip("/") != "/invocations":
            self._send_json(404, {"detail": "rota desconhecida"})
            return
        try:
            length = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            self._send_json(400, {"detail": "Content-Length inválido"})
            return
        if length <= 0:
            self._send_json(400, {"detail": "corpo vazio"})
            return
        if length > MAX_BODY_BYTES:
            self._send_json(413, {"detail": "corpo maior que o limite aceito"})
            return

        try:
            payload = json.loads(self.rfile.read(length))
        except ValueError:
            self._send_json(400, {"detail": "corpo não é JSON válido"})
            return

        try:
            image = _decode_image(payload.get("image"))
            file_name = str(payload.get("file_name") or "imagem.png")[:256]
            regions = predict(image)
        except ValueError as error:
            self._send_json(400, {"detail": str(error)})
            return
        except Exception as error:  # falha do modelo não deve derrubar o servidor
            self.log_message("erro na inferência: %s: %s", type(error).__name__, error)
            self._send_json(500, {"detail": f"{type(error).__name__}: {error}"})
            return

        height, width = image.shape[:2]
        self._send_json(200, to_coco(regions, file_name, int(width), int(height)))


def main() -> None:
    if len(sys.argv) > 1 and sys.argv[1] != "serve":
        raise SystemExit(f"comando não suportado: {sys.argv[1]}; use 'serve'")
    if METHOD not in METHODS:
        raise SystemExit(f"METHOD desconhecido: {METHOD}. Use um de: {', '.join(sorted(METHODS))}.")
    print(
        f"[byom] exemplo ouvindo em 0.0.0.0:{PORT}; metodo={METHOD}; pesos esperados em {MODEL_DIR}",
        flush=True,
    )
    ThreadingHTTPServer(("0.0.0.0", PORT), Handler).serve_forever()


if __name__ == "__main__":
    main()
