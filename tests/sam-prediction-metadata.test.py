"""API attribution tests with a controlled segmenter; no quality measurements."""
import base64
import importlib.util
import io
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

import numpy as np
from PIL import Image

spec = importlib.util.spec_from_file_location("sam_metadata_connector", Path(__file__).resolve().parents[1] / "public/poligome-sam-local.py")
connector = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = connector
spec.loader.exec_module(connector)


class AttributionTests(unittest.TestCase):
    def setUp(self):
        pixels = np.zeros((32, 32, 3), np.uint8)
        buffer = io.BytesIO(); Image.fromarray(pixels).save(buffer, format="PNG")
        self.image = "data:image/png;base64," + base64.b64encode(buffer.getvalue()).decode()
        mask = np.zeros((32, 32), bool); mask[8:24, 8:24] = True
        self.model = object()
        connector._runtime["status"] = "ready"
        connector._current_image_hash = None
        connector._adapter = SimpleNamespace(spec=connector.MODEL_SPECS["sam3-concepts"], device="cpu", model=self.model,
            set_image=lambda pixels: None, predict=lambda **kwargs: [connector.RawPrediction(mask, .9)])
        self.active = {"project_id": "project-a", "run_id": "run-a"}
        connector._adaptive_service = SimpleNamespace(active_summary=lambda: self.active,
            get_live_model=lambda: SimpleNamespace(model=self.model), fingerprint=self.fingerprint)

    def fingerprint(self, live):
        self.assertTrue(connector._predictor_lock.locked())
        return "f" * 64

    def tearDown(self):
        connector._adapter = None
        connector._adaptive_service = None

    def test_adapter_metadata_stays_with_the_inferred_mask_during_later_activation(self):
        original = connector._serialize_predictions
        def serialize(*args, **kwargs):
            self.assertFalse(connector._predictor_lock.locked())
            self.active["run_id"] = "run-b"
            return original(*args, **kwargs)
        with mock.patch.object(connector, "_serialize_predictions", side_effect=serialize):
            result = connector.predict(connector.PredictionRequest(image=self.image, points=[{"x": 15, "y": 15, "label": 1}]))
        self.assertEqual(result["adapter"]["run_id"], "run-a")
        self.assertEqual(result["device"], "cpu")
        self.assertEqual(result["model_fingerprint"], "f" * 64)

    def test_sam3_text_is_not_attributed_to_interactive_lora(self):
        result = connector.predict(connector.PredictionRequest(image=self.image, text="shape"))
        self.assertIsNone(result["adapter"])

    def test_model_switch_does_not_attribute_the_old_predictor_to_the_new_live_adapter(self):
        connector._adaptive_service.get_live_model = lambda: SimpleNamespace(model=object())
        result = connector.predict(connector.PredictionRequest(image=self.image, points=[{"x": 15, "y": 15, "label": 1}]))
        self.assertNotIn("adapter", result, "unidentified is different from the original SAM")
        self.assertIsNone(result["model_fingerprint"])


if __name__ == "__main__":
    unittest.main()
