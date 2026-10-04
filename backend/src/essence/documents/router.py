from uuid import UUID

from fastapi import APIRouter, HTTPException
from sqlmodel import col, select

from essence.documents.schemas import DocumentInput
from essence.infra.database import SessionDep
from essence.infra.models import Analysis, Connection, Document, Feedback, Note, Page

router = APIRouter(prefix="/api/documents", tags=["documents"])


@router.get("")
def list_documents(session: SessionDep) -> list[Document]:
    return list(session.exec(select(Document).order_by(col(Document.created_at).desc()).limit(200)))


@router.post("", status_code=201)
def import_document(body: DocumentInput, session: SessionDep) -> Document:
    if len(session.exec(select(Document.id).limit(200)).all()) >= 200:
        raise HTTPException(
            409, "Workspace limit reached (200 documents). Export and delete first."
        )
    document = Document(title=body.title, filename=body.filename, total_pages=body.total_pages)
    session.add(document)
    session.flush()
    for page in body.pages:
        session.add(Page(document_id=document.id, **page.model_dump()))
    session.commit()
    session.refresh(document)
    return document


@router.get("/{document_id}")
def get_document(document_id: UUID, session: SessionDep) -> dict:
    document = session.get(Document, document_id)
    if not document:
        raise HTTPException(404, "Document not found.")
    pages = session.exec(
        select(Page).where(Page.document_id == document_id).order_by(col(Page.number))
    ).all()
    analyses = session.exec(
        select(Analysis)
        .where(Analysis.document_id == document_id)
        .order_by(col(Analysis.created_at))
    ).all()
    notes = session.exec(
        select(Note).where(Note.document_id == document_id).order_by(col(Note.created_at))
    ).all()
    return {"document": document, "pages": pages, "analyses": analyses, "notes": notes}


@router.get("/{document_id}/export")
def export_document(document_id: UUID, session: SessionDep) -> dict:
    data = get_document(document_id, session)
    ids = [a.id for a in data["analyses"]]
    data["feedback"] = (
        session.exec(select(Feedback).where(col(Feedback.analysis_id).in_(ids))).all()
        if ids
        else []
    )
    data["connections"] = session.exec(
        select(Connection).where(
            (Connection.source_id == document_id) | (Connection.target_id == document_id)
        )
    ).all()
    data["format"] = "abstract-essence-export-v1"
    return data


@router.delete("/{document_id}", status_code=204)
def delete_document(document_id: UUID, session: SessionDep) -> None:
    document = session.get(Document, document_id)
    if not document:
        raise HTTPException(404, "Document not found.")
    session.delete(document)
    session.commit()
