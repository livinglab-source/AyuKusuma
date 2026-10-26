"""
Inisialisasi koneksi Firebase Admin SDK & Cloud Firestore (Data Access Layer).
"""
import firebase_admin
from firebase_admin import credentials, firestore, auth as fb_auth  # noqa: F401  (fb_auth di-re-export)

from app.core.config import settings

# Prioritaskan serviceAccountKey.json, atau file JSON service account yang ada di secrets/
_cert_path = settings.SECRETS_DIR / "serviceAccountKey.json"
if not _cert_path.exists():
    _json_files = sorted(settings.SECRETS_DIR.glob("*.json"))
    if _json_files:
        _cert_path = _json_files[0]

if not firebase_admin._apps:
    firebase_admin.initialize_app(credentials.Certificate(str(_cert_path)))

db = firestore.client()

# Nama koleksi / dokumen Firestore (satu sumber kebenaran)
COL_SETTINGS = "settings"
DOC_CALIBRATION = "calibration"
COL_CONTROL = "control"
DOC_SERVO_COMMAND = "servo_command"
COL_FEEDING_LOGS = "feeding_logs"
COL_SAMPLING_FCR = "sampling_fcr"
