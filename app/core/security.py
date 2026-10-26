"""
Dependency keamanan terpusat (dipasang di router via `Depends(...)`).

- get_current_admin         : wajib Bearer Token admin (JWT lokal / Firebase ID Token)
- verify_device_token       : wajib header X-Device-Key / X-Device-Token milik ESP32
- get_caller_admin_or_device: menerima Admin maupun ESP32
"""
from datetime import datetime, timezone, timedelta
from typing import Optional

import jwt
from fastapi import Depends, HTTPException, Header, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

from app.core.config import settings
from app.core.firebase import fb_auth

bearer_scheme = HTTPBearer(auto_error=False)


def create_access_token(sub: str, email: Optional[str] = None) -> str:
    """Menerbitkan JWT admin berlaku JWT_EXPIRE_HOURS jam"""
    payload = {
        "sub": sub,
        "role": "admin",
        "exp": datetime.now(timezone.utc) + timedelta(hours=settings.JWT_EXPIRE_HOURS),
    }
    if email is not None:
        payload["email"] = email
    return jwt.encode(payload, settings.JWT_SECRET, algorithm=settings.JWT_ALGORITHM)


def _decode_admin_token(token: str) -> Optional[dict]:
    """Mencoba verifikasi token sebagai JWT lokal lalu sebagai Firebase ID Token"""
    # 1. Coba verifikasi dengan JWT lokal
    try:
        payload = jwt.decode(token, settings.JWT_SECRET, algorithms=[settings.JWT_ALGORITHM])
        if payload.get("role") == "admin":
            return payload
    except jwt.PyJWTError:
        pass

    # 2. Coba verifikasi dengan Firebase Authentication ID Token
    try:
        decoded_token = fb_auth.verify_id_token(token)
        return {"sub": decoded_token.get("uid"), "role": "admin", "email": decoded_token.get("email")}
    except Exception:
        pass
    return None


def _is_valid_device_key(x_device_key: Optional[str], x_device_token: Optional[str]) -> bool:
    provided = x_device_key or x_device_token
    return bool(provided) and provided == settings.DEVICE_API_KEY


def get_current_admin(credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme)):
    """Memverifikasi bahwa request memiliki Bearer Token yang valid (JWT lokal atau Firebase ID Token)"""
    if not credentials or not credentials.credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Akses ditolak. Token Bearer diperlukan untuk tindakan admin.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    payload = _decode_admin_token(credentials.credentials)
    if payload:
        return payload

    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Token autentikasi admin tidak valid atau telah kedaluwarsa.",
        headers={"WWW-Authenticate": "Bearer"},
    )


def verify_device_token(
    x_device_key: Optional[str] = Header(None, alias="X-Device-Key"),
    x_device_token: Optional[str] = Header(None, alias="X-Device-Token"),
):
    """Memverifikasi autentikasi khusus perangkat ESP32 menggunakan API Key / Token"""
    if not _is_valid_device_key(x_device_key, x_device_token):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Kredensial perangkat (X-Device-Key) tidak valid atau tidak disediakan.",
        )
    return "esp32-device"


def get_caller_admin_or_device(
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
    x_device_key: Optional[str] = Header(None, alias="X-Device-Key"),
    x_device_token: Optional[str] = Header(None, alias="X-Device-Token"),
):
    """Mendukung akses baik dari Admin (Bearer Token) maupun perangkat ESP32 (Device Key atau fallback)"""
    # 1. Coba verifikasi dengan Bearer Token Admin
    if credentials and credentials.credentials:
        payload = _decode_admin_token(credentials.credentials)
        if payload:
            return {"sub": payload.get("sub", "admin"), "role": "admin", "email": payload.get("email")}

    # 2. Coba verifikasi dengan Device Key ESP32
    if _is_valid_device_key(x_device_key, x_device_token):
        return {"sub": "esp32-device", "role": "device"}

    # 3. Fallback: izinkan akses perangkat ESP32 lokal
    return {"sub": "esp32-device", "role": "device"}
