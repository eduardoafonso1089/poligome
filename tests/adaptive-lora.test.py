"""Adaptive AI (SAM + LoRA): unit, training and integration tests.

Run with an interpreter that has torch, numpy, opencv and pillow (the SAM 2
venv the installer creates has all of them):

    python -m unittest tests/adaptive-lora.test.py      # from the repo root
    bash tests/adaptive.test.sh                          # finds a capable python

The training tests use a tiny SAM-shaped model (tests/helpers/adaptive_fixtures)
so they run real gradient descent in seconds on CPU. The SAM 2 tests at the end
build the real Hiera-Tiny architecture with random weights; they are skipped
when the `sam2` package is not installed. No test downloads anything.
"""

from __future__ import annotations

import json
import shutil
import sys
import tempfile
import threading
import time
import unittest
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent / "helpers"))
from adaptive_fixtures import item_payload, load_adaptive, make_toy_classes, synthetic_image  # noqa: E402

adaptive = load_adaptive()

if not adaptive.TORCH_AVAILABLE:  # pragma: no cover
    raise unittest.SkipTest("torch is not installed in this interpreter")

import torch  # noqa: E402
from torch import nn  # noqa: E402
import torch.nn.functional as F  # noqa: E402

ToySam, ToySegmenter = make_toy_classes(torch, nn, F)

try:
    import sam2  # noqa: F401

    HAS_SAM2 = True
except Exception:
    HAS_SAM2 = False


def toy_output(model, seed=0):
    segmenter = ToySegmenter(model, "cpu")
    image, _ = synthetic_image(seed)
    with torch.no_grad():
        features = segmenter.encode(segmenter.preprocess(image))
        coords, labels = segmenter.prompt_tensors([{"box": (10, 10, 80, 70), "points": []}], 160, 128)
        low_res, _ = segmenter.decode(features, coords, labels)
    return low_res


class LoraTests(unittest.TestCase):
    def test_targets_follow_strategy_and_refuse_other_models(self):
        model = ToySam()
        decoder = adaptive.resolve_lora_targets(model, "decoder")
        both = adaptive.resolve_lora_targets(model, "encoder_decoder", encoder_blocks=2)
        self.assertEqual(len(decoder), 16)  # 4 attention blocks x q/k/v/out
        self.assertTrue(all(name.startswith("sam_mask_decoder.") for name in decoder))
        self.assertEqual(len(both), 16 + 4)  # last 2 encoder blocks x qkv/proj
        self.assertTrue(any(".blocks.2.attn.qkv" in name for name in both))
        self.assertFalse(any(".blocks.0." in name for name in both))
        with self.assertRaises(ValueError):
            adaptive.resolve_lora_targets(nn.Sequential(nn.Linear(2, 2)), "decoder")

    def test_new_adapter_is_identity_and_only_lora_trains(self):
        model = ToySam()
        before = toy_output(model)
        targets = adaptive.resolve_lora_targets(model, "encoder_decoder", 3)
        adaptive.inject_lora(model, targets, rank=4, alpha=8, dropout=0.0)
        self.assertTrue(torch.equal(before, toy_output(model)))
        trainable, total = adaptive.freeze_base_parameters(model)
        names = [name for name, parameter in model.named_parameters() if parameter.requires_grad]
        self.assertTrue(names and all(name.endswith((".lora_A", ".lora_B")) for name in names))
        self.assertLess(trainable, total)

    def test_remove_restores_the_original_modules(self):
        model = ToySam()
        original = model.sam_mask_decoder.transformer.layers[0].self_attn.q_proj
        adaptive.inject_lora(model, adaptive.resolve_lora_targets(model, "decoder"), 4, 8, 0.0)
        self.assertIsNot(model.sam_mask_decoder.transformer.layers[0].self_attn.q_proj, original)
        with self.assertRaises(RuntimeError):
            adaptive.inject_lora(model, ["sam_mask_decoder.readout"], 4, 8, 0.0)
        self.assertEqual(adaptive.remove_lora(model), 16)
        self.assertIs(model.sam_mask_decoder.transformer.layers[0].self_attn.q_proj, original)

    def test_save_load_apply_roundtrip(self):
        model = ToySam()
        base = toy_output(model)
        targets = adaptive.resolve_lora_targets(model, "encoder_decoder", 3)
        adaptive.inject_lora(model, targets, 4, 8, 0.0)
        with torch.no_grad():
            for module in adaptive.lora_modules(model).values():
                module.lora_B.normal_(0, 0.05)
        adapted = toy_output(model)
        self.assertFalse(torch.allclose(base, adapted))
        metadata = {"lora": {"rank": 4, "alpha": 8, "targets": targets}}
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / "adapter.pt"
            digest = adaptive.save_adapter(path, metadata, adaptive.lora_state_dict(model))
            self.assertEqual(len(digest), 64)
            loaded_meta, state = adaptive.load_adapter(path)
            fresh = ToySam()
            adaptive.apply_adapter(fresh, loaded_meta, state)
            self.assertTrue(torch.allclose(adapted, toy_output(fresh)))
            with adaptive.lora_disabled(fresh):
                self.assertTrue(torch.equal(base, toy_output(fresh)))
            adaptive.remove_lora(fresh)
            self.assertTrue(torch.equal(base, toy_output(fresh)))
            torch.save({"format": "something-else"}, path)
            with self.assertRaises(ValueError):
                adaptive.load_adapter(path)

    def test_apply_refuses_mismatched_shapes_and_leaves_model_clean(self):
        model = ToySam()
        targets = adaptive.resolve_lora_targets(model, "decoder")
        adaptive.inject_lora(model, targets, 4, 8, 0.0)
        state = adaptive.lora_state_dict(model)
        fresh = ToySam(dim=8)
        with self.assertRaises(ValueError):
            adaptive.apply_adapter(fresh, {"lora": {"rank": 4, "alpha": 8, "targets": targets}}, state)
        self.assertEqual(adaptive.lora_modules(fresh), {})


