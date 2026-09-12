from unittest import IsolatedAsyncioTestCase
from unittest.mock import patch

from login_desktop_server import LoginDesktopManager, LoginNetworkError


class LoginNetworkTests(IsolatedAsyncioTestCase):
    async def test_auto_mode_prefers_direct_route(self):
        manager = LoginDesktopManager()
        with (
            patch("login_desktop_server.LOGIN_NETWORK_MODE", "auto"),
            patch("login_desktop_server.LOGIN_PROXY_SERVER", "http://proxy:7890"),
            patch(
                "login_desktop_server._probe_login_target",
                return_value={"ok": True, "status": 200, "latency_ms": 10},
            ) as probe,
        ):
            route = await manager._select_network_route(force=True)

        self.assertEqual("direct", route["mode"])
        probe.assert_called_once_with(None, 15)

    async def test_auto_mode_falls_back_to_proxy(self):
        manager = LoginDesktopManager()
        with (
            patch("login_desktop_server.LOGIN_NETWORK_MODE", "auto"),
            patch("login_desktop_server.LOGIN_PROXY_SERVER", "http://proxy:7890"),
            patch(
                "login_desktop_server._probe_login_target",
                side_effect=[
                    {"ok": False, "error": "direct failed"},
                    {"ok": True, "status": 200, "latency_ms": 20},
                ],
            ) as probe,
        ):
            route = await manager._select_network_route(force=True)

        self.assertEqual("proxy", route["mode"])
        self.assertIsNone(probe.call_args_list[0].args[0])
        self.assertEqual("http://proxy:7890", probe.call_args_list[1].args[0])

    async def test_auto_mode_reports_both_failures(self):
        manager = LoginDesktopManager()
        with (
            patch("login_desktop_server.LOGIN_NETWORK_MODE", "auto"),
            patch("login_desktop_server.LOGIN_PROXY_SERVER", "http://proxy:7890"),
            patch(
                "login_desktop_server._probe_login_target",
                side_effect=[
                    {"ok": False, "error": "direct failed"},
                    {"ok": False, "error": "proxy failed"},
                ],
            ),
        ):
            with self.assertRaises(LoginNetworkError) as caught:
                await manager._select_network_route(force=True)

        self.assertIn("直连和代理", str(caught.exception))
        self.assertEqual({"direct", "proxy"}, set(caught.exception.checks))

    async def test_network_preflight_exposes_selected_route_without_credentials(self):
        manager = LoginDesktopManager()
        with (
            patch("login_desktop_server.LOGIN_NETWORK_MODE", "proxy"),
            patch("login_desktop_server.LOGIN_PROXY_SERVER", "http://user:secret@proxy:7890"),
            patch(
                "login_desktop_server._probe_login_target",
                return_value={"ok": True, "status": 200, "latency_ms": 5},
            ),
        ):
            result = await manager.network_preflight(force=True)

        self.assertTrue(result["ok"])
        self.assertEqual("proxy", result["route"]["mode"])
        self.assertEqual("proxy:7890", result["network"]["proxy"])
        self.assertNotIn("secret", repr(result))
