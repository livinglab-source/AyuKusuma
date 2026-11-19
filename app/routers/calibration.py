from typing import Optional
from fastapi import APIRouter, Depends, Header, Request

from app.core.security import get_current_admin
from app.schemas.calibration import CalibrationConfig
from app.services import calibration_service, device_service, sensor_service

router = APIRouter(prefix="/api/calibration", tags=["Calibration"])


@router.get("")
@router.get("/{pond_type}")
def get_calibration(
    request: Request,
    pond_type: str = "adm",
    x_device_key: Optional[str] = Header(default=None, alias="X-Device-Key"),
):
    """(Publik / ESP32) Membaca parameter kalibrasi sensor & jadwal pakan dari Firestore berdasarkan pond_type"""
    pond_key = calibration_service.resolve_calibration_pond(pond_type)
    ua = (request.headers.get("user-agent") or "").lower()
    if x_device_key or "esp32" in ua or "arduino" in ua:
        device_service.mark_device_seen()
        calibration_service.mark_calibration_synced(pond_key)
    cfg = calibration_service.get_calibration_config(pond_key)
    cfg["local_ip"] = device_service.get_local_ip()
    return cfg


@router.post("")
@router.post("/{pond_type}")
def update_calibration(
    data: CalibrationConfig,
    pond_type: str = "adm",
    admin: dict = Depends(get_current_admin),
):
    """(Admin) Mengubah parameter kalibrasi sensor & jadwal pakan di Firestore, wajib menyertakan Bearer Token valid"""
    pond_key = calibration_service.resolve_calibration_pond(pond_type)
    calibration_service.update_calibration(data, updated_by=admin.get("sub", "admin"), pond_type=pond_key)
    sensor_service.invalidate_sensor_cache(pond_key)
    return {
        "status": "success",
        "pond_type": pond_key,
        "message": f"Kalibrasi {('Kolam A (Kontrol)' if pond_key == 'kontrol' else 'Kolam B (ADM)')} berhasil diperbarui di Cloud Firestore",
    }
