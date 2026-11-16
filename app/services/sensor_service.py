"""
Logika pembacaan telemetry dari Research Data Gateway (Raspberry Pi),
kalibrasi sensor dinamis, downsampling grafik, dan cache in-memory.
"""
import socket
import time
from datetime import datetime, timezone, timedelta

import requests
import urllib3.util.connection as urllib3_conn

from app.core.config import settings
from app.services.calibration_service import CalibrationData, get_calibration_params
from app.services.fuzzy_service import hitung_status_fuzzy

# Paksa IPv4 (AF_INET) agar koneksi ke Cloudflare (research-data-gateway.myact.my.id)
# tidak mengalami ConnectTimeout akibat percobaan IPv6 pada jaringan lokal Windows.
urllib3_conn.allowed_gai_family = lambda: socket.AF_INET

# Cache in-memory untuk telemetry Gateway per kolam (menghemat query & mencegah timeout)
_sensor_latest_cache = {}   # key: f"{pond_key}_{dataset_id}" -> {"timestamp": 0.0, "response": None}
_sensor_history_cache = {}  # key: f"{pond_key}_{dataset_id}_{hours}_{downsample}" -> {"timestamp": 0.0, "response": None}

EMPTY_HISTORY = {"suhu": [], "do": [], "ph": [], "tds": []}

# Pemetaan dinamis parameter kolam ke ID dataset Research Data Gateway:
# - Kolam A (Kontrol) : dst_fde703a09fb3cb06
# - Kolam B (ADM)     : dst_1e6020ea929def09
POND_DATASET_MAP = {
    "kontrol": settings.GATEWAY_DATASET_KOLAM_A,
    "kolam_a": settings.GATEWAY_DATASET_KOLAM_A,
    "kolam-a": settings.GATEWAY_DATASET_KOLAM_A,
    "a": settings.GATEWAY_DATASET_KOLAM_A,
    "timer": settings.GATEWAY_DATASET_KOLAM_A,
    "adm": settings.GATEWAY_DATASET_KOLAM_B,
    "perlakuan": settings.GATEWAY_DATASET_KOLAM_B,
    "kolam_b": settings.GATEWAY_DATASET_KOLAM_B,
    "kolam-b": settings.GATEWAY_DATASET_KOLAM_B,
    "b": settings.GATEWAY_DATASET_KOLAM_B,
}


def resolve_pond_dataset(pond_type: str = "adm") -> tuple[str, str]:
    """Menentukan (normalized_pond_type, dataset_id) secara dinamis berdasarkan parameter pond_type."""
    clean = (pond_type or "adm").strip().lower()
    if clean in ("kontrol", "kolam_a", "kolam-a", "a", "timer") or "kontrol" in clean or "kolam_a" in clean:
        return "kontrol", POND_DATASET_MAP["kontrol"]
    return "adm", POND_DATASET_MAP["adm"]


def _gateway_metrics_url(page: int, page_size: int, dataset_id: str = None) -> str:
    target_dataset = dataset_id or settings.GATEWAY_DATASET_KOLAM_B
    return (
        f"{settings.GATEWAY_API_BASE_URL}/api/v1/external/datasets/{target_dataset}"
        f"/telemetry/metrics?page={page}&page_size={page_size}&sort=desc"
    )


def _gateway_headers(pond_key: str = "adm") -> dict:
    if pond_key == "kontrol":
        api_key = settings.GATEWAY_API_KEY_KOLAM_A or settings.GATEWAY_API_KEY
    else:
        api_key = settings.GATEWAY_API_KEY_KOLAM_B or settings.GATEWAY_API_KEY
    return {
        "X-API-Key": api_key,
        "Accept": "application/json",
        "User-Agent": "curl/8.7.1",
        "Connection": "close",
    }


def _gateway_get_json(page: int, page_size: int, dataset_id: str, pond_key: str, sort: str = "desc") -> dict:
    """
    Memanggil endpoint telemetry/metrics di Research Data Gateway berdasarkan dataset_id kolam.
    """
    url = (
        f"{settings.GATEWAY_API_BASE_URL}/api/v1/external/datasets/{dataset_id}"
        f"/telemetry/metrics?page={page}&page_size={page_size}&sort={sort}"
    )
    last_err = None
    for _ in range(2):
        try:
            res = requests.get(
                url,
                headers=_gateway_headers(pond_key),
                timeout=(6, 15),
            )
            if res.status_code == 200:
                return res.json()
            last_err = f"HTTP {res.status_code}: {res.text[:200]}"
        except Exception as e:
            last_err = str(e)

    raise RuntimeError(last_err or f"Gagal mengambil data dataset {dataset_id}")


