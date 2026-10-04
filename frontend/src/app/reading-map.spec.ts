import { initialScope, sourceAnnotations } from './reading-map';
import type { Analysis } from './models';

describe('reading map scope and legacy compatibility', () => {
  it('covers a fitting full document and bounds a long document explicitly by pages and characters', () => {
    expect(
      initialScope([
        { number: 1, text: 'a'.repeat(40) },
        { number: 2, text: 'b'.repeat(40) },
      ]),
    ).toEqual({ page_start: 1, page_end: 2 });
    expect(
      initialScope(Array.from({ length: 35 }, (_, i) => ({ number: i + 1, text: 'a'.repeat(10) }))),
    ).toEqual({ page_start: 1, page_end: 20 });
    expect(
      initialScope([
        { number: 1, text: 'a'.repeat(40000) },
        { number: 2, text: 'b'.repeat(40000) },
      ]),
    ).toEqual({ page_start: 1, page_end: 1 });
  });
  it('projects only actual legacy source excerpts, never new roles', () => {
    const analysis = {
      id: 'old',
      output: {
        insights: [
          {
            lens: 'problem',
            author_excerpt: { page: 1, quote: 'A real problem.' },
            interpretation: 'Existing explanation.',
            limitation: 'Existing caveat.',
          },
          {
            lens: 'method',
            author_excerpt: null,
            interpretation: 'Not shown.',
            limitation: 'Partial scope.',
          },
        ],
        next_question: 'What can we infer?',
      },
    } as Analysis;
    expect(sourceAnnotations(analysis).map((a) => a.role)).toEqual(['problem']);
    expect(sourceAnnotations(analysis)[0].explanation).toBe('Existing explanation.');
  });
});
