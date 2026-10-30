from functools import lru_cache
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")
    database_url: str = ""
    migration_database_url: str = ""
    supabase_url: str = ""
    supabase_jwt_jwks_url: str = ""
    supabase_publishable_key: str = ""
    supabase_secret_key: str = ""
    root_admin_email: str = ""
    cors_origins: str = "http://localhost:5173"
    environment: str = "development"
    gps_sample_seconds: int = 3
    gps_batch_size: int = 200
    gps_retention_days: int = 90
    recovery_window_seconds: int = 120
    db_pool_size: int = 5
    db_max_overflow: int = 2


@lru_cache
def settings():
    return Settings()
