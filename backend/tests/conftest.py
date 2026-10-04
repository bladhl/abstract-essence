import pytest
from fastapi.testclient import TestClient
from pydantic import SecretStr
from pydantic_ai import models
from sqlalchemy import event
from sqlalchemy.pool import StaticPool
from sqlmodel import SQLModel, create_engine

from essence.main import create_app
from essence.reading.schemas import (
    AnalysisOutput,
    Annotation,
    Citation,
    FeedbackOutput,
    GuidedAnalysisOutput,
    Insight,
    ReadingMap,
    RoleGap,
)
from essence.settings import Settings

QUOTE = "The pilot included twenty volunteers."


def analysis_output():
    return AnalysisOutput(
        insights=[
            Insight(
                lens=lens,
                author_excerpt=Citation(page=1, quote=QUOTE),
                interpretation="A limited pilot, not proof of causality.",
                limitation="A convenience sample limits generalization.",
            )
            for lens in ("problem", "method", "evidence", "argument")
        ],
        learning_feedback="Consider whether the design supports your explanation.",
        next_question="Which alternative explanations remain?",
    )


def guided_output():
    return GuidedAnalysisOutput(
        **analysis_output().model_dump(),
        reading_map=ReadingMap(
            overview="A preliminary pilot uses volunteers; the scope does not establish causality.",
            annotations=[
                Annotation(
                    role="approach",
                    title="A small pilot sample",
                    citation=Citation(page=1, quote=QUOTE),
                    explanation="This passage identifies the sample used in the investigation.",
                    caveat="Sample size alone does not establish the design's validity.",
                    question="How would sampling affect the conclusions?",
                )
            ],
            gaps=[
                RoleGap(role=role, reason="Not supported by this selected source scope.")
                for role in ("problem", "contribution", "evidence", "limits")
            ],
        ),
    )


def referenced_output(output, passage_id="p1-s1"):
    """Model-only selection fixture; public expected outputs remain literal citations."""
    data = output.model_dump()
    for insight in data.get("insights", []):
        if insight["author_excerpt"] is not None:
            insight["author_excerpt"] = {"passage_id": passage_id}
    for annotation in data.get("reading_map", {}).get("annotations", []):
        annotation["citation"] = {"passage_id": passage_id}
    if "citations" in data:
        data["citations"] = [{"passage_id": passage_id} for _ in data["citations"]]
    return data


class StubAI:
    def __init__(self):
        self.output = analysis_output()
        self.guided = guided_output()
        self.reply = FeedbackOutput(
            answer="Causality is not established.",
            citations=[Citation(page=1, quote=QUOTE)],
            limitation="Only the supplied pages were examined.",
        )
        self.failure = None
        self.calls = []
        self.thinking_calls = []

    async def analyze(self, provider, model, pages, attempt, thinking="default"):
        self.calls.append((provider, model, pages, attempt))
        self.thinking_calls.append(thinking)
        if self.failure:
            raise self.failure
        return self.output

    async def guide(self, provider, model, pages, thinking="default"):
        self.calls.append((provider, model, pages, ""))
        self.thinking_calls.append(thinking)
        if self.failure:
            raise self.failure
        return self.guided

    async def feedback(
        self, provider, model, pages, question, analysis, context=None, thinking="default"
    ):
        self.calls.append((provider, model, pages, question, context))
        self.thinking_calls.append(thinking)
        if self.failure:
            raise self.failure
        return self.reply


class StubLimiter:
    async def acquire(self):
        pass


@pytest.fixture(autouse=True)
def prevent_live_models(monkeypatch):
    monkeypatch.setattr(models, "ALLOW_MODEL_REQUESTS", False)


@pytest.fixture
def settings():
    return Settings(
        _env_file=None,
        openai_api_key=SecretStr("test-key"),
        openai_models=["test-model"],
        google_api_key=SecretStr("test-key"),
        google_models=["test-model"],
        anthropic_api_key=SecretStr("test-key"),
        anthropic_models=["test-model"],
    )


@pytest.fixture
def workspace(settings):
    engine = create_engine(
        "sqlite://", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )
    event.listen(
        engine, "connect", lambda connection, _: connection.execute("PRAGMA foreign_keys=ON")
    )
    SQLModel.metadata.create_all(engine)
    ai = StubAI()
    app = create_app(settings, engine, ai, StubLimiter())
    with TestClient(app, headers={"X-Essence-Client": "workspace"}) as client:
        yield client, ai
    engine.dispose()


@pytest.fixture
def document(workspace):
    client, _ = workspace
    response = client.post(
        "/api/documents",
        json={
            "title": "Synthetic pilot",
            "filename": "pilot.pdf",
            "total_pages": 2,
            "pages": [
                {"number": 1, "text": QUOTE},
                {"number": 2, "text": "A larger study would be required."},
            ],
        },
    )
    assert response.status_code == 201
    return response.json()


@pytest.fixture
def analysis_request(document):
    return {
        "document_id": document["id"],
        "provider": "openai",
        "model": "test-model",
        "page_start": 1,
        "page_end": 1,
        "consent": True,
        "attempt": "The method explores a question using a small pilot.",
    }
