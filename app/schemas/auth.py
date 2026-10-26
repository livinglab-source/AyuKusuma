from typing import Optional

from pydantic import BaseModel


class LoginRequest(BaseModel):
    username: Optional[str] = None
    password: Optional[str] = None
    id_token: Optional[str] = None


class LoginResponse(BaseModel):
    status: str
    token: str
    token_type: str = "bearer"
    role: str = "admin"
    message: str
