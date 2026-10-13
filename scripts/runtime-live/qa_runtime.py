"""Serve a deterministic QA adapter over the real poligome-runtime transport.

Finds dark blobs (threshold on luminance) per tile and emits every annotation
kind the contract has, so the editor's whole runtime path runs end to end
without torch or downloaded weights.

    POLIGOME_RUNTIME_DIR=../poligome-runtime python qa_runtime.py --port 7861 \
        [--kinds box,mask] [--slow 0.3] [--fail-after N]

Needs numpy and pillow in the interpreter, and a clone of poligome-runtime.
"""

from __future__ import annotations

import argparse
import os
import sys
import time

import numpy as np

sys.path.insert(0, os.environ.get("POLIGOME_RUNTIME_DIR", "../poligome-runtime"))
from poligome_runtime import InProcessWorker, RuntimeService, serve  # noqa: E402
from poligome_runtime.adapter import (  # noqa: E402
    Box, BooleanParam, EnumParam, Keypoint, Manifest, Mask, ModelAdapter, NumberParam,
    Point, Polygon, Polyline, Rect,
)

parser = argparse.ArgumentParser()
parser.add_argument("--port", type=int, default=7871)
parser.add_argument("--kinds", default="box,polygon,mask,keypoint,polyline")
parser.add_argument("--slow", type=float, default=0.0, help="seconds per tile")
parser.add_argument("--max-edge", type=int, default=512)
parser.add_argument("--fail-after", type=int, default=-1, help="raise after N tiles")
parser.add_argument("--accepts", default="")
args = parser.parse_args()
KINDS = [k for k in args.kinds.split(",") if k]


class QaAdapter(ModelAdapter):
    calls = 0

    @property
    def manifest(self) -> Manifest:
        return Manifest(
            id="qa-blobs",
            name="QA Blobs",
            version="1.0.0",
            produces=KINDS,
            accepts=[a for a in args.accepts.split(",") if a],
            max_edge=args.max_edge,
            params=(
                NumberParam(key="threshold", label="Limiar", min=0.0, max=1.0, step=0.05, default=0.5),
                BooleanParam(key="invert", label="Inverter", default=False),
                EnumParam(key="label", label="Classe", options=("objeto", "fundo"), default="objeto"),
            ),
        )

    def load(self, device: str) -> None:
        pass

    def infer(self, request, state=None):
        QaAdapter.calls += 1
        if args.fail_after >= 0 and QaAdapter.calls > args.fail_after:
            raise RuntimeError("QA adapter failure on purpose")
        if args.slow:
            time.sleep(args.slow)
        image = request.image
        h, w = image.shape[:2]
        threshold = float(request.params.get("threshold", 0.5))
        invert = bool(request.params.get("invert", False))
        label = str(request.params.get("label", "objeto"))
        lum = image.mean(axis=2) / 255.0
        fg = lum > threshold if invert else lum < threshold
        if not fg.any():
            return
        ys, xs = np.nonzero(fg)
        x0, x1, y0, y1 = float(xs.min()), float(xs.max() + 1), float(ys.min()), float(ys.max() + 1)
        cx, cy = (x0 + x1) / 2, (y0 + y1) / 2
        if "box" in KINDS:
            yield Box(box=Rect(x0, y0, x1 - x0, y1 - y0), label=label, score=0.9)
        if "polygon" in KINDS:
            yield Polygon(vertices=[Point(x0, y0), Point(x1, y0), Point(x1, y1), Point(x0, y1)], label=label, score=0.8)
        if "mask" in KINDS:
            yield Mask(mask=fg, label=label, score=0.7)
        if "keypoint" in KINDS:
            yield Keypoint(at=Point(cx, cy), label=label, score=0.6)
        if "polyline" in KINDS:
            yield Polyline(vertices=[Point(x0, y0), Point(cx, cy), Point(x1, y1)], label=label, score=0.5)


print(f"[qa-runtime] http://127.0.0.1:{args.port} kinds={KINDS}", flush=True)
serve(RuntimeService(InProcessWorker(QaAdapter(), device="cpu")), port=args.port)
