"""Exercise SAM 3's real CPU mask cleanup without allocating its backbone."""
import sys
import unittest
import warnings
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / "helpers"))
from adaptive_fixtures import apply_connector_sam3_cpu_patches

apply_connector_sam3_cpu_patches()
import torch
from sam3.model.utils.sam1_utils import SAM2Transforms


class CpuPostprocessingTests(unittest.TestCase):
    def test_small_hole_is_filled_without_skipping_postprocessing(self):
        transform = SAM2Transforms(8, 0., max_hole_area=4)
        logits = torch.full((1, 1, 8, 8), 2.)
        logits[0, 0, 3, 3] = -2.
        with warnings.catch_warnings():
            warnings.simplefilter("error")
            result = transform.postprocess_masks(logits, (8, 8))
        self.assertTrue(bool((result > 0).all()))

    def test_small_foreground_sprinkle_is_removed(self):
        transform = SAM2Transforms(8, 0., max_sprinkle_area=4)
        logits = torch.full((1, 1, 8, 8), -2.)
        logits[0, 0, 3, 3] = 2.
        with warnings.catch_warnings():
            warnings.simplefilter("error")
            result = transform.postprocess_masks(logits, (8, 8))
        self.assertFalse(bool((result > 0).any()))


if __name__ == "__main__":
    unittest.main()
