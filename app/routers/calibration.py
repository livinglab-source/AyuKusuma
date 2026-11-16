from fastapi import APIRouter, Depends

from app.core.security import get_current_admin
from app.schemas.calibration import CalibrationConfig
from app.services import calibration_service, device_service, sensor_service

router = APIRouter(prefix="/api/calibration", tags=["Calibration"])


@router.get("")
@router.get("/{pond_type}")
def get_calibration(pond_type: str = "adm"):
    """(Publik) Membaca parameter kalibrasi sensor & jadwal pakan dari Firestore berdasarkan pond_type"""
    pond_key = calibration_service.resolve_calibration_pond(pond_type)
    if pond_key == "adm":
        device_service.mark_device_seen()  # ESP32 Kolam B melakukan polling endpoint ini
    return calibration_service.get_calibration_config(pond_key)


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
