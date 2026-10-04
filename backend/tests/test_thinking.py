import json
from unittest.mock import AsyncMock

import httpx2
import pytest
from conftest import QUOTE, analysis_output, guided_output, referenced_output
from google.genai import _api_client, errors
from google.genai.types import HttpRetryOptions
from pydantic_ai import models
from pydantic_ai.providers.google import GoogleProvider
from sqlmodel import Session

from essence.infra.models import Analysis
from essence.reading.ai import (
    AIUnavailable,
    PydanticReadingAI,
    configured_choices,
    ensure_destination,
)
from essence.reading.schemas import AnalysisInput, FeedbackOutput
from essence.reading.thinking import thinking_levels

MODEL = "gemini-3.8-flash"


@pytest.mark.parametrize(
    "provider,model,expected",
    [
        ("google", MODEL, ["default", "low", "medium", "high"]),
        ("google", f"models/{MODEL}", ["default", "low", "medium", "high"]),
        ("google", "gemini-3-pro-preview", ["default", "low", "high"]),
        ("google", "gemini-2.5-flash", ["default"]),
        ("google", "unknown-model", ["default"]),
        ("openai", "gpt-6-luna", ["default", "low", "medium", "high", "xhigh", "max"]),
        ("openai", "unverified-model", ["default"]),
        ("anthropic", "unverified-model", ["default"]),
    ],
)
def test_only_explicit_profile_levels_are_exposed(provider, model, expected):
    assert thinking_levels(provider, model) == expected


def test_capabilities_do_not_change_destination_allowlist(settings):
    settings.google_models = [MODEL]
    choices = configured_choices(settings)
    assert next(c for c in choices if c["provider"] == "google")["thinking_levels"] == [
        "default",
        "low",
        "medium",
        "high",
    ]
    ensure_destination(settings, "google", MODEL)
    with pytest.raises(AIUnavailable, match="No data was sent"):
        ensure_destination(settings, "google", "unconfigured")


@pytest.mark.parametrize("mode", ["guided", "reflection"])
@pytest.mark.parametrize(
    "provider,model,thinking",
    [("google", MODEL, level) for level in ("default", "low", "medium", "high")]
    + [("openai", "gpt-6-luna", "max")],
)
def test_route_carries_thinking_and_server_owned_metadata(
    workspace, analysis_request, mode, provider, model, thinking
):
    client, ai = workspace
    getattr(client.app.state.settings, f"{provider}_models").append(model)
    body = analysis_request | {
        "provider": provider,
        "model": model,
        "mode": mode,
        "thinking": thinking,
    }
    if mode == "guided":
        body["attempt"] = ""
    result = client.post("/api/reading/analyses", json=body)
    assert result.status_code == 201, result.text
    item = result.json()
    assert ai.thinking_calls == [thinking]
    assert item["output"]["request_settings"] == {"thinking": thinking}
    assert "thinking" not in item
    context = {"role": "approach", "citation": {"page": 1, "quote": QUOTE}}
    reply = client.post(
        f"/api/reading/analyses/{item['id']}/feedback",
        json={
            "provider": provider,
            "model": model,
            "thinking": thinking,
            "consent": True,
            "question": "Why is this method relevant?",
            "context": context,
        },
    )
    assert reply.status_code == 201, reply.text
    assert ai.thinking_calls == [thinking, thinking]
    assert reply.json()["output"]["request_settings"] == {"thinking": thinking}
    assert reply.json()["output"]["request_context"] == context
    exported = client.get(f"/api/documents/{item['document_id']}/export").json()
    assert exported["analyses"][0]["output"]["request_settings"] == {"thinking": thinking}
    assert exported["feedback"][0]["output"]["request_settings"] == {"thinking": thinking}


@pytest.mark.parametrize(
    "provider,model,thinking",
    [
        ("google", MODEL, "minimal"),
        ("google", MODEL, "max"),
        ("google", MODEL, "xhigh"),
        ("google", "test-model", "medium"),
        ("google", "gemini-3-pro-preview", "medium"),
        ("openai", "test-model", "high"),
        ("anthropic", "test-model", "low"),
    ],
)
def test_unsupported_thinking_fails_before_limiter_or_provider(
    workspace, analysis_request, provider, model, thinking
):
    client, ai = workspace
    client.app.state.settings.google_models.extend([MODEL, "gemini-3-pro-preview"])
    limiter = AsyncMock()
    client.app.state.limiter.acquire = limiter
    body = analysis_request | {"provider": provider, "model": model, "thinking": thinking}
    assert client.post("/api/reading/analyses", json=body).status_code == 422
    assert ai.calls == []
    limiter.assert_not_called()
    item = client.post("/api/reading/analyses", json=analysis_request).json()
    count = len(ai.calls)
    limiter.reset_mock()
    response = client.post(
        f"/api/reading/analyses/{item['id']}/feedback",
        json={
            "provider": provider,
            "model": model,
            "thinking": thinking,
            "consent": True,
            "question": "Why use this method?",
        },
    )
    assert response.status_code == 422
    assert len(ai.calls) == count
    limiter.assert_not_called()


