import {
  afterRenderEffect,
  ChangeDetectionStrategy,
  Component,
  computed,
  DOCUMENT,
  ElementRef,
  inject,
  input,
  linkedSignal,
  output,
  resource,
  signal,
  viewChild,
} from '@angular/core';
import { NgTemplateOutlet } from '@angular/common';
import { form, FormField } from '@angular/forms/signals';
import { WorkspaceApi, errorMessage } from '../workspace-api';
import {
  lensTitles,
  roleTitles,
  thinkingTitles,
  type Analysis,
  type AnnotationRole,
  type AnnotationView,
  type Citation,
  type DocumentDetail,
  type ProviderChoice,
  type RequestSettings,
  type Thinking,
} from '../models';
import { initialScope, sourceAnnotations } from '../reading-map';
import { SourceReader } from '../source-reader/source-reader';
import { UiIcon, roleIcons } from '../ui-icon';

type Filter = AnnotationRole | 'all';
type PendingReading =
  | { kind: 'analysis'; documentId: string }
  | { kind: 'question'; documentId: string; readingId: string };
interface ScopeDraft {
  destination: string;
  page_start: number;
  page_end: number;
}
interface DraftSource {
  detail: DocumentDetail;
  choices: ProviderChoice[];
}
@Component({
  selector: 'app-reading-panel',
  imports: [FormField, NgTemplateOutlet, SourceReader, UiIcon],
  templateUrl: './reading-panel.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ReadingPanel {
  private readonly api = inject(WorkspaceApi);
  private readonly document = inject(DOCUMENT);
  private readonly explanationHeading = viewChild<ElementRef<HTMLElement>>('explanationHeading');
  private readonly questionBox = viewChild<ElementRef<HTMLTextAreaElement>>('questionBox');
  private readonly setupDialog = viewChild<ElementRef<HTMLDialogElement>>('setupDialog');
  readonly detail = input.required<DocumentDetail>();
  readonly choices = input.required<ProviderChoice[]>();
  readonly citation = input<Citation | null>(null);
  readonly saved = output<void>();
  readonly cite = output<Citation>();
  readonly annotate = output<Citation & { kind?: string }>();
  readonly lensTitles = lensTitles;
  readonly roleTitles = roleTitles;
  readonly roleIcons = roleIcons;
  readonly thinkingTitles = thinkingTitles;
  readonly pending = signal<PendingReading | null>(null);
  readonly busy = computed(() => this.pending() !== null);
  readonly processingCurrent = computed(() => {
    const request = this.pending();
    return (
      request?.documentId === this.detail().document.id &&
      (request.kind === 'analysis' || request.readingId === this.current()?.id)
    );
  });
  readonly isAnalyzing = computed(
    () => this.processingCurrent() && this.pending()?.kind === 'analysis',
  );
  readonly isAsking = computed(
    () => this.processingCurrent() && this.pending()?.kind === 'question',
  );
  readonly processingLabel = computed(() => {
    if (!this.pending()) return '';
    if (!this.processingCurrent())
      return 'An earlier request is still finishing. You can keep reading.';
    return this.isAnalyzing()
      ? 'Creating your reading map…'
      : 'Preparing your source-linked answer…';
  });
  readonly mobilePane = linkedSignal<'source' | 'explanation'>(() => {
    this.detail().document.id;
    return 'source';
  });
  readonly error = linkedSignal(() => {
    this.detail().document.id;
    return '';
  });
  readonly current = linkedSignal<DocumentDetail, Analysis | null>({
    source: this.detail,
    computation: (detail, previous) =>
      previous?.source.document.id === detail.document.id
        ? previous.value
        : (detail.analyses.at(-1) ?? null),
  });
  readonly setupOpen = linkedSignal(() => {
    this.detail().document.id;
    return !this.current();
  });
  // A first reading stays inline; analyzing another scope opens as a modal.
  readonly setupModal = computed(() => !!this.current() && this.setupOpen());
  readonly settingsOpen = signal(false);
  readonly dialogOpen = computed(() => this.setupModal() || this.settingsOpen());
  readonly draft = linkedSignal<DraftSource, ScopeDraft>({
    source: () => ({ detail: this.detail(), choices: this.choices() }),
    computation: (source, previous) => {
      if (
        previous?.source.detail.document.id === source.detail.document.id &&
        previous.source.choices === source.choices
      )
        return previous.value;
      return {
        destination: source.choices.length === 1 ? this.destinationKey(source.choices[0]) : '',
        ...initialScope(source.detail.pages),
      };
    },
  });
  readonly fields = form(this.draft);
  readonly choice = computed(() =>
    this.choices().find((c) => this.destinationKey(c) === this.draft().destination),
  );
  readonly thinkingLevels = computed<Thinking[]>(
    () => this.choice()?.thinking_levels ?? ['default'],
  );
  readonly thinkingDraft = linkedSignal<
    { destination: string; levels: Thinking[] },
    { thinking: Thinking }
  >({
    source: () => ({ destination: this.draft().destination, levels: this.thinkingLevels() }),
    computation: (source, previous) => ({
      thinking:
        previous?.source.destination === source.destination &&
        source.levels.includes(previous.value.thinking)
          ? previous.value.thinking
          : 'default',
    }),
  });
  readonly thinkingFields = form(this.thinkingDraft);
  // Consent belongs to an exact document, destination and scope, not a reusable checkbox.
  readonly consentKey = computed(() => {
    const d = this.draft();
    return `${this.detail().document.id}:${d.destination}:${d.page_start}:${d.page_end}:${this.thinkingDraft().thinking}`;
  });
  readonly consentDraft = linkedSignal(() => {
    this.consentKey();
    return { consent: false };
  });
  readonly consentFields = form(this.consentDraft);
  readonly questionConsentKey = computed(
    () =>
      `${this.detail().document.id}:${this.current()?.id}:${this.draft().destination}:${this.thinkingDraft().thinking}`,
  );
  readonly questionConsent = linkedSignal(() => {
    this.questionConsentKey();
    return { consent: false };
  });
  readonly questionConsentFields = form(this.questionConsent);
  readonly questionDraft = linkedSignal(() => {
    this.current()?.id;
    this.detail().document.id;
    return { question: '' };
  });
  readonly questionFields = form(this.questionDraft);
  readonly selectionContext = linkedSignal<Citation | null>(() => {
    this.current()?.id;
    this.detail().document.id;
    return null;
  });
  readonly annotations = computed(() => sourceAnnotations(this.current()));
  readonly filter = linkedSignal<Filter>(() => {
    this.current()?.id;
    return 'all';
  });
  readonly visibleAnnotations = computed(() =>
    this.annotations().filter((a) => this.filter() === 'all' || a.role === this.filter()),
  );
  readonly roles = computed(() => [...new Set(this.annotations().map((a) => a.role))]);
  readonly activeId = linkedSignal(() => this.annotations()[0]?.id ?? '');
  readonly active = computed(() => this.annotations().find((a) => a.id === this.activeId()));
  readonly overlapIds = linkedSignal<string[]>(() => {
    this.current()?.id;
    return [];
  });
  readonly overlap = computed(() =>
    this.annotations().filter((a) => this.overlapIds().includes(a.id)),
  );
  readonly page = linkedSignal(() => {
    this.detail().document.id;
    return this.citation()?.page ?? this.annotations()[0]?.citation.page ?? 1;
  });
  readonly feedback = resource({
    params: () => this.current()?.id,
    loader: ({ params }) => this.api.feedback(params),
    defaultValue: [],
  });
  readonly scopedCharacters = computed(() =>
    this.detail()
      .pages.filter((p) => p.number >= this.draft().page_start && p.number <= this.draft().page_end)
      .reduce((sum, p) => sum + p.text.length, 0),
  );
  readonly validScope = computed(() => {
    const d = this.draft();
    return (
      Number.isInteger(d.page_start) &&
      Number.isInteger(d.page_end) &&
      d.page_start >= 1 &&
      d.page_end <= this.detail().document.total_pages &&
      d.page_end >= d.page_start &&
      d.page_end - d.page_start < 20 &&
      this.scopedCharacters() >= 20 &&
      this.scopedCharacters() <= 60000
    );
  });
  readonly fullScope = computed(
    () =>
      this.draft().page_start === 1 && this.draft().page_end === this.detail().document.total_pages,
  );
  readonly canAnalyze = computed(
    () =>
      !this.busy() &&
      !!this.choice() &&
      this.consentDraft().consent &&
      this.validScope() &&
      this.thinkingLevels().includes(this.thinkingDraft().thinking),
  );
  readonly canAsk = computed(
    () =>
      !this.busy() &&
      !!this.current() &&
      !!this.choice() &&
      this.thinkingLevels().includes(this.thinkingDraft().thinking) &&
      this.questionConsent().consent &&
      this.questionDraft().question.trim().length >= 8 &&
      this.questionDraft().question.length <= 2000,
  );
  readonly message = errorMessage;
  constructor() {
    afterRenderEffect(() => {
      const dialog = this.setupDialog()?.nativeElement;
      // showModal is missing in jsdom.
      if (dialog && !dialog.open) dialog.showModal?.();
    });
    afterRenderEffect(() => {
      if (
        this.mobilePane() === 'explanation' &&
        this.document.defaultView?.matchMedia?.('(max-width: 960px)').matches
      )
        this.explanationHeading()?.nativeElement.focus({ preventScroll: true });
    });
  }
  destinationKey(choice: ProviderChoice) {
    return `${choice.provider}:${choice.model}`;
  }
  editRequestSettings() {
    this.settingsOpen.set(true);
  }
  closeDialog() {
    if (this.setupModal()) this.setupOpen.set(false);
    this.settingsOpen.set(false);
  }
  thinkingDescription(settings?: RequestSettings): string {
    return settings
      ? `Thinking: ${this.thinkingTitles[settings.thinking]}`
      : 'Thinking: Not recorded for this earlier result';
  }
  coverage(analysis: Analysis): string {
    return `PDF pages ${analysis.page_start}–${analysis.page_end} of ${this.detail().document.total_pages} · ${
      analysis.page_start === 1 && analysis.page_end === this.detail().document.total_pages
        ? 'Full extracted-text coverage'
        : 'Partial coverage — other pages were not analyzed'
    }`;
  }
  selectAnnotation(ids: string[]) {
    const annotation = this.annotations().find((a) => a.id === ids[0]);
    if (!annotation) return;
    this.activeId.set(annotation.id);
    this.overlapIds.set(ids);
    this.page.set(annotation.citation.page);
    this.mobilePane.set('explanation');
  }
  chooseRole(role: Filter) {
    this.filter.set(role);
    const first = this.visibleAnnotations()[0];
    if (first) this.selectAnnotation([first.id]);
    this.mobilePane.set('source');
  }
  note(kind: string) {
    const active = this.active();
    if (active) this.annotate.emit({ ...active.citation, kind });
  }
  practice() {
    const active = this.active();
    if (active) this.questionDraft.set({ question: active.question });
  }
  async analyze() {
    if (!this.canAnalyze()) return;
    const choice = this.choice()!;
    const id = this.detail().document.id;
    const draft = this.draft();
    this.pending.set({ kind: 'analysis', documentId: id });
    this.error.set('');
    try {
      const result = await this.api.analyze({
        document_id: id,
        page_start: draft.page_start,
        page_end: draft.page_end,
        provider: choice.provider,
        model: choice.model,
        thinking: this.thinkingDraft().thinking,
        consent: true,
        mode: 'guided',
        attempt: '',
      });
      if (this.detail().document.id !== id) return;
      this.current.set(result);
      this.mobilePane.set('source');
      this.setupOpen.set(false);
      this.page.set(sourceAnnotations(result)[0]?.citation.page ?? result.page_start);
      this.saved.emit();
    } catch (e) {
      if (this.detail().document.id === id) this.error.set(errorMessage(e));
    } finally {
      this.pending.set(null);
    }
  }
  openAnalysis(item: Analysis) {
    this.current.set(item);
    this.mobilePane.set('source');
    this.error.set('');
    this.setupOpen.set(false);
    this.page.set(sourceAnnotations(item)[0]?.citation.page ?? item.page_start);
  }
  askAbout(selected: Citation) {
    this.selectionContext.set(selected);
    this.mobilePane.set('explanation');
    // Wait for the question box to render (it may be in a hidden mobile pane).
    setTimeout(() => this.questionBox()?.nativeElement.focus());
  }
  async ask() {
    const item = this.current(),
      choice = this.choice();
    if (!item || !choice || !this.canAsk()) return;
    const id = this.detail().document.id;
    const active = this.active();
    const picked = this.selectionContext();
    const question = this.questionDraft().question.trim();
    this.pending.set({ kind: 'question', documentId: id, readingId: item.id });
    this.error.set('');
    try {
      await this.api.ask(item.id, {
        provider: choice.provider,
        model: choice.model,
        thinking: this.thinkingDraft().thinking,
        consent: true,
        question,
        ...(picked
          ? { context: { citation: picked } }
          : active
            ? { context: { role: active.role, citation: active.citation } }
            : {}),
      });
      if (this.detail().document.id === id && this.current()?.id === item.id) {
        this.feedback.reload();
        this.questionDraft.set({ question: '' });
        this.selectionContext.set(null);
      }
    } catch (e) {
      if (this.detail().document.id === id && this.current()?.id === item.id)
        this.error.set(errorMessage(e));
    } finally {
      this.pending.set(null);
    }
  }
}
