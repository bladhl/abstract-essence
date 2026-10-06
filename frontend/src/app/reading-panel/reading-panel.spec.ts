import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { ReadingPanel } from './reading-panel';
import { WorkspaceApi } from '../workspace-api';
import type { Analysis, DocumentDetail } from '../models';

const quote = 'The pilot included twenty volunteers.';
const detail: DocumentDetail = {
  document: {
    id: 'document',
    title: 'Pilot',
    filename: 'pilot.pdf',
    total_pages: 1,
    created_at: '',
  },
  pages: [{ number: 1, text: quote }],
  analyses: [],
  notes: [],
};
const analysis: Analysis = {
  id: 'analysis',
  document_id: 'document',
  provider: 'google',
  model: 'test',
  page_start: 1,
  page_end: 1,
  attempt: '',
  created_at: '',
  output: {
    insights: [],
    learning_feedback: 'Optional practice.',
    next_question: 'What remains uncertain?',
    reading_map: {
      version: 'annotated-reading-v1',
      overview: 'A pilot has a limited sample.',
      annotations: [
        {
          role: 'approach',
          title: 'Sampling choice',
          citation: { page: 1, quote },
          explanation: 'This identifies the participants.',
          caveat: 'It does not establish validity.',
          question: 'Why choose this sample?',
        },
      ],
      gaps: [{ role: 'contribution', reason: 'Not identified here.' }],
    },
  },
};

