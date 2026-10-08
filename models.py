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