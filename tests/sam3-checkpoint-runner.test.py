"""Native process cleanup regression; no SAM/torch/model load required."""
from __future__ import annotations

import importlib.util
import json
import os
import socket
import subprocess
import sys
import tempfile
import time
import unittest
import threading
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location("checkpoint_runner", ROOT / "scripts/adaptive-sam3-checkpoint.py")
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)


@unittest.skipUnless(os.name == "nt", "Windows venv redirector regression")
class ConnectorCleanupTests(unittest.TestCase):
    def test_stops_real_windows_venv_child_and_releases_files_and_port(self):
        # Pass the SAM venv interpreter to reproduce its python.exe redirector.
        python = os.environ.get("POLIGOME_ADAPTIVE_PYTHON", sys.executable)
        with tempfile.TemporaryDirectory(prefix="sam3-cleanup-regression-") as folder:
            directory = Path(folder)
            fixture = directory / "server.py"
            port_file = directory / "port.json"
            fixture.write_text(
                "import json, pathlib, socket, sys, time\n"
                "directory=pathlib.Path(sys.argv[1])\n"
                "locked=(directory/'locked.txt').open('w')\n"
                "server=socket.socket(); server.bind(('127.0.0.1',0)); server.listen()\n"
                "(directory/'port.json').write_text(json.dumps(server.getsockname()[1]))\n"
                "while True: time.sleep(1)\n", encoding="utf-8")
            process = subprocess.Popen([python, str(fixture), folder])
            try:
                deadline = time.monotonic() + 20
                while not port_file.is_file():
                    self.assertIsNone(process.poll())
                    self.assertLess(time.monotonic(), deadline)
                    time.sleep(0.1)
                port = json.loads(port_file.read_text())
                with socket.create_connection(("127.0.0.1", port), timeout=2):
                    pass
                runner.stop_connector(process)
                self.assertIsNotNone(process.poll())
                with self.assertRaises(OSError):
                    socket.create_connection(("127.0.0.1", port), timeout=2)
                (directory / "locked.txt").unlink()
            finally:
                # Tree cleanup also protects the regression when an assertion fails.
                subprocess.run(["taskkill", "/PID", str(process.pid), "/T", "/F"],
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)


class ConsoleEncodingTests(unittest.TestCase):
    def test_real_smoke_cli_writes_utf8_with_cp1252_parent(self):
        """Controlled HTTP responses test CLI encoding, not model quality."""
        fixture = json.loads((ROOT / "tests/fixtures/adaptive-backend.json").read_text(encoding="utf-8"))
        record = fixture["run"]
        record["comparison"]["examples"] = []
        # Encoding is independent of the activation contract, covered elsewhere.
        record["comparison"]["decision"]["outcome"] = None

        class Handler(BaseHTTPRequestHandler):
            def handle_request(self):
                if self.command == "POST":
                    self.rfile.read(int(self.headers.get("Content-Length", "0")))
                if self.path == "/health":
                    body = {"status": "ready", "model_id": "console-fixture", "device": "cpu"}
                elif self.path == "/adaptive/status":
                    body = {"model": {"supported": True, "family": "sam3"}}
                elif self.path.endswith("/assess"):
                    body = fixture["readiness"]
                elif "/runs" in self.path:
                    body = record
                else:
                    body = {}
                encoded = json.dumps(body).encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(encoded)))
                self.end_headers()
                self.wfile.write(encoded)

            do_GET = handle_request
            do_POST = handle_request

            def log_message(self, *args):
                pass

        server = HTTPServer(("127.0.0.1", 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            with tempfile.TemporaryDirectory() as folder:
                report = Path(folder) / "report.json"
                result = subprocess.run([
                    os.environ.get("POLIGOME_ADAPTIVE_PYTHON", sys.executable),
                    str(ROOT / "scripts/adaptive-smoke.py"), "--images", "0",
                    "--base", f"http://127.0.0.1:{server.server_port}",
                    "--expect-family", "sam3", "--report", str(report),
                ], env={**os.environ, "PYTHONIOENCODING": "cp1252"},
                    capture_output=True, timeout=60)
                self.assertEqual(result.returncode, 0, result.stderr.decode("utf-8", errors="replace"))
                self.assertIn("→", result.stdout.decode("utf-8"))
                self.assertEqual(json.loads(report.read_text(encoding="utf-8"))["model"]["family"], "sam3")
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=5)


if __name__ == "__main__":
    unittest.main()