def invalidate_sensor_cache(pond_type: str = None) -> None:
    """Menghapus cache telemetri agar perubahan kalibrasi langsung terlihat di dashboard & grafik."""
    if pond_type is None:
        _sensor_latest_cache.clear()
        _sensor_history_cache.clear()
        return

    pond_key, _ = resolve_pond_dataset(pond_type)
    for k in [k for k in _sensor_latest_cache if k.startswith(f"{pond_key}_")]:
        _sensor_latest_cache.pop(k, None)
    for k in [k for k in _sensor_history_cache if k.startswith(f"{pond_key}_")]:
        _sensor_history_cache.pop(k, None)


def hitung_kalibrasi_sensor(
    raw_suhu: float,
    v_ph: float,
    v_tds: float,
    cal: CalibrationData,
    fallback_ph: float = None,
    fallback_tds: float = None,
    pond_type: str = "adm",
):
    default_offset = 0.0 if pond_type == "kontrol" else 0.25
    offset_suhu = float(cal.offset_suhu) if cal and cal.offset_suhu is not None else default_offset

    # 1. Kalibrasi Suhu (DS18B20)
    # Kolam B (adm) mengirim data suhu dengan default offset awal 0.25; Kolam A (kontrol) mengirim suhu mentah.
    if raw_suhu is not None and raw_suhu > 0 and pond_type == "adm":
        suhu_kalibrasi = round((float(raw_suhu) - 0.25) + offset_suhu, 1)
    else:
        suhu_kalibrasi = round(float(raw_suhu) + offset_suhu, 1) if raw_suhu is not None else 25.0

    # 2. Kalibrasi pH
    # Dihitung dari v_ph (tegangan raw probe pH) dengan kurva interpolasi 3-titik (buffer 4.01, 6.86, 9.18)
    # serta faktor kompensasi suhu air aktual
    ph_kalibrasi = fallback_ph
    if v_ph is not None and v_ph > 0 and cal:
        ph_401 = float(cal.ph_401) if cal.ph_401 is not None else 1.4638
        ph_686 = float(cal.ph_686) if cal.ph_686 is not None else 1.7832
        ph_918 = float(cal.ph_918) if cal.ph_918 is not None else 1.9691

        faktor_suhu = (suhu_kalibrasi + 273.15) / 298.15
        if v_ph < ph_686:
            if ph_686 != ph_401:
                slope_acid = ((6.86 - 4.01) / (ph_686 - ph_401)) * faktor_suhu
                ph_val = 6.86 + (slope_acid * (v_ph - ph_686))
            else:
                ph_val = 6.86
        else:
            if ph_918 != ph_686:
                slope_base = ((9.18 - 6.86) / (ph_918 - ph_686)) * faktor_suhu
                ph_val = 6.86 + (slope_base * (v_ph - ph_686))
            else:
                ph_val = 6.86
        ph_kalibrasi = round(max(0.0, min(14.0, ph_val)), 2)
    elif fallback_ph is not None:
        ph_kalibrasi = round(float(fallback_ph), 2)

    # 3. Kalibrasi TDS
    # Dihitung dari v_tds (tegangan raw probe TDS) dengan kompensasi suhu aktual dan faktor pengali tds_k
    tds_kalibrasi = fallback_tds
    if v_tds is not None and v_tds > 0 and cal:
        tds_k = float(cal.tds_k) if cal.tds_k is not None else 1.0
        temp_coef = 1.0 + 0.02 * (suhu_kalibrasi - 25.0)
        v_comp = v_tds / temp_coef if temp_coef != 0 else v_tds
        raw_tds = (133.42 * (v_comp ** 3)) - (255.86 * (v_comp ** 2)) + (857.39 * v_comp)
        tds_val = max(raw_tds * tds_k, 0.0)
        tds_kalibrasi = round(tds_val, 0)
    elif fallback_tds is not None:
        tds_k = float(cal.tds_k) if cal and cal.tds_k is not None else 1.0
        tds_kalibrasi = round(float(fallback_tds) * tds_k, 0)

    return suhu_kalibrasi, ph_kalibrasi, tds_kalibrasi


