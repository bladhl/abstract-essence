from dataclasses import dataclass
from typing import TypedDict

from pydantic import JsonValue

from essence.reading.evidence import SourceCitationError, normalize
from essence.reading.schemas import Citation

PASSAGE_CHARACTERS = 700


class SourcePassagePayload(TypedDict):
    passage_id: str
    page: int
    text: str
    can_cite: bool


@dataclass(frozen=True)
class SourcePassage:
    passage_id: str
    page: int
    text: str

    @property
    def can_cite(self) -> bool:
        return len(normalize(self.text)) >= 8


def source_passages(pages: dict[int, str]) -> list[SourcePassage]:
    """Partition all selected text into bounded, exact, non-overlapping source spans."""
    passages: list[SourcePassage] = []
    for page, text in sorted(pages.items()):
        start = 0
        sequence = 1
        while start < len(text):
            end = min(start + PASSAGE_CHARACTERS, len(text))
            if end < len(text):
                floor = start + PASSAGE_CHARACTERS // 2
                # Keep the delimiter in the span so concatenation reconstructs the page.
                boundary = text.rfind("\n", floor, end)
                if boundary < 0:
                    boundary = text.rfind(" ", floor, end)
                if boundary >= 0:
                    end = boundary + 1
            passages.append(SourcePassage(f"p{page}-s{sequence}", page, text[start:end]))
            start, sequence = end, sequence + 1
    return passages


def passage_payload(passages: list[SourcePassage]) -> list[SourcePassagePayload]:
    return [
        {"passage_id": p.passage_id, "page": p.page, "text": p.text, "can_cite": p.can_cite}
        for p in passages
    ]


def hydrate_references(value: JsonValue, passages: dict[str, SourcePassage]) -> JsonValue:
    """Resolve model selections; the model never supplies quotation wording or page numbers."""
    if isinstance(value, dict):
        if set(value) == {"passage_id"}:
            reference = value["passage_id"]
            passage = passages.get(reference) if isinstance(reference, str) else None
            if passage is None or not passage.can_cite:
                raise SourceCitationError(None)
            return Citation(page=passage.page, quote=passage.text.strip()).model_dump()
        return {key: hydrate_references(item, passages) for key, item in value.items()}
    if isinstance(value, list):
        return [hydrate_references(item, passages) for item in value]
    return value
