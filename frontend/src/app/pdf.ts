import type { AnnotationView, SourcePage } from './models';

export async function extractPdf(
  file: File,
  progress: (value: string) => void,
): Promise<SourcePage[]> {
  if (file.size > 30 * 1024 * 1024 || file.size === 0)
    throw new Error('Choose a PDF smaller than 30 MB.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (new TextDecoder().decode(bytes.slice(0, 5)) !== '%PDF-')
    throw new Error('This file is not a PDF.');
  const pdfjs = await import('pdfjs-dist');
  pdfjs.GlobalWorkerOptions.workerSrc = '/assets/pdf.worker.min.mjs';
  const task = pdfjs.getDocument({ data: bytes, useSystemFonts: true });
  try {
    const pdf = await task.promise;
    if (pdf.numPages > 1500)
      throw new Error(
        'The import limit is 1,500 pages. Split the PDF explicitly before importing.',
      );
    const pages: SourcePage[] = [];
    let total = 0;
    for (let number = 1; number <= pdf.numPages; number++) {
      progress(`Extracting page ${number} of ${pdf.numPages}…`);
      const page = await pdf.getPage(number);
      const content = await page.getTextContent();
      const text = content.items
        .map((item) => ('str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : ''))
        .join('')
        .trim();
      total += text.length;
      if (text.length > 60000 || total > 3000000)
        throw new Error(
          'Extracted text exceeds import limits. Split the PDF; no partial document was saved.',
        );
      pages.push({ number, text });
      page.cleanup();
    }
    if (total < 20)
      throw new Error('No readable text found. Scanned PDFs need OCR, which is not available yet.');
    return pages;
  } catch (error) {
    if (error instanceof Error) throw error;
    throw new Error('This PDF could not be read. Encrypted and damaged PDFs are not supported.');
  } finally {
    await task.destroy();
  }
}

// Match Python str.split() whitespace, not JavaScript's broader/different \s set.
const sourceWhitespace =
  /[\u0009-\u000d\u001c-\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]/;

function normalizedSource(text: string): { value: string; offsets: number[] } {
  const normalized: string[] = [];
  const offsets: number[] = [];
  let space = false;
  for (let i = 0; i < text.length; i++) {
    if (sourceWhitespace.test(text[i])) {
      if (normalized.length) space = true;
      continue;
    }
    if (space) {
      normalized.push(' ');
      offsets.push(i);
      space = false;
    }
    normalized.push(text[i]);
    offsets.push(i);
  }
  return { value: normalized.join(''), offsets };
}

export function excerptRanges(
  text: string,
  quote: string,
  limit = Number.MAX_SAFE_INTEGER,
): { start: number; end: number }[] {
  return matchingRanges(normalizedSource(text), quote, limit);
}

function matchingRanges(
  source: { value: string; offsets: number[] },
  quote: string,
  limit: number,
) {
  const needle = normalizedSource(quote).value;
  if (!needle) return [];
  const ranges: { start: number; end: number }[] = [];
  let offset = 0;
  while (offset < source.value.length && ranges.length < limit) {
    const start = source.value.indexOf(needle, offset);
    if (start < 0) break;
    ranges.push({
      start: source.offsets[start],
      end: source.offsets[start + needle.length - 1] + 1,
    });
    offset = start + 1;
  }
  return ranges;
}

export function highlightedParts(
  text: string,
  quote: string,
): { before: string; match: string; after: string } {
  const range = excerptRanges(text, quote)[0];
  const start = range?.start ?? -1;
  if (start < 0) return { before: text, match: '', after: '' };
  const a = range.start,
    b = range.end;
  return { before: text.slice(0, a), match: text.slice(a, b), after: text.slice(b) };
}

export interface SourceSegment {
  text: string;
  annotations: AnnotationView[];
  start: number;
  cited: boolean;
}

/** Join PDF hard wraps for display. 1 char to 1 char, so offsets are unchanged; blank lines stay. */
export function reflowHardWraps(text: string): string {
  return text.replace(/(?<!\n)\n(?!\n)/g, ' ');
}

export const visibleOccurrencesPerExcerpt = 30;

/** Sweep verified boundaries. A display cap avoids thousands of duplicate interactive marks. */
export function annotatedSegments(
  text: string,
  annotations: AnnotationView[],
  citation = '',
): SourceSegment[] {
  const source = normalizedSource(text);
  const byId = new Map(annotations.map((annotation) => [annotation.id, annotation]));
  const events = new Map<number, { id: string; change: number }[]>();
  const add = (position: number, id: string, change: number) => {
    events.set(position, [...(events.get(position) ?? []), { id, change }]);
  };
  for (const annotation of annotations) {
    for (const range of matchingRanges(
      source,
      annotation.citation.quote,
      visibleOccurrencesPerExcerpt,
    )) {
      add(range.start, annotation.id, 1);
      add(range.end, annotation.id, -1);
    }
  }
  for (const range of matchingRanges(source, citation, visibleOccurrencesPerExcerpt)) {
    add(range.start, '__citation', 1);
    add(range.end, '__citation', -1);
  }
  const boundaries = [...new Set([0, text.length, ...events.keys()])].sort((a, b) => a - b);
  const counts = new Map<string, number>();
  return boundaries.slice(0, -1).map((start, index) => {
    for (const event of events.get(start) ?? []) {
      const count = (counts.get(event.id) ?? 0) + event.change;
      if (count > 0) counts.set(event.id, count);
      else counts.delete(event.id);
    }
    return {
      start,
      text: text.slice(start, boundaries[index + 1]),
      cited: counts.has('__citation'),
      annotations: [...counts.keys()].flatMap((id) => (byId.has(id) ? [byId.get(id)!] : [])),
    };
  });
}