def get_latest_sensor(pond_type: str = "adm") -> dict:
    """Membaca telemetry terbaru dari Gateway sesuai pond_type lalu menerapkan kalibrasi & fuzzy"""
    pond_key, dataset_id = resolve_pond_dataset(pond_type)
    cache_key = f"{pond_key}_{dataset_id}"
    now_ts = time.time()
    cached = _sensor_latest_cache.get(cache_key)
    # Cache hit valid selama 10 detik (sensor kirim data tiap 30 detik)
    if cached and (now_ts - cached["timestamp"] < settings.SENSOR_LATEST_CACHE_TTL):
        return cached["response"]

    try:
        payload = _gateway_get_json(1, 1, dataset_id=dataset_id, pond_key=pond_key, sort="desc")

        items = payload.get("data", {}).get("items", [])
        if not items:
            if cached and cached.get("response"):
                return cached["response"]
            return {"status": "empty", "pond_type": pond_key, "dataset_id": dataset_id, "data": {}}

        latest = items[0]
        raw_suhu = float(latest.get("suhu") or 0.0)
        raw_ph = float(latest.get("ph") or 0.0)
        raw_tds = float(latest.get("tds") or 0.0)
        v_ph = float(latest.get("v_ph") or 0.0)
        v_tds = float(latest.get("v_tds") or 0.0)
        do_val = float(latest.get("do") or 6.0)  # Standar DO

        cal = get_calibration_params(pond_key)
        suhu, ph, tds = hitung_kalibrasi_sensor(
            raw_suhu, v_ph, v_tds, cal, fallback_ph=raw_ph, fallback_tds=raw_tds, pond_type=pond_key
        )

        fuzzy_info = hitung_status_fuzzy(suhu, do_val, ph, tds)

        result = {
            "pond_type": pond_key,
            "dataset_id": dataset_id,
            "timestamp": latest.get("timestamp"),
            "suhu": suhu,
            "do": do_val,
            "ph": ph,
            "tds": tds,
            "v_ph": v_ph,
            "v_tds": v_tds,
            "raw_suhu": raw_suhu,
            "raw_ph": raw_ph,
            "raw_tds": raw_tds,
            "feeder_g_per_s": cal.feeder_g_per_s,
            **fuzzy_info
        }

        resp_data = {"status": "success", "pond_type": pond_key, "dataset_id": dataset_id, "data": result}
        _sensor_latest_cache[cache_key] = {"timestamp": time.time(), "response": resp_data}
        return resp_data
    except Exception as e:
        print(f"[GATEWAY API ERROR - LATEST ({pond_key}/{dataset_id})]: {e}")
        # Gunakan data cache terakhir bila terjadi timeout atau gateway sibuk
        if cached and cached.get("response"):
            return cached["response"]
        return {"status": "error", "pond_type": pond_key, "dataset_id": dataset_id, "message": str(e), "data": {}}


def _fetch_raw_history(hours: int, dataset_id: str = None, pond_key: str = "adm") -> list:
    """Mengambil telemetry mentah dari Gateway dalam rentang `hours` jam"""
    all_raw_items = []
    page = 1
    page_size = 200
    cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)

    while True:
        payload = _gateway_get_json(page, page_size, dataset_id=dataset_id, pond_key=pond_key, sort="desc")
        data_block = payload.get("data", {})
        items = data_block.get("items", [])
        if not items:
            break

        reach_cutoff = False
        for it in items:
            ts_str = it.get("timestamp")
            if not ts_str:
                continue
            try:
                clean_ts = ts_str.replace("Z", "+00:00")
                ts_dt = datetime.fromisoformat(clean_ts)
                if ts_dt < cutoff:
                    reach_cutoff = True
                    break
            except Exception:
                pass
            all_raw_items.append(it)
            if len(all_raw_items) >= 1000:
                reach_cutoff = True
                break

        if reach_cutoff:
            break

        total_pages = data_block.get("total_pages", 1)
        if page >= total_pages or page >= 2:
            break
        page += 1

    return all_raw_items


def _calibrate_items(all_raw_items: list, pond_type: str = "adm") -> list:
    """Kalibrasi setiap raw item sesuai parameter kalibrasi kolam yang diminta"""
    cal = get_calibration_params(pond_type)
    calibrated_raw_items = []
    for it in all_raw_items:
        it_suhu = float(it["suhu"]) if it.get("suhu") is not None else 0.0
        it_v_ph = float(it.get("v_ph", 0.0)) if it.get("v_ph") is not None else 0.0
        it_v_tds = float(it.get("v_tds", 0.0)) if it.get("v_tds") is not None else 0.0
        it_ph = float(it["ph"]) if it.get("ph") is not None else 0.0
        it_tds = float(it["tds"]) if it.get("tds") is not None else 0.0

        c_suhu, c_ph, c_tds = hitung_kalibrasi_sensor(
            it_suhu, it_v_ph, it_v_tds, cal, fallback_ph=it_ph, fallback_tds=it_tds, pond_type=pond_type
        )

        new_it = dict(it)
        new_it["suhu"] = c_suhu
        new_it["ph"] = c_ph
        new_it["tds"] = c_tds
        calibrated_raw_items.append(new_it)
    return calibrated_raw_items


