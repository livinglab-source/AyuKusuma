"""
Logika pembacaan telemetry dari Research Data Gateway (Raspberry Pi),
kalibrasi sensor dinamis, downsampling grafik, dan cache in-memory.
"""
import time
from datetime import datetime, timezone, timedelta

import requests

from app.core.config import settings
from app.services.calibration_service import CalibrationData, get_calibration_params
from app.services.fuzzy_service import hitung_status_fuzzy

# Cache in-memory untuk telemetry Gateway (menghemat query SSH tunnel & mencegah timeout)
_sensor_latest_cache = {"timestamp": 0.0, "response": None}
_sensor_history_cache = {}  # key: f"{pond_type}_{hours}_{downsample}" -> {"timestamp": 0.0, "response": None}

EMPTY_HISTORY = {"suhu": [], "do": [], "ph": [], "tds": []}


def _gateway_metrics_url(page: int, page_size: int) -> str:
    return (
        f"{settings.GATEWAY_API_BASE_URL}/api/v1/external/datasets/{settings.GATEWAY_DATASET_ID}"
        f"/telemetry/metrics?page={page}&page_size={page_size}&sort=desc"
    )


def _gateway_headers() -> dict:
    return {"X-API-Key": settings.GATEWAY_API_KEY}


def hitung_kalibrasi_sensor(
    raw_suhu: float,
    v_ph: float,
    v_tds: float,
    cal: CalibrationData,
    fallback_ph: float = None,
    fallback_tds: float = None
):
    offset_suhu = float(cal.offset_suhu) if cal and cal.offset_suhu is not None else 0.25

    # 1. Kalibrasi Suhu (DS18B20)
    # Gateway menerima data suhu dari ESP32 dengan default offset awal 0.25.
    # Koreksi nilai suhu secara dinamis sesuai offset_suhu yang diinputkan user:
    if raw_suhu is not None and raw_suhu > 0:
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
    """Membaca telemetry terbaru dari Gateway lalu menerapkan kalibrasi & fuzzy"""
    now_ts = time.time()
    # Cache hit valid selama 10 detik (sensor kirim data tiap 30 detik)
    if _sensor_latest_cache["response"] and (now_ts - _sensor_latest_cache["timestamp"] < settings.SENSOR_LATEST_CACHE_TTL):
        return _sensor_latest_cache["response"]

    try:
        res = requests.get(_gateway_metrics_url(1, 1), headers=_gateway_headers(), timeout=settings.GATEWAY_TIMEOUT_SEC)
        res.raise_for_status()
        payload = res.json()

        items = payload.get("data", {}).get("items", [])
        if not items:
            return {"status": "empty", "data": {}}

        latest = items[0]
        raw_suhu = float(latest.get("suhu", 0.0))
        raw_ph = float(latest.get("ph", 0.0))
        raw_tds = float(latest.get("tds", 0.0))
        v_ph = float(latest.get("v_ph", 0.0))
        v_tds = float(latest.get("v_tds", 0.0))
        do_val = 6.0  # Standar DO

        cal = get_calibration_params()
        suhu, ph, tds = hitung_kalibrasi_sensor(
            raw_suhu, v_ph, v_tds, cal, fallback_ph=raw_ph, fallback_tds=raw_tds
        )

        fuzzy_info = hitung_status_fuzzy(suhu, do_val, ph, tds)

        result = {
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

        resp_data = {"status": "success", "data": result}
        _sensor_latest_cache["timestamp"] = time.time()
        _sensor_latest_cache["response"] = resp_data
        return resp_data
    except Exception as e:
        print(f"[GATEWAY API ERROR - LATEST]: {e}")
        # Gunakan data cache terakhir bila terjadi timeout atau gateway sibuk
        if _sensor_latest_cache["response"]:
            return _sensor_latest_cache["response"]
        return {"status": "error", "message": str(e), "data": {}}


def _fetch_raw_history(hours: int) -> list:
    """Mengambil telemetry mentah dari Gateway (maks 5 halaman / 2000 titik) dalam rentang `hours` jam"""
    all_raw_items = []
    page = 1
    page_size = 1000
    cutoff = datetime.now(timezone.utc) - timedelta(hours=hours)

    while True:
        res = requests.get(_gateway_metrics_url(page, page_size), headers=_gateway_headers(), timeout=settings.GATEWAY_TIMEOUT_SEC)
        res.raise_for_status()
        payload = res.json()
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


def _calibrate_items(all_raw_items: list) -> list:
    """Kalibrasi setiap raw item sesuai parameter kalibrasi yang diinput user"""
    cal = get_calibration_params()
    calibrated_raw_items = []
    for it in all_raw_items:
        it_suhu = float(it["suhu"]) if it.get("suhu") is not None else 0.0
        it_v_ph = float(it.get("v_ph", 0.0)) if it.get("v_ph") is not None else 0.0
        it_v_tds = float(it.get("v_tds", 0.0)) if it.get("v_tds") is not None else 0.0
        it_ph = float(it["ph"]) if it.get("ph") is not None else 0.0
        it_tds = float(it["tds"]) if it.get("tds") is not None else 0.0

        c_suhu, c_ph, c_tds = hitung_kalibrasi_sensor(
            it_suhu, it_v_ph, it_v_tds, cal, fallback_ph=it_ph, fallback_tds=it_tds
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
    """Membaca riwayat kualitas air terkalibrasi untuk grafik dashboard"""
    cache_key = f"{pond_type}_{hours}_{downsample}"
    now_ts = time.time()
    cached = _sensor_history_cache.get(cache_key)
    # Cache hit valid selama 30 detik (sensor kirim data tiap 30 detik)
    if cached and (now_ts - cached["timestamp"] < settings.SENSOR_HISTORY_CACHE_TTL):
        return cached["response"]

    try:
        all_raw_items = _fetch_raw_history(hours)
        if not all_raw_items:
            return {"status": "success", "data": {k: [] for k in EMPTY_HISTORY}}

        all_raw_items = _calibrate_items(all_raw_items)
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

        resp_data = {"status": "success", "data": history_data}
        _sensor_history_cache[cache_key] = {"timestamp": time.time(), "response": resp_data}
        return resp_data
    except Exception as e:
        print(f"[GATEWAY API ERROR - HISTORY]: {e}")
        # Kembalikan data cache terakhir jika gateway timeout atau sibuk
        if cached:
            return cached["response"]
        return {"status": "error", "message": str(e), "data": {k: [] for k in EMPTY_HISTORY}}
