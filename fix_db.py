import sqlite3

# PASTIKAN NAMA DATABASE SESUAI DENGAN YANG ADA DI database.py (misal: smartfeeder.db)
db_name = 'smartfeeder.db' 

try:
    conn = sqlite3.connect(db_name)
    cursor = conn.cursor()
    cursor.execute("ALTER TABLE calibration ADD COLUMN feeder_g_per_s FLOAT DEFAULT 15.0;")
    conn.commit()
    conn.close()
    print("BERHASIL! Kolom 'feeder_g_per_s' telah ditambahkan tanpa menghapus data lama.")
except Exception as e:
    print("ERROR:", e)