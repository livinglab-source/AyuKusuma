"""
Konfigurasi aplikasi yang dibaca dari file .env.

Seluruh variabel environment dikumpulkan di satu tempat agar lapisan lain
cukup melakukan `from app.core.config import settings`.
"""
import os
from pathlib import Path

from dotenv import load_dotenv

# Root proyek (folder yang berisi .env dan secrets/)
PROJECT_ROOT = Path(__file__).resolve().parents[2]
load_dotenv(PROJECT_ROOT / ".env")


class Settings:
    APP_TITLE: str = "Smart Feeder API - Living Lab with Pure Cloud Firestore"

    # Konfigurasi Gateway Raspi (Research Data Gateway)
    GATEWAY_API_BASE_URL: str = os.getenv("GATEWAY_API_BASE_URL", "http://127.0.0.1:18088")
    GATEWAY_DATASET_ID: str = os.getenv("GATEWAY_DATASET_ID", "dst_c2afd87da8491d4c")
    GATEWAY_API_KEY: str = os.getenv("GATEWAY_API_KEY")
    GATEWAY_TIMEOUT_SEC: int = 20

    # Masa berlaku cache telemetry (sensor mengirim data tiap 30 detik)
    SENSOR_LATEST_CACHE_TTL: float = 10.0
    SENSOR_HISTORY_CACHE_TTL: float = 30.0

    # Admin & Device Security
    JWT_SECRET: str = os.getenv("JWT_SECRET", "smartfeeder_super_secret_jwt_key_livinglab_2026_bali_secure_key")
    JWT_ALGORITHM: str = "HS256"
    JWT_EXPIRE_HOURS: int = 24
    ADMIN_USERNAME: str = os.getenv("ADMIN_USERNAME", "admin")
    ADMIN_PASSWORD: str = os.getenv("ADMIN_PASSWORD", "admin_livinglab_2026!")
    DEVICE_API_KEY: str = os.getenv("DEVICE_API_KEY", "sf-esp32-livinglab-device-key-2026")

    # ESP32 dianggap online jika polling terakhir <= N detik
    ESP32_ONLINE_THRESHOLD_SEC: int = 15

    # Firebase service account
    SECRETS_DIR: Path = PROJECT_ROOT / "secrets"


settings = Settings()
