import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import type {
  Analysis,
  AnnotationRole,
  Citation,
  Connection,
  DocumentDetail,
  Feedback,
  ProviderChoice,
  ResearchDocument,
  SourceNote,
  SourcePage,
  Thinking,
} from './models';

@Injectable({ providedIn: 'root' })
export class WorkspaceApi {
  private readonly http = inject(HttpClient);
  private readonly options = { headers: { 'X-Essence-Client': 'workspace' }, timeout: 70000 };
  config() {
    return firstValueFrom(this.http.get<{ choices: ProviderChoice[] }>('/api/config'));
  }
  documents() {
    return firstValueFrom(this.http.get<ResearchDocument[]>('/api/documents'));
  }
  detail(id: string) {
    return firstValueFrom(this.http.get<DocumentDetail>(`/api/documents/${id}`));
  }
  importDocument(filename: string, pages: SourcePage[]) {
    return firstValueFrom(
      this.http.post<ResearchDocument>(
        '/api/documents',
        { filename, title: filename.replace(/\.pdf$/i, ''), total_pages: pages.length, pages },
        this.options,
      ),
    );
  }
  analyze(body: {
    document_id: string;
    page_start: number;
    page_end: number;
    attempt: string;
    mode?: 'guided' | 'reflection';
    provider: string;
    model: string;
    consent: boolean;
    thinking?: Thinking;
  }) {
    return firstValueFrom(this.http.post<Analysis>('/api/reading/analyses', body, this.options));
  }
  feedback(id: string) {
    return firstValueFrom(this.http.get<Feedback[]>(`/api/reading/analyses/${id}/feedback`));
  }
  ask(
    id: string,
    body: {
      question: string;
      provider: string;
      model: string;
      consent: boolean;
      context?: { role?: AnnotationRole; citation: Citation };
      thinking?: Thinking;
    },
  ) {
    return firstValueFrom(
      this.http.post<Feedback>(`/api/reading/analyses/${id}/feedback`, body, this.options),
    );
  }
  saveNote(body: Omit<SourceNote, 'id'>) {
    return firstValueFrom(this.http.post<SourceNote>('/api/learning/notes', body, this.options));
  }
  deleteNote(id: string) {
    return firstValueFrom(this.http.delete(`/api/learning/notes/${id}`, this.options));
  }
  connections() {
    return firstValueFrom(this.http.get<Connection[]>('/api/learning/connections'));
  }
  connect(body: Omit<Connection, 'id'>) {
    return firstValueFrom(
      this.http.post<Connection>('/api/learning/connections', body, this.options),
    );
  }
  disconnect(id: string) {
    return firstValueFrom(this.http.delete(`/api/learning/connections/${id}`, this.options));
  }
  deleteDocument(id: string) {
    return firstValueFrom(this.http.delete(`/api/documents/${id}`, this.options));
  }
  exportDocument(id: string) {
    return firstValueFrom(this.http.get<unknown>(`/api/documents/${id}/export`));
  }
}

export function errorMessage(error: unknown): string {
  if (error instanceof HttpErrorResponse) {
    const detail = error.error?.detail;
    return typeof detail === 'string'
      ? detail
      : 'The workspace server is unavailable. Check the API and database, then retry.';
  }
  return error instanceof Error
    ? error.message
    : 'Something went wrong. Your saved work is unchanged.';
}
