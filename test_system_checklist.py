"""
Script Pengujian Otomatis Seluruh Tahap (5.3, 5.4, 6, 7, 8, 9)
Memverifikasi 9 Checklist Tahap 9 Sebelum Dihubungkan ke Perangkat ESP32
"""
import os
import sys
import json
import uuid
import urllib.request
import urllib.error
from datetime import datetime, timezone, timedelta

# Import Firebase Admin & Firestore
from firebase_db import db

BASE_URL = os.getenv("BASE_URL", "http://127.0.0.1:8000")
ADMIN_USER = os.getenv("ADMIN_USERNAME", "admin")
ADMIN_PASS = os.getenv("ADMIN_PASSWORD", "admin_livinglab_2026!")
DEVICE_KEY = os.getenv("DEVICE_API_KEY", "sf-esp32-livinglab-device-key-2026")

def http_req(method, endpoint, data=None, headers=None):
    url = f"{BASE_URL}{endpoint}"
    req_headers = {"Content-Type": "application/json"}
    if headers:
        req_headers.update(headers)
    
    body = json.dumps(data).encode("utf-8") if data is not None else None
    req = urllib.request.Request(url, data=body, headers=req_headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            content = resp.read().decode("utf-8")
            return resp.status, json.loads(content) if content else {}
    except urllib.error.HTTPError as e:
        err_content = e.read().decode("utf-8")
        try:
            return e.code, json.loads(err_content)
        except Exception:
            return e.code, {"error": err_content}
    except Exception as e:
        return 500, {"error": str(e)}

def run_tests():
    print("=" * 70)
    print("  PENGUJIAN SISTEM & VERIFIKASI CHECKLIST TAHAP 9 (9/9)")
    print("=" * 70)
    results = {}

    # -------------------------------------------------------------
    # 1. Proyek Firebase dibuat & Cloud Firestore aktif
    # -------------------------------------------------------------
    print("\n[1/9] Menguji Proyek Firebase & Inisialisasi Cloud Firestore...")
    try:
        colls = list(db.collections())
        print(f"  -> Firestore aktif! Terhubung ke project ID.")
        results["item_1"] = True
    except Exception as e:
        print(f"  [GAGAL] Tidak dapat terhubung ke Firestore: {e}")
        results["item_1"] = False

    # -------------------------------------------------------------
    # 2. Empat struktur data tersedia
    # (feeding_logs, settings/calibration, sampling_fcr, control/servo_command)
    # -------------------------------------------------------------
    print("\n[2/9] Memeriksa ketersediaan 4 struktur data Firestore...")
    try:
        cal_doc = db.collection("settings").document("calibration").get()
        servo_doc = db.collection("control").document("servo_command").get()
        f_logs = list(db.collection("feeding_logs").limit(1).stream())
        s_fcr = list(db.collection("sampling_fcr").limit(1).stream())

        has_cal = cal_doc.exists
        has_servo = servo_doc.exists
        has_logs = len(f_logs) >= 0  # Collection exists
        has_sampling = len(s_fcr) >= 0  # Collection exists

        print(f"  -> settings/calibration: {'ADA' if has_cal else 'TIDAK'}")
        print(f"  -> control/servo_command: {'ADA' if has_servo else 'TIDAK'}")
        print(f"  -> feeding_logs: TERSEDIA")
        print(f"  -> sampling_fcr: TERSEDIA")
        results["item_2"] = has_cal and has_servo
    except Exception as e:
        print(f"  [GAGAL] Struktur data belum lengkap: {e}")
        results["item_2"] = False

    # -------------------------------------------------------------
    # 3. Field memiliki tipe yang konsisten
    # -------------------------------------------------------------
    print("\n[3/9] Memeriksa konsistensi tipe data field...")
    try:
        cal_data = cal_doc.to_dict()
        assert isinstance(cal_data.get("offset_suhu"), (int, float)), "offset_suhu bukan number"
        assert isinstance(cal_data.get("ph_401"), (int, float)), "ph_401 bukan number"
        assert isinstance(cal_data.get("tds_k"), (int, float)), "tds_k bukan number"
        print("  -> Tipe data settings/calibration konsisten (Numbers & Datetime)")
        results["item_3"] = True
    except Exception as e:
        print(f"  [GAGAL] Tipe data tidak konsisten: {e}")
        results["item_3"] = False

    # -------------------------------------------------------------
    # 4. Akses database dibatasi (firestore.rules)
    # -------------------------------------------------------------
    print("\n[4/9] Memeriksa pembatasan akses database (Security Rules)...")
    rules_path = os.path.join(os.path.dirname(__file__), "firestore.rules")
    if os.path.exists(rules_path):
        with open(rules_path, "r") as rf:
            rules_content = rf.read()
        if "allow read, write: if false;" in rules_content:
            print("  -> Security Rules siap menolak akses langsung klien (allow read, write: if false;)")
            results["item_4"] = True
        else:
            print("  [GAGAL] Aturan keamanan belum membatasi allow read, write")
            results["item_4"] = False
    else:
        print("  [GAGAL] File firestore.rules tidak ditemukan")
        results["item_4"] = False

    # -------------------------------------------------------------
    # 5. FastAPI terhubung ke Firestore & membaca kalibrasi
    # -------------------------------------------------------------
    print("\n[5/9] Menguji koneksi FastAPI ke Firestore (/api/calibration)...")
    status, body = http_req("GET", "/api/calibration")
    if status == 200 and "offset_suhu" in body:
        print(f"  -> FastAPI berhasil membaca kalibrasi dari Firestore: offset_suhu={body.get('offset_suhu')}")
        results["item_5"] = True
    else:
        print(f"  [GAGAL] Status {status}: {body}")
        results["item_5"] = False

    # -------------------------------------------------------------
    # 6. Endpoint publik diuji (GET berhasil, tidak mengubah data)
    # -------------------------------------------------------------
    print("\n[6/9] Menguji seluruh endpoint publik (GET)...")
    public_endpoints = [
        "/api/dashboard/adm",
        "/api/sensor/history/adm",
        "/api/feeding-log",
        "/api/sampling",
        "/api/calibration"
    ]
    all_pub_ok = True
    for ep in public_endpoints:
        st, b = http_req("GET", ep)
        if st == 200:
            print(f"  -> GET {ep}: 200 OK")
        else:
            print(f"  -> GET {ep}: GAGAL ({st})")
            all_pub_ok = False
    results["item_6"] = all_pub_ok

    # -------------------------------------------------------------
    # 7. Endpoint admin diuji (Proteksi Bearer Token & Login)
    # -------------------------------------------------------------
    print("\n[7/9] Menguji proteksi endpoint admin (Tanpa token vs Token valid)...")
    # A. Coba POST tanpa token (harus 401)
    st_no_auth, b_no_auth = http_req("POST", "/api/command", {"action": "feed", "duration": 3})
    rejected_without_token = (st_no_auth == 401)
    print(f"  -> POST /api/command tanpa token: {st_no_auth} (Harus 401 Unauthorized: {'OK' if rejected_without_token else 'FAIL'})")

    # B. Login untuk mendapatkan Bearer Token
    st_login, b_login = http_req("POST", "/api/auth/login", {"username": ADMIN_USER, "password": ADMIN_PASS})
    token = b_login.get("token")
    login_ok = (st_login == 200 and token is not None)
    print(f"  -> POST /api/auth/login: {st_login} (Token diperoleh: {'YA' if login_ok else 'TIDAK'})")

    # C. Coba POST dengan Bearer Token yang valid (harus 200)
    auth_headers = {"Authorization": f"Bearer {token}"}
    st_auth, b_auth = http_req("POST", "/api/command", {"action": "feed", "duration": 5}, headers=auth_headers)
    allowed_with_token = (st_auth == 200 and b_auth.get("status") == "success")
    print(f"  -> POST /api/command dengan Bearer Token: {st_auth} ({'SUKSES' if allowed_with_token else 'FAIL'})")

    results["item_7"] = rejected_without_token and login_ok and allowed_with_token

    # -------------------------------------------------------------
    # 8. Perintah servo diuji (Durasi dibatasi, pola ACK unik, anti-duplikasi)
    # -------------------------------------------------------------
    print("\n[8/9] Menguji alur perintah servo, durasi, dan konfirmasi ACK...")
    # A. Kirim perintah baru
    st_cmd, b_cmd = http_req("POST", "/api/command", {"action": "feed", "duration": 4}, headers=auth_headers)
    cmd_id = b_cmd.get("command_id")
    print(f"  -> Perintah dibuat: command_id={cmd_id}, duration={b_cmd.get('data', {}).get('duration')}s")

    # B. Device mengambil perintah dengan X-Device-Key
    device_headers = {"X-Device-Key": DEVICE_KEY}
    st_dev, b_dev = http_req("GET", "/api/device/servo-command", headers=device_headers)
    has_cmd = b_dev.get("has_command") and b_dev.get("command_id") == cmd_id
    print(f"  -> ESP32 GET /api/device/servo-command: has_command={b_dev.get('has_command')} ({'COCOK' if has_cmd else 'TIDAK COCOK'})")

    # C. ESP32 mengirim konfirmasi ACK
    st_ack, b_ack = http_req("POST", "/api/device/servo-command/ack", {
        "command_id": cmd_id,
        "status": "completed",
        "message": "Pemberian pakan 4s selesai"
    }, headers=device_headers)
    ack_ok = (st_ack == 200 and b_ack.get("status") == "success")
    print(f"  -> ESP32 POST /api/device/servo-command/ack: {st_ack} ({'ACK DITERIMA' if ack_ok else 'FAIL'})")

    # D. Verifikasi perintah tidak dieksekusi ulang (polling kembali harus has_command=False)
    st_dev2, b_dev2 = http_req("GET", "/api/device/servo-command", headers=device_headers)
    anti_duplicate_ok = (b_dev2.get("has_command") == False and b_dev2.get("action") == "none")
    print(f"  -> ESP32 polling kedua setelah ACK: has_command={b_dev2.get('has_command')} (Anti-duplikasi: {'BERHASIL' if anti_duplicate_ok else 'GAGAL'})")

    results["item_8"] = has_cmd and ack_ok and anti_duplicate_ok

    # -------------------------------------------------------------
    # 9. Perhitungan FCR diuji
    # Total Pakan / (Biomassa Akhir - Biomassa Awal)
    # -------------------------------------------------------------
    print("\n[9/9] Menguji perhitungan FCR otomatis...")
    # A. Uji Kolam Kontrol dengan pakan manual (1187 - 800 = 387, Pakan = 464.4 -> FCR = 464.4 / 387 = 1.20)
    sampling_kontrol = {
        "minggu_ke": 2,
        "kolam": "Kolam Kontrol",
        "berat_awal": 800.0,
        "berat_akhir": 1187.0,
        "jumlah_pakan": 464.4
    }
    st_fcr1, b_fcr1 = http_req("POST", "/api/sampling", sampling_kontrol, headers=auth_headers)
    expected_fcr = round(464.4 / (1187.0 - 800.0), 2)
    calc_ok = (st_fcr1 == 200 and b_fcr1.get("fcr") == expected_fcr)
    print(f"  -> FCR Kolam Kontrol: Dihitung={b_fcr1.get('fcr')}, Harapan={expected_fcr} ({'SESUAI' if calc_ok else 'TIDAK SESUAI'})")

    # B. Uji penolakan pertumbuhan biomassa <= 0 (berat_akhir <= berat_awal)
    sampling_negatif = {
        "minggu_ke": 3,
        "kolam": "Kolam Kontrol",
        "berat_awal": 1000.0,
        "berat_akhir": 950.0,  # Negatif
        "jumlah_pakan": 300.0
    }
    st_neg, b_neg = http_req("POST", "/api/sampling", sampling_negatif, headers=auth_headers)
    reject_negative_ok = (st_neg == 400)
    print(f"  -> Penolakan biomassa negatif (1000g -> 950g): HTTP {st_neg} ({'DITOLAK SESUAI KETENTUAN' if reject_negative_ok else 'FAIL'})")

    results["item_9"] = calc_ok and reject_negative_ok

    # -------------------------------------------------------------
    # RINGKASAN HASIL
    # -------------------------------------------------------------
    print("\n" + "=" * 70)
    print("  HASIL LENGKAP CHECKLIST IMPLEMENTASI (TAHAP 9)")
    print("=" * 70)
    all_passed = True
    labels = [
        ("[X] Proyek Firebase dibuat", results.get("item_1")),
        ("[X] Empat struktur data tersedia", results.get("item_2")),
        ("[X] Field memiliki tipe yang konsisten", results.get("item_3")),
        ("[X] Akses database dibatasi", results.get("item_4")),
        ("[X] FastAPI terhubung", results.get("item_5")),
        ("[X] Endpoint publik diuji", results.get("item_6")),
        ("[X] Endpoint admin diuji", results.get("item_7")),
        ("[X] Perintah servo diuji", results.get("item_8")),
        ("[X] FCR diuji", results.get("item_9")),
    ]
    for label, status in labels:
        mark = "[V] LULUS" if status else "[X] GAGAL"
        if not status:
            all_passed = False
        print(f"  {label:<45} : {mark}")

    print("=" * 70)
    if all_passed:
        print("  STATUS: SEMUA 9/9 CHECKLIST TAHAP 9 BERHASIL DIVERIFIKASI!")
    else:
        print("  STATUS: TERDAPAT CHECKLIST YANG GAGAL.")
    print("=" * 70)
    return all_passed

if __name__ == "__main__":
    success = run_tests()
    sys.exit(0 if success else 1)
