from typing import Literal
from uuid import UUID

from pydantic import Field, model_validator

from essence.documents.schemas import StrictModel
from essence.reading.thinking import Thinking, validate_thinking

Lens = Literal["problem", "method", "evidence", "argument"]
Role = Literal["problem", "contribution", "approach", "evidence", "limits"]
Provider = Literal["openai", "google", "anthropic"]


class Citation(StrictModel):
    page: int = Field(ge=1, le=1500)
    quote: str = Field(min_length=8, max_length=1200)


class SourceReference(StrictModel):
    passage_id: str = Field(min_length=1, max_length=32)


class Insight[C: StrictModel = Citation](StrictModel):
    lens: Lens
    author_excerpt: C | None
    interpretation: str = Field(min_length=1, max_length=2400)
    limitation: str = Field(min_length=1, max_length=1600)


class AnalysisOutput[C: StrictModel = Citation](StrictModel):
    insights: list[Insight[C]] = Field(min_length=4, max_length=4)
    learning_feedback: str = Field(min_length=1, max_length=2200)
    next_question: str = Field(min_length=1, max_length=700)

    @model_validator(mode="after")
    def four_lenses(self):
        if {i.lens for i in self.insights} != {"problem", "method", "evidence", "argument"}:
            raise ValueError("Each critical-reading lens must appear exactly once.")
        return self


class Annotation[C: StrictModel = Citation](StrictModel):
    role: Role
    title: str = Field(min_length=1, max_length=100)
    citation: C
    explanation: str = Field(min_length=1, max_length=800)
    caveat: str = Field(min_length=1, max_length=400)
    question: str = Field(min_length=1, max_length=250)


class RoleGap(StrictModel):
    role: Role
    reason: str = Field(min_length=1, max_length=400)


class ReadingMap[C: StrictModel = Citation](StrictModel):
    version: Literal["annotated-reading-v1"] = "annotated-reading-v1"
    overview: str = Field(min_length=1, max_length=1000)
    annotations: list[Annotation[C]] = Field(max_length=8)
    gaps: list[RoleGap] = Field(max_length=5)

    @model_validator(mode="after")
    def explicit_coverage(self):
        observed = {annotation.role for annotation in self.annotations}
        missing = {gap.role for gap in self.gaps}
        if len(missing) != len(self.gaps) or observed & missing:
            raise ValueError("Each missing role must be explicit and not also annotated.")
        if observed | missing != {"problem", "contribution", "approach", "evidence", "limits"}:
            raise ValueError("Each argument role must have an excerpt or an explicit gap.")
        return self


class GuidedAnalysisOutput[C: StrictModel = Citation](AnalysisOutput[C]):
    reading_map: ReadingMap[C]


class FeedbackOutput[C: StrictModel = Citation](StrictModel):
    answer: str = Field(min_length=1, max_length=3200)
    citations: list[C] = Field(max_length=5)
    limitation: str = Field(min_length=1, max_length=1200)


class Destination(StrictModel):
    provider: Provider
    model: str = Field(min_length=1, max_length=180)
    consent: Literal[True]
    thinking: Thinking = "default"

    @model_validator(mode="after")
    def supported_thinking(self):
        validate_thinking(self.provider, self.model, self.thinking)
        return self


class AnalysisInput(Destination):
    document_id: UUID
    page_start: int = Field(ge=1, le=1500)
    page_end: int = Field(ge=1, le=1500)
    mode: Literal["reflection", "guided"] = "reflection"
    attempt: str = Field(default="", max_length=4000)

    @model_validator(mode="after")
    def bounded_scope(self):
        if not 0 <= self.page_end - self.page_start < 20:
            raise ValueError("Select an ordered range of at most 20 pages.")
        if self.mode == "reflection" and len(self.attempt.strip()) < 20:
            raise ValueError("A reflection reading requires a learner attempt.")
        if self.mode == "guided" and self.attempt:
            raise ValueError("Guided reading starts without inventing a learner attempt.")
        return self


class AnnotationContext(StrictModel):
    role: Role | Lens | None = None
    citation: Citation


class FeedbackInput(Destination):
    question: str = Field(min_length=8, max_length=2000)
    context: AnnotationContext | None = None
