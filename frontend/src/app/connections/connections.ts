import { ChangeDetectionStrategy, Component, inject, input, output, signal } from '@angular/core';
import { form, FormField } from '@angular/forms/signals';
import { UiIcon } from '../ui-icon';
import { WorkspaceApi, errorMessage } from '../workspace-api';
import type { Connection, ResearchDocument } from '../models';

@Component({
  selector: 'app-connections',
  imports: [FormField, UiIcon],
  templateUrl: './connections.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class Connections {
  private readonly api = inject(WorkspaceApi);
  readonly documents = input.required<ResearchDocument[]>();
  readonly rows = input.required<Connection[]>();
  readonly changed = output<void>();
  readonly busy = signal(false);
  readonly error = signal('');
  readonly draft = signal({ source_id: '', target_id: '', relationship: '', evidence: '' });
  readonly fields = form(this.draft);
  title(id: string) {
    return this.documents().find((d) => d.id === id)?.title ?? 'Deleted document';
  }
  async save() {
    const d = this.draft();
    if (
      !d.source_id ||
      !d.target_id ||
      d.source_id === d.target_id ||
      d.relationship.trim().length < 2 ||
      d.relationship.length > 100 ||
      d.evidence.trim().length < 8 ||
      d.evidence.length > 2000
    ) {
      this.error.set(
        'Choose two different documents, a relationship (2–100 characters), and supporting evidence (8–2,000).',
      );
      return;
    }
    this.busy.set(true);
    this.error.set('');
    try {
      await this.api.connect(d);
      this.changed.emit();
      this.draft.set({ source_id: '', target_id: '', relationship: '', evidence: '' });
    } catch (e) {
      this.error.set(errorMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
  async remove(id: string) {
    try {
      await this.api.disconnect(id);
      this.changed.emit();
    } catch (e) {
      this.error.set(errorMessage(e));
    }
  }
}
