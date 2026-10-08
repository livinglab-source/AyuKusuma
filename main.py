from fastapi import FastAPI, Depends
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy.orm import Session
from influxdb_client import Point

# Impor dari modul lokal
from database import engine, Base, get_db, write_api, query_api, INFLUX_BUCKET, INFLUX_ORG, influx_client
import models
import schemas

# Buat tabel SQLite secara otomatis saat server berjalan
models.Base.metadata.create_all(bind=engine)

app = FastAPI(title="Smart Feeder API - Living Lab")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], 
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# --- 1. ENDPOINT KESEHATAN ---
@app.get("/api/health/influxdb")
def check_influxdb():
    health = influx_client.ping()
    if health:
        return {"status": "success", "message": "Berhasil terhubung ke InfluxDB!"}
    return {"status": "error", "message": "Gagal terhubung ke InfluxDB"}

# --- 2. ENDPOINT SENSOR ---
@app.post("/api/sensor")
def add_sensor_data(data: schemas.SensorData):
    point = (
        Point("kualitas_air")
        .tag("pond_type", data.pond_type)
        .field("suhu", data.suhu)
        .field("do", data.do)
        .field("ph", data.ph)
        .field("tds", data.tds)
    )
    write_api.write(bucket=INFLUX_BUCKET, org=INFLUX_ORG, record=point)
    return {"status": "success", "message": "Data sensor berhasil disimpan"}

@app.get("/api/sensor/latest/{pond_type}")
def get_latest_sensor(pond_type: str):
    query = f"""
    from(bucket: "{INFLUX_BUCKET}")
      |> range(start: -1h)
      |> filter(fn: (r) => r["_measurement"] == "kualitas_air")
      |> filter(fn: (r) => r["pond_type"] == "{pond_type}")
      |> last()
    """
    tables = query_api.query(query, org=INFLUX_ORG)
    
    result = {}
    for table in tables:
        for record in table.records:
            result[record.get_field()] = record.get_value()
            
    if not result:
        return {"status": "empty", "message": "Belum ada data sensor"}
    return {"status": "success", "data": result}

# --- 3. ENDPOINT FEEDING LOG ---
@app.post("/api/feeding-log")
def add_feeding_log(data: schemas.FeedingLog):
    point = (
        Point("feeding_events")
        .tag("pond_type", data.pond_type)
        .tag("status", data.status)
        .field("target_pakan", data.target_pakan if data.target_pakan else 0.0)
        .field("jumlah_pakan", data.jumlah_pakan)
        .field("durasi_servo", data.durasi_servo)
        .field("suhu", data.suhu)
        .field("do", data.do)
        .field("ph", data.ph)
        .field("tds", data.tds)
    )
    write_api.write(bucket=INFLUX_BUCKET, org=INFLUX_ORG, record=point)
    return {"status": "success", "message": "Feeding log berhasil dicatat"}

@app.get("/api/feeding-log")
def get_feeding_logs():
    query = f"""
    from(bucket: "{INFLUX_BUCKET}")
      |> range(start: -7d)
      |> filter(fn: (r) => r["_measurement"] == "feeding_events")
      |> pivot(rowKey:["_time"], columnKey: ["_field"], valueColumn: "_value")
      |> sort(columns: ["_time"], desc: true)
    """
    try:
        tables = query_api.query(query, org=INFLUX_ORG)
        results = []
        for table in tables:
            for record in table.records:
                results.append({
                    "key": str(record.get_time()), 
                    "timestamp": record.get_time().strftime("%d/%m/%Y %H:%M:%S"),
                    "pondType": "Perlakuan (ADM)" if record.values.get("pond_type") == "adm" else "Kontrol (Timer)",
                    "suhu": round(record.values.get("suhu", 0), 1),
                    "do": round(record.values.get("do", 0), 1),
                    "ph": round(record.values.get("ph", 0), 1),
                    "tds": int(record.values.get("tds", 0)),
                    "targetPakan": f"{record.values.get('target_pakan', 0)}%" if record.values.get("pond_type") == "adm" else "-",
                    "jumlahPakan": record.values.get("jumlah_pakan"),
                    "durasi": record.values.get("durasi_servo"),
                    "status": record.values.get("status")
                })
        return {"status": "success", "data": results}
    except Exception as e:
        return {"status": "error", "message": str(e)}

# --- 4. ENDPOINT SAMPLING FCR ---
@app.post("/api/sampling")
def add_sampling(data: schemas.SamplingInput, db: Session = Depends(get_db)):
    selisih_biomassa = data.berat_akhir - data.berat_awal
    nilai_fcr = 0.0
    if selisih_biomassa > 0:
        nilai_fcr = round(data.jumlah_pakan / selisih_biomassa, 2)

    db_sampling = models.SamplingDB(
        minggu_ke=data.minggu_ke,
        kolam=data.kolam,
        berat_awal=data.berat_awal,
        berat_akhir=data.berat_akhir,
        jumlah_pakan=data.jumlah_pakan,
        fcr=nilai_fcr
    )
    db.add(db_sampling)
    db.commit()
    db.refresh(db_sampling)
    return {"status": "success", "message": "Data sampling berhasil disimpan", "fcr": nilai_fcr}

@app.get("/api/sampling")
def get_sampling(db: Session = Depends(get_db)):
    records = db.query(models.SamplingDB).order_by(models.SamplingDB.minggu_ke.asc()).all()
    return {"status": "success", "data": records}