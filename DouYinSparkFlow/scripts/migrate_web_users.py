"""Idempotently initialize SparkFlow Web users and account ownership.

Usage (passwords can also be supplied through environment variables):
    python scripts/migrate_web_users.py --zxb-password '...' --zcf-password '...'
"""

from __future__ import annotations

import argparse
import os
import shutil
import sys
from datetime import datetime
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from utils.config import get_userData, save_userData
from webui.auth import hash_password
from webui.users import get_web_users, save_web_users


BINDINGS = {
    "zxb": "头像是本人",
    "zcf": "你成功捕捉一只野生妖孽",
}


def parse_args():
    parser = argparse.ArgumentParser(description="Initialize SparkFlow Web users and account ownership")
    parser.add_argument("--zxb-password", default=os.getenv("SPARKFLOW_ZXB_PASSWORD", ""))
    parser.add_argument("--zcf-password", default=os.getenv("SPARKFLOW_ZCF_PASSWORD", ""))
    parser.add_argument("--backup-dir", default="")
    parser.add_argument("--dry-run", action="store_true")
    return parser.parse_args()


def backup_json_files(directory: Path):
    directory.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    target = directory / stamp
    target.mkdir(parents=True, exist_ok=True)
    for relative in ("usersData.json", "webui_settings.json", "webui_users.json"):
        source = ROOT / relative
        if source.exists():
            shutil.copy2(source, target / source.name)
    return target


def main():
    args = parse_args()
    passwords = {"zxb": args.zxb_password, "zcf": args.zcf_password}
    missing = [username for username, password in passwords.items() if not password]
    if missing:
        raise SystemExit("Missing password for: " + ", ".join(missing))

    accounts = get_userData(force_reload=True)
    changed = False
    for account in accounts:
        if not str(account.get("account_ref", "")).strip():
            import uuid
            account["account_ref"] = f"acc-{uuid.uuid4().hex}"
            changed = True

    matched = {}
    for web_username, douyin_username in BINDINGS.items():
        candidates = [account for account in accounts if str(account.get("username", "")).strip() == douyin_username]
        if len(candidates) != 1:
            raise SystemExit(
                f"Expected exactly one Douyin account named {douyin_username!r} for {web_username}; found {len(candidates)}"
            )
        matched[web_username] = candidates[0]

    users = get_web_users()
    existing = {str(user.get("username", "")).casefold(): user for user in users}
    assigned_by_other = {
        ref: user["username"]
        for user in users
        for ref in user.get("account_refs", [])
        if str(user.get("username", "")).casefold() not in BINDINGS
    }
    for web_username, account in matched.items():
        ref = account["account_ref"]
        owner = assigned_by_other.get(ref)
        if owner and owner.casefold() != web_username.casefold():
            raise SystemExit(f"Account {account['username']!r} is already assigned to {owner}")
        item = existing.get(web_username.casefold())
        if item is None:
            item = {
                "username": web_username,
                "role": "user",
                "password_hash": hash_password(passwords[web_username]),
                "enabled": True,
                "account_refs": [ref],
            }
            users.append(item)
        else:
            refs = list(dict.fromkeys(item.get("account_refs", [])))
            if ref not in refs:
                refs.append(ref)
            item["account_refs"] = [ref]
            item["enabled"] = True
        changed = True

    if args.dry_run:
        print(f"accounts={len(accounts)} users={len(users)} matched=zxb,zcf changed={changed}")
        return 0

    backup_dir = Path(args.backup_dir) if args.backup_dir else ROOT / ".migration-backups"
    backup_path = backup_json_files(backup_dir)
    if changed:
        save_userData(accounts)
    save_web_users(users)
    print(f"migration complete: users={len(users)} backup={backup_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