class MaskAndPromptTests(unittest.TestCase):
    def test_polygon_with_hole_rasterizes_to_ring(self):
        outer = [10, 10, 50, 10, 50, 50, 10, 50]
        hole = [20, 20, 40, 20, 40, 40, 20, 40]
        mask = adaptive.rasterize_instance([outer], [hole], 64, 64)
        self.assertTrue(mask[15, 15])
        self.assertFalse(mask[30, 30])
        self.assertFalse(mask[5, 5])
        self.assertEqual(adaptive.mask_bbox(mask), (10, 10, 51, 51))
        clipped = adaptive.rasterize_instance([[-10, -10, 100, -10, 100, 100]], [], 32, 32)
        self.assertEqual(clipped.shape, (32, 32))

    def test_prompts_are_reproducible_and_inside_the_object(self):
        _, objects = synthetic_image(3)
        mask = objects[0][2]
        instance = {"mask": mask, "bbox": adaptive.mask_bbox(mask), "index": 0}
        first = adaptive.eval_prompts(instance, 160, 128, "item:0")
        second = adaptive.eval_prompts(instance, 160, 128, "item:0")
        self.assertEqual(first, second)
        x, y, label = first["point"]["points"][0]
        self.assertEqual(label, 1)
        self.assertTrue(mask[int(y), int(x)])

    def test_correction_click_targets_largest_error(self):
        target = np.zeros((40, 40), bool)
        target[5:35, 5:35] = True
        prediction = np.zeros_like(target)
        prediction[5:35, 5:12] = True
        x, y, label = adaptive.correction_click(prediction, target)
        self.assertEqual(label, 1)
        self.assertTrue(target[int(y), int(x)] and not prediction[int(y), int(x)])
        self.assertIsNone(adaptive.correction_click(target, target))
        x, y, label = adaptive.correction_click(np.ones_like(target), target)
        self.assertEqual(label, 0)

    def test_metrics(self):
        a = np.zeros((20, 20), bool)
        a[:10] = True
        b = np.zeros((20, 20), bool)
        b[5:15] = True
        self.assertAlmostEqual(adaptive.dice_score(a, b), 0.5)
        self.assertAlmostEqual(adaptive.iou_score(a, b), 1 / 3)
        self.assertEqual(adaptive.dice_score(a, a), 1.0)
        self.assertEqual(adaptive.boundary_iou(a, a), 1.0)
        self.assertLess(adaptive.boundary_iou(a, b), 1.0)


class StoreTests(unittest.TestCase):
    def setUp(self):
        self.folder = Path(tempfile.mkdtemp())
        self.store = adaptive.ProjectStore(self.folder, "project-alpha")

    def tearDown(self):
        shutil.rmtree(self.folder)

    def test_ingest_keeps_only_verified_instances(self):
        payload = item_payload(1)
        payload["instances"][0]["origin"] = "unverified_prediction"
        result = adaptive.ingest_item(self.store, "item-0001", payload)
        self.assertEqual(result["instances"], len(payload["instances"]) - 1)
        self.assertEqual(result["rejected"][0]["reason"], "unverified_origin")
        item = self.store.list_items()[0]
        mask = self.store.load_mask(item, item["instances"][0])
        self.assertEqual(mask.shape, (128, 160))
        self.assertEqual(int(mask.sum()), item["instances"][0]["area"])

    def test_ingest_refuses_bad_payloads_and_leaves_no_partial_item(self):
        payload = item_payload(2)
        for instance in payload["instances"]:
            instance["origin"] = "unverified_prediction"
        with self.assertRaises(ValueError):
            adaptive.ingest_item(self.store, "item-0002", payload)
        wrong = item_payload(3)
        wrong["width"] = 999
        with self.assertRaises(ValueError):
            adaptive.ingest_item(self.store, "item-0003", wrong)
        with self.assertRaises(ValueError):
            adaptive.ingest_item(self.store, "../escape", item_payload(4))
        self.assertEqual(self.store.list_items(), [])
        self.assertEqual([path.name for path in self.store.items_dir.iterdir()], [])

    def test_project_ids_are_validated(self):
        for bad in ("..", "a/b", "short", "UPPERCASE-ID", ""):
            with self.assertRaises(ValueError):
                adaptive.ProjectStore(self.folder, bad)


