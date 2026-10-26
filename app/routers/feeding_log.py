from fastapi import APIRouter, Depends

from app.core.security import get_caller_admin_or_device
from app.schemas.feeding_log import FeedingLog
from app.services import log_service, device_service

router = APIRouter(prefix="/api/feeding-log", tags=["Feeding Log"])


@router.get("")
def get_feeding_logs():
    """(Publik) Membaca riwayat feeding log dari Firestore"""
    return {"status": "success", "data": log_service.list_feeding_logs()}


@router.post("")
def add_feeding_log(data: FeedingLog, caller: dict = Depends(get_caller_admin_or_device)):
    """Pencatatan feeding log ke Firestore (dapat dipanggil Admin Dashboard React maupun perangkat ESP32)"""
    device_service.mark_device_seen()
    event_id = log_service.save_feeding_log(data, caller)
    return {"status": "success", "message": "Feeding log berhasil dicatat di Firestore", "id": event_id}
