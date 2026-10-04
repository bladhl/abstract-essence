import { lensTitles, type Analysis, type AnnotationView, type SourcePage } from './models';

/** Project old readings honestly: no new contribution/limit claims are invented. */
export function sourceAnnotations(analysis: Analysis | null): AnnotationView[] {
  if (!analysis) return [];
  const map = analysis.output.reading_map;
  if (map)
    return map.annotations.map((annotation, index) => ({
      ...annotation,
      id: `${analysis.id}:${index}`,
    }));
  return analysis.output.insights.flatMap((insight) =>
    insight.author_excerpt
      ? [
          {
            id: `${analysis.id}:${insight.lens}`,
            role: insight.lens,
            title: lensTitles[insight.lens],
            citation: insight.author_excerpt,
            explanation: insight.interpretation,
            caveat: insight.limitation,
            question: analysis.output.next_question,
          },
        ]
      : [],
  );
}

/** A complete contiguous section, never an undisclosed text truncation. */
export function initialScope(pages: SourcePage[]): { page_start: number; page_end: number } {
  let length = 0;
  let end = 1;
  for (const page of pages.slice(0, 20)) {
    if (length + page.text.length > 60000) break;
    length += page.text.length;
    end = page.number;
  }
  return { page_start: 1, page_end: end };
}
