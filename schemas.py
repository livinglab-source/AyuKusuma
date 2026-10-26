"""
Bridge backward-compatibility: meneruskan model Pydantic dari `app.schemas`.
"""
from app.schemas import (
    LoginRequest,
    LoginResponse,
    CalibrationConfig,
    ServoCommand,
    ServoCommandAckInput,
    FeedingLog,
    DeviceFeedingLogInput,
    SamplingInput,
    SensorData,
)

__all__ = [
    "LoginRequest",
    "LoginResponse",
    "CalibrationConfig",
    "ServoCommand",
    "ServoCommandAckInput",
    "FeedingLog",
    "DeviceFeedingLogInput",
    "SamplingInput",
    "SensorData",
]