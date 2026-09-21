#!/usr/bin/env python3
"""Conector local multi-engine do SAM para o Poligome (SAM 2.1 e SAM 3).

O conector nunca baixa modelos nem instala pacotes. Forneça um checkpoint local
obtido da fonte oficial do modelo escolhido.

Exemplos:
  python poligome-sam-local.py --model sam2.1-hiera-small \
    --checkpoint sam2.1_hiera_small.pt
  python poligome-sam-local.py --model sam3-concepts --checkpoint sam3.pt --device cuda
"""

from __future__ import annotations

import argparse
import asyncio
import base64
import binascii
import contextlib
import hashlib
import io
import json
import math
import os
import re
import sys
import threading
import warnings
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol

if sys.version_info < (3, 10):
    raise SystemExit(
        "Poligome SAM requer Python 3.10 ou mais novo; "
        f"esta execução usa Python {sys.version_info.major}.{sys.version_info.minor}."
    )

import cv2
import numpy as np
import uvicorn
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field
from PIL import Image, ImageOps, UnidentifiedImageError


SERVICE_NAME = "Poligome SAM local"
API_VERSION = 2
# Código com que o conector sai, no Windows, para pedir ao lançador que o suba de
# novo no venv da outra família. Ver _exec_with_model: lá o execv não serve.
SWITCH_EXIT_CODE = 75
MAX_IMAGE_BYTES = 64 * 1024 * 1024
MAX_DATA_URL_LENGTH = ((MAX_IMAGE_BYTES + 2) // 3 * 4) + 4096
MAX_IMAGE_DIMENSION = 32_768
MAX_POINT_PROMPTS = 256
MAX_TEXT_LENGTH = 512
MAX_CLIENT_ID_LENGTH = 128
MAX_REQUEST_BODY_BYTES = MAX_DATA_URL_LENGTH + 1024 * 1024


def _bounded_env_int(
    name: str,
    default: int,
    *,
    minimum: int,
    maximum: int,
) -> int:
    raw_value = os.environ.get(name, "").strip()
    if not raw_value:
        return default
    try:
        value = int(raw_value)
    except ValueError as error:
        raise SystemExit(f"{name} deve ser um número inteiro.") from error
    if value < minimum or value > maximum:
        raise SystemExit(f"{name} deve estar entre {minimum} e {maximum}.")
    return value


def _bounded_env_float(
    name: str,
    default: float,
    *,
    minimum: float,
    maximum: float,
) -> float:
    raw_value = os.environ.get(name, "").strip()
    if not raw_value:
        return default
    try:
        value = float(raw_value)
    except ValueError as error:
        raise SystemExit(f"{name} deve ser um número.") from error
    if not math.isfinite(value) or value < minimum or value > maximum:
        raise SystemExit(f"{name} deve estar entre {minimum} e {maximum}.")
    return value


MAX_IMAGE_PIXELS = _bounded_env_int(
    "POLIGOME_MAX_IMAGE_PIXELS",
    16_000_000,
    minimum=1_000_000,
    maximum=100_000_000,
)
MAX_CONCURRENT_PREDICTION_REQUESTS = _bounded_env_int(
    "POLIGOME_MAX_CONCURRENT_REQUESTS",
    4,
    minimum=1,
    maximum=16,
)
MAX_SAM3_PREDICTIONS = _bounded_env_int(
    "POLIGOME_SAM3_MAX_PREDICTIONS",
    64,
    minimum=1,
    maximum=512,
)
MIN_SAM3_CONCEPT_THRESHOLD = _bounded_env_float(
    "POLIGOME_SAM3_MIN_CONCEPT_THRESHOLD",
    0.1,
    minimum=0.01,
    maximum=0.95,
)
DEFAULT_ALLOWED_ORIGINS = (
    # Os dois nomes do site são o mesmo site. Aceitar só um deles devolve 403 a
    # quem digitou o outro, e a mensagem que chega ao editor é indistinguível de
    # um conector fora do ar.
    "https://poligome.com",
    "https://www.poligome.com",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
)


@dataclass(frozen=True)
class ModelSpec:
    model_id: str
    family: str
    model_type: str
    checkpoint_name: str
    capabilities: tuple[str, ...]
    default_config: str | None = None


COMMON_CAPABILITIES = ("point", "negative_point", "box", "multimask")
MODEL_SPECS = {
    "sam2.1-hiera-tiny": ModelSpec(
        "sam2.1-hiera-tiny",
        "sam2",
        "hiera_tiny",
        "sam2.1_hiera_tiny.pt",
        COMMON_CAPABILITIES,
        "configs/sam2.1/sam2.1_hiera_t.yaml",
    ),
    "sam2.1-hiera-small": ModelSpec(
        "sam2.1-hiera-small",
        "sam2",
        "hiera_small",
        "sam2.1_hiera_small.pt",
        COMMON_CAPABILITIES,
        "configs/sam2.1/sam2.1_hiera_s.yaml",
    ),
    "sam2.1-hiera-base-plus": ModelSpec(
        "sam2.1-hiera-base-plus",
        "sam2",
        "hiera_base_plus",
        "sam2.1_hiera_base_plus.pt",
        COMMON_CAPABILITIES,
        "configs/sam2.1/sam2.1_hiera_b+.yaml",
    ),
    "sam2.1-hiera-large": ModelSpec(
        "sam2.1-hiera-large",
        "sam2",
        "hiera_large",
        "sam2.1_hiera_large.pt",
        COMMON_CAPABILITIES,
        "configs/sam2.1/sam2.1_hiera_l.yaml",
    ),
    "medsam2-latest": ModelSpec(
        "medsam2-latest",
        "sam2",
        "hiera_tiny",
        "MedSAM2_latest.pt",
        COMMON_CAPABILITIES,
        "configs/sam2.1/sam2.1_hiera_t.yaml",
    ),
    # Os ajustes finos por modalidade partem do mesmo SAM 2.1 Hiera Tiny, então
    # mudam apenas o arquivo de pesos e reaproveitam o config oficial.
    "medsam2-ct-lesion": ModelSpec(
        "medsam2-ct-lesion",
        "sam2",
        "hiera_tiny",
        "MedSAM2_CTLesion.pt",
        COMMON_CAPABILITIES,
        "configs/sam2.1/sam2.1_hiera_t.yaml",
    ),
    "medsam2-mri-liver-lesion": ModelSpec(
        "medsam2-mri-liver-lesion",
        "sam2",
        "hiera_tiny",
        "MedSAM2_MRI_LiverLesion.pt",
        COMMON_CAPABILITIES,
        "configs/sam2.1/sam2.1_hiera_t.yaml",
    ),
    "medsam2-us-heart": ModelSpec(
        "medsam2-us-heart",
        "sam2",
        "hiera_tiny",
        "MedSAM2_US_Heart.pt",
        COMMON_CAPABILITIES,
        "configs/sam2.1/sam2.1_hiera_t.yaml",
    ),
    "medsam2-2411": ModelSpec(
        "medsam2-2411",
        "sam2",
        "hiera_tiny",
        "MedSAM2_2411.pt",
        COMMON_CAPABILITIES,
        "configs/sam2.1/sam2.1_hiera_t.yaml",
    ),
    "sam3-concepts": ModelSpec(
        "sam3-concepts",
        "sam3",
        "sam3",
        "sam3.pt",
        (*COMMON_CAPABILITIES, "text", "box_exemplar"),
    ),
}
MODEL_ALIASES = {
    "sam3": "sam3-concepts",
    "medsam2": "medsam2-latest",
    "medsam2-ct": "medsam2-ct-lesion",
    "medsam2-mri": "medsam2-mri-liver-lesion",
    "medsam2-us": "medsam2-us-heart",
}

# ---------------------------------------------------------------------------
# BYOM: modelos em contêiner trazidos pelo usuário
#
# O propósito é diferente do SAM. Aqui não há prompt: o contêiner recebe a
# imagem inteira e devolve um documento COCO já rotulado, com máscaras, caixas
# ou pontos, que o editor renderiza como anotações prontas para revisão.
#
# O empacotamento imita o do SageMaker para reaproveitar contêineres existentes:
# a imagem sobe com `serve`, escuta na porta 8080, responde GET /ping quando está
# pronta e recebe a inferência em POST /invocations. Os pesos ficam em
# /opt/ml/model.
#
# Cada modelo registrado vira um arquivo JSON em ~/.poligome-sam/byom/<id>.json,
# então o conjunto cresce sem recompilar o conector. O conector nunca carrega o
# modelo: ele apenas encaminha para o contêiner e valida a resposta, de modo que
# BYOM não participa da troca de modelos do SAM.
# ---------------------------------------------------------------------------

BYOM_FAMILY = "byom"
BYOM_ID_PATTERN = re.compile(r"^byom-[a-z0-9][a-z0-9._-]{0,62}$")
BYOM_CONTAINER_PORT = 8080
BYOM_PING_TIMEOUT_SECONDS = _bounded_env_float(
    "POLIGOME_BYOM_PING_TIMEOUT",
    5.0,
    minimum=0.5,
    maximum=60.0,
)
BYOM_INVOCATION_TIMEOUT_SECONDS = _bounded_env_float(
    "POLIGOME_BYOM_INVOCATION_TIMEOUT",
    300.0,
    minimum=1.0,
    maximum=3600.0,
)
BYOM_MAX_ANNOTATIONS = _bounded_env_int(
    "POLIGOME_BYOM_MAX_ANNOTATIONS",
    5_000,
    minimum=1,
    maximum=100_000,
)
BYOM_MAX_RESPONSE_BYTES = 128 * 1024 * 1024

# O contêiner do BYOM está sempre em 127.0.0.1, mas o urllib lê http_proxy do
# ambiente e só isenta um host quando no_proxy o nomeia. Numa máquina com proxy
# corporativo configurado e sem no_proxy, /ping e /invocations sairiam para o
# proxy: o contêiner apareceria como parado e a imagem do usuário deixaria a
# máquina — exatamente o contrário do que o Poligome promete. Um opener com
# ProxyHandler vazio ignora essas variáveis, como o instalador já faz ao
# consultar /health.
_LOCAL_OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))


