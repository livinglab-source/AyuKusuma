from typing import Optional

from pydantic import BaseModel, Field, field_validator


class FeedingLog(BaseModel):
    """Payload log pakan dari Web Dashboard / ESP32 (endpoint POST /api/feeding-log)"""
    pond_type: str
    target_pakan: Optional[float] = None
    jumlah_pakan: float = Field(..., ge=0.0)
    durasi_servo: int = Field(default=0, ge=0, le=60)
    status: str = "Berhasil"
    suhu: float = 0.0
    do: float = 0.0
    ph: float = 0.0
    tds: float = 0.0
    event_id: Optional[str] = None
    timestamp: Optional[str] = None


class DeviceFeedingLogInput(BaseModel):
    """Payload ketat khusus ESP32 terautentikasi (endpoint POST /api/device/feeding-log)"""
    pond_type: str
    target_pakan: Optional[float] = 0.0
    jumlah_pakan: float = Field(..., ge=0.0)
    durasi_servo: int = Field(default=0, ge=0, le=60)
    status: str = "Berhasil"
    suhu: float = Field(..., ge=-10.0, le=60.0)
    do: float = Field(default=6.0, ge=0.0, le=25.0)
    ph: float = Field(..., ge=0.0, le=14.0)
    tds: float = Field(..., ge=0.0, le=5000.0)
    event_id: Optional[str] = None
    timestamp: Optional[str] = None

    @field_validator("pond_type")
    @classmethod
    def validate_pond_type(cls, v: str) -> str:
        clean = v.strip().lower()
        if "adm" in clean or "perlakuan" in clean:
            return "adm"
        elif "timer" in clean or "kontrol" in clean:
            return "kontrol"
        raise ValueError("Pond type harus 'adm' atau 'kontrol'")

    @field_validator("status")
    @classmethod
    def validate_status(cls, v: str) -> str:
        clean = v.strip()
        allowed = ["Berhasil", "Gagal", "Timeout", "Error", "Sukses", "success", "failed"]
        if clean.lower() not in [a.lower() for a in allowed]:
            raise ValueError(f"Status '{v}' tidak valid. Harus salah satu dari: Berhasil, Gagal, Timeout, Error")
        return "Berhasil" if clean.lower() in ["berhasil", "sukses", "success"] else clean.capitalize()
