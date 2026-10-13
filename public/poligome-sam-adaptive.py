#!/usr/bin/env python3
"""Adaptive AI do Poligome: adaptação progressiva do SAM 2.1 por LoRA.

Este módulo é carregado pelo conector local (`poligome-sam-local.py`) quando
está na mesma pasta. Ele nunca baixa nada, nunca envia imagens para fora da
máquina e nunca altera o checkpoint original: o adaptador LoRA é um arquivo à
parte, aplicado por cima do modelo carregado e removível a qualquer momento.

O ciclo implementado é:

    anotações aprovadas → avaliação do dataset → treino LoRA → validação
    → comparação com o modelo em uso → ativação opcional → novas anotações

Decisões de projeto (ver docs/adaptive-ai.md para a justificativa completa):

* Só a família SAM 2 (SAM 2.1 e MedSAM2) é suportada. SAM 3 e BYOM têm
  arquiteturas e caminhos de inferência diferentes; o módulo recusa em vez de
  presumir compatibilidade.
* O LoRA entra nas projeções de atenção do mask decoder e, opcionalmente, nas
  projeções qkv/proj dos últimos blocos do encoder Hiera. Todo o resto fica
  congelado. Com B inicializado em zero, o modelo adaptado é idêntico ao base
  antes do primeiro passo de otimização.
* A divisão treino/avaliação é por grupo independente (mesma origem, nome em
  sequência ou quase-duplicata visual). O conjunto de avaliação ("holdout") é
  congelado na primeira rodada e nunca é usado para escolher a época: o early
  stopping usa uma validação interna tirada dos grupos de treino.
* Um candidato só é recomendado quando o ganho no holdout tem intervalo de
  confiança (bootstrap por grupo) inteiramente acima de zero e acima do efeito
  mínimo, sem regressão significativa em subgrupos.
"""

from __future__ import annotations

import base64
import binascii
import contextlib
import copy
import gc
import hashlib
import io
import json
import math
import os
import re
import shutil
import threading
import time
import traceback
import uuid
from dataclasses import asdict, dataclass, field, fields
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Iterable, Iterator

import cv2
import numpy as np
from PIL import Image, ImageOps

try:  # o conector sempre roda com torch; os utilitários puros não precisam dele
    import torch
    from torch import nn
    import torch.nn.functional as F

    TORCH_AVAILABLE = True
except Exception:  # pragma: no cover - ambiente sem torch
    torch = None  # type: ignore[assignment]
    nn = None  # type: ignore[assignment]
    F = None  # type: ignore[assignment]
    TORCH_AVAILABLE = False


ADAPTIVE_API_VERSION = 1
LORA_FORMAT = "poligome-lora"
LORA_FORMAT_VERSION = 1
SUPPORTED_FAMILIES = ("sam2",)

PROJECT_ID_PATTERN = re.compile(r"^[a-z0-9][a-z0-9-]{7,63}$")
ITEM_KEY_PATTERN = re.compile(r"^[A-Za-z0-9_-]{8,96}$")
RUN_ID_PATTERN = re.compile(r"^run-[0-9]{8}t[0-9]{6}z-[a-f0-9]{6}$")
EXAMPLE_NAME_PATTERN = re.compile(r"^example-[0-9]{2}\.png$")

ACCEPTED_ORIGINS = ("manual", "corrected_prediction", "reviewed_prediction")
MAX_INSTANCES_PER_ITEM = 200
MAX_POLYGON_POINTS = 20_000
MIN_INSTANCE_AREA_PX = 16
MAX_ITEMS_PER_PROJECT = 5_000

SIZE_BINS = (("small", 0.0, 0.01), ("medium", 0.01, 0.10), ("large", 0.10, 1.01))


# ---------------------------------------------------------------------------
# Configuração
# ---------------------------------------------------------------------------


@dataclass
class ReadinessConfig:
    """Limiares da avaliação de prontidão. Heurísticos e documentados.

    A faixa de referência de 20–40 imagens independentes vem da prática com
    adaptação de modelos fundacionais de segmentação; não é garantia de nada,
    só o ponto em que um experimento começa a ter chance de ser medido.
    """

    min_approved_images: int = 6
    min_instances: int = 15
    min_independent_experimental: int = 12
    target_independent: int = 24
    min_holdout_groups: int = 4
    target_holdout_groups: int = 6
    min_holdout_instances: int = 10
    min_class_instances: int = 5
    redundancy_warning: float = 0.4
    holdout_fraction: float = 0.25
    dhash_max_distance: int = 6
    thumb_min_correlation: float = 0.97
    # Desligado por padrão: o cosseno entre embeddings agregados do SAM não é
    # calibrado (com pesos aleatórios, todas as imagens passam de 0,985), então
    # não serve como prova de duplicata. Ver docs/adaptive-ai.md.
    embedding_min_cosine: float | None = None
    retrain_min_new_groups: int = 4
    retrain_new_group_fraction: float = 0.25


@dataclass
class TrainConfig:
    """Hiperparâmetros do treino. Os valores 0/"auto" são resolvidos por heurística."""

    strategy: str = "auto"  # auto | decoder | encoder_decoder
    rank: int = 8
    alpha: float = 16.0
    dropout: float = 0.05
    encoder_blocks: int = 4
    learning_rate: float = 0.0
    weight_decay: float = 0.01
    batch_size: int = 4
    max_epochs: int = 0
    min_epochs: int = 3
    patience: int = 5
    min_delta: float = 0.002
    max_instances_per_image: int = 8
    internal_val_fraction: float = 0.2
    min_internal_val_groups: int = 2
    augment_hflip: bool = True
    augment_vflip: bool = False
    augment_color: bool = True
    seed: int = 1234
    max_clicks: int = 8
    bootstrap_samples: int = 2000
    min_effect: float = 0.01

    def validated(self) -> "TrainConfig":
        checks = [
            (self.strategy in ("auto", "decoder", "encoder_decoder"), "strategy"),
            (1 <= self.rank <= 64, "rank"),
            (0.5 <= self.alpha <= 256, "alpha"),
            (0.0 <= self.dropout <= 0.5, "dropout"),
            (0 <= self.encoder_blocks <= 48, "encoder_blocks"),
            (self.learning_rate == 0 or 1e-6 <= self.learning_rate <= 1e-2, "learning_rate"),
            (0.0 <= self.weight_decay <= 1.0, "weight_decay"),
            (1 <= self.batch_size <= 64, "batch_size"),
            (0 <= self.max_epochs <= 300, "max_epochs"),
            (1 <= self.min_epochs <= 300, "min_epochs"),
            (1 <= self.patience <= 100, "patience"),
            (0.0 <= self.min_delta <= 0.2, "min_delta"),
            (1 <= self.max_instances_per_image <= 64, "max_instances_per_image"),
            (0.05 <= self.internal_val_fraction <= 0.5, "internal_val_fraction"),
            (1 <= self.min_internal_val_groups <= 50, "min_internal_val_groups"),
            (1 <= self.max_clicks <= 20, "max_clicks"),
            (100 <= self.bootstrap_samples <= 20_000, "bootstrap_samples"),
            (0.0 <= self.min_effect <= 0.5, "min_effect"),
        ]
        for ok, name in checks:
            if not ok:
                raise ValueError(f"configuração de treino inválida: {name}")
        return self

    @classmethod
    def from_mapping(cls, raw: dict[str, Any] | None) -> "TrainConfig":
        config = cls()
        if not raw:
            return config.validated()
        allowed = {item.name: item.type for item in fields(cls)}
        for key, value in raw.items():
            if key not in allowed:
                raise ValueError(f"parâmetro de treino desconhecido: {key}")
            current = getattr(config, key)
            if isinstance(current, bool):
                if not isinstance(value, bool):
                    raise ValueError(f"{key} deve ser booleano")
            elif isinstance(current, int):
                if isinstance(value, bool) or not isinstance(value, (int, float)) or int(value) != value:
                    raise ValueError(f"{key} deve ser inteiro")
                value = int(value)
            elif isinstance(current, float):
                if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(float(value)):
                    raise ValueError(f"{key} deve ser numérico")
                value = float(value)
            elif isinstance(current, str):
                if not isinstance(value, str):
                    raise ValueError(f"{key} deve ser texto")
            setattr(config, key, value)
        return config.validated()


# ---------------------------------------------------------------------------
# Utilitários de arquivo e tempo
# ---------------------------------------------------------------------------


