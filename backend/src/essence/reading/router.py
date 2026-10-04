import asyncio
from uuid import UUID

from fastapi import APIRouter, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from sqlmodel import Session, col, select

from essence.infra.database import SessionDep
from essence.infra.models import Analysis, Document, Feedback, Page
from essence.reading.ai import AIUnavailable, ensure_destination
from essence.reading.evidence import SourceCitationError, verify_citation, verify_output
from essence.reading.schemas import AnalysisInput, FeedbackInput

router = APIRouter(prefix="/api/reading", tags=["reading"])


def load_scope(engine, document_id: UUID, start: int, end: int) -> dict[int, str]:
    with Session(engine) as session:
        document = session.get(Document, document_id)
        if not document:
            raise HTTPException(404, "Document not found.")
        if end > document.total_pages:
            raise HTTPException(422, "Page range exceeds the document.")
        pages = session.exec(
            select(Page).where(
                Page.document_id == document_id, Page.number >= start, Page.number <= end
            )
        ).all()
        texts = {p.number: p.text for p in pages}
        length = sum(len(p) for p in texts.values())
        if length < 20 or length > 60000:
            raise HTTPException(
                422,
                "Choose a scope containing 20–60,000 extracted characters. "
                "No pages were silently omitted.",
            )
        return texts


def save_analysis(engine, body: AnalysisInput, output: dict) -> Analysis:
    with Session(engine) as session:
        if not session.get(Document, body.document_id):
            raise HTTPException(409, "The document was deleted while analysis was running.")
        output = {**output, "request_settings": {"thinking": body.thinking}}
        item = Analysis(**body.model_dump(exclude={"consent", "mode", "thinking"}), output=output)
        session.add(item)
        session.commit()
        session.refresh(item)
        return item


async def guard(request: Request, provider: str, model: str) -> None:
    ensure_destination(request.app.state.settings, provider, model)
    await request.app.state.limiter.acquire()


@router.post("/analyses", status_code=201)
async def analyze(body: AnalysisInput, request: Request) -> Analysis:
    try:
        ensure_destination(request.app.state.settings, body.provider, body.model)
        pages = await run_in_threadpool(
            load_scope, request.app.state.engine, body.document_id, body.page_start, body.page_end
        )
        await guard(request, body.provider, body.model)
        async with asyncio.timeout(60), request.app.state.ai_slots:
            if body.mode == "guided":
                output = await request.app.state.ai.guide(
                    body.provider, body.model, pages, thinking=body.thinking
                )
            else:
                output = await request.app.state.ai.analyze(
                    body.provider, body.model, pages, body.attempt, thinking=body.thinking
                )
        verify_output(output, pages)
        return await run_in_threadpool(
            save_analysis, request.app.state.engine, body, output.model_dump()
        )
    except AIUnavailable as exc:
        raise HTTPException(503, str(exc)) from None
    except TimeoutError:
        raise HTTPException(504, "AI request timed out. Please try again later.") from None
    except SourceCitationError as exc:
        raise HTTPException(
            502,
            "The assistant selected a source passage unavailable in these pages. "
            "Please explicitly retry; nothing was saved."
            if exc.page is None
            else "The assistant returned unsupported source excerpts. "
            "The answer was rejected; nothing was saved.",
        ) from None


def load_analysis(engine, analysis_id: UUID) -> Analysis:
    with Session(engine) as session:
        item = session.get(Analysis, analysis_id)
        if not item:
            raise HTTPException(404, "Analysis not found.")
        return item


def save_feedback(engine, analysis_id: UUID, body: FeedbackInput, output: dict) -> Feedback:
    with Session(engine) as session:
        if not session.get(Analysis, analysis_id):
            raise HTTPException(409, "This analysis was deleted while the answer was running.")
        values = body.model_dump(exclude={"consent", "context", "thinking"})
        output = {**output, "request_settings": {"thinking": body.thinking}}
        if body.context:
            output = {**output, "request_context": body.context.model_dump()}
        item = Feedback(analysis_id=analysis_id, **values, output=output)
        session.add(item)
        session.commit()
        session.refresh(item)
        return item


@router.get("/analyses/{analysis_id}/feedback")
def list_feedback(analysis_id: UUID, session: SessionDep) -> list[Feedback]:
    return list(
        session.exec(
            select(Feedback)
            .where(Feedback.analysis_id == analysis_id)
            .order_by(col(Feedback.created_at))
        )
    )


@router.post("/analyses/{analysis_id}/feedback", status_code=201)
async def ask(analysis_id: UUID, body: FeedbackInput, request: Request) -> Feedback:
    try:
        ensure_destination(request.app.state.settings, body.provider, body.model)
        item = await run_in_threadpool(load_analysis, request.app.state.engine, analysis_id)
        pages = await run_in_threadpool(
            load_scope, request.app.state.engine, item.document_id, item.page_start, item.page_end
        )
        if body.context:
            try:
                verify_citation(body.context.citation, pages)
            except SourceCitationError:
                raise HTTPException(
                    422, "Question context must match this reading's pages."
                ) from None
        await guard(request, body.provider, body.model)
        async with asyncio.timeout(60), request.app.state.ai_slots:
            output = await request.app.state.ai.feedback(
                body.provider,
                body.model,
                pages,
                body.question,
                item.output,
                body.context.model_dump() if body.context else None,
                thinking=body.thinking,
            )
        verify_output(output, pages)
        return await run_in_threadpool(
            save_feedback, request.app.state.engine, analysis_id, body, output.model_dump()
        )
    except AIUnavailable as exc:
        raise HTTPException(503, str(exc)) from None
    except TimeoutError:
        raise HTTPException(504, "AI request timed out. Please try again later.") from None
    except SourceCitationError as exc:
        raise HTTPException(
            502,
            "The assistant selected a source passage unavailable in this saved reading. "
            "Please explicitly retry; nothing was saved."
            if exc.page is None
            else "The answer contained unsupported excerpts and was rejected.",
        ) from None
