from essence.reading.schemas import AnalysisOutput, Citation, FeedbackOutput, GuidedAnalysisOutput


class SourceCitationError(ValueError):
    def __init__(self, page: int | None):
        self.page = page
        super().__init__("The assistant returned an excerpt not found on its cited source page.")


def normalize(text: str) -> str:
    return " ".join(text.split())


def verify_citation(citation: Citation, pages: dict[int, str]) -> None:
    quote = normalize(citation.quote)
    if not quote or quote not in normalize(pages.get(citation.page, "")):
        raise SourceCitationError(citation.page)


def verify_output(output: AnalysisOutput | FeedbackOutput, pages: dict[int, str]) -> None:
    citations = (
        [i.author_excerpt for i in output.insights if i.author_excerpt]
        if isinstance(output, AnalysisOutput)
        else output.citations
    )
    if isinstance(output, GuidedAnalysisOutput):
        citations.extend(annotation.citation for annotation in output.reading_map.annotations)
    for citation in citations:
        verify_citation(citation, pages)