def test_omitted_thinking_defaults_but_legacy_records_are_not_rewritten(
    workspace, analysis_request
):
    client, ai = workspace
    with Session(client.app.state.engine) as session:
        legacy = Analysis(
            **AnalysisInput.model_validate(analysis_request).model_dump(
                exclude={"consent", "mode", "thinking"}
            ),
            output=analysis_output().model_dump(),
        )
        session.add(legacy)
        session.commit()
    response = client.post("/api/reading/analyses", json=analysis_request)
    assert response.status_code == 201
    assert ai.thinking_calls == ["default"]
    assert response.json()["output"]["request_settings"] == {"thinking": "default"}
    exported = client.get(f"/api/documents/{analysis_request['document_id']}/export").json()
    assert "request_settings" not in exported["analyses"][0]["output"]


@pytest.mark.parametrize("operation", ["guide", "analyze", "feedback"])
@pytest.mark.parametrize("thinking", ["default", "low", "medium", "high"])
async def test_real_google_sdk_serializes_selected_thinking_offline(
    settings, monkeypatch, operation, thinking
):
    monkeypatch.setattr(models, "ALLOW_MODEL_REQUESTS", True)
    settings.google_models = [MODEL]
    output = (
        guided_output()
        if operation == "guide"
        else analysis_output()
        if operation == "analyze"
        else FeedbackOutput(
            answer="The scope does not establish causality.", citations=[], limitation="A pilot."
        )
    )
    requests = []

    def respond(request):
        body = json.loads(request.content)
        requests.append(body)
        assert request.url.path.endswith(f"{MODEL}:generateContent")
        declaration = body["tools"][0]["functionDeclarations"][0]
        assert declaration["parameters_json_schema"]["type"] == "object"
        assert body["generationConfig"]["maxOutputTokens"] == 6000
        if thinking == "default":
            assert "thinkingConfig" not in body["generationConfig"]
        else:
            assert body["generationConfig"]["thinkingConfig"] == {
                "thinking_level": thinking.upper()
            }
        return httpx2.Response(
            200,
            json={
                "candidates": [
                    {
                        "content": {
                            "role": "model",
                            "parts": [
                                {
                                    "functionCall": {
                                        "name": declaration["name"],
                                        "args": referenced_output(output),
                                    }
                                }
                            ],
                        },
                        "finishReason": "STOP",
                    }
                ],
                "usageMetadata": {
                    "promptTokenCount": 20,
                    "candidatesTokenCount": 40,
                    "totalTokenCount": 60,
                },
            },
        )

    async with httpx2.AsyncClient(transport=httpx2.MockTransport(respond)) as client:
        adapter = PydanticReadingAI(settings, client)
        if operation == "guide":
            result = await adapter.guide("google", MODEL, {1: QUOTE}, thinking=thinking)
        elif operation == "analyze":
            result = await adapter.analyze("google", MODEL, {1: QUOTE}, "My attempt.", thinking)
        else:
            result = await adapter.feedback(
                "google",
                MODEL,
                {1: QUOTE},
                "Why?",
                analysis_output().model_dump(),
                {"role": "approach", "citation": {"page": 1, "quote": QUOTE}},
                thinking,
            )
    assert result == output
    assert len(requests) == 1
    text = requests[0]["contents"][0]["parts"][0]["text"]
    assert json.loads(text)["source_passages"] == [
        {"passage_id": "p1-s1", "page": 1, "text": QUOTE, "can_cite": True}
    ]
    assert "source_pages" not in json.loads(text)
    assert not requests[0]["generationConfig"].get("responseMimeType")


