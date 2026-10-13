#!/usr/bin/env python3
"""Smoke test do Adaptive AI contra um conector de verdade, só por HTTP.

Gera um dataset sintético (formas sobre fundo texturizado, nenhum dado real),
envia ao conector, avalia a prontidão, treina uma rodada curta, acompanha o
progresso, lê a comparação, ativa o adaptador quando a regra permite, confere
que /predict passa a anunciar o adaptador e que desativar devolve exatamente a
previsão do modelo original.

    python scripts/adaptive-smoke.py --base http://127.0.0.1:7860 --max-epochs 3

O conector precisa estar no ar com um modelo SAM 2.1 ou MedSAM2.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
import urllib.error
import urllib.request
import uuid
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tests" / "helpers"))
from adaptive_fixtures import item_payload, synthetic_image, data_url  # noqa: E402

OPENER = urllib.request.build_opener(urllib.request.ProxyHandler({}))


def call(base: str, method: str, path: str, body: dict | None = None, timeout: float = 600):
    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(base + path, data=data, method=method, headers={"Content-Type": "application/json"} if data else {})
    try:
        with OPENER.open(request, timeout=timeout) as response:
            return response.status, json.loads(response.read() or b"null")
    except urllib.error.HTTPError as error:
        return error.code, json.loads(error.read() or b"null")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", default="http://127.0.0.1:7860")
    parser.add_argument("--images", type=int, default=24)
    parser.add_argument("--strategy", default="decoder", choices=["auto", "decoder", "encoder_decoder"])
    parser.add_argument("--max-epochs", type=int, default=3)
    parser.add_argument("--report", help="grava o resumo em JSON neste caminho")
    args = parser.parse_args()
    base = args.base.rstrip("/")
    project = f"p-smoke-{uuid.uuid4().hex[:12]}"
    summary: dict = {"project": project}
    started = time.monotonic()

    status, health = call(base, "GET", "/health")
    assert status == 200 and health.get("status") == "ready", health
    print(f"conector: {health['model_id']} em {health['device']}; adaptive={health.get('adaptive')}")
    status, adaptive = call(base, "GET", "/adaptive/status")
    assert status == 200 and adaptive["model"]["supported"], adaptive

    t0 = time.monotonic()
    for index in range(args.images):
        payload = item_payload(4000 + index, size=(256, 192), shapes=3)
        status, result = call(base, "POST", f"/adaptive/projects/{project}/items/item-{index:04d}", payload)
        assert status == 200, result
    summary["upload_seconds"] = round(time.monotonic() - t0, 1)
    print(f"{args.images} imagens enviadas em {summary['upload_seconds']} s")

    status, report = call(base, "POST", f"/adaptive/projects/{project}/assess")
    assert status == 200, report
    summary["readiness"] = {"state": report["state"], "can_train": report["can_train"], "independent": report["counts"]["independent_groups"], "holdout": report["counts"]["holdout"], "diversity": report["diversity"]}
    print(f"prontidão: {report['state']} · {report['counts']['independent_groups']} independentes · holdout {report['counts']['holdout']}")
    assert report["can_train"], report["reasons"]

    image, objects = synthetic_image(4000, size=(256, 192))
    mask = objects[0][2]
    import numpy as np

    rows, cols = np.nonzero(mask)
    box = [float(cols.min()), float(rows.min()), float(cols.max() + 1), float(rows.max() + 1)]
    probe = {"image": data_url(image), "box": box, "multimask_output": False}
    status, before = call(base, "POST", "/predict", probe)
    assert status in (200, 422), before

    status, run = call(base, "POST", f"/adaptive/projects/{project}/runs", {"config": {"strategy": args.strategy, "max_epochs": args.max_epochs, "min_epochs": 1, "bootstrap_samples": 500, "max_clicks": 3}})
    assert status == 200, run
    run_id = run["run_id"]
    last = None
    while True:
        status, record = call(base, "GET", f"/adaptive/projects/{project}/runs/{run_id}")
        progress = record.get("progress") or {}
        line = f"{record['status']} {progress}"
        if line != last:
            print(f"  {time.monotonic() - started:6.0f}s {line}")
            last = line
        if record["status"] not in ("queued", "preparing", "training", "evaluating"):
            break
        time.sleep(2)
    assert record["status"] == "completed", record.get("error")
    comparison = record["comparison"]
    summary["run"] = {
        "run_id": run_id,
        "epochs": [{key: round(value, 4) if isinstance(value, float) else value for key, value in epoch.items()} for epoch in record["epochs"]],
        "best_epoch": record["best_epoch"],
        "diagnosis": record["diagnosis"],
        "lora": record["lora"],
        "data": record["data"],
        "timing": record.get("timing"),
        "primary": comparison["primary"],
        "decision": comparison["decision"],
        "interactive": {key: comparison["interactive"][key] for key in ("noc90_delta",)},
    }
    print(f"melhor época {record['best_epoch']} · diagnóstico {record['diagnosis']['state']} · decisão {comparison['decision']['outcome']}")
    print(f"Dice por imagem: {comparison['primary']['reference_mean']:.3f} → {comparison['primary']['candidate_mean']:.3f} "
          f"(Δ {comparison['primary']['mean_delta']:+.3f}, IC95 [{comparison['primary']['ci_low']:+.3f}, {comparison['primary']['ci_high']:+.3f}])")

    for example in comparison["examples"]:
        request = urllib.request.Request(f"{base}/adaptive/projects/{project}/runs/{run_id}/examples/{example['file']}")
        with OPENER.open(request, timeout=30) as response:
            assert response.read(8) == b"\x89PNG\r\n\x1a\n"

    outcome = comparison["decision"]["outcome"]
    if outcome == "not_improved":
        status, refused = call(base, "POST", f"/adaptive/projects/{project}/runs/{run_id}/activate", {"override": True})
        assert status == 409 and refused["detail"]["code"] == "not_improved", refused
        summary["activation"] = "refused (not_improved), as required"
        print("ativação recusada: não melhorou (correto)")
    else:
        status, refused = call(base, "POST", f"/adaptive/projects/{project}/runs/{run_id}/activate", {"override": False})
        if outcome == "insufficient_evidence":
            assert status == 409 and refused["detail"]["code"] == "needs_confirmation", refused
        status, active = call(base, "POST", f"/adaptive/projects/{project}/runs/{run_id}/activate", {"override": outcome != "improved"})
        assert status == 200 and active["active"]["run_id"] == run_id, active
        status, adapted = call(base, "POST", "/predict", probe)
        assert status in (200, 422), adapted
        if status == 200:
            assert adapted["adapter"] == {"project_id": project, "run_id": run_id}, adapted.get("adapter")
            assert adapted["reused_embedding"] is False, "o embedding em cache precisava ser invalidado"
        status, _ = call(base, "POST", "/adaptive/deactivate")
        assert status == 200
        status, restored = call(base, "POST", "/predict", probe)
        if status == 200 and before.get("polygon") is not None:
            assert restored["adapter"] is None
            assert restored["polygon"] == before["polygon"], "desativar precisa devolver a previsão original"
        status, rolled = call(base, "POST", f"/adaptive/projects/{project}/rollback")
        assert status == 200 and rolled["active"] is None
        summary["activation"] = f"activated ({outcome}), /predict reported the adapter, deactivation restored the original prediction"
        print("ativação, predição com adaptador, desativação e reversão: ok")

    summary["total_seconds"] = round(time.monotonic() - started, 1)
    if args.report:
        Path(args.report).write_text(json.dumps(summary, indent=1, ensure_ascii=False))
    print(f"smoke test concluído em {summary['total_seconds']} s")
    return 0


if __name__ == "__main__":
    sys.exit(main())
