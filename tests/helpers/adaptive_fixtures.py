"""Fixtures for the Adaptive AI tests: a synthetic dataset and a tiny SAM-shaped model.

Nothing here touches user data or the network. The images are generated from a
seed: light textured backgrounds with dark ellipses and polygons, so a model
can actually learn something in a few seconds of CPU.

`ToySam` mirrors the module *names* of SAM 2 that LoRA targets
(`image_encoder.trunk.blocks.N.attn.qkv`, `sam_mask_decoder.transformer...`),
so target resolution, injection, freezing and serialization run the same code
path as the real model. It is not a segmentation model anyone should use.
"""

from __future__ import annotations

import base64
import importlib.util
import io
import sys
from pathlib import Path

import cv2
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[2]


def load_adaptive():
    if "poligome_adaptive" in sys.modules:
        return sys.modules["poligome_adaptive"]
    spec = importlib.util.spec_from_file_location("poligome_adaptive", ROOT / "public/poligome-sam-adaptive.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules["poligome_adaptive"] = module
    spec.loader.exec_module(module)
    return module


def synthetic_image(seed: int, size: tuple[int, int] = (160, 128), shapes: int = 3):
    """Image plus a list of (class, polygon-flat, mask) for each object."""
    rng = np.random.default_rng(seed)
    width, height = size
    base = rng.integers(170, 230, size=3)
    noise = rng.normal(0, 12, size=(height, width, 1))
    image = np.clip(base[None, None, :] + noise, 0, 255).astype(np.uint8)
    objects = []
    for index in range(shapes):
        mask = np.zeros((height, width), np.uint8)
        cx = int(rng.integers(25, width - 25))
        cy = int(rng.integers(25, height - 25))
        if index % 2 == 0:
            axes = (int(rng.integers(8, 22)), int(rng.integers(8, 22)))
            cv2.ellipse(mask, (cx, cy), axes, float(rng.uniform(0, 180)), 0, 360, 1, -1)
            label = "ellipse"
        else:
            radius = int(rng.integers(10, 20))
            angles = np.sort(rng.uniform(0, 2 * np.pi, 5))
            points = np.stack([cx + radius * np.cos(angles), cy + radius * np.sin(angles)], axis=1).astype(np.int32)
            cv2.fillPoly(mask, [points], 1)
            label = "polygon"
        color = rng.integers(20, 80, size=3)
        image[mask.astype(bool)] = color
        contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        contour = max(contours, key=cv2.contourArea)[:, 0, :]
        if len(contour) < 3:
            continue
        objects.append((label, contour.astype(float).reshape(-1).tolist(), mask.astype(bool)))
    return image, objects


def data_url(image: np.ndarray, fmt: str = "PNG") -> str:
    buffer = io.BytesIO()
    Image.fromarray(image).save(buffer, format=fmt)
    return f"data:image/{fmt.lower()};base64," + base64.b64encode(buffer.getvalue()).decode()


def item_payload(seed: int, origin: str = "manual", group: str | None = None, size=(160, 128), shapes: int = 3):
    image, objects = synthetic_image(seed, size, shapes)
    return {
        "image": data_url(image),
        "width": size[0],
        "height": size[1],
        "name": f"synthetic-{seed}.png",
        "group": group,
        "fingerprint": f"fp-{seed}",
        "instances": [
            {"id": f"a{seed}-{index}", "label": label, "label_name": label.title(), "origin": origin, "polygons": [flat], "holes": []}
            for index, (label, flat, _) in enumerate(objects)
        ],
    }


def make_toy_classes(torch, nn, F):
    class Attention(nn.Module):
        def __init__(self, dim):
            super().__init__()
            self.q_proj = nn.Linear(dim, dim)
            self.k_proj = nn.Linear(dim, dim)
            self.v_proj = nn.Linear(dim, dim)
            self.out_proj = nn.Linear(dim, dim)

        def forward(self, x):
            gate = torch.sigmoid(self.q_proj(x) * self.k_proj(x))
            return self.out_proj(F.relu(self.v_proj(x)) * gate)

    class DecoderLayer(nn.Module):
        def __init__(self, dim):
            super().__init__()
            self.self_attn = Attention(dim)
            self.cross_attn_token_to_image = Attention(dim)
            self.cross_attn_image_to_token = Attention(dim)

    class Transformer(nn.Module):
        def __init__(self, dim):
            super().__init__()
            self.layers = nn.ModuleList([DecoderLayer(dim)])
            self.final_attn_token_to_image = Attention(dim)

    class MaskDecoder(nn.Module):
        def __init__(self, dim):
            super().__init__()
            self.transformer = Transformer(dim)
            self.readout = nn.Linear(dim, 1)

    class BlockAttention(nn.Module):
        def __init__(self, dim):
            super().__init__()
            self.qkv = nn.Linear(dim, dim * 3)
            self.proj = nn.Linear(dim, dim)

    class Block(nn.Module):
        def __init__(self, dim):
            super().__init__()
            self.attn = BlockAttention(dim)

    class Trunk(nn.Module):
        def __init__(self, dim):
            super().__init__()
            self.stem = nn.Conv2d(3, dim, 4, stride=4)
            self.blocks = nn.ModuleList([Block(dim) for _ in range(3)])

    class Encoder(nn.Module):
        def __init__(self, dim):
            super().__init__()
            self.trunk = Trunk(dim)

    class ToySam(nn.Module):
        image_size = 64

        def __init__(self, dim=16, seed=0):
            super().__init__()
            torch.manual_seed(seed)
            self.image_encoder = Encoder(dim)
            self.prompt_embed = nn.Linear(3, dim)
            self.sam_mask_decoder = MaskDecoder(dim)

    class ToySegmenter:
        """Same surface as Sam2Segmenter: preprocess, encode, decode, prompts, upsample."""

        def __init__(self, model, device):
            self.model = model
            self.device = torch.device(device)
            self.resolution = model.image_size

        def preprocess(self, pixels):
            tensor = torch.from_numpy(np.ascontiguousarray(pixels)).permute(2, 0, 1)[None].float() / 255.0
            tensor = F.interpolate(tensor, size=(self.resolution, self.resolution), mode="bilinear", align_corners=False)
            return (tensor - 0.5) / 0.25

        def encode(self, image):
            x = self.model.image_encoder.trunk.stem(image)
            tokens = x.flatten(2).transpose(1, 2)
            for block in self.model.image_encoder.trunk.blocks:
                q, _, v = block.attn.qkv(tokens).chunk(3, dim=-1)
                tokens = tokens + block.attn.proj(torch.tanh(q) * v)
            size = self.resolution // 4
            return {"image_embed": tokens.transpose(1, 2).reshape(1, -1, size, size), "high_res_feats": []}

        def prompt_tensors(self, prompts, width, height):
            rows = []
            for prompt in prompts:
                coords, labels = [], []
                if prompt.get("box") is not None:
                    x0, y0, x1, y1 = prompt["box"]
                    coords += [[x0, y0], [x1, y1]]
                    labels += [2, 3]
                for x, y, label in prompt.get("points", []):
                    coords.append([x, y])
                    labels.append(int(label))
                rows.append((coords, labels))
            length = max(len(labels) for _, labels in rows)
            coords_array = np.zeros((len(rows), length, 2), np.float32)
            labels_array = np.full((len(rows), length), -1, np.int64)
            scale = np.array([self.resolution / width, self.resolution / height], np.float32)
            for index, (coords, labels) in enumerate(rows):
                coords_array[index, : len(labels)] = np.asarray(coords, np.float32) * scale
                labels_array[index, : len(labels)] = labels
            return torch.from_numpy(coords_array), torch.from_numpy(labels_array)

        def _prompt_maps(self, coords, labels):
            size = self.resolution // 4
            grid = (torch.arange(size, dtype=torch.float32) + 0.5) * 4
            yy, xx = torch.meshgrid(grid, grid, indexing="ij")
            maps = torch.zeros(coords.shape[0], 3, size, size)
            for row in range(coords.shape[0]):
                for column in range(coords.shape[1]):
                    label = int(labels[row, column])
                    x, y = coords[row, column]
                    if label == 2:
                        x1, y1 = coords[row, column + 1]
                        maps[row, 0] = ((xx >= x) & (xx <= x1) & (yy >= y) & (yy <= y1)).float()
                    elif label in (0, 1):
                        bump = torch.exp(-((xx - x) ** 2 + (yy - y) ** 2) / (2 * 6.0**2))
                        maps[row, 1 if label == 1 else 2] += bump
            return maps

        def decode(self, features, coords, labels, mask_input=None):
            maps = self._prompt_maps(coords, labels)
            embed = features["image_embed"].expand(coords.shape[0], -1, -1, -1)
            tokens = embed.flatten(2).transpose(1, 2) + self.model.prompt_embed(maps.flatten(2).transpose(1, 2))
            decoder = self.model.sam_mask_decoder.transformer
            for attention in (decoder.layers[0].self_attn, decoder.layers[0].cross_attn_token_to_image,
                              decoder.layers[0].cross_attn_image_to_token, decoder.final_attn_token_to_image):
                tokens = tokens + attention(tokens)
            logits = self.model.sam_mask_decoder.readout(tokens)[..., 0]
            size = self.resolution // 4
            low_res = logits.reshape(-1, 1, size, size)
            iou = torch.sigmoid(low_res.mean(dim=(2, 3)))
            return low_res, iou

        def upsample(self, low_res, height, width):
            return F.interpolate(low_res.float(), size=(height, width), mode="bilinear", align_corners=False)

    return ToySam, ToySegmenter
