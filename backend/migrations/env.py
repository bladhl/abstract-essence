from alembic import context
from sqlmodel import SQLModel, create_engine

from essence.infra import models  # noqa: F401
from essence.settings import Settings


def run_migrations():
    engine = create_engine(Settings().database_url)
    with engine.connect() as connection:
        context.configure(connection=connection, target_metadata=SQLModel.metadata)
        with context.begin_transaction():
            context.run_migrations()
    engine.dispose()


run_migrations()
