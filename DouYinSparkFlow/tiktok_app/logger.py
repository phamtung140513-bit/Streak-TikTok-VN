import collections
import logging
import os
from datetime import datetime
from pathlib import Path

LOG_DIR = Path(__file__).resolve().parent.parent / "logs"
LOG_DIR.mkdir(parents=True, exist_ok=True)
LOG_FILE = LOG_DIR / "tiktok_sparkflow.log"

MAX_MEMORY_LOGS = 200
log_buffer = collections.deque(maxlen=MAX_MEMORY_LOGS)


class MemoryLogHandler(logging.Handler):
    def emit(self, record):
        try:
            msg = self.format(record)
            log_buffer.append({
                "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                "level": record.levelname,
                "message": msg
            })
        except Exception:
            pass


def get_logger():
    logger = logging.getLogger("tiktok_flow")
    if not logger.handlers:
        logger.setLevel(logging.INFO)
        formatter = logging.Formatter("[%(asctime)s] [%(levelname)s] %(message)s", "%Y-%m-%d %H:%M:%S")

        # Console handler
        ch = logging.StreamHandler()
        ch.setFormatter(formatter)
        logger.addHandler(ch)

        # File handler
        fh = logging.FileHandler(str(LOG_FILE), encoding="utf-8")
        fh.setFormatter(formatter)
        logger.addHandler(fh)

        # Memory handler
        mh = MemoryLogHandler()
        mh.setFormatter(formatter)
        logger.addHandler(mh)

    return logger


def get_recent_logs(limit=100):
    return list(log_buffer)[-limit:]

