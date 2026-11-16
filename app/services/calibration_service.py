"""
Logika kalibrasi sensor & jadwal pakan (Cloud Firestore: settings/calibration & settings/calibration_kontrol).
"""
from datetime import datetime, timezone

from fastapi import HTTPException

from app.core.firebase import db, COL_SETTINGS, DOC_CALIBRATION, DOC_CALIBRATION_KONTROL
from app.schemas.calibration import CalibrationConfig

DEFAULT_CALIBRATION_ADM = {
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

DEFAULT_CALIBRATION_KONTROL = {
    "offset_suhu": 0.0,
    "ph_401": 1.6500,
    "ph_686": 2.0300,
    "ph_918": 2.1000,
    "tds_k": 1.0,
    "feeder_g_per_s": 0.0,
    "jam_pakan_1": 9,
    "menit_pakan_1": 0,
    "jam_pakan_2": 16,
    "menit_pakan_2": 0,
}

# Alias kompatibilitas
DEFAULT_CALIBRATION = DEFAULT_CALIBRATION_ADM


def resolve_calibration_pond(pond_type: str = "adm") -> str:
    """Menormalisasi parameter pond_type menjadi 'kontrol' atau 'adm'."""
    clean = (pond_type or "adm").strip().lower()
    if clean in ("kontrol", "kolam_a", "kolam-a", "a", "timer") or "kontrol" in clean or "kolam_a" in clean:
        return "kontrol"
    return "adm"


def _defaults_for(pond_key: str) -> dict:
    return DEFAULT_CALIBRATION_KONTROL if pond_key == "kontrol" else DEFAULT_CALIBRATION_ADM


class CalibrationData:
    def __init__(self, offset_suhu=0.25, ph_401=1.4638, ph_686=1.7832, ph_918=1.9691, tds_k=1.0, feeder_g_per_s=15.0):
        self.offset_suhu = offset_suhu
        self.ph_401 = ph_401
        self.ph_686 = ph_686
        self.ph_918 = ph_918
        self.tds_k = tds_k
        self.feeder_g_per_s = feeder_g_per_s


def _calibration_ref(pond_type: str = "adm"):
    pond_key = resolve_calibration_pond(pond_type)
    doc_id = DOC_CALIBRATION_KONTROL if pond_key == "kontrol" else DOC_CALIBRATION
    return db.collection(COL_SETTINGS).document(doc_id)


def get_calibration_params(pond_type: str = "adm") -> CalibrationData:
    """Membaca parameter kalibrasi dari Cloud Firestore (dipakai perhitungan sensor)"""
    pond_key = resolve_calibration_pond(pond_type)
    defaults = _defaults_for(pond_key)
    try:
        doc = _calibration_ref(pond_key).get()
        if doc.exists:
            d = doc.to_dict()
            return CalibrationData(
                offset_suhu=float(d.get("offset_suhu", defaults["offset_suhu"])),
                ph_401=float(d.get("ph_401", defaults["ph_401"])),
                ph_686=float(d.get("ph_686", defaults["ph_686"])),
                ph_918=float(d.get("ph_918", defaults["ph_918"])),
                tds_k=float(d.get("tds_k", defaults["tds_k"])),
                feeder_g_per_s=float(d.get("feeder_g_per_s", defaults["feeder_g_per_s"])),
            )
    except Exception as e:
        print(f"[FIRESTORE CALIBRATION READ ERROR ({pond_key})]: {e}")
    return CalibrationData(
        offset_suhu=defaults["offset_suhu"],
        ph_401=defaults["ph_401"],
        ph_686=defaults["ph_686"],
        ph_918=defaults["ph_918"],
        tds_k=defaults["tds_k"],
        feeder_g_per_s=defaults["feeder_g_per_s"],
    )


def get_calibration_config(pond_type: str = "adm") -> dict:
    """Membaca konfigurasi kalibrasi + jadwal pakan lengkap (respons GET /api/calibration)"""
    pond_key = resolve_calibration_pond(pond_type)
    defaults = _defaults_for(pond_key)
    try:
        doc = _calibration_ref(pond_key).get()
        if doc.exists:
            d = doc.to_dict()
            return {
                "pond_type": pond_key,
                "offset_suhu": float(d.get("offset_suhu", defaults["offset_suhu"])),
                "ph_401": float(d.get("ph_401", defaults["ph_401"])),
                "ph_686": float(d.get("ph_686", defaults["ph_686"])),
                "ph_918": float(d.get("ph_918", defaults["ph_918"])),
                "tds_k": float(d.get("tds_k", defaults["tds_k"])),
                "feeder_g_per_s": float(d.get("feeder_g_per_s", defaults["feeder_g_per_s"])),
                "jam_pakan_1": int(d.get("jam_pakan_1", defaults["jam_pakan_1"])),
                "menit_pakan_1": int(d.get("menit_pakan_1", defaults["menit_pakan_1"])),
                "jam_pakan_2": int(d.get("jam_pakan_2", defaults["jam_pakan_2"])),
                "menit_pakan_2": int(d.get("menit_pakan_2", defaults["menit_pakan_2"])),
                "updated_at": str(d.get("updated_at", "")),
            }
    except Exception as e:
        print(f"[FIRESTORE GET CALIBRATION ERROR ({pond_key})]: {e}")

    return {"pond_type": pond_key, **defaults, "updated_at": ""}


def update_calibration(data: CalibrationConfig, updated_by: str, pond_type: str = "adm") -> None:
    """Menyimpan parameter kalibrasi & jadwal pakan ke Firestore"""
    pond_key = resolve_calibration_pond(pond_type)
    now = datetime.now(timezone.utc)
    try:
        _calibration_ref(pond_key).set({
            "pond_type": pond_key,
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
        print(f"[FIRESTORE UPDATE CALIBRATION ERROR ({pond_key})]: {e}")
        raise HTTPException(status_code=500, detail=f"Gagal menyimpan ke Firestore: {e}")
