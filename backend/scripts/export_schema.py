"""Development helper: snapshot initial DDL once; future changes need new migrations."""

from pathlib import Path
from sqlalchemy.schema import CreateTable, CreateIndex
from sqlalchemy.dialects import postgresql
from app.models import Base

target = Path("migrations/schema.sql")
if target.exists():
    raise SystemExit("Initial schema is already frozen; create a new migration")
dialect = postgresql.dialect()
parts = [
    str(CreateTable(t).compile(dialect=dialect)) + ";"
    for t in Base.metadata.sorted_tables
]
parts += [
    str(CreateIndex(i).compile(dialect=dialect)) + ";"
    for t in Base.metadata.sorted_tables
    for i in t.indexes
]
target.write_text("\n\n".join(parts), encoding="utf-8")
