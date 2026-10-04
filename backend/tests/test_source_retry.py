import httpx2
import pytest
from conftest import QUOTE, analysis_output, guided_output, referenced_output
from pydantic_ai import models
from pydantic_ai.exceptions import ModelHTTPError
from pydantic_ai.messages import ModelResponse, RetryPromptPart, ToolCallPart
from pydantic_ai.models.function import FunctionModel

from essence.reading.ai import AIUnavailable, PydanticReadingAI
from essence.reading.evidence import SourceCitationError
from essence.reading.schemas import AnalysisOutput, Citation, FeedbackOutput, GuidedAnalysisOutput


async def test_guided_analysis_corrects_an_unavailable_reference_before_saving(
    workspace, analysis_request, monkeypatch
):
    client, _ = workspace
    valid = guided_output()
    invalid = referenced_output(valid)
    invalid["reading_map"]["annotations"][0]["citation"] = {"passage_id": "p99-s1"}
    requests = 0

    def respond(messages, info):
        nonlocal requests
        requests += 1
        if requests == 2:
            retry = next(part for part in messages[-1].parts if isinstance(part, RetryPromptPart))
            assert "passage_id" in retry.content
            assert "p99-s1" not in retry.content
        output = invalid if requests == 1 else referenced_output(valid)
        return ModelResponse(parts=[ToolCallPart(info.output_tools[0].name, output)])

    monkeypatch.setattr(models, "ALLOW_MODEL_REQUESTS", True)
    settings = client.app.state.settings
    settings.openai_models.append("gpt-6-luna")
    async with httpx2.AsyncClient(
        transport=httpx2.MockTransport(lambda _: pytest.fail("Network"))
    ) as http:
        adapter = PydanticReadingAI(settings, http)
        monkeypatch.setattr(adapter, "resolve", lambda *_: FunctionModel(respond))
        client.app.state.ai = adapter
        response = client.post(
            "/api/reading/analyses",
            json=analysis_request
            | {"model": "gpt-6-luna", "thinking": "max", "mode": "guided", "attempt": ""},
        )
    assert response.status_code == 201, response.text
    assert requests == 2
    saved = client.get(f"/api/documents/{analysis_request['document_id']}").json()["analyses"]
    assert len(saved) == 1
    assert saved[0]["output"]["reading_map"] == valid.reading_map.model_dump()


@pytest.mark.parametrize("kind", ["analysis", "guided", "feedback"])
async def test_server_builds_original_language_quotes_without_model_retyping(
    settings, monkeypatch, kind, caplog
):
    source = "El piloto incluyó veinte voluntarios."
    valid = (
        analysis_output()
        if kind == "analysis"
        else guided_output()
        if kind == "guided"
        else FeedbackOutput(
            answer="A limited pilot.",
            citations=[Citation(page=1, quote=source)],
            limitation="A pilot.",
        )
    )
    if isinstance(valid, AnalysisOutput):
        for insight in valid.insights:
            assert insight.author_excerpt is not None
            insight.author_excerpt.quote = source
        if isinstance(valid, GuidedAnalysisOutput):
            valid.reading_map.annotations[0].citation.quote = source
    requests = 0

    def respond(messages, info):
        nonlocal requests
        requests += 1
        return ModelResponse(
            parts=[ToolCallPart(info.output_tools[0].name, referenced_output(valid))]
        )

    monkeypatch.setattr(models, "ALLOW_MODEL_REQUESTS", True)
    async with httpx2.AsyncClient() as http:
        result = await PydanticReadingAI(settings, http).run_output(
            FunctionModel(respond), type(valid), {"source_pages": {1: source}}
        )
    assert result == valid
    assert requests == 1
    assert source not in caplog.text
    assert QUOTE not in caplog.text


@pytest.mark.parametrize("last_failure", ["reference", "outside_scope", "schema"])
async def test_failed_correction_is_bounded_and_nothing_is_saved(
    workspace, analysis_request, monkeypatch, last_failure
):
    client, _ = workspace
    requests = 0

    def respond(messages, info):
        nonlocal requests
        requests += 1
        output = referenced_output(guided_output(), "p99-s1")
        if requests == 2:
            if last_failure == "schema":
                output = {}
            elif last_failure == "outside_scope":
                output = referenced_output(guided_output(), "p2-s1")
        return ModelResponse(parts=[ToolCallPart(info.output_tools[0].name, output)])

    monkeypatch.setattr(models, "ALLOW_MODEL_REQUESTS", True)
    async with httpx2.AsyncClient() as http:
        adapter = PydanticReadingAI(client.app.state.settings, http)
        monkeypatch.setattr(adapter, "resolve", lambda *_: FunctionModel(respond))
        client.app.state.ai = adapter
        response = client.post(
            "/api/reading/analyses",
            json=analysis_request | {"mode": "guided", "attempt": ""},
        )
    assert requests == 2
    assert response.status_code == (503 if last_failure == "schema" else 502)
    assert "p99-s1" not in response.text
    assert client.get(f"/api/documents/{analysis_request['document_id']}").json()["analyses"] == []


@pytest.mark.parametrize("first_failure", ["reference", "schema"])
async def test_format_and_source_validation_share_one_retry_budget(
    settings, monkeypatch, first_failure
):
    invalid = referenced_output(analysis_output(), "p99-s1")
    requests = 0

    def respond(messages, info):
        nonlocal requests
        requests += 1
        output = {} if requests == 1 and first_failure == "schema" else invalid
        return ModelResponse(parts=[ToolCallPart(info.output_tools[0].name, output)])

    monkeypatch.setattr(models, "ALLOW_MODEL_REQUESTS", True)
    async with httpx2.AsyncClient() as http:
        with pytest.raises(SourceCitationError):
            await PydanticReadingAI(settings, http).run_output(
                FunctionModel(respond), AnalysisOutput, {"source_pages": {1: QUOTE}}
            )
    assert requests == 2


async def test_provider_failure_after_source_retry_keeps_its_status(settings, monkeypatch):
    invalid = referenced_output(analysis_output(), "p99-s1")
    requests = 0

    def respond(messages, info):
        nonlocal requests
        requests += 1
        if requests == 2:
            raise ModelHTTPError(429, model_name="test", body={"private": "private-response"})
        return ModelResponse(parts=[ToolCallPart(info.output_tools[0].name, invalid)])

    monkeypatch.setattr(models, "ALLOW_MODEL_REQUESTS", True)
    async with httpx2.AsyncClient() as http:
        with pytest.raises(AIUnavailable, match="quota or rate limit") as error:
            await PydanticReadingAI(settings, http).run_output(
                FunctionModel(respond), AnalysisOutput, {"source_pages": {1: QUOTE}}
            )
    assert requests == 2
    assert "private-response" not in str(error.value)
