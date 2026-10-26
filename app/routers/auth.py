from fastapi import APIRouter

from app.schemas.auth import LoginRequest, LoginResponse
from app.services import auth_service

router = APIRouter(tags=["Health & Auth"])


@router.get("/api/health/gateway")
def check_gateway():
    return {"status": "success", "message": "Backend terhubung ke Research Data Gateway Raspi!"}


@router.post("/api/auth/login", response_model=LoginResponse)
def login_admin(req: LoginRequest):
    """(Publik) Memverifikasi kredensial admin dan menerbitkan token akses JWT"""
    return auth_service.login_admin(req)
