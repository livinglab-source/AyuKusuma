"""
Logika pencatatan & pembacaan feeding log (Cloud Firestore: feeding_logs).
"""
import uuid
from datetime import datetime, timezone

from fastapi import HTTPException
from google.cloud import firestore as g_firestore

from app.core.firebase import db, COL_FEEDING_LOGS
from app.schemas.feeding_log import FeedingLog, DeviceFeedingLogInput


def _new_event_id(event_id: str = None) -> str:
    return event_id or f"log-{uuid.uuid4().hex[:12]}"


def _format_timestamp(ts):
    """Mengubah timestamp Firestore menjadi (string tampilan, string ISO-8601)"""
    ts_str = "-"
    ts_iso = None
    if ts:
        if hasattr(ts, "isoformat"):
            ts_iso = ts.isoformat()
            ts_str = ts.strftime("%d/%m/%Y %H:%M:%S")
        elif hasattr(ts, "to_datetime"):
            dt = ts.to_datetime()
            ts_iso = dt.isoformat()
            ts_str = dt.strftime("%d/%m/%Y %H:%M:%S")
        elif isinstance(ts, str):
            ts_iso = ts
            ts_str = ts
        else:
            ts_str = str(ts)
    return ts_str, ts_iso


def list_feeding_logs(limit: int = 100) -> list:
    """Membaca riwayat feeding log terbaru dari Firestore"""
    results = []
    try:
        docs = db.collection(COL_FEEDING_LOGS).order_by(
            "timestamp", direction=g_firestore.Query.DESCENDING
        ).limit(limit).stream()
        for doc in docs:
            d = doc.to_dict()
            ts_str, ts_iso = _format_timestamp(d.get("timestamp"))
            pond_type_label = "Perlakuan (ADM)" if d.get("pond_type") == "adm" else "Kontrol (Timer)"
            results.append({
                "key": ts_iso if ts_iso else doc.id,
                "id": doc.id,
                "timestamp": ts_str,
                "timestamp_iso": ts_iso,
                "pondType": pond_type_label,
                "suhu": round(float(d.get("suhu", 0.0)), 1),
                "do": round(float(d.get("do", 6.0)), 1),
                "ph": round(float(d.get("ph", 0.0)), 1),
                "tds": int(float(d.get("tds", 0.0))),
                "targetPakan": f"{d.get('target_pakan')}%" if d.get("pond_type") == "adm" else "-",
                "jumlahPakan": float(d.get("jumlah_pakan", 0.0)),
                "durasi": int(d.get("durasi_servo", 0)),
                "status": d.get("status", "Berhasil")
            })
    except Exception as e:
        print(f"[FIRESTORE GET LOGS ERROR]: {e}")
    return results


def save_feeding_log(data: FeedingLog, caller: dict) -> str:
    """Menyimpan feeding log dari Admin Dashboard maupun ESP32. Mengembalikan event_id."""
    now = datetime.now(timezone.utc)
    event_id = _new_event_id(data.event_id)

    is_admin = caller.get("role") == "admin"
    source = "web-dashboard" if is_admin else "esp32"
    recorded_by = caller.get("sub", "admin" if is_admin else "esp32")

    try:
        db.collection(COL_FEEDING_LOGS).document(event_id).set({
            "event_id": event_id,
            "pond_type": "adm" if "adm" in data.pond_type.lower() else "kontrol",
            "target_pakan": float(data.target_pakan if data.target_pakan else 0.0),
            "jumlah_pakan": float(data.jumlah_pakan),
            "durasi_servo": int(data.durasi_servo),
            "status": data.status,
            "suhu": float(data.suhu),
            "do": float(data.do),
            "ph": float(data.ph),
            "tds": float(data.tds),
            "timestamp": now,
            "source": source,
            "recorded_by": recorded_by
        })
    except Exception as e:
        print(f"[FIRESTORE ADD LOG ERROR]: {e}")
        raise HTTPException(status_code=500, detail=f"Gagal mencatat feeding log di Firestore: {e}")
    return event_id


def save_device_feeding_log(data: DeviceFeedingLogInput) -> str:
    """Menyimpan feeding log dari ESP32 terautentikasi. Mengembalikan event_id."""
    now = datetime.now(timezone.utc)
    event_id = _new_event_id(data.event_id)

    try:
        db.collection(COL_FEEDING_LOGS).document(event_id).set({
            "event_id": event_id,
            "pond_type": data.pond_type,
            "target_pakan": float(data.target_pakan or 0.0),
            "jumlah_pakan": float(data.jumlah_pakan),
            "durasi_servo": int(data.durasi_servo),
            "status": data.status,
            "suhu": float(data.suhu),
            "do": float(data.do),
            "ph": float(data.ph),
            "tds": float(data.tds),
            "timestamp": now,
            "source": "esp32"
        })
    except Exception as e:
        print(f"[FIRESTORE DEVICE LOG ERROR]: {e}")
        raise HTTPException(status_code=500, detail=f"Gagal mencatat log perangkat di Firestore: {e}")
    return event_id
