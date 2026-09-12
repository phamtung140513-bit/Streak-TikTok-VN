import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from core import tasks
from utils import config as config_module


class ConfigContractTests(unittest.TestCase):
    def test_default_config_matches_public_example(self):
        example_path = Path(config_module.__file__).resolve().parents[1] / "config.example.json"
        example = json.loads(example_path.read_text(encoding="utf-8"))
        self.assertEqual(example, config_module.DEFAULT_CONFIG)

    def test_missing_runtime_config_is_created_from_safe_defaults(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            path = Path(temp_dir) / "config.json"
            loaded = config_module._load_json_file(path, config_module.DEFAULT_CONFIG)
            self.assertEqual(config_module.DEFAULT_CONFIG, loaded)
            self.assertEqual(
                config_module.DEFAULT_CONFIG,
                json.loads(path.read_text(encoding="utf-8")),
            )
            self.assertFalse(loaded["useProtocolSender"])
            self.assertTrue(loaded["persistentBrowserProfiles"]["enabled"])

    def test_tasks_import_does_not_require_runtime_user_data(self):
        source_root = Path(__file__).resolve().parents[1]
        env = os.environ.copy()
        env["GITHUB_ACTIONS"] = "true"
        env.pop("USER_DATA", None)
        result = subprocess.run(
            [sys.executable, "-c", "import core.tasks"],
            cwd=source_root,
            env=env,
            capture_output=True,
            text=True,
            timeout=30,
        )
        self.assertEqual(0, result.returncode, result.stderr)

    def test_default_schedule_timezone_resolves_without_fallback(self):
        with patch.dict(os.environ, {"SPARKFLOW_TIMEZONE": ""}, clear=False):
            schedule_timezone = tasks._schedule_timezone()
        self.assertEqual("Asia/Shanghai", getattr(schedule_timezone, "key", None))

    def test_profile_root_environment_override_wins(self):
        with patch.dict(os.environ, {"SPARKFLOW_BROWSER_PROFILE_ROOT": "/tmp/sparkflow-profiles"}):
            normalized = tasks._normalize_persistent_profile_config(config_module.DEFAULT_CONFIG)
        self.assertEqual("/tmp/sparkflow-profiles", normalized["root"])


if __name__ == "__main__":
    unittest.main()