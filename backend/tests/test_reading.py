from unittest.mock import AsyncMock

import httpx2
import pytest
from conftest import QUOTE, analysis_output, guided_output, referenced_output
from pydantic import ValidationError
from pydantic_ai.exceptions import ModelHTTPError
from pydantic_ai.messages import ModelResponse, ToolCallPart
from pydantic_ai.models.function import FunctionModel
from redis.exceptions import ConnectionError

from essence.infra.limiter import ProviderLimiter
from essence.reading.ai import AIUnavailable, PydanticReadingAI
from essence.reading.evidence import verify_citation
from essence.reading.schemas import AnalysisOutput, Citation, FeedbackOutput, GuidedAnalysisOutput


@pytest.mark.parametrize("provider", ["openai", "google", "anthropic"])
async def test_provider_construction_without_network(settings, provider):
    async with httpx2.AsyncClient() as client:
        adapter = PydanticReadingAI(settings, client)
        assert adapter.resolve(provider, "test-model").model_name == "test-model"
        with pytest.raises(AIUnavailable, match="No data was sent"):
            adapter.resolve(provider, "not-allowed")


@pytest.mark.parametrize("output_type", [AnalysisOutput, FeedbackOutput, GuidedAnalysisOutput])
async def test_structured_agent_output(settings, output_type):
    output = (
        guided_output()
        if output_type is GuidedAnalysisOutput
        else (
            analysis_output()
            if output_type is AnalysisOutput
            else FeedbackOutput(
                answer="Not enough evidence.", citations=[], limitation="Scope is limited."
            )
        )
    )

    def respond(messages, info):
        assert not info.function_tools
        assert info.output_tools
        return ModelResponse(
            parts=[ToolCallPart(info.output_tools[0].name, referenced_output(output))]
        )

    async with httpx2.AsyncClient() as client:
        result = await PydanticReadingAI(settings, client).run_output(
            FunctionModel(respond), output_type, {"source_pages": {1: QUOTE}}
        )
    assert result == output


async def test_provider_error_is_sanitized(settings):
    def fail(messages, info):
        raise RuntimeError("secret-key and confidential source")

    async with httpx2.AsyncClient() as client:
        with pytest.raises(AIUnavailable) as error:
            await PydanticReadingAI(settings, client).run_output(
                FunctionModel(fail), AnalysisOutput, {}
            )
    assert "secret-key" not in str(error.value)
    assert "confidential" not in str(error.value)


@pytest.mark.parametrize(
    "status,message",
    [
        (429, "quota or rate limit"),
        (401, "credentials or model access"),
        (403, "credentials or model access"),
        (500, "temporarily unavailable"),
        (502, "temporarily unavailable"),
        (503, "temporarily unavailable"),
        (504, "temporarily unavailable"),
        (400, "valid structured answer"),
    ],
)
async def test_provider_status_is_classified_without_private_details(settings, status, message):
    def fail(messages, info):
        raise ModelHTTPError(
            status,
            model_name="private-model-name",
            body={"secret-key": "confidential source"},
            headers={"authorization": "private-auth-token"},
        )

    async with httpx2.AsyncClient() as client:
        with pytest.raises(AIUnavailable, match=message) as error:
            await PydanticReadingAI(settings, client).run_output(
                FunctionModel(fail), GuidedAnalysisOutput, {}
            )
    for private in ("secret-key", "confidential", "private-model-name", "private-auth-token"):
        assert private not in str(error.value)


@pytest.mark.parametrize(
    "citation", [Citation(page=2, quote=QUOTE), Citation(page=1, quote="Invented source statement")]
)
def test_rejects_unmatched_or_out_of_scope_citation(citation):
    with pytest.raises(ValueError):
        verify_citation(citation, {1: QUOTE})


def test_whitespace_normalization_is_not_paraphrasing():
    verify_citation(Citation(page=1, quote="The pilot\n included twenty volunteers."), {1: QUOTE})


def test_requires_exactly_four_distinct_lenses():
    data = analysis_output().model_dump()
    data["insights"][1]["lens"] = "problem"
    with pytest.raises(ValidationError):
        AnalysisOutput.model_validate(data)


