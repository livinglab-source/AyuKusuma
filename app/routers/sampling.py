from fastapi import APIRouter, Depends

from app.core.security import get_current_admin
from app.schemas.sampling import SamplingInput
from app.services import sampling_service

router = APIRouter(prefix="/api/sampling", tags=["Sampling FCR"])


@router.get("")
def get_sampling():
    """(Publik) Membaca evaluasi sampling FCR dari Firestore"""
    return {"status": "success", "data": sampling_service.list_sampling()}


@router.post("")
def add_sampling(data: SamplingInput, admin: dict = Depends(get_current_admin)):
    """(Admin) Menambahkan data sampling dan menghitung FCR secara otomatis di Firestore (Tahap 7)"""
    return sampling_service.save_sampling(data, created_by=admin.get("sub", "admin"))
