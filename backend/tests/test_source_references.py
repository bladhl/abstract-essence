import json

import httpx2
import pytest
from conftest import guided_output
from pydantic_ai import models
from pydantic_ai.messages import ModelResponse, ToolCallPart
from pydantic_ai.models.function import FunctionModel

from essence.reading.ai import PydanticReadingAI
from essence.reading.evidence import SourceCitationError, verify_output
from essence.reading.schemas import Citation, GuidedAnalysisOutput, SourceReference
from essence.reading.source_catalog import (
    PASSAGE_CHARACTERS,
    hydrate_references,
    passage_payload,
    source_passages,
)


def referenced_guided_output(passage_id="p1-s1"):
    output = guided_output().model_dump()
    for insight in output["insights"]:
        insight["author_excerpt"] = {"passage_id": passage_id}
    for annotation in output["reading_map"]["annotations"]:
        annotation["citation"] = {"passage_id": passage_id}
    return output


async def test_six_page_scope_uses_source_references_and_saves_only_original_quotations(
    workspace, monkeypatch
):
    client, _ = workspace
    sentence = "El piloto incluyó veinte voluntarios. La muestra no demuestra causalidad.\n"
    text = (sentence * 300)[:17488]
    page_texts = [text[number * 3000 : (number + 1) * 3000].strip() for number in range(6)]
    # Match the stored-text boundary: import already strips page-edge whitespace.
    page_texts[-1] += "x" * (17488 - sum(len(page) for page in page_texts))
    pages = [{"number": number + 1, "text": page} for number, page in enumerate(page_texts)]
    assert sum(len(page) for page in page_texts) == 17488
    document = client.post(
        "/api/documents",
        json={
            "title": "Synthetic Spanish source",
            "filename": "synthetic.pdf",
            "total_pages": 6,
            "pages": pages,
        },
    ).json()
    calls = 0
    inputs = []

    def respond(messages, info):
        nonlocal calls
        calls += 1
        inputs.append(json.loads(messages[0].parts[-1].content))
        return ModelResponse(
            parts=[ToolCallPart(info.output_tools[0].name, referenced_guided_output())]
        )

    monkeypatch.setattr(models, "ALLOW_MODEL_REQUESTS", True)
    settings = client.app.state.settings
    settings.openai_models.append("gpt-6-luna")
    async with httpx2.AsyncClient(
        transport=httpx2.MockTransport(lambda _: pytest.fail("Network"))
    ) as http:
        adapter = PydanticReadingAI(settings, http)
        monkeypatch.setattr(adapter, "resolve", lambda *_: FunctionModel(respond))
        client.app.state.ai = adapter
        result = client.post(
            "/api/reading/analyses",
            json={
                "document_id": document["id"],
                "provider": "openai",
                "model": "gpt-6-luna",
                "thinking": "max",
                "consent": True,
                "mode": "guided",
                "page_start": 1,
                "page_end": 6,
            },
        )
    assert result.status_code == 201, result.text
    assert calls == 1
    assert "source_pages" not in inputs[0]
    for page in pages:
        assert (
            "".join(
                part["text"]
                for part in inputs[0]["source_passages"]
                if part["page"] == page["number"]
            )
            == page["text"]
        )
    citation = result.json()["output"]["reading_map"]["annotations"][0]["citation"]
    assert citation["page"] == 1
    assert citation["quote"] in page_texts[0]
    assert citation["quote"].startswith("El piloto incluyó veinte voluntarios.")
    assert "passage_id" not in result.text
    exported = client.get(f"/api/documents/{document['id']}/export").json()
    assert (
        exported["analyses"][0]["output"]["reading_map"]["annotations"][0]["citation"] == citation
    )


@pytest.mark.parametrize(
    "text",
    [
        "x" * 60000,
        "    \t\n" * 1000,
        "ofﬁce inter-\nvention\u00ad\u00a0中文 العربية\r\n" * 100,
        "The same short sentence. " * 1000,
        "tiny",
        "",
    ],
)
def test_source_partition_never_duplicates_omits_or_changes_text(text):
    pages = {9: text, 2: "An independent physical source page."}
    passages = source_passages(pages)
    assert passages == source_passages(pages)
    assert len({p.passage_id for p in passages}) == len(passages)
    assert all(len(p.text) <= PASSAGE_CHARACTERS for p in passages)
    for page, original in pages.items():
        assert "".join(p.text for p in passages if p.page == page) == original
    assert sum(len(p.text) for p in passages) == sum(len(p) for p in pages.values())


