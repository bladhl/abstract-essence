import type { AnnotationView } from './models';
import { annotatedSegments, excerptRanges, extractPdf, highlightedParts } from './pdf';

describe('source excerpts', () => {
  it('matches normalized whitespace without changing displayed text', () => {
    expect(highlightedParts('Before. A\n  small pilot. After.', 'A small pilot.')).toEqual({
      before: 'Before. ',
      match: 'A\n  small pilot.',
      after: ' After.',
    });
  });
  it('does not turn a paraphrase into a source excerpt', () => {
    expect(highlightedParts('A small pilot.', 'A large study.').match).toBe('');
  });
  it('does not interpret source HTML', () => {
    expect(highlightedParts('<script>example</script>', 'example').before).toBe('<script>');
  });
  it('rejects empty PDFs before loading the parser', async () => {
    await expect(extractPdf(new File([], 'empty.pdf'), () => {})).rejects.toThrow('30 MB');
  });
});

describe('multiple source annotations', () => {
  const annotation = (id: string, quote: string): AnnotationView => ({
    id,
    role: 'evidence',
    title: id,
    citation: { page: 1, quote },
    explanation: 'A test interpretation.',
    caveat: 'Verify the source.',
    question: 'What supports this?',
  });
  it('retains all overlapping ids and preserves the source exactly', () => {
    const source = 'A small pilot included twenty volunteers.';
    const parts = annotatedSegments(source, [
      annotation('a', 'small pilot included'),
      annotation('b', 'pilot included twenty'),
    ]);
    expect(parts.map((p) => p.text).join('')).toBe(source);
    expect(parts.find((p) => p.text === 'pilot included')?.annotations.map((a) => a.id)).toEqual([
      'a',
      'b',
    ]);
  });
  it('matches repeats and Python whitespace but not a paraphrase or BOM removal', () => {
    expect(
      excerptRanges('A\u0085small\u001cpilot. A\u00a0small\n pilot.', 'A small pilot.'),
    ).toHaveLength(2);
    expect(excerptRanges('A\ufeffsmall pilot.', 'A small pilot.')).toHaveLength(0);
    expect(
      annotatedSegments('A small pilot.', [annotation('a', 'A large study.')]).every(
        (p) => !p.annotations.length,
      ),
    ).toBe(true);
  });
  it('bounds interactive duplicate occurrences on pathological long pages without dropping source text', () => {
    const source = 'a'.repeat(60000);
    const parts = annotatedSegments(
      source,
      Array.from({ length: 8 }, (_, i) => annotation(`${i}`, 'aaaaaaaa')),
    );
    expect(parts.map((p) => p.text).join('')).toBe(source);
    expect(parts.length).toBeLessThan(100);
    expect(excerptRanges(source, 'aaaaaaaa', 31)).toHaveLength(31);
    expect(parts.some((p) => p.annotations.length === 8)).toBe(true);
  });
});
