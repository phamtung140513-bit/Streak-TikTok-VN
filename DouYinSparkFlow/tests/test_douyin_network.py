import unittest
from unittest.mock import patch

from core import browser
from utils import config as config_module


class DouyinNetworkRouteTests(unittest.TestCase):
    def test_default_route_is_direct(self):
        with patch.object(browser, "get_app_settings", return_value={}):
            with patch.dict(browser.os.environ, {}, clear=False):
                browser.os.environ.pop("SPARKFLOW_DOUYIN_NETWORK_MODE", None)
                browser.os.environ.pop("SPARKFLOW_DOUYIN_PROXY_URL", None)
                options = browser._browser_launch_options(False)
        self.assertNotIn("proxy", options)
        self.assertIn("--no-proxy-server", options["args"])

    def test_mihomo_route_is_explicit(self):
        with patch.object(browser, "get_app_settings", return_value={}):
            with patch.dict(
                browser.os.environ,
                {
                    "SPARKFLOW_DOUYIN_NETWORK_MODE": "mihomo",
                    "SPARKFLOW_DOUYIN_PROXY_URL": "http://127.0.0.1:7890",
                },
                clear=False,
            ):
                options = browser._browser_launch_options(False)
        self.assertEqual({"server": "http://127.0.0.1:7890"}, options["proxy"])
        self.assertNotIn("--no-proxy-server", options["args"])

    def test_default_app_settings_keep_direct_route(self):
        self.assertEqual("direct", config_module.DEFAULT_APP_SETTINGS["douyin_network_mode"])
        self.assertEqual("http://proxy:7890", config_module.DEFAULT_APP_SETTINGS["douyin_proxy_url"])


if __name__ == "__main__":
    unittest.main()
