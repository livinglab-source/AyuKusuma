from typing import Optional

from pydantic import BaseModel, Field, field_validator


class ServoCommand(BaseModel):
    action: str = Field(..., description="Action: none, open, close, feed")
    duration: int = Field(default=0, ge=0, le=60, description="Durasi dalam detik (0-60)")

    @field_validator("action")
    @classmethod
    def validate_action(cls, v: str) -> str:
        clean = v.strip().lower()
        if clean not in ["none", "open", "close", "feed"]:
            raise ValueError("Action harus salah satu dari: none, open, close, feed")
        return clean


class ServoCommandAckInput(BaseModel):
    command_id: str
    status: str = "completed"  # "completed", "executing", "failed"
    message: Optional[str] = None

    @field_validator("status")
    @classmethod
    def validate_ack_status(cls, v: str) -> str:
        clean = v.strip().lower()
        if clean not in ["completed", "executing", "failed", "idle", "success"]:
            raise ValueError("Status ack harus salah satu dari: completed, executing, failed")
        return clean
