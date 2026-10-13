#!/usr/bin/env python3
"""Validate a real SAM 3 checkpoint on CPU, with synthetic images only.

This supplements the HTTP smoke test. Cached-feature optimization checks LoRA
mechanics; its losses are not an independent evaluation of model quality.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import sys
import tempfile
import threading
import time
import traceback
import warnings
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tests" / "helpers"))
from adaptive_fixtures import apply_connector_sam3_cpu_patches, load_adaptive, synthetic_image


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--checkpoint", required=True)
    parser.add_argument("--out", default="resultados-adaptive/sam3-local/parity.json")
    parser.add_argument("--portable-adapter", help="Optional .plora exported by the HTTP smoke test")
    parser.add_argument("--saved-adapter", help="Corresponding adapter.pt saved by that training run")
    args = parser.parse_args()
    if args.saved_adapter and not args.portable_adapter:
        parser.error("--saved-adapter requires --portable-adapter")
    checkpoint = Path(args.checkpoint).resolve(strict=True)
    output = Path(args.out).resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    report = {"checkpoint": str(checkpoint), "device": "cpu", "precision": "float32", "seed": 1234, "tests": {}}
    started = time.monotonic()

    def save():
        report["elapsed_seconds"] = round(time.monotonic() - started, 3)
        output.write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")

    def passed(name, **values):
        report["tests"][name] = {"passed": True, **values}
        save()
        print(f"PASS {name}: {values}", flush=True)

    try:
        import numpy as np
        import torch
        import torch.nn.functional as F
        import skimage
        warnings.filterwarnings("error", message=r"(?s).*Skipping the post-processing step.*", category=UserWarning)
        report["skimage_version"] = skimage.__version__

        connector = apply_connector_sam3_cpu_patches()
        adaptive = load_adaptive()
        loads = []
        original_load = torch.nn.Module.load_state_dict

        def audited_load(model, state, *load_args, **load_kwargs):
            result = original_load(model, state, *load_args, **load_kwargs)
            loads.append({"class": type(model).__name__, "state_entries": len(state),
                          "model_entries": len(model.state_dict()),
                          "missing_keys": result.missing_keys, "unexpected_keys": result.unexpected_keys})
            return result

        torch.nn.Module.load_state_dict = audited_load
        try:
            adapter = connector.Sam3Adapter(connector.MODEL_SPECS["sam3-concepts"], checkpoint, "cpu")
        finally:
            torch.nn.Module.load_state_dict = original_load
        model = adapter.model
        assert loads and all(not load["missing_keys"] for load in loads), loads
        passed("checkpoint_load", loads=loads, parameters=sum(p.numel() for p in model.parameters()))

        segmenter = adaptive.Sam3Segmenter(model, "cpu")
        parity = []
        last = None
        for width, height in ((256, 256), (200, 150)):
            pixels, objects = synthetic_image(11, size=(width, height))
            mask = objects[0][2]
            rows, cols = np.nonzero(mask)
            cx, cy = float(cols.mean()), float(rows.mean())
            box = (float(cols.min()), float(rows.min()), float(cols.max() + 1), float(rows.max() + 1))
            print(f"Encoding {width}x{height} via official processor and Adaptive AI", flush=True)
            adapter.set_image(pixels)
            with torch.no_grad():
                features = segmenter.encode(segmenter.preprocess(pixels))
            prompts = {"positive": {"points": [(cx, cy, 1)]},
                       "positive_negative": {"points": [(cx, cy, 1), (3., 3., 0)]},
                       "box": {"box": box, "points": []}}
            for kind, prompt in prompts.items():
                points = prompt.get("points", [])
                with torch.inference_mode():
                    official_mask, _, official_logits = model.predict_inst(
                        adapter._state,
                        point_coords=np.asarray([p[:2] for p in points], dtype=np.float32) if points else None,
                        point_labels=np.asarray([p[2] for p in points], dtype=np.int32) if points else None,
                        box=np.asarray(box, dtype=np.float32) if kind == "box" else None,
                        multimask_output=False, return_logits=True)
                coords, labels = segmenter.prompt_tensors([prompt], width, height)
                with torch.no_grad():
                    ours, _ = segmenter.decode(features, coords, labels)
                # The official predictor clips the returned low-resolution logits.
                delta = float(np.abs(np.asarray(official_logits)[0] - ours[0, 0].clamp(-32, 32).numpy()).max())
                # Same CPU FP32 backend; tolerate minor floating point ordering differences.
                assert delta < 1e-3, (kind, width, height, delta)
                official_binary = np.asarray(official_mask)[0] > 0
                ours_binary = model.inst_interactive_predictor._transforms.postprocess_masks(ours, (height, width))[0, 0].numpy() > 0
                intersection = int((official_binary & ours_binary).sum())
                union = int((official_binary | ours_binary).sum())
                parity.append({"size": [width, height], "prompt": kind,
                               "max_logit_delta": delta, "mask_iou": intersection / union if union else 1.0})
                # Thresholding can move a boundary pixel when near-zero logits
                # differ within the tolerance; bound the foreground disagreement.
                assert parity[-1]["mask_iou"] >= 0.999, parity[-1]
                last = features, coords, labels, ours.detach().clone(), pixels, mask
        passed("official_interactive_parity", cases=parity, absolute_tolerance=1e-3, minimum_mask_iou=0.999,
               postprocessing="Official hole/sprinkle policy applied equally to both outputs; skipping it is an error.")

        features, coords, labels, base_logits, pixels, mask = last

        def text_signature():
            predictions = adapter.predict(point_coords=None, point_labels=None, box=None,
                box_label=1, text="dark shapes", threshold=0.1, multimask_output=False)
            return [(hashlib.sha256(p.mask.tobytes()).hexdigest(), float(p.score)) for p in predictions]

        original_text = text_signature()
        targets = adaptive.resolve_lora_targets(model, "decoder")
        assert len(targets) == 28 and all(t.startswith("inst_interactive_predictor.model.sam_mask_decoder.") for t in targets)
        try:
            adaptive.resolve_lora_targets(model, "encoder_decoder")
        except ValueError:
            passed("encoder_lora_refused")
        else:
            raise AssertionError("encoder_decoder unexpectedly accepted")

        def base_digest():
            digest = hashlib.sha256()
            for name, parameter in model.named_parameters():
                if name.endswith((".lora_A", ".lora_B")):
                    continue
                digest.update(name.replace(".base.", ".").encode())
                digest.update(parameter.detach().numpy().tobytes())
            return digest.hexdigest()

        # Hash after injection so the names have the same wrappers for both snapshots.
        torch.manual_seed(1234)
        adaptive.inject_lora(model, targets, 8, 16, 0.0)
        trainable, total = adaptive.freeze_base_parameters(model)
        with torch.no_grad():
            identity, _ = segmenter.decode(features, coords, labels)
        assert torch.equal(identity, base_logits)
        passed("fresh_lora_identity", targets=len(targets), trainable_parameters=trainable, total_parameters=total)
        original_digest = base_digest()
        parameters = {name: p for name, p in model.named_parameters() if p.requires_grad}
        assert all(name.endswith((".lora_A", ".lora_B")) for name in parameters)
        initial_lora = {name: p.detach().clone() for name, p in parameters.items()}
        target = F.interpolate(torch.from_numpy(mask.astype(np.float32))[None, None], size=base_logits.shape[-2:], mode="nearest")
        optimizer = torch.optim.AdamW(parameters.values(), lr=3e-4, weight_decay=0.01)
        losses = []
        for _ in range(3):
            optimizer.zero_grad(set_to_none=True)
            logits, _ = segmenter.decode(features, coords, labels)
            loss = F.binary_cross_entropy_with_logits(logits, target)
            assert bool(torch.isfinite(loss))
            loss.backward()
            assert all(p.grad is not None and bool(torch.isfinite(p.grad).all()) for p in parameters.values())
            optimizer.step()
            losses.append(float(loss.detach()))
        assert original_digest == base_digest(), "base weights changed"
        changed = [name for name, p in parameters.items() if not torch.equal(p, initial_lora[name])]
        assert changed and any(name.endswith(".lora_A") for name in changed) and any(name.endswith(".lora_B") for name in changed)
        model.eval()
        with torch.no_grad():
            adapted, _ = segmenter.decode(features, coords, labels)
        assert not torch.equal(adapted, base_logits)
        passed("lora_optimizer_isolation", steps=3, losses=losses, changed_tensors=len(changed), frozen_parameter_sha256=original_digest,
               limitation="One cached synthetic image; this is not a quality or generalization experiment.")
        assert text_signature() == original_text
        passed("text_unchanged_by_interactive_lora", concept="dark shapes", threshold=0.1, detections=len(original_text))

        live = adaptive.LiveModel(model, "sam3-concepts", "sam3", "cpu", checkpoint)
        with tempfile.TemporaryDirectory(prefix="poligome-sam3-parity-") as folder:
            service = adaptive.AdaptiveService(root=Path(folder), get_live_model=lambda: live,
                predictor_lock=threading.Lock(), invalidate_embedding=lambda: None,
                model_factory=lambda: None, compute_embeddings=False)
            metadata = {"base_model": {"model_id": live.model_id, "family": live.family, "fingerprint": service.fingerprint(live)},
                        "lora": {"strategy": "decoder", "targets": targets, "rank": 8, "alpha": 16}}
            weights = adaptive.lora_state_dict(model)
            bundle = adaptive.portable_adapter(metadata, weights, "SAM3 teste local")
            adaptive.remove_lora(model)
            record = service.import_adapter("project-parity", bundle)
            service.activate("project-parity", record["run_id"], override=True)
            with torch.no_grad():
                imported, _ = segmenter.decode(features, coords, labels)
            assert torch.equal(imported, adapted)
            passed("portable_adapter_parity", bytes=len(bundle), exact_logits=True)
            exported = service.export_adapter("project-parity", record["run_id"])
            with tempfile.TemporaryDirectory(prefix="poligome-sam3-destination-") as destination:
                fresh = adaptive.AdaptiveService(root=Path(destination), get_live_model=lambda: live,
                    predictor_lock=threading.Lock(), invalidate_embedding=lambda: None,
                    model_factory=lambda: None, compute_embeddings=False)
                moved = fresh.import_adapter("project-destination", exported)
                assert "comparison" not in moved and moved["run_id"] != record["run_id"]
                fresh.activate("project-destination", moved["run_id"], override=True)
                with torch.no_grad():
                    moved_logits, _ = segmenter.decode(features, coords, labels)
                assert torch.equal(moved_logits, adapted)
                assert service.store("project-parity").read_run(record["run_id"]) is not None
                passed("new_storage_and_project_parity", exact_logits=True, inherited_metrics=False)
            active = service.status()["active"]
            malicious = io.BytesIO(bundle)
            with zipfile.ZipFile(malicious, "a") as archive:
                archive.writestr("../escape.npy", "bad")
            wrong_base = {**metadata, "base_model": {**metadata["base_model"], "fingerprint": "wrong"}}
            wrong_shape = dict(weights)
            wrong_shape[next(iter(wrong_shape))] = torch.zeros((1, 1))
            unsupported = io.BytesIO()
            with zipfile.ZipFile(io.BytesIO(bundle)) as source, zipfile.ZipFile(unsupported, "w") as destination:
                for name in source.namelist():
                    data = source.read(name)
                    if name == "manifest.json":
                        manifest = json.loads(data)
                        manifest["version"] = 99
                        data = json.dumps(manifest).encode()
                    destination.writestr(name, data)
            invalid = [b"not zip", bundle[:-10], malicious.getvalue(), unsupported.getvalue(),
                       adaptive.portable_adapter(wrong_base, weights, "wrong"),
                       adaptive.portable_adapter(metadata, wrong_shape, "wrong")]
            for bad in invalid:
                try:
                    service.import_adapter("project-invalid", bad)
                except adaptive.AdaptiveError:
                    pass
                else:
                    raise AssertionError("invalid bundle accepted")
                assert service.status()["active"] == active
                with torch.no_grad():
                    intact, _ = segmenter.decode(features, coords, labels)
                assert torch.equal(intact, adapted)
            passed("invalid_import_preserves_active_model", cases=len(invalid))
            adaptive.remove_lora(model)
            reopened = adaptive.AdaptiveService(root=Path(folder), get_live_model=lambda: live,
                predictor_lock=threading.Lock(), invalidate_embedding=lambda: None,
                model_factory=lambda: None, compute_embeddings=False)
            reopened.on_model_loaded()
            assert reopened.status()["active"]["applied"]
            with torch.no_grad():
                resumed, _ = segmenter.decode(features, coords, labels)
            assert torch.equal(resumed, adapted)
            passed("service_reopen_parity", exact_logits=True, limitation="Service recreation on the same base instance; no browser/project reopen.")
            reopened.deactivate()
            with torch.no_grad():
                restored, _ = segmenter.decode(features, coords, labels)
            assert torch.equal(restored, base_logits)
            passed("deactivation_restores_base", exact_logits=True)
        if args.portable_adapter:
            trained_bundle = Path(args.portable_adapter).read_bytes()
            if args.saved_adapter:
                saved_metadata, saved_state = adaptive.load_adapter(Path(args.saved_adapter))
            else:
                saved_metadata, saved_state, _ = adaptive.read_portable_adapter(trained_bundle)
            adaptive.apply_adapter(model, saved_metadata, saved_state)
            model.eval()
            with torch.no_grad():
                expected_trained, _ = segmenter.decode(features, coords, labels)
            adaptive.remove_lora(model)
            with tempfile.TemporaryDirectory(prefix="poligome-sam3-trained-import-") as destination:
                fresh = adaptive.AdaptiveService(root=Path(destination), get_live_model=lambda: live,
                    predictor_lock=threading.Lock(), invalidate_embedding=lambda: None,
                    model_factory=lambda: None, compute_embeddings=False)
                moved = fresh.import_adapter("project-trained-import", trained_bundle)
                fresh.activate("project-trained-import", moved["run_id"], override=True)
                with torch.no_grad():
                    actual_trained, _ = segmenter.decode(features, coords, labels)
                assert torch.equal(actual_trained, expected_trained)
                assert "comparison" not in moved
                passed("http_trained_adapter_new_base_and_storage", exact_logits=True,
                       portable_sha256=hashlib.sha256(trained_bundle).hexdigest(),
                       trained_run=saved_metadata.get("run_id"), inherited_metrics=False,
                       reference_source="native adapter.pt" if args.saved_adapter else "portable tensors applied directly")
                fresh.deactivate()
        report["passed"] = True
        save()
        return 0
    except Exception:
        report["passed"] = False
        report["error"] = traceback.format_exc()
        save()
        traceback.print_exc()
        return 1


if __name__ == "__main__":
    sys.exit(main())
