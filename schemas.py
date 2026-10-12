from pydantic import BaseModel
from typing import Optional

class SensorData(BaseModel):
    pond_type: str
    suhu: float
    do: float
    ph: float
    tds: float
    v_ph: float = 0.0
    v_tds: float = 0.0
    # --- TAMBAHAN VARIABEL FUZZY ---
    rule_aktif: str = "-"
    pakan_gram: float = 0.0
    lbl_suhu: str = "-"
    lbl_do: str = "-"
    lbl_ph: str = "-"
    lbl_tds: str = "-"

class ServoCommand(BaseModel):
    action: str  # "none", "open", "close", "feed"
    duration: int = 0

# Variabel global untuk menyimpan antrean perintah
current_command = {"action": "none", "duration": 0}

# Skema Baru
class CalibrationConfig(BaseModel):
    offset_suhu: float
    ph_401: float
    ph_686: float
    ph_918: float
    tds_k: float
    feeder_g_per_s: float  # Tambahan untuk kalibrasi servo

class FeedingLog(BaseModel):
    pond_type: str
    target_pakan: Optional[float] = None
    jumlah_pakan: float
    durasi_servo: int
    status: str
    suhu: float = 0.0
    do: float = 0.0
    ph: float = 0.0
    tds: float = 0.0

class SamplingInput(BaseModel):
    minggu_ke: int
    kolam: str
    berat_awal: float
    berat_akhir: float
    jumlah_pakan: float

class ServoCommand(BaseModel):
    action: str
    duration: int = 0