"""
Titik masuk aplikasi FastAPI: hanya inisialisasi app, CORS, dan registrasi router.

Jalankan:  uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.core.config import settings
from app.routers import auth, sensor, calibration, feeding_log, sampling, command, device

app = FastAPI(title=settings.APP_TITLE)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(sensor.router)
app.include_router(calibration.router)
app.include_router(feeding_log.router)
app.include_router(sampling.router)
app.include_router(command.router)
app.include_router(device.router)