@pytest.mark.parametrize("operation", ["guide", "analyze", "feedback"])
@pytest.mark.parametrize("thinking", ["default", "max"])
async def test_real_openai_sdk_sends_luna_reasoning_to_responses_offline(
    settings, monkeypatch, operation, thinking
):
    monkeypatch.setattr(models, "ALLOW_MODEL_REQUESTS", True)
    settings.openai_models = ["gpt-6-luna"]
    output = (
        guided_output()
        if operation == "guide"
        else analysis_output()
        if operation == "analyze"
        else FeedbackOutput(
            answer="The scope does not establish causality.", citations=[], limitation="A pilot."
        )
    )
    requests = []

    def respond(request):
        assert request.url.host == "api.openai.com"
        assert request.url.path == "/v1/responses"
        body = json.loads(request.content)
        requests.append(body)
        assert body["model"] == "gpt-6-luna"
        assert body["max_output_tokens"] == 6000
        if thinking == "default":
            assert not body.get("reasoning", {}).get("effort")
        else:
            assert body["reasoning"]["effort"] == "max"
        assert "google_thinking_config" not in body
        declaration = body["tools"][0]
        return httpx2.Response(
            200,
            json={
                "id": "resp_test",
                "object": "response",
                "created_at": 1,
                "status": "completed",
                "model": "gpt-6-luna",
                "output": [
                    {
                        "id": "fc_test",
                        "type": "function_call",
                        "call_id": "call_test",
                        "name": declaration["name"],
                        "arguments": json.dumps(referenced_output(output)),
                        "status": "completed",
                    }
                ],
                "usage": {
                    "input_tokens": 20,
                    "output_tokens": 40,
                    "total_tokens": 60,
                    "input_tokens_details": {"cached_tokens": 0},
                    "output_tokens_details": {"reasoning_tokens": 8},
                },
            },
        )

    async with httpx2.AsyncClient(transport=httpx2.MockTransport(respond)) as client:
        adapter = PydanticReadingAI(settings, client)
        if operation == "guide":
            result = await adapter.guide("openai", "gpt-6-luna", {1: QUOTE}, thinking)
        elif operation == "analyze":
            result = await adapter.analyze(
                "openai", "gpt-6-luna", {1: QUOTE}, "My attempt.", thinking
            )
        else:
            result = await adapter.feedback(
                "openai",
                "gpt-6-luna",
                {1: QUOTE},
                "Why?",
                analysis_output().model_dump(),
                thinking=thinking,
            )
    assert result == output
    assert len(requests) == 1


async def test_google_503_has_one_http_attempt_and_private_safe_diagnostics(
    settings, monkeypatch, caplog
):
    monkeypatch.setattr(models, "ALLOW_MODEL_REQUESTS", True)
    settings.google_models = [MODEL]
    calls = 0

    def fail(request):
        nonlocal calls
        calls += 1
        return httpx2.Response(
            503,
            json={
                "error": {
                    "code": 503,
                    "status": "UNAVAILABLE",
                    "message": "secret-key confidential source",
                }
            },
            headers={"private-header": "private-auth-token"},
        )

    async with httpx2.AsyncClient(transport=httpx2.MockTransport(fail)) as client:
        with pytest.raises(AIUnavailable, match="Provider HTTP 503") as error:
            await PydanticReadingAI(settings, client).guide(
                "google", MODEL, {1: QUOTE}, thinking="medium"
            )
    assert calls == 1
    assert "operation=guided_reading provider=google thinking=medium http_status=503" in caplog.text
    for private in ("secret-key", "confidential", "private-auth-token", QUOTE):
        assert private not in str(error.value)
        assert private not in caplog.text


def test_installed_sdk_distinguishes_none_and_empty_retry_options():
    # None already means one attempt; five is the empty-options default, not our old policy.
    assert _api_client.retry_args(None)["stop"].max_attempt_number == 1
    assert _api_client.retry_args(HttpRetryOptions())["stop"].max_attempt_number == 5
    assert _api_client.retry_args(HttpRetryOptions(attempts=1))["stop"].max_attempt_number == 1


async def test_existing_google_none_retry_policy_makes_one_attempt_offline():
    calls = 0

    def fail(request):
        nonlocal calls
        calls += 1
        return httpx2.Response(503, json={"error": {"code": 503, "message": "Synthetic error"}})

    async with httpx2.AsyncClient(transport=httpx2.MockTransport(fail)) as client:
        provider = GoogleProvider(api_key="synthetic-key", http_client=client)
        with pytest.raises(errors.ServerError):
            await provider.client.aio.models.generate_content(model=MODEL, contents="Synthetic")
    assert calls == 1
