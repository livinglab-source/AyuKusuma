"""
Bridge backward-compatibility: meneruskan objek Firestore `db` dari `app.core.firebase`.
"""
from app.core.firebase import db

__all__ = ["db"]