describe('ReadingPanel', () => {
  async function setup(saved = false) {
    const api = {
      feedback: vi.fn(async () => []),
      analyze: vi.fn(async (_request: unknown) => analysis),
      ask: vi.fn(async (_id: string, _request: unknown) => ({ id: 'reply' })),
    };
    TestBed.configureTestingModule({ providers: [{ provide: WorkspaceApi, useValue: api }] });
    const fixture = TestBed.createComponent(ReadingPanel);
    fixture.componentRef.setInput('detail', saved ? { ...detail, analyses: [analysis] } : detail);
    fixture.componentRef.setInput('choices', [{ provider: 'google', model: 'test' }]);
    await fixture.whenStable();
    return { fixture, api, panel: fixture.componentInstance };
  }
  it('selects a sole destination and full scope but never calls AI without consent', async () => {
    const { fixture, panel, api } = await setup();
    expect(panel.draft().destination).toBe('google:test');
    expect(panel.fullScope()).toBe(true);
    expect(panel.canAnalyze()).toBe(false);
    expect(api.analyze).not.toHaveBeenCalled();
    panel.consentDraft.set({ consent: true });
    await fixture.whenStable();
    expect(panel.canAnalyze()).toBe(true);
    await panel.analyze();
    expect(api.analyze).toHaveBeenCalledWith(
      expect.objectContaining({ mode: 'guided', attempt: '', consent: true }),
    );
    expect(api.analyze.mock.calls[0][0]).not.toHaveProperty('destination');
    expect(panel.current()?.id).toBe('analysis');
    expect(panel.setupOpen()).toBe(false);
    expect(panel.questionConsent().consent).toBe(false);
  });
  it('revokes analysis consent when destination, scope or document changes', async () => {
    const { fixture, panel } = await setup();
    panel.consentDraft.set({ consent: true });
    panel.draft.update((d) => ({ ...d, destination: '' }));
    expect(panel.consentDraft().consent).toBe(false);
    panel.consentDraft.set({ consent: true });
    panel.draft.update((d) => ({ ...d, page_end: 2 }));
    expect(panel.consentDraft().consent).toBe(false);
    expect(panel.validScope()).toBe(false);
    panel.consentDraft.set({ consent: true });
    fixture.componentRef.setInput('detail', {
      ...detail,
      document: { ...detail.document, id: 'different' },
    });
    await fixture.whenStable();
    expect(panel.consentDraft().consent).toBe(false);
  });
  it('opens the saved map and sends contextual questions with separate saved-scope consent', async () => {
    const { fixture, panel, api } = await setup(true);
    expect(panel.current()).toEqual(analysis);
    expect(panel.annotations()).toHaveLength(1);
    panel.questionDraft.set({ question: 'Why does this choice matter?' });
    panel.consentDraft.set({ consent: true });
    expect(panel.canAsk()).toBe(false);
    panel.questionConsent.set({ consent: true });
    await panel.ask();
    expect(api.ask).toHaveBeenCalledWith(
      'analysis',
      expect.objectContaining({
        question: 'Why does this choice matter?',
        context: { role: 'approach', citation: { page: 1, quote } },
      }),
    );
    await fixture.whenStable();
    panel.questionConsent.set({ consent: true });
    panel.openAnalysis({ ...analysis, id: 'other' });
    expect(panel.questionConsent().consent).toBe(false);
  });
  it('ignores a completed result after the user switches documents', async () => {
    const { fixture, panel, api } = await setup();
    let finish!: (result: Analysis) => void;
    api.analyze.mockImplementationOnce(
      () =>
        new Promise<Analysis>((resolve) => {
          finish = resolve;
        }),
    );
    panel.consentDraft.set({ consent: true });
    const pending = panel.analyze();
    fixture.componentRef.setInput('detail', {
      ...detail,
      document: { ...detail.document, id: 'new-doc' },
    });
    await fixture.whenStable();
    finish(analysis);
    await pending;
    expect(panel.current()).toBeNull();
    expect(panel.annotations()).toEqual([]);
  });
  it.each(['success', 'failure'])(
    'shows actual analysis progress and clears it on %s',
    async (outcome) => {
      const { fixture, panel, api } = await setup();
      let finish!: (result: Analysis) => void;
      let fail!: (error: Error) => void;
      api.analyze.mockImplementationOnce(
        () =>
          new Promise<Analysis>((resolve, reject) => {
            finish = resolve;
            fail = reject;
          }),
      );
      panel.consentDraft.set({ consent: true });
      const request = panel.analyze();
      await fixture.whenStable();
      expect(panel.busy()).toBe(true);
      expect(panel.canAnalyze()).toBe(false);
      expect(fixture.nativeElement.querySelector('.request-processing').textContent).toContain(
        'Creating your reading map',
      );
      expect(
        fixture.nativeElement
          .querySelector('.analysis-setup button.primary')
          .getAttribute('aria-busy'),
      ).toBe('true');
      await panel.analyze();
      expect(api.analyze).toHaveBeenCalledTimes(1);
      if (outcome === 'success') finish(analysis);
      else fail(new Error('The model reached the output-token limit.'));
      await request;
      await fixture.whenStable();
      expect(panel.busy()).toBe(false);
      expect(fixture.nativeElement.querySelector('.request-processing')).toBeNull();
      if (outcome === 'failure') {
        expect(fixture.nativeElement.querySelector('[role="alert"]').textContent).toContain(
          'output-token limit',
        );
        expect(panel.current()).toBeNull();
      }
    },
  );
  it('uses question progress, preserves a failed question and restores the action', async () => {
    const { fixture, panel, api } = await setup(true);
    let fail!: (error: Error) => void;
    api.ask.mockImplementationOnce(
      () =>
        new Promise<{ id: string }>((_resolve, reject) => {
          fail = reject;
        }),
    );
    panel.questionDraft.set({ question: 'Which alternative explanation remains?' });
    panel.questionConsent.set({ consent: true });
    const request = panel.ask();
    await fixture.whenStable();
    expect(panel.isAsking()).toBe(true);
    expect(panel.isAnalyzing()).toBe(false);
    expect(
      fixture.nativeElement.querySelector('.passage-question .request-processing').textContent,
    ).toContain('Preparing your source-linked answer');
    expect(panel.canAsk()).toBe(false);
    fail(new Error('The model declined this request.'));
    await request;
    await fixture.whenStable();
    expect(panel.pending()).toBeNull();
    expect(panel.questionDraft().question).toBe('Which alternative explanation remains?');
    expect(panel.canAsk()).toBe(true);
    expect(panel.current()).toEqual(analysis);
    expect(fixture.nativeElement.querySelector('.request-processing')).toBeNull();
  });
  it('does not label an earlier document request as processing the new source', async () => {
    const { fixture, panel, api } = await setup();
    let finish!: (result: Analysis) => void;
    api.analyze.mockImplementationOnce(
      () =>
        new Promise<Analysis>((resolve) => {
          finish = resolve;
        }),
    );
    panel.consentDraft.set({ consent: true });
    const request = panel.analyze();
    fixture.componentRef.setInput('detail', {
      ...detail,
      document: { ...detail.document, id: 'other-document' },
    });
    await fixture.whenStable();
    expect(panel.isAnalyzing()).toBe(false);
    expect(panel.processingLabel()).toContain('An earlier request');
    finish(analysis);
    await request;
    await fixture.whenStable();
    expect(panel.pending()).toBeNull();
    expect(panel.current()).toBeNull();
  });
  it('offers verified levels and sends thinking without leaking capability fields', async () => {
    const { fixture, panel, api } = await setup();
    fixture.componentRef.setInput('choices', [
      {
        provider: 'google',
        model: 'gemini-3.8-flash',
        thinking_levels: ['default', 'low', 'medium', 'high'],
      },
    ]);
    await fixture.whenStable();
    const select: HTMLSelectElement = fixture.nativeElement.querySelector(
      'select[aria-describedby="setup-thinking-help"]',
    );
    expect([...select.options].map((option) => option.value)).toEqual([
      'default',
      'low',
      'medium',
      'high',
    ]);
    expect(panel.thinkingDraft().thinking).toBe('default');
    select.value = 'medium';
    select.dispatchEvent(new Event('input'));
    select.dispatchEvent(new Event('change'));
    await fixture.whenStable();
    panel.consentDraft.set({ consent: true });
    await panel.analyze();
    const request = api.analyze.mock.calls[0][0];
    expect(request).toEqual(
      expect.objectContaining({ model: 'gemini-3.8-flash', thinking: 'medium' }),
    );
    expect(request).not.toHaveProperty('thinking_levels');
    expect(request).not.toHaveProperty('destination');
  });
  it('sends Luna Max from the native selector and resets it when switching to Google', async () => {
    const { fixture, panel, api } = await setup();
    fixture.componentRef.setInput('choices', [
      {
        provider: 'openai',
        model: 'gpt-6-luna',
        thinking_levels: ['default', 'low', 'medium', 'high', 'xhigh', 'max'],
      },
      {
        provider: 'google',
        model: 'gemini-3.8-flash',
        thinking_levels: ['default', 'low', 'medium', 'high'],
      },
    ]);
    panel.draft.update((draft) => ({ ...draft, destination: 'openai:gpt-6-luna' }));
    await fixture.whenStable();
    const select: HTMLSelectElement = fixture.nativeElement.querySelector(
      'select[aria-describedby="setup-thinking-help"]',
    );
    expect([...select.options].map((option) => option.value)).toContain('max');
    select.value = 'max';
    select.dispatchEvent(new Event('input'));
    select.dispatchEvent(new Event('change'));
    await fixture.whenStable();
    panel.consentDraft.set({ consent: true });
    await panel.analyze();
    expect(api.analyze).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'openai', model: 'gpt-6-luna', thinking: 'max' }),
    );
    panel.consentDraft.set({ consent: true });
    panel.questionConsent.set({ consent: true });
    panel.draft.update((draft) => ({ ...draft, destination: 'google:gemini-3.8-flash' }));
    await fixture.whenStable();
    expect(panel.thinkingDraft().thinking).toBe('default');
    expect(panel.thinkingLevels()).not.toContain('max');
    expect(panel.consentDraft().consent).toBe(false);
    expect(panel.questionConsent().consent).toBe(false);
    expect(panel.thinkingDescription({ thinking: 'max' })).toBe('Thinking: Max');
  });
  it('revokes both consents when thinking changes and resets unsupported destinations', async () => {
    const { fixture, panel } = await setup(true);
    fixture.componentRef.setInput('choices', [
      {
        provider: 'google',
        model: 'gemini-3.8-flash',
        thinking_levels: ['default', 'low', 'medium', 'high'],
      },
      { provider: 'openai', model: 'unknown', thinking_levels: ['default'] },
    ]);
    await fixture.whenStable();
    panel.draft.update((d) => ({ ...d, destination: 'google:gemini-3.8-flash' }));
    panel.consentDraft.set({ consent: true });
    panel.questionConsent.set({ consent: true });
    panel.thinkingDraft.set({ thinking: 'high' });
    expect(panel.consentDraft().consent).toBe(false);
    expect(panel.questionConsent().consent).toBe(false);
    panel.draft.update((d) => ({ ...d, destination: 'openai:unknown' }));
    expect(panel.thinkingDraft().thinking).toBe('default');
    expect(panel.thinkingLevels()).toEqual(['default']);
    await fixture.whenStable();
    expect(
      fixture.nativeElement.querySelector('select[aria-describedby="question-thinking-help"]'),
    ).toBeNull();
  });
  it('carries question thinking separately from saved reading metadata', async () => {
    const { fixture, panel, api } = await setup(true);
    fixture.componentRef.setInput('choices', [
      {
        provider: 'google',
        model: 'gemini-3.8-flash',
        thinking_levels: ['default', 'low', 'medium', 'high'],
      },
    ]);
    await fixture.whenStable();
    panel.thinkingDraft.set({ thinking: 'low' });
    panel.questionDraft.set({ question: 'How does this passage justify the method?' });
    panel.questionConsent.set({ consent: true });
    await panel.ask();
    expect(api.ask).toHaveBeenCalledWith('analysis', expect.objectContaining({ thinking: 'low' }));
    expect(api.ask.mock.calls[0][1]).not.toHaveProperty('thinking_levels');
    expect(panel.current()?.output.request_settings).toBeUndefined();
    expect(panel.thinkingDescription(panel.current()?.output.request_settings)).toContain(
      'Not recorded',
    );
    expect(panel.thinkingDescription({ thinking: 'medium' })).toBe('Thinking: Medium');
    expect(panel.thinkingDescription({ thinking: 'default' })).toBe('Thinking: Provider default');
  });
  it('does not send an injected unsupported level for a default-only destination', async () => {
    const { fixture, panel, api } = await setup();
    panel.thinkingDraft.set({ thinking: 'medium' });
    panel.consentDraft.set({ consent: true });
    await fixture.whenStable();
    expect(panel.canAnalyze()).toBe(false);
    await panel.analyze();
    expect(api.analyze).not.toHaveBeenCalled();
  });
  it('replaces both native consent controls when the thinking context changes', async () => {
    const { fixture, panel } = await setup(true);
    fixture.componentRef.setInput('choices', [
      {
        provider: 'google',
        model: 'gemini-3.8-flash',
        thinking_levels: ['default', 'low', 'medium', 'high'],
      },
    ]);
    const choose = async (help: string, level: string) => {
      const select: HTMLSelectElement = fixture.nativeElement.querySelector(
        `select[aria-describedby="${help}"]`,
      );
      select.value = level;
      select.dispatchEvent(new Event('input'));
      select.dispatchEvent(new Event('change'));
      await fixture.whenStable();
    };
    const analysisBox = (): HTMLInputElement =>
      fixture.nativeElement.querySelector('.analysis-setup input[type="checkbox"]');
    const questionBox = (): HTMLInputElement =>
      fixture.nativeElement.querySelector(
        '[aria-labelledby="setup-consent-title"] input[type="checkbox"]',
      );

    panel.setupOpen.set(true);
    await fixture.whenStable();
    const priorAnalysis = analysisBox();
    priorAnalysis.click();
    await fixture.whenStable();
    expect(panel.consentDraft().consent).toBe(true);
    await choose('setup-thinking-help', 'high');
    expect(priorAnalysis.isConnected).toBe(false);
    expect(analysisBox().checked).toBe(false);
    expect(panel.consentFields.consent().value()).toBe(false);

    panel.setupOpen.set(false);
    panel.settingsOpen.set(true);
    await fixture.whenStable();
    const priorQuestion = questionBox();
    priorQuestion.click();
    await fixture.whenStable();
    expect(panel.questionConsent().consent).toBe(true);
    await choose('question-thinking-help', 'medium');
    expect(priorQuestion.isConnected).toBe(false);
    expect(questionBox().checked).toBe(false);
    expect(panel.questionConsentFields.consent().value()).toBe(false);
  });
  it('requires consent before asking or confirming the request settings', async () => {
    const { fixture, panel } = await setup(true);
    panel.questionDraft.set({ question: 'Which alternative explanation remains?' });
    panel.settingsOpen.set(true);
    await fixture.whenStable();
    const done = (): HTMLButtonElement =>
      [...fixture.nativeElement.querySelectorAll('.setup-dialog-footer button')].find(
        (button: HTMLButtonElement) => button.textContent?.includes('Done'),
      );
    expect(panel.canAsk()).toBe(false);
    expect(done().disabled).toBe(true);
    panel.questionConsent.set({ consent: true });
    await fixture.whenStable();
    expect(panel.canAsk()).toBe(true);
    expect(done().disabled).toBe(false);
  });
});