async def test_limiter_fails_closed_and_caps_requests():
    redis = AsyncMock()
    limiter = ProviderLimiter(redis)
    redis.eval.return_value = 8
    await limiter.acquire()
    redis.eval.return_value = 9
    with pytest.raises(AIUnavailable, match="limit reached"):
        await limiter.acquire()
    redis.eval.side_effect = ConnectionError("private connection details")
    with pytest.raises(AIUnavailable, match="unavailable"):
        await limiter.acquire()


def test_analysis_feedback_export_and_cascade(workspace, document, analysis_request):
    client, ai = workspace
    response = client.post("/api/reading/analyses", json=analysis_request)
    assert response.status_code == 201, response.text
    item = response.json()
    assert ai.calls[0][2] == {1: QUOTE}
    assert item["attempt"] == analysis_request["attempt"]
    feedback = client.post(
        f"/api/reading/analyses/{item['id']}/feedback",
        json={
            "provider": "google",
            "model": "test-model",
            "consent": True,
            "question": "Does the design establish causality?",
        },
    )
    assert feedback.status_code == 201, feedback.text
    assert feedback.json()["provider"] == "google"
    exported = client.get(f"/api/documents/{document['id']}/export").json()
    assert len(exported["analyses"]) == len(exported["feedback"]) == 1
    assert client.delete(f"/api/documents/{document['id']}").status_code == 204
    assert client.get(f"/api/reading/analyses/{item['id']}/feedback").json() == []


@pytest.mark.parametrize(
    "change",
    [
        {"consent": False},
        {"attempt": "too short"},
        {"page_end": 30},
        {"page_start": 2, "page_end": 1},
    ],
)
def test_invalid_analysis_never_calls_provider(workspace, analysis_request, change):
    client, ai = workspace
    assert client.post("/api/reading/analyses", json=analysis_request | change).status_code == 422
    assert ai.calls == []


def test_guided_reading_without_attempt_and_legacy_export(workspace, analysis_request):
    client, ai = workspace
    request = analysis_request | {"mode": "guided", "attempt": ""}
    result = client.post("/api/reading/analyses", json=request)
    assert result.status_code == 201, result.text
    item = result.json()
    assert item["attempt"] == ai.calls[0][3] == ""
    assert item["output"]["reading_map"]["version"] == "annotated-reading-v1"
    assert len(item["output"]["insights"]) == 4
    legacy = client.post("/api/reading/analyses", json=analysis_request)
    assert legacy.status_code == 201
    exported = client.get(f"/api/documents/{item['document_id']}/export").json()
    assert len(exported["analyses"]) == 2
    assert "reading_map" not in legacy.json()["output"]


def test_guided_attempt_is_not_invented(workspace, analysis_request):
    client, ai = workspace
    response = client.post("/api/reading/analyses", json=analysis_request | {"mode": "guided"})
    assert response.status_code == 422
    assert not ai.calls


def test_guided_annotation_excerpt_is_verified_before_save(workspace, analysis_request):
    client, ai = workspace
    ai.guided.reading_map.annotations[0].citation.quote = "An unsupported author statement."
    response = client.post(
        "/api/reading/analyses", json=analysis_request | {"mode": "guided", "attempt": ""}
    )
    assert response.status_code == 502
    assert client.get(f"/api/documents/{analysis_request['document_id']}").json()["analyses"] == []


@pytest.mark.parametrize("change", ["missing", "duplicate", "contradiction", "too_many"])
def test_map_requires_bounded_explicit_roles(change):
    data = guided_output().model_dump()
    reading_map = data["reading_map"]
    if change == "missing":
        reading_map["gaps"].pop()
    elif change == "duplicate":
        reading_map["gaps"].append(reading_map["gaps"][0])
    elif change == "contradiction":
        reading_map["gaps"][0]["role"] = "approach"
    else:
        reading_map["annotations"] *= 9
    with pytest.raises(ValidationError):
        GuidedAnalysisOutput.model_validate(data)


def test_context_is_verified_and_preserved_separately(workspace, analysis_request):
    client, ai = workspace
    item = client.post("/api/reading/analyses", json=analysis_request).json()
    body = {
        "provider": "google",
        "model": "test-model",
        "consent": True,
        "question": "What does this passage do in the argument?",
        "context": {"role": "approach", "citation": {"page": 1, "quote": QUOTE}},
    }
    response = client.post(f"/api/reading/analyses/{item['id']}/feedback", json=body)
    assert response.status_code == 201
    assert response.json()["question"] == body["question"]
    assert response.json()["output"]["request_context"] == body["context"]
    assert ai.calls[-1][4] == body["context"]
    count = len(ai.calls)
    body["context"]["citation"]["page"] = 2
    assert client.post(f"/api/reading/analyses/{item['id']}/feedback", json=body).status_code == 422
    assert len(ai.calls) == count


