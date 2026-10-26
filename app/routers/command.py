from fastapi import APIRouter, Depends

from app.core.security import get_current_admin, get_caller_admin_or_device
from app.schemas.command import ServoCommand
from app.services import command_service, device_service

router = APIRouter(prefix="/api/command", tags=["Servo Command"])


@router.post("")
def set_command(cmd: ServoCommand, admin: dict = Depends(get_current_admin)):
    """(Admin) Mengirim perintah servo unik ke Firestore control/servo_command & memori antrean"""
    return command_service.create_command(cmd, requested_by=admin.get("sub", "admin"))


@router.get("")
def get_command():
    """(ESP32 / Publik) Membaca perintah servo terkini dari memori antrean"""
    device_service.mark_device_seen()
    return command_service.get_current_command()


@router.post("/clear")
def clear_command(caller: dict = Depends(get_caller_admin_or_device)):
    """(Admin / Device) Mengosongkan antrean perintah servo"""
    device_service.mark_device_seen()
    command_service.clear_command()
    return {"status": "success"}


@router.get("/status")
def get_command_status():
    """(Publik) Status antrean servo & status online ESP32"""
    return {
        "status": "success",
        "current_command": command_service.get_current_command(),
        **device_service.get_presence(),
        "local_ip": device_service.get_local_ip(),
    }
