"""
Ringkasan dashboard: data sensor terkalibrasi + estimasi toksisitas amonia (NH3).
"""
from app.services.sensor_service import get_latest_sensor


def hitung_kadar_nh3(suhu, ph):
    if suhu is None or ph is None:
        return {"kadar_nh3": "-", "status": "Data Tidak Lengkap"}
    try:
        suhu = float(suhu)
        ph = float(ph)
        pKa = 0.09018 + (2729.92 / (suhu + 273.15))
        fraksi = 1 / (10 ** (pKa - ph) + 1)
        nh3_persen = fraksi * 100

        if nh3_persen < 1: status = "Sangat Rendah"
        elif nh3_persen <= 3: status = "Aman"
        elif nh3_persen <= 5: status = "Waspada"
        else: status = "Bahaya / Mematikan"

        return {"kadar_nh3": f"{round(nh3_persen, 2)}%", "status": status}
    except Exception:
        return {"kadar_nh3": "-", "status": "Data Tidak Lengkap"}


def get_dashboard_summary(pond_type: str = "adm") -> dict:
    sensor_res = get_latest_sensor(pond_type)
    if sensor_res.get("status") != "success":
        return {
            "status": "empty",
            "message": sensor_res.get("message", "Belum ada data sensor"),
            "kadar_nh3": "-",
            "status_nh3": "Data Tidak Tersedia"
        }

    data_sensor = sensor_res.get("data", {})
    hasil_nh3 = hitung_kadar_nh3(data_sensor.get("suhu"), data_sensor.get("ph"))

    return {
        "status": "success",
        "kadar_nh3": hasil_nh3["kadar_nh3"],
        "status_nh3": hasil_nh3["status"],
        "status_toksisitas": hasil_nh3["status"],
        "data": {
            **data_sensor,
            "kadar_nh3": hasil_nh3["kadar_nh3"],
            "status_nh3": hasil_nh3["status"]
        }
    }
