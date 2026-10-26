"""
Logika login admin (password sistem atau Firebase Authentication ID Token).
"""
from fastapi import HTTPException

from app.core.config import settings
from app.core.firebase import fb_auth
from app.core.security import create_access_token
from app.schemas.auth import LoginRequest, LoginResponse


def login_admin(req: LoginRequest) -> LoginResponse:
    # 1. Login dengan Firebase Authentication ID Token
    if req.id_token:
        try:
            decoded = fb_auth.verify_id_token(req.id_token)
            token = create_access_token(sub=decoded.get("uid"), email=decoded.get("email"))
            return LoginResponse(
                status="success",
                token=token,
                role="admin",
                message="Login admin berhasil via Firebase Authentication"
            )
        except Exception as e:
            raise HTTPException(status_code=401, detail=f"Firebase ID Token tidak valid: {e}")

    # 2. Login dengan kata sandi admin sistem
    if req.username == settings.ADMIN_USERNAME and req.password == settings.ADMIN_PASSWORD:
        token = create_access_token(sub=req.username)
        return LoginResponse(
            status="success",
            token=token,
            role="admin",
            message="Login admin berhasil"
        )

    raise HTTPException(status_code=401, detail="Nama pengguna atau kata sandi admin salah")