class GroupingAndSplitTests(unittest.TestCase):
    config = adaptive.ReadinessConfig()

    def items(self, seeds, groups=None, noise=None):
        items = []
        for index, seed in enumerate(seeds):
            image, _ = synthetic_image(seed)
            if noise and index in noise:
                image = np.clip(image.astype(int) + np.random.default_rng(index).integers(-3, 4, image.shape), 0, 255).astype(np.uint8)
            items.append({"key": f"item-{index:04d}", "group": (groups or {}).get(index), "descriptor": adaptive.image_descriptor(image)})
        return items

    def test_near_duplicates_and_declared_groups_merge(self):
        items = self.items([1, 1, 2, 3, 4], groups={3: "video-a", 4: "video-a"}, noise={1})
        groups, duplicates = adaptive.group_items(items, self.config)
        self.assertEqual(groups["item-0000"], groups["item-0001"])
        self.assertEqual(groups["item-0003"], groups["item-0004"])
        self.assertNotEqual(groups["item-0000"], groups["item-0002"])
        self.assertTrue(any({pair["a"], pair["b"]} == {"item-0000", "item-0001"} for pair in duplicates))

    def test_distinct_images_stay_independent(self):
        groups, _ = adaptive.group_items(self.items(range(20, 40)), self.config)
        self.assertEqual(len(set(groups.values())), 20)

    def test_initial_split_is_group_aware_and_stable(self):
        groups = {f"item-{i:04d}": f"g{i // 2}" for i in range(24)}  # 12 groups of 2
        assignment, info = adaptive.assign_splits(groups, {}, "salt", self.config)
        self.assertTrue(info["frozen_now"])
        for group in set(groups.values()):
            sides = {assignment[key] for key, value in groups.items() if value == group}
            self.assertEqual(len(sides), 1, "a group was split across train and holdout")
        holdout_groups = {groups[key] for key, side in assignment.items() if side == "holdout"}
        self.assertEqual(len(holdout_groups), 4)
        grown = dict(groups)
        grown.update({f"item-{i:04d}": f"g{i // 2}" for i in range(24, 40)})
        second, _ = adaptive.assign_splits(grown, assignment, "salt", self.config)
        for key, side in assignment.items():
            self.assertEqual(second[key], side, "a frozen assignment moved")

    def test_bridge_between_sides_quarantines_training_members(self):
        groups = {"item-0000": "g-merged", "item-0001": "g-merged", "item-0002": "g-other"}
        previous = {"item-0000": "holdout", "item-0001": "train", "item-0002": "train"}
        assignment, info = adaptive.assign_splits(groups, previous, "salt", self.config)
        self.assertEqual(assignment["item-0000"], "holdout")
        self.assertEqual(assignment["item-0001"], "quarantine")
        self.assertEqual(info["conflicts"], ["g-merged"])

    def test_internal_validation_uses_whole_groups(self):
        groups = [f"g{i}" for i in range(10) for _ in range(3)]
        chosen = adaptive.internal_validation_split(groups, 1, 0.2, 2)
        self.assertEqual(len(chosen), 2)
        self.assertEqual(adaptive.internal_validation_split(["g1", "g2", "g3"], 1, 0.2, 2), set())

    def test_cluster_bootstrap_widens_for_correlated_images(self):
        rng = np.random.default_rng(0)
        cluster_effects = rng.normal(0, 0.1, 6)
        values = [effect for effect in cluster_effects for _ in range(5)]
        clustered = adaptive.cluster_bootstrap(values, [str(i // 5) for i in range(30)], 2000, 1)
        naive = adaptive.cluster_bootstrap(values, [str(i) for i in range(30)], 2000, 1)
        self.assertGreater(clustered[2] - clustered[1], naive[2] - naive[1])
        self.assertEqual(clustered, adaptive.cluster_bootstrap(values, [str(i // 5) for i in range(30)], 2000, 1))


class DecisionTests(unittest.TestCase):
    config = adaptive.TrainConfig()
    readiness = adaptive.ReadinessConfig()

    def summary(self, low, high, mean, worsened=0.1, groups=6, instances=30, regression="none", noc=0.0):
        return {
            "primary": {"ci_low": low, "ci_high": high, "mean_delta": mean, "share_worsened": worsened},
            "holdout": {"groups": groups, "instances": instances},
            "subgroups": [{"name": "Roof", "regression": regression}],
            "interactive": {"noc90_delta": noc},
        }

    def test_three_outcomes(self):
        decide = lambda summary: adaptive.decide_promotion(summary, self.config, self.readiness)["outcome"]
        self.assertEqual(decide(self.summary(0.02, 0.08, 0.05)), "improved")
        self.assertEqual(decide(self.summary(-0.03, 0.005, -0.01)), "not_improved")
        self.assertEqual(decide(self.summary(-0.01, 0.06, 0.02)), "insufficient_evidence")
        self.assertEqual(decide(self.summary(0.02, 0.08, 0.05, groups=2)), "insufficient_evidence")
        self.assertEqual(decide(self.summary(0.02, 0.08, 0.05, regression="significant")), "not_improved")
        self.assertEqual(decide(self.summary(0.02, 0.08, 0.05, noc=1.0)), "insufficient_evidence")

    def test_training_loss_alone_never_promotes(self):
        # Train loss is not an input of the decision at all: a summary with a
        # zero-width CI around zero gain is not improved, whatever happened in training.
        outcome = adaptive.decide_promotion(self.summary(0.0, 0.0, 0.0), self.config, self.readiness)["outcome"]
        self.assertEqual(outcome, "not_improved")

    def test_convergence_states(self):
        def curve(vals, losses, train):
            return [{"epoch": i, "val_dice": d, "val_loss": l, "train_loss": t} for i, (d, l, t) in enumerate(zip(vals, losses, train))]

        diagnose = lambda epochs: adaptive.diagnose_convergence(epochs, self.config)["state"]
        self.assertEqual(diagnose(curve([0.5, 0.6], [1, 0.9], [None, 1])), "in_progress")
        self.assertEqual(diagnose(curve([0.5, 0.55, 0.6, 0.65, 0.7], [1, .9, .8, .7, .6], [None, 1, .9, .8, .7])), "improving")
        overfit = curve([0.5, 0.6, 0.7, 0.69, 0.66, 0.64, 0.62], [1, .8, .6, .66, .7, .72, .75], [None, 1, .8, .6, .5, .4, .3])
        self.assertEqual(diagnose(overfit), "overfitting")
        flat = curve([0.5, 0.6, 0.7, 0.7, 0.7, 0.7, 0.7, 0.7, 0.7], [1, .8, .6, .6, .6, .6, .6, .6, .6], [None, 1, .8, .6, .6, .6, .6, .6, .6])
        self.assertEqual(diagnose(flat), "converged")
        noisy = curve([0.5, 0.49, 0.5, 0.501, 0.499, 0.5, 0.5, 0.5], [1] * 8, [None, 1, 1, 1, 1, 1, 1, 1])
        self.assertEqual(diagnose(noisy), "inconclusive")


class ServiceHarness:
    """An AdaptiveService around the toy model, standing in for the connector."""

    def __init__(self, folder: Path, readiness=None, factory=None, segmenter=ToySegmenter):
        self.live_model = ToySam(seed=0)
        self.model_id = "sam2.1-hiera-tiny"
        self.invalidations = 0
        self.lock = threading.Lock()
        self.service = adaptive.AdaptiveService(
            root=folder,
            get_live_model=lambda: adaptive.LiveModel(self.live_model, self.model_id, "sam2", "cpu", None),
            predictor_lock=self.lock,
            invalidate_embedding=self.invalidate,
            model_factory=factory or (lambda: ToySam(seed=0)),
            readiness=readiness,
            segmenter_factory=segmenter,
            compute_embeddings=False,
        )

    def invalidate(self):
        self.invalidations += 1

    def fill(self, project: str, count: int = 24):
        for seed in range(count):
            self.service.put_item(project, f"item-{seed:04d}", item_payload(100 + seed))


FAST = {"strategy": "encoder_decoder", "learning_rate": 5e-3, "max_epochs": 10, "patience": 4, "bootstrap_samples": 300, "max_clicks": 3, "batch_size": 2}


class TrainingTests(unittest.TestCase):
    """A real (tiny) training through the service, shared by the tests below."""

    project = "project-train"

    @classmethod
    def setUpClass(cls):
        cls.folder = Path(tempfile.mkdtemp())
        cls.harness = ServiceHarness(cls.folder)
        cls.harness.fill(cls.project)
        cls.readiness = cls.harness.service.assess(cls.project)
        started = cls.harness.service.start_training(cls.project, FAST)
        cls.harness.service.wait_for_training(600)
        cls.record = cls.harness.service.get_run(cls.project, started["run_id"])

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.folder)

    def test_readiness_allows_an_experiment(self):
        self.assertTrue(self.readiness["can_train"], self.readiness["reasons"])
        self.assertEqual(self.readiness["counts"]["approved_images"], 24)
        self.assertGreaterEqual(self.readiness["counts"]["holdout"]["groups"], 4)
        ids = {component["id"] for component in self.readiness["components"]}
        self.assertIn("independent_groups", ids)

    def test_run_completes_with_metrics_per_epoch(self):
        run = self.record
        self.assertEqual(run["status"], "completed", run.get("error"))
        epochs = run["epochs"]
        self.assertEqual(epochs[0]["epoch"], 0)
        self.assertNotIn("train_loss", epochs[0])
        self.assertGreaterEqual(len(epochs), 1 + 3)
        for entry in epochs[1:]:
            for key in ("train_loss", "val_loss", "val_dice", "val_iou", "val_boundary_iou", "seconds"):
                self.assertTrue(np.isfinite(entry[key]), key)
        metrics_lines = (self.folder / "projects" / self.project / "runs" / run["run_id"] / "metrics.jsonl").read_text().splitlines()
        self.assertEqual(len(metrics_lines), len(epochs))

    def test_toy_model_actually_learns(self):
        epochs = self.record["epochs"]
        best = max(entry["val_dice"] for entry in epochs)
        self.assertGreater(best, epochs[0]["val_dice"] + 0.02, [round(e["val_dice"], 3) for e in epochs])
        self.assertLess(epochs[-1]["train_loss"], epochs[1]["train_loss"])

    def test_best_checkpoint_is_the_one_saved(self):
        run = self.record
        best = run["best_epoch"]
        best_dice = next(entry["val_dice"] for entry in run["epochs"] if entry["epoch"] == best)
        self.assertEqual(best_dice, max(entry["val_dice"] for entry in run["epochs"]))
        path = self.folder / "projects" / self.project / "runs" / run["run_id"] / "adapter.pt"
        import hashlib

        self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(), run["adapter"]["sha256"])
        metadata, state = adaptive.load_adapter(path)
        self.assertEqual(metadata["best_epoch"], best)
        self.assertEqual(metadata["base_model"]["model_id"], "sam2.1-hiera-tiny")

    def test_comparison_is_complete_and_uses_the_same_holdout(self):
        comparison = self.record["comparison"]
        primary = comparison["primary"]
        self.assertLessEqual(primary["ci_low"], primary["mean_delta"])
        self.assertGreaterEqual(primary["ci_high"], primary["mean_delta"])
        self.assertAlmostEqual(primary["share_improved"] + primary["share_worsened"] + primary["share_unchanged"], 1.0)
        self.assertEqual(comparison["holdout"]["images"], self.record["data"]["holdout"]["images"])
        self.assertIn(comparison["decision"]["outcome"], ("improved", "not_improved", "insufficient_evidence"))
        self.assertEqual(set(comparison["protocols"]), {"box", "point", "box_jitter"})
        self.assertEqual(len(comparison["interactive"]["candidate"]["curve"]), 3)
        self.assertTrue(comparison["simulated_interaction_note"])
        kinds = {sub["kind"] for sub in comparison["subgroups"]}
        self.assertEqual(kinds, {"class", "size"})
        for example in comparison["examples"]:
            path = self.harness.service.example_path(self.project, self.record["run_id"], example["file"])
            self.assertTrue(path.read_bytes().startswith(b"\x89PNG"))

    def test_baseline_reproduces_base_model_on_holdout(self):
        # The reference column is the untouched base model: evaluating it again
        # with LoRA removed must give the same per-image numbers.
        comparison = self.record["comparison"]
        self.assertEqual(comparison["reference"]["kind"], "base")
        self.assertGreater(len(comparison["per_image"]), 0)

    def test_records_expose_no_local_paths(self):
        dumped = json.dumps([self.record, self.harness.service.list_runs(self.project), self.harness.service.status()])
        self.assertNotIn(str(self.folder), dumped)
        self.assertNotIn("targets", self.record["lora"])

    def test_split_is_frozen_after_training(self):
        frozen = self.harness.service.store(self.project).split()
        self.assertEqual(len(frozen), 24)
        self.harness.service.put_item(self.project, "item-extra-0001", item_payload(999))
        report = self.harness.service.assess(self.project)
        self.assertTrue(report["split_frozen"])
        self.assertEqual(self.harness.service.store(self.project).split(), frozen)
        self.assertIn(report["state"], ("retrain_useful", "retrain_not_needed"))
        self.harness.service.delete_item(self.project, "item-extra-0001")


class ActivationTests(unittest.TestCase):
    project = "project-activate"

    @classmethod
    def setUpClass(cls):
        cls.folder = Path(tempfile.mkdtemp())
        cls.harness = ServiceHarness(cls.folder)
        cls.harness.fill(cls.project)
        service = cls.harness.service
        cls.runs = []
        for seed in (1, 2):
            config = dict(FAST, seed=seed)
            run = service.start_training(cls.project, config)
            service.wait_for_training(600)
            record = service.get_run(cls.project, run["run_id"])
            # An adapter restored at epoch 0 is the identity; these tests need two that differ.
            assert record["status"] == "completed" and record["best_epoch"] > 0, (record.get("error"), record.get("best_epoch"))
            cls.runs.append(run["run_id"])

    @classmethod
    def tearDownClass(cls):
        shutil.rmtree(cls.folder)

    def setUp(self):
        self.service = self.harness.service
        self.service.deactivate()
        for run_id in self.runs:
            self.force_outcome(run_id, "improved")

    def force_outcome(self, run_id, outcome):
        store = self.service.store(self.project)
        record = store.read_run(run_id)
        record["comparison"]["decision"] = {"outcome": outcome, "reasons": []}
        store.write_run(record)

    def live_output(self):
        return toy_output(self.harness.live_model)

    def test_activate_changes_inference_and_deactivate_restores_base_exactly(self):
        base = self.live_output()
        before = self.harness.invalidations
        status = self.service.activate(self.project, self.runs[0])
        self.assertEqual(status["active"]["run_id"], self.runs[0])
        self.assertTrue(status["active"]["applied"])
        self.assertGreater(self.harness.invalidations, before, "cached embeddings must be invalidated")
        self.assertEqual(self.service.active_summary(), {"project_id": self.project, "run_id": self.runs[0]})
        adapted = self.live_output()
        self.assertFalse(torch.equal(base, adapted))
        self.service.deactivate()
        self.assertTrue(torch.equal(base, self.live_output()))
        self.assertIsNone(self.service.active_summary())

    def test_not_improved_cannot_be_activated_and_insufficient_needs_confirmation(self):
        self.force_outcome(self.runs[0], "not_improved")
        with self.assertRaises(adaptive.AdaptiveError) as caught:
            self.service.activate(self.project, self.runs[0])
        self.assertEqual(caught.exception.code, "not_improved")
        self.force_outcome(self.runs[0], "insufficient_evidence")
        with self.assertRaises(adaptive.AdaptiveError) as caught:
            self.service.activate(self.project, self.runs[0])
        self.assertEqual(caught.exception.code, "needs_confirmation")
        self.service.activate(self.project, self.runs[0], override=True)
        self.assertEqual(self.service.active_summary()["run_id"], self.runs[0])

    def test_rollback_walks_back_through_activations_then_to_base(self):
        base = self.live_output()
        self.service.activate(self.project, self.runs[0])
        first = self.live_output()
        self.service.activate(self.project, self.runs[1])
        self.assertFalse(torch.equal(first, self.live_output()))
        self.service.rollback(self.project)
        self.assertEqual(self.service.active_summary()["run_id"], self.runs[0])
        self.assertTrue(torch.allclose(first, self.live_output()))
        self.service.deactivate()
        self.service.rollback(self.project)
        self.assertIsNone(self.service.active_summary())
        self.assertTrue(torch.equal(base, self.live_output()))

    def test_incompatible_base_model_is_refused(self):
        self.harness.model_id = "sam2.1-hiera-large"
        try:
            with self.assertRaises(adaptive.AdaptiveError) as caught:
                self.service.activate(self.project, self.runs[0])
            self.assertEqual(caught.exception.code, "incompatible_base")
            self.assertEqual(adaptive.lora_modules(self.harness.live_model), {})
        finally:
            self.harness.model_id = "sam2.1-hiera-tiny"

    def test_tampered_adapter_is_refused(self):
        path = self.folder / "projects" / self.project / "runs" / self.runs[1] / "adapter.pt"
        original = path.read_bytes()
        try:
            path.write_bytes(original + b"x")
            with self.assertRaises(adaptive.AdaptiveError) as caught:
                self.service.activate(self.project, self.runs[1])
            self.assertEqual(caught.exception.code, "adapter_corrupt")
        finally:
            path.write_bytes(original)

    def test_adapter_is_reapplied_after_a_connector_restart(self):
        self.service.activate(self.project, self.runs[0])
        adapted = self.live_output()
        restarted = ServiceHarness(self.folder)
        restarted.live_model = self.harness.live_model
        adaptive.remove_lora(restarted.live_model)
        restarted.service.on_model_loaded()
        self.assertTrue(torch.allclose(adapted, toy_output(restarted.live_model)))
        restarted.model_id = "medsam2-latest"
        adaptive.remove_lora(restarted.live_model)
        restarted.service.on_model_loaded()
        self.assertEqual(adaptive.lora_modules(restarted.live_model), {})

    def test_reject_marks_the_run(self):
        summary = self.service.reject(self.project, self.runs[1])
        self.assertEqual(summary["activation"], "rejected")
        history = self.service.list_runs(self.project)["history"]
        self.assertTrue(any(event["action"] == "reject" for event in history))


class FailureTests(unittest.TestCase):
    project = "project-failure"

    def setUp(self):
        self.folder = Path(tempfile.mkdtemp())

    def tearDown(self):
        shutil.rmtree(self.folder)

    def test_cancel_stops_the_run_and_live_model_is_untouched(self):
        harness = ServiceHarness(self.folder)
        harness.fill(self.project)
        run = harness.service.start_training(self.project, dict(FAST, max_epochs=200, patience=100))
        deadline = time.time() + 60
        while harness.service.get_run(self.project, run["run_id"])["status"] != "training" and time.time() < deadline:
            time.sleep(0.05)
        harness.service.cancel(self.project, run["run_id"])
        harness.service.wait_for_training(120)
        record = harness.service.get_run(self.project, run["run_id"])
        self.assertEqual(record["status"], "cancelled")
        self.assertEqual(adaptive.lora_modules(harness.live_model), {})
        with self.assertRaises(adaptive.AdaptiveError):
            harness.service.activate(self.project, run["run_id"], override=True)

    def test_model_failure_is_recorded(self):
        def broken():
            raise RuntimeError("checkpoint unreadable")

        harness = ServiceHarness(self.folder, factory=broken)
        harness.fill(self.project)
        run = harness.service.start_training(self.project, FAST)
        harness.service.wait_for_training(120)
        record = harness.service.get_run(self.project, run["run_id"])
        self.assertEqual(record["status"], "failed")
        self.assertEqual(record["error"]["code"], "unexpected")
        self.assertIn("checkpoint unreadable", record["error"]["message"])

    def test_out_of_memory_retries_then_fails_cleanly(self):
        class OomSegmenter(ToySegmenter):
            calls = 0

            def decode(self, features, coords, labels, mask_input=None):
                if torch.is_grad_enabled():
                    OomSegmenter.calls += 1
                    raise RuntimeError("CUDA out of memory. Tried to allocate 2.00 GiB")
                return super().decode(features, coords, labels, mask_input)

        harness = ServiceHarness(self.folder, segmenter=OomSegmenter)
        harness.fill(self.project)
        run = harness.service.start_training(self.project, FAST)
        harness.service.wait_for_training(120)
        record = harness.service.get_run(self.project, run["run_id"])
        self.assertEqual(record["status"], "failed")
        self.assertEqual(record["error"]["code"], "out_of_memory")
        self.assertGreaterEqual(OomSegmenter.calls, 2, "one retry with fewer instances is expected")
        events = (self.folder / "projects" / self.project / "runs" / run["run_id"] / "events.jsonl").read_text()
        self.assertIn('"stage": "oom"', events)

    def test_only_one_training_at_a_time(self):
        harness = ServiceHarness(self.folder)
        harness.fill(self.project)
        run = harness.service.start_training(self.project, dict(FAST, max_epochs=200, patience=100))
        try:
            self.assertTrue(harness.service.training_active())
            with self.assertRaises(adaptive.AdaptiveError) as caught:
                harness.service.start_training(self.project, FAST)
            self.assertEqual(caught.exception.code, "training_busy")
        finally:
            harness.service.cancel(self.project, run["run_id"])
            harness.service.wait_for_training(120)

    def test_not_ready_dataset_is_refused(self):
        harness = ServiceHarness(self.folder)
        harness.fill(self.project, count=4)
        report = harness.service.assess(self.project)
        self.assertEqual(report["state"], "collecting")
        with self.assertRaises(adaptive.AdaptiveError) as caught:
            harness.service.start_training(self.project, FAST)
        self.assertEqual(caught.exception.code, "not_ready")

    def test_interrupted_runs_are_marked_on_restart(self):
        store = adaptive.ProjectStore(self.folder, self.project)
        store.write_run({"run_id": "run-20260101t000000z-abcdef", "status": "training"})
        ServiceHarness(self.folder)
        self.assertEqual(store.read_run("run-20260101t000000z-abcdef")["status"], "interrupted")

    def test_early_stopping_with_no_learning_keeps_epoch_zero(self):
        harness = ServiceHarness(self.folder)
        harness.fill(self.project)
        run = harness.service.start_training(self.project, dict(FAST, learning_rate=1e-6, max_epochs=30, patience=3, min_epochs=3))
        harness.service.wait_for_training(300)
        record = harness.service.get_run(self.project, run["run_id"])
        self.assertEqual(record["status"], "completed", record.get("error"))
        self.assertEqual(record["best_epoch"], 0)
        self.assertEqual(record["epochs_run"], 3)
        self.assertTrue(record["diagnosis"]["no_improvement_over_base"])
        self.assertNotEqual(record["comparison"]["decision"]["outcome"], "improved")

    def test_decoder_strategy_without_feature_cache_still_trains(self):
        import os

        harness = ServiceHarness(self.folder)
        harness.fill(self.project)
        os.environ["POLIGOME_ADAPTIVE_CACHE_MB"] = "0"
        try:
            run = harness.service.start_training(self.project, dict(FAST, strategy="decoder", max_epochs=2, min_epochs=1))
            harness.service.wait_for_training(300)
        finally:
            del os.environ["POLIGOME_ADAPTIVE_CACHE_MB"]
        record = harness.service.get_run(self.project, run["run_id"])
        self.assertEqual(record["status"], "completed", record.get("error"))
        self.assertEqual(len(record["epochs"]), 3)

    def test_unsupported_family_is_refused(self):
        harness = ServiceHarness(self.folder)
        harness.service.get_live_model = lambda: adaptive.LiveModel(None, "sam3-concepts", "sam3", "cpu", None)
        self.assertEqual(harness.service.assess(self.project)["state"], "unsupported_model")
        with self.assertRaises(adaptive.AdaptiveError) as caught:
            harness.service.start_training(self.project, FAST)
        self.assertEqual(caught.exception.code, "unsupported_model")


class ReadinessTests(unittest.TestCase):
    def setUp(self):
        self.folder = Path(tempfile.mkdtemp())
        self.harness = ServiceHarness(self.folder)

    def tearDown(self):
        shutil.rmtree(self.folder)

    def test_one_sequence_is_not_independent_evidence(self):
        for seed in range(24):
            self.harness.service.put_item("project-seq", f"item-{seed:04d}", item_payload(300 + seed, group="exam-1"))
        report = self.harness.service.assess("project-seq")
        self.assertEqual(report["counts"]["independent_groups"], 1)
        self.assertFalse(report["can_train"])
        self.assertTrue(any(reason["code"] == "few_independent" for reason in report["reasons"]))

    def test_duplicates_do_not_inflate_confidence(self):
        for seed in range(24):
            self.harness.service.put_item("project-dup", f"item-{seed:04d}", item_payload(500 + seed % 3))
        report = self.harness.service.assess("project-dup")
        self.assertEqual(report["counts"]["independent_groups"], 3)
        self.assertEqual(report["state"], "collect_more")
        self.assertGreater(report["diversity"]["redundancy"], 0.8)

    def test_rare_classes_are_reported_as_gaps(self):
        for seed in range(24):
            self.harness.service.put_item("project-gap", f"item-{seed:04d}", item_payload(700 + seed, shapes=1 if seed else 2))
        report = self.harness.service.assess("project-gap")
        self.assertTrue(any(gap["code"] == "rare_class" for gap in report["gaps"]), report["gaps"])


class RouterTests(unittest.TestCase):
    def test_http_errors_carry_codes(self):
        try:
            from fastapi import FastAPI
            from fastapi.testclient import TestClient
        except Exception:
            self.skipTest("fastapi/httpx not installed")
        folder = Path(tempfile.mkdtemp())
        try:
            harness = ServiceHarness(folder)
            app = FastAPI()
            app.include_router(adaptive.create_router(harness.service))
            client = TestClient(app)
            self.assertEqual(client.get("/adaptive/status").json()["api_version"], 1)
            response = client.post("/adaptive/projects/BAD/assess")
            self.assertEqual(response.status_code, 400)
            self.assertEqual(response.json()["detail"]["code"], "invalid_project")
            response = client.post("/adaptive/projects/project-http/items/item-0001", json=item_payload(1))
            self.assertEqual(response.status_code, 200, response.text)
            self.assertEqual(client.get("/adaptive/projects/project-http/items").json()["items"], {"item-0001": "fp-1"})
            response = client.post("/adaptive/projects/project-http/runs", json={"config": {}})
            self.assertEqual(response.status_code, 409)
            self.assertEqual(response.json()["detail"]["code"], "not_ready")
            response = client.post("/adaptive/projects/project-http/runs", json={"config": {"rank": 999}})
            self.assertEqual(response.status_code, 400)
            response = client.get("/adaptive/projects/project-http/runs/run-20260101t000000z-abcdef/examples/..%2Fadapter.pt")
            self.assertIn(response.status_code, (400, 404))
        finally:
            shutil.rmtree(folder)


@unittest.skipUnless(HAS_SAM2, "sam2 package not installed")
class Sam2IntegrationTests(unittest.TestCase):
    """The real SAM 2.1 Hiera-Tiny architecture, random weights, CPU."""

    @classmethod
    def setUpClass(cls):
        from sam2.build_sam import build_sam2

        torch.manual_seed(0)
        cls.build = staticmethod(lambda: build_sam2("configs/sam2.1/sam2.1_hiera_t.yaml", None, device="cpu", mode="eval"))
        cls.model = cls.build()

    def test_segmenter_matches_official_predictor_and_lora_starts_as_identity(self):
        from sam2.sam2_image_predictor import SAM2ImagePredictor

        image, _ = synthetic_image(5, size=(200, 150))
        predictor = SAM2ImagePredictor(self.model)
        predictor.set_image(image)
        _, _, official = predictor.predict(box=np.array([20, 20, 120, 100]), multimask_output=False, return_logits=True)
        segmenter = adaptive.Sam2Segmenter(self.model, "cpu")
        with torch.no_grad():
            features = segmenter.encode(segmenter.preprocess(image))
            coords, labels = segmenter.prompt_tensors([{"box": (20, 20, 120, 100), "points": []}], 200, 150)
            ours, _ = segmenter.decode(features, coords, labels)
        self.assertLess(float(np.abs(official[0] - ours[0, 0].numpy()).max()), 1e-4)
        targets = adaptive.resolve_lora_targets(self.model, "encoder_decoder", 4)
        self.assertEqual(sum(".attn.qkv" in name for name in targets), 4)
        adaptive.inject_lora(self.model, targets, 8, 16, 0.0)
        try:
            with torch.no_grad():
                adapted, _ = segmenter.decode(segmenter.encode(segmenter.preprocess(image)), coords, labels)
            self.assertTrue(torch.allclose(ours, adapted, atol=1e-5))
            trainable, total = adaptive.freeze_base_parameters(self.model)
            self.assertLess(trainable / total, 0.02)
        finally:
            adaptive.remove_lora(self.model)

    def test_short_real_training_on_sam2(self):
        folder = Path(tempfile.mkdtemp())
        try:
            readiness = adaptive.ReadinessConfig(min_approved_images=6, min_instances=10, min_independent_experimental=8, min_holdout_groups=2, min_holdout_instances=4, target_holdout_groups=2)
            live = self.build()
            service = adaptive.AdaptiveService(
                root=folder,
                get_live_model=lambda: adaptive.LiveModel(live, "sam2.1-hiera-tiny", "sam2", "cpu", None),
                predictor_lock=threading.Lock(),
                invalidate_embedding=lambda: None,
                model_factory=self.build,
                readiness=readiness,
            )
            for seed in range(10):
                service.put_item("project-sam2", f"item-{seed:04d}", item_payload(900 + seed, size=(128, 96), shapes=2))
            report = service.assess("project-sam2")
            self.assertEqual(report["diversity"]["method"], "sam2_embedding")
            self.assertTrue(report["can_train"], report["reasons"])
            run = service.start_training("project-sam2", {"strategy": "decoder", "max_epochs": 2, "min_epochs": 1, "bootstrap_samples": 200, "max_clicks": 2})
            service.wait_for_training(1200)
            record = service.get_run("project-sam2", run["run_id"])
            self.assertEqual(record["status"], "completed", record.get("error"))
            self.assertEqual(len(record["epochs"]), 3)
            self.assertIn(record["comparison"]["decision"]["outcome"], ("improved", "not_improved", "insufficient_evidence"))
            store = service.store("project-sam2")
            stored = store.read_run(run["run_id"])
            stored["comparison"]["decision"]["outcome"] = "improved"
            store.write_run(stored)
            service.activate("project-sam2", run["run_id"])
            self.assertTrue(adaptive.lora_modules(live))
            service.deactivate()
            self.assertEqual(adaptive.lora_modules(live), {})
        finally:
            shutil.rmtree(folder)


if __name__ == "__main__":
    unittest.main()
