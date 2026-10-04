import {
  afterRenderEffect,
  ChangeDetectionStrategy,
  Component,
  computed,
  ElementRef,
  input,
  output,
  signal,
  viewChild,
} from '@angular/core';
import { form, FormField } from '@angular/forms/signals';
import { roleTitles, type AnnotationView, type Citation, type SourcePage } from '../models';
import { annotatedSegments, excerptRanges, visibleOccurrencesPerExcerpt } from '../pdf';

@Component({
  selector: 'app-source-reader',
  imports: [FormField],
  templateUrl: './source-reader.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SourceReader {
  readonly pages = input.required<SourcePage[]>();
  readonly page = input.required<number>();
  readonly citation = input<Citation | null>(null);
  readonly annotations = input<AnnotationView[]>([]);
  readonly activeId = input('');
  readonly annotationSelect = output<string[]>();
  readonly pageChange = output<number>();
  readonly annotate = output<Citation>();
  readonly draft = signal({ quote: '' });
  readonly quoteForm = form(this.draft);
  readonly text = computed(() => this.pages().find((p) => p.number === this.page())?.text ?? '');
  readonly roleTitles = roleTitles;
  readonly pageAnnotations = computed(() =>
    this.annotations().filter((a) => a.citation.page === this.page()),
  );
  readonly parts = computed(() =>
    annotatedSegments(
      this.text(),
      this.pageAnnotations(),
      this.citation()?.page === this.page() ? this.citation()?.quote : '',
    ),
  );
  readonly repeated = computed(() =>
    this.pageAnnotations().some((a) => excerptRanges(this.text(), a.citation.quote, 2).length > 1),
  );
  readonly capped = computed(() => {
    const quotes = this.pageAnnotations().map((a) => a.citation.quote);
    if (this.citation()?.page === this.page()) quotes.push(this.citation()!.quote);
    return quotes.some(
      (quote) =>
        excerptRanges(this.text(), quote, visibleOccurrencesPerExcerpt + 1).length >
        visibleOccurrencesPerExcerpt,
    );
  });
  readonly source = viewChild<ElementRef<HTMLElement>>('sourceText');
  constructor() {
    afterRenderEffect(() => {
      const id = this.activeId();
      this.page();
      if (id)
        this.source()
          ?.nativeElement.querySelector<HTMLElement>('[data-active="true"]')
          ?.scrollIntoView({ block: 'nearest', behavior: 'auto' });
    });
  }
  label(annotations: AnnotationView[]): string {
    return annotations.map((a) => `${roleTitles[a.role]}: ${a.title}`).join('; ');
  }
  isActive(annotations: AnnotationView[]): boolean {
    return annotations.some((a) => a.id === this.activeId());
  }
  choose(annotations: AnnotationView[]) {
    this.annotationSelect.emit(annotations.map((a) => a.id));
  }
  captureSelection() {
    const selection = window.getSelection()?.toString().trim() ?? '';
    if (selection.length >= 8 && this.text().includes(selection))
      this.draft.set({ quote: selection.slice(0, 1200) });
  }
  useExcerpt() {
    this.annotate.emit({ page: this.page(), quote: this.draft().quote.trim() });
  }
}
