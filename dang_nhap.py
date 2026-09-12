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

try:
    with sync_playwright() as p:
        print("[1] Đang khởi động trình duyệt Chromium...")
        context = p.chromium.launch_persistent_context(
            user_data_dir=str(profile_dir),
            headless=False,
            args=[
                "--disable-blink-features=AutomationControlled",
                "--start-maximized"
            ],
            no_viewport=True,
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
        print(f">>> TRÌNH DUYỆT [{acc_title}] ĐÃ HIỆN LÊN TRÊN MÀN HÌNH!")
        print(">>> Vui lòng quét mã QR trên điện thoại hoặc đăng nhập tài khoản.")
        print("=" * 60 + "\n")
        
        input(f">>> Sau khi đã đăng nhập xong [{acc_title}], hãy nhấn ENTER tại đây: ")
        context.close()
        
    print(f"\n[THÀNH CÔNG] Đã lưu phiên đăng nhập [{acc_title}] thành công!")
except Exception as e:
    print(f"\n[LỖI] Có lỗi xảy ra: {e}")

input("\nNhấn Enter để thoát...")
