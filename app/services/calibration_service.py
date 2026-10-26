"""
Logika kalibrasi sensor & jadwal pakan (Cloud Firestore: settings/calibration).
"""
from datetime import datetime, timezone

from fastapi import HTTPException

from app.core.firebase import db, COL_SETTINGS, DOC_CALIBRATION
from app.schemas.calibration import CalibrationConfig

DEFAULT_CALIBRATION = {
    "offset_suhu": 0.25,
    "ph_401": 1.4638,
    "ph_686": 1.7832,
    "ph_918": 1.9691,
    "tds_k": 1.0,
    "feeder_g_per_s": 15.0,
    "jam_pakan_1": 9,
    "menit_pakan_1": 0,
    "jam_pakan_2": 16,
    "menit_pakan_2": 0,
}


class CalibrationData:
    def __init__(self, offset_suhu=0.25, ph_401=1.4638, ph_686=1.7832, ph_918=1.9691, tds_k=1.0, feeder_g_per_s=15.0):
        self.offset_suhu = offset_suhu
        self.ph_401 = ph_401
        self.ph_686 = ph_686
        self.ph_918 = ph_918
        self.tds_k = tds_k
        self.feeder_g_per_s = feeder_g_per_s


def _calibration_ref():
    return db.collection(COL_SETTINGS).document(DOC_CALIBRATION)


def get_calibration_params() -> CalibrationData:
    """Membaca parameter kalibrasi dari Cloud Firestore (dipakai perhitungan sensor)"""
    try:
        doc = _calibration_ref().get()
        if doc.exists:
            d = doc.to_dict()
            return CalibrationData(
                offset_suhu=float(d.get("offset_suhu", 0.25)),
                ph_401=float(d.get("ph_401", 1.4638)),
                ph_686=float(d.get("ph_686", 1.7832)),
                ph_918=float(d.get("ph_918", 1.9691)),
                tds_k=float(d.get("tds_k", 1.0)),
                feeder_g_per_s=float(d.get("feeder_g_per_s", 15.0)),
            )
    except Exception as e:
        print(f"[FIRESTORE CALIBRATION READ ERROR]: {e}")
    return CalibrationData()


def get_calibration_config() -> dict:
    """Membaca konfigurasi kalibrasi + jadwal pakan lengkap (respons GET /api/calibration)"""
    try:
        doc = _calibration_ref().get()
        if doc.exists:
            d = doc.to_dict()
            return {
                "offset_suhu": float(d.get("offset_suhu", 0.25)),
                "ph_401": float(d.get("ph_401", 1.4638)),
                "ph_686": float(d.get("ph_686", 1.7832)),
                "ph_918": float(d.get("ph_918", 1.9691)),
                "tds_k": float(d.get("tds_k", 1.0)),
                "feeder_g_per_s": float(d.get("feeder_g_per_s", 15.0)),
                "jam_pakan_1": int(d.get("jam_pakan_1", 9)),
                "menit_pakan_1": int(d.get("menit_pakan_1", 0)),
                "jam_pakan_2": int(d.get("jam_pakan_2", 16)),
                "menit_pakan_2": int(d.get("menit_pakan_2", 0)),
                "updated_at": str(d.get("updated_at", "")),
            }
    except Exception as e:
        print(f"[FIRESTORE GET CALIBRATION ERROR]: {e}")

    return {**DEFAULT_CALIBRATION, "updated_at": ""}


def update_calibration(data: CalibrationConfig, updated_by: str) -> None:
    """Menyimpan parameter kalibrasi & jadwal pakan ke Firestore"""
    now = datetime.now(timezone.utc)
    try:
        _calibration_ref().set({
            "offset_suhu": float(data.offset_suhu),
            "ph_401": float(data.ph_401),
            "ph_686": float(data.ph_686),
            "ph_918": float(data.ph_918),
            "tds_k": float(data.tds_k),
            "feeder_g_per_s": float(data.feeder_g_per_s),
            "jam_pakan_1": int(data.jam_pakan_1 if data.jam_pakan_1 is not None else 9),
            "menit_pakan_1": int(data.menit_pakan_1 if data.menit_pakan_1 is not None else 0),
            "jam_pakan_2": int(data.jam_pakan_2 if data.jam_pakan_2 is not None else 16),
            "menit_pakan_2": int(data.menit_pakan_2 if data.menit_pakan_2 is not None else 0),
            "updated_at": now,
            "updated_by": updated_by,
        })
    except Exception as e:
        print(f"[FIRESTORE UPDATE CALIBRATION ERROR]: {e}")
        raise HTTPException(status_code=500, detail=f"Gagal menyimpan ke Firestore: {e}")