@pytest.mark.parametrize("passage_id", ["p99-s1", "p0-s0", "private-ref-value"])
def test_unknown_reference_cannot_create_a_citation(passage_id):
    catalog = {p.passage_id: p for p in source_passages({1: "A real source passage."})}
    with pytest.raises(SourceCitationError) as error:
        hydrate_references({"passage_id": passage_id}, catalog)
    assert passage_id not in str(error.value)


@pytest.mark.parametrize("text", ["tiny", "    \t\n"])
def test_non_citable_context_is_sent_but_cannot_be_quoted(text):
    passages = source_passages({1: text})
    assert passage_payload(passages)[0]["text"] == text
    assert passage_payload(passages)[0]["can_cite"] is False
    with pytest.raises(SourceCitationError):
        hydrate_references({"passage_id": "p1-s1"}, {p.passage_id: p for p in passages})


def test_model_reference_schema_does_not_accept_generated_page_or_quote():
    from pydantic import ValidationError

    valid = referenced_guided_output()
    assert GuidedAnalysisOutput[SourceReference].model_validate(valid)
    valid["reading_map"]["annotations"][0]["citation"] = {
        "passage_id": "p1-s1",
        "page": 1500,
        "quote": "An invented quotation.",
    }
    with pytest.raises(ValidationError):
        GuidedAnalysisOutput[SourceReference].model_validate(valid)


def test_hydration_keeps_pdf_artifacts_and_uses_physical_page_from_catalog():
    text = "El estudio de inter-\nvención utiliza una ligadura ﬁ y un espacio\u00a0no separable."
    passages = source_passages({6: text})
    public = GuidedAnalysisOutput.model_validate(
        hydrate_references(referenced_guided_output("p6-s1"), {p.passage_id: p for p in passages})
    )
    verify_output(public, {6: text})
    assert public.reading_map.annotations[0].citation == Citation(page=6, quote=text)
    assert "passage_id" not in public.model_dump_json()


@pytest.mark.parametrize("reference,expected", [("p1-s1", 201), ("p2-s1", 502)])
async def test_question_references_are_bound_to_the_saved_reading_and_export_literals(
    workspace, analysis_request, monkeypatch, reference, expected
):
    client, _ = workspace
    reading = client.post("/api/reading/analyses", json=analysis_request).json()
    original = reading["output"]["insights"][0]["author_excerpt"]
    calls = 0

    def respond(messages, info):
        nonlocal calls
        calls += 1
        return ModelResponse(
            parts=[
                ToolCallPart(
                    info.output_tools[0].name,
                    {
                        "answer": "The passage describes a pilot, not a causal conclusion.",
                        "citations": [{"passage_id": reference}],
                        "limitation": "Only the saved scope.",
                    },
                )
            ]
        )

    monkeypatch.setattr(models, "ALLOW_MODEL_REQUESTS", True)
    settings = client.app.state.settings
    settings.openai_models.append("gpt-6-luna")
    async with httpx2.AsyncClient(
        transport=httpx2.MockTransport(lambda _: pytest.fail("Network"))
    ) as http:
        adapter = PydanticReadingAI(settings, http)
        monkeypatch.setattr(adapter, "resolve", lambda *_: FunctionModel(respond))
        client.app.state.ai = adapter
        result = client.post(
            f"/api/reading/analyses/{reading['id']}/feedback",
            json={
                "provider": "openai",
                "model": "gpt-6-luna",
                "thinking": "max",
                "consent": True,
                "question": "What does this passage establish?",
                "context": {"role": "approach", "citation": original},
            },
        )
    assert result.status_code == expected, result.text
    saved = client.get(f"/api/reading/analyses/{reading['id']}/feedback").json()
    if expected == 201:
        assert calls == 1
        assert saved[0]["output"]["citations"] == [original]
        assert "passage_id" not in result.text
        exported = client.get(f"/api/documents/{analysis_request['document_id']}/export").json()
        assert exported["feedback"][0]["output"]["citations"] == [original]
    else:
        assert calls == 2
        assert saved == []
        assert "unavailable in this saved reading" in result.text
