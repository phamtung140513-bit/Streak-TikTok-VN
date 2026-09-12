import json
import os
from pathlib import Path

CONFIG_FILE = Path(__file__).resolve().parent / "config_tiktok.json"

DEFAULT_MESSAGES = [
    "🔥 Lửa hôm nay nhé!",
    "Điểm danh chuỗi lửa hôm nay nè! 🔥",
    "Gửi bạn ngọn lửa ngày mới nha! 🔥"
]

DEFAULT_ACCOUNTS = [
    {
        "id": "acc_1",
        "name": "Tài khoản 1",
        "enabled": True,
        "target_friends": [],
        "messages": list(DEFAULT_MESSAGES),
        "recent_chat_count": 5
    },
    {
        "id": "acc_2",
        "name": "Tài khoản 2",
        "enabled": True,
        "target_friends": [],
        "messages": list(DEFAULT_MESSAGES),
        "recent_chat_count": 5
    }
]

DEFAULT_CONFIG = {
    "send_time": "05:00",
    "enabled": True,
    "accounts": DEFAULT_ACCOUNTS,
    "headless": False,
    "delay_between_messages_sec": 4,
    "delay_between_accounts_sec": 10
}


def load_config():
    if not CONFIG_FILE.exists():
        save_config(DEFAULT_CONFIG)
        return DEFAULT_CONFIG.copy()
    try:
        with open(CONFIG_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
            
            # Migration từ config cũ sang multi-account
            if "accounts" not in data:
                acc1 = {
                    "id": "acc_1",
                    "name": "Tài khoản 1",
                    "enabled": True,
                    "target_friends": data.get("target_friends", []),
                    "messages": data.get("messages", DEFAULT_MESSAGES),
                    "recent_chat_count": data.get("recent_chat_count", 5)
                }
                acc2 = {
                    "id": "acc_2",
                    "name": "Tài khoản 2",
                    "enabled": True,
                    "target_friends": [],
                    "messages": list(DEFAULT_MESSAGES),
                    "recent_chat_count": 5
                }
                data["accounts"] = [acc1, acc2]

            merged = DEFAULT_CONFIG.copy()
            merged.update(data)
            return merged
    except Exception:
        return DEFAULT_CONFIG.copy()


def save_config(cfg):
    try:
        with open(CONFIG_FILE, "w", encoding="utf-8") as f:
            json.dump(cfg, f, ensure_ascii=False, indent=2)
        return True
    except Exception:
        return False
