import asyncio
from datetime import datetime, timedelta

from tiktok_app.logger import get_logger
from tiktok_app.tiktok_bot import send_tiktok_messages
from tiktok_app.tiktok_config import load_config

logger = get_logger()

scheduler_state = {
    "is_active": False,
    "last_run_date": None,
    "next_run_display": "Đang tính toán..."
}


def calculate_next_run(send_time_str):
    try:
        hour, minute = map(int, send_time_str.split(":"))
        now = datetime.now()
        target_today = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
        if target_today <= now:
            target_next = target_today + timedelta(days=1)
        else:
            target_next = target_today
        return target_next.strftime("%Y-%m-%d %H:%M:%S")
    except Exception:
        return "Không xác định"


async def run_scheduler_loop():
    """Vòng lặp hẹn giờ chạy ngầm."""
    scheduler_state["is_active"] = True
    logger.info("⏰ Bộ lập lịch gửi tin TikTok đã khởi động.")

    while True:
        try:
            config = load_config()
            enabled = config.get("enabled", True)
            send_time = config.get("send_time", "05:00").strip()

            scheduler_state["next_run_display"] = calculate_next_run(send_time)

            if enabled:
                now = datetime.now()
                current_time_str = now.strftime("%H:%M")
                today_str = now.strftime("%Y-%m-%d")

                # Kiểm tra nếu khớp giờ và hôm nay chưa chạy
                if current_time_str == send_time and scheduler_state["last_run_date"] != today_str:
                    logger.info(f"🔔 ĐÚNG GIỜ HẸN ({send_time})! Bắt đầu tiến trình gửi tin nhắn...")
                    scheduler_state["last_run_date"] = today_str
                    try:
                        success, message = await send_tiktok_messages()
                        logger.info(f"Kết quả tác vụ đúng giờ: {message}")
                    except Exception as ex:
                        logger.error(f"Lỗi khi thực hiện tác vụ lập lịch: {ex}")

        except Exception as e:
            logger.error(f"Lỗi trong vòng lặp scheduler: {e}")

        # Kiểm tra lại sau mỗi 20 giây
        await asyncio.sleep(20)

