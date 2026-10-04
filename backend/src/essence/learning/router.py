from typing import Literal
from uuid import UUID

from fastapi import APIRouter, HTTPException
from pydantic import Field
from sqlmodel import select

from essence.documents.schemas import StrictModel
from essence.infra.database import SessionDep
from essence.infra.models import Connection, Document, Note, Page
from essence.reading.evidence import verify_citation
from essence.reading.schemas import Citation

router = APIRouter(prefix="/api/learning", tags=["learning"])


class NoteInput(StrictModel):
    document_id: UUID
    kind: Literal["note", "correction", "application", "attempt"]
    page: int = Field(ge=1, le=1500)
    quote: str = Field(min_length=8, max_length=1200)
    text: str = Field(min_length=1, max_length=6000)


class ConnectionInput(StrictModel):
    source_id: UUID
    target_id: UUID
    relationship: str = Field(min_length=2, max_length=100)
    evidence: str = Field(min_length=8, max_length=2000)


@router.post("/notes", status_code=201)
def save_note(body: NoteInput, session: SessionDep) -> Note:
    page = session.get(Page, (body.document_id, body.page))
    if not page:
        raise HTTPException(404, "Source page not found.")
    try:
        verify_citation(Citation(page=body.page, quote=body.quote), {body.page: page.text})
    except ValueError:
        raise HTTPException(422, "Choose an exact excerpt from this source page.") from None
    note = Note(**body.model_dump())
    session.add(note)
    session.commit()
    session.refresh(note)
    return note


@router.delete("/notes/{note_id}", status_code=204)
def delete_note(note_id: UUID, session: SessionDep) -> None:
    note = session.get(Note, note_id)
    if not note:
        raise HTTPException(404, "Note not found.")
    session.delete(note)
    session.commit()


@router.get("/connections")
def connections(session: SessionDep) -> list[Connection]:
    return list(session.exec(select(Connection).limit(1000)))


@router.post("/connections", status_code=201)
def connect(body: ConnectionInput, session: SessionDep) -> Connection:
    if body.source_id == body.target_id:
        raise HTTPException(422, "Connect two different documents.")
    if not session.get(Document, body.source_id) or not session.get(Document, body.target_id):
        raise HTTPException(404, "Both documents must belong to the workspace.")
    item = Connection(**body.model_dump())
    session.add(item)
    session.commit()
    session.refresh(item)
    return item


@router.delete("/connections/{connection_id}", status_code=204)
def delete_connection(connection_id: UUID, session: SessionDep) -> None:
    item = session.get(Connection, connection_id)
    if not item:
        raise HTTPException(404, "Connection not found.")
    session.delete(item)
    session.commit()
