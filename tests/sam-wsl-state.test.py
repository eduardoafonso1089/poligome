"""Execute the actual bash selection monitor embedded in the Windows BAT."""
from pathlib import Path
import os
import re
import subprocess
import tempfile
import unittest

source = (Path(__file__).resolve().parents[1] / "public/poligome-sam-windows.bat").read_text()
inline = next(
    match.group(1) for match in re.finditer(r'^wsl\.exe --exec bash -lc "(.*)"$', source, re.M)
    if "commit_windows_selection()" in match.group(1)
)
start = inline.index("commit_windows_selection() {")
end = inline.index(" monitor_commit()", start)
COMMIT_FUNCTION = inline[start:end].rstrip("; ")


class WslSelectionTests(unittest.TestCase):
    def run_commit(self, requested, selected, pending_linux=False, staged=None, unwritable=False):
        directory = tempfile.TemporaryDirectory(prefix="poligome wsl state ")
        self.addCleanup(directory.cleanup)
        root = Path(directory.name)
        linux_selected = root / "linux selected.txt"
        linux_pending = root / "linux pending.txt"
        windows_selected = root / "windows selected.txt"
        windows_pending = root / "windows pending.txt"
        if selected is not None:
            linux_selected.write_text(selected + "\n")
        if pending_linux:
            linux_pending.write_text(requested + "\n")
        windows_selected.write_text("sam2.1-hiera-small\n")
        windows_pending.write_text((staged or requested) + "\n")
        script = (
            "set -euo pipefail; set -f; wsl_selected=$1; wsl_pending=$2; "
            "POLIGOME_WINDOWS_PENDING_FILE=$3; POLIGOME_WINDOWS_SELECTED_FILE=$4; "
            + COMMIT_FUNCTION.replace("!MODEL_ID!", requested)
            + "; commit_windows_selection"
        )
        if unwritable:
            root.chmod(0o500)
        try:
            result = subprocess.run(
                ["bash", "-c", script, "selection-test", str(linux_selected), str(linux_pending),
                 str(windows_pending), str(windows_selected)],
                capture_output=True, text=True,
            )
        finally:
            root.chmod(0o700)
        return result, windows_selected.read_text().strip(), windows_pending.exists(), root

    def test_installing_another_checkpoint_preserves_active_model(self):
        result, selected, pending, root = self.run_commit("sam2.1-hiera-tiny", "sam2.1-hiera-small")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(selected, "sam2.1-hiera-small")
        self.assertFalse(pending)
        self.assertEqual(list(root.glob("*.part.*")), [])

    def test_newly_loaded_model_is_mirrored(self):
        result, selected, pending, _ = self.run_commit("sam2.1-hiera-tiny", "sam2.1-hiera-tiny")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(selected, "sam2.1-hiera-tiny")
        self.assertFalse(pending)

    def test_incomplete_installation_preserves_recovery_and_selection(self):
        result, selected, pending, _ = self.run_commit("sam2.1-hiera-tiny", "sam2.1-hiera-small", pending_linux=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(selected, "sam2.1-hiera-small")
        self.assertTrue(pending)

    def test_another_staged_installation_is_not_overwritten(self):
        result, selected, pending, _ = self.run_commit("sam2.1-hiera-tiny", "sam2.1-hiera-tiny", staged="medsam2-latest")
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(selected, "sam2.1-hiera-small")
        self.assertTrue(pending)

    def test_missing_linux_selection_does_not_confirm_windows_selection(self):
        result, selected, pending, _ = self.run_commit("sam2.1-hiera-tiny", None)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(selected, "sam2.1-hiera-small")
        self.assertTrue(pending)

    @unittest.skipIf(os.geteuid() == 0, "root can write to read-only directories")
    def test_failed_mirror_write_preserves_previous_selection_and_recovery(self):
        result, selected, pending, _ = self.run_commit("sam2.1-hiera-tiny", "sam2.1-hiera-tiny", unwritable=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(selected, "sam2.1-hiera-small")
        self.assertTrue(pending)


if __name__ == "__main__":
    unittest.main()
