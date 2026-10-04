from datetime import UTC, datetime
from uuid import UUID, uuid4

from sqlalchemy import JSON
from sqlmodel import Field, SQLModel


class Document(SQLModel, table=True):
    id: UUID = Field(default_factory=uuid4, primary_key=True)
    title: str
    filename: str
    total_pages: int
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))


class Page(SQLModel, table=True):
    document_id: UUID = Field(foreign_key="document.id", ondelete="CASCADE", primary_key=True)
    number: int = Field(primary_key=True)
    text: str


class Analysis(SQLModel, table=True):
    id: UUID = Field(default_factory=uuid4, primary_key=True)
    document_id: UUID = Field(foreign_key="document.id", ondelete="CASCADE", index=True)
    provider: str
    model: str
    page_start: int
    page_end: int
    attempt: str
    output: dict = Field(sa_type=JSON)
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))


class Note(SQLModel, table=True):
    id: UUID = Field(default_factory=uuid4, primary_key=True)
    document_id: UUID = Field(foreign_key="document.id", ondelete="CASCADE", index=True)
    kind: str
    page: int
    quote: str
    text: str
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))


class Feedback(SQLModel, table=True):
    id: UUID = Field(default_factory=uuid4, primary_key=True)
    analysis_id: UUID = Field(foreign_key="analysis.id", ondelete="CASCADE", index=True)
    question: str
    provider: str
    model: str
    output: dict = Field(sa_type=JSON)
    created_at: datetime = Field(default_factory=lambda: datetime.now(UTC))


class Connection(SQLModel, table=True):
    id: UUID = Field(default_factory=uuid4, primary_key=True)
    source_id: UUID = Field(foreign_key="document.id", ondelete="CASCADE", index=True)
    target_id: UUID = Field(foreign_key="document.id", ondelete="CASCADE", index=True)
    relationship: str
    evidence: str
