import os
import sys
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
    try:
        import psutil
        p_str = str(target_dir).lower()
        for proc in psutil.process_iter(['pid', 'name', 'cmdline']):
            try:
                cmdline = proc.info.get('cmdline') or []
                cmd_str = " ".join(cmdline).lower()
                if p_str in cmd_str and ('chrome' in proc.info.get('name', '').lower() or 'chromium' in proc.info.get('name', '').lower()):
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

# Tự động dọn dẹp tiến trình cũ đang chiếm giữ thư mục nếu có
cleanup_profile(profile_dir)

try:
    with sync_playwright() as p:
        print("[1] Đang khởi động trình duyệt Chromium...")
        context = p.chromium.launch_persistent_context(
            user_data_dir=str(profile_dir),
            headless=False,
            args=[
                "--disable-blink-features=AutomationControlled",
                "--window-size=1200,850",
                "--window-position=120,60"
            ],
            viewport={"width": 1200, "height": 850},
            locale="vi-VN"
        )
        page = context.pages[0] if context.pages else context.new_page()
        
        print("[2] Đang mở trang đăng nhập TikTok (https://www.tiktok.com/login/qrcode)...")
        page.goto("https://www.tiktok.com/login/qrcode")
        try:
            page.bring_to_front()
        except Exception:
            pass
        
        print("\n" + "=" * 60)
        print(f">>> TRÌNH DUYỆT [{acc_title}] ĐÃ MỞ TRÊN MÀN HÌNH!")
        print(">>> Vui lòng quét mã QR trên điện thoại hoặc đăng nhập tài khoản.")
        print(">>> (Nếu bị che, hãy nhìn xuống Taskbar hoặc bấm Alt + Tab)")
        print("=" * 60 + "\n")
        
        input(f">>> Sau khi đã đăng nhập xong [{acc_title}], hãy nhấn ENTER tại đây: ")
        context.close()
        
    print(f"\n[THÀNH CÔNG] Đã lưu phiên đăng nhập [{acc_title}] thành công!")
except Exception as e:
    print(f"\n[LỖI] Có lỗi xảy ra: {e}")

input("\nNhấn Enter để thoát...")
