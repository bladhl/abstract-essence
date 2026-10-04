import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { form, FormField } from '@angular/forms/signals';
import { WorkspaceApi, errorMessage } from '../workspace-api';
import { extractPdf } from '../pdf';
import {
  lensTitles,
  type Analysis,
  type Citation,
  type Connection,
  type DocumentDetail,
  type ProviderChoice,
  type ResearchDocument,
} from '../models';
import { ReadingPanel } from '../reading-panel/reading-panel';
import { Connections } from '../connections/connections';
import { Theme } from '../theme';

type View = 'reading' | 'notebook' | 'compare' | 'connections';
@Component({
  selector: 'app-workspace',
  imports: [FormField, ReadingPanel, Connections],
  templateUrl: './workspace.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Workspace {
  private readonly api = inject(WorkspaceApi);
  readonly theme = inject(Theme);
  readonly documents = signal<ResearchDocument[]>([]);
  readonly detail = signal<DocumentDetail | null>(null);
  readonly choices = signal<ProviderChoice[]>([]);
  readonly connections = signal<Connection[]>([]);
  readonly view = signal<View>('reading');
  readonly busy = signal(false);
  readonly status = signal('Connecting to your workspace…');
  readonly error = signal('');
  readonly page = signal(1);
  readonly citation = signal<Citation | null>(null);
  readonly confirmDelete = signal(false);
  private selectionVersion = 0;
  readonly comparison = signal<Analysis[]>([]);
  readonly lensTitles = lensTitles;
  readonly lenses = Object.keys(lensTitles) as Array<keyof typeof lensTitles>;
  readonly noteModel = signal({ kind: 'note', quote: '', text: '', page: 1 });
  readonly noteForm = form(this.noteModel);
  readonly comparisonModel = signal({ left: '', right: '' });
  readonly comparisonForm = form(this.comparisonModel);
  readonly left = computed(() =>
    this.comparison().find((a) => a.id === this.comparisonModel().left),
  );
  readonly right = computed(() =>
    this.comparison().find((a) => a.id === this.comparisonModel().right),
  );
  constructor() {
    void this.reload();
  }
  async reload() {
    this.error.set('');
    try {
      const [docs, config, connections] = await Promise.all([
        this.api.documents(),
        this.api.config(),
        this.api.connections(),
      ]);
      this.documents.set(docs);
      this.choices.set(config.choices);
      this.connections.set(connections);
      this.status.set('Local workspace · Saved in PostgreSQL');
    } catch (e) {
      this.error.set(errorMessage(e));
      this.status.set('Workspace offline');
    }
  }
  async select(id: string) {
    const version = ++this.selectionVersion;
    this.error.set('');
    this.confirmDelete.set(false);
    try {
      const detail = await this.api.detail(id);
      if (version !== this.selectionVersion) return;
      this.detail.set(detail);
      this.page.set(1);
      this.citation.set(null);
      this.noteModel.set({ kind: 'note', quote: '', text: '', page: 1 });
      this.view.set('reading');
    } catch (e) {
      if (version === this.selectionVersion) this.error.set(errorMessage(e));
    }
  }
  async refreshDetail() {
    const id = this.detail()?.document.id;
    if (!id) return;
    try {
      const result = await this.api.detail(id);
      if (this.detail()?.document.id === id) this.detail.set(result);
    } catch (e) {
      if (this.detail()?.document.id === id) this.error.set(errorMessage(e));
    }
  }
  async importFile(event: Event) {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file || this.busy()) return;
    this.busy.set(true);
    this.error.set('');
    try {
      const pages = await extractPdf(file, (progress) => this.status.set(progress));
      this.status.set('Saving extracted text to your local workspace…');
      const doc = await this.api.importDocument(file.name, pages);
      await this.reload();
      await this.select(doc.id);
      this.status.set(`Imported ${pages.length} pages. Nothing was sent to AI.`);
    } catch (e) {
      this.error.set(errorMessage(e));
      this.status.set('Import not completed. No partial document was saved.');
    } finally {
      this.busy.set(false);
      input.value = '';
    }
  }
  showCitation(citation: Citation) {
    this.citation.set(citation);
    this.page.set(citation.page);
  }
  annotate(citation: Citation & { kind?: string }) {
    this.noteModel.set({
      kind: citation.kind ?? 'note',
      page: citation.page,
      quote: citation.quote,
      text: '',
    });
    this.view.set('notebook');
  }
  async saveNote() {
    const detail = this.detail(),
      d = this.noteModel();
    if (!detail || d.text.trim().length < 1 || d.text.length > 6000) return;
    this.error.set('');
    this.busy.set(true);
    try {
      await this.api.saveNote({ ...d, document_id: detail.document.id });
      if (this.detail()?.document.id !== detail.document.id) return;
      await this.refreshDetail();
      if (this.detail()?.document.id !== detail.document.id) return;
      this.noteModel.update((n) => ({ ...n, text: '' }));
      this.status.set('Source-linked note saved.');
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
  async removeNote(id: string) {
    try {
      await this.api.deleteNote(id);
      await this.refreshDetail();
    } catch (e) {
      this.error.set(errorMessage(e));
    }
  }
  async deleteDocument() {
    const id = this.detail()?.document.id;
    if (!id) return;
    try {
      await this.api.deleteDocument(id);
      this.detail.set(null);
      this.confirmDelete.set(false);
      this.comparison.set([]);
      await this.reload();
    } catch (e) {
      this.error.set(errorMessage(e));
    }
  }
  async exportDocument() {
    const doc = this.detail()?.document;
    if (!doc) return;
    try {
      const data = await this.api.exportDocument(doc.id);
      const url = URL.createObjectURL(
        new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
      );
      const link = document.createElement('a');
      link.href = url;
      link.download = `essence-${doc.id}.json`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      this.error.set(errorMessage(e));
    }
  }
  async navigate(view: View) {
    this.view.set(view);
    this.error.set('');
    if (view === 'compare') {
      try {
        const details = await Promise.all(this.documents().map((doc) => this.api.detail(doc.id)));
        this.comparison.set(details.flatMap((d) => d.analyses));
      } catch (e) {
        this.error.set(errorMessage(e));
      }
    }
    if (view === 'connections') await this.reload();
  }
  title(id: string) {
    return this.documents().find((d) => d.id === id)?.title ?? 'Document';
  }
  interpretation(analysis: Analysis, lens: string) {
    return (
      analysis.output.insights.find((i) => i.lens === lens)?.interpretation ?? 'Not identified'
    );
  }
}
