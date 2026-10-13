#!/usr/bin/env python3
"""Experimentos de validação do Adaptive AI com um SAM 2.1 pré-treinado.

Domínio: campos de microscopia sintéticos com núcleos que se tocam (ver
tests/helpers/adaptive_fixtures.nuclei_image). Nenhum dado real é usado. Cada
"lâmina" tem coloração, iluminação e tamanho próprios, e os campos de uma
lâmina são correlacionados — por isso cada lâmina é um grupo.

    python scripts/adaptive-experiments.py --checkpoint sam2.1_hiera_tiny.pt --out resultados/

Experimentos:
  main      48 campos de 16 lâminas, configuração automática, com curva de aprendizado
  half      metade dos grupos de treino de `main`, mesmo holdout: a curva desta
            rodada projeta o resultado com o dobro de grupos, e `main` mostra o real
  overfit   poucas imagens e taxa alta, para ver o diagnóstico e o melhor checkpoint
  encoder   mesmos dados de `main` com LoRA também no encoder (menos épocas)
"""

from __future__ import annotations

import argparse
import json
import shutil
import sys
import threading
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tests" / "helpers"))
from adaptive_fixtures import load_adaptive, nuclei_payload  # noqa: E402

adaptive = load_adaptive()


def build_service(root: Path, checkpoint: str, model_config: str, readiness=None):
    from sam2.build_sam import build_sam2

    def factory():
        return build_sam2(model_config, checkpoint, device="cpu", mode="eval")

    live = factory()
    service = adaptive.AdaptiveService(
        root=root,
        get_live_model=lambda: adaptive.LiveModel(live, "sam2.1-hiera-tiny", "sam2", "cpu", Path(checkpoint)),
        predictor_lock=threading.Lock(),
        invalidate_embedding=lambda: None,
        model_factory=factory,
        readiness=readiness,
    )
    return service, live


def fill(service, project: str, slides: range, fields: int) -> None:
    for slide in slides:
        for field in range(fields):
            payload = nuclei_payload(slide * 100 + field, slide)
            payload["group"] = f"name:slide{slide:02d}_field"  # o que o navegador deduz do nome
            service.put_item(project, f"s{slide:02d}f{field:02d}xxxxxx", payload)


def train(service, project: str, config: dict, label: str) -> dict:
    started = time.monotonic()
    run = service.start_training(project, config)
    last = None
    while service.training_active():
        record = service.get_run(project, run["run_id"])
        progress = record.get("progress") or {}
        line = f"{record['status']} {progress.get('phase')} {progress.get('epoch')} {progress.get('model')}"
        if line != last:
            print(f"[{label}] {time.monotonic() - started:7.0f}s {line}", flush=True)
            last = line
        time.sleep(5)
    record = service.get_run(project, run["run_id"])
    record["wall_seconds"] = round(time.monotonic() - started, 1)
    print(f"[{label}] {record['status']} em {record['wall_seconds']} s; best={record.get('best_epoch')} diag={record.get('diagnosis', {}).get('state')} "
          f"decisão={((record.get('comparison') or {}).get('decision') or {}).get('outcome')}", flush=True)
    return record


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--checkpoint", required=True)
    parser.add_argument("--model-config", default="configs/sam2.1/sam2.1_hiera_t.yaml")
    parser.add_argument("--out", required=True)
    parser.add_argument("--only", nargs="*", default=["main", "half", "overfit", "encoder"])
    args = parser.parse_args()
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    root = out / "store"
    results: dict = {}
    service, _ = build_service(root, args.checkpoint, args.model_config)

    if "main" in args.only or "half" in args.only or "encoder" in args.only:
        fill(service, "p-exp-main-00001", range(16), 3)
        results["readiness_main"] = service.assess("p-exp-main-00001")
        print("prontidão main:", results["readiness_main"]["state"], results["readiness_main"]["counts"]["independent_groups"], flush=True)

    if "main" in args.only:
        results["main"] = train(service, "p-exp-main-00001", {"learning_curve": True}, "main")
        (out / "results.json").write_text(json.dumps(results, indent=1, ensure_ascii=False))

    if "half" in args.only:
        # Mesmo holdout de main, metade dos grupos de treino.
        main_store = service.store("p-exp-main-00001")
        split = main_store.split()
        items = {item["key"]: item for item in main_store.list_items()}
        train_groups = sorted({items[key]["group"] for key, side in split.items() if side == "train"})
        keep_groups = set(train_groups[: len(train_groups) // 2])
        half_store = service.store("p-exp-half-00001")
        half_store.ensure()
        kept = {}
        for key, side in split.items():
            if side == "holdout" or items[key]["group"] in keep_groups:
                shutil.copytree(main_store.item_dir(key), half_store.item_dir(key))
                kept[key] = side
        half_store.save_split(kept)
        results["readiness_half"] = service.assess("p-exp-half-00001")
        results["half"] = train(service, "p-exp-half-00001", {"learning_curve": True}, "half")
        (out / "results.json").write_text(json.dumps(results, indent=1, ensure_ascii=False))

    if "overfit" in args.only:
        relaxed = adaptive.ReadinessConfig(min_independent_experimental=6, min_holdout_groups=3, target_holdout_groups=3, min_holdout_instances=10)
        small, _ = build_service(root, args.checkpoint, args.model_config, readiness=relaxed)
        fill(small, "p-exp-overfit-01", range(30, 39), 1)
        results["readiness_overfit"] = small.assess("p-exp-overfit-01")
        results["overfit"] = train(small, "p-exp-overfit-01", {"learning_rate": 0.003, "max_epochs": 30, "min_epochs": 12, "patience": 12, "learning_curve": False}, "overfit")
        (out / "results.json").write_text(json.dumps(results, indent=1, ensure_ascii=False))

    if "encoder" in args.only:
        results["encoder"] = train(service, "p-exp-main-00001", {"strategy": "encoder_decoder", "max_epochs": 8, "learning_curve": False}, "encoder")
        (out / "results.json").write_text(json.dumps(results, indent=1, ensure_ascii=False))

    print("resultados em", out / "results.json")
    return 0


if __name__ == "__main__":
    sys.exit(main())
