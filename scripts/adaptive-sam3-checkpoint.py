#!/usr/bin/env python3
r"""Exercise an actual SAM 3 checkpoint in an isolated local connector.

Use the Python from the SAM 3 environment. Works in native Windows or WSL2:
  python scripts/adaptive-sam3-checkpoint.py --checkpoint C:\Users\lucas\Downloads\sam3.pt
No existing connector, active adapter or project is modified.
"""
from __future__ import annotations

import argparse
import json
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--checkpoint", required=True)
    parser.add_argument("--device", choices=["auto", "cpu", "cuda", "mps"], default="auto")
    parser.add_argument("--out", default="resultados-adaptive/sam3-checkpoint")
    parser.add_argument("--startup-timeout", type=int, default=1800)
    args = parser.parse_args()
    checkpoint = Path(args.checkpoint).expanduser().resolve()
    if not checkpoint.is_file():
        parser.error(f"checkpoint não encontrado: {checkpoint}")
    root = Path(__file__).resolve().parents[1]
    out = Path(args.out).resolve()
    out.mkdir(parents=True, exist_ok=True)
    with socket.socket() as listener:
        listener.bind(("127.0.0.1", 0))
        port = listener.getsockname()[1]
    base = f"http://127.0.0.1:{port}"
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
    with tempfile.TemporaryDirectory(prefix="poligome-sam3-check-") as app_dir, (out / "connector.log").open("w", encoding="utf-8") as log:
        connector = subprocess.Popen([sys.executable, str(root / "public/poligome-sam-local.py"), "--model", "sam3-concepts", "--checkpoint", str(checkpoint), "--device", args.device, "--port", str(port), "--app-dir", app_dir], stdout=log, stderr=subprocess.STDOUT)
        try:
            deadline = time.monotonic() + args.startup_timeout
            while time.monotonic() < deadline:
                if connector.poll() is not None:
                    raise RuntimeError(f"conector encerrou ({connector.returncode}); veja {out / 'connector.log'}")
                try:
                    with opener.open(base + "/health", timeout=5) as response:
                        health = json.load(response)
                except OSError:
                    time.sleep(2)
                    continue
                if health.get("status") == "error":
                    raise RuntimeError(f"SAM 3 não carregou: {health.get('error')}; veja connector.log")
                if health.get("status") == "ready":
                    if health.get("model_id") != "sam3-concepts":
                        raise RuntimeError("a porta não contém o SAM 3 esperado")
                    break
                time.sleep(2)
            else:
                raise TimeoutError("SAM 3 não ficou pronto no prazo; veja connector.log")
            return subprocess.call([sys.executable, str(root / "scripts/adaptive-smoke.py"), "--base", base, "--expect-family", "sam3", "--domain", "nuclei", "--images", "24", "--max-epochs", "6", "--strategy", "decoder", "--report", str(out / "sam3-smoke.json")], cwd=root)
        finally:
            connector.terminate()
            try:
                connector.wait(timeout=15)
            except subprocess.TimeoutExpired:
                connector.kill()
                connector.wait()


if __name__ == "__main__":
    sys.exit(main())
