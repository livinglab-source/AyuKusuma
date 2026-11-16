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


@router.put("/{sampling_id}")
def update_sampling(sampling_id: str, data: SamplingInput, admin: dict = Depends(get_current_admin)):
    """(Admin) Memperbarui data sampling yang sudah ada dan menghitung ulang FCR di Firestore"""
    return sampling_service.save_sampling(data, created_by=admin.get("sub", "admin"), sampling_id=sampling_id)


@router.delete("/{sampling_id}")
def delete_sampling(sampling_id: str, admin: dict = Depends(get_current_admin)):
    """(Admin) Menghapus data sampling dari Firestore"""
    return sampling_service.delete_sampling(sampling_id)
