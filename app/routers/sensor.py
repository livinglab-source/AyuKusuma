from fastapi import APIRouter

from app.services import sensor_service, dashboard_service

router = APIRouter(tags=["Sensor & Dashboard"])


@router.get("/api/sensor/latest/{pond_type}")
def get_latest_sensor(pond_type: str = "adm"):
    """(Publik) Membaca telemetry mentah Gateway dan menerapkan kalibrasi dinamis"""
    return sensor_service.get_latest_sensor(pond_type)


@router.get("/api/sensor/history/{pond_type}")
def get_sensor_history(pond_type: str, hours: int = 24, downsample: bool = True):
    """(Publik) Membaca riwayat kualitas air dan mengkalibrasi seluruh data point"""
    return sensor_service.get_sensor_history(pond_type, hours, downsample)


@router.get("/api/dashboard/adm")
@router.get("/api/dashboard/{pond_type}")
@router.get("/api/dashboard")
def get_dashboard(pond_type: str = "adm"):
    """(Publik) Membaca ringkasan kualitas air, fuzzy ADM, dan toksisitas amonia kolam"""
    return dashboard_service.get_dashboard_summary(pond_type)
