"""
Pelacakan status kehadiran (online/offline) perangkat ESP32.

State disimpan di memori proses (in-memory). Setiap request dari ESP32
memanggil `mark_device_seen()` sehingga dashboard dapat menampilkan status online.
"""
import socket
from datetime import datetime, timezone
from typing import Optional

from app.core.config import settings

_last_esp32_poll_time: Optional[datetime] = None


def mark_device_seen() -> None:
    """Mencatat waktu terakhir ESP32 menghubungi backend"""
    global _last_esp32_poll_time
    _last_esp32_poll_time = datetime.now(timezone.utc)


def get_presence() -> dict:
    """Mengembalikan status online ESP32 dan jeda sejak polling terakhir"""
    now = datetime.now(timezone.utc)
    is_online = False
    diff_sec = None
    if _last_esp32_poll_time:
        diff_sec = (now - _last_esp32_poll_time).total_seconds()
        is_online = diff_sec <= settings.ESP32_ONLINE_THRESHOLD_SEC
    return {
        "is_esp32_online": is_online,
        "seconds_since_last_poll": round(diff_sec, 1) if diff_sec is not None else None,
    }


def get_local_ip() -> str:
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return "127.0.0.1"
