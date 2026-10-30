from alembic import context
from sqlalchemy import create_engine, pool
from app.config import settings
from app.models import Base

url = settings().migration_database_url or settings().database_url
if not url:
    raise RuntimeError(
        "Set MIGRATION_DATABASE_URL or DATABASE_URL before applying migrations"
    )
if context.is_offline_mode():
    context.configure(url=url, target_metadata=Base.metadata, literal_binds=True)
    with context.begin_transaction():
        context.run_migrations()
else:
    with create_engine(
        url, poolclass=pool.NullPool, connect_args={"prepare_threshold": None}
    ).connect() as conn:
        context.configure(connection=conn, target_metadata=Base.metadata)
        with context.begin_transaction():
            context.run_migrations()
