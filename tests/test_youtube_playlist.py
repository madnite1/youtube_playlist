import importlib.util
import pathlib
import sys
import types
import unittest
from unittest import mock


ROOT = pathlib.Path(__file__).resolve().parents[1]


def _load_module():
    plugins_module = types.ModuleType("plugins")
    plugins_module.__path__ = []
    metadata_module = types.ModuleType("plugins.metadata")
    metadata_module.__path__ = []
    base_module = types.ModuleType("plugins.metadata.base")

    class BaseMetadataProvider:
        pass

    base_module.BaseMetadataProvider = BaseMetadataProvider
    sys.modules["plugins"] = plugins_module
    sys.modules["plugins.metadata"] = metadata_module
    sys.modules["plugins.metadata.base"] = base_module

    spec = importlib.util.spec_from_file_location(
        "youtube_playlist_under_test",
        ROOT / "youtube_playlist.py",
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


mod = _load_module()
Provider = mod.YouTubePlaylistMetadataProvider


class YouTubePlaylistContractTests(unittest.TestCase):
    def test_category_is_limited_to_supported_sessions(self):
        self.assertEqual(Provider.category_tab["sessions"], ["general", "adult"])

    def test_auto_play_config_false_is_respected(self):
        provider = Provider.__new__(Provider)
        provider.get_plugin_config = lambda db_type, default=None: {"AUTO_PLAY": False}

        self.assertFalse(provider._is_auto_play_enabled("general"))

    def test_dashboard_honors_limit_and_common_items_contract(self):
        provider = Provider.__new__(Provider)
        provider._start_background_scanner = lambda: None
        provider._sync_and_get_playlists = lambda current_db="general": [
            {"id": "PL1", "custom_name": "", "target_db": "general"},
            {"id": "PL2", "custom_name": "", "target_db": "general"},
            {"id": "PL3", "custom_name": "", "target_db": "general"},
        ]
        provider.get_plugin_config = lambda db_type, default=None: {
            "AUTO_PLAY": False,
            "MINI_PLAYER_ENABLED": True,
        }

        def cached_playlist(playlist_id):
            return {
                "id": playlist_id,
                "target_db": "general",
                "title": playlist_id,
                "channel": "test",
                "cover": "https://example.com/cover.jpg",
                "item_count": 1,
                "videos": [{"id": "abcdefghijk"}],
                "updated_at": "2026-09-01 00:00:00",
            }

        with mock.patch.object(mod, "load_from_sqlite", side_effect=cached_playlist):
            result = provider.get_dashboard_data("general", limit=2)

        self.assertEqual(result["total_series"], 3)
        self.assertEqual(len(result["items"]), 2)
        self.assertEqual(result["items"], result["series"])
        self.assertEqual(
            result["config"],
            {
                "auto_play_enabled": False,
                "mini_player_enabled": True,
            },
        )


if __name__ == "__main__":
    unittest.main()
