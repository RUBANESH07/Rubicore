"""RubiRide tables. Every row is owned by a user (directly or via its ride/bike) and cascades on user delete."""
from datetime import date, datetime
from decimal import Decimal

from sqlalchemy import (JSON, Boolean, Date, DateTime, Float, ForeignKey, Index, Integer, Numeric, String, Text,
                        UniqueConstraint)
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base
from app.models import Money, UTCDateTime, utcnow


class Bike(Base):
    __tablename__ = "bikes"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(80))
    make: Mapped[str] = mapped_column(String(80), default="")
    model: Mapped[str] = mapped_column(String(80), default="")
    year: Mapped[int | None] = mapped_column(Integer, nullable=True)
    registration: Mapped[str] = mapped_column(String(32), default="")
    is_default: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)


class BikeSetting(Base):
    __tablename__ = "bike_settings"
    id: Mapped[int] = mapped_column(primary_key=True)
    bike_id: Mapped[int] = mapped_column(ForeignKey("bikes.id", ondelete="CASCADE"), unique=True)
    tank_capacity_l: Mapped[float | None] = mapped_column(Float, nullable=True)
    expected_mileage_kmpl: Mapped[float | None] = mapped_column(Float, nullable=True)
    initial_odometer_km: Mapped[float | None] = mapped_column(Float, nullable=True)
    service_interval_km: Mapped[float | None] = mapped_column(Float, nullable=True)


class Ride(Base):
    __tablename__ = "rides"
    __table_args__ = (UniqueConstraint("user_id", "client_id"), Index("ix_rides_user_started", "user_id", "started_at"))
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    bike_id: Mapped[int | None] = mapped_column(ForeignKey("bikes.id", ondelete="SET NULL"), nullable=True)
    client_id: Mapped[str | None] = mapped_column(String(64), nullable=True)  # makes offline start idempotent
    title: Mapped[str] = mapped_column(String(160), default="")
    source: Mapped[str] = mapped_column(String(12), default="web")  # web | mobile
    started_at: Mapped[datetime] = mapped_column(UTCDateTime)
    ended_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    start_latitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    start_longitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    end_latitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    end_longitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    start_label: Mapped[str] = mapped_column(String(200), default="")
    end_label: Mapped[str] = mapped_column(String(200), default="")
    total_distance_km: Mapped[float] = mapped_column(Float, default=0.0)
    average_speed_kmh: Mapped[float] = mapped_column(Float, default=0.0)
    maximum_speed_kmh: Mapped[float] = mapped_column(Float, default=0.0)
    duration_seconds: Mapped[int] = mapped_column(Integer, default=0)
    paused_seconds: Mapped[int] = mapped_column(Integer, default=0)
    status: Mapped[str] = mapped_column(String(12), default="active", index=True)  # active | paused | completed
    created_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)


class RideEvent(Base):
    __tablename__ = "ride_events"
    id: Mapped[int] = mapped_column(primary_key=True)
    ride_id: Mapped[int] = mapped_column(ForeignKey("rides.id", ondelete="CASCADE"), index=True)
    type: Mapped[str] = mapped_column(String(12))  # start | pause | resume | stop
    at: Mapped[datetime] = mapped_column(UTCDateTime)


class RideGpsPoint(Base):
    """Every structurally valid fix, kept raw. `accepted` / `reject_reason` come from the GPS engine."""
    __tablename__ = "ride_gps_points"
    __table_args__ = (UniqueConstraint("ride_id", "recorded_at"), Index("ix_points_ride_time", "ride_id", "recorded_at"))
    id: Mapped[int] = mapped_column(primary_key=True)
    ride_id: Mapped[int] = mapped_column(ForeignKey("rides.id", ondelete="CASCADE"))
    latitude: Mapped[float] = mapped_column(Float)
    longitude: Mapped[float] = mapped_column(Float)
    recorded_at: Mapped[datetime] = mapped_column(UTCDateTime)
    speed_kmh: Mapped[float | None] = mapped_column(Float, nullable=True)
    accuracy_m: Mapped[float | None] = mapped_column(Float, nullable=True)
    altitude_m: Mapped[float | None] = mapped_column(Float, nullable=True)
    segment: Mapped[int] = mapped_column(Integer, default=0)
    accepted: Mapped[bool] = mapped_column(Boolean, default=True)
    reject_reason: Mapped[str | None] = mapped_column(String(24), nullable=True)
    computed_speed_kmh: Mapped[float | None] = mapped_column(Float, nullable=True)