@dataclass(frozen=True)
class ByomRegistration:
    """Um modelo em contêiner declarado pelo usuário."""

    model_id: str
    name: str
    endpoint: str
    image: str
    # Comentário livre de quem registrou: para que serve, em que dataset foi
    # treinado, o que revisar com atenção.
    notes: str
    # O que a última execução devolveu, guardado para explicar o modelo sem
    # precisar rodá-lo de novo.
    last_run: dict[str, Any] | None
    env: dict[str, str]


def _byom_registry_dir() -> Path:
    return _app_dir / "byom"


def _parse_byom_registration(path: Path) -> ByomRegistration:
    """Lê um registro do disco, recusando o que não dá para usar."""
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError) as error:
        raise ValueError(f"registro ilegível: {error}") from error
    if not isinstance(raw, dict):
        raise ValueError("o registro precisa ser um objeto JSON")

    model_id = str(raw.get("model_id") or path.stem).strip().lower()
    if not BYOM_ID_PATTERN.fullmatch(model_id):
        raise ValueError(
            f"model_id inválido: {model_id!r}. Use o prefixo byom- seguido de letras, "
            "números, ponto, hífen ou sublinhado."
        )
    if model_id in MODEL_SPECS or model_id in MODEL_ALIASES:
        raise ValueError(f"model_id {model_id!r} colide com um modelo oficial")

    endpoint = str(raw.get("endpoint") or "").strip().rstrip("/")
    if not endpoint:
        endpoint = f"http://127.0.0.1:{BYOM_CONTAINER_PORT}"
    # O conector só fala com contêineres locais: um endpoint remoto tiraria as
    # imagens da máquina do usuário, que é justamente o que o Poligome promete
    # não fazer.
    if not re.fullmatch(r"http://(127\.0\.0\.1|localhost)(:\d{1,5})?", endpoint):
        raise ValueError(
            f"endpoint inválido: {endpoint!r}. Só é aceito http://127.0.0.1:<porta> "
            "ou http://localhost:<porta>, porque a inferência precisa ficar local."
        )

    raw_env = raw.get("env")
    env = (
        {str(key): str(value) for key, value in raw_env.items()}
        if isinstance(raw_env, dict)
        else {}
    )
    last_run = raw.get("last_run") if isinstance(raw.get("last_run"), dict) else None
    return ByomRegistration(
        model_id=model_id,
        name=str(raw.get("name") or model_id).strip()[:120],
        endpoint=endpoint,
        image=str(raw.get("image") or "").strip()[:200],
        notes=str(raw.get("notes") or "").strip()[:2000],
        last_run=last_run,
        env=env,
    )


def byom_registrations() -> dict[str, ByomRegistration]:
    """Registros válidos, em ordem estável. Um arquivo quebrado não derruba os outros."""
    registry = _byom_registry_dir()
    found: dict[str, ByomRegistration] = {}
    try:
        paths = sorted(registry.glob("*.json"))
    except OSError:
        return found
    for path in paths:
        try:
            registration = _parse_byom_registration(path)
        except ValueError as error:
            # Diagnóstico vai para stderr: stdout do conector é lido por
            # scripts que esperam apenas as mensagens de estado.
            print(f"Aviso: ignorando {path.name}: {error}", file=sys.stderr, flush=True)
            continue
        found[registration.model_id] = registration
    return found


def _byom_container_ready(registration: ByomRegistration) -> tuple[bool, str | None]:
    request = urllib.request.Request(f"{registration.endpoint}/ping", method="GET")
    try:
        with _LOCAL_OPENER.open(request, timeout=BYOM_PING_TIMEOUT_SECONDS) as response:
            if response.status != 200:
                return False, f"o contêiner respondeu HTTP {response.status} em /ping"
    except urllib.error.HTTPError as error:
        return False, f"o contêiner respondeu HTTP {error.code} em /ping"
    except (urllib.error.URLError, OSError, TimeoutError) as error:
        return False, f"o contêiner não respondeu em {registration.endpoint}: {error}"
    return True, None


def _byom_metadata(registration: ByomRegistration) -> dict[str, Any] | None:
    """Lê GET /metadata, que é opcional no contrato.

    Um contêiner que o implementa consegue explicar suas classes sem ser
    executado; um que não implementa simplesmente não descreve nada, e a
    interface cai no resumo da última execução.
    """
    request = urllib.request.Request(f"{registration.endpoint}/metadata", method="GET")
    try:
        with _LOCAL_OPENER.open(request, timeout=BYOM_PING_TIMEOUT_SECONDS) as response:
            if response.status != 200:
                return None
            raw = response.read(1024 * 1024)
    except (urllib.error.URLError, urllib.error.HTTPError, OSError, TimeoutError, ValueError):
        return None
    try:
        document = json.loads(raw)
    except ValueError:
        return None
    if not isinstance(document, dict):
        return None

    categories = document.get("categories")
    named = []
    if isinstance(categories, list):
        for entry in categories[:200]:
            if isinstance(entry, dict) and isinstance(entry.get("name"), str):
                named.append(entry["name"].strip()[:120])
            elif isinstance(entry, str):
                named.append(entry.strip()[:120])
    geometry = document.get("geometry")
    parameters = document.get("parameters")
    return {
        "task": str(document.get("task") or "").strip()[:200] or None,
        "description": str(document.get("description") or "").strip()[:1000] or None,
        "limitations": str(document.get("limitations") or "").strip()[:1000] or None,
        "categories": named,
        "geometry": [str(item)[:32] for item in geometry[:8]] if isinstance(geometry, list) else [],
        "parameters": (
            {str(key)[:64]: str(value)[:120] for key, value in list(parameters.items())[:20]}
            if isinstance(parameters, dict)
            else {}
        ),
    }


def _byom_invoke(registration: ByomRegistration, payload: dict[str, Any]) -> Any:
    body = json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        f"{registration.endpoint}/invocations",
        data=body,
        headers={"Content-Type": "application/json", "Accept": "application/json"},
        method="POST",
    )
    try:
        with _LOCAL_OPENER.open(request, timeout=BYOM_INVOCATION_TIMEOUT_SECONDS) as response:
            raw = response.read(BYOM_MAX_RESPONSE_BYTES + 1)
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", "replace")[:500]
        raise RuntimeError(f"/invocations respondeu HTTP {error.code}: {detail}") from error
    except (urllib.error.URLError, OSError, TimeoutError) as error:
        raise RuntimeError(f"/invocations falhou: {error}") from error
    if len(raw) > BYOM_MAX_RESPONSE_BYTES:
        raise RuntimeError("a resposta do contêiner excedeu o tamanho máximo aceito.")
    try:
        return json.loads(raw)
    except ValueError as error:
        raise RuntimeError("/invocations não devolveu JSON válido.") from error


def _summarize_run(document: dict[str, Any]) -> dict[str, Any]:
    """Resume o que o modelo devolveu, para explicá-lo sem rodá-lo de novo."""
    annotations = document.get("annotations") or []
    names = []
    for category in document.get("categories") or []:
        if isinstance(category, dict) and isinstance(category.get("name"), str):
            name = category["name"].strip()
            if name and name not in names:
                names.append(name)
    geometry = []
    for key, kind in (("segmentation", "polygon"), ("bbox", "bbox"), ("keypoints", "keypoints")):
        if any(isinstance(item, dict) and isinstance(item.get(key), list) for item in annotations):
            geometry.append(kind)
    return {
        "annotations": len(annotations),
        "categories": names[:200],
        "geometry": geometry,
    }


