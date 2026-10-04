import httpx2
import pytest
from conftest import QUOTE, analysis_output, referenced_output
from pydantic_ai import models
from pydantic_ai.exceptions import UsageLimitExceeded
from pydantic_ai.messages import ModelResponse, ToolCallPart
from pydantic_ai.models.function import FunctionModel

from essence.reading.ai import AIUnavailable, PydanticReadingAI
from essence.reading.schemas import AnalysisOutput


@pytest.mark.parametrize(
    "failure,message,reason,attempts",
    [
        ("length", "output-token limit", "output_limit", 1),
        ("refusal", "declined this request", "refusal", 1),
        ("schema", "required reading format", "output_validation", 2),
        ("budget", "usage budget", "usage_limit", 1),
        ("internal", "reading service could not complete", "request_failed", 1),
    ],
)
async def test_generation_failures_have_specific_private_safe_diagnostics(
    settings, caplog, failure, message, reason, attempts
):
    calls = 0
    private = "secret-key confidential source private-provider-body"

    def respond(messages, info):
        nonlocal calls
        calls += 1
        if failure == "budget":
            raise UsageLimitExceeded(private)
        if failure == "internal":
            raise RuntimeError(private)
        return ModelResponse(
            parts=[ToolCallPart(info.output_tools[0].name, {})] if failure == "schema" else [],
            finish_reason="length"
            if failure == "length"
            else "content_filter"
            if failure == "refusal"
            else "stop",
            provider_details={"private": private},
            model_name="private-model-name",
        )

    async with httpx2.AsyncClient() as client:
        with pytest.raises(AIUnavailable, match=message) as error:
            await PydanticReadingAI(settings, client).run_output(
                FunctionModel(respond),
                AnalysisOutput,
                {"task": "analysis", "source_pages": {1: QUOTE}},
            )
    assert calls == attempts
    assert f"reason={reason}" in caplog.text
    for value in (private, "private-model-name", QUOTE):
        assert value not in str(error.value)
        assert value not in caplog.text


async def test_complete_verified_output_is_not_rejected_only_for_length_finish_reason(settings):
    output = analysis_output()

    def respond(messages, info):
        return ModelResponse(
            parts=[ToolCallPart(info.output_tools[0].name, referenced_output(output))],
            finish_reason="length",
        )

    async with httpx2.AsyncClient() as client:
        result = await PydanticReadingAI(settings, client).run_output(
            FunctionModel(respond), AnalysisOutput, {"task": "analysis", "source_pages": {1: QUOTE}}
        )
    assert result == output


@pytest.mark.parametrize(
    "provider,model,thinking",
    [("openai", "gpt-6-luna", "max"), ("google", "gemini-3.8-flash", "medium")],
)
async def test_actual_sdk_token_limit_metadata_is_classified_without_an_extra_request(
    settings, monkeypatch, caplog, provider, model, thinking
):
    monkeypatch.setattr(models, "ALLOW_MODEL_REQUESTS", True)
    getattr(settings, f"{provider}_models").append(model)
    calls = 0

    def respond(request):
        nonlocal calls
        calls += 1
        if provider == "openai":
            assert request.url.path == "/v1/responses"
            body = {
                "id": "resp_test",
                "object": "response",
                "created_at": 1,
                "status": "incomplete",
                "model": model,
                "output": [],
                "incomplete_details": {"reason": "max_output_tokens"},
                "usage": {
                    "input_tokens": 20,
                    "output_tokens": 6000,
                    "total_tokens": 6020,
                    "input_tokens_details": {"cached_tokens": 0},
                    "output_tokens_details": {"reasoning_tokens": 6000},
                },
            }
        else:
            assert request.url.path.endswith(":generateContent")
            body = {
                "candidates": [
                    {"content": {"role": "model", "parts": []}, "finishReason": "MAX_TOKENS"}
                ],
                "usageMetadata": {
                    "promptTokenCount": 20,
                    "candidatesTokenCount": 6000,
                    "totalTokenCount": 6020,
                },
            }
        return httpx2.Response(200, json=body)

    async with httpx2.AsyncClient(transport=httpx2.MockTransport(respond)) as client:
        with pytest.raises(AIUnavailable, match="output-token limit"):
            await PydanticReadingAI(settings, client).guide(provider, model, {1: QUOTE}, thinking)
    assert calls == 1
    assert "reason=output_limit" in caplog.text
    assert "finish_reason=length" in caplog.text
    assert QUOTE not in caplog.text
