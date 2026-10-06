import type { Citation, SourcePage } from './models';

/** Mirrors PASSAGE_CHARACTERS in backend/src/essence/reading/source_catalog.py. */
const PASSAGE_CHARACTERS = 700;
const PASSAGE_ID = /^p(\d+)-s(\d+)$/;

/**
 * Resolves a source passage id the model wrote into its prose (e.g. "p2-s1") to the exact
 * source text, partitioning the page exactly like the backend's source_passages().
 */
export function passageCitation(pages: SourcePage[], id: string): Citation | null {
  const match = PASSAGE_ID.exec(id);
  if (!match) return null;
  const page = Number(match[1]);
  const wanted = Number(match[2]);
  const text = pages.find((p) => p.number === page)?.text;
  if (text === undefined) return null;
  // Python slices by code point; Array.from keeps astral symbols (math italics) as one unit.
  const chars = Array.from(text);
  let start = 0;
  for (let sequence = 1; start < chars.length; sequence++) {
    let end = Math.min(start + PASSAGE_CHARACTERS, chars.length);
    if (end < chars.length) {
      const floor = start + PASSAGE_CHARACTERS / 2;
      let boundary = lastIndexOf(chars, '\n', floor, end);
      if (boundary < 0) boundary = lastIndexOf(chars, ' ', floor, end);
      if (boundary >= 0) end = boundary + 1;
    }
    if (sequence === wanted) {
      const quote = chars.slice(start, end).join('').trim();
      return quote ? { page, quote } : null;
    }
    start = end;
  }
  return null;
}

function lastIndexOf(chars: string[], char: string, from: number, to: number): number {
  for (let i = to - 1; i >= from; i--) if (chars[i] === char) return i;
  return -1;
}

export type AnswerPart = { text: string; strong: boolean } | { ref: string };

/** Splits an answer into paragraphs of plain text, **bold** text and [p2-s1] references. */
export function answerParagraphs(answer: string): AnswerPart[][] {
  return answer
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean)
    .map((paragraph) =>
      paragraph
        .split(/\*\*(.+?)\*\*/s)
        .flatMap((segment, index) => inline(segment, index % 2 === 1)),
    );
}

function inline(segment: string, strong: boolean): AnswerPart[] {
  // Captured groups (odd indexes) are reference lists such as "p2-s1" or "p2-s1, p4-s3".
  return segment
    .split(/\[(p\d+-s\d+(?:\s*[,;]\s*p\d+-s\d+)*)\]/)
    .flatMap((piece, index): AnswerPart[] =>
      index % 2 === 1
        ? piece.split(/\s*[,;]\s*/).map((ref) => ({ ref }))
        : piece
          ? [{ text: piece, strong }]
          : [],
    );
}
