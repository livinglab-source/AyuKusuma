from pydantic import BaseModel
from typing import Optional

class SensorData(BaseModel):
    pond_type: str
    suhu: float
    do: float
    ph: float
    tds: float

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