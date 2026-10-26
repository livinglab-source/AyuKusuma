from typing import Optional

from pydantic import BaseModel


class CalibrationConfig(BaseModel):
    offset_suhu: float
    ph_401: float
    ph_686: float
    ph_918: float
    tds_k: float
    feeder_g_per_s: float = 15.0  # Kalibrasi gram/detik servo
    jam_pakan_1: Optional[int] = 9
    menit_pakan_1: Optional[int] = 0
    jam_pakan_2: Optional[int] = 16
    menit_pakan_2: Optional[int] = 0
