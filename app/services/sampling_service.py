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
    """
    Menghitung FCR berdasarkan standar biologi perikanan:
    FCR = F / (Wt + D - W0)
      F  : Total pakan yang diberikan (gram/kg)
      Wt : Biomassa / berat akhir ikan hidup (gram/kg)
      D  : Bobot ikan yang mati selama periode (gram/kg)
      W0 : Biomassa / berat awal saat tebar (gram/kg)
    Penyebut (Wt + D - W0) merupakan total pertambahan daging/biomassa riil.
    Return (total_pakan, net_biomassa, nilai_fcr).
    """
    berat_mati = float(data.berat_kematian or 0.0)
    net_biomassa = (float(data.berat_akhir) + berat_mati) - float(data.berat_awal)
    if net_biomassa <= 0:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Pertambahan biomassa plus kematian nol atau negatif "
                f"(Wt={data.berat_akhir} + D={berat_mati} - W0={data.berat_awal} = {round(net_biomassa, 2)} gram). "
                f"Nilai FCR tidak dapat dihitung."
            )
        )

    if _is_adm(data.kolam):
        # Kolam ADM: prioritaskan nilai jumlah_pakan eksplisit jika diisi/diedit oleh admin,
        # atau hitung otomatis dari feeding_logs pada rentang tanggal yang dipilih
        if data.jumlah_pakan is not None and data.jumlah_pakan > 0:
            total_pakan = float(data.jumlah_pakan)
        elif data.tgl_mulai and data.tgl_akhir:
            t_start, t_end = _parse_range(data.tgl_mulai, data.tgl_akhir)
            total_pakan = _sum_adm_feed_in_range(t_start, t_end)
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

    nilai_fcr = round(total_pakan / net_biomassa, 2)
    return total_pakan, net_biomassa, nilai_fcr


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
                "berat_kematian": float(d.get("berat_kematian", 0.0)),
                "jumlah_mati": int(d.get("jumlah_mati", 0)),
                "jumlah_pakan": float(d.get("jumlah_pakan", 0.0)),
                "selisih_biomassa": float(d.get("selisih_biomassa", 0.0)),
                "fcr": float(d.get("fcr", 0.0)),
                "start_date": d.get("start_date") or d.get("tgl_mulai"),
                "end_date": d.get("end_date") or d.get("tgl_akhir")
            })
    except Exception as e:
        print(f"[FIRESTORE GET SAMPLING ERROR]: {e}")
    return results


def save_sampling(data: SamplingInput, created_by: str, sampling_id: str = None) -> dict:
    """Menghitung FCR lalu menyimpan atau memperbarui hasil sampling ke Firestore"""
    berat_mati = float(data.berat_kematian or 0.0)
    jumlah_mati = int(data.jumlah_mati or 0)
    total_pakan, net_biomassa, nilai_fcr = hitung_fcr_otomatis(data)
    now = datetime.now(timezone.utc)
    is_target_adm = _is_adm(data.kolam)
    pond_key = "adm" if is_target_adm else "kontrol"
    doc_id = sampling_id or f"fcr-m{data.minggu_ke}-{pond_key}"

    sampling_doc = {
        "minggu_ke": data.minggu_ke,
        "kolam": pond_key,
        "berat_awal": float(data.berat_awal),
        "berat_akhir": float(data.berat_akhir),
        "berat_kematian": berat_mati,
        "jumlah_mati": jumlah_mati,
        "selisih_biomassa": float(net_biomassa),
        "jumlah_pakan": float(total_pakan),
        "fcr": float(nilai_fcr),
        "start_date": data.tgl_mulai,
        "end_date": data.tgl_akhir,
        "updated_at": now,
        "created_at": now,
        "created_by": created_by,
    }

    try:
        # Bersihkan dokumen lama pada minggu & kolam yang sama jika memiliki ID berbeda
        for existing in db.collection(COL_SAMPLING_FCR).where("minggu_ke", "==", data.minggu_ke).stream():
            ex_dict = existing.to_dict() or {}
            if _is_adm(ex_dict.get("kolam", "")) == is_target_adm and existing.id != doc_id:
                db.collection(COL_SAMPLING_FCR).document(existing.id).delete()

        # Jika mengedit dan mengubah minggu/kolam dari sampling_id awal, hapus dokumen lama
        if sampling_id and sampling_id != f"fcr-m{data.minggu_ke}-{pond_key}":
            db.collection(COL_SAMPLING_FCR).document(sampling_id).delete()
            doc_id = f"fcr-m{data.minggu_ke}-{pond_key}"

        db.collection(COL_SAMPLING_FCR).document(doc_id).set(sampling_doc)
    except Exception as e:
        print(f"[FIRESTORE SAMPLING SAVE ERROR]: {e}")
        raise HTTPException(status_code=500, detail=f"Gagal menyimpan data sampling ke Firestore: {e}")

    return {
        "status": "success",
        "id": doc_id,
        "message": f"Data sampling minggu ke-{data.minggu_ke} ({'Kolam B (ADM)' if is_target_adm else 'Kolam A (Kontrol)'}) berhasil dihitung & disimpan di Firestore",
        "fcr": nilai_fcr,
        "total_pakan": total_pakan,
        "selisih_biomassa": net_biomassa,
        "berat_kematian": berat_mati,
    }


def delete_sampling(sampling_id: str) -> dict:
    """Menghapus data sampling FCR dari Firestore berdasarkan ID dokumen"""
    try:
        db.collection(COL_SAMPLING_FCR).document(sampling_id).delete()
    except Exception as e:
        print(f"[FIRESTORE SAMPLING DELETE ERROR]: {e}")
        raise HTTPException(status_code=500, detail=f"Gagal menghapus data sampling dari Firestore: {e}")
    return {
        "status": "success",
        "id": sampling_id,
        "message": "Data sampling berhasil dihapus dari Firestore",
    }
