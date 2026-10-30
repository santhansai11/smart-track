from datetime import datetime
from typing import Annotated
from uuid import UUID
from pydantic import BaseModel, ConfigDict, Field, field_validator


class Input(BaseModel):
    model_config = ConfigDict(extra="forbid", allow_inf_nan=False)


class ProfileEdit(Input):
    full_name: str = Field(min_length=2, max_length=120)


class RouteInput(Input):
    name: str = Field(min_length=2, max_length=120)
    description: str = Field(default="", max_length=2000)
    coordinates: list[tuple[float, float]] = Field(min_length=4, max_length=500)
    tolerance_m: float = Field(default=20, ge=5, le=100)

    @field_validator("coordinates")
    @classmethod
    def valid_coords(cls, points):
        if any(not (-85 <= lat <= 85 and -180 <= lon <= 180) for lat, lon in points):
            raise ValueError("Invalid route coordinates")
        return points


class RoomInput(Input):
    name: str = Field(min_length=2, max_length=120)
    description: str = Field(default="", max_length=2000)
    route_version_id: UUID
    capacity: int = Field(default=50, ge=1, le=1000)
    visibility: str = Field(default="PUBLIC", pattern="^(PUBLIC|PRIVATE)$")


class Join(Input):
    code: str = Field(min_length=8, max_length=32)


class PointInput(Input):
    seq: int = Field(gt=0, le=2147483647)
    captured_at: datetime
    latitude: float = Field(ge=-90, le=90)
    longitude: float = Field(ge=-180, le=180)
    accuracy_m: float = Field(ge=0, le=100000)
    speed_mps: float | None = Field(default=None, ge=0, le=1000)
    heading: float | None = Field(default=None, ge=0, lt=360)

    @field_validator("captured_at")
    @classmethod
    def timezone_required(cls, value):
        if value.tzinfo is None:
            raise ValueError("Timestamp must include timezone")
        return value


class GPSBatch(Input):
    points: list[PointInput] = Field(min_length=1, max_length=300)


class StopInput(Input):
    last_seq: int = Field(ge=0)


class StartInput(Input):
    location_consent: bool = False


class Reason(Input):
    reason: str = Field(min_length=3, max_length=2000)


class BlockInput(Input):
    active: bool


class ToggleInput(Input):
    active: bool
