from firebase_db import db

doc = db.collection("settings").document("calibration").get()
if doc.exists:
    print("Data kalibrasi:", doc.to_dict())
else:
    print("Dokumen kalibrasi belum dibuat.")
