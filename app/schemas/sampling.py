from typing import Optional

from pydantic import BaseModel, Field


class SamplingInput(BaseModel):
    minggu_ke: int = Field(..., ge=1, le=52)
    kolam: str
    berat_awal: float = Field(..., gt=0)
    berat_akhir: float = Field(..., gt=0)
    jumlah_pakan: Optional[float] = Field(default=None, ge=0)
    tgl_mulai: Optional[str] = None
    tgl_akhir: Optional[str] = None