class RideStatistic(Base):
    """Aggregates kept after GPS points are compacted, so long-term analytics don't depend on raw points."""
    __tablename__ = "ride_statistics"
    id: Mapped[int] = mapped_column(primary_key=True)
    ride_id: Mapped[int] = mapped_column(ForeignKey("rides.id", ondelete="CASCADE"), unique=True)
    moving_seconds: Mapped[int] = mapped_column(Integer, default=0)
    stationary_seconds: Mapped[int] = mapped_column(Integer, default=0)
    moving_average_speed_kmh: Mapped[float] = mapped_column(Float, default=0.0)
    accepted_points: Mapped[int] = mapped_column(Integer, default=0)
    rejected_points: Mapped[int] = mapped_column(Integer, default=0)
    rejected_by_reason: Mapped[dict | None] = mapped_column(JSON, nullable=True)
    gap_count: Mapped[int] = mapped_column(Integer, default=0)
    raw_distance_km: Mapped[float] = mapped_column(Float, default=0.0)
    min_altitude_m: Mapped[float | None] = mapped_column(Float, nullable=True)
    max_altitude_m: Mapped[float | None] = mapped_column(Float, nullable=True)
    elevation_gain_m: Mapped[float] = mapped_column(Float, default=0.0)
    points_compacted_at: Mapped[datetime | None] = mapped_column(UTCDateTime, nullable=True)
    updated_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)


class SavedLocation(Base):
    __tablename__ = "saved_locations"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(16), default="parking")
    latitude: Mapped[float] = mapped_column(Float)
    longitude: Mapped[float] = mapped_column(Float)
    accuracy_m: Mapped[float | None] = mapped_column(Float, nullable=True)
    note: Mapped[str] = mapped_column(String(300), default="")
    saved_at: Mapped[datetime] = mapped_column(UTCDateTime, default=utcnow)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)  # false once the bike was collected


class FuelEntry(Base):
    __tablename__ = "fuel_entries"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    bike_id: Mapped[int | None] = mapped_column(ForeignKey("bikes.id", ondelete="SET NULL"), nullable=True)
    date: Mapped[date] = mapped_column(Date, index=True)
    odometer_km: Mapped[float] = mapped_column(Float)
    litres: Mapped[float] = mapped_column(Float)
    price_per_litre: Mapped[Decimal] = mapped_column(Money)
    total_amount: Mapped[Decimal] = mapped_column(Money)
    station: Mapped[str] = mapped_column(String(120), default="")
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    is_full_tank: Mapped[bool] = mapped_column(Boolean, default=True)
    transaction_id: Mapped[int | None] = mapped_column(ForeignKey("transactions.id", ondelete="SET NULL"), nullable=True)


class MaintenanceRecord(Base):
    __tablename__ = "maintenance_records"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    bike_id: Mapped[int | None] = mapped_column(ForeignKey("bikes.id", ondelete="SET NULL"), nullable=True)
    date: Mapped[date] = mapped_column(Date)
    odometer_km: Mapped[float | None] = mapped_column(Float, nullable=True)
    kind: Mapped[str] = mapped_column(String(80))
    cost: Mapped[Decimal] = mapped_column(Money, default=Decimal("0"))
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)


class UserPreference(Base):
    __tablename__ = "user_preferences"
    id: Mapped[int] = mapped_column(primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), unique=True)
    data: Mapped[dict | None] = mapped_column(JSON, nullable=True)
