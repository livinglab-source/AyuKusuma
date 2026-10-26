"""
Smart Feeder Backend - Living Lab with Pure Cloud Firestore.

Titik masuk utama backend FastAPI dengan Arsitektur Berlapis (Layered Architecture).
Seluruh struktur kode dipecah modular ke dalam paket `app/`:
  - `app/routers/`   : Presentation Layer (HTTP Request & Routing)
  - `app/schemas/`   : Data Validation Layer (Pydantic DTOs)
  - `app/services/`  : Business Logic Layer (Fuzzy, FCR, Servo Queue, Kalibrasi, Sensor)
  - `app/core/`      : Data Access & Security (Firestore, .env, Auth)

Kompatibel penuh dengan:
  - `uvicorn main:app --host 0.0.0.0 --port 8000 --reload`
  - `uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload`
"""
from app.main import app

__all__ = ["app"]