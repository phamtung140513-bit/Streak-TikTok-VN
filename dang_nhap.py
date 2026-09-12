import os
import sys
import time
import threading
from pathlib import Path
from playwright.sync_api import sync_playwright

acc_id = sys.argv[1] if len(sys.argv) > 1 else "acc_1"
repo_root = Path(__file__).resolve().parent

if acc_id == "acc_2":
    profile_dir = repo_root / "state" / "tiktok_profile_acc2"
    acc_title = "TÀI KHOẢN 2"
else:
    profile_dir = repo_root / "state" / "tiktok_profile"
    acc_title = "TÀI KHOẢN 1"

profile_dir.mkdir(parents=True, exist_ok=True)

print("=" * 60)
print(f"     ĐANG MỞ TRÌNH DUYỆT ĐĂNG NHẬP [{acc_title}]")
print("=" * 60)
print(f"Thư mục lưu phiên: {profile_dir}\n")

def cleanup_profile(target_dir):
    """Đóng sạch các tiến trình cũ đang khóa thư mục."""
    try:
        import psutil
        p_str = str(target_dir).lower()
        for proc in psutil.process_iter(['pid', 'name', 'cmdline']):
            try:
                cmdline = proc.info.get('cmdline') or []
                cmd_str = " ".join(cmdline).lower()
                p_name = proc.info.get('name', '').lower()
                if p_str in cmd_str and ('chrome' in p_name or 'edge' in p_name or 'chromium' in p_name):
                    proc.kill()
            except Exception:
                pass
    except Exception:
        pass

    for fname in ["SingletonLock", "SingletonSocket", "SingletonCookie", "LOCK"]:
        try:
            (target_dir / fname).unlink(missing_ok=True)
            (target_dir / "Default" / fname).unlink(missing_ok=True)
        except Exception:
            pass

cleanup_profile(profile_dir)

# Ưu tiên dùng Microsoft Edge trên Windows để tránh bị antivirus/360 chặn cửa sổ
edge_path = Path(r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe")
browser_channel = "msedge" if edge_path.exists() else None
browser_name = "Microsoft Edge" if browser_channel == "msedge" else "Chromium"

try:
    with sync_playwright() as p:
        print(f"[1] Đang khởi động trình duyệt {browser_name}...")
        
        launch_kwargs = {
            "user_data_dir": str(profile_dir),
            "headless": False,
            "args": [
                "--disable-blink-features=AutomationControlled",
                "--start-maximized",
                "--no-first-run",
                "--no-default-browser-check"
            ],
            "no_viewport": True,
            "locale": "vi-VN"
        }
        if browser_channel:
            launch_kwargs["channel"] = browser_channel

        context = p.chromium.launch_persistent_context(**launch_kwargs)
        page = context.pages[0] if context.pages else context.new_page()
        
        print(f"[2] Đang tải trang đăng nhập TikTok (https://www.tiktok.com/login/qrcode)...")
        page.goto("https://www.tiktok.com/login/qrcode")
        try:
            page.bring_to_front()
        except Exception:
            pass
        
        print("\n" + "=" * 60)
        print(f"👉 CỬA SỔ TRÌNH DUYỆT [{browser_name}] ĐÃ HIỆN LÊN MÀN HÌNH!")
        print("👉 Vui lòng quét mã QR trên điện thoại để đăng nhập.")
        print("👉 Hệ thống sẽ TỰ ĐỘNG NHẬN DIỆN khi bạn đăng nhập thành công!")
        print("=" * 60 + "\n")

        login_completed = threading.Event()

        def wait_for_enter_fallback():
            try:
                input(">>> (Hoặc bạn có thể nhấn phím ENTER tại đây sau khi quét mã xong): ")
                login_completed.set()
            except Exception:
                pass

        enter_thread = threading.Thread(target=wait_for_enter_fallback, daemon=True)
        enter_thread.start()

        # Vòng lặp tự động phát hiện khi đăng nhập xong (qua cookie hoặc url)
        while not login_completed.is_set():
            try:
                cookies = context.cookies()
                has_session = any(c.get("name") in ["sessionid", "sessionid_ss", "sid_guard", "uid_tt"] for c in cookies)
                if has_session:
                    print(f"\n🎉 PHÁT HIỆN COOKIE ĐĂNG NHẬP THÀNH CÔNG VÀO TIKTOK [{acc_title}]!")
                    login_completed.set()
                    time.sleep(2)
                    break

                if context.pages:
                    for current_page in context.pages:
                        cur_url = current_page.url.lower()
                        if "tiktok.com" in cur_url and "login" not in cur_url and "about:blank" not in cur_url:
                            print(f"\n🎉 PHÁT HIỆN CHUYỂN HƯỚNG ĐĂNG NHẬP THÀNH CÔNG [{acc_title}]!")
                            login_completed.set()
                            time.sleep(2)
                            break
            except Exception:
                break
            time.sleep(1)

        print("\n[3] Đang lưu cấu hình và đóng trình duyệt...")
        context.close()
        
    print(f"\n✅ [THÀNH CÔNG RỰC RỠ] Đã lưu phiên đăng nhập [{acc_title}] thành công!")
except Exception as e:
    print(f"\n❌ [LỖI] Có lỗi xảy ra: {e}")

input("\nNhấn Enter để đóng cửa sổ...")
