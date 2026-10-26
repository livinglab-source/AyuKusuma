"""
Endpoint khusus perangkat ESP32 — seluruh endpoint wajib header X-Device-Key.
Keamanan dipasang sekali di level router (dependencies=[...]).
"""
from fastapi import APIRouter, Depends

from app.core.security import verify_device_token
from app.schemas.command import ServoCommandAckInput
from app.schemas.feeding_log import DeviceFeedingLogInput
from app.services import command_service, device_service, log_service

router = APIRouter(
    prefix="/api/device",
    tags=["ESP32 Device"],
    dependencies=[Depends(verify_device_token)],
)


@router.post("/feeding-log")
def add_device_feeding_log(data: DeviceFeedingLogInput):
    """(Perangkat Terautentikasi) Menyimpan log pemberian pakan dari ESP32 ke Firestore"""
    device_service.mark_device_seen()
    event_id = log_service.save_device_feeding_log(data)
    return {"status": "success", "message": "Feeding log perangkat berhasil dicatat di Firestore", "event_id": event_id}


@router.get("/servo-command")
def get_device_servo_command():
    """(Perangkat Terautentikasi) Mengambil perintah servo pending untuk ESP32"""
    device_service.mark_device_seen()
    return command_service.get_pending_command_for_device()


@router.post("/servo-command/ack")
def ack_device_servo_command(ack: ServoCommandAckInput):
    """(Perangkat Terautentikasi) Mengonfirmasi eksekusi perintah servo agar tidak dieksekusi berulang"""
    device_service.mark_device_seen()
    return command_service.acknowledge_command(ack)
