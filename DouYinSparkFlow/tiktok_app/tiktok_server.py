import asyncio
import os
import sys
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse, JSONResponse
from fastapi.templating import Jinja2Templates
import uvicorn

# Thêm đường dẫn project vào sys.path để import chuẩn
current_dir = Path(__file__).resolve().parent
parent_dir = current_dir.parent
if str(parent_dir) not in sys.path:
    sys.path.insert(0, str(parent_dir))

from tiktok_app.logger import get_logger, get_recent_logs
from tiktok_app.tiktok_config import load_config, save_config
from tiktok_app.tiktok_bot import (
    check_login_status,
    current_bot_state,
    get_tiktok_friends,
    open_login_window,
    send_tiktok_messages,
    start_qr_login,
    cancel_qr_login,
    qr_login_state,
)
from tiktok_app.tiktok_scheduler import run_scheduler_loop, scheduler_state

logger = get_logger()
templates = Jinja2Templates(directory=str(current_dir / "templates"))


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Khởi động scheduler ngầm khi server bật
    scheduler_task = asyncio.create_task(run_scheduler_loop())
    logger.info("🚀 Web Server TikTok SparkFlow đã khởi động tại cổng 8787.")
    yield
    scheduler_task.cancel()
    logger.info("🛑 Web Server đã tắt.")


app = FastAPI(title="TikTok SparkFlow VN", lifespan=lifespan)


@app.get("/", response_class=HTMLResponse)
async def index_page(request: Request):
    return templates.TemplateResponse(request, "index.html")


@app.get("/api/status")
async def get_status():
    is_logged_1 = await check_login_status("acc_1")
    is_logged_2 = await check_login_status("acc_2")
    cfg = load_config()
    return JSONResponse({
        "is_logged_in": is_logged_1,
        "is_logged_in_acc1": is_logged_1,
        "is_logged_in_acc2": is_logged_2,
        "scheduler": scheduler_state,
        "bot_state": current_bot_state,
        "config": cfg
    })


@app.post("/api/login/open")
async def api_open_login(acc_id: str = "acc_1"):
    res = await open_login_window(acc_id)
    return JSONResponse(res)


@app.post("/api/login/qr/start")
async def api_start_qr_login(acc_id: str = "acc_1"):
    res = await start_qr_login(acc_id)
    return JSONResponse(res)


@app.get("/api/login/qr/status")
async def api_get_qr_status():
    return JSONResponse(qr_login_state)


@app.post("/api/login/qr/cancel")
async def api_cancel_qr_login():
    await cancel_qr_login()
    return JSONResponse({"status": "ok", "message": "Đã hủy phiên quét mã QR."})


@app.post("/api/test-send")
async def api_test_send(acc_id: str | None = None):
    if current_bot_state["is_running"]:
        return JSONResponse({"status": "busy", "message": "Bot đang bận thực hiện gửi tin nhắn."})
    
    # Chạy tác vụ gửi tin ngầm
    asyncio.create_task(send_tiktok_messages(target_acc_id=acc_id))
    target_text = "tất cả tài khoản" if not acc_id else ("Tài khoản 2" if acc_id == "acc_2" else "Tài khoản 1")
    return JSONResponse({"status": "ok", "message": f"Đã bắt đầu gửi thử cho [{target_text}]! Hãy xem tiến trình trong Live Logs."})


@app.post("/api/config")
async def api_save_config(request: Request):
    data = await request.json()
    cfg = load_config()
    cfg.update(data)
    save_config(cfg)
    logger.info("Đã lưu cấu hình đa tài khoản thành công.")
    return JSONResponse({"status": "ok", "message": "Đã lưu cấu hình thành công!"})


@app.get("/api/logs")
async def api_get_logs():
    return JSONResponse({"logs": get_recent_logs(100)})


@app.get("/api/friends")
async def api_get_friends(acc_id: str = "acc_1"):
    friends = await get_tiktok_friends(acc_id)
    return JSONResponse({"friends": friends, "acc_id": acc_id})


def run_app(host="0.0.0.0", port=8787):
    uvicorn.run(app, host=host, port=port)


if __name__ == "__main__":
    run_app(host="0.0.0.0", port=8787)
