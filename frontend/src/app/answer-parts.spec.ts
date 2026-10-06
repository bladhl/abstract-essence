import { answerParagraphs, passageCitation } from './answer-parts';

describe('passageCitation', () => {
  it('splits pages like the backend: at a newline past the midpoint, else a space', () => {
    const first = `${'a'.repeat(400)}\n${'b'.repeat(400)}`;
    const pages = [{ number: 2, text: first }];
    expect(passageCitation(pages, 'p2-s1')).toEqual({ page: 2, quote: 'a'.repeat(400) });
    expect(passageCitation(pages, 'p2-s2')).toEqual({ page: 2, quote: 'b'.repeat(400) });
    expect(passageCitation(pages, 'p2-s3')).toBeNull();
    expect(passageCitation(pages, 'p3-s1')).toBeNull();
  });

  it('counts astral symbols as one character, like Python', () => {
    const text = `${'𝑝'.repeat(699)} tail`;
    expect(passageCitation([{ number: 1, text }], 'p1-s1')?.quote).toBe('𝑝'.repeat(699));
  });
});

describe('answerParagraphs', () => {
  it('separates paragraphs, bold text and passage references', () => {
    expect(answerParagraphs('A **bold** claim. [p2-s1] [p4-s3, p5-s1]\n\nSecond.')).toEqual([
      [
        { text: 'A ', strong: false },
        { text: 'bold', strong: true },
        { text: ' claim. ', strong: false },
        { ref: 'p2-s1' },
        { text: ' ', strong: false },
        { ref: 'p4-s3' },
        { ref: 'p5-s1' },
      ],
      [{ text: 'Second.', strong: false }],
    ]);
  });

  it('keeps references inside bold text', () => {
    expect(answerParagraphs('**See [p1-s2]**')).toEqual([
      [{ text: 'See ', strong: true }, { ref: 'p1-s2' }],
    ]);
  });
});
