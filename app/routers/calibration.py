from fastapi import APIRouter, Depends

from app.core.security import get_current_admin
from app.schemas.calibration import CalibrationConfig
from app.services import calibration_service, device_service

router = APIRouter(prefix="/api/calibration", tags=["Calibration"])


@router.get("")
def get_calibration():
    """(Publik) Membaca parameter kalibrasi sensor & jadwal pakan dari Firestore"""
    device_service.mark_device_seen()  # ESP32 juga melakukan polling endpoint ini
    return calibration_service.get_calibration_config()


@router.post("")
def update_calibration(data: CalibrationConfig, admin: dict = Depends(get_current_admin)):
    """(Admin) Mengubah parameter kalibrasi sensor & jadwal pakan di Firestore, wajib menyertakan Bearer Token valid"""
    calibration_service.update_calibration(data, updated_by=admin.get("sub", "admin"))
    return {"status": "success", "message": "Kalibrasi berhasil diperbarui di Cloud Firestore"}