def _record_byom_run(registration: ByomRegistration, summary: dict[str, Any]) -> None:
    target = _byom_registry_dir() / f"{registration.model_id}.json"
    try:
        document = json.loads(target.read_text(encoding="utf-8"))
        if not isinstance(document, dict):
            return
        document["last_run"] = summary
        partial = target.with_suffix(".json.part")
        partial.write_text(json.dumps(document, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        partial.replace(target)
    except (OSError, ValueError) as error:
        # Não conseguir gravar o resumo não invalida a anotação já produzida.
        print(f"Aviso: não foi possível registrar o resumo de {registration.model_id}: {error}",
              file=sys.stderr, flush=True)


def _is_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def _polygon_rings(segmentation: Any) -> list[list[Any]]:
    """As listas que o editor leria como contorno, no mesmo critério dele.

    O importador aceita tanto `[x, y, ...]` solto quanto uma lista de anéis, e
    descarta o que não fecha três pontos. Repetir o critério aqui é o que faz
    "o conector aceitou" significar "o editor desenha".
    """
    if not isinstance(segmentation, list) or not segmentation:
        return []
    if all(_is_number(item) for item in segmentation):
        return [segmentation]
    return [ring for ring in segmentation if isinstance(ring, list)]


def _has_drawable_polygon(segmentation: Any) -> bool:
    rings = _polygon_rings(segmentation)
    return any(
        len(ring) >= 6 and len(ring) % 2 == 0 and all(_is_number(value) for value in ring)
        for ring in rings
    )


def _has_drawable_bbox(bbox: Any) -> bool:
    return isinstance(bbox, list) and len(bbox) >= 4 and all(_is_number(value) for value in bbox[:4])


def _has_drawable_keypoints(keypoints: Any) -> bool:
    if not isinstance(keypoints, list) or not keypoints:
        return False
    if all(_is_number(item) for item in keypoints):
        stride = 3 if len(keypoints) >= 3 and len(keypoints) % 3 == 0 else 2
        return any(
            _is_number(keypoints[offset])
            and _is_number(keypoints[offset + 1])
            and (stride == 2 or (_is_number(keypoints[offset + 2]) and keypoints[offset + 2] > 0))
            for offset in range(0, len(keypoints) - 1, stride)
        )
    return any(
        isinstance(item, dict) and _is_number(item.get("x")) and _is_number(item.get("y"))
        for item in keypoints
    )


def _validate_coco_document(document: Any, width: int, height: int, file_name: str) -> dict[str, Any]:
    """Confere o COCO devolvido antes de repassá-lo ao editor.

    Um modelo pode devolver quase qualquer coisa, e uma anotação malformada
    apareceria na tela como um polígono torto sem explicação. Validar aqui
    transforma isso numa mensagem que diz o que o contêiner errou.
    """
    if not isinstance(document, dict):
        raise RuntimeError("a resposta precisa ser um objeto COCO com images, categories e annotations.")

    annotations = document.get("annotations")
    if not isinstance(annotations, list):
        raise RuntimeError("a chave annotations precisa ser uma lista.")
    if len(annotations) > BYOM_MAX_ANNOTATIONS:
        raise RuntimeError(
            f"o contêiner devolveu {len(annotations)} anotações; o limite aceito é {BYOM_MAX_ANNOTATIONS}."
        )

    categories = document.get("categories")
    if categories is not None and not isinstance(categories, list):
        raise RuntimeError("a chave categories precisa ser uma lista quando presente.")

    # images é opcional: quando o contêiner não a devolve, o conector preenche
    # com a imagem que ele mesmo enviou, para o editor casar a anotação.
    images = document.get("images")
    if not isinstance(images, list) or not images:
        images = [{"id": 1, "file_name": file_name, "width": width, "height": height}]
        for annotation in annotations:
            if isinstance(annotation, dict):
                annotation.setdefault("image_id", 1)

    for index, annotation in enumerate(annotations):
        if not isinstance(annotation, dict):
            raise RuntimeError(f"a anotação {index} não é um objeto JSON.")

        # Estar presente não basta: `segmentation: []` e `bbox: [1, 2]` passavam
        # aqui e eram descartados adiante pelo importador, e o que a pessoa lia
        # era "nenhuma anotação devolvida" — como se o modelo não tivesse achado
        # nada, e não como o contêiner respondendo fora do contrato.
        present = [
            key for key in ("segmentation", "bbox", "keypoints")
            if annotation.get(key) is not None
        ]
        if not present:
            raise RuntimeError(
                f"a anotação {index} não traz segmentation, bbox nem keypoints; "
                "sem geometria não há o que desenhar."
            )
        drawable = (
            _has_drawable_polygon(annotation.get("segmentation"))
            or _has_drawable_bbox(annotation.get("bbox"))
            or _has_drawable_keypoints(annotation.get("keypoints"))
        )
        if not drawable:
            raise RuntimeError(
                f"a anotação {index} traz {', '.join(present)}, mas nenhuma geometria "
                "utilizável: segmentation precisa de ao menos um anel com 3 pontos "
                "(6 números pares), bbox precisa de [x, y, largura, altura] numéricos "
                "e keypoints precisa de ao menos um ponto visível."
            )

    return {
        "images": images,
        "categories": categories if isinstance(categories, list) else [],
        "annotations": annotations,
    }


class ByomRegisterRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    model_id: str = Field(max_length=128)
    name: str = Field(default="", max_length=120)
    port: int = Field(default=BYOM_CONTAINER_PORT, ge=1, le=65_535)
    image: str = Field(default="", max_length=200)
    notes: str = Field(default="", max_length=2000)


def _write_byom_registration(request: ByomRegisterRequest) -> ByomRegistration:
    """Grava o registro pedido pela interface, sem executar nada no sistema.

    O conector não sobe contêiner: quem faz isso é a CLI ou o próprio usuário
    com docker run. Aqui só se declara onde o contêiner está, e o padrão de id
    impede que o nome escape do diretório de registros.
    """
    model_id = request.model_id.strip().lower()
    if not BYOM_ID_PATTERN.fullmatch(model_id):
        raise ValueError(
            f"model_id inválido: {model_id!r}. Use o prefixo byom- seguido de letras minúsculas, "
            "números, ponto, hífen ou sublinhado."
        )
    if model_id in MODEL_SPECS or model_id in MODEL_ALIASES:
        raise ValueError(f"model_id {model_id!r} colide com um modelo oficial")

    registry = _byom_registry_dir()
    registry.mkdir(parents=True, exist_ok=True)
    target = registry / f"{model_id}.json"
    # Editar é registrar de novo: o que a interface não envia — variáveis de
    # ambiente e o resumo da última execução — precisa sobreviver à edição.
    existing: dict[str, Any] = {}
    if target.is_file():
        try:
            loaded = json.loads(target.read_text(encoding="utf-8"))
            if isinstance(loaded, dict):
                existing = loaded
        except (OSError, ValueError):
            existing = {}

    document = {
        "model_id": model_id,
        "name": request.name.strip() or str(existing.get("name") or model_id),
        "image": request.image.strip() or str(existing.get("image") or ""),
        "endpoint": f"http://127.0.0.1:{request.port}",
        "notes": request.notes.strip(),
        "env": existing.get("env") if isinstance(existing.get("env"), dict) else {},
        "last_run": existing.get("last_run") if isinstance(existing.get("last_run"), dict) else None,
    }
    partial = target.with_suffix(".json.part")
    partial.write_text(json.dumps(document, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    partial.replace(target)
    return _parse_byom_registration(target)


class ByomAnnotateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    model_id: str = Field(max_length=128)
    image: str = Field(max_length=MAX_DATA_URL_LENGTH)
    file_name: str = Field(default="imagem.png", max_length=256)


class PointPrompt(BaseModel):
    x: float
    y: float
    label: int


PointCoordinate = tuple[float, float]
BoxCoordinates = tuple[float, float, float, float]


class PredictionRequest(BaseModel):
    image: str = Field(max_length=MAX_DATA_URL_LENGTH)
    model_id: str | None = None
    point_coords: list[PointCoordinate] | None = Field(default=None, max_length=MAX_POINT_PROMPTS)
    point_labels: list[int] | None = Field(default=None, max_length=MAX_POINT_PROMPTS)
    points: list[PointPrompt] | None = Field(default=None, max_length=MAX_POINT_PROMPTS)
    box: BoxCoordinates | None = None
    box_label: int = 1
    text: str | None = Field(default=None, max_length=MAX_TEXT_LENGTH)
    threshold: float | None = None
    multimask_output: bool = True
    client_id: str | None = Field(default=None, min_length=1, max_length=MAX_CLIENT_ID_LENGTH)
    request_seq: int | None = Field(default=None, ge=0)


@dataclass(frozen=True)
class LoadConfig:
    spec: ModelSpec
    checkpoint: str
    model_config: str | None
    requested_device: str


@dataclass(frozen=True)
class DecodedImage:
    pixels: np.ndarray
    content_hash: str


@dataclass(frozen=True)
class ValidatedPrompts:
    point_coords: np.ndarray | None
    point_labels: np.ndarray | None
    box: np.ndarray | None
    box_label: int
    text: str | None
    threshold: float | None


@dataclass(frozen=True)
class RawPrediction:
    mask: np.ndarray
    score: float
    bbox: list[float] | None = None


class EngineAdapter(Protocol):
    spec: ModelSpec
    device: str

    def set_image(self, image: np.ndarray) -> None: ...

    def predict(
        self,
        *,
        point_coords: np.ndarray | None,
        point_labels: np.ndarray | None,
        box: np.ndarray | None,
        box_label: int,
        text: str | None,
        threshold: float | None,
        multimask_output: bool,
    ) -> list[RawPrediction]: ...


def _to_numpy(value: Any) -> np.ndarray:
    if isinstance(value, np.ndarray):
        return value
    if hasattr(value, "detach"):
        value = value.detach()
    if hasattr(value, "cpu"):
        value = value.cpu()
    dtype_name = str(getattr(value, "dtype", ""))
    if "bfloat16" in dtype_name and hasattr(value, "float"):
        value = value.float()
    if hasattr(value, "numpy"):
        return value.numpy()
    return np.asarray(value)


def _binary_mask(mask: Any) -> np.ndarray:
    array = _to_numpy(mask)
    if array.dtype == np.bool_:
        return array
    finite = array[np.isfinite(array)]
    if not finite.size:
        return np.zeros(array.shape, dtype=bool)
    cutoff = 0.0 if float(finite.min()) < 0.0 else 0.5
    return np.nan_to_num(array, nan=-math.inf) > cutoff


def _predictions_from_arrays(
    masks: Any,
    scores: Any,
    boxes: Any | None = None,
) -> list[RawPrediction]:
    mask_array = _to_numpy(masks)
    if mask_array.ndim < 2:
        raise RuntimeError("O modelo retornou máscaras em um formato inválido.")
    height, width = mask_array.shape[-2:]
    mask_array = mask_array.reshape((-1, height, width))
    score_array = _to_numpy(scores).reshape(-1)
    box_array = None if boxes is None else _to_numpy(boxes).reshape((-1, 4))

    predictions: list[RawPrediction] = []
    for index, mask in enumerate(mask_array):
        score = float(score_array[index]) if index < score_array.size else 0.0
        bbox = None
        if box_array is not None and index < len(box_array):
            bbox = [float(coordinate) for coordinate in box_array[index]]
        predictions.append(RawPrediction(_binary_mask(mask), score, bbox))
    return predictions


class Sam2Adapter:
    def __init__(
        self,
        spec: ModelSpec,
        checkpoint: Path,
        model_config: str,
        device: str,
    ):
        import torch
        from sam2.build_sam import build_sam2
        from sam2.sam2_image_predictor import SAM2ImagePredictor

        model = build_sam2(
            model_config,
            str(checkpoint),
            device=device,
            mode="eval",
        )
        self.spec = spec
        self.device = device
        self._torch = torch
        self._predictor = SAM2ImagePredictor(model)

    def set_image(self, image: np.ndarray) -> None:
        with self._torch.inference_mode():
            self._predictor.set_image(image)

    def predict(
        self,
        *,
        point_coords: np.ndarray | None,
        point_labels: np.ndarray | None,
        box: np.ndarray | None,
        box_label: int,
        text: str | None,
        threshold: float | None,
        multimask_output: bool,
    ) -> list[RawPrediction]:
        del box_label, threshold
        if text is not None:
            raise ValueError("SAM 2 não aceita prompts de texto.")
        with self._torch.inference_mode():
            masks, scores, _ = self._predictor.predict(
                point_coords=point_coords,
                point_labels=point_labels,
                box=box,
                multimask_output=multimask_output,
            )
        return _predictions_from_arrays(masks, scores)


class Sam3Adapter:
    DEFAULT_THRESHOLD = 0.5

    def __init__(self, spec: ModelSpec, checkpoint: Path, device: str):
        import torch
        from sam3.model.sam3_image_processor import Sam3Processor
        from sam3.model_builder import build_sam3_image_model

        model = build_sam3_image_model(
            device=device,
            checkpoint_path=str(checkpoint),
            load_from_HF=False,
            enable_inst_interactivity=True,
        )
        model.to(device=device)
        model.eval()
        self.spec = spec
        self.device = device
        self._torch = torch
        self._model = model
        self._processor = Sam3Processor(
            model,
            device=device,
            confidence_threshold=self.DEFAULT_THRESHOLD,
        )
        self._state: dict[str, Any] | None = None
        self._image_size: tuple[int, int] | None = None

    def _autocast(self):
        """Fixa o dtype das ativações do SAM 3.

        O modelo produz ativações em bfloat16 internamente, mas não declara um
        autocast próprio: o dtype acaba dependendo do estado ambiente da thread.
        Como o conector constrói o modelo na thread do carregador e atende as
        requisições em outra, a inferência quebrava com "mat1 and mat2 must have
        the same dtype, but got BFloat16 and Float". Declarar o autocast aqui
        torna o resultado igual em qualquer thread.
        """
        if self.device == "cuda":
            return self._torch.autocast("cuda", dtype=self._torch.bfloat16)
        return contextlib.nullcontext()

    def set_image(self, image: np.ndarray) -> None:
        with self._torch.inference_mode(), self._autocast():
            self._state = self._processor.set_image(Image.fromarray(image))
        self._image_size = (int(image.shape[1]), int(image.shape[0]))

    def _predict_concept(
        self,
        text: str | None,
        box: np.ndarray | None,
        box_label: int,
        threshold: float | None,
    ) -> list[RawPrediction]:
        if self._state is None or self._image_size is None:
            raise RuntimeError("Defina a imagem antes de executar o SAM 3.")
        self._processor.reset_all_prompts(self._state)
        self._processor.set_confidence_threshold(
            self.DEFAULT_THRESHOLD if threshold is None else threshold
        )
        state = self._state
        if text is not None:
            state = self._processor.set_text_prompt(prompt=text, state=state)
        if box is not None:
            width, height = self._image_size
            x0, y0, x1, y1 = [float(value) for value in box]
            exemplar = [
                (x0 + x1) / (2.0 * width),
                (y0 + y1) / (2.0 * height),
                (x1 - x0) / width,
                (y1 - y0) / height,
            ]
            state = self._processor.add_geometric_prompt(
                box=exemplar,
                label=bool(box_label),
                state=state,
            )
        masks = state.get("masks")
        scores = state.get("scores")
        if masks is None or scores is None:
            return []
        return _predictions_from_arrays(masks, scores, state.get("boxes"))

    def predict(
        self,
        *,
        point_coords: np.ndarray | None,
        point_labels: np.ndarray | None,
        box: np.ndarray | None,
        box_label: int,
        text: str | None,
        threshold: float | None,
        multimask_output: bool,
    ) -> list[RawPrediction]:
        if self._state is None:
            raise RuntimeError("Defina a imagem antes de executar o SAM 3.")
        if text is not None and point_coords is not None:
            raise ValueError(
                "SAM 3 não combina texto e pontos nesta API; use texto com uma caixa exemplar."
            )
        with self._torch.inference_mode(), self._autocast():
            if text is not None:
                return self._predict_concept(text, box, box_label, threshold)

            if box is not None and box_label == 0:
                raise ValueError(
                    "Caixa negativa só é aceita como exemplar junto de um prompt de texto."
                )

            self._processor.reset_all_prompts(self._state)
            masks, scores, _ = self._model.predict_inst(
                self._state,
                point_coords=point_coords,
                point_labels=point_labels,
                box=box,
                multimask_output=multimask_output,
            )
        return _predictions_from_arrays(masks, scores)


def _configured_origins() -> tuple[str, ...]:
    configured = os.environ.get("POLIGOME_ALLOWED_ORIGINS", "")
    values = [
        origin.strip().rstrip("/")
        for origin in configured.split(",")
        if origin.strip() and origin.strip() != "*"
    ]
    return tuple(dict.fromkeys((*DEFAULT_ALLOWED_ORIGINS, *values)))


ALLOWED_ORIGINS = _configured_origins()
LOOPBACK_ORIGIN_PATTERN = r"https?://(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?"


def _origin_is_allowed(origin: str) -> bool:
    normalized = origin.rstrip("/")
    return normalized in ALLOWED_ORIGINS or re.fullmatch(LOOPBACK_ORIGIN_PATTERN, normalized) is not None


class _RequestBodyTooLarge(Exception):
    pass


class PredictionRequestGuard:
    """Limita uploads e concorrência antes de FastAPI materializar o JSON."""

    def __init__(self, app: Any, max_body_bytes: int, max_concurrent: int):
        self.app = app
        self.max_body_bytes = max_body_bytes
        self._slots = asyncio.Semaphore(max_concurrent)

    async def _reject(self, scope: dict[str, Any], receive: Any, send: Any, status: int, detail: str) -> None:
        response = JSONResponse(status_code=status, content={"detail": detail})
        await response(scope, receive, send)

    async def __call__(self, scope: dict[str, Any], receive: Any, send: Any) -> None:
        # /byom/annotate carrega a mesma imagem inteira que /predict, então
        # precisa do mesmo teto de corpo e do mesmo limite de concorrência.
        is_prediction = (
            scope.get("type") == "http"
            and scope.get("method") == "POST"
            and str(scope.get("path", "")).rstrip("/") in ("/predict", "/byom/annotate")
        )
        if not is_prediction:
            await self.app(scope, receive, send)
            return

        headers = dict(scope.get("headers", []))
        content_length = headers.get(b"content-length")
        if content_length is not None:
            try:
                declared_size = int(content_length)
            except (TypeError, ValueError):
                await self._reject(scope, receive, send, 400, "Content-Length inválido.")
                return
            if declared_size < 0:
                await self._reject(scope, receive, send, 400, "Content-Length inválido.")
                return
            if declared_size > self.max_body_bytes:
                await self._reject(
                    scope,
                    receive,
                    send,
                    413,
                    "A solicitação excede o limite de bytes do conector local.",
                )
                return

        async with self._slots:
            received_bytes = 0
            response_started = False

            async def limited_receive():
                nonlocal received_bytes
                message = await receive()
                if message.get("type") == "http.request":
                    received_bytes += len(message.get("body", b""))
                    if received_bytes > self.max_body_bytes:
                        raise _RequestBodyTooLarge
                return message

            async def tracked_send(message):
                nonlocal response_started
                if message.get("type") == "http.response.start":
                    response_started = True
                await send(message)

            try:
                await self.app(scope, limited_receive, tracked_send)
            except _RequestBodyTooLarge:
                if response_started:
                    raise
                await self._reject(
                    scope,
                    receive,
                    send,
                    413,
                    "A solicitação excede o limite de bytes do conector local.",
                )


app = FastAPI(title=SERVICE_NAME, version=str(API_VERSION))
app.add_middleware(
    PredictionRequestGuard,
    max_body_bytes=MAX_REQUEST_BODY_BYTES,
    max_concurrent=MAX_CONCURRENT_PREDICTION_REQUESTS,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=list(ALLOWED_ORIGINS),
    allow_origin_regex=LOOPBACK_ORIGIN_PATTERN,
    allow_credentials=False,
    # DELETE existe para remover um registro BYOM pela interface.
    allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
    allow_headers=["Accept", "Content-Type"],
)

_app_dir: Path = Path.home() / ".poligome-sam"
_startup_port: int = 7860
_switch_lock = threading.Lock()
_switch_target: str | None = None
_runtime_lock = threading.Lock()
_predictor_lock = threading.Lock()
_request_state_lock = threading.Lock()
_latest_request_by_client: dict[str, int] = {}
_adapter: EngineAdapter | None = None
_current_image_hash: str | None = None
_startup_config: LoadConfig | None = None
_loader_started = False
_runtime: dict[str, Any] = {
    "service": SERVICE_NAME,
    "api_version": API_VERSION,
    "status": "loading",
    "model_id": None,
    "family": None,
    "model_type": "desconhecido",
    "device": "carregando",
    "capabilities": [],
    "error": None,
}


def _update_runtime(**values: Any) -> None:
    with _runtime_lock:
        _runtime.update(values)


def _host_label() -> str:
    """Onde este conector mora, em uma palavra que o usuário reconheça."""
    if os.name == "nt":
        return "Windows"
    if sys.platform == "darwin":
        return "macOS"
    try:
        release = Path("/proc/sys/kernel/osrelease").read_text(encoding="utf-8")
    except OSError:
        release = ""
    return "WSL2" if re.search(r"wsl2|microsoft-standard", release, re.IGNORECASE) else "Linux"


def _runtime_snapshot() -> dict[str, Any]:
    with _runtime_lock:
        snapshot = dict(_runtime)
    # A porta 7860 é uma só. Com um conector no WSL2 e outro no Windows nativo,
    # quem pegar a porta primeiro atende o navegador e o outro fica invisível — e
    # a tela mostrava "nenhum BYOM registrado" sem nenhuma pista de que estava
    # falando com a instalação errada. Dizer onde este mora resolve isso.
    snapshot["host"] = _host_label()
    snapshot["app_dir"] = str(_app_dir)
    return snapshot


def _register_request(client_id: str | None, request_seq: int | None) -> None:
    if (client_id is None) != (request_seq is None):
        raise HTTPException(
            status_code=400,
            detail="Envie client_id e request_seq juntos.",
        )
    if client_id is None or request_seq is None:
        return
    with _request_state_lock:
        previous = _latest_request_by_client.get(client_id, -1)
        if request_seq < previous:
            raise HTTPException(status_code=409, detail="Solicitação substituída por uma mais nova.")
        if request_seq == previous:
            raise HTTPException(status_code=409, detail="Solicitação duplicada.")
        if client_id not in _latest_request_by_client and len(_latest_request_by_client) >= 64:
            _latest_request_by_client.pop(next(iter(_latest_request_by_client)))
        _latest_request_by_client[client_id] = request_seq


def _request_is_stale(client_id: str | None, request_seq: int | None) -> bool:
    if client_id is None or request_seq is None:
        return False
    with _request_state_lock:
        return _latest_request_by_client.get(client_id) != request_seq


def _resolve_device(requested: str) -> str:
    # Pedir CPU não passa por torch.cuda: é essa consulta que faz o PyTorch
    # imprimir "The NVIDIA driver on your system is too old", um aviso em inglês
    # que aparece logo antes da linha de sucesso e parece um erro para quem só
    # quer anotar. Quem escolheu CPU não precisa ver nada sobre a GPU.
    if requested == "cpu":
        return "cpu"

    import torch

    mps_backend = getattr(torch.backends, "mps", None)
    mps_available = bool(mps_backend and mps_backend.is_available())
    if requested == "auto":
        # O aviso do torch é capturado e reescrito: o fato que interessa é que a
        # GPU não vai ser usada e por quê, não o texto interno do PyTorch.
        with warnings.catch_warnings(record=True) as caught:
            warnings.simplefilter("always")
            cuda_available = torch.cuda.is_available()
        if not cuda_available and any("driver" in str(item.message).lower() for item in caught):
            print(
                "GPU NVIDIA encontrada, mas o driver desta máquina é antigo demais "
                "para o PyTorch instalado. Seguindo em CPU, que funciona.",
                flush=True,
            )
        return "cuda" if cuda_available else "mps" if mps_available else "cpu"
    if requested == "cuda" and not torch.cuda.is_available():
        raise RuntimeError(
            "CUDA não está disponível. Use --device cpu ou instale um PyTorch compatível."
        )
    if requested == "mps" and not mps_available:
        raise RuntimeError("Apple Silicon/MPS não está disponível. Use --device cpu.")
    return requested


def _numeric_version(value: str | None) -> tuple[int, int]:
    match = re.match(r"^(\d+)\.(\d+)", value or "")
    return (int(match.group(1)), int(match.group(2))) if match else (0, 0)


def _validate_sam3_runtime(device: str) -> None:
    import torch

    if sys.version_info < (3, 12):
        raise RuntimeError("SAM 3 exige Python 3.12 ou mais novo.")
    if _numeric_version(torch.__version__) < (2, 7):
        raise RuntimeError(f"SAM 3 exige PyTorch 2.7+; encontrado {torch.__version__}.")
    if device != "cuda":
        raise RuntimeError("SAM 3 exige GPU NVIDIA e dispositivo CUDA; CPU e MPS não são suportados neste conector.")
    cuda_version = getattr(torch.version, "cuda", None)
    if _numeric_version(cuda_version) < (12, 6):
        raise RuntimeError(f"SAM 3 exige um build PyTorch CUDA 12.6+; encontrado CUDA {cuda_version or 'ausente'}.")


def _build_adapter(config: LoadConfig) -> EngineAdapter:
    checkpoint = Path(config.checkpoint).expanduser().resolve()
    if not checkpoint.is_file():
        raise FileNotFoundError(f"Checkpoint não encontrado: {checkpoint}")
    device = _resolve_device(config.requested_device)
    _update_runtime(device=device)
    if config.spec.family == "sam3":
        _validate_sam3_runtime(device)

    if config.spec.family == "sam2":
        model_config = config.model_config or config.spec.default_config
        if not model_config:
            raise RuntimeError("Informe --model-config para este modelo SAM 2.")
        return Sam2Adapter(config.spec, checkpoint, model_config, device)
    if config.spec.family == "sam3":
        return Sam3Adapter(config.spec, checkpoint, device)
    raise RuntimeError(f"Família de modelo não suportada: {config.spec.family}")


def _load_model(config: LoadConfig) -> None:
    global _adapter, _current_image_hash
    try:
        print(f"Carregando {config.spec.model_id}…", flush=True)
        adapter = _build_adapter(config)
        with _predictor_lock:
            _adapter = adapter
            _current_image_hash = None
        _update_runtime(status="ready", device=adapter.device, error=None)
        print(
            f"Poligome SAM pronto: {config.spec.model_id} em {adapter.device}.",
            flush=True,
        )
    except Exception as error:  # o erro precisa permanecer consultável em /health
        message = f"{type(error).__name__}: {error}"
        _update_runtime(status="error", error=message)
        print(f"Falha ao carregar o modelo: {message}", flush=True)


@app.on_event("startup")
def start_model_loader() -> None:
    global _loader_started
    with _runtime_lock:
        if _loader_started or _startup_config is None:
            return
        _loader_started = True
        config = _startup_config
    threading.Thread(
        target=_load_model,
        args=(config,),
        name="poligome-model-loader",
        daemon=True,
    ).start()


@app.middleware("http")
async def allow_local_browser_access(request: Request, call_next):
    origin = request.headers.get("origin")
    if origin and not _origin_is_allowed(origin):
        return JSONResponse(
            status_code=403,
            content={"detail": "Origem não autorizada para acessar o conector local."},
        )
    response = await call_next(request)
    if origin and _origin_is_allowed(origin):
        response.headers["Access-Control-Allow-Private-Network"] = "true"
    return response


def _family_python(family: str) -> Path:
    """Interpretador do venv da família, no layout criado pelos instaladores."""
    if os.name == "nt":
        return _app_dir / "venvs" / family / "Scripts" / "python.exe"
    return _app_dir / "venvs" / family / "bin" / "python"


def _model_checkpoint(spec: ModelSpec) -> Path:
    return _app_dir / "models" / spec.model_id / spec.checkpoint_name


def _model_availability(spec: ModelSpec) -> dict[str, Any]:
    """Diz se o modelo pode ser carregado agora e, quando nao, por que."""
    runtime = _runtime_snapshot()
    interpreter = _family_python(spec.family)
    checkpoint = _model_checkpoint(spec)
    if spec.model_id == runtime.get("model_id"):
        # O modelo em uso vale como instalado mesmo se o checkpoint veio de outro
        # caminho via --checkpoint.
        runtime_missing = False
        checkpoint_missing = False
    else:
        runtime_missing = not interpreter.is_file()
        checkpoint_missing = not (checkpoint.is_file() and checkpoint.stat().st_size > 0)
    reasons = []
    if runtime_missing:
        reasons.append(f"runtime da família {spec.family} não instalado")
    if checkpoint_missing:
        reasons.append("checkpoint ausente")
    return {
        "model_id": spec.model_id,
        "family": spec.family,
        "capabilities": list(spec.capabilities),
        "installed": not reasons,
        "loaded": spec.model_id == runtime.get("model_id"),
        "unavailable_reason": "; ".join(reasons) or None,
    }


@app.get("/byom/models")
def byom_models():
    """Modelos BYOM registrados nesta máquina, com o estado do contêiner.

    Separado de /models de propósito: BYOM não é um modelo que o conector
    carrega, e sim um serviço externo para o qual ele encaminha.
    """
    entries = []
    for registration in byom_registrations().values():
        ready, reason = _byom_container_ready(registration)
        entries.append({
            "model_id": registration.model_id,
            "name": registration.name,
            "image": registration.image,
            "endpoint": registration.endpoint,
            "notes": registration.notes,
            "env": registration.env,
            "last_run": registration.last_run,
            "metadata": _byom_metadata(registration) if ready else None,
            "ready": ready,
            "unavailable_reason": reason,
        })
    return {
        "service": SERVICE_NAME,
        "api_version": API_VERSION,
        "models": entries,
    }


@app.post("/byom/register")
def byom_register(payload: ByomRegisterRequest):
    """Registra um contêiner já em execução, para importar sem usar o terminal."""
    try:
        registration = _write_byom_registration(payload)
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except OSError as error:
        raise HTTPException(status_code=500, detail=f"não foi possível gravar o registro: {error}") from error

    ready, reason = _byom_container_ready(registration)
    return {
        "model_id": registration.model_id,
        "name": registration.name,
        "image": registration.image,
        "endpoint": registration.endpoint,
        "notes": registration.notes,
        "env": registration.env,
        "last_run": registration.last_run,
        "metadata": _byom_metadata(registration) if ready else None,
        "ready": ready,
        "unavailable_reason": reason,
    }


@app.delete("/byom/models/{model_id}")
def byom_unregister(model_id: str):
    """Remove um registro. O contêiner e a imagem continuam intactos no Docker."""
    normalized = model_id.strip().lower()
    if not BYOM_ID_PATTERN.fullmatch(normalized):
        raise HTTPException(status_code=400, detail=f"model_id inválido: {model_id}")
    target = _byom_registry_dir() / f"{normalized}.json"
    if not target.is_file():
        raise HTTPException(status_code=404, detail=f"modelo BYOM não registrado: {normalized}")
    try:
        target.unlink()
    except OSError as error:
        raise HTTPException(status_code=500, detail=f"não foi possível remover o registro: {error}") from error
    return {"model_id": normalized, "removed": True}


@app.post("/byom/annotate")
def byom_annotate(payload: ByomAnnotateRequest):
    """Roda um modelo BYOM na imagem inteira e devolve o COCO já validado."""
    registration = byom_registrations().get(payload.model_id)
    if registration is None:
        raise HTTPException(
            status_code=404,
            detail=f"modelo BYOM não registrado: {payload.model_id}",
        )
    ready, reason = _byom_container_ready(registration)
    if not ready:
        raise HTTPException(status_code=409, detail=f"{reason}. Suba o contêiner antes de anotar.")

    decoded = decode_image(payload.image)
    height, width = decoded.pixels.shape[:2]
    try:
        response = _byom_invoke(
            registration,
            {
                "image": payload.image,
                "file_name": payload.file_name,
                "width": int(width),
                "height": int(height),
            },
        )
        document = _validate_coco_document(response, int(width), int(height), payload.file_name)
    except RuntimeError as error:
        raise HTTPException(status_code=502, detail=str(error)) from error

    summary = _summarize_run(document)
    _record_byom_run(registration, summary)
    return {
        "summary": summary,
        "model_id": registration.model_id,
        "name": registration.name,
        "width": int(width),
        "height": int(height),
        "coco": document,
    }


@app.get("/models")
def models():
    runtime = _runtime_snapshot()
    return {
        "service": SERVICE_NAME,
        "api_version": API_VERSION,
        "loaded_model_id": runtime.get("model_id"),
        "status": runtime.get("status"),
        "switching_to": _switch_target,
        "models": [_model_availability(spec) for spec in MODEL_SPECS.values()],
    }


class LoadRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    model_id: str


def _persist_selection(spec: ModelSpec) -> None:
    """Grava o modelo escolhido para que serviço e iniciadores subam o mesmo.

    Sem isso, uma troca feita pela interface seria esquecida no próximo arranque.
    """
    target = _app_dir / "selected-model.txt"
    try:
        target.parent.mkdir(parents=True, exist_ok=True)
        partial = target.with_suffix(".txt.part")
        partial.write_text(f"{spec.model_id}\n", encoding="utf-8")
        partial.replace(target)
    except OSError as error:  # a troca continua valendo, mas o próximo boot não herda
        print(f"Aviso: não foi possível salvar a seleção: {error}", flush=True)


def _exec_with_model(spec: ModelSpec, port: int) -> None:
    """Substitui este processo pelo mesmo conector no venv da familia pedida.

    Usar execv preserva o PID, o terminal e o processo pai, de modo que os
    instaladores que aguardam o conector continuam funcionando.

    No Windows nao ha execv de verdade: a libc emula com spawn mais exit, entao o
    PID muda e quem lancou o conector ve o processo morrer no meio de uma troca
    que deu certo. Em vez de fingir, saimos com SWITCH_EXIT_CODE e devolvemos a
    decisao a quem segura o terminal. O modelo pedido ja foi gravado em
    selected-model.txt por /load, que e exatamente de onde o lancador le.
    """
    if os.name == "nt":
        print(
            f"Trocando para {spec.model_id}; devolvendo ao lançador para recarregar...",
            flush=True,
        )
        sys.stdout.flush()
        sys.stderr.flush()
        os._exit(SWITCH_EXIT_CODE)

    interpreter = str(_family_python(spec.family))
    argv = [
        interpreter,
        str(Path(__file__).resolve()),
        "--model",
        spec.model_id,
        "--checkpoint",
        str(_model_checkpoint(spec)),
    ]
    if spec.default_config:
        argv += ["--model-config", spec.default_config]
    argv += ["--device", "auto", "--port", str(port), "--app-dir", str(_app_dir)]
    print(f"Trocando para {spec.model_id}; recarregando o conector...", flush=True)
    sys.stdout.flush()
    sys.stderr.flush()
    try:
        os.execv(interpreter, argv)
    except OSError as error:  # o processo continua vivo; o estado precisa refletir isso
        global _switch_target
        _switch_target = None
        _update_runtime(
            status="error",
            error=f"não foi possível recarregar o conector: {error}",
        )


@app.post("/load")
def load(payload: LoadRequest):
    global _switch_target
    requested = MODEL_ALIASES.get(payload.model_id, payload.model_id)
    spec = MODEL_SPECS.get(requested)
    if spec is None:
        raise HTTPException(status_code=400, detail=f"model_id desconhecido: {payload.model_id}")

    runtime = _runtime_snapshot()
    if spec.model_id == runtime.get("model_id") and runtime.get("status") == "ready":
        return {"status": "ready", "model_id": spec.model_id, "switching": False}

    availability = _model_availability(spec)
    if not availability["installed"]:
        raise HTTPException(
            status_code=409,
            detail=(
                f"{spec.model_id} ainda não está instalado: "
                f"{availability['unavailable_reason']}. Rode o instalador deste modelo "
                f"e volte a esta tela; o conector segue no ar com o modelo atual."
            ),
        )

    with _switch_lock:
        if _switch_target is not None:
            raise HTTPException(
                status_code=409,
                detail=f"uma troca para {_switch_target} ja esta em andamento.",
            )
        _switch_target = spec.model_id

    _persist_selection(spec)
    _update_runtime(status="loading", error=None)
    # A resposta precisa sair antes do execv, senao o cliente perde a conexao.
    threading.Timer(
        0.4,
        _exec_with_model,
        args=(spec, _startup_port),
    ).start()
    return {"status": "switching", "model_id": spec.model_id, "switching": True}


@app.get("/")
def root():
    return _runtime_snapshot()


@app.get("/health")
def health():
    return _runtime_snapshot()


def _validate_dimensions(width: int, height: int) -> None:
    if width <= 0 or height <= 0:
        raise HTTPException(status_code=400, detail="A imagem não possui dimensões válidas.")
    if width > MAX_IMAGE_DIMENSION or height > MAX_IMAGE_DIMENSION:
        raise HTTPException(
            status_code=413,
            detail=f"A imagem excede {MAX_IMAGE_DIMENSION} pixels em um dos lados.",
        )
    if width * height > MAX_IMAGE_PIXELS:
        raise HTTPException(
            status_code=413,
            detail=(
                f"A imagem possui {width * height} pixels e excede o limite de "
                f"{MAX_IMAGE_PIXELS}. Ajuste POLIGOME_MAX_IMAGE_PIXELS somente se "
                "o hardware tiver memória suficiente."
            ),
        )


def decode_image(data_url: str) -> DecodedImage:
    if not isinstance(data_url, str) or not data_url:
        raise HTTPException(status_code=400, detail="Imagem ausente.")
    if len(data_url) > MAX_DATA_URL_LENGTH:
        raise HTTPException(
            status_code=413,
            detail=f"A imagem codificada excede o limite de {MAX_IMAGE_BYTES // 1024 // 1024} MB.",
        )

    header = ""
    encoded = data_url
    if "," in data_url:
        header, encoded = data_url.split(",", 1)
    if header.lower().startswith("data:") and ";base64" not in header.lower():
        raise HTTPException(status_code=400, detail="A imagem deve usar um data URL base64.")
    try:
        image_bytes = base64.b64decode(encoded.strip(), validate=True)
    except (binascii.Error, ValueError) as error:
        raise HTTPException(status_code=400, detail="Imagem base64 inválida.") from error
    if not image_bytes:
        raise HTTPException(status_code=400, detail="A imagem está vazia.")
    if len(image_bytes) > MAX_IMAGE_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"A imagem excede o limite de {MAX_IMAGE_BYTES // 1024 // 1024} MB.",
        )

    try:
        with Image.open(io.BytesIO(image_bytes)) as source:
            _validate_dimensions(*source.size)
            oriented = ImageOps.exif_transpose(source)
            _validate_dimensions(*oriented.size)
            pixels = np.array(oriented.convert("RGB"), dtype=np.uint8, copy=True)
    except HTTPException:
        raise
    except Image.DecompressionBombError as error:
        raise HTTPException(
            status_code=413,
            detail="A imagem excede o limite seguro de dimensões.",
        ) from error
    except (UnidentifiedImageError, OSError, ValueError) as error:
        raise HTTPException(
            status_code=400,
            detail="Imagem inválida ou não suportada.",
        ) from error
    return DecodedImage(pixels, hashlib.sha256(image_bytes).hexdigest())


def _validate_prompts(
    payload: PredictionRequest,
    width: int,
    height: int,
) -> ValidatedPrompts:
    coordinates = payload.point_coords
    labels = payload.point_labels
    arrays_supplied = coordinates is not None or labels is not None
    if arrays_supplied and (coordinates is None or labels is None):
        raise HTTPException(
            status_code=400,
            detail="Envie point_coords e point_labels juntos.",
        )
    if coordinates is not None and labels is not None and len(coordinates) != len(labels):
        raise HTTPException(
            status_code=400,
            detail="Envie pontos e rótulos correspondentes.",
        )
    if (not coordinates) and payload.points:
        coordinates = [[point.x, point.y] for point in payload.points]
        labels = [point.label for point in payload.points]

    coordinates = coordinates or []
    labels = labels or []
    if len(coordinates) > MAX_POINT_PROMPTS:
        raise HTTPException(
            status_code=413,
            detail=f"Use no máximo {MAX_POINT_PROMPTS} pontos por previsão.",
        )

    validated_coordinates: list[list[float]] = []
    validated_labels: list[int] = []
    for index, coordinate in enumerate(coordinates):
        if len(coordinate) != 2:
            raise HTTPException(
                status_code=400,
                detail=f"O ponto {index + 1} deve conter exatamente x e y.",
            )
        x, y = float(coordinate[0]), float(coordinate[1])
        if not math.isfinite(x) or not math.isfinite(y):
            raise HTTPException(status_code=400, detail="As coordenadas devem ser finitas.")
        if x < 0 or y < 0 or x > width or y > height:
            raise HTTPException(
                status_code=400,
                detail=f"O ponto {index + 1} está fora da imagem.",
            )
        label = int(labels[index])
        if label not in (0, 1):
            raise HTTPException(
                status_code=400,
                detail="Os rótulos dos pontos devem ser 0 (excluir) ou 1 (incluir).",
            )
        validated_coordinates.append(
            [min(x, max(0, width - 1)), min(y, max(0, height - 1))]
        )
        validated_labels.append(label)

    validated_box = None
    box_label = int(payload.box_label)
    if box_label not in (0, 1):
        raise HTTPException(
            status_code=400,
            detail="box_label deve ser 0 (excluir) ou 1 (incluir).",
        )
    if payload.box is not None:
        if len(payload.box) != 4:
            raise HTTPException(
                status_code=400,
                detail="A caixa deve estar no formato [x0, y0, x1, y1].",
            )
        x0, y0, x1, y1 = [float(value) for value in payload.box]
        if not all(math.isfinite(value) for value in (x0, y0, x1, y1)):
            raise HTTPException(status_code=400, detail="A caixa deve conter valores finitos.")
        if x0 < 0 or y0 < 0 or x1 > width or y1 > height or x1 <= x0 or y1 <= y0:
            raise HTTPException(status_code=400, detail="A caixa está fora da imagem ou é vazia.")
        validated_box = np.asarray([x0, y0, x1, y1], dtype=np.float32)

    text = payload.text.strip() if payload.text is not None else None
    if text == "":
        text = None
    if text is not None and len(text) > MAX_TEXT_LENGTH:
        raise HTTPException(
            status_code=413,
            detail=f"O texto deve ter no máximo {MAX_TEXT_LENGTH} caracteres.",
        )

    threshold = payload.threshold
    if threshold is not None and (
        not math.isfinite(float(threshold)) or float(threshold) < 0 or float(threshold) > 1
    ):
        raise HTTPException(status_code=400, detail="threshold deve estar entre 0 e 1.")

    if not validated_coordinates and validated_box is None and text is None:
        raise HTTPException(
            status_code=400,
            detail="Envie ao menos um ponto, uma caixa ou um texto.",
        )

    return ValidatedPrompts(
        np.asarray(validated_coordinates, dtype=np.float32)
        if validated_coordinates
        else None,
        np.asarray(validated_labels, dtype=np.int32) if validated_labels else None,
        validated_box,
        box_label,
        text,
        None if threshold is None else float(threshold),
    )


def mask_to_polygons(mask: np.ndarray) -> list[list[list[float]]]:
    binary = np.ascontiguousarray(mask.astype(np.uint8))
    contours, _ = cv2.findContours(binary, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    polygons: list[list[list[float]]] = []
    for contour in sorted(contours, key=cv2.contourArea, reverse=True):
        if cv2.contourArea(contour) <= 0:
            continue
        epsilon = max(1.0, 0.002 * cv2.arcLength(contour, True))
        simplified = cv2.approxPolyDP(contour, epsilon, True)
        if len(simplified) < 3:
            simplified = contour
        if len(simplified) >= 3:
            polygons.append(simplified[:, 0, :].astype(float).tolist())
    return polygons


def _mask_bbox(mask: np.ndarray) -> list[float] | None:
    rows, columns = np.nonzero(mask)
    if not len(columns):
        return None
    return [
        float(columns.min()),
        float(rows.min()),
        float(columns.max() + 1),
        float(rows.max() + 1),
    ]


def _serialize_predictions(
    raw_predictions: list[RawPrediction],
    width: int,
    height: int,
    threshold: float | None,
) -> list[dict[str, Any]]:
    serialized: list[dict[str, Any]] = []
    for raw in raw_predictions:
        score = raw.score if math.isfinite(raw.score) else 0.0
        if threshold is not None and score < threshold:
            continue
        mask = raw.mask
        if mask.shape != (height, width):
            mask = cv2.resize(
                mask.astype(np.uint8),
                (width, height),
                interpolation=cv2.INTER_NEAREST,
            ).astype(bool)
        polygons = mask_to_polygons(mask)
        if not polygons:
            continue
        prediction: dict[str, Any] = {
            "polygons": polygons,
            "polygon": polygons[0],
            "score": float(score),
        }
        bbox = raw.bbox or _mask_bbox(mask)
        if bbox is not None:
            prediction["bbox"] = bbox
        serialized.append(prediction)
    serialized.sort(key=lambda prediction: prediction["score"], reverse=True)
    return serialized


def _top_predictions(
    raw_predictions: list[RawPrediction],
    limit: int,
) -> tuple[list[RawPrediction], int, bool]:
    total = len(raw_predictions)
    if total <= limit:
        return raw_predictions, total, False
    ranked = sorted(
        raw_predictions,
        key=lambda prediction: prediction.score
        if math.isfinite(prediction.score)
        else -math.inf,
        reverse=True,
    )
    return ranked[:limit], total, True


@app.post("/predict")
def predict(payload: PredictionRequest):
    global _current_image_hash
    runtime = _runtime_snapshot()
    if runtime["status"] == "loading":
        raise HTTPException(status_code=503, detail="O modelo ainda está carregando.")
    if runtime["status"] == "error":
        raise HTTPException(
            status_code=503,
            detail=f"Falha ao carregar o modelo: {runtime['error']}",
        )
    adapter = _adapter
    if adapter is None:
        raise HTTPException(status_code=503, detail="O modelo não está disponível.")
    if payload.model_id is not None:
        requested_model_id = MODEL_ALIASES.get(payload.model_id, payload.model_id)
        if requested_model_id not in MODEL_SPECS:
            raise HTTPException(
                status_code=400,
                detail=f"model_id desconhecido: {payload.model_id}",
            )
        if requested_model_id != adapter.spec.model_id:
            raise HTTPException(
                status_code=409,
                detail=(
                    f"O conector carregou {adapter.spec.model_id}, mas a solicitação pede "
                    f"{requested_model_id}."
                ),
            )

    _register_request(payload.client_id, payload.request_seq)
    try:
        with _predictor_lock:
            if _request_is_stale(payload.client_id, payload.request_seq):
                raise HTTPException(status_code=409, detail="Solicitação substituída por uma mais nova.")
            decoded = decode_image(payload.image)
            height, width = decoded.pixels.shape[:2]
            prompts = _validate_prompts(payload, width, height)
            if prompts.text is not None and "text" not in adapter.spec.capabilities:
                raise HTTPException(
                    status_code=400,
                    detail=f"{adapter.spec.model_id} não aceita prompts de texto.",
                )
            if prompts.text is not None and prompts.point_coords is not None:
                raise HTTPException(
                    status_code=400,
                    detail="Não combine texto e pontos; use texto com uma caixa exemplar.",
                )
            if (
                adapter.spec.family == "sam3"
                and prompts.text is not None
                and prompts.threshold is not None
                and prompts.threshold < MIN_SAM3_CONCEPT_THRESHOLD
            ):
                raise HTTPException(
                    status_code=400,
                    detail=(
                        "O threshold conceitual do SAM 3 deve ser pelo menos "
                        f"{MIN_SAM3_CONCEPT_THRESHOLD:g} para limitar o número de máscaras."
                    ),
                )
            if prompts.box is not None and prompts.box_label == 0 and (
                adapter.spec.family != "sam3" or prompts.text is None
            ):
                raise HTTPException(
                    status_code=400,
                    detail="Caixa negativa requer SAM 3 e um prompt de texto conceitual.",
                )
            if _request_is_stale(payload.client_id, payload.request_seq):
                raise HTTPException(status_code=409, detail="Solicitação substituída por uma mais nova.")
            reused_embedding = _current_image_hash == decoded.content_hash
            if not reused_embedding:
                adapter.set_image(decoded.pixels)
                _current_image_hash = decoded.content_hash
            if _request_is_stale(payload.client_id, payload.request_seq):
                raise HTTPException(status_code=409, detail="Solicitação substituída por uma mais nova.")
            raw_predictions = adapter.predict(
                point_coords=prompts.point_coords,
                point_labels=prompts.point_labels,
                box=prompts.box,
                box_label=prompts.box_label,
                text=prompts.text,
                threshold=prompts.threshold,
                multimask_output=payload.multimask_output,
            )
            if _request_is_stale(payload.client_id, payload.request_seq):
                raise HTTPException(status_code=409, detail="Solicitação substituída por uma mais nova.")
    except ValueError as error:
        raise HTTPException(status_code=400, detail=str(error)) from error
    except HTTPException:
        raise
    except Exception as error:
        raise HTTPException(
            status_code=500,
            detail=f"Falha durante a inferência: {type(error).__name__}: {error}",
        ) from error

    if _request_is_stale(payload.client_id, payload.request_seq):
        raise HTTPException(status_code=409, detail="Solicitação substituída por uma mais nova.")

    raw_prediction_count = len(raw_predictions)
    predictions_truncated = False
    if adapter.spec.family == "sam3":
        raw_predictions, raw_prediction_count, predictions_truncated = _top_predictions(
            raw_predictions,
            MAX_SAM3_PREDICTIONS,
        )

    serialization_threshold = (
        prompts.threshold
        if adapter.spec.family == "sam3" and prompts.text is not None
        else None
    )
    predictions = _serialize_predictions(
        raw_predictions,
        width,
        height,
        serialization_threshold,
    )
    if not predictions:
        raise HTTPException(
            status_code=422,
            detail=(
                "O SAM não encontrou uma máscara acima do limiar solicitado."
                if serialization_threshold is not None
                else "O SAM não encontrou uma máscara utilizável para este prompt."
            ),
        )
    best = predictions[0]
    return {
        "predictions": predictions,
        "polygon": best["polygon"],
        "score": best["score"],
        "width": width,
        "height": height,
        "reused_embedding": reused_embedding,
        "model_id": adapter.spec.model_id,
        "family": adapter.spec.family,
        "raw_prediction_count": raw_prediction_count,
        "predictions_truncated": predictions_truncated,
        "prediction_limit": MAX_SAM3_PREDICTIONS
        if adapter.spec.family == "sam3"
        else None,
    }


def main() -> None:
    global _startup_config
    parser = argparse.ArgumentParser(
        description="Executa SAM 2.1 ou SAM 3 localmente para o Poligome."
    )
    parser.add_argument(
        "--model",
        required=True,
        help="Engine/modelo SAM a carregar.",
    )
    parser.add_argument(
        "--checkpoint",
        help="Caminho para o checkpoint local; nenhum arquivo é baixado pelo conector.",
    )
    parser.add_argument(
        "--model-config",
        help="Nome de configuração Hydra do SAM 2; usa o nome oficial da variante por padrão.",
    )
    parser.add_argument("--device", choices=["auto", "cpu", "cuda", "mps"], default="auto")
    parser.add_argument("--port", type=int, default=7860)
    parser.add_argument(
        "--app-dir",
        help="Raiz das instalações locais; permite trocar de modelo por /load.",
    )
    args = parser.parse_args()
    if not 1 <= args.port <= 65_535:
        parser.error("--port deve estar entre 1 e 65535")

    global _app_dir, _startup_port
    if args.app_dir:
        _app_dir = Path(args.app_dir).expanduser().resolve()
    _startup_port = args.port

    requested_model_id = args.model
    model_id = MODEL_ALIASES.get(requested_model_id, requested_model_id)
    spec = MODEL_SPECS.get(model_id)
    if spec is None:
        parser.error(
            f"--model inválido: {requested_model_id}. "
            f"Disponíveis: {', '.join(sorted((*MODEL_SPECS, *MODEL_ALIASES)))}"
        )
    if not args.checkpoint:
        parser.error(f"--checkpoint é obrigatório para {spec.model_id}.")
    _startup_config = LoadConfig(
        spec=spec,
        checkpoint=args.checkpoint,
        model_config=args.model_config,
        requested_device=args.device,
    )
    _update_runtime(
        status="loading",
        model_id=spec.model_id,
        family=spec.family,
        model_type=spec.model_type,
        device="carregando",
        capabilities=list(spec.capabilities),
        error=None,
    )
    print(
        f"Poligome SAM ouvindo em http://127.0.0.1:{args.port}; "
        f"{model_id} será carregado em segundo plano.",
        flush=True,
    )
    uvicorn.run(app, host="127.0.0.1", port=args.port, log_level="info")


if __name__ == "__main__":
    main()
