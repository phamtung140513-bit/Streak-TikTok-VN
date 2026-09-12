import asyncio
import base64
import os
import random
from datetime import datetime
from pathlib import Path

from playwright.async_api import async_playwright

from tiktok_app.logger import get_logger
from tiktok_app.tiktok_config import load_config

logger = get_logger()

# Thư mục gốc dự án
REPO_ROOT = Path(__file__).resolve().parent.parent.parent

# Trạng thái bot
current_bot_state = {
    "is_running": False,
    "last_run_time": None,
    "last_status": "Sẵn sàng",
    "is_login_window_open": False
}


def get_browser_channel():
    edge_path = Path(r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe")
    if edge_path.exists():
        return "msedge"
    return None


def get_profile_dir(acc_id="acc_1"):
    """Lấy thư mục hồ sơ trình duyệt tương ứng với tài khoản."""
    if acc_id == "acc_2":
        p_dir = REPO_ROOT / "state" / "tiktok_profile_acc2"
    else:
        p_dir = REPO_ROOT / "state" / "tiktok_profile"
    p_dir.mkdir(parents=True, exist_ok=True)
    return p_dir


async def check_login_status(acc_id="acc_1"):
    """Kiểm tra sơ bộ xem tài khoản đã có dữ liệu đăng nhập hay chưa."""
    p_dir = get_profile_dir(acc_id)
    cookies_dir = p_dir / "Default" / "Network" / "Cookies"
    cookies_legacy = p_dir / "Default" / "Cookies"
    if cookies_dir.exists() or cookies_legacy.exists():
        return True
    default_dir = p_dir / "Default"
    if default_dir.exists() and any(default_dir.iterdir()):
        return True
    return False


async def open_login_window(acc_id="acc_1"):
    """Mở cửa sổ trình duyệt để người dùng đăng nhập TikTok thủ công cho từng tài khoản."""
    acc_name = "Tài khoản 2" if acc_id == "acc_2" else "Tài khoản 1"
    bat_file = "dang_nhap_acc2.bat" if acc_id == "acc_2" else "dang_nhap.bat"
    bat_path = REPO_ROOT / bat_file

    logger.info(f"Đang mở trình duyệt đăng nhập cho [{acc_name}]...")

    if bat_path.exists() and os.name == "nt":
        try:
            import subprocess
            subprocess.Popen(["cmd.exe", "/c", "start", str(bat_path)], shell=True)
            current_bot_state["is_login_window_open"] = False
            return {
                "status": "ok",
                "message": f"Đã mở cửa sổ đăng nhập cho [{acc_name}]! Hãy quét mã QR TikTok."
            }
        except Exception as e:
            logger.error(f"Lỗi khi chạy {bat_file}: {e}")

    return {
        "status": "ok",
        "message": f"Vui lòng nhấp đúp vào file {bat_file} ở thư mục dự án để đăng nhập."
    }


async def _find_and_type_message(page, message_text):
    """Tìm ô nhập tin nhắn và gõ văn bản."""
    input_selectors = [
        'div.public-DraftEditor-content[contenteditable="true"]',
        'div[contenteditable="true"]',
        'div[role="textbox"]',
        'div[data-e2e="message-input-area"]',
        'div[data-e2e="message-input"]',
        'textarea',
    ]

    input_elem = None
    for sel in input_selectors:
        try:
            elem = page.locator(sel).first
            if await elem.count() > 0 and await elem.is_visible():
                input_elem = elem
                break
        except Exception:
            continue

    if not input_elem:
        raise RuntimeError("Không tìm thấy ô nhập tin nhắn trên trang TikTok Messages.")

    await input_elem.click()
    await asyncio.sleep(0.5)

    logger.info(f"Đang nhập tin nhắn: '{message_text}'")
    await page.keyboard.type(message_text, delay=random.randint(40, 80))
    await asyncio.sleep(0.8)

    await page.keyboard.press("Enter")
    logger.info("Đã nhấn Enter để gửi.")
    await asyncio.sleep(2)


async def get_tiktok_friends(acc_id="acc_1"):
    """Lấy danh sách bạn bè hiện có trong hộp thư TikTok của từng tài khoản."""
    acc_name = "Tài khoản 2" if acc_id == "acc_2" else "Tài khoản 1"
    logger.info(f"Đang quét danh sách bạn bè từ TikTok cho [{acc_name}]...")
    
    p_dir = get_profile_dir(acc_id)
    playwright = None
    context = None
    friends = []
    try:
        playwright = await async_playwright().start()
        chan = get_browser_channel()
        launch_kwargs = {
            "user_data_dir": str(p_dir),
            "headless": True,
            "viewport": {"width": 1280, "height": 800},
            "args": ["--disable-blink-features=AutomationControlled", "--no-sandbox"],
            "locale": "vi-VN",
        }
        if chan:
            launch_kwargs["channel"] = chan
        context = await playwright.chromium.launch_persistent_context(**launch_kwargs)
        page = context.pages[0] if context.pages else await context.new_page()
        await page.goto("https://www.tiktok.com/messages", wait_until="domcontentloaded", timeout=45000)
        
        try:
            await page.wait_for_selector('div[class*="DivItemWrapper"], [data-e2e="chat-item"]', timeout=15000)
        except Exception:
            pass
        await asyncio.sleep(3)

        raw_friends = await page.evaluate('''() => {
            const items = Array.from(document.querySelectorAll('div[class*="DivItemWrapper"]'));
            if (items.length === 0) {
                const fallbackItems = Array.from(document.querySelectorAll('[data-e2e="chat-item"], div[class*="ChatItem"]'));
                return fallbackItems.map(it => {
                    return (it.innerText || '').split('\\n')[0].trim();
                }).filter(Boolean);
            }
            return items.map(item => {
                const nameEl = item.querySelector('span[class*="SpanNicknameText"], p[class*="PInfoNickname"]');
                if (nameEl && nameEl.textContent.trim()) {
                    return nameEl.textContent.trim();
                }
                const lines = (item.innerText || '').split('\\n').map(l => l.trim()).filter(Boolean);
                return lines.length > 0 ? lines[0] : '';
            }).filter(name => name.length > 0);
        }''')
        
        seen = set()
        for name in raw_friends:
            if name not in seen:
                seen.add(name)
                friends.append(name)
        logger.info(f"Đã quét được {len(friends)} bạn bè của [{acc_name}]: {friends}")
    except Exception as e:
        logger.error(f"Lỗi khi lấy danh sách bạn bè của [{acc_name}]: {e}")
    finally:
        if context:
            try:
                await context.close()
            except Exception:
                pass
        if playwright:
            try:
                await playwright.stop()
            except Exception:
                pass
    return friends


async def _run_single_account_send(page, acc, is_headless, delay_sec, custom_message=None):
    """Thực hiện gửi tin nhắn cho 1 tài khoản cụ thể."""
    acc_name = acc.get("name", acc.get("id", "Tài khoản"))
    target_friends = acc.get("target_friends", [])
    recent_chat_count = int(acc.get("recent_chat_count", 5))
    messages_pool = acc.get("messages", ["🔥 Lửa hôm nay nhé!"])

    logger.info(f"--- Đang thực hiện tác vụ cho [{acc_name}] ---")
    await page.goto("https://www.tiktok.com/messages", wait_until="domcontentloaded", timeout=60000)
    await asyncio.sleep(4)

    if "login" in page.url:
        msg = f"[{acc_name}] chưa đăng nhập hoặc phiên đã hết hạn!"
        logger.error(msg)
        return False, msg

    try:
        close_buttons = page.locator('div[class*="DivNotification"] button, div[class*="toast"] button, [aria-label="Close"]')
        if await close_buttons.count() > 0:
            await close_buttons.first.click(timeout=2000)
    except Exception:
        pass

    chat_items = page.locator('div[class*="DivItemWrapper"]')
    cnt = await chat_items.count()
    if cnt == 0:
        chat_items = page.locator('[data-e2e="chat-item"], div[class*="ChatItem"]')
        cnt = await chat_items.count()

    if cnt == 0:
        raise RuntimeError(f"[{acc_name}] Không tìm thấy cuộc hội thoại nào trong danh sách Tin nhắn.")

    logger.info(f"[{acc_name}] Đã tải được {cnt} cuộc hội thoại.")
    success_count = 0
    total_targets = 0

    if target_friends and len(target_friends) > 0:
        total_targets = len(target_friends)
        logger.info(f"[{acc_name}] Gửi cho đúng {total_targets} bạn bè đã chọn: {target_friends}")
        for friend_name in target_friends:
            friend_name = friend_name.strip()
            if not friend_name:
                continue
            found = False
            for idx in range(cnt):
                item = chat_items.nth(idx)
                try:
                    text = await item.inner_text()
                    if friend_name.lower() in text.lower():
                        logger.info(f"[{acc_name}] Đang mở cuộc trò chuyện với: '{friend_name}'...")
                        await item.click()
                        await asyncio.sleep(2)
                        msg_to_send = custom_message or random.choice(messages_pool)
                        await _find_and_type_message(page, msg_to_send)
                        success_count += 1
                        logger.info(f"✅ [{acc_name}] Đã gửi thành công cho: {friend_name}")
                        found = True
                        await asyncio.sleep(delay_sec)
                        break
                except Exception as ex:
                    logger.error(f"[{acc_name}] Lỗi khi gửi cho {friend_name}: {ex}")

            if not found:
                logger.warning(f"[{acc_name}] Không tìm thấy bạn '{friend_name}' trong danh sách chat đang hiển thị.")
    else:
        total_to_send = min(cnt, recent_chat_count)
        total_targets = total_to_send
        logger.info(f"[{acc_name}] Gửi cho {total_to_send} cuộc hội thoại gần nhất...")
        for idx in range(total_to_send):
            try:
                item = chat_items.nth(idx)
                name_el = item.locator('span[class*="SpanNicknameText"], p[class*="PInfoNickname"]').first
                name = await name_el.inner_text() if await name_el.count() > 0 else f"Hội thoại #{idx + 1}"
                logger.info(f"[{acc_name}] Đang mở cuộc trò chuyện #{idx + 1} ({name})...")
                await item.click()
                await asyncio.sleep(2)

                msg_to_send = custom_message or random.choice(messages_pool)
                await _find_and_type_message(page, msg_to_send)
                success_count += 1
                logger.info(f"✅ [{acc_name}] Đã gửi thành công cho: {name}")
                await asyncio.sleep(delay_sec)
            except Exception as err:
                logger.error(f"[{acc_name}] Lỗi ở hội thoại #{idx + 1}: {err}")

    summary = f"[{acc_name}] Hoàn thành: {success_count}/{total_targets or 1} tin nhắn thành công."
    logger.info(summary)
    return True, summary


async def send_tiktok_messages(target_acc_id=None, custom_message=None):
    """Quy trình gửi tin nhắn tự động. Nếu target_acc_id=None sẽ gửi lần lượt tất cả tài khoản."""
    if current_bot_state["is_running"]:
        logger.warning("Một tác vụ gửi tin nhắn đang chạy, vui lòng chờ.")
        return False, "Một tác vụ gửi tin nhắn đang chạy."

    current_bot_state["is_running"] = True
    current_bot_state["last_status"] = "Đang gửi tin nhắn..."
    logger.info("========== BẮT ĐẦU TÁC VỤ GỬI TIN NHẮN TIKTOK ==========")

    config = load_config()
    accounts = config.get("accounts", [])
    delay_sec = int(config.get("delay_between_messages_sec", 4))
    acc_delay_sec = int(config.get("delay_between_accounts_sec", 10))
    is_headless = bool(config.get("headless", False))

    if target_acc_id:
        active_accounts = [a for a in accounts if a.get("id") == target_acc_id]
    else:
        active_accounts = [a for a in accounts if a.get("enabled", True)]

    if not active_accounts:
        msg = "Không có tài khoản nào được kích hoạt để gửi."
        logger.warning(msg)
        current_bot_state["is_running"] = False
        current_bot_state["last_status"] = msg
        return False, msg

    playwright = None
    all_summaries = []

    try:
        playwright = await async_playwright().start()

        for i, acc in enumerate(active_accounts):
            acc_id = acc.get("id", f"acc_{i+1}")
            acc_name = acc.get("name", acc_id)
            p_dir = get_profile_dir(acc_id)

            logger.info(f"Khởi động trình duyệt cho: [{acc_name}] (Profile: {p_dir.name})...")
            chan = get_browser_channel()
            launch_kwargs = {
                "user_data_dir": str(p_dir),
                "headless": is_headless,
                "viewport": {"width": 1280, "height": 800},
                "args": [
                    "--disable-blink-features=AutomationControlled",
                    "--no-sandbox",
                    "--disable-infobars",
                    "--start-maximized"
                ],
                "locale": "vi-VN",
            }
            if chan:
                launch_kwargs["channel"] = chan
            context = await playwright.chromium.launch_persistent_context(**launch_kwargs)
            page = context.pages[0] if context.pages else await context.new_page()

            await page.add_init_script("""
                Object.defineProperty(navigator, 'webdriver', {
                    get: () => undefined
                });
            """)

            try:
                ok, summary = await _run_single_account_send(page, acc, is_headless, delay_sec, custom_message)
                all_summaries.append(summary)
            except Exception as e:
                err_msg = f"[{acc_name}] Lỗi: {e}"
                logger.error(err_msg)
                all_summaries.append(err_msg)
            finally:
                await context.close()

            # Nghỉ giữa các tài khoản nếu còn tài khoản tiếp theo
            if i < len(active_accounts) - 1:
                logger.info(f"Nghỉ {acc_delay_sec} giây trước khi chuyển sang tài khoản tiếp theo...")
                await asyncio.sleep(acc_delay_sec)

        final_msg = " | ".join(all_summaries)
        current_bot_state["last_run_time"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        current_bot_state["last_status"] = final_msg
        logger.info(f"🎉 TỔNG KẾT TÁC VỤ: {final_msg}")
        return True, final_msg

    except Exception as e:
        err_msg = f"Lỗi tổng quát: {e}"
        logger.error(err_msg)
        current_bot_state["last_status"] = err_msg
        return False, err_msg
    finally:
        current_bot_state["is_running"] = False
        if playwright:
            try:
                await playwright.stop()
            except Exception:
                pass


# ==========================================
# QUẢN LÝ ĐĂNG NHẬP MÃ QR TRỰC TIẾP TRÊN WEB
# ==========================================
qr_login_state = {
    "is_active": False,
    "acc_id": None,
    "acc_name": "",
    "qr_base64": None,
    "status": "idle",
    "message": ""
}

_active_qr_context = None
_active_qr_playwright = None


async def cancel_qr_login():
    """Hủy phiên quét mã QR hiện tại."""
    global _active_qr_context, _active_qr_playwright
    qr_login_state["is_active"] = False
    qr_login_state["status"] = "cancelled"
    qr_login_state["message"] = "Đã hủy phiên đăng nhập."
    qr_login_state["qr_base64"] = None
    if _active_qr_context:
        try:
            await _active_qr_context.close()
        except Exception:
            pass
        _active_qr_context = None
    if _active_qr_playwright:
        try:
            await _active_qr_playwright.stop()
        except Exception:
            pass
        _active_qr_playwright = None


async def start_qr_login(acc_id="acc_1"):
    """Khởi tạo phiên lấy mã QR TikTok trực tiếp trên Web."""
    global _active_qr_context, _active_qr_playwright

    # Nếu đang có phiên khác thì hủy trước
    await cancel_qr_login()

    acc_name = "Tài khoản 2" if acc_id == "acc_2" else "Tài khoản 1"
    qr_login_state["is_active"] = True
    qr_login_state["acc_id"] = acc_id
    qr_login_state["acc_name"] = acc_name
    qr_login_state["status"] = "loading"
    qr_login_state["message"] = f"Đang kết nối TikTok và tải mã QR cho [{acc_name}]..."
    qr_login_state["qr_base64"] = None

    logger.info(f"Bắt đầu khởi tạo phiên quét mã QR Web cho [{acc_name}]...")

    async def _qr_runner():
        global _active_qr_context, _active_qr_playwright
        p_dir = get_profile_dir(acc_id)
        try:
            _active_qr_playwright = await async_playwright().start()
            chan = get_browser_channel()
            launch_args = {
                "user_data_dir": str(p_dir),
                "headless": True,
                "viewport": {"width": 1280, "height": 800},
                "args": ["--disable-blink-features=AutomationControlled", "--no-sandbox"],
                "locale": "vi-VN"
            }
            if chan:
                launch_args["channel"] = chan

            _active_qr_context = await _active_qr_playwright.chromium.launch_persistent_context(**launch_args)
            page = _active_qr_context.pages[0] if _active_qr_context.pages else await _active_qr_context.new_page()

            await page.goto("https://www.tiktok.com/login/qrcode", wait_until="domcontentloaded", timeout=45000)
            
            # Chờ phần tử canvas QR code
            canvas = None
            for _ in range(25):
                if not qr_login_state["is_active"]:
                    return
                c = page.locator("canvas")
                if await c.count() > 0:
                    canvas = c.first
                    break
                await asyncio.sleep(0.5)

            if not canvas:
                # Nếu không tìm thấy canvas, thử chụp vùng container QR
                qr_cont = page.locator('div[class*="qrcode" i], div[data-e2e="qrcode"]')
                if await qr_cont.count() > 0:
                    canvas = qr_cont.first

            if not canvas:
                raise RuntimeError("Không tìm thấy mã QR trên trang TikTok. Vui lòng thử lại.")

            # Chụp ảnh mã QR và mã hóa base64
            await asyncio.sleep(1)
            img_bytes = await canvas.screenshot()
            b64_str = base64.b64encode(img_bytes).decode("utf-8")
            qr_login_state["qr_base64"] = f"data:image/png;base64,{b64_str}"
            qr_login_state["status"] = "waiting_scan"
            qr_login_state["message"] = f"Đã có mã QR! Mở TikTok trên điện thoại quét mã để đăng nhập [{acc_name}]."
            logger.info(f"Đã tạo thành công mã QR cho [{acc_name}]. Đang chờ quét mã...")

            # Vòng lặp chờ người dùng quét mã trên điện thoại (tối đa 3 phút)
            for _ in range(180):
                if not qr_login_state["is_active"]:
                    return
                try:
                    cookies = await _active_qr_context.cookies()
                    has_session = any(c.get("name") in ["sessionid", "sessionid_ss", "sid_guard", "uid_tt"] for c in cookies)
                except Exception:
                    has_session = False

                cur_url = page.url.lower()
                if has_session or ("tiktok.com" in cur_url and "login" not in cur_url and "about:blank" not in cur_url):
                    logger.info(f"🎉 Phát hiện đăng nhập thành công cho [{acc_name}]!")
                    qr_login_state["status"] = "success"
                    qr_login_state["message"] = f"✅ Đã đăng nhập và lưu phiên [{acc_name}] thành công!"
                    await asyncio.sleep(2.5)
                    break
                await asyncio.sleep(1)

        except Exception as err:
            logger.error(f"Lỗi phiên QR [{acc_name}]: {err}")
            qr_login_state["status"] = "error"
            qr_login_state["message"] = f"Lỗi: {err}"
        finally:
            qr_login_state["is_active"] = False
            if _active_qr_context:
                try:
                    await _active_qr_context.close()
                except Exception:
                    pass
                _active_qr_context = None
            if _active_qr_playwright:
                try:
                    await _active_qr_playwright.stop()
                except Exception:
                    pass
                _active_qr_playwright = None

    asyncio.create_task(_qr_runner())
    return {"status": "ok", "message": f"Đang khởi tạo mã QR cho [{acc_name}]..."}


async def confirm_qr_login():
    """Người dùng bấm nút 'Đã quét QR' trên giao diện để chốt phiên và lưu ngay lập tức."""
    global _active_qr_context, _active_qr_playwright
    acc_name = qr_login_state.get("acc_name", "Tài khoản")
    logger.info(f"Người dùng bấm nút xác nhận 'Đã quét QR' cho [{acc_name}]. Đang chốt lưu phiên...")

    await asyncio.sleep(1.5)
    qr_login_state["status"] = "success"
    qr_login_state["message"] = f"✅ Đã lưu phiên đăng nhập [{acc_name}] thành công!"
    qr_login_state["is_active"] = False

    if _active_qr_context:
        try:
            await _active_qr_context.close()
        except Exception:
            pass
        _active_qr_context = None

    if _active_qr_playwright:
        try:
            await _active_qr_playwright.stop()
        except Exception:
            pass
        _active_qr_playwright = None

    return {"status": "ok", "message": f"Đã lưu phiên đăng nhập [{acc_name}] thành công!"}


