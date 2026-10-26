from pydantic import BaseModel


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
