"""
Logika antrean perintah servo (Cloud Firestore: control/servo_command + cache memori).

Alur:
  1. Admin membuat perintah  -> status "pending"
  2. ESP32 mengambil perintah pending
  3. ESP32 mengirim ACK      -> status "completed" & action "none" (anti-duplikasi)
"""
import uuid
from datetime import datetime, timezone

from app.core.firebase import db, COL_CONTROL, DOC_SERVO_COMMAND
from app.schemas.command import ServoCommand, ServoCommandAckInput

_IDLE_COMMAND = {"action": "none", "duration": 0}
_current_command: dict = dict(_IDLE_COMMAND)


def _servo_ref():
    return db.collection(COL_CONTROL).document(DOC_SERVO_COMMAND)


def get_current_command() -> dict:
    return _current_command


def create_command(cmd: ServoCommand, requested_by: str) -> dict:
    """Membuat perintah servo unik dan menyimpannya ke Firestore & memori antrean"""
    global _current_command
    command_id = str(uuid.uuid4())
    duration = max(1, min(60, cmd.duration)) if cmd.action in ["feed", "open"] else 0
    now = datetime.now(timezone.utc)

    try:
        _servo_ref().set({
            "command_id": command_id,
            "action": cmd.action,
            "duration": duration,
            "status": "pending",
            "requested_by": requested_by,
            "created_at": now
        })
    except Exception as e:
        print(f"[FIRESTORE SET COMMAND ERROR]: {e}")

    _current_command = {
        "command_id": command_id,
        "action": cmd.action,
        "duration": duration,
        "status": "pending",
        "created_at": now.isoformat()
    }
    return {
        "status": "success",
        "command_id": command_id,
        "message": f"Perintah {cmd.action} (durasi {duration}s) dikirim ke antrean ESP32",
        "data": {
            "command_id": command_id,
            "action": cmd.action,
            "duration": duration,
            "status": "pending"
        }
    }


def clear_command() -> None:
    """Mengosongkan antrean perintah servo"""
    global _current_command
    _current_command = dict(_IDLE_COMMAND)
    try:
        _servo_ref().update({
            "status": "idle",
            "action": "none",
            "completed_at": datetime.now(timezone.utc)
        })
    except Exception:
        pass


def get_pending_command_for_device() -> dict:
    """Mengambil perintah servo berstatus pending untuk ESP32"""
    try:
        doc = _servo_ref().get()
        if doc.exists:
            d = doc.to_dict()
            if d.get("status") == "pending" and d.get("action") not in ["none", None]:
                return {
                    "status": "success",
                    "has_command": True,
                    "command_id": d.get("command_id"),
                    "action": d.get("action"),
                    "duration": int(d.get("duration", 0)),
                    "created_at": str(d.get("created_at"))
                }
    except Exception as e:
        print(f"[DEVICE GET COMMAND ERROR]: {e}")

    return {
        "status": "success",
        "has_command": False,
        "action": "none",
        "duration": 0
    }


def acknowledge_command(ack: ServoCommandAckInput) -> dict:
    """Konfirmasi eksekusi dari ESP32 agar perintah tidak dieksekusi berulang"""
    now = datetime.now(timezone.utc)
    try:
        doc_ref = _servo_ref()
        doc = doc_ref.get()
        if doc.exists:
            cur = doc.to_dict()
            if cur.get("command_id") == ack.command_id:
                doc_ref.update({
                    "status": ack.status,
                    "action": "none",
                    "completed_at": now,
                    "message": ack.message or "Perintah berhasil dieksekusi oleh ESP32"
                })
    except Exception as e:
        print(f"[DEVICE ACK COMMAND ERROR]: {e}")

    if _current_command.get("command_id") == ack.command_id:
        _current_command["status"] = ack.status
        _current_command["action"] = "none"

    return {"status": "success", "message": f"Perintah {ack.command_id} berhasil dikonfirmasi ({ack.status})"}