def test_context_without_role_is_accepted(workspace, analysis_request):
    client, _ = workspace
    item = client.post("/api/reading/analyses", json=analysis_request).json()
    body = {
        "provider": "google",
        "model": "test-model",
        "consent": True,
        "question": "What does this passage do in the argument?",
        "context": {"citation": {"page": 1, "quote": QUOTE}},
    }
    response = client.post(f"/api/reading/analyses/{item['id']}/feedback", json=body)
    assert response.status_code == 201


@pytest.mark.parametrize("quote,page", [("An invented quote", 1), (QUOTE, 2)])
def test_unsupported_ai_output_is_not_saved(workspace, document, analysis_request, quote, page):
    client, ai = workspace
    ai.output.insights[0].author_excerpt = Citation(page=page, quote=quote)
    assert client.post("/api/reading/analyses", json=analysis_request).status_code == 502
    assert client.get(f"/api/documents/{document['id']}").json()["analyses"] == []


def test_missing_evidence_is_explicitly_nullable(workspace, analysis_request):
    client, ai = workspace
    ai.output.insights[0].author_excerpt = None
    response = client.post("/api/reading/analyses", json=analysis_request)
    assert response.status_code == 201
    assert response.json()["output"]["insights"][0]["author_excerpt"] is None


def test_unconfigured_destination_and_provider_failure(workspace, analysis_request):
    client, ai = workspace
    assert (
        client.post(
            "/api/reading/analyses", json=analysis_request | {"model": "unknown"}
        ).status_code
        == 503
    )
    assert not ai.calls
    ai.failure = AIUnavailable("Provider unavailable.")
    assert client.post("/api/reading/analyses", json=analysis_request).status_code == 503


def test_note_validation_and_request_boundaries(workspace, document):
    client, _ = workspace
    note = {
        "document_id": document["id"],
        "kind": "correction",
        "page": 1,
        "quote": QUOTE,
        "text": "A pilot does not establish causality.",
    }
    assert client.post("/api/learning/notes", json=note).status_code == 201
    assert (
        client.post("/api/learning/notes", json=note | {"quote": "Invented passage"}).status_code
        == 422
    )
    assert client.post("/api/learning/notes", json=note | {"page": 3}).status_code == 404
    assert (
        client.post(
            "/api/learning/notes", json=note, headers={"Origin": "https://evil.test"}
        ).status_code
        == 403
    )
    assert (
        client.post("/api/learning/notes", json=note, headers={"X-Essence-Client": ""}).status_code
        == 403
    )
    assert client.post("/api/documents", content=b"x" * 12_000_001).status_code == 413


def test_unsupported_feedback_is_not_saved(workspace, analysis_request):
    client, ai = workspace
    item = client.post("/api/reading/analyses", json=analysis_request).json()
    ai.reply.citations = [Citation(page=1, quote="This quotation was fabricated.")]
    response = client.post(
        f"/api/reading/analyses/{item['id']}/feedback",
        json={
            "provider": "anthropic",
            "model": "test-model",
            "consent": True,
            "question": "What is the evidence for that claim?",
        },
    )
    assert response.status_code == 502
    assert client.get(f"/api/reading/analyses/{item['id']}/feedback").json() == []


def test_missing_consent_and_empty_scope_never_call_provider(workspace, analysis_request):
    client, ai = workspace
    request = analysis_request.copy()
    del request["consent"]
    assert client.post("/api/reading/analyses", json=request).status_code == 422
    response = client.post(
        "/api/documents",
        json={
            "title": "Partial scan",
            "filename": "scan.pdf",
            "total_pages": 2,
            "pages": [{"number": 1, "text": ""}, {"number": 2, "text": QUOTE}],
        },
    )
    assert response.status_code == 201
    request = analysis_request | {"document_id": response.json()["id"]}
    assert client.post("/api/reading/analyses", json=request).status_code == 422
    assert ai.calls == []
