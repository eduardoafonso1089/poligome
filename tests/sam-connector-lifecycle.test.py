"""Connector lifecycle without loading weights, Docker or external downloads.

Run with the Python from an installed connector venv.
"""
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location(
    "lifecycle_connector", Path(__file__).resolve().parents[1] / "public/poligome-sam-local.py"
)
connector = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = connector
spec.loader.exec_module(connector)


class LifecycleTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.app_dir = Path(self.directory.name)
        self.original_runtime = connector._runtime.copy()
        self.addCleanup(setattr, connector, "_runtime", self.original_runtime)
        self.addCleanup(setattr, connector, "_switch_target", None)
        self.app_patch = patch.object(connector, "_app_dir", self.app_dir)
        self.app_patch.start()
        self.addCleanup(self.app_patch.stop)
        connector._switch_target = None
        connector._update_runtime(model_id="sam2.1-hiera-small", status="ready", error=None)
        for model in connector.MODEL_SPECS.values():
            interpreter = connector._family_python(model.family)
            interpreter.parent.mkdir(parents=True, exist_ok=True)
            interpreter.touch()
            checkpoint = connector._model_checkpoint(model)
            checkpoint.parent.mkdir(parents=True, exist_ok=True)
            checkpoint.write_bytes(b"fixture")

    def test_every_model_switch_persists_exact_id_and_schedules_restart(self):
        for model_id in connector.MODEL_SPECS:
            with self.subTest(model=model_id), patch.object(connector.threading, "Timer") as timer:
                connector._switch_target = None
                connector._update_runtime(model_id=None, status="ready")
                response = connector.load(connector.LoadRequest(model_id=model_id))
                self.assertTrue(response["switching"])
                self.assertEqual((self.app_dir / "selected-model.txt").read_text().strip(), model_id)
                self.assertEqual(connector.models()["switching_to"], model_id)
                timer.return_value.start.assert_called_once()
                self.assertEqual(timer.call_args.kwargs["args"][0].model_id, model_id)

    def test_uninstalled_model_preserves_previous_selection_and_runtime(self):
        selected = self.app_dir / "selected-model.txt"
        selected.write_text("sam2.1-hiera-small\n")
        connector._model_checkpoint(connector.MODEL_SPECS["sam3-concepts"]).unlink()
        with patch.object(connector.threading, "Timer") as timer:
            with self.assertRaises(connector.HTTPException) as raised:
                connector.load(connector.LoadRequest(model_id="sam3-concepts"))
            self.assertEqual(raised.exception.status_code, 409)
            self.assertEqual(connector.health()["status"], "ready")
            self.assertEqual(selected.read_text(), "sam2.1-hiera-small\n")
            timer.assert_not_called()

    def test_unwritable_selection_refuses_switch_without_sticking_busy(self):
        with patch.object(connector, "_persist_selection", side_effect=OSError("disk full")), patch.object(connector.threading, "Timer") as timer:
            with self.assertRaises(connector.HTTPException) as raised:
                connector.load(connector.LoadRequest(model_id="sam3-concepts"))
            self.assertEqual(raised.exception.status_code, 500)
            self.assertEqual(connector.health()["status"], "ready")
            self.assertIsNone(connector._switch_target)
            timer.assert_not_called()

    def test_already_loaded_model_does_not_restart(self):
        with patch.object(connector.threading, "Timer") as timer:
            response = connector.load(connector.LoadRequest(model_id="sam2.1-hiera-small"))
            self.assertFalse(response["switching"])
            timer.assert_not_called()

    def test_second_switch_does_not_overwrite_pending_target(self):
        with patch.object(connector.threading, "Timer"):
            connector.load(connector.LoadRequest(model_id="sam3-concepts"))
            with self.assertRaises(connector.HTTPException) as raised:
                connector.load(connector.LoadRequest(model_id="sam2.1-hiera-tiny"))
            self.assertEqual(raised.exception.status_code, 409)
            self.assertEqual(connector._switch_target, "sam3-concepts")

    def test_unix_restart_uses_target_runtime_and_preserves_cpu_and_port(self):
        config = connector.LoadConfig(connector.MODEL_SPECS["sam2.1-hiera-small"], "fixture", None, "cpu")
        connector_file = Path(connector.__file__).resolve()
        with patch.object(connector.os, "name", "posix"), patch.object(connector, "Path", return_value=connector_file), patch.object(connector, "_startup_config", config), patch.object(connector.os, "execv") as replace:
            connector._exec_with_model(connector.MODEL_SPECS["sam3-concepts"], 9876)
        interpreter, arguments = replace.call_args.args
        self.assertIn("sam3", interpreter)
        self.assertEqual(arguments[arguments.index("--device") + 1], "cpu")
        self.assertEqual(arguments[arguments.index("--port") + 1], "9876")
        self.assertEqual(arguments[arguments.index("--app-dir") + 1], str(self.app_dir))

    def test_windows_restart_returns_the_agreed_code_to_its_launcher(self):
        with patch.object(connector.os, "name", "nt"), patch.object(connector.os, "_exit", side_effect=SystemExit) as leave:
            with self.assertRaises(SystemExit):
                connector._exec_with_model(connector.MODEL_SPECS["sam3-concepts"], 7860)
            leave.assert_called_once_with(75)

    def test_byom_catalog_checks_models_concurrently_and_keeps_all_entries(self):
        registry = self.app_dir / "byom"
        registry.mkdir()
        for index in range(20):
            (registry / f"byom-test-{index:02}.json").write_text(json.dumps({"model_id": f"byom-test-{index:02}", "endpoint": f"http://127.0.0.1:{8100 + index}"}))
        active = 0
        maximum = 0
        lock = threading.Lock()

        def ready(registration):
            nonlocal active, maximum
            with lock:
                active += 1
                maximum = max(maximum, active)
            time.sleep(0.03)
            with lock:
                active -= 1
            return registration.model_id != "byom-test-05", "fixture offline"

        with patch.object(connector, "_byom_container_ready", side_effect=ready), patch.object(connector, "_byom_metadata", return_value=None):
            entries = connector.byom_models()["models"]
        self.assertGreater(maximum, 1)
        self.assertEqual(len(entries), 20)
        self.assertEqual([entry["model_id"] for entry in entries], sorted(entry["model_id"] for entry in entries))
        self.assertEqual(sum(entry["ready"] for entry in entries), 19)

    def test_invalid_port_registration_cannot_hide_valid_model(self):
        registry = self.app_dir / "byom"
        registry.mkdir()
        for name, port in [("valid", 8080), ("zero", 0), ("overflow", 99999)]:
            (registry / f"byom-{name}.json").write_text(json.dumps({"endpoint": f"http://127.0.0.1:{port}"}))
        self.assertEqual(list(connector.byom_registrations()), ["byom-valid"])


if __name__ == "__main__":
    unittest.main()
