"""
Logika perhitungan FCR otomatis & penyimpanan sampling (Cloud Firestore: sampling_fcr).
"""
from datetime import datetime, timezone, timedelta

from fastapi import HTTPException

from app.core.firebase import db, COL_FEEDING_LOGS, COL_SAMPLING_FCR
from app.schemas.sampling import SamplingInput

_SUCCESS_STATUSES = ["Berhasil", "success", "SUCCESS", None]


def _is_adm(text: str) -> bool:
    t = str(text or "").lower()
    return "adm" in t or "perlakuan" in t


def _to_datetime(ts):
    """Normalisasi timestamp Firestore / string ISO menjadi datetime aware (UTC)"""
    if hasattr(ts, "to_datetime"):
        dt = ts.to_datetime()
    elif isinstance(ts, datetime):
        dt = ts
    elif isinstance(ts, str):
        try:
            dt = datetime.fromisoformat(ts.replace("Z", "+00:00"))
        except Exception:
            return None
    else:
        return None
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt


def _parse_range(tgl_mulai: str, tgl_akhir: str):
    try:
        t_start = datetime.fromisoformat(tgl_mulai.replace("Z", "+00:00"))
        t_end = datetime.fromisoformat(tgl_akhir.replace("Z", "+00:00"))
    except Exception:
        try:
            t_start = datetime.strptime(tgl_mulai[:10], "%Y-%m-%d").replace(tzinfo=timezone.utc)
            t_end = datetime.strptime(tgl_akhir[:10], "%Y-%m-%d").replace(tzinfo=timezone.utc) + timedelta(days=1)
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Format rentang tanggal tidak valid: {e}")
    return t_start, t_end


def _sum_adm_feed_in_range(t_start: datetime, t_end: datetime) -> float:
    """Total pakan ADM yang berhasil dalam rentang [t_start, t_end)"""
    total_pakan = 0.0
    seen_ids = set()
    try:
        for doc in db.collection(COL_FEEDING_LOGS).stream():
            d = doc.to_dict()
            if not _is_adm(d.get("pond_type", "")):
                continue
            if doc.id in seen_ids:
                continue
            if d.get("status") not in _SUCCESS_STATUSES:
                continue
            ts = d.get("timestamp")
            if not ts:
                continue
            dt = _to_datetime(ts)
            if dt is None:
                continue
            # Rentang [t_start, t_end) (awal inklusif, akhir eksklusif)
            if t_start <= dt < t_end:
                seen_ids.add(doc.id)
                total_pakan += float(d.get("jumlah_pakan", 0.0))
    except Exception as fe:
        print(f"[FIRESTORE FCR QUERY ERROR]: {fe}")
    return total_pakan


def _sum_adm_feed_all() -> float:
    """Total pakan dari seluruh log ADM yang berhasil"""
    total_pakan = 0.0
    try:
        for doc in db.collection(COL_FEEDING_LOGS).stream():
            d = doc.to_dict()
            if _is_adm(d.get("pond_type", "")) and d.get("status") in _SUCCESS_STATUSES:
                total_pakan += float(d.get("jumlah_pakan", 0.0))
    except Exception as fe:
        print(f"[FIRESTORE FCR ALL LOGS ERROR]: {fe}")
    return total_pakan


def hitung_fcr_otomatis(data: SamplingInput):
    """Menghitung FCR = total pakan / pertambahan biomassa. Return (total_pakan, selisih, fcr)."""
    selisih_biomassa = data.berat_akhir - data.berat_awal
    if selisih_biomassa <= 0:
        raise HTTPException(
            status_code=400,
            detail=f"Pertambahan biomassa nol atau negatif ({round(selisih_biomassa, 2)} gram). Nilai FCR tidak dapat dihitung."
        )

    if _is_adm(data.kolam):
        # Kolam ADM: hitung total pakan otomatis dari feeding_logs di Cloud Firestore
        if data.tgl_mulai and data.tgl_akhir:
            t_start, t_end = _parse_range(data.tgl_mulai, data.tgl_akhir)
            total_pakan = _sum_adm_feed_in_range(t_start, t_end)
        elif data.jumlah_pakan is not None and data.jumlah_pakan > 0:
            total_pakan = float(data.jumlah_pakan)
        else:
            # Rentang tanggal belum diisi: ambil seluruh log ADM yang berhasil
            total_pakan = _sum_adm_feed_all()
    else:
        # Kolam Kontrol: Total pakan diisi secara manual oleh admin
        if data.jumlah_pakan is None or data.jumlah_pakan <= 0:
            raise HTTPException(status_code=400, detail="Untuk kolam kontrol, jumlah pakan aktual (gram) wajib diisi dan bernilai positif.")
        total_pakan = float(data.jumlah_pakan)

    if total_pakan <= 0:
        raise HTTPException(status_code=400, detail="Total pakan terakumulasi 0 gram. Belum ada feeding log valid pada periode yang dipilih.")

    nilai_fcr = round(total_pakan / selisih_biomassa, 2)
    return total_pakan, selisih_biomassa, nilai_fcr


def list_sampling() -> list:
    """Membaca evaluasi sampling FCR dari Firestore"""
    results = []
    try:
        docs = db.collection(COL_SAMPLING_FCR).order_by("minggu_ke").stream()
        for doc in docs:
            d = doc.to_dict()
            results.append({
                "id": doc.id,
                "minggu_ke": int(d.get("minggu_ke", 0)),
                "kolam": d.get("kolam", "Perlakuan (A)"),
                "berat_awal": float(d.get("berat_awal", 0.0)),
                "berat_akhir": float(d.get("berat_akhir", 0.0)),
                "jumlah_pakan": float(d.get("jumlah_pakan", 0.0)),
                "fcr": float(d.get("fcr", 0.0)),
                "start_date": d.get("start_date") or d.get("tgl_mulai"),
                "end_date": d.get("end_date") or d.get("tgl_akhir")
            })
    except Exception as e:
        print(f"[FIRESTORE GET SAMPLING ERROR]: {e}")
    return results


def save_sampling(data: SamplingInput, created_by: str) -> dict:
    """Menghitung FCR lalu menyimpan hasil sampling ke Firestore"""
    total_pakan, selisih_biomassa, nilai_fcr = hitung_fcr_otomatis(data)
    now = datetime.now(timezone.utc)
    doc_id = f"fcr-m{data.minggu_ke}-{data.kolam.replace(' ', '_').lower()}"

    sampling_doc = {
        "minggu_ke": data.minggu_ke,
        "kolam": data.kolam,
        "berat_awal": float(data.berat_awal),
        "berat_akhir": float(data.berat_akhir),
        "selisih_biomassa": float(selisih_biomassa),
        "jumlah_pakan": float(total_pakan),
        "fcr": float(nilai_fcr),
        "start_date": data.tgl_mulai,
        "end_date": data.tgl_akhir,
        "created_at": now,
        "created_by": created_by
    }

    try:
        db.collection(COL_SAMPLING_FCR).document(doc_id).set(sampling_doc)
    except Exception as e:
        print(f"[FIRESTORE SAMPLING SAVE ERROR]: {e}")
        raise HTTPException(status_code=500, detail=f"Gagal menyimpan data sampling ke Firestore: {e}")

    return {
        "status": "success",
        "message": f"Data sampling minggu ke-{data.minggu_ke} ({data.kolam}) berhasil dihitung & disimpan di Firestore",
        "fcr": nilai_fcr,
        "total_pakan": total_pakan,
        "selisih_biomassa": selisih_biomassa
    }
