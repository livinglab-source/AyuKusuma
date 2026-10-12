from sqlalchemy import Column, Integer, Float, String
from database import Base

class SamplingDB(Base):
    __tablename__ = "sampling_fcr"
    id = Column(Integer, primary_key=True, index=True)
    minggu_ke = Column(Integer)
    kolam = Column(String)  # 'Perlakuan (A)' atau 'Kontrol (Timer)'
    berat_awal = Column(Float)
    berat_akhir = Column(Float)
    jumlah_pakan = Column(Float)
    fcr = Column(Float)

class CalibrationDB(Base):
    __tablename__ = "calibration"
    id = Column(Integer, primary_key=True, index=True)
    offset_suhu = Column(Float, default=0.25)
    ph_401 = Column(Float, default=1.4638)
    ph_686 = Column(Float, default=1.7832)
    ph_918 = Column(Float, default=1.9691)
    tds_k = Column(Float, default=1.0)
    feeder_g_per_s = Column(Float, default=15.0)  # Default 15 gram/detik