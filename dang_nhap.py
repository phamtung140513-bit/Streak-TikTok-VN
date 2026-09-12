import os
import sys
import time
import subprocess
import sqlite3
import shutil
import tempfile
from pathlib import Path

if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

acc_id = sys.argv[1] if len(sys.argv) > 1 else "acc_1"
repo_root = Path(__file__).resolve().parent

if acc_id == "acc_2":
    profile_dir = repo_root / "state" / "tiktok_profile_acc2"
    acc_title = "TÀI KHOẢN 2"
else:
    profile_dir = repo_root / "state" / "tiktok_profile"
    acc_title = "TÀI KHOẢN 1"

profile_dir.mkdir(parents=True, exist_ok=True)

# Dọn dẹp lock files
for fname in ["SingletonLock", "SingletonSocket", "SingletonCookie", "LOCK", "lockfile"]:
    try:
        (profile_dir / fname).unlink(missing_ok=True)
        (profile_dir / "Default" / fname).unlink(missing_ok=True)
    except Exception:
        pass

# Tìm trình duyệt thực tế được cài đặt trên máy
browser_candidates = [
    (Path(r"C:\Program Files\Google\Chrome\Application\chrome.exe"), "Google Chrome"),
    (Path(r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"), "Microsoft Edge"),
    (Path(r"C:\Program Files\Microsoft\Edge\Application\msedge.exe"), "Microsoft Edge"),
    (Path(r"C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"), "Google Chrome"),
    (Path(r"C:\Users\Admin\AppData\Local\Google\Chrome\Application\chrome.exe"), "Google Chrome")
]

browser_exe = None
browser_name = None

for path, name in browser_candidates:
    if path.exists():
        browser_exe = str(path)
        browser_name = name
        break

if not browser_exe:
    browser_exe = "msedge.exe"
    browser_name = "Trình duyệt Web"

print("=" * 60)
print(f"     ĐĂNG NHẬP TIKTOK [{acc_title}]")
print("=" * 60)
print(f"Trình duyệt sử dụng: {browser_name}")
print(f"Thư mục lưu phiên: {profile_dir}\n")

def check_session_in_cookies(p_dir):
    c_path = p_dir / "Default" / "Network" / "Cookies"
    if not c_path.exists():
        return False
    try:
        with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as tf:
            t_name = tf.name
        shutil.copyfile(c_path, t_name)
        conn = sqlite3.connect(t_name)
        c = conn.cursor()
        c.execute("SELECT name FROM cookies WHERE name IN ('sessionid', 'sessionid_ss', 'sid_guard', 'uid_tt')")
        rows = c.fetchall()
        conn.close()
        Path(t_name).unlink(missing_ok=True)
        return len(rows) > 0
    except Exception:
        return False

# Mở trình duyệt thực tế trực tiếp
cmd = [
    browser_exe,
    f"--user-data-dir={profile_dir}",
    "--no-first-run",
    "--no-default-browser-check",
    "https://www.tiktok.com/login/qrcode"
]

print(f"[1] Đang mở {browser_name}...")
proc = subprocess.Popen(cmd)

print("\n" + "=" * 60)
print(f"👉 CỬA SỔ [{browser_name}] ĐÃ HIỆN LÊN MÀN HÌNH!")
print("👉 Hãy quét mã QR trên điện thoại (hoặc đăng nhập bằng Google/Email/SĐT).")
print("👉 Hệ thống sẽ TỰ ĐỘNG PHÁT HIỆN ngay khi bạn đăng nhập thành công!")
print("=" * 60 + "\n")

logged_in = False
for i in range(300):  # Đợi tối đa 5 phút
    if proc.poll() is not None:
        # Người dùng tự đóng trình duyệt, kiểm tra xem đã lưu cookie chưa
        if check_session_in_cookies(profile_dir):
            logged_in = True
        break

    if check_session_in_cookies(profile_dir):
        logged_in = True
        print(f"\n🎉 PHÁT HIỆN ĐĂNG NHẬP THÀNH CÔNG VÀO [{acc_title}]!")
        time.sleep(2)
        break

    time.sleep(1)

if logged_in:
    print(f"\n✅ [THÀNH CÔNG] Đã lưu phiên đăng nhập [{acc_title}] vĩnh viễn!")
    print("Bạn có thể đóng cửa sổ trình duyệt và bắt đầu dùng bot.")
else:
    print(f"\n⚠️ Chưa phát hiện phiên đăng nhập. Bạn có thể mở lại để thử lại.")

print("\nNhấn phím Enter để hoàn tất...")
try:
    input()
except Exception:
    pass
