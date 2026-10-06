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
import {
  annotatedSegments,
  excerptRanges,
  reflowHardWraps,
  visibleOccurrencesPerExcerpt,
} from '../pdf';
import { UiIcon, roleIcons } from '../ui-icon';

@Component({
  selector: 'app-source-reader',
  imports: [FormField, UiIcon],
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
  readonly canAsk = input(false);
  readonly annotate = output<Citation>();
  readonly askAbout = output<Citation>();
  readonly toolbar = signal<{ top: number; left: number; quote: string } | null>(null);
  readonly copied = signal('');
  readonly editing = signal(false);
  readonly draft = signal({ quote: '' });
  readonly quoteForm = form(this.draft);
  readonly text = computed(() => this.pages().find((p) => p.number === this.page())?.text ?? '');
  readonly roleTitles = roleTitles;
  readonly roleIcons = roleIcons;
  readonly pageAnnotations = computed(() =>
    this.annotations().filter((a) => a.citation.page === this.page()),
  );
  // Display-only reflow: same length as the stored text, so segment offsets stay valid.
  readonly parts = computed(() => {
    const display = reflowHardWraps(this.text());
    return annotatedSegments(
      this.text(),
      this.pageAnnotations(),
      this.citation()?.page === this.page() ? this.citation()?.quote : '',
    ).map((part) => ({ ...part, text: display.slice(part.start, part.start + part.text.length) }));
  });
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
  readonly excerptBox = viewChild<ElementRef<HTMLTextAreaElement>>('excerptBox');
  constructor() {
    // The editor only exists after "Paste an excerpt", so focus it as soon as it renders.
    afterRenderEffect(() => this.excerptBox()?.nativeElement.focus());
    afterRenderEffect(() => {
      const id = this.activeId();
      this.page();
      const container = this.source()?.nativeElement;
      const passage = container?.querySelector<HTMLElement>(
        '.annotation-mark[aria-pressed="true"]',
      );
      if (!id || !container || !passage || container.scrollHeight <= container.clientHeight) return;
      const bounds = container.getBoundingClientRect();
      const target = passage.getBoundingClientRect();
      if (target.top < bounds.top || target.bottom > bounds.bottom) {
        container.scrollTo({
          top: Math.max(0, container.scrollTop + target.top - bounds.top - 20),
        });
      }
    });
    // Registered after the active-passage scroll so an opened citation wins on a page change.
    afterRenderEffect(() => {
      const citation = this.citation();
      if (!citation || citation.page !== this.page()) return;
      const container = this.source()?.nativeElement;
      const cited = container?.querySelector<HTMLElement>('.source-citation');
      if (!container || !cited) return;
      const offset = cited.getBoundingClientRect().top - container.getBoundingClientRect().top;
      container.scrollTo({ top: Math.max(0, container.scrollTop + offset - 20) });
    });
  }
  label(annotations: AnnotationView[]): string {
    return annotations.map((a) => `${roleTitles[a.role]}: ${a.title}`).join('; ');
  }
  preview(annotations: AnnotationView[]): string {
    const first = annotations[0];
    return `${roleTitles[first.role]}: ${first.title} · Click to explain`;
  }
  isActive(annotations: AnnotationView[]): boolean {
    return annotations.some((a) => a.id === this.activeId());
  }
  choose(annotations: AnnotationView[]) {
    this.annotationSelect.emit(annotations.map((a) => a.id));
  }
  captureSelection(event: Event) {
    const target = event.target as HTMLElement;
    if (target.closest('.excerpt-picker, .selection-toolbar')) return;
    // keydown.escape dismisses; its keyup must not reopen from the still-active selection.
    if (event instanceof KeyboardEvent && event.key === 'Escape') return;
    const selection = window.getSelection();
    const quote = selection?.toString().trim() ?? '';
    const sheet = this.source()?.nativeElement;
    if (
      !selection?.rangeCount ||
      quote.length < 8 ||
      !sheet ||
      !excerptRanges(this.text(), quote, 1).length
    ) {
      this.dismissToolbar();
      return;
    }
    const range = selection.getRangeAt(0).getBoundingClientRect();
    const bounds = sheet.getBoundingClientRect();
    this.copied.set('');
    this.toolbar.set({
      top: Math.max(0, range.top - bounds.top + sheet.scrollTop - 58),
      left: Math.min(Math.max(0, range.left - bounds.left), Math.max(0, sheet.clientWidth - 420)),
      quote: quote.slice(0, 1200),
    });
  }
  dismissToolbar() {
    this.toolbar.set(null);
    this.copied.set('');
  }
  addNote() {
    const quote = this.toolbar()?.quote;
    if (quote) this.annotate.emit({ page: this.page(), quote });
    this.dismissToolbar();
  }
  ask() {
    const quote = this.toolbar()?.quote;
    if (quote) this.askAbout.emit({ page: this.page(), quote });
    this.dismissToolbar();
  }
  editExcerpt() {
    const quote = this.toolbar()?.quote;
    if (!quote) return;
    this.draft.set({ quote });
    this.dismissToolbar();
    this.editing.set(true);
  }
  async copyCitation() {
    const quote = this.toolbar()?.quote;
    if (!quote) return;
    try {
      await navigator.clipboard.writeText(`"${quote}" (p. ${this.page()})`);
      this.copied.set('Copied');
    } catch {
      this.copied.set('Copy unavailable');
    }
  }
  useExcerpt() {
    this.annotate.emit({ page: this.page(), quote: this.draft().quote.trim() });
    this.editing.set(false);
  }
}