def _now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _write_json_atomic(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    partial = path.with_name(f".{path.name}.{uuid.uuid4().hex[:8]}.part")
    partial.write_text(json.dumps(payload, ensure_ascii=False, indent=1, allow_nan=False), encoding="utf-8")
    os.replace(partial, path)


def _read_json(path: Path, default: Any = None) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return default


def _append_jsonl(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(payload, ensure_ascii=False, allow_nan=False) + "\n")


def _stable_hash(*parts: str) -> str:
    digest = hashlib.sha256()
    for part in parts:
        digest.update(part.encode("utf-8"))
        digest.update(b"\x00")
    return digest.hexdigest()


def _hash_fraction(*parts: str) -> float:
    return int(_stable_hash(*parts)[:12], 16) / float(16**12)


def _finite(value: float, default: float = 0.0) -> float:
    return float(value) if value is not None and math.isfinite(float(value)) else default


def new_run_id() -> str:
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dt%H%M%Sz")
    return f"run-{stamp}-{uuid.uuid4().hex[:6]}"


# ---------------------------------------------------------------------------
# LoRA
# ---------------------------------------------------------------------------

# Projeções de atenção do mask decoder do SAM 2 (self-attention dos tokens,
# atenção cruzada token→imagem e imagem→token, e a atenção final).
DECODER_TARGET_PATTERN = re.compile(
    r"^sam_mask_decoder\.transformer\.(layers\.\d+\.(self_attn|cross_attn_token_to_image|cross_attn_image_to_token)"
    r"|final_attn_token_to_image)\.(q_proj|k_proj|v_proj|out_proj)$"
)
ENCODER_TARGET_PATTERN = re.compile(r"^image_encoder\.trunk\.blocks\.(\d+)\.attn\.(qkv|proj)$")


if TORCH_AVAILABLE:

    class LoRALinear(nn.Module):
        """Uma camada linear congelada com um desvio de posto baixo treinável.

        y = W x + b + (alpha / r) · B A dropout(x), com B = 0 na criação, de modo
        que o modelo adaptado começa exatamente igual ao modelo base.
        """

        def __init__(self, base: "nn.Linear", rank: int, alpha: float, dropout: float):
            super().__init__()
            if not isinstance(base, nn.Linear):
                raise TypeError("LoRA só envolve nn.Linear")
            self.base = base
            self.rank = int(rank)
            self.alpha = float(alpha)
            self.scaling = self.alpha / self.rank
            weight = base.weight
            self.lora_A = nn.Parameter(torch.empty(self.rank, base.in_features, device=weight.device, dtype=torch.float32))
            self.lora_B = nn.Parameter(torch.zeros(base.out_features, self.rank, device=weight.device, dtype=torch.float32))
            nn.init.kaiming_uniform_(self.lora_A, a=math.sqrt(5))
            self.lora_dropout = nn.Dropout(dropout) if dropout > 0 else nn.Identity()
            self.enabled = True

        @property
        def in_features(self) -> int:
            return self.base.in_features

        @property
        def out_features(self) -> int:
            return self.base.out_features

        @property
        def weight(self):  # alguns módulos leem .weight para descobrir dtype/dispositivo
            return self.base.weight

        @property
        def bias(self):
            return self.base.bias

        def forward(self, x):
            result = self.base(x)
            if not self.enabled:
                return result
            hidden = self.lora_dropout(x).to(self.lora_A.dtype)
            delta = (hidden @ self.lora_A.t()) @ self.lora_B.t()
            return result + (delta * self.scaling).to(result.dtype)


def _require_torch() -> None:
    if not TORCH_AVAILABLE:
        raise RuntimeError("PyTorch não está disponível neste ambiente.")


def _get_submodule(model: Any, name: str) -> Any:
    module = model
    for part in name.split("."):
        module = getattr(module, part)
    return module


def _set_submodule(model: Any, name: str, value: Any) -> None:
    parent_name, _, child = name.rpartition(".")
    parent = _get_submodule(model, parent_name) if parent_name else model
    setattr(parent, child, value)


def resolve_lora_targets(model: Any, strategy: str, encoder_blocks: int = 4) -> list[str]:
    """Nomes das camadas lineares que recebem LoRA nesta estratégia.

    `decoder` usa só o mask decoder; `encoder_decoder` acrescenta qkv e proj dos
    últimos `encoder_blocks` blocos do encoder Hiera. Um modelo sem nenhuma
    dessas camadas não é um SAM 2 e é recusado.
    """
    _require_torch()
    linear_names = [name for name, module in model.named_modules() if isinstance(module, nn.Linear)]
    decoder = [name for name in linear_names if DECODER_TARGET_PATTERN.match(name)]
    if not decoder:
        raise ValueError("o modelo carregado não expõe o mask decoder do SAM 2; LoRA não é compatível")
    if strategy == "decoder":
        return decoder
    if strategy != "encoder_decoder":
        raise ValueError(f"estratégia LoRA desconhecida: {strategy}")
    encoder_by_block: dict[int, list[str]] = {}
    for name in linear_names:
        match = ENCODER_TARGET_PATTERN.match(name)
        if match:
            encoder_by_block.setdefault(int(match.group(1)), []).append(name)
    if not encoder_by_block:
        raise ValueError("o encoder do modelo carregado não é um Hiera do SAM 2")
    chosen_blocks = sorted(encoder_by_block)[-encoder_blocks:] if encoder_blocks > 0 else []
    encoder = [name for block in chosen_blocks for name in sorted(encoder_by_block[block])]
    return encoder + decoder


def lora_modules(model: Any) -> dict[str, Any]:
    _require_torch()
    return {name: module for name, module in model.named_modules() if isinstance(module, LoRALinear)}


def inject_lora(model: Any, targets: Iterable[str], rank: int, alpha: float, dropout: float) -> dict[str, Any]:
    _require_torch()
    if lora_modules(model):
        raise RuntimeError("o modelo já tem LoRA aplicado; remova antes de aplicar outro")
    injected = {}
    for name in targets:
        base = _get_submodule(model, name)
        if not isinstance(base, nn.Linear):
            raise ValueError(f"{name} não é uma camada linear")
        wrapper = LoRALinear(base, rank, alpha, dropout)
        _set_submodule(model, name, wrapper)
        injected[name] = wrapper
    return injected


def remove_lora(model: Any) -> int:
    """Devolve cada camada original ao seu lugar: o modelo volta a ser o base, bit a bit."""
    _require_torch()
    modules = lora_modules(model)
    for name, module in modules.items():
        _set_submodule(model, name, module.base)
    return len(modules)


def set_lora_enabled(model: Any, enabled: bool) -> None:
    for module in lora_modules(model).values():
        module.enabled = bool(enabled)


@contextlib.contextmanager
def lora_disabled(model: Any) -> Iterator[None]:
    modules = lora_modules(model) if TORCH_AVAILABLE else {}
    previous = {name: module.enabled for name, module in modules.items()}
    try:
        for module in modules.values():
            module.enabled = False
        yield
    finally:
        for name, module in modules.items():
            module.enabled = previous[name]


def freeze_base_parameters(model: Any) -> tuple[int, int]:
    """Congela tudo que não é LoRA. Devolve (treináveis, total)."""
    _require_torch()
    trainable = 0
    total = 0
    for name, parameter in model.named_parameters():
        is_lora = name.endswith(".lora_A") or name.endswith(".lora_B")
        parameter.requires_grad_(is_lora)
        total += parameter.numel()
        if is_lora:
            trainable += parameter.numel()
    return trainable, total


def lora_state_dict(model: Any) -> dict[str, Any]:
    state = {}
    for name, module in lora_modules(model).items():
        state[f"{name}.lora_A"] = module.lora_A.detach().to("cpu", copy=True)
        state[f"{name}.lora_B"] = module.lora_B.detach().to("cpu", copy=True)
    return state


def load_lora_state(model: Any, state: dict[str, Any]) -> None:
    modules = lora_modules(model)
    expected = {f"{name}.{part}" for name in modules for part in ("lora_A", "lora_B")}
    if set(state) != expected:
        missing = sorted(expected - set(state))[:3]
        extra = sorted(set(state) - expected)[:3]
        raise ValueError(f"pesos LoRA não conferem com o modelo (faltando {missing}, sobrando {extra})")
    with torch.no_grad():
        for name, module in modules.items():
            for part in ("lora_A", "lora_B"):
                tensor = state[f"{name}.{part}"]
                target = getattr(module, part)
                if tuple(tensor.shape) != tuple(target.shape):
                    raise ValueError(f"forma incompatível em {name}.{part}")
                target.copy_(tensor.to(device=target.device, dtype=target.dtype))


def save_adapter(path: Path, metadata: dict[str, Any], state: dict[str, Any]) -> str:
    """Grava atomicamente e devolve o sha256 do arquivo."""
    _require_torch()
    payload = {
        "format": LORA_FORMAT,
        "format_version": LORA_FORMAT_VERSION,
        "metadata": json.dumps(metadata, ensure_ascii=False, sort_keys=True),
        "state": {key: value.contiguous() for key, value in state.items()},
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    partial = path.with_name(f".{path.name}.{uuid.uuid4().hex[:8]}.part")
    torch.save(payload, partial)
    digest = hashlib.sha256(partial.read_bytes()).hexdigest()
    os.replace(partial, path)
    return digest


def load_adapter(path: Path) -> tuple[dict[str, Any], dict[str, Any]]:
    """Lê um adaptador sem executar código: `weights_only=True` recusa pickle arbitrário."""
    _require_torch()
    payload = torch.load(path, map_location="cpu", weights_only=True)
    if not isinstance(payload, dict) or payload.get("format") != LORA_FORMAT:
        raise ValueError("arquivo não é um adaptador LoRA do Poligome")
    if payload.get("format_version") != LORA_FORMAT_VERSION:
        raise ValueError("versão de adaptador não suportada")
    metadata = json.loads(payload.get("metadata") or "{}")
    state = payload.get("state")
    if not isinstance(state, dict) or not state:
        raise ValueError("adaptador sem pesos")
    return metadata, state


def apply_adapter(model: Any, metadata: dict[str, Any], state: dict[str, Any]) -> None:
    """Remove qualquer LoRA atual e aplica este, conferindo forma por forma."""
    lora = metadata.get("lora") or {}
    targets = lora.get("targets") or []
    if not targets:
        raise ValueError("adaptador sem camadas-alvo")
    remove_lora(model)
    try:
        inject_lora(model, targets, int(lora["rank"]), float(lora["alpha"]), 0.0)
        load_lora_state(model, state)
    except Exception:
        remove_lora(model)
        raise
    for module in lora_modules(model).values():
        module.eval()


# ---------------------------------------------------------------------------
# Máscaras, prompts e métricas (numpy puro)
# ---------------------------------------------------------------------------


def _flat_to_points(flat: Any, width: int, height: int) -> np.ndarray | None:
    if not isinstance(flat, list) or len(flat) < 6 or len(flat) % 2 or len(flat) > MAX_POLYGON_POINTS * 2:
        return None
    try:
        values = np.asarray([float(value) for value in flat], dtype=np.float64)
    except (TypeError, ValueError):
        return None
    if not np.all(np.isfinite(values)):
        return None
    points = values.reshape(-1, 2)
    points[:, 0] = np.clip(points[:, 0], 0, width)
    points[:, 1] = np.clip(points[:, 1], 0, height)
    return np.round(points).astype(np.int32)


def rasterize_instance(polygons: list[Any], holes: list[Any], width: int, height: int) -> np.ndarray:
    """Polígonos (e buracos) em coordenadas de pixel viram uma máscara binária."""
    mask = np.zeros((height, width), dtype=np.uint8)
    outer = [points for points in (_flat_to_points(item, width, height) for item in polygons) if points is not None]
    if not outer:
        return mask.astype(bool)
    cv2.fillPoly(mask, outer, 1)
    inner = [points for points in (_flat_to_points(item, width, height) for item in holes or []) if points is not None]
    if inner:
        cv2.fillPoly(mask, inner, 0)
    return mask.astype(bool)


def mask_bbox(mask: np.ndarray) -> tuple[int, int, int, int] | None:
    rows = np.any(mask, axis=1)
    cols = np.any(mask, axis=0)
    if not rows.any():
        return None
    y0, y1 = np.where(rows)[0][[0, -1]]
    x0, x1 = np.where(cols)[0][[0, -1]]
    return int(x0), int(y0), int(x1) + 1, int(y1) + 1


def interior_point(mask: np.ndarray) -> tuple[float, float]:
    """O ponto mais distante da borda: o clique "no meio do objeto" reprodutível."""
    padded = np.pad(mask.astype(np.uint8), 1)
    distance = cv2.distanceTransform(padded, cv2.DIST_L2, 5)[1:-1, 1:-1]
    y, x = np.unravel_index(int(np.argmax(distance)), distance.shape)
    return float(x) + 0.5, float(y) + 0.5


def sample_interior_point(mask: np.ndarray, rng: np.random.Generator) -> tuple[float, float]:
    """Ponto aleatório dentro do objeto, com peso maior longe da borda."""
    padded = np.pad(mask.astype(np.uint8), 1)
    distance = cv2.distanceTransform(padded, cv2.DIST_L2, 3)[1:-1, 1:-1]
    flat = distance.reshape(-1)
    total = float(flat.sum())
    if total <= 0:
        return interior_point(mask)
    index = int(rng.choice(flat.size, p=flat / total))
    y, x = divmod(index, mask.shape[1])
    return float(x) + 0.5, float(y) + 0.5


def jitter_box(box: tuple[int, int, int, int], width: int, height: int, rng: np.random.Generator, amount: float = 0.1) -> tuple[float, float, float, float]:
    x0, y0, x1, y1 = box
    w = max(1.0, x1 - x0)
    h = max(1.0, y1 - y0)
    noise = rng.normal(0.0, amount, size=4) * np.array([w, h, w, h])
    nx0 = float(np.clip(x0 + noise[0], 0, width - 1))
    ny0 = float(np.clip(y0 + noise[1], 0, height - 1))
    nx1 = float(np.clip(x1 + noise[2], nx0 + 1, width))
    ny1 = float(np.clip(y1 + noise[3], ny0 + 1, height))
    return nx0, ny0, nx1, ny1


def correction_click(prediction: np.ndarray, target: np.ndarray) -> tuple[float, float, int] | None:
    """Próximo clique do protocolo de cliques simulados (RITM/SimpleClick).

    Olha a maior região de erro: falso negativo vira clique positivo no ponto
    mais interno dela; falso positivo vira clique negativo.
    """
    false_negative = np.logical_and(target, ~prediction)
    false_positive = np.logical_and(prediction, ~target)
    fn_distance = cv2.distanceTransform(np.pad(false_negative.astype(np.uint8), 1), cv2.DIST_L2, 5)[1:-1, 1:-1]
    fp_distance = cv2.distanceTransform(np.pad(false_positive.astype(np.uint8), 1), cv2.DIST_L2, 5)[1:-1, 1:-1]
    fn_max = float(fn_distance.max()) if fn_distance.size else 0.0
    fp_max = float(fp_distance.max()) if fp_distance.size else 0.0
    if fn_max <= 0 and fp_max <= 0:
        return None
    positive = fn_max >= fp_max
    distance = fn_distance if positive else fp_distance
    y, x = np.unravel_index(int(np.argmax(distance)), distance.shape)
    return float(x) + 0.5, float(y) + 0.5, 1 if positive else 0


def dice_score(prediction: np.ndarray, target: np.ndarray) -> float:
    total = int(prediction.sum()) + int(target.sum())
    if total == 0:
        return 1.0
    return 2.0 * int(np.logical_and(prediction, target).sum()) / total


def iou_score(prediction: np.ndarray, target: np.ndarray) -> float:
    union = int(np.logical_or(prediction, target).sum())
    if union == 0:
        return 1.0
    return int(np.logical_and(prediction, target).sum()) / union


def _inner_boundary(mask: np.ndarray, width: int) -> np.ndarray:
    kernel = np.ones((3, 3), np.uint8)
    eroded = cv2.erode(mask.astype(np.uint8), kernel, iterations=max(1, width))
    return np.logical_and(mask, ~eroded.astype(bool))


def boundary_iou(prediction: np.ndarray, target: np.ndarray, dilation_ratio: float = 0.02) -> float:
    """Boundary IoU (Cheng et al., 2021): IoU restrita a uma faixa junto à borda.

    Dice e IoU quase não mudam quando um objeto grande perde o contorno fino;
    a faixa de borda mede justamente o que a pessoa corrige à mão.
    """
    height, width = target.shape
    band = max(1, int(round(dilation_ratio * math.hypot(height, width))))
    pred_band = _inner_boundary(prediction, band)
    target_band = _inner_boundary(target, band)
    union = int(np.logical_or(pred_band, target_band).sum())
    if union == 0:
        return 1.0
    return int(np.logical_and(pred_band, target_band).sum()) / union


def size_bin(relative_area: float) -> str:
    for name, low, high in SIZE_BINS:
        if low <= relative_area < high:
            return name
    return "large"


# ---------------------------------------------------------------------------
# Descritores visuais, duplicatas e diversidade
# ---------------------------------------------------------------------------


def image_descriptor(pixels: np.ndarray) -> dict[str, Any]:
    """Descritores baratos, independentes do modelo: dHash, miniatura e cor."""
    gray = cv2.cvtColor(pixels, cv2.COLOR_RGB2GRAY)
    small = cv2.resize(gray, (9, 8), interpolation=cv2.INTER_AREA)
    bits = (small[:, 1:] > small[:, :-1]).reshape(-1)
    dhash = int("".join("1" if bit else "0" for bit in bits), 2)
    thumb = cv2.resize(gray, (32, 32), interpolation=cv2.INTER_AREA).astype(np.float32).reshape(-1)
    thumb -= thumb.mean()
    norm = float(np.linalg.norm(thumb))
    thumb = thumb / norm if norm > 1e-6 else np.zeros_like(thumb)
    quantized = (pixels // 64).reshape(-1, 3).astype(np.int32)
    codes = quantized[:, 0] * 16 + quantized[:, 1] * 4 + quantized[:, 2]
    histogram = np.bincount(codes, minlength=64).astype(np.float32)
    histogram /= max(1.0, float(histogram.sum()))
    return {
        "dhash": f"{dhash:016x}",
        "thumb": [round(float(value), 4) for value in thumb],
        "color": [round(float(value), 5) for value in histogram],
    }


def _hamming(a: str, b: str) -> int:
    return bin(int(a, 16) ^ int(b, 16)).count("1")


def vendi_score(vectors: np.ndarray) -> float:
    """Vendi score (Friedman & Dieng, 2023): número efetivo de exemplos distintos.

    Usa o kernel cosseno (cortado em zero) entre vetores normalizados. Vale 1
    quando todos são iguais e n quando são todos ortogonais.
    """
    if len(vectors) == 0:
        return 0.0
    if len(vectors) == 1:
        return 1.0
    unit = vectors / np.maximum(np.linalg.norm(vectors, axis=1, keepdims=True), 1e-9)
    kernel = np.clip(unit @ unit.T, 0.0, 1.0)
    np.fill_diagonal(kernel, 1.0)
    eigenvalues = np.linalg.eigvalsh(kernel / len(vectors))
    eigenvalues = eigenvalues[eigenvalues > 1e-12]
    entropy = -float(np.sum(eigenvalues * np.log(eigenvalues)))
    return float(math.exp(entropy))


class _UnionFind:
    def __init__(self, keys: Iterable[str]):
        self.parent = {key: key for key in keys}

    def find(self, key: str) -> str:
        root = key
        while self.parent[root] != root:
            root = self.parent[root]
        while self.parent[key] != root:
            self.parent[key], key = root, self.parent[key]
        return root

    def union(self, a: str, b: str) -> None:
        ra, rb = self.find(a), self.find(b)
        if ra != rb:
            if ra < rb:
                self.parent[rb] = ra
            else:
                self.parent[ra] = rb


def group_items(items: list[dict[str, Any]], config: ReadinessConfig) -> tuple[dict[str, str], list[dict[str, Any]]]:
    """Agrupa imagens correlacionadas. Devolve (grupo por item, pares duplicados).

    Duas imagens ficam no mesmo grupo quando o cliente declarou a mesma origem
    (paciente, vídeo, sequência de nomes) ou quando são quase iguais pelo dHash,
    pela miniatura ou pelo embedding do SAM. A regra é conservadora de
    propósito: unir demais só reduz a contagem; unir de menos vaza dados.
    """
    keys = [item["key"] for item in items]
    union = _UnionFind(keys)
    by_group: dict[str, str] = {}
    for item in items:
        declared = item.get("group")
        if declared:
            if declared in by_group:
                union.union(item["key"], by_group[declared])
            else:
                by_group[declared] = item["key"]

    duplicates: list[dict[str, Any]] = []
    descriptors = [item.get("descriptor") or {} for item in items]
    thumbs = [np.asarray(desc.get("thumb") or [], dtype=np.float32) for desc in descriptors]
    embeddings = [item.get("embedding") for item in items]
    for i in range(len(items)):
        for j in range(i + 1, len(items)):
            reason = None
            hash_i, hash_j = descriptors[i].get("dhash"), descriptors[j].get("dhash")
            if hash_i and hash_j and _hamming(hash_i, hash_j) <= config.dhash_max_distance:
                reason = "dhash"
            elif thumbs[i].size and thumbs[i].size == thumbs[j].size and float(thumbs[i] @ thumbs[j]) >= config.thumb_min_correlation:
                reason = "thumbnail"
            elif config.embedding_min_cosine is not None and embeddings[i] is not None and embeddings[j] is not None:
                a, b = embeddings[i], embeddings[j]
                cosine = float(a @ b / max(1e-9, np.linalg.norm(a) * np.linalg.norm(b)))
                if cosine >= config.embedding_min_cosine:
                    reason = "embedding"
            if reason:
                union.union(keys[i], keys[j])
                duplicates.append({"a": keys[i], "b": keys[j], "reason": reason})
    groups = {key: "g-" + _stable_hash(union.find(key))[:12] for key in keys}
    return groups, duplicates


# ---------------------------------------------------------------------------
# Divisão treino / holdout
# ---------------------------------------------------------------------------


def assign_splits(
    groups: dict[str, str],
    previous: dict[str, str],
    salt: str,
    config: ReadinessConfig,
) -> tuple[dict[str, str], dict[str, Any]]:
    """Atribui cada item a "train", "holdout" ou "quarantine".

    Regras, na ordem:
    1. Uma atribuição já congelada nunca muda: é isso que permite comparar
       versões no mesmo holdout.
    2. Um item novo herda o lado do seu grupo. Se o grupo já tem membros dos dois
       lados (uma imagem nova ligou duas antigas), o holdout é preservado e os
       membros de treino desse grupo ficam em quarentena, fora de tudo.
    3. Um grupo inteiramente novo vai para o holdout enquanto ele não tem o
       mínimo de grupos; depois, por sorteio determinístico com a fração alvo.
    4. Sem nenhuma atribuição anterior, os grupos são ordenados pelo hash e o
       holdout recebe a fração alvo (com o mínimo de grupos, se couber).
    """
    members: dict[str, list[str]] = {}
    for key, group in groups.items():
        members.setdefault(group, []).append(key)
    assignment: dict[str, str] = {}
    conflicts = []

    known = {key: side for key, side in previous.items() if key in groups and side in ("train", "holdout")}
    holdout_groups = {groups[key] for key, side in known.items() if side == "holdout"}

    if not known:
        ordered = sorted(members, key=lambda group: _stable_hash(salt, group))
        target = max(config.min_holdout_groups, int(round(config.holdout_fraction * len(ordered))))
        # Nunca mais da metade dos grupos, para sobrar treino.
        target = min(target, len(ordered) // 2)
        chosen = set(ordered[:target])
        for group, keys in members.items():
            for key in keys:
                assignment[key] = "holdout" if group in chosen else "train"
        return assignment, {"frozen_now": True, "conflicts": []}

    for group, keys in sorted(members.items()):
        sides = {known[key] for key in keys if key in known}
        if sides == {"train", "holdout"}:
            conflicts.append(group)
            for key in keys:
                assignment[key] = "holdout" if known.get(key) == "holdout" else "quarantine"
            continue
        if sides:
            side = sides.pop()
            for key in keys:
                assignment[key] = side
            continue
        if len(holdout_groups) < config.min_holdout_groups:
            side = "holdout"
        else:
            side = "holdout" if _hash_fraction(salt, group) < config.holdout_fraction else "train"
        if side == "holdout":
            holdout_groups.add(group)
        for key in keys:
            assignment[key] = side
    return assignment, {"frozen_now": False, "conflicts": conflicts}


def internal_validation_split(train_groups: list[str], seed: int, fraction: float, minimum: int) -> set[str]:
    """Grupos de treino separados para o early stopping desta rodada."""
    unique = sorted(set(train_groups))
    if len(unique) < minimum + 2:
        return set()
    ordered = sorted(unique, key=lambda group: _stable_hash(str(seed), group))
    count = max(minimum, int(round(fraction * len(unique))))
    count = min(count, len(unique) - 2)
    return set(ordered[:count])


# ---------------------------------------------------------------------------
# Estatística da comparação
# ---------------------------------------------------------------------------


def cluster_bootstrap(values: list[float], clusters: list[str], samples: int, seed: int) -> tuple[float, float, float]:
    """Média e IC 95% por bootstrap reamostrando grupos inteiros.

    Reamostrar imagens soltas trataria duas fatias do mesmo exame como
    evidências independentes e estreitaria o intervalo artificialmente.
    """
    if not values:
        return 0.0, 0.0, 0.0
    array = np.asarray(values, dtype=np.float64)
    mean = float(array.mean())
    by_cluster: dict[str, list[int]] = {}
    for index, cluster in enumerate(clusters):
        by_cluster.setdefault(cluster, []).append(index)
    groups = list(by_cluster.values())
    if len(groups) < 2:
        return mean, mean, mean
    rng = np.random.default_rng(seed)
    sums = np.asarray([array[indices].sum() for indices in groups])
    counts = np.asarray([len(indices) for indices in groups], dtype=np.float64)
    picks = rng.integers(0, len(groups), size=(samples, len(groups)))
    means = sums[picks].sum(axis=1) / counts[picks].sum(axis=1)
    low, high = np.percentile(means, [2.5, 97.5])
    return mean, float(low), float(high)


def decide_promotion(summary: dict[str, Any], config: TrainConfig, readiness: ReadinessConfig) -> dict[str, Any]:
    """Três desfechos: improved, not_improved ou insufficient_evidence.

    A regra olha o intervalo de confiança do ganho por imagem no holdout, não a
    loss de treino:
      * holdout pequeno demais → evidência insuficiente;
      * IC inteiro acima de zero, média ≥ efeito mínimo, sem regressão
        significativa em subgrupo, poucas imagens pioradas e cliques simulados
        não piores → melhorou;
      * IC inteiro abaixo do efeito mínimo, ou regressão significativa → não
        melhorou (o modelo anterior é mantido);
      * qualquer outro caso (o IC cruza o efeito mínimo) → evidência insuficiente.
    """
    reasons: list[dict[str, Any]] = []
    primary = summary["primary"]
    holdout = summary["holdout"]
    if holdout["groups"] < readiness.min_holdout_groups or holdout["instances"] < readiness.min_holdout_instances:
        reasons.append({"code": "small_holdout", "params": {"groups": holdout["groups"], "instances": holdout["instances"]}})
        return {"outcome": "insufficient_evidence", "reasons": reasons}
    regressions = [sub for sub in summary.get("subgroups", []) if sub.get("regression") == "significant"]
    worsened = primary["share_worsened"]
    noc_delta = summary.get("interactive", {}).get("noc90_delta")
    if regressions:
        reasons.append({"code": "subgroup_regression", "params": {"subgroups": [sub["name"] for sub in regressions]}})
    if primary["ci_low"] > 0 and primary["mean_delta"] >= config.min_effect and not regressions and worsened <= 0.25 and (noc_delta is None or noc_delta <= 0.5):
        reasons.append({"code": "ci_above_zero", "params": {"low": primary["ci_low"], "high": primary["ci_high"]}})
        return {"outcome": "improved", "reasons": reasons}
    if regressions:
        return {"outcome": "not_improved", "reasons": reasons}
    if primary["ci_high"] < config.min_effect:
        reasons.append({"code": "ci_below_min_effect", "params": {"high": primary["ci_high"], "min_effect": config.min_effect}})
        return {"outcome": "not_improved", "reasons": reasons}
    if worsened > 0.25:
        reasons.append({"code": "many_worsened", "params": {"share": worsened}})
    if noc_delta is not None and noc_delta > 0.5:
        reasons.append({"code": "more_clicks", "params": {"delta": noc_delta}})
    reasons.append({"code": "ci_crosses_min_effect", "params": {"low": primary["ci_low"], "high": primary["ci_high"], "min_effect": config.min_effect}})
    return {"outcome": "insufficient_evidence", "reasons": reasons}


# ---------------------------------------------------------------------------
# Diagnóstico de convergência
# ---------------------------------------------------------------------------


def diagnose_convergence(epochs: list[dict[str, Any]], config: TrainConfig) -> dict[str, Any]:
    """Classifica a curva de treino com critérios explícitos.

    Considera só a validação interna (grupos fora do treino), nunca a loss de
    treino sozinha:
      * in_progress: menos de 3 épocas avaliadas;
      * overfitting: a loss de validação subiu ≥ 5% acima do seu mínimo por 3
        épocas seguidas enquanto a de treino caiu;
      * improving: o Dice de validação melhorou ≥ min_delta nas últimas
        `patience` épocas;
      * converged: nenhuma melhora ≥ min_delta em `patience` épocas e a loss de
        treino variou < 2% nas últimas 3;
      * inconclusive: o ganho acumulado sobre a época 0 é menor que o ruído da
        própria curva (desvio-padrão das últimas 5 épocas), ou nada acima.
    """
    evaluated = [epoch for epoch in epochs if epoch.get("val_dice") is not None]
    if len(evaluated) < 4:  # época 0 + três de treino
        return {"state": "in_progress", "best_epoch": _best_epoch(evaluated)}
    best_epoch = _best_epoch(evaluated)
    val_losses = [epoch["val_loss"] for epoch in evaluated]
    train_losses = [epoch.get("train_loss") for epoch in evaluated[1:] if epoch.get("train_loss") is not None]
    min_val_loss = min(val_losses)
    tail = evaluated[-3:]
    if (
        len(train_losses) >= 3
        and all(epoch["val_loss"] >= 1.05 * min_val_loss for epoch in tail)
        and train_losses[-1] < train_losses[-3]
        and evaluated[-1]["epoch"] - best_epoch >= 3
    ):
        return {"state": "overfitting", "best_epoch": best_epoch}
    dices = [epoch["val_dice"] for epoch in evaluated]
    baseline = dices[0]
    best = max(dices)
    noise = float(np.std(dices[-5:])) if len(dices) >= 5 else 0.0
    recent_window = evaluated[-config.patience:]
    earlier_best = max(dices[: max(1, len(dices) - len(recent_window))])
    if max(epoch["val_dice"] for epoch in recent_window) >= earlier_best + config.min_delta:
        return {"state": "improving", "best_epoch": best_epoch}
    if best - baseline <= max(noise, config.min_delta):
        return {"state": "inconclusive", "best_epoch": best_epoch}
    if len(train_losses) >= 3:
        reference = max(1e-9, abs(train_losses[-3]))
        if abs(train_losses[-1] - train_losses[-3]) / reference < 0.02:
            return {"state": "converged", "best_epoch": best_epoch}
    return {"state": "converged", "best_epoch": best_epoch}


def _best_epoch(evaluated: list[dict[str, Any]]) -> int:
    if not evaluated:
        return 0
    best = max(evaluated, key=lambda epoch: (round(epoch["val_dice"], 6), -epoch["val_loss"]))
    return int(best["epoch"])


# ---------------------------------------------------------------------------
# SAM 2: o mesmo caminho do SAM2ImagePredictor, mas diferenciável
# ---------------------------------------------------------------------------


class Sam2Segmenter:
    """Encoder e decoder do SAM 2 chamados como o preditor oficial os chama.

    O SAM2ImagePredictor roda tudo sob `no_grad`; aqui o mesmo pré-processamento
    (redimensionar para o lado do modelo e normalizar com a média/desvio do
    ImageNet), as mesmas features e os mesmos prompts, mas com gradiente
    opcional. Pontos e caixas entram como no preditor: a caixa vira dois pontos
    com rótulos 2 e 3.
    """

    MEAN = (0.485, 0.456, 0.406)
    STD = (0.229, 0.224, 0.225)

    def __init__(self, model: Any, device: str):
        _require_torch()
        self.model = model
        self.device = torch.device(device)
        self.resolution = int(getattr(model, "image_size", 1024))
        self.mean = torch.tensor(self.MEAN, device=self.device).view(1, 3, 1, 1)
        self.std = torch.tensor(self.STD, device=self.device).view(1, 3, 1, 1)
        sizes = [self.resolution // 4, self.resolution // 8, self.resolution // 16]
        self.feature_sizes = [(size, size) for size in sizes]

    def preprocess(self, pixels: np.ndarray) -> Any:
        tensor = torch.from_numpy(np.ascontiguousarray(pixels)).to(self.device).permute(2, 0, 1)[None].float() / 255.0
        tensor = F.interpolate(tensor, size=(self.resolution, self.resolution), mode="bilinear", align_corners=False, antialias=True)
        return (tensor - self.mean) / self.std

    def encode(self, image_tensor: Any) -> dict[str, Any]:
        model = self.model
        backbone_out = model.forward_image(image_tensor)
        _, vision_feats, _, _ = model._prepare_backbone_features(backbone_out)
        if getattr(model, "directly_add_no_mem_embed", False):
            vision_feats[-1] = vision_feats[-1] + model.no_mem_embed
        feats = [
            feat.permute(1, 2, 0).reshape(1, -1, *size)
            for feat, size in zip(vision_feats[::-1], self.feature_sizes[::-1])
        ][::-1]
        return {"image_embed": feats[-1], "high_res_feats": feats[:-1]}

    def decode(self, features: dict[str, Any], coords: Any, labels: Any, mask_input: Any = None) -> tuple[Any, Any]:
        """Uma máscara por prompt (multimask desligado, como o editor pede)."""
        model = self.model
        sparse, dense = model.sam_prompt_encoder(points=(coords, labels), boxes=None, masks=mask_input)
        batch = coords.shape[0]
        low_res, iou, _, _ = model.sam_mask_decoder(
            image_embeddings=features["image_embed"],
            image_pe=model.sam_prompt_encoder.get_dense_pe(),
            sparse_prompt_embeddings=sparse,
            dense_prompt_embeddings=dense,
            multimask_output=False,
            repeat_image=batch > 1,
            high_res_features=features["high_res_feats"],
        )
        return low_res, iou

    def prompt_tensors(self, prompts: list[dict[str, Any]], width: int, height: int) -> tuple[Any, Any]:
        """Converte prompts em pixels da imagem para o espaço do modelo, com padding."""
        scale = np.array([self.resolution / width, self.resolution / height], dtype=np.float32)
        rows = []
        for prompt in prompts:
            coords: list[list[float]] = []
            labels: list[int] = []
            if prompt.get("box") is not None:
                x0, y0, x1, y1 = prompt["box"]
                coords += [[x0, y0], [x1, y1]]
                labels += [2, 3]
            for x, y, label in prompt.get("points", []):
                coords.append([x, y])
                labels.append(int(label))
            rows.append((np.asarray(coords, dtype=np.float32) * scale, labels))
        length = max(len(labels) for _, labels in rows)
        coords_array = np.zeros((len(rows), length, 2), dtype=np.float32)
        labels_array = np.full((len(rows), length), -1, dtype=np.int64)
        for index, (coords, labels) in enumerate(rows):
            coords_array[index, : len(labels)] = coords
            labels_array[index, : len(labels)] = labels
        return (
            torch.from_numpy(coords_array).to(self.device),
            torch.from_numpy(labels_array).to(self.device).int(),
        )

    def upsample(self, low_res: Any, height: int, width: int) -> Any:
        return F.interpolate(low_res.float(), size=(height, width), mode="bilinear", align_corners=False)


def pooled_embedding(segmenter: Sam2Segmenter, pixels: np.ndarray) -> np.ndarray:
    """Média e desvio espaciais do image_embed: descritor de diversidade do domínio."""
    with torch.inference_mode(), lora_disabled(segmenter.model):
        features = segmenter.encode(segmenter.preprocess(pixels))
    embed = features["image_embed"][0].float()
    vector = torch.cat([embed.mean(dim=(1, 2)), embed.std(dim=(1, 2))])
    return vector.cpu().numpy().astype(np.float32)


# ---------------------------------------------------------------------------
# Armazenamento por projeto
# ---------------------------------------------------------------------------


class ProjectStore:
    """Tudo de um projeto fica numa pasta própria, nomeada por um id validado.

    <raiz>/projects/<projeto>/
        project.json        sal do sorteio e metadados
        items/<chave>/      imagem, máscaras e item.json
        embeddings/         cache de embeddings por modelo base
        split.json          atribuição congelada treino/holdout
        snapshots/<id>.json o dataset exato usado em cada rodada
        runs/<run>/         registro, métricas, adaptador e exemplos
        history.jsonl       ativações, desativações e reversões
    """

    def __init__(self, root: Path, project_id: str):
        if not PROJECT_ID_PATTERN.fullmatch(project_id):
            raise ValueError("id de projeto inválido")
        self.project_id = project_id
        self.root = root / "projects" / project_id
        self.items_dir = self.root / "items"
        self.runs_dir = self.root / "runs"

    def ensure(self) -> dict[str, Any]:
        meta_path = self.root / "project.json"
        meta = _read_json(meta_path)
        if not isinstance(meta, dict):
            meta = {"project_id": self.project_id, "salt": uuid.uuid4().hex, "created_at": _now_iso()}
            _write_json_atomic(meta_path, meta)
        return meta

    # --- itens ---------------------------------------------------------

    def item_dir(self, key: str) -> Path:
        if not ITEM_KEY_PATTERN.fullmatch(key):
            raise ValueError("chave de item inválida")
        return self.items_dir / key

    def list_items(self) -> list[dict[str, Any]]:
        items = []
        try:
            directories = sorted(path for path in self.items_dir.iterdir() if path.is_dir())
        except OSError:
            return items
        for directory in directories:
            record = _read_json(directory / "item.json")
            if isinstance(record, dict) and record.get("key") == directory.name:
                items.append(record)
        return items

    def fingerprints(self) -> dict[str, str]:
        return {item["key"]: item.get("fingerprint", "") for item in self.list_items()}

    def delete_item(self, key: str) -> bool:
        directory = self.item_dir(key)
        if not directory.is_dir():
            return False
        shutil.rmtree(directory)
        return True

    def load_image(self, item: dict[str, Any]) -> np.ndarray:
        path = self.item_dir(item["key"]) / item["image_file"]
        with Image.open(path) as source:
            return np.array(source.convert("RGB"), dtype=np.uint8)

    def load_mask(self, item: dict[str, Any], instance: dict[str, Any]) -> np.ndarray:
        path = self.item_dir(item["key"]) / instance["mask_file"]
        mask = cv2.imread(str(path), cv2.IMREAD_GRAYSCALE)
        if mask is None:
            raise FileNotFoundError(f"máscara ausente: {item['key']}/{instance['mask_file']}")
        return mask > 127

    # --- divisão, snapshots e execuções ---------------------------------

    def split(self) -> dict[str, str]:
        raw = _read_json(self.root / "split.json", {})
        return dict(raw.get("assignment", {})) if isinstance(raw, dict) else {}

    def save_split(self, assignment: dict[str, str]) -> None:
        _write_json_atomic(self.root / "split.json", {"updated_at": _now_iso(), "assignment": assignment})

    def run_dir(self, run_id: str) -> Path:
        if not RUN_ID_PATTERN.fullmatch(run_id):
            raise ValueError("id de execução inválido")
        return self.runs_dir / run_id

    def list_runs(self) -> list[dict[str, Any]]:
        runs = []
        try:
            directories = sorted((path for path in self.runs_dir.iterdir() if path.is_dir()), reverse=True)
        except OSError:
            return runs
        for directory in directories:
            record = _read_json(directory / "run.json")
            if isinstance(record, dict):
                runs.append(record)
        return runs

    def read_run(self, run_id: str) -> dict[str, Any] | None:
        record = _read_json(self.run_dir(run_id) / "run.json")
        return record if isinstance(record, dict) else None

    def write_run(self, record: dict[str, Any]) -> None:
        _write_json_atomic(self.run_dir(record["run_id"]) / "run.json", record)

    def history(self) -> list[dict[str, Any]]:
        path = self.root / "history.jsonl"
        try:
            lines = path.read_text(encoding="utf-8").splitlines()
        except OSError:
            return []
        events = []
        for line in lines:
            with contextlib.suppress(ValueError):
                events.append(json.loads(line))
        return events

    def log_history(self, event: dict[str, Any]) -> None:
        _append_jsonl(self.root / "history.jsonl", {"at": _now_iso(), **event})


def decode_data_url(data_url: str, max_bytes: int = 64 * 1024 * 1024, max_pixels: int = 16_000_000) -> tuple[np.ndarray, bytes, str]:
    """Imagem em data URL → (pixels RGB, bytes originais, extensão)."""
    if not isinstance(data_url, str) or not data_url:
        raise ValueError("imagem ausente")
    header, _, encoded = data_url.partition(",")
    if not encoded:
        encoded, header = header, ""
    try:
        raw = base64.b64decode(encoded.strip(), validate=True)
    except (binascii.Error, ValueError) as error:
        raise ValueError("imagem base64 inválida") from error
    if not raw or len(raw) > max_bytes:
        raise ValueError("imagem vazia ou grande demais")
    try:
        with Image.open(io.BytesIO(raw)) as source:
            if source.size[0] * source.size[1] > max_pixels:
                raise ValueError("imagem com pixels demais")
            fmt = (source.format or "PNG").upper()
            oriented = ImageOps.exif_transpose(source)
            pixels = np.array(oriented.convert("RGB"), dtype=np.uint8)
    except ValueError:
        raise
    except Exception as error:
        raise ValueError("imagem inválida ou não suportada") from error
    return pixels, raw, "jpg" if fmt in ("JPEG", "JPG") else "png"


def ingest_item(
    store: ProjectStore,
    key: str,
    payload: dict[str, Any],
    decode: Callable[[str], tuple[np.ndarray, bytes, str]] = decode_data_url,
    embed: Callable[[np.ndarray], tuple[str, np.ndarray] | None] | None = None,
) -> dict[str, Any]:
    """Grava uma imagem aprovada e as máscaras das suas instâncias.

    Polígonos chegam no espaço da imagem enviada e são rasterizados aqui, com
    buracos. Instâncias de origem não aceita (predição não verificada) são
    recusadas mesmo que o cliente as mande: o servidor não confia no filtro do
    navegador para decidir o que entra no treino.
    """
    store.ensure()
    directory = store.item_dir(key)
    if not directory.exists() and len(store.fingerprints()) >= MAX_ITEMS_PER_PROJECT:
        raise ValueError("limite de imagens do projeto atingido")
    pixels, raw, extension = decode(payload.get("image", ""))
    height, width = pixels.shape[:2]
    declared = (payload.get("width"), payload.get("height"))
    if declared != (None, None) and declared != (width, height):
        # Os polígonos chegam no espaço declarado; outra dimensão os deslocaria.
        raise ValueError(f"dimensões declaradas {declared} não conferem com a imagem ({width}, {height})")
    raw_instances = payload.get("instances")
    if not isinstance(raw_instances, list) or not raw_instances:
        raise ValueError("envie ao menos uma instância aprovada")
    if len(raw_instances) > MAX_INSTANCES_PER_ITEM:
        raise ValueError("instâncias demais numa imagem")

    staging = directory.with_name(f".{key}.{uuid.uuid4().hex[:6]}.part")
    staging.mkdir(parents=True)
    try:
        image_file = f"image.{extension}"
        (staging / image_file).write_bytes(raw)
        instances = []
        rejected = []
        for index, raw_instance in enumerate(raw_instances):
            if not isinstance(raw_instance, dict):
                rejected.append({"index": index, "reason": "invalid"})
                continue
            origin = str(raw_instance.get("origin", ""))
            if origin not in ACCEPTED_ORIGINS:
                rejected.append({"index": index, "reason": "unverified_origin"})
                continue
            mask = rasterize_instance(raw_instance.get("polygons") or [], raw_instance.get("holes") or [], width, height)
            area = int(mask.sum())
            if area < MIN_INSTANCE_AREA_PX:
                rejected.append({"index": index, "reason": "too_small"})
                continue
            mask_file = f"mask-{len(instances):03d}.png"
            cv2.imwrite(str(staging / mask_file), mask.astype(np.uint8) * 255)
            instances.append({
                "id": str(raw_instance.get("id", ""))[:128],
                "label": str(raw_instance.get("label", ""))[:128],
                "label_name": str(raw_instance.get("label_name", ""))[:120],
                "origin": origin,
                "area": area,
                "relative_area": area / float(width * height),
                "bbox": mask_bbox(mask),
                "mask_file": mask_file,
            })
        if not instances:
            raise ValueError("nenhuma instância aprovada utilizável nesta imagem")
        image_sha = hashlib.sha256(raw).hexdigest()
        record = {
            "key": key,
            "name": str(payload.get("name", ""))[:256],
            "group": str(payload.get("group") or "")[:200] or None,
            "width": width,
            "height": height,
            "image_file": image_file,
            "image_sha256": image_sha,
            "fingerprint": str(payload.get("fingerprint", ""))[:128],
            "instances": instances,
            "rejected": rejected,
            "descriptor": image_descriptor(pixels),
            "updated_at": _now_iso(),
        }
        _write_json_atomic(staging / "item.json", record)
        if directory.exists():
            shutil.rmtree(directory)
        os.replace(staging, directory)
    except Exception:
        shutil.rmtree(staging, ignore_errors=True)
        raise

    if embed is not None:
        with contextlib.suppress(Exception):
            result = embed(pixels)
            if result is not None:
                model_key, vector = result
                path = store.root / "embeddings" / model_key / f"{record['image_sha256']}.npy"
                if not path.exists():
                    path.parent.mkdir(parents=True, exist_ok=True)
                    np.save(path, vector)
    return {"key": key, "instances": len(record["instances"]), "rejected": record["rejected"]}


def load_embeddings(store: ProjectStore, items: list[dict[str, Any]], model_key: str | None) -> dict[str, np.ndarray]:
    if not model_key:
        return {}
    found = {}
    for item in items:
        path = store.root / "embeddings" / model_key / f"{item['image_sha256']}.npy"
        with contextlib.suppress(OSError, ValueError):
            found[item["key"]] = np.load(path)
    return found


# ---------------------------------------------------------------------------
# Visão do dataset e prontidão
# ---------------------------------------------------------------------------


def build_dataset_view(store: ProjectStore, config: ReadinessConfig, model_key: str | None) -> dict[str, Any]:
    """Itens, grupos independentes e a atribuição treino/holdout (provisória)."""
    meta = store.ensure()
    items = store.list_items()
    embeddings = load_embeddings(store, items, model_key)
    for item in items:
        item["embedding"] = embeddings.get(item["key"])
    groups, duplicates = group_items(items, config)
    previous = store.split()
    assignment, split_info = assign_splits(groups, previous, meta["salt"], config)
    for item in items:
        item["group_id"] = groups[item["key"]]
        item["split"] = assignment[item["key"]]
    return {
        "items": items,
        "groups": groups,
        "duplicates": duplicates,
        "assignment": assignment,
        "split_info": split_info,
        "frozen": bool(previous),
        "embedding_method": "sam2_embedding" if embeddings and len(embeddings) == len(items) else "low_level",
    }


def _side_counts(items: list[dict[str, Any]], side: str) -> dict[str, int]:
    selected = [item for item in items if item["split"] == side]
    return {
        "images": len(selected),
        "groups": len({item["group_id"] for item in selected}),
        "instances": sum(len(item["instances"]) for item in selected),
    }


def _diversity(view: dict[str, Any]) -> dict[str, Any]:
    items = view["items"]
    if not items:
        return {"method": view["embedding_method"], "vendi": 0.0, "redundancy": 0.0}
    by_group: dict[str, list[np.ndarray]] = {}
    standardized = None
    if view["embedding_method"] == "sam2_embedding":
        # Padronizado por dimensão dentro do projeto: o embedding bruto tem um
        # componente comum enorme que faria qualquer conjunto parecer homogêneo.
        stack = np.stack([np.asarray(item["embedding"], dtype=np.float32) for item in items])
        standardized = (stack - stack.mean(axis=0)) / (stack.std(axis=0) + 1e-6)
    for index, item in enumerate(items):
        if standardized is not None:
            vector = standardized[index]
        else:
            descriptor = item.get("descriptor") or {}
            vector = np.concatenate([
                np.asarray(descriptor.get("thumb") or [0.0], dtype=np.float32),
                np.sqrt(np.asarray(descriptor.get("color") or [0.0], dtype=np.float32)),
            ])
        by_group.setdefault(item["group_id"], []).append(vector)
    representatives = np.stack([np.mean(vectors, axis=0) for vectors in by_group.values()])
    return {
        "method": view["embedding_method"],
        "vendi": round(vendi_score(representatives), 2),
        "redundancy": round(1.0 - len(by_group) / len(items), 3),
    }


def assess_readiness(
    store: ProjectStore,
    config: ReadinessConfig,
    model_key: str | None,
    model_supported: bool,
) -> dict[str, Any]:
    """Diz se há dados para um experimento, com os motivos e as lacunas.

    O resultado é um estado interpretável e uma lista de componentes, cada um
    comparado ao seu alvo. Não há "probabilidade de sucesso": os componentes
    são contagens e frações observadas, e o texto da interface diz isso.
    """
    view = build_dataset_view(store, config, model_key)
    items = view["items"]
    approved_images = len(items)
    instances = sum(len(item["instances"]) for item in items)
    usable = [item for item in items if item["split"] != "quarantine"]
    independent = len({item["group_id"] for item in usable})
    holdout = _side_counts(items, "holdout")
    train = _side_counts(items, "train")
    quarantined = sum(1 for item in items if item["split"] == "quarantine")

    origins = {origin: 0 for origin in ACCEPTED_ORIGINS}
    classes: dict[str, dict[str, Any]] = {}
    sizes = {name: 0 for name, _, _ in SIZE_BINS}
    rejected = 0
    for item in items:
        rejected += len(item.get("rejected") or [])
        for instance in item["instances"]:
            origins[instance["origin"]] = origins.get(instance["origin"], 0) + 1
            sizes[size_bin(instance["relative_area"])] += 1
            entry = classes.setdefault(instance["label"], {"label": instance["label"], "name": instance.get("label_name") or instance["label"], "instances": 0, "images": set(), "holdout_instances": 0})
            entry["instances"] += 1
            entry["images"].add(item["key"])
            if item["split"] == "holdout":
                entry["holdout_instances"] += 1
    class_list = [{**entry, "images": len(entry["images"])} for entry in classes.values()]
    class_list.sort(key=lambda entry: -entry["instances"])
    diversity = _diversity(view)

    reasons: list[dict[str, Any]] = []
    gaps: list[dict[str, Any]] = []
    for entry in class_list:
        if entry["instances"] < config.min_class_instances:
            gaps.append({"code": "rare_class", "params": {"name": entry["name"], "instances": entry["instances"], "target": config.min_class_instances}})
        elif entry["holdout_instances"] == 0 and holdout["images"]:
            gaps.append({"code": "class_absent_from_holdout", "params": {"name": entry["name"]}})
    for name, count in sizes.items():
        if instances >= config.min_instances and count == 0:
            gaps.append({"code": "size_absent", "params": {"size": name}})
    if diversity["redundancy"] > config.redundancy_warning:
        gaps.append({"code": "high_redundancy", "params": {"share": diversity["redundancy"]}})
    if quarantined:
        gaps.append({"code": "quarantined", "params": {"images": quarantined}})

    components = [
        {"id": "approved_images", "value": approved_images, "target": config.min_approved_images},
        {"id": "instances", "value": instances, "target": config.min_instances},
        {"id": "independent_groups", "value": independent, "target": config.target_independent, "minimum": config.min_independent_experimental},
        {"id": "holdout_groups", "value": holdout["groups"], "target": config.target_holdout_groups, "minimum": config.min_holdout_groups},
        {"id": "holdout_instances", "value": holdout["instances"], "target": config.min_holdout_instances},
        {"id": "effective_diversity", "value": diversity["vendi"], "target": None},
    ]
    for component in components:
        minimum = component.get("minimum", component["target"])
        component["status"] = "info" if component["target"] is None else ("ok" if component["value"] >= component["target"] else "low" if minimum is not None and component["value"] >= minimum else "missing")

    if not model_supported:
        state = "unsupported_model"
        reasons.append({"code": "unsupported_model", "params": {}})
    elif approved_images < config.min_approved_images or instances < config.min_instances:
        state = "collecting"
        reasons.append({"code": "few_approved", "params": {"images": approved_images, "instances": instances, "min_images": config.min_approved_images, "min_instances": config.min_instances}})
    elif independent < config.min_independent_experimental:
        redundant = diversity["redundancy"] > config.redundancy_warning
        state = "collect_more" if redundant else "collecting"
        reasons.append({"code": "few_independent", "params": {"independent": independent, "images": approved_images, "minimum": config.min_independent_experimental}})
    elif holdout["groups"] < config.min_holdout_groups or holdout["instances"] < config.min_holdout_instances or train["groups"] < 2 + 2:
        state = "insufficient_validation"
        reasons.append({"code": "small_holdout", "params": {**holdout, "min_groups": config.min_holdout_groups, "min_instances": config.min_holdout_instances}})
    elif independent >= config.target_independent and holdout["groups"] >= config.target_holdout_groups:
        state = "ready"
        reasons.append({"code": "meets_targets", "params": {"independent": independent, "holdout_groups": holdout["groups"]}})
    else:
        state = "potentially_sufficient"
        reasons.append({"code": "meets_minimum", "params": {"independent": independent, "target": config.target_independent}})
    can_train = state in ("ready", "potentially_sufficient")

    continual = _continual_assessment(store, view, config) if can_train else None
    if continual is not None and continual["previous_runs"]:
        if continual["recommend"]:
            state = "retrain_useful"
        else:
            state = "retrain_not_needed"
        reasons.extend(continual["reasons"])

    return {
        "state": state,
        "can_train": can_train,
        "recommend_training": can_train and state in ("ready", "potentially_sufficient", "retrain_useful"),
        "counts": {
            "approved_images": approved_images,
            "instances": instances,
            "independent_groups": independent,
            "near_duplicate_pairs": len(view["duplicates"]),
            "quarantined_images": quarantined,
            "rejected_instances": rejected,
            "holdout": holdout,
            "train": train,
            "by_origin": origins,
            "classes": len(class_list),
        },
        "classes": class_list,
        "sizes": sizes,
        "diversity": diversity,
        "components": components,
        "reasons": reasons,
        "gaps": gaps,
        "continual": continual,
        "split_frozen": view["frozen"],
        "thresholds": asdict(config),
    }


def _continual_assessment(store: ProjectStore, view: dict[str, Any], config: ReadinessConfig) -> dict[str, Any]:
    """Vale outra rodada? Só com informação nova suficiente, nunca a cada imagem.

    Conta grupos independentes que não estavam no snapshot da última rodada
    concluída, classes novas e subgrupos fracos da última comparação. Se as duas
    últimas rodadas não melhoraram, exige o dobro de dados novos antes de
    recomendar de novo. O custo estimado vem do tempo real por época medido.
    """
    runs = [run for run in store.list_runs() if run.get("status") == "completed"]
    if not runs:
        return {"previous_runs": 0, "recommend": False, "reasons": []}
    last = runs[0]
    snapshot = _read_json(store.root / "snapshots" / f"{last.get('snapshot_id')}.json", {}) or {}
    known_keys = {entry["key"] for entry in snapshot.get("items", [])}
    known_groups = {view["groups"][key] for key in known_keys if key in view["groups"]}
    current_groups = {item["group_id"] for item in view["items"] if item["split"] == "train"}
    new_groups = len(current_groups - known_groups)
    known_labels = set(snapshot.get("labels", []))
    new_labels = sorted({instance["label"] for item in view["items"] for instance in item["instances"]} - known_labels)
    previous_train_groups = max(1, int(snapshot.get("train_groups", 1)))
    required = max(config.retrain_min_new_groups, int(math.ceil(config.retrain_new_group_fraction * previous_train_groups)))
    recent = [run.get("comparison", {}).get("decision", {}).get("outcome") for run in runs[:2]]
    backoff = len(recent) == 2 and all(outcome in ("not_improved", "insufficient_evidence") for outcome in recent)
    if backoff:
        required *= 2
    weak = []
    comparison = last.get("comparison") or {}
    for subgroup in comparison.get("subgroups", []):
        if subgroup.get("candidate_mean") is not None and subgroup["candidate_mean"] < 0.7:
            weak.append(subgroup["name"])
    reasons = [{"code": "new_data", "params": {"new_groups": new_groups, "required": required, "backoff": backoff}}]
    if new_labels:
        reasons.append({"code": "new_classes", "params": {"count": len(new_labels)}})
    if weak:
        reasons.append({"code": "weak_subgroups", "params": {"subgroups": weak[:6]}})
    seconds_per_epoch = last.get("timing", {}).get("seconds_per_epoch")
    if seconds_per_epoch:
        scale = (len(current_groups) or 1) / previous_train_groups
        reasons.append({"code": "cost_estimate", "params": {"minutes": round(seconds_per_epoch * scale * max(1, last.get("epochs_run", 10)) / 60.0, 1)}})
    recommend = new_groups >= required or (bool(new_labels) and new_groups >= 1) or (bool(weak) and new_groups >= max(1, required // 2))
    return {"previous_runs": len(runs), "recommend": recommend, "new_groups": new_groups, "required_new_groups": required, "backoff": backoff, "reasons": reasons}


# ---------------------------------------------------------------------------
# Treino
# ---------------------------------------------------------------------------


class TrainingCancelled(Exception):
    pass


class TrainingFailure(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


@dataclass
class Sample:
    key: str
    group_id: str
    pixels: np.ndarray
    width: int
    height: int
    instances: list[dict[str, Any]] = field(default_factory=list)


def load_samples(store: ProjectStore, items: list[dict[str, Any]], max_instances: int | None = None) -> list[Sample]:
    samples = []
    for item in items:
        pixels = store.load_image(item)
        height, width = pixels.shape[:2]
        if (width, height) != (item["width"], item["height"]):
            raise TrainingFailure("dataset_changed", f"a imagem {item['key']} mudou de dimensão")
        instances = []
        for index, instance in enumerate(item["instances"][: max_instances or None]):
            mask = store.load_mask(item, instance)
            if mask.shape != (height, width):
                raise TrainingFailure("dataset_changed", f"máscara de {item['key']} com dimensão errada")
            instances.append({
                "index": index,
                "mask": mask,
                "label": instance["label"],
                "label_name": instance.get("label_name") or instance["label"],
                "relative_area": instance["relative_area"],
                "bbox": mask_bbox(mask),
            })
        samples.append(Sample(item["key"], item["group_id"], pixels, width, height, instances))
    return samples


def _is_oom(error: BaseException) -> bool:
    if TORCH_AVAILABLE and isinstance(error, getattr(torch, "OutOfMemoryError", ())):
        return True
    return isinstance(error, RuntimeError) and "out of memory" in str(error).lower()


def _empty_cache() -> None:
    gc.collect()
    if TORCH_AVAILABLE and torch.cuda.is_available():
        torch.cuda.empty_cache()


def _train_prompt(instance: dict[str, Any], width: int, height: int, rng: np.random.Generator) -> dict[str, Any]:
    """Prompt simulado para treino, reprodutível pela semente da época.

    Metade caixas (com ruído de 5% do lado, como uma caixa desenhada à mão),
    um quarto clique único, um quarto dois ou três cliques com um negativo.
    """
    mask = instance["mask"]
    choice = rng.random()
    if choice < 0.5:
        return {"box": jitter_box(instance["bbox"], width, height, rng, 0.05), "points": []}
    first = sample_interior_point(mask, rng)
    if choice < 0.75:
        return {"box": None, "points": [(first[0], first[1], 1)]}
    points = [(first[0], first[1], 1)]
    if rng.random() < 0.5:
        second = sample_interior_point(mask, rng)
        points.append((second[0], second[1], 1))
    x0, y0, x1, y1 = instance["bbox"]
    pad_x, pad_y = max(2, int(0.15 * (x1 - x0))), max(2, int(0.15 * (y1 - y0)))
    region = np.zeros_like(mask)
    region[max(0, y0 - pad_y): min(height, y1 + pad_y), max(0, x0 - pad_x): min(width, x1 + pad_x)] = True
    outside = np.logical_and(region, ~mask)
    if outside.any():
        ys, xs = np.nonzero(outside)
        pick = int(rng.integers(0, len(xs)))
        points.append((float(xs[pick]) + 0.5, float(ys[pick]) + 0.5, 0))
    return {"box": None, "points": points}


def eval_prompts(instance: dict[str, Any], width: int, height: int, seed: str) -> dict[str, dict[str, Any]]:
    """Prompts de avaliação, idênticos para todo modelo comparado."""
    rng = np.random.default_rng(int(_stable_hash(seed)[:8], 16))
    x, y = interior_point(instance["mask"])
    box = instance["bbox"]
    return {
        "box": {"box": tuple(float(value) for value in box), "points": []},
        "point": {"box": None, "points": [(x, y, 1)]},
        "box_jitter": {"box": jitter_box(box, width, height, rng, 0.1), "points": []},
    }


def _augment(sample: Sample, rng: np.random.Generator, config: TrainConfig) -> tuple[np.ndarray, list[np.ndarray]]:
    pixels = sample.pixels
    masks = [instance["mask"] for instance in sample.instances]
    if config.augment_hflip and rng.random() < 0.5:
        pixels = pixels[:, ::-1]
        masks = [mask[:, ::-1] for mask in masks]
    if config.augment_vflip and rng.random() < 0.5:
        pixels = pixels[::-1]
        masks = [mask[::-1] for mask in masks]
    if config.augment_color:
        gain = 1.0 + rng.uniform(-0.1, 0.1)
        bias = rng.uniform(-12, 12)
        pixels = np.clip(pixels.astype(np.float32) * gain + bias, 0, 255).astype(np.uint8)
    return np.ascontiguousarray(pixels), [np.ascontiguousarray(mask) for mask in masks]


def _low_res_target(mask: np.ndarray, size: int) -> np.ndarray:
    return cv2.resize(mask.astype(np.float32), (size, size), interpolation=cv2.INTER_AREA)


def _segmentation_loss(low_res: Any, iou_pred: Any, targets: Any) -> tuple[Any, Any]:
    """BCE + Dice suave na resolução do decoder, mais o erro da cabeça de IoU."""
    logits = low_res[:, 0].float()
    bce = F.binary_cross_entropy_with_logits(logits, targets)
    probabilities = torch.sigmoid(logits)
    intersection = (probabilities * targets).sum(dim=(1, 2))
    dice = 1 - (2 * intersection + 1) / (probabilities.sum(dim=(1, 2)) + targets.sum(dim=(1, 2)) + 1)
    with torch.no_grad():
        hard = (logits > 0).float()
        binary = (targets > 0.5).float()
        inter = (hard * binary).sum(dim=(1, 2))
        union = ((hard + binary) > 0).float().sum(dim=(1, 2)).clamp(min=1)
        actual_iou = inter / union
        hard_dice = (2 * inter + 1e-6) / (hard.sum(dim=(1, 2)) + binary.sum(dim=(1, 2)) + 1e-6)
    iou_loss = F.mse_loss(iou_pred[:, 0].float(), actual_iou)
    return bce + dice.mean() + 0.05 * iou_loss, hard_dice.mean()


class TrainingJob:
    """Uma rodada de treino numa cópia do modelo, sem tocar no que serve o editor."""

    def __init__(
        self,
        *,
        store: ProjectStore,
        record: dict[str, Any],
        config: TrainConfig,
        readiness: ReadinessConfig,
        model_factory: Callable[[], Any],
        device: str,
        reference: tuple[str, dict[str, Any], dict[str, Any]] | None,
        model_key: str | None,
        segmenter_factory: Callable[[Any, str], Any] = Sam2Segmenter,
    ):
        self.store = store
        self.record = record
        self.config = config
        self.readiness = readiness
        self.model_factory = model_factory
        self.device = device
        self.reference = reference
        self.model_key = model_key
        self.segmenter_factory = segmenter_factory
        self.cancel_event = threading.Event()
        self.progress: dict[str, Any] = {}
        self.run_dir = store.run_dir(record["run_id"])
        self._lock = threading.Lock()

    # --- registro --------------------------------------------------------

    def _save(self, **updates: Any) -> None:
        with self._lock:
            self.record.update(updates)
            self.record["updated_at"] = _now_iso()
            self.store.write_run(self.record)

    def _event(self, stage: str, message: str, **extra: Any) -> None:
        _append_jsonl(self.run_dir / "events.jsonl", {"at": _now_iso(), "stage": stage, "message": message, **extra})

    def _check_cancel(self) -> None:
        if self.cancel_event.is_set():
            raise TrainingCancelled()

    # --- execução --------------------------------------------------------

    def run(self) -> dict[str, Any]:
        started = time.monotonic()
        model = None
        try:
            self._save(status="preparing", stage="preparing")
            self._event("preparing", "rodada iniciada", device=self.device)
            model, data = self._prepare()
            self._train(model, data)
            self._check_cancel()
            self._save(status="evaluating", stage="evaluating")
            self._compare(model, data)
            self._save(status="completed", stage="completed", finished_at=_now_iso(), timing={**self.record.get("timing", {}), "total_seconds": round(time.monotonic() - started, 1)})
            self._event("completed", "rodada concluída")
        except TrainingCancelled:
            self._save(status="cancelled", stage="cancelled", finished_at=_now_iso())
            self._event("cancelled", "cancelada pelo usuário")
        except TrainingFailure as error:
            self._save(status="failed", stage="failed", finished_at=_now_iso(), error={"code": error.code, "message": str(error)})
            self._event("failed", str(error), code=error.code)
        except Exception as error:  # noqa: BLE001 - qualquer falha precisa virar registro consultável
            code = "out_of_memory" if _is_oom(error) else "unexpected"
            self._save(status="failed", stage="failed", finished_at=_now_iso(), error={"code": code, "message": f"{type(error).__name__}: {error}"})
            self._event("failed", traceback.format_exc(limit=8), code=code)
        finally:
            del model
            _empty_cache()
        return self.record

    def _prepare(self) -> tuple[Any, dict[str, Any]]:
        config = self.config
        view = build_dataset_view(self.store, self.readiness, self.model_key)
        items = view["items"]
        train_items = [item for item in items if item["split"] == "train"]
        holdout_items = [item for item in items if item["split"] == "holdout"]
        internal_groups = internal_validation_split(
            [item["group_id"] for item in train_items], config.seed, config.internal_val_fraction, config.min_internal_val_groups,
        )
        if not internal_groups:
            raise TrainingFailure("insufficient_data", "grupos de treino insuficientes para separar uma validação interna")
        if not holdout_items:
            raise TrainingFailure("insufficient_data", "não há holdout para a comparação")
        fit_items = [item for item in train_items if item["group_id"] not in internal_groups]
        val_items = [item for item in train_items if item["group_id"] in internal_groups]

        # Congela a divisão agora: daqui em diante estes itens não mudam de lado.
        frozen = {key: side for key, side in view["assignment"].items() if side in ("train", "holdout")}
        self.store.save_split({**self.store.split(), **frozen})

        holdout_signature = sorted((item["key"], item["image_sha256"], item.get("fingerprint", "")) for item in holdout_items)
        holdout_set_id = "hs-" + _stable_hash(json.dumps(holdout_signature))[:16]
        snapshot = {
            "snapshot_id": self.record["snapshot_id"],
            "created_at": _now_iso(),
            "items": [
                {"key": item["key"], "image_sha256": item["image_sha256"], "fingerprint": item.get("fingerprint"), "split": item["split"], "group": item["group_id"], "instances": len(item["instances"])}
                for item in items
            ],
            "labels": sorted({instance["label"] for item in items for instance in item["instances"]}),
            "train_groups": len({item["group_id"] for item in train_items}),
            "holdout_set_id": holdout_set_id,
        }
        _write_json_atomic(self.store.root / "snapshots" / f"{self.record['snapshot_id']}.json", snapshot)

        self._check_cancel()
        fit = load_samples(self.store, fit_items)
        val = load_samples(self.store, val_items, max_instances=16)
        holdout = load_samples(self.store, holdout_items, max_instances=24)

        model = self.model_factory()
        model.eval()
        remove_lora(model)
        strategy = config.strategy
        if strategy == "auto":
            strategy = "decoder" if self.device == "cpu" else "encoder_decoder"
        learning_rate = config.learning_rate or (3e-4 if strategy == "decoder" else 2e-4)
        max_epochs = config.max_epochs or (40 if strategy == "decoder" else 20)
        targets = resolve_lora_targets(model, strategy, config.encoder_blocks)
        inject_lora(model, targets, config.rank, config.alpha, config.dropout)
        trainable, total = freeze_base_parameters(model)
        segmenter = self.segmenter_factory(model, self.device)
        self._save(
            status="training",
            stage="training",
            snapshot={"snapshot_id": self.record["snapshot_id"], "holdout_set_id": holdout_set_id},
            data={
                "fit": {"images": len(fit), "groups": len({s.group_id for s in fit}), "instances": sum(len(s.instances) for s in fit)},
                "internal_val": {"images": len(val), "groups": len({s.group_id for s in val}), "instances": sum(len(s.instances) for s in val)},
                "holdout": {"images": len(holdout), "groups": len({s.group_id for s in holdout}), "instances": sum(len(s.instances) for s in holdout), "set_id": holdout_set_id},
            },
            lora={
                "strategy": strategy, "rank": config.rank, "alpha": config.alpha, "dropout": config.dropout,
                "encoder_blocks": config.encoder_blocks if strategy == "encoder_decoder" else 0,
                "targets": targets, "trainable_params": trainable, "total_params": total,
            },
            resolved={"learning_rate": learning_rate, "max_epochs": max_epochs},
        )
        self._event("prepared", "dados e modelo prontos", fit=len(fit), val=len(val), holdout=len(holdout), trainable=trainable)
        return model, {
            "segmenter": segmenter, "fit": fit, "val": val, "holdout": holdout, "strategy": strategy,
            "learning_rate": learning_rate, "max_epochs": max_epochs, "targets": targets,
        }

    # --- features ----------------------------------------------------------

    def _features(self, segmenter: Any, pixels: np.ndarray, grad: bool) -> dict[str, Any]:
        context = contextlib.nullcontext() if grad else torch.no_grad()
        with context:
            return segmenter.encode(segmenter.preprocess(pixels))

    @staticmethod
    def _to_storage(features: dict[str, Any]) -> dict[str, Any]:
        return {
            "image_embed": features["image_embed"].detach().to("cpu", torch.float16),
            "high_res_feats": [feat.detach().to("cpu", torch.float16) for feat in features["high_res_feats"]],
        }

    def _from_storage(self, features: dict[str, Any]) -> dict[str, Any]:
        return {
            "image_embed": features["image_embed"].to(self.device, torch.float32),
            "high_res_feats": [feat.to(self.device, torch.float32) for feat in features["high_res_feats"]],
        }

    # --- laço de treino ------------------------------------------------------

    def _train(self, model: Any, data: dict[str, Any]) -> None:
        config = self.config
        segmenter = data["segmenter"]
        fit: list[Sample] = data["fit"]
        decoder_only = data["strategy"] == "decoder"
        parameters = [parameter for parameter in model.parameters() if parameter.requires_grad]
        optimizer = torch.optim.AdamW(parameters, lr=data["learning_rate"], weight_decay=config.weight_decay)
        steps_per_epoch = max(1, math.ceil(len(fit) / config.batch_size))
        total_steps = steps_per_epoch * data["max_epochs"]
        warmup = max(1, int(0.1 * total_steps))

        def schedule(step: int) -> float:
            if step < warmup:
                return (step + 1) / warmup
            progress = (step - warmup) / max(1, total_steps - warmup)
            return 0.1 + 0.9 * 0.5 * (1 + math.cos(math.pi * min(1.0, progress)))

        scheduler = torch.optim.lr_scheduler.LambdaLR(optimizer, schedule)

        cached: dict[tuple[str, bool], dict[str, Any]] = {}
        if decoder_only:
            # Com o encoder congelado, as features de cada imagem (e da versão
            # espelhada) são calculadas uma vez só: o treino fica centenas de
            # vezes mais barato, ao custo de não haver aumento fotométrico.
            for index, sample in enumerate(fit):
                self._check_cancel()
                self.progress = {"phase": "caching", "done": index, "total": len(fit)}
                with lora_disabled(model):
                    cached[(sample.key, False)] = self._to_storage(self._features(segmenter, sample.pixels, False))
                    if config.augment_hflip:
                        cached[(sample.key, True)] = self._to_storage(self._features(segmenter, np.ascontiguousarray(sample.pixels[:, ::-1]), False))
            val_cache = {}
            for sample in data["val"]:
                with lora_disabled(model):
                    val_cache[sample.key] = self._to_storage(self._features(segmenter, sample.pixels, False))
            data["val_cache"] = val_cache

        epochs: list[dict[str, Any]] = []
        best = {"epoch": 0, "dice": -1.0, "loss": math.inf, "state": lora_state_dict(model)}
        baseline = self._validate(model, data)
        epochs.append({"epoch": 0, **baseline})
        best.update(dice=baseline["val_dice"], loss=baseline["val_loss"])
        self._save(epochs=epochs, best_epoch=0, diagnosis=diagnose_convergence(epochs, config))
        _append_jsonl(self.run_dir / "metrics.jsonl", epochs[-1])
        max_instances = config.max_instances_per_image
        epoch_times = []
        since_improvement = 0

        for epoch in range(1, data["max_epochs"] + 1):
            epoch_started = time.monotonic()
            rng = np.random.default_rng(config.seed * 1000 + epoch)
            order = rng.permutation(len(fit))
            for module in lora_modules(model).values():
                module.train()
            losses, dices = [], []
            optimizer.zero_grad(set_to_none=True)
            for position, sample_index in enumerate(order):
                self._check_cancel()
                sample = fit[int(sample_index)]
                self.progress = {"phase": "training", "epoch": epoch, "max_epochs": data["max_epochs"], "done": position, "total": len(fit)}
                for attempt in range(2):
                    try:
                        loss, dice = self._train_step(segmenter, sample, cached, rng, max_instances, decoder_only, len(fit))
                        break
                    except Exception as error:
                        if not _is_oom(error) or attempt == 1 or max_instances == 1:
                            raise
                        optimizer.zero_grad(set_to_none=True)
                        _empty_cache()
                        max_instances = max(1, max_instances // 2)
                        self._event("oom", "memória insuficiente; reduzindo instâncias por imagem", max_instances=max_instances)
                if not math.isfinite(loss):
                    raise TrainingFailure("non_finite_loss", f"loss não finita na época {epoch}")
                losses.append(loss)
                dices.append(dice)
                if (position + 1) % config.batch_size == 0 or position + 1 == len(fit):
                    torch.nn.utils.clip_grad_norm_(parameters, 1.0)
                    optimizer.step()
                    scheduler.step()
                    optimizer.zero_grad(set_to_none=True)
            for module in lora_modules(model).values():
                module.eval()
            self._check_cancel()
            metrics = self._validate(model, data)
            seconds = time.monotonic() - epoch_started
            epoch_times.append(seconds)
            entry = {
                "epoch": epoch,
                "train_loss": float(np.mean(losses)),
                "train_dice": float(np.mean(dices)),
                **metrics,
                "learning_rate": float(scheduler.get_last_lr()[0]),
                "seconds": round(seconds, 2),
            }
            epochs.append(entry)
            _append_jsonl(self.run_dir / "metrics.jsonl", entry)
            if metrics["val_dice"] >= best["dice"] + config.min_delta:
                best = {"epoch": epoch, "dice": metrics["val_dice"], "loss": metrics["val_loss"], "state": lora_state_dict(model)}
                since_improvement = 0
            else:
                since_improvement += 1
            diagnosis = diagnose_convergence(epochs, config)
            self._save(
                epochs=epochs,
                best_epoch=best["epoch"],
                diagnosis=diagnosis,
                epochs_run=epoch,
                timing={"seconds_per_epoch": round(float(np.mean(epoch_times)), 2)},
            )
            if epoch >= config.min_epochs and since_improvement >= config.patience:
                self._event("early_stop", "early stopping pela validação interna", epoch=epoch, best_epoch=best["epoch"])
                break

        # Restaura o melhor checkpoint (pode ser a época 0, isto é, nenhuma mudança).
        load_lora_state(model, best["state"])
        data["best_state"] = best["state"]
        data["best_epoch"] = best["epoch"]
        stopped_early = len(epochs) - 1 < data["max_epochs"]
        diagnosis = diagnose_convergence(epochs, config)
        diagnosis["stopped_early"] = stopped_early
        if best["epoch"] == 0:
            diagnosis["state"] = "inconclusive" if diagnosis["state"] != "overfitting" else "overfitting"
            diagnosis["no_improvement_over_base"] = True
        metadata = self._adapter_metadata(data)
        digest = save_adapter(self.run_dir / "adapter.pt", metadata, best["state"])
        self._save(
            diagnosis=diagnosis,
            best_epoch=best["epoch"],
            adapter={"sha256": digest, "bytes": (self.run_dir / "adapter.pt").stat().st_size},
        )
        self._event("trained", "melhor checkpoint restaurado", best_epoch=best["epoch"])

    def _adapter_metadata(self, data: dict[str, Any]) -> dict[str, Any]:
        lora = self.record["lora"]
        return {
            "project_id": self.store.project_id,
            "run_id": self.record["run_id"],
            "base_model": self.record["base_model"],
            "lora": {"strategy": lora["strategy"], "rank": lora["rank"], "alpha": lora["alpha"], "targets": lora["targets"]},
            "best_epoch": data["best_epoch"],
            "created_at": _now_iso(),
        }

    def _train_step(self, segmenter: Any, sample: Sample, cached: dict, rng: np.random.Generator, max_instances: int, decoder_only: bool, n_images: int) -> tuple[float, float]:
        config = self.config
        size = segmenter.resolution // 4
        if decoder_only:
            flipped = config.augment_hflip and rng.random() < 0.5
            features = self._from_storage(cached[(sample.key, flipped)])
            masks = [instance["mask"][:, ::-1] if flipped else instance["mask"] for instance in sample.instances]
        else:
            pixels, masks = _augment(sample, rng, config)
            features = self._features(segmenter, pixels, True)
        chosen = rng.permutation(len(masks))[:max_instances]
        prompts, targets = [], []
        for index in chosen:
            mask = np.ascontiguousarray(masks[int(index)])
            instance = {"mask": mask, "bbox": mask_bbox(mask)}
            if instance["bbox"] is None:
                continue
            prompts.append(_train_prompt(instance, sample.width, sample.height, rng))
            targets.append(_low_res_target(mask, size))
        if not prompts:
            return 0.0, 0.0
        coords, labels = segmenter.prompt_tensors(prompts, sample.width, sample.height)
        low_res, iou_pred = segmenter.decode(features, coords, labels)
        target_tensor = torch.from_numpy(np.stack(targets)).to(low_res.device)
        loss, dice = _segmentation_loss(low_res, iou_pred, target_tensor)
        # Média por imagem dentro do lote: cada imagem pesa igual no gradiente.
        (loss / config.batch_size).backward()
        return float(loss.detach().cpu()), float(dice.cpu())

    def _validate(self, model: Any, data: dict[str, Any]) -> dict[str, Any]:
        """Loss e métricas na validação interna, com prompts determinísticos."""
        segmenter = data["segmenter"]
        size = segmenter.resolution // 4
        image_dice, image_iou, image_biou, losses = [], [], [], []
        with torch.no_grad():
            for sample in data["val"]:
                self._check_cancel()
                if "val_cache" in data:
                    features = self._from_storage(data["val_cache"][sample.key])
                else:
                    features = self._features(segmenter, sample.pixels, False)
                dices, ious, bious = [], [], []
                prompts, targets, masks = [], [], []
                for instance in sample.instances:
                    variants = eval_prompts(instance, sample.width, sample.height, f"{sample.key}:{instance['index']}")
                    for name in ("box", "point"):
                        prompts.append(variants[name])
                        targets.append(_low_res_target(instance["mask"], size))
                        masks.append(instance["mask"])
                if not prompts:
                    continue
                coords, labels = segmenter.prompt_tensors(prompts, sample.width, sample.height)
                low_res, iou_pred = segmenter.decode(features, coords, labels)
                loss, _ = _segmentation_loss(low_res, iou_pred, torch.from_numpy(np.stack(targets)).to(low_res.device))
                losses.append(float(loss))
                predictions = (segmenter.upsample(low_res, sample.height, sample.width)[:, 0] > 0).cpu().numpy()
                for prediction, mask in zip(predictions, masks):
                    dices.append(dice_score(prediction, mask))
                    ious.append(iou_score(prediction, mask))
                    bious.append(boundary_iou(prediction, mask))
                image_dice.append(float(np.mean(dices)))
                image_iou.append(float(np.mean(ious)))
                image_biou.append(float(np.mean(bious)))
        return {
            "val_loss": float(np.mean(losses)) if losses else 0.0,
            "val_dice": float(np.mean(image_dice)) if image_dice else 0.0,
            "val_iou": float(np.mean(image_iou)) if image_iou else 0.0,
            "val_boundary_iou": float(np.mean(image_biou)) if image_biou else 0.0,
        }

    # --- comparação no holdout ------------------------------------------------

    def _use_variant(self, model: Any, variant: tuple[dict[str, Any], dict[str, Any]] | None) -> None:
        if variant is None:
            remove_lora(model)
        else:
            apply_adapter(model, *variant)
        model.eval()

    def _evaluate_variant(self, model: Any, data: dict[str, Any], variant: Any, label: str) -> dict[str, Any]:
        """Métricas por instância e protocolo, e a curva de cliques simulados."""
        self._use_variant(model, variant)
        segmenter = data["segmenter"]
        results: dict[tuple[str, int], dict[str, Any]] = {}
        max_clicks = self.config.max_clicks
        for position, sample in enumerate(data["holdout"]):
            self._check_cancel()
            self.progress = {"phase": "comparing", "model": label, "done": position, "total": len(data["holdout"])}
            with torch.no_grad():
                features = self._features(segmenter, sample.pixels, False)
                for instance in sample.instances:
                    variants = eval_prompts(instance, sample.width, sample.height, f"{sample.key}:{instance['index']}")
                    names = list(variants)
                    coords, labels = segmenter.prompt_tensors([variants[name] for name in names], sample.width, sample.height)
                    low_res, _ = segmenter.decode(features, coords, labels)
                    predictions = (segmenter.upsample(low_res, sample.height, sample.width)[:, 0] > 0).cpu().numpy()
                    entry: dict[str, Any] = {}
                    for name, prediction in zip(names, predictions):
                        entry[name] = {
                            "dice": dice_score(prediction, instance["mask"]),
                            "iou": iou_score(prediction, instance["mask"]),
                            "boundary_iou": boundary_iou(prediction, instance["mask"]),
                        }
                    # Cliques simulados: começa no centro do objeto e corrige o
                    # maior erro a cada passo, como o editor faz (todos os pontos
                    # reenviados, sem máscara anterior).
                    points = list(variants["point"]["points"])
                    curve = []
                    for _ in range(max_clicks):
                        coords, labels = segmenter.prompt_tensors([{"box": None, "points": points}], sample.width, sample.height)
                        low_res, _ = segmenter.decode(features, coords, labels)
                        prediction = (segmenter.upsample(low_res, sample.height, sample.width)[0, 0] > 0).cpu().numpy()
                        curve.append(iou_score(prediction, instance["mask"]))
                        click = correction_click(prediction, instance["mask"])
                        if click is None:
                            curve.extend([curve[-1]] * (max_clicks - len(curve)))
                            break
                        points.append(click)
                    entry["curve"] = curve
                    results[(sample.key, instance["index"])] = entry
        return results

    def _compare(self, model: Any, data: dict[str, Any]) -> None:
        candidate = (self._adapter_metadata(data), data["best_state"])
        variants: list[tuple[str, Any]] = [("base", None)]
        if self.reference is not None:
            variants.append(("reference", (self.reference[1], self.reference[2])))
        variants.append(("candidate", candidate))
        evaluations = {name: self._evaluate_variant(model, data, variant, name) for name, variant in variants}
        reference_name = "reference" if self.reference is not None else "base"
        summary = summarize_comparison(
            data["holdout"], evaluations[reference_name], evaluations["candidate"], self.config, self.config.max_clicks,
        )
        summary["reference"] = {"kind": "adapter" if self.reference is not None else "base", "run_id": self.reference[0] if self.reference else None}
        if self.reference is not None:
            versus_base = summarize_comparison(data["holdout"], evaluations["base"], evaluations["candidate"], self.config, self.config.max_clicks)
            summary["versus_base"] = versus_base["primary"]
        summary["decision"] = decide_promotion(summary, self.config, self.readiness)
        summary["examples"] = self._render_examples(model, data, evaluations[reference_name], evaluations["candidate"], dict(variants)[reference_name], candidate)
        summary["simulated_interaction_note"] = True
        self._use_variant(model, candidate)
        self._save(comparison=summary)
        _write_json_atomic(self.run_dir / "comparison.json", summary)

    def _render_examples(self, model: Any, data: dict[str, Any], reference: dict, candidate: dict, reference_variant: Any, candidate_variant: Any) -> list[dict[str, Any]]:
        """Até seis recortes lado a lado: maiores ganhos, maiores perdas e casos típicos."""
        deltas = sorted(
            ((candidate[key]["box"]["dice"] - reference[key]["box"]["dice"], key) for key in candidate),
            key=lambda pair: pair[0],
        )
        if not deltas:
            return []
        picks: list[tuple[str, int]] = []
        for _, key in deltas[::-1][:2] + deltas[:2] + [deltas[len(deltas) // 2]]:
            if key not in picks:
                picks.append(key)
        samples = {sample.key: sample for sample in data["holdout"]}
        segmenter = data["segmenter"]
        masks: dict[str, dict[tuple[str, int], np.ndarray]] = {}
        for name, variant in (("reference", reference_variant), ("candidate", candidate_variant)):
            self._use_variant(model, variant)
            masks[name] = {}
            with torch.no_grad():
                for key in picks:
                    sample = samples[key[0]]
                    instance = sample.instances[key[1]]
                    features = self._features(segmenter, sample.pixels, False)
                    prompt = eval_prompts(instance, sample.width, sample.height, f"{sample.key}:{instance['index']}")["box"]
                    coords, labels = segmenter.prompt_tensors([prompt], sample.width, sample.height)
                    low_res, _ = segmenter.decode(features, coords, labels)
                    masks[name][key] = (segmenter.upsample(low_res, sample.height, sample.width)[0, 0] > 0).cpu().numpy()
        examples = []
        for index, key in enumerate(picks):
            sample = samples[key[0]]
            instance = sample.instances[key[1]]
            name = f"example-{index:02d}.png"
            panel = render_comparison_panel(sample.pixels, instance["mask"], masks["reference"][key], masks["candidate"][key], instance["bbox"])
            cv2.imwrite(str(self.run_dir / name), cv2.cvtColor(panel, cv2.COLOR_RGB2BGR))
            examples.append({
                "file": name,
                "label_name": instance["label_name"],
                "reference_dice": round(reference[key]["box"]["dice"], 4),
                "candidate_dice": round(candidate[key]["box"]["dice"], 4),
                "delta": round(candidate[key]["box"]["dice"] - reference[key]["box"]["dice"], 4),
                "prompt": "box",
            })
        return examples


def render_comparison_panel(pixels: np.ndarray, target: np.ndarray, reference: np.ndarray, candidate: np.ndarray, bbox: tuple[int, int, int, int]) -> np.ndarray:
    """Recorte do objeto em dois painéis: referência (azul) e candidato (laranja).

    O contorno branco é a anotação aprovada, igual nos dois lados.
    """
    height, width = target.shape
    x0, y0, x1, y1 = bbox
    pad_x, pad_y = int(0.3 * (x1 - x0)) + 8, int(0.3 * (y1 - y0)) + 8
    left, top = max(0, x0 - pad_x), max(0, y0 - pad_y)
    right, bottom = min(width, x1 + pad_x), min(height, y1 + pad_y)
    panels = []
    for mask, color in ((reference, (59, 130, 246)), (candidate, (249, 115, 22))):
        crop = pixels[top:bottom, left:right].astype(np.float32).copy()
        region = mask[top:bottom, left:right]
        crop[region] = crop[region] * 0.55 + np.asarray(color, dtype=np.float32) * 0.45
        crop = crop.astype(np.uint8)
        contours, _ = cv2.findContours(target[top:bottom, left:right].astype(np.uint8), cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)
        crop = np.ascontiguousarray(crop)
        cv2.drawContours(crop, contours, -1, (255, 255, 255), 2)
        scale = 240.0 / max(1, crop.shape[0])
        crop = cv2.resize(crop, (max(1, int(crop.shape[1] * scale)), 240), interpolation=cv2.INTER_AREA if scale < 1 else cv2.INTER_LINEAR)
        panels.append(crop)
    gap = np.full((240, 6, 3), 255, dtype=np.uint8)
    return np.concatenate([panels[0], gap, panels[1]], axis=1)


def summarize_comparison(holdout: list[Sample], reference: dict, candidate: dict, config: TrainConfig, max_clicks: int) -> dict[str, Any]:
    """Agrega por imagem, mede incerteza por bootstrap agrupado e compara subgrupos."""
    seed = config.seed
    per_image = []
    instance_rows = []
    for sample in holdout:
        keys = [(sample.key, instance["index"]) for instance in sample.instances if (sample.key, instance["index"]) in candidate]
        if not keys:
            continue

        def primary(entry: dict[str, Any]) -> float:
            return (entry["box"]["dice"] + entry["point"]["dice"]) / 2.0

        ref_values = [primary(reference[key]) for key in keys]
        cand_values = [primary(candidate[key]) for key in keys]
        per_image.append({"key": sample.key, "group": sample.group_id, "reference": float(np.mean(ref_values)), "candidate": float(np.mean(cand_values))})
        for key, ref_value, cand_value in zip(keys, ref_values, cand_values):
            instance = sample.instances[key[1]]
            instance_rows.append({
                "group": sample.group_id,
                "label": instance["label"],
                "label_name": instance["label_name"],
                "size": size_bin(instance["relative_area"]),
                "reference": ref_value,
                "candidate": cand_value,
            })
    deltas = [row["candidate"] - row["reference"] for row in per_image]
    clusters = [row["group"] for row in per_image]
    mean_delta, ci_low, ci_high = cluster_bootstrap(deltas, clusters, config.bootstrap_samples, seed)
    reference_mean = float(np.mean([row["reference"] for row in per_image])) if per_image else 0.0
    candidate_mean = float(np.mean([row["candidate"] for row in per_image])) if per_image else 0.0
    tolerance = 0.01
    primary_block = {
        "metric": "dice_per_image_box_and_point",
        "reference_mean": reference_mean,
        "candidate_mean": candidate_mean,
        "mean_delta": mean_delta,
        "ci_low": ci_low,
        "ci_high": ci_high,
        "relative_gain": mean_delta / reference_mean if reference_mean > 1e-9 else None,
        "share_improved": float(np.mean([delta > tolerance for delta in deltas])) if deltas else 0.0,
        "share_worsened": float(np.mean([delta < -tolerance for delta in deltas])) if deltas else 0.0,
        "share_unchanged": float(np.mean([abs(delta) <= tolerance for delta in deltas])) if deltas else 0.0,
        "images": len(per_image),
    }

    protocols = {}
    for protocol in ("box", "point", "box_jitter"):
        block = {}
        for metric in ("dice", "iou", "boundary_iou"):
            ref_by_image, cand_by_image = [], []
            for sample in holdout:
                keys = [(sample.key, instance["index"]) for instance in sample.instances if (sample.key, instance["index"]) in candidate]
                if keys:
                    ref_by_image.append(float(np.mean([reference[key][protocol][metric] for key in keys])))
                    cand_by_image.append(float(np.mean([candidate[key][protocol][metric] for key in keys])))
            block[metric] = {
                "reference": float(np.mean(ref_by_image)) if ref_by_image else 0.0,
                "candidate": float(np.mean(cand_by_image)) if cand_by_image else 0.0,
            }
        protocols[protocol] = block

    subgroups = []
    for kind, attribute in (("class", "label"), ("size", "size")):
        names = sorted({row[attribute] for row in instance_rows})
        for name in names:
            rows = [row for row in instance_rows if row[attribute] == name]
            values = [row["candidate"] - row["reference"] for row in rows]
            mean, low, high = cluster_bootstrap(values, [row["group"] for row in rows], config.bootstrap_samples, seed + 7)
            regression = "none"
            if len(rows) >= 3 and mean <= -0.02:
                regression = "significant" if high < 0 else "possible"
            subgroups.append({
                "kind": kind,
                "name": rows[0]["label_name"] if kind == "class" else name,
                "instances": len(rows),
                "reference_mean": float(np.mean([row["reference"] for row in rows])),
                "candidate_mean": float(np.mean([row["candidate"] for row in rows])),
                "mean_delta": mean,
                "ci_low": low,
                "ci_high": high,
                "regression": regression,
            })

    def noc(curves: list[list[float]], threshold: float) -> tuple[list[int], float]:
        counts = []
        failures = 0
        for curve in curves:
            reached = next((index + 1 for index, value in enumerate(curve) if value >= threshold), None)
            if reached is None:
                failures += 1
                reached = max_clicks
            counts.append(reached)
        return counts, failures / max(1, len(curves))

    keys = list(candidate)
    groups_by_key = {(sample.key, instance["index"]): sample.group_id for sample in holdout for instance in sample.instances}
    interactive: dict[str, Any] = {"max_clicks": max_clicks}
    for name, results in (("reference", reference), ("candidate", candidate)):
        curves = [results[key]["curve"] for key in keys]
        noc85, fail85 = noc(curves, 0.85)
        noc90, fail90 = noc(curves, 0.90)
        interactive[name] = {
            "noc85": float(np.mean(noc85)) if noc85 else None,
            "noc90": float(np.mean(noc90)) if noc90 else None,
            "fail85": fail85,
            "fail90": fail90,
            "curve": [float(np.mean([curve[index] for curve in curves])) for index in range(max_clicks)] if curves else [],
            "_noc90": noc90,
        }
    if keys:
        noc_deltas = [c - r for c, r in zip(interactive["candidate"].pop("_noc90"), interactive["reference"].pop("_noc90"))]
        mean, low, high = cluster_bootstrap(noc_deltas, [groups_by_key[key] for key in keys], config.bootstrap_samples, seed + 11)
        interactive.update(noc90_delta=mean, noc90_ci_low=low, noc90_ci_high=high)
    else:
        interactive["candidate"].pop("_noc90", None)
        interactive["reference"].pop("_noc90", None)
        interactive["noc90_delta"] = None

    return {
        "primary": primary_block,
        "protocols": protocols,
        "subgroups": subgroups,
        "interactive": interactive,
        "per_image": [{"delta": row["candidate"] - row["reference"], "reference": row["reference"], "candidate": row["candidate"]} for row in per_image],
        "holdout": {
            "images": len(per_image),
            "groups": len(set(clusters)),
            "instances": len(instance_rows),
        },
    }


# ---------------------------------------------------------------------------
# Serviço: o que o conector expõe
# ---------------------------------------------------------------------------


@dataclass
class LiveModel:
    model: Any
    model_id: str
    family: str
    device: str
    checkpoint: Path | None


class AdaptiveError(Exception):
    def __init__(self, status: int, code: str, message: str, **params: Any):
        super().__init__(message)
        self.status = status
        self.code = code
        self.params = params


ACTIVE_RUN_STATES = ("queued", "preparing", "training", "evaluating")


class AdaptiveService:
    """Estado do Adaptive AI no conector: dados, rodadas e o adaptador ativo.

    O conector serve um modelo para todas as abas; por isso há no máximo um
    adaptador ativo de cada vez, registrado em `active.json` com o projeto, a
    rodada e a identidade do modelo base. Trocar de modelo base desliga o
    adaptador; voltar ao mesmo modelo o reaplica, se o arquivo ainda conferir.
    """

    def __init__(
        self,
        *,
        root: Path,
        get_live_model: Callable[[], LiveModel | None],
        predictor_lock: Any,
        invalidate_embedding: Callable[[], None],
        model_factory: Callable[[], Any],
        decode_image: Callable[[str], tuple[np.ndarray, bytes, str]] = decode_data_url,
        readiness: ReadinessConfig | None = None,
        segmenter_factory: Callable[[Any, str], Any] = Sam2Segmenter,
        compute_embeddings: bool = True,
    ):
        self.root = root
        self.get_live_model = get_live_model
        self.predictor_lock = predictor_lock
        self.invalidate_embedding = invalidate_embedding
        self.model_factory = model_factory
        self.decode_image = decode_image
        self.readiness = readiness or ReadinessConfig()
        self.segmenter_factory = segmenter_factory
        self.compute_embeddings = compute_embeddings
        self._job: TrainingJob | None = None
        self._job_thread: threading.Thread | None = None
        self._job_lock = threading.Lock()
        self._state_lock = threading.Lock()
        self._fingerprints: dict[str, str] = {}
        self._applied: dict[str, Any] | None = None
        self._recover_interrupted()

    # --- utilidades ------------------------------------------------------------

    def store(self, project_id: str) -> ProjectStore:
        try:
            return ProjectStore(self.root, project_id)
        except ValueError as error:
            raise AdaptiveError(400, "invalid_project", str(error)) from error

    def _recover_interrupted(self) -> None:
        """Rodadas que estavam no meio quando o conector caiu viram "interrompidas"."""
        try:
            projects = [path for path in (self.root / "projects").iterdir() if path.is_dir()]
        except OSError:
            return
        for project in projects:
            with contextlib.suppress(ValueError):
                store = ProjectStore(self.root, project.name)
                for record in store.list_runs():
                    if record.get("status") in ACTIVE_RUN_STATES:
                        record.update(status="interrupted", stage="interrupted", error={"code": "interrupted", "message": "o conector foi encerrado durante a rodada"})
                        store.write_run(record)

    def _live(self, require_supported: bool = True) -> LiveModel:
        live = self.get_live_model()
        if live is None:
            raise AdaptiveError(503, "model_not_ready", "o modelo ainda não está carregado")
        if require_supported and live.family not in SUPPORTED_FAMILIES:
            raise AdaptiveError(409, "unsupported_model", f"Adaptive AI só funciona com SAM 2.1 e MedSAM2; o modelo carregado é {live.model_id}", model_id=live.model_id)
        return live

    def fingerprint(self, live: LiveModel) -> str:
        """Identidade do checkpoint base: sha256 do arquivo, com cache por tamanho e data."""
        if live.checkpoint is None:
            return f"id:{live.model_id}"
        path = Path(live.checkpoint)
        try:
            stat = path.stat()
        except OSError:
            return f"id:{live.model_id}"
        cache_key = f"{path.resolve()}:{stat.st_size}:{stat.st_mtime_ns}"
        cached = self._fingerprints.get(cache_key)
        if cached:
            return cached
        disk_cache = _read_json(self.root / "fingerprints.json", {}) or {}
        digest = disk_cache.get(hashlib.sha256(cache_key.encode()).hexdigest())
        if not digest:
            hasher = hashlib.sha256()
            with path.open("rb") as handle:
                for chunk in iter(lambda: handle.read(4 * 1024 * 1024), b""):
                    hasher.update(chunk)
            digest = hasher.hexdigest()
            disk_cache[hashlib.sha256(cache_key.encode()).hexdigest()] = digest
            _write_json_atomic(self.root / "fingerprints.json", disk_cache)
        self._fingerprints[cache_key] = digest
        return digest

    def _active(self) -> dict[str, Any] | None:
        active = _read_json(self.root / "active.json")
        return active if isinstance(active, dict) else None

    def active_summary(self) -> dict[str, Any] | None:
        """O que /predict anuncia: qual adaptador está aplicado agora, se algum."""
        applied = self._applied
        if not applied:
            return None
        return {"project_id": applied["project_id"], "run_id": applied["run_id"]}

    # --- estado ------------------------------------------------------------------

    def status(self) -> dict[str, Any]:
        live = self.get_live_model()
        model = None
        if live is not None:
            model = {"model_id": live.model_id, "family": live.family, "device": live.device, "supported": live.family in SUPPORTED_FAMILIES}
        active = self._active()
        job = self._job
        training = None
        if job is not None and job.record.get("status") in ACTIVE_RUN_STATES:
            training = {"project_id": job.store.project_id, "run_id": job.record["run_id"], "status": job.record["status"], "progress": dict(job.progress)}
        return {
            "api_version": ADAPTIVE_API_VERSION,
            "available": TORCH_AVAILABLE,
            "model": model,
            "active": {
                "project_id": active["project_id"],
                "run_id": active["run_id"],
                "base_model_id": active["base_model_id"],
                "applied": bool(self._applied and self._applied["run_id"] == active["run_id"]),
            } if active else None,
            "training": training,
        }

    # --- dados -----------------------------------------------------------------

    def list_items(self, project_id: str) -> dict[str, Any]:
        return {"items": self.store(project_id).fingerprints()}

    def _embed(self, pixels: np.ndarray) -> tuple[str, np.ndarray] | None:
        if not self.compute_embeddings:
            return None
        live = self.get_live_model()
        if live is None or live.family not in SUPPORTED_FAMILIES:
            return None
        with self.predictor_lock:
            vector = pooled_embedding(self.segmenter_factory(live.model, live.device), pixels)
        return live.model_id, vector

    def put_item(self, project_id: str, key: str, payload: dict[str, Any]) -> dict[str, Any]:
        store = self.store(project_id)
        try:
            return ingest_item(store, key, payload, self.decode_image, self._embed)
        except ValueError as error:
            raise AdaptiveError(400, "invalid_item", str(error)) from error

    def delete_item(self, project_id: str, key: str) -> dict[str, Any]:
        store = self.store(project_id)
        try:
            removed = store.delete_item(key)
        except ValueError as error:
            raise AdaptiveError(400, "invalid_item", str(error)) from error
        return {"key": key, "removed": removed}

    def assess(self, project_id: str) -> dict[str, Any]:
        live = self.get_live_model()
        supported = live is not None and live.family in SUPPORTED_FAMILIES
        report = assess_readiness(self.store(project_id), self.readiness, live.model_id if live else None, supported)
        report["model_id"] = live.model_id if live else None
        return report

    # --- treino ----------------------------------------------------------------

    def start_training(self, project_id: str, raw_config: dict[str, Any] | None) -> dict[str, Any]:
        _require_torch()
        live = self._live()
        try:
            config = TrainConfig.from_mapping(raw_config)
        except ValueError as error:
            raise AdaptiveError(400, "invalid_config", str(error)) from error
        store = self.store(project_id)
        report = assess_readiness(store, self.readiness, live.model_id, True)
        if not report["can_train"]:
            raise AdaptiveError(409, "not_ready", "o dataset ainda não tem o mínimo para um treino experimental", state=report["state"])
        with self._job_lock:
            if self._job is not None and self._job.record.get("status") in ACTIVE_RUN_STATES:
                raise AdaptiveError(409, "training_busy", "já existe uma rodada em andamento neste conector", project_id=self._job.store.project_id)
            fingerprint = self.fingerprint(live)
            reference = None
            active = self._active()
            if active and active.get("project_id") == project_id and active.get("base_fingerprint") == fingerprint:
                with contextlib.suppress(Exception):
                    metadata, state = load_adapter(store.run_dir(active["run_id"]) / "adapter.pt")
                    reference = (active["run_id"], metadata, state)
            run_id = new_run_id()
            record = {
                "run_id": run_id,
                "project_id": project_id,
                "created_at": _now_iso(),
                "status": "queued",
                "stage": "queued",
                "activation": "inactive",
                "base_model": {"model_id": live.model_id, "family": live.family, "fingerprint": fingerprint, "device": live.device},
                "config": asdict(config),
                "snapshot_id": "snap-" + run_id[4:],
                "readiness_state": report["state"],
                "reference": {"kind": "adapter", "run_id": reference[0]} if reference else {"kind": "base", "run_id": None},
                "epochs": [],
            }
            store.write_run(record)
            job = TrainingJob(
                store=store,
                record=record,
                config=config,
                readiness=self.readiness,
                model_factory=self.model_factory,
                device=live.device,
                reference=reference,
                model_key=live.model_id,
                segmenter_factory=self.segmenter_factory,
            )
            self._job = job
            thread = threading.Thread(target=job.run, name=f"poligome-adaptive-{run_id}", daemon=True)
            self._job_thread = thread
            thread.start()
        return self._public_run(record)

    def wait_for_training(self, timeout: float | None = None) -> None:
        thread = self._job_thread
        if thread is not None:
            thread.join(timeout)

    def cancel(self, project_id: str, run_id: str) -> dict[str, Any]:
        job = self._job
        if job is None or job.store.project_id != project_id or job.record["run_id"] != run_id or job.record.get("status") not in ACTIVE_RUN_STATES:
            raise AdaptiveError(409, "not_running", "esta rodada não está em andamento")
        job.cancel_event.set()
        return {"run_id": run_id, "cancelling": True}

    def list_runs(self, project_id: str) -> dict[str, Any]:
        store = self.store(project_id)
        return {"runs": [self._run_summary(record) for record in store.list_runs()], "history": store.history()[-50:]}

    def get_run(self, project_id: str, run_id: str) -> dict[str, Any]:
        store = self.store(project_id)
        try:
            record = store.read_run(run_id)
        except ValueError as error:
            raise AdaptiveError(400, "invalid_run", str(error)) from error
        if record is None:
            raise AdaptiveError(404, "run_not_found", "rodada não encontrada")
        public = self._public_run(record)
        job = self._job
        if job is not None and job.record["run_id"] == run_id and record.get("status") in ACTIVE_RUN_STATES:
            public["progress"] = dict(job.progress)
        return public

    @staticmethod
    def _public_run(record: dict[str, Any]) -> dict[str, Any]:
        public = copy.deepcopy(record)
        lora = public.get("lora")
        if isinstance(lora, dict) and "targets" in lora:
            lora["target_count"] = len(lora.pop("targets"))
        return public

    @staticmethod
    def _run_summary(record: dict[str, Any]) -> dict[str, Any]:
        comparison = record.get("comparison") or {}
        primary = comparison.get("primary") or {}
        return {
            "run_id": record["run_id"],
            "created_at": record.get("created_at"),
            "finished_at": record.get("finished_at"),
            "status": record.get("status"),
            "activation": record.get("activation", "inactive"),
            "base_model_id": (record.get("base_model") or {}).get("model_id"),
            "best_epoch": record.get("best_epoch"),
            "epochs_run": record.get("epochs_run"),
            "diagnosis": (record.get("diagnosis") or {}).get("state"),
            "outcome": (comparison.get("decision") or {}).get("outcome"),
            "mean_delta": primary.get("mean_delta"),
            "ci_low": primary.get("ci_low"),
            "ci_high": primary.get("ci_high"),
            "holdout_set_id": (record.get("snapshot") or {}).get("holdout_set_id"),
            "error": record.get("error"),
        }

    # --- ativação --------------------------------------------------------------

    def _load_compatible(self, store: ProjectStore, record: dict[str, Any], live: LiveModel) -> tuple[dict[str, Any], dict[str, Any], str]:
        fingerprint = self.fingerprint(live)
        base = record.get("base_model") or {}
        if base.get("model_id") != live.model_id or base.get("fingerprint") != fingerprint:
            raise AdaptiveError(409, "incompatible_base", "este adaptador foi treinado sobre outro modelo base", trained_on=base.get("model_id"), loaded=live.model_id)
        path = store.run_dir(record["run_id"]) / "adapter.pt"
        if not path.is_file():
            raise AdaptiveError(409, "adapter_missing", "o arquivo do adaptador não existe mais")
        digest = hashlib.sha256(path.read_bytes()).hexdigest()
        if (record.get("adapter") or {}).get("sha256") != digest:
            raise AdaptiveError(409, "adapter_corrupt", "o arquivo do adaptador não confere com o registro da rodada")
        metadata, state = load_adapter(path)
        if metadata.get("project_id") != store.project_id or metadata.get("run_id") != record["run_id"]:
            raise AdaptiveError(409, "adapter_mismatch", "o adaptador não pertence a esta rodada")
        return metadata, state, fingerprint

    def _apply_live(self, live: LiveModel, metadata: dict[str, Any], state: dict[str, Any], project_id: str, run_id: str) -> None:
        with self.predictor_lock:
            try:
                apply_adapter(live.model, metadata, state)
            except Exception:
                remove_lora(live.model)
                self._applied = None
                self.invalidate_embedding()
                raise
            live.model.eval()
            self._applied = {"project_id": project_id, "run_id": run_id}
            # O embedding em cache foi calculado com o encoder anterior.
            self.invalidate_embedding()

    def activate(self, project_id: str, run_id: str, override: bool = False) -> dict[str, Any]:
        live = self._live()
        store = self.store(project_id)
        record = store.read_run(run_id) if RUN_ID_PATTERN.fullmatch(run_id) else None
        if record is None:
            raise AdaptiveError(404, "run_not_found", "rodada não encontrada")
        if record.get("status") != "completed":
            raise AdaptiveError(409, "not_completed", "só uma rodada concluída e comparada pode ser ativada")
        outcome = ((record.get("comparison") or {}).get("decision") or {}).get("outcome")
        if outcome == "not_improved":
            raise AdaptiveError(409, "not_improved", "a comparação não mostrou melhora; o modelo anterior foi mantido")
        if outcome == "insufficient_evidence" and not override:
            raise AdaptiveError(409, "needs_confirmation", "a evidência é insuficiente; confirme para ativar mesmo assim")
        metadata, state, fingerprint = self._load_compatible(store, record, live)
        with self._state_lock:
            previous = self._active()
            self._apply_live(live, metadata, state, project_id, run_id)
            _write_json_atomic(self.root / "active.json", {
                "project_id": project_id, "run_id": run_id, "base_model_id": live.model_id,
                "base_fingerprint": fingerprint, "activated_at": _now_iso(),
            })
            if previous and previous.get("project_id") and (previous["project_id"], previous["run_id"]) != (project_id, run_id):
                with contextlib.suppress(Exception):
                    old_store = self.store(previous["project_id"])
                    old = old_store.read_run(previous["run_id"])
                    if old:
                        old["activation"] = "superseded"
                        old_store.write_run(old)
            record["activation"] = "active"
            store.write_run(record)
            store.log_history({"action": "activate", "run_id": run_id, "override": bool(override), "outcome": outcome, "previous_run_id": (previous or {}).get("run_id")})
        return self.status()

    def reject(self, project_id: str, run_id: str) -> dict[str, Any]:
        store = self.store(project_id)
        record = store.read_run(run_id) if RUN_ID_PATTERN.fullmatch(run_id) else None
        if record is None:
            raise AdaptiveError(404, "run_not_found", "rodada não encontrada")
        if record.get("activation") == "active":
            raise AdaptiveError(409, "is_active", "desative o adaptador antes de rejeitá-lo")
        record["activation"] = "rejected"
        store.write_run(record)
        store.log_history({"action": "reject", "run_id": run_id})
        return self._run_summary(record)

    def deactivate(self, project_id: str | None = None) -> dict[str, Any]:
        with self._state_lock:
            active = self._active()
            live = self.get_live_model()
            if live is not None and TORCH_AVAILABLE:
                with self.predictor_lock:
                    remove_lora(live.model)
                    self.invalidate_embedding()
            self._applied = None
            with contextlib.suppress(FileNotFoundError):
                (self.root / "active.json").unlink()
            if active:
                with contextlib.suppress(Exception):
                    store = self.store(active["project_id"])
                    record = store.read_run(active["run_id"])
                    if record:
                        record["activation"] = "inactive"
                        store.write_run(record)
                    store.log_history({"action": "deactivate", "run_id": active["run_id"], "requested_by_project": project_id})
        return self.status()

    def rollback(self, project_id: str) -> dict[str, Any]:
        """Volta ao adaptador ativado antes do atual; sem anterior, volta ao modelo base."""
        store = self.store(project_id)
        active = self._active()
        current = active["run_id"] if active and active.get("project_id") == project_id else None
        activations = [event["run_id"] for event in store.history() if event.get("action") == "activate"]
        previous = None
        if current is not None:
            seen_current = False
            for run_id in reversed(activations):
                if run_id == current and not seen_current:
                    seen_current = True
                    continue
                if seen_current and run_id != current:
                    previous = run_id
                    break
        if previous is not None:
            try:
                result = self.activate(project_id, previous, override=True)
                store.log_history({"action": "rollback", "from_run_id": current, "to_run_id": previous})
                return result
            except AdaptiveError:
                pass  # o anterior não é mais compatível: o retorno seguro é o modelo base
        result = self.deactivate(project_id)
        store.log_history({"action": "rollback", "from_run_id": current, "to_run_id": None})
        return result

    def on_model_loaded(self) -> None:
        """Reaplica o adaptador ativo quando o conector sobe com o mesmo modelo base."""
        active = self._active()
        live = self.get_live_model()
        self._applied = None
        if not active or live is None or live.family not in SUPPORTED_FAMILIES or live.model_id != active.get("base_model_id"):
            return
        try:
            store = self.store(active["project_id"])
            record = store.read_run(active["run_id"])
            if record is None:
                return
            metadata, state, _ = self._load_compatible(store, record, live)
            self._apply_live(live, metadata, state, active["project_id"], active["run_id"])
            print(f"Adaptive AI: adaptador {active['run_id']} reaplicado.", flush=True)
        except Exception as error:  # noqa: BLE001 - nunca derrubar o conector por causa do adaptador
            print(f"Adaptive AI: adaptador ativo não reaplicado: {error}", flush=True)

    def example_path(self, project_id: str, run_id: str, name: str) -> Path:
        if not EXAMPLE_NAME_PATTERN.fullmatch(name):
            raise AdaptiveError(400, "invalid_example", "nome de exemplo inválido")
        store = self.store(project_id)
        try:
            path = store.run_dir(run_id) / name
        except ValueError as error:
            raise AdaptiveError(400, "invalid_run", str(error)) from error
        if not path.is_file():
            raise AdaptiveError(404, "example_not_found", "exemplo não encontrado")
        return path


# ---------------------------------------------------------------------------
# HTTP
# ---------------------------------------------------------------------------


def create_router(service: AdaptiveService) -> Any:
    """Rotas /adaptive/* para o FastAPI do conector."""
    from fastapi import APIRouter, Body, HTTPException
    from fastapi.responses import FileResponse

    router = APIRouter(prefix="/adaptive")

    def call(function: Callable[..., Any], *args: Any, **kwargs: Any) -> Any:
        try:
            return function(*args, **kwargs)
        except AdaptiveError as error:
            raise HTTPException(status_code=error.status, detail={"code": error.code, "message": str(error), "params": error.params}) from error

    @router.get("/status")
    def adaptive_status():
        return service.status()

    @router.get("/projects/{project_id}/items")
    def adaptive_items(project_id: str):
        return call(service.list_items, project_id)

    @router.post("/projects/{project_id}/items/{key}")
    def adaptive_put_item(project_id: str, key: str, payload: dict = Body(...)):
        return call(service.put_item, project_id, key, payload)

    @router.delete("/projects/{project_id}/items/{key}")
    def adaptive_delete_item(project_id: str, key: str):
        return call(service.delete_item, project_id, key)

    @router.post("/projects/{project_id}/assess")
    def adaptive_assess(project_id: str):
        return call(service.assess, project_id)

    @router.get("/projects/{project_id}/runs")
    def adaptive_runs(project_id: str):
        return call(service.list_runs, project_id)

    @router.post("/projects/{project_id}/runs")
    def adaptive_start(project_id: str, payload: dict = Body(default={})):
        config = payload.get("config") if isinstance(payload, dict) else None
        if config is not None and not isinstance(config, dict):
            raise HTTPException(status_code=400, detail={"code": "invalid_config", "message": "config deve ser um objeto", "params": {}})
        return call(service.start_training, project_id, config)

    @router.get("/projects/{project_id}/runs/{run_id}")
    def adaptive_run(project_id: str, run_id: str):
        return call(service.get_run, project_id, run_id)

    @router.post("/projects/{project_id}/runs/{run_id}/cancel")
    def adaptive_cancel(project_id: str, run_id: str):
        return call(service.cancel, project_id, run_id)

    @router.post("/projects/{project_id}/runs/{run_id}/activate")
    def adaptive_activate(project_id: str, run_id: str, payload: dict = Body(default={})):
        override = bool(payload.get("override")) if isinstance(payload, dict) else False
        return call(service.activate, project_id, run_id, override)

    @router.post("/projects/{project_id}/runs/{run_id}/reject")
    def adaptive_reject(project_id: str, run_id: str):
        return call(service.reject, project_id, run_id)

    @router.post("/projects/{project_id}/rollback")
    def adaptive_rollback(project_id: str):
        return call(service.rollback, project_id)

    @router.post("/deactivate")
    def adaptive_deactivate():
        return call(service.deactivate)

    @router.get("/projects/{project_id}/runs/{run_id}/examples/{name}")
    def adaptive_example(project_id: str, run_id: str, name: str):
        path = call(service.example_path, project_id, run_id, name)
        return FileResponse(path, media_type="image/png", headers={"Cache-Control": "no-store"})

    return router
