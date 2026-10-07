"""Exercise the real template HTTP handler without Docker or downloaded weights."""
import base64
import importlib.util
import io
import json
from pathlib import Path
import threading
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer

from PIL import Image, ImageDraw

spec = importlib.util.spec_from_file_location("byom_template", Path(__file__).resolve().parents[1] / "public/byom/serve.py")
template = importlib.util.module_from_spec(spec)
spec.loader.exec_module(template)


class TemplateHttpTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), template.Handler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.endpoint = f"http://127.0.0.1:{cls.server.server_port}"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()

    def invoke(self, payload):
        request = urllib.request.Request(self.endpoint + "/invocations", json.dumps(payload).encode(), {"Content-Type": "application/json"})
        try:
            response = urllib.request.urlopen(request, timeout=5)
        except urllib.error.HTTPError as error:
            response = error
        with response:
            return response.status, json.load(response)

    def test_invalid_json_shapes_are_client_errors(self):
        for payload in [[], None, 42, "image", {}]:
            with self.subTest(payload=payload):
                status, result = self.invoke(payload)
                self.assertEqual(status, 400)
                self.assertIn("detail", result)

    def test_malformed_images_are_client_errors_and_server_remains_ready(self):
        for image in ["data:image/png", "data:image/png;base64,", "data:text/plain;base64,eA==", "%%%%", "eA==", 1]:
            with self.subTest(image=image):
                self.assertEqual(self.invoke({"image": image})[0], 400)
                with urllib.request.urlopen(self.endpoint + "/ping", timeout=5) as response:
                    self.assertEqual(response.status, 200)

    def test_valid_inference_after_invalid_input_preserves_coco_contract(self):
        self.assertEqual(self.invoke([])[0], 400)
        image = Image.new("RGB", (128, 96), "white")
        ImageDraw.Draw(image).rectangle((20, 20, 80, 75), fill="black")
        data = io.BytesIO()
        image.save(data, format="PNG")
        status, result = self.invoke({"image": "data:image/png;base64," + base64.b64encode(data.getvalue()).decode(), "file_name": "fixture.png"})
        self.assertEqual(status, 200)
        self.assertEqual(result["images"][0]["width"], 128)
        self.assertEqual(result["images"][0]["height"], 96)
        self.assertEqual(result["images"][0]["file_name"], "fixture.png")
        self.assertGreater(len(result["annotations"]), 0)
        self.assertIn("segmentation", result["annotations"][0])


if __name__ == "__main__":
    unittest.main()