def _downsample(all_raw_items: list, latest_item_raw: dict) -> list:
    """Merata-ratakan titik data per bucket menit agar grafik ringan (>200 titik)"""
    try:
        t_first = datetime.fromisoformat(all_raw_items[0]["timestamp"].replace("Z", "+00:00"))
        t_last = datetime.fromisoformat(all_raw_items[-1]["timestamp"].replace("Z", "+00:00"))
        span_minutes = (t_last - t_first).total_seconds() / 60.0
    except Exception:
        span_minutes = 180

    if span_minutes > 720:
        bucket_min = 5
    elif span_minutes > 240:
        bucket_min = 2
    else:
        bucket_min = 1

    buckets = {}
    for it in all_raw_items:
        ts_str = it.get("timestamp")
        if not ts_str:
            continue
        try:
            dt = datetime.fromisoformat(ts_str.replace("Z", "+00:00"))
            minute_rounded = (dt.minute // bucket_min) * bucket_min
            b_dt = dt.replace(minute=minute_rounded, second=0, microsecond=0)
            b_key = b_dt.strftime("%Y-%m-%dT%H:%M:%SZ")
        except Exception:
            b_key = ts_str

        if b_key not in buckets:
            buckets[b_key] = {"suhu": [], "ph": [], "tds": []}
        if it.get("suhu") is not None:
            buckets[b_key]["suhu"].append(float(it["suhu"]))
        if it.get("ph") is not None:
            buckets[b_key]["ph"].append(float(it["ph"]))
        if it.get("tds") is not None:
            buckets[b_key]["tds"].append(float(it["tds"]))

    sampled = []
    for b_key, vals in sorted(buckets.items()):
        sampled.append({
            "timestamp": b_key,
            "suhu": round(sum(vals["suhu"]) / len(vals["suhu"]), 2) if vals["suhu"] else None,
            "ph": round(sum(vals["ph"]) / len(vals["ph"]), 2) if vals["ph"] else None,
            "tds": round(sum(vals["tds"]) / len(vals["tds"]), 2) if vals["tds"] else None,
        })

    if sampled and latest_item_raw.get("timestamp") != sampled[-1]["timestamp"]:
        sampled.append({
            "timestamp": latest_item_raw.get("timestamp"),
            "suhu": round(float(latest_item_raw.get("suhu", 0)), 2) if latest_item_raw.get("suhu") is not None else None,
            "ph": round(float(latest_item_raw.get("ph", 0)), 2) if latest_item_raw.get("ph") is not None else None,
            "tds": round(float(latest_item_raw.get("tds", 0)), 2) if latest_item_raw.get("tds") is not None else None,
        })
    return sampled


def get_sensor_history(pond_type: str, hours: int = 24, downsample: bool = True) -> dict:
    """Membaca riwayat kualitas air terkalibrasi untuk grafik dashboard sesuai pond_type"""
    pond_key, dataset_id = resolve_pond_dataset(pond_type)
    cache_key = f"{pond_key}_{dataset_id}_{hours}_{downsample}"
    now_ts = time.time()
    cached = _sensor_history_cache.get(cache_key)
    # Cache hit valid selama 30 detik (sensor kirim data tiap 30 detik)
    if cached and (now_ts - cached["timestamp"] < settings.SENSOR_HISTORY_CACHE_TTL):
        return cached["response"]

    try:
        all_raw_items = _fetch_raw_history(hours, dataset_id=dataset_id, pond_key=pond_key)
        if not all_raw_items:
            return {"status": "success", "pond_type": pond_key, "dataset_id": dataset_id, "data": {k: [] for k in EMPTY_HISTORY}}

        all_raw_items = _calibrate_items(all_raw_items, pond_type=pond_key)
        latest_item_raw = all_raw_items[0]
        all_raw_items.reverse()

        processed_items = all_raw_items
        if downsample and len(all_raw_items) > 200:
            processed_items = _downsample(all_raw_items, latest_item_raw)

        history_data = {"suhu": [], "do": [], "ph": [], "tds": []}
        for item in processed_items:
            ts = item.get("timestamp")
            if not ts:
                continue
            if item.get("suhu") is not None:
                history_data["suhu"].append({"time": ts, "value": round(float(item["suhu"]), 2)})
            if item.get("ph") is not None:
                history_data["ph"].append({"time": ts, "value": round(float(item["ph"]), 2)})
            if item.get("tds") is not None:
                history_data["tds"].append({"time": ts, "value": round(float(item["tds"]), 2)})
            history_data["do"].append({"time": ts, "value": 6.0})

        resp_data = {"status": "success", "pond_type": pond_key, "dataset_id": dataset_id, "data": history_data}
        _sensor_history_cache[cache_key] = {"timestamp": time.time(), "response": resp_data}
        return resp_data
    except Exception as e:
        print(f"[GATEWAY API ERROR - HISTORY ({pond_key}/{dataset_id})]: {e}")
        # Kembalikan data cache terakhir jika gateway timeout atau sibuk
        if cached:
            return cached["response"]
        return {"status": "error", "pond_type": pond_key, "dataset_id": dataset_id, "message": str(e), "data": {k: [] for k in EMPTY_HISTORY}}
