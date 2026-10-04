from pydantic import BaseModel, ConfigDict, Field, model_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class PageInput(StrictModel):
    number: int = Field(ge=1, le=1500)
    text: str = Field(max_length=60000)


class DocumentInput(StrictModel):
    title: str = Field(min_length=1, max_length=240)
    filename: str = Field(min_length=1, max_length=240)
    total_pages: int = Field(ge=1, le=1500)
    pages: list[PageInput] = Field(min_length=1, max_length=1500)

    @model_validator(mode="after")
    def complete_text(self):
        if [p.number for p in self.pages] != list(range(1, self.total_pages + 1)):
            raise ValueError(
                "All pages must be included in order; never silently truncate documents."
            )
        length = sum(len(p.text) for p in self.pages)
        if length > 3_000_000 or length < 20:
            raise ValueError(
                "Extracted text must contain 20–3,000,000 characters; OCR is unavailable."
            )
        return self
