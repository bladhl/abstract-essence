import { test, expect, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const quote = 'The pilot included twenty volunteers.';
const passages = [
  'Research question: how do guided annotations affect understanding?',
  quote,
  'Participants used a guided reading map.',
  'Scores were higher in the annotated group.',
  'The convenience sample does not establish causality.',
  quote,
];
const sourceText = passages.join('\n');
const docs = ['first', 'second'].map((id) => ({
  id,
  title: `${id} pilot`,
  filename: `${id}.pdf`,
  total_pages: 2,
  created_at: '',
}));
const analysis = (id: string) => ({
  id: `analysis-${id}`,
  document_id: id,
  provider: 'openai',
  model: 'test-model',
  page_start: 1,
  page_end: 1,
  attempt: 'The pilot explores the question but cannot establish causality.',
  created_at: '',
  output: {
    insights: ['problem', 'method', 'evidence', 'argument'].map((lens) => ({
      lens,
      author_excerpt: { page: 1, quote },
      interpretation: `${lens}: a preliminary investigation.`,
      limitation: 'The sample does not establish causality.',
    })),
    learning_feedback: 'You identified an important limitation.',
    next_question: 'Which competing explanation remains?',
  },
});

const guidedAnalysis = (id: string) => ({
  ...analysis(id),
  id: `map-${id}`,
  attempt: '',
  output: {
    ...analysis(id).output,
    reading_map: {
      version: 'annotated-reading-v1',
      overview:
        'The pilot connects a reading question with guided annotation and preliminary evidence, not a causal proof.',
      annotations: [
        {
          role: 'problem',
          title: 'The question driving the study',
          citation: { page: 1, quote: passages[0] },
        },
        {
          role: 'contribution',
          title: 'A guided reading contribution',
          citation: { page: 1, quote: passages[2] },
        },
        { role: 'approach', title: 'Sampling the pilot', citation: { page: 1, quote } },
        {
          role: 'evidence',
          title: 'A preliminary result',
          citation: { page: 1, quote: passages[3] },
        },
        { role: 'limits', title: 'No causal claim', citation: { page: 1, quote: passages[4] } },
        {
          role: 'approach',
          title: 'A second role for the passage',
          citation: { page: 1, quote: passages[2] },
        },
      ].map((annotation) => ({
        ...annotation,
        explanation: `This passage performs the ${annotation.role} role in the selected argument.`,
        caveat: 'An interpretation is not a verdict.',
        question: 'What alternative explanation remains?',
      })),
      gaps: [],
    },
  },
});

async function mockWorkspace(page: Page, configured = true, saved = true, withThinking = false) {
  const details = Object.fromEntries(
    docs.map((doc) => [
      doc.id,
      {
        document: doc,
        pages: [
          { number: 1, text: sourceText },
          { number: 2, text: 'A larger study is required.' },
        ],
        analyses: saved ? [analysis(doc.id)] : [],
        notes: [],
      },
    ]),
  );
  const connections: object[] = [];
  const feedback: object[] = [];
  await page.route('**/api/**', async (route) => {
    const request = route.request(),
      path = new URL(request.url()).pathname;
    let result: unknown;
    if (path === '/api/config')
      result = {
        choices: configured
          ? [
              { provider: 'openai', model: 'test-model' },
              { provider: 'google', model: 'test-model' },
              ...(withThinking
                ? [
                    {
                      provider: 'google',
                      model: 'gemini-3.8-flash',
                      thinking_levels: ['default', 'low', 'medium', 'high'],
                    },
                    {
                      provider: 'openai',
                      model: 'gpt-6-luna',
                      thinking_levels: ['default', 'low', 'medium', 'high', 'xhigh', 'max'],
                    },
                  ]
                : []),
            ]
          : [],
      };
    else if (path === '/api/documents') {
      if (request.method() === 'POST') {
        const body = request.postDataJSON();
        const doc = {
          id: 'imported',
          title: body.title,
          filename: body.filename,
          total_pages: body.total_pages,
          created_at: '',
        };
        docs.push(doc);
        details[doc.id] = { document: doc, pages: body.pages, analyses: [], notes: [] };
        result = doc;
      } else result = docs;
    } else if (path.startsWith('/api/documents/')) result = details[path.split('/')[3]];
    else if (path === '/api/reading/analyses') {
      const body = request.postDataJSON();
      expect(body.consent).toBe(true);
      expect(body.attempt).toBe('');
      expect(body.mode).toBe('guided');
      expect(body).not.toHaveProperty('destination');
      const guided = guidedAnalysis(body.document_id);
      result = {
        ...guided,
        ...body,
        output: { ...guided.output, request_settings: { thinking: body.thinking ?? 'default' } },
      };
      details[body.document_id].analyses.push(result as ReturnType<typeof analysis>);
    } else if (path.endsWith('/feedback')) {
      if (request.method() === 'POST')
        feedback.push({
          id: 'reply',
          ...request.postDataJSON(),
          output: {
            request_context: request.postDataJSON().context,
            request_settings: { thinking: request.postDataJSON().thinking ?? 'default' },
            answer: 'The pilot cannot establish causality.',
            citations: [{ page: 1, quote }],
            limitation: 'Selected pages only.',
          },
        });
      result = request.method() === 'POST' ? feedback.at(-1) : feedback;
    } else if (path === '/api/learning/notes') {
      const body = request.postDataJSON();
      result = { id: 'note', ...body };
      details[body.document_id].notes.push(result as never);
    } else if (path === '/api/learning/connections') {
      if (request.method() === 'POST')
        connections.push({ id: 'connection', ...request.postDataJSON() });
      result = request.method() === 'POST' ? connections.at(-1) : connections;
    } else throw new Error(`Unexpected test API request: ${request.method()} ${path}`);
    await route.fulfill({ status: request.method() === 'POST' ? 201 : 200, json: result });
  });
  await page.goto('/');
  // On mobile the sidebar stays closed until the library toggle opens it.
  await page.locator('#research-tools').waitFor({ state: 'attached' });
  const libraryToggle = page.getByRole('button', { name: 'Open library', exact: true });
  if (await libraryToggle.isVisible()) await libraryToggle.click();
  await page.getByRole('button', { name: 'first pilot 2 pages' }).click();
}

test('document-first map requires consent, links highlights and contextual questions, then learning notes', async ({
  page,
}) => {
  await mockWorkspace(page, true, false);
  const analyze = page.getByRole('button', { name: 'Create reading map', exact: true });
  await expect(analyze).toBeDisabled();
  await expect(page.getByLabel('What problem is being studied')).toHaveCount(0);
  await page.getByLabel('AI destination').selectOption('openai:test-model');
  await page.getByRole('checkbox').check();
  await page.getByLabel('Last PDF page').fill('1');
  await expect(page.getByRole('checkbox')).not.toBeChecked();
  await page.getByRole('checkbox').check();
  await page.getByLabel('AI destination').selectOption('google:test-model');
  await expect(page.getByRole('checkbox')).not.toBeChecked();
  await page.getByRole('checkbox').check();
  await analyze.click();
  await expect(page.getByRole('heading', { name: 'How this argument works' })).toBeVisible();
  await expect(page.locator('.argument-card')).toHaveCount(6);
  await page.locator('.reading-context > summary').click();
  const source = page.locator('app-source-reader');
  await source
    .getByRole('button', {
      name: 'Contribution: A guided reading contribution; Approach: A second role for the passage',
    })
    .click();
  await expect(page.getByText('This passage has more than one possible role.')).toBeVisible();
  await page
    .getByRole('button', { name: 'Approach: A second role for the passage', exact: true })
    .click();
  await expect(
    page
      .locator('.annotation-inspector')
      .getByRole('heading', { name: 'A second role for the passage' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Evidence', exact: true }).click();
  await expect(source.locator('.annotation-mark')).toHaveCount(1);
  await source.getByRole('button', { name: 'Evidence: A preliminary result' }).focus();
  await source.getByRole('button', { name: 'Evidence: A preliminary result' }).press('Enter');
  await expect(
    page.locator('.annotation-inspector').getByText('This passage performs the evidence role'),
  ).toBeVisible();
  await page.getByLabel('Question or challenge').fill('Does this design establish causality?');
  await expect(page.getByRole('button', { name: 'Ask with source evidence' })).toBeDisabled();
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Ask with source evidence' }).click();
  await expect(
    page.getByText('The pilot cannot establish causality.', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'All annotations', exact: true }).click();
  await expect(page.getByText('An excerpt repeats on this page.')).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  await page.getByRole('button', { name: 'Explain in my own words' }).click();
  await expect(page.getByLabel('Note type')).toHaveValue('attempt');
  await page
    .getByLabel('Your thinking')
    .fill('I understand that the sample limits what can be concluded.');
  await page.getByRole('button', { name: 'Save source-linked note' }).click();
  await expect(page.getByText('Source-linked note saved.')).toBeVisible();
});

test('comparison and manual bibliographic connections', async ({ page }) => {
  await mockWorkspace(page);
  await page.getByRole('button', { name: 'Compare readings', exact: true }).click();
  await page.getByLabel('First reading').selectOption('analysis-first');
  await page.getByLabel('Second reading').selectOption('analysis-second');
  await expect(page.getByRole('table')).toBeVisible();
  await expect(page.getByRole('row')).toHaveCount(5);
  await page.getByRole('button', { name: 'Connections', exact: true }).click();
  await page.getByRole('combobox', { name: 'From', exact: true }).selectOption('first');
  await page.getByRole('combobox', { name: 'To', exact: true }).selectOption('second');
  await page.getByLabel('Relationship', { exact: true }).fill('contrasts with');
  await page
    .getByLabel('Why are they connected?')
    .fill('The methods address similar questions with different samples.');
  await page.getByRole('button', { name: 'Save connection' }).click();
  await expect(page.getByText('YOUR CONNECTION', { exact: true })).toBeVisible();
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test('mobile reading is accessible and no provider is honestly unavailable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockWorkspace(page, false);
  await expect(page.getByText('No AI provider configured')).toBeVisible();
  await page.getByRole('button', { name: 'Analyze another scope' }).click();
  await expect(
    page.getByRole('button', { name: 'Create reading map', exact: true }),
  ).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test('dark is the first-visit default; the keyboard toggle persists both choices', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await mockWorkspace(page);
  const toggle = page.getByRole('button', { name: 'Dark theme' });
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await page.locator('html').evaluate((el) => getComputedStyle(el).colorScheme)).toBe(
    'dark',
  );

  await toggle.focus();
  await expect(toggle).toBeFocused();
  expect(await toggle.evaluate((el) => getComputedStyle(el).outlineWidth)).toBe('3px');
  await toggle.press('Space');
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  expect(await page.locator('html').evaluate((el) => getComputedStyle(el).colorScheme)).toBe(
    'light',
  );
  await page.reload();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await toggle.press('Enter');
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await page.reload();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
});

for (const theme of ['dark', 'light'] as const) {
  test(`${theme} reading retains measured contrast, highlights and accessible states`, async ({
    page,
  }) => {
    if (theme === 'light')
      await page.addInitScript(() =>
        localStorage.setItem('abstract-essence:reading-theme', 'light'),
      );
    await mockWorkspace(page, false);
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    await expect(page.getByText('No AI provider configured')).toBeVisible();
    await page.getByRole('button', { name: 'Analyze another scope' }).click();
    await expect(
      page.getByRole('button', { name: 'Create reading map', exact: true }),
    ).toBeDisabled();

    const ratios = await page.evaluate(() => {
      const styles = getComputedStyle(document.documentElement);
      function luminance(value: string) {
        const parts = value
          .trim()
          .replace('#', '')
          .match(/../g)!
          .map((part) => parseInt(part, 16) / 255);
        const [r, g, b] = parts.map((v) =>
          v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4,
        );
        return r * 0.2126 + g * 0.7152 + b * 0.0722;
      }
      function ratio(first: string, second: string) {
        const a = luminance(styles.getPropertyValue(`--${first}`));
        const b = luminance(styles.getPropertyValue(`--${second}`));
        return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      }
      return {
        source: ratio('reading-text', 'surface'),
        markProblem: ratio('annotation-text', 'mark-problem'),
        markContribution: ratio('annotation-text', 'mark-contribution'),
        markApproach: ratio('annotation-text', 'mark-approach'),
        markEvidence: ratio('annotation-text', 'mark-evidence'),
        markLimits: ratio('annotation-text', 'mark-limits'),
        roleProblem: ratio('role-problem', 'surface'),
        roleContribution: ratio('role-contribution', 'surface'),
        roleApproach: ratio('role-approach', 'surface'),
        roleEvidence: ratio('role-evidence', 'surface'),
        roleLimits: ratio('role-limits', 'surface'),
        highlightedSource: ratio('highlight-text', 'highlight-background'),
        body: ratio('text', 'surface'),
        muted: ratio('muted', 'surface-hover'),
        placeholder: ratio('placeholder', 'field-background'),
        primary: ratio('on-accent', 'accent'),
        primaryHover: ratio('on-accent', 'accent-hover'),
        error: ratio('error-text', 'error-background'),
        notice: ratio('notice-text', 'notice-background'),
        selection: ratio('selection-text', 'selection-background'),
        fieldBorder: ratio('control-border', 'field-background'),
        buttonBorder: ratio('control-border', 'surface'),
        hoverBorder: ratio('control-border', 'surface-hover'),
        scopeBorder: ratio('control-border', 'surface-subtle'),
        focus: ratio('focus', 'surface-hover'),
        selectedText: ratio('selection-text', 'selection-background'),
        selectedProblem: ratio('annotation-selected-text', 'mark-selected-problem'),
        selectedContribution: ratio('annotation-selected-text', 'mark-selected-contribution'),
        selectedApproach: ratio('annotation-selected-text', 'mark-selected-approach'),
        selectedEvidence: ratio('annotation-selected-text', 'mark-selected-evidence'),
        selectedLimits: ratio('annotation-selected-text', 'mark-selected-limits'),
        chipProblem: ratio('role-problem', 'chip-problem'),
        chipContribution: ratio('role-contribution', 'chip-contribution'),
        chipApproach: ratio('role-approach', 'chip-approach'),
        chipEvidence: ratio('role-evidence', 'chip-evidence'),
        chipLimits: ratio('role-limits', 'chip-limits'),
        mutedOnBackground: ratio('muted', 'background'),
        accentTextOnSurface: ratio('accent-text', 'surface'),
        errorBorder: ratio('error-border', 'error-background'),
      };
    });
    expect(ratios.source).toBeGreaterThanOrEqual(7);
    // Dark targets WCAG 2.2 AAA (7:1 text, 3:1 control borders and focus). Light keeps its
    // earlier AA thresholds until it is redesigned.
    for (const [state, ratio] of Object.entries(ratios)) {
      const textMinimum = theme === 'dark' || state.startsWith('mark') ? 7 : 4.5;
      expect(ratio, state).toBeGreaterThanOrEqual(
        state.endsWith('Border') || state === 'focus' ? 3 : textMinimum,
      );
    }

    await page.getByText('Saved readings (1)', { exact: true }).click();
    await page.getByRole('button', { name: 'Pages 1–1 · openai / test-model' }).click();
    await page.locator('.reading-context > summary').click();
    await page.locator('.argument-card').first().click();
    await expect(page.locator('mark').first()).toContainText(quote);
    await page.getByRole('button', { name: 'Analyze another scope' }).click();
    await page.getByLabel('Last PDF page').fill('0');
    await expect(
      page.getByText('Choose a valid range with readable text within the limits.'),
    ).toBeVisible();
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

    await page.setViewportSize({ width: 390, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);

    // Doubling the 16px root exercises text resizing, not device zoom.
    await page.addStyleTag({ content: 'html { font-size: 32px; }' });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await expect(page.getByRole('button', { name: 'Dark theme' })).toBeVisible();
  });

  test(`${theme} preference is applied before Angular loads`, async ({ page }) => {
    if (theme === 'light')
      await page.addInitScript(() =>
        localStorage.setItem('abstract-essence:reading-theme', 'light'),
      );
    await page.route('**/*.js', (route) => route.abort());
    await page.goto('/', { waitUntil: 'domcontentloaded' });
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    expect(await page.locator('html').evaluate((el) => getComputedStyle(el).colorScheme)).toBe(
      theme,
    );
    expect(await page.locator('html').evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(
      theme === 'dark' ? 'rgb(26, 26, 26)' : 'rgb(242, 245, 250)',
    );
  });
}

test('dark interactive targets are at least 44 by 44 CSS pixels (WCAG 2.5.5)', async ({ page }) => {
  await mockWorkspace(page);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: 'Analyze another scope' }).click();
  const targets = [
    page.getByRole('button', { name: 'Collapse sidebar' }),
    page.getByRole('button', { name: 'Dark theme' }),
    page.locator('.topbar .upload-button'),
    page.getByRole('button', { name: 'Reading room', exact: true }),
    page.getByRole('button', { name: 'Compare readings', exact: true }),
    page.getByRole('searchbox', { name: 'Find a document' }),
    page.getByRole('button', { name: 'first pilot 2 pages' }),
    page.getByRole('button', { name: 'Close analysis setup' }),
    page.getByRole('combobox', { name: 'AI destination' }),
    page.getByLabel('First PDF page'),
    page.locator('.analysis-setup label.checkbox'),
    page.getByRole('button', { name: 'Create reading map', exact: true }),
    page.getByRole('button', { name: 'Previous page' }),
    page.getByRole('button', { name: 'Next page' }),
    page.locator('.reading-context > summary'),
    page.locator('.excerpt-picker > summary'),
    page.getByRole('button', { name: 'Export work' }),
  ];
  for (const target of targets) {
    const box = await target.first().boundingBox();
    const name = await target.first().evaluate((el) => el.outerHTML.slice(0, 80));
    expect(box, name).not.toBeNull();
    expect(box!.width, name).toBeGreaterThanOrEqual(44);
    expect(box!.height, name).toBeGreaterThanOrEqual(44);
  }
  await page.getByRole('button', { name: 'Collapse sidebar' }).click();
  const rail = page.getByRole('navigation', { name: 'Workspace shortcuts' });
  await expect(rail).toBeVisible();
  for (const link of await rail.getByRole('button').all()) {
    const box = await link.boundingBox();
    expect(box!.width).toBeGreaterThanOrEqual(44);
    expect(box!.height).toBeGreaterThanOrEqual(44);
  }
  await page.getByRole('button', { name: 'Expand sidebar' }).click();
  await expect(page.getByRole('navigation', { name: 'Research tools' })).toBeVisible();
});

test('invalid or blocked preference storage falls back safely without disabling the toggle', async ({
  page,
}) => {
  await page.addInitScript(() =>
    localStorage.setItem('abstract-essence:reading-theme', 'unexpected'),
  );
  await mockWorkspace(page);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', {
      get() {
        throw new DOMException('Blocked', 'SecurityError');
      },
    });
  });
  await page.reload();
  const toggle = page.getByRole('button', { name: 'Dark theme' });
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
});

test('a wrapped passage keeps one inline mark and the sheet never scrolls sideways', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 720 });
  await mockWorkspace(page);
  const marks = page.locator('.annotation-mark');
  await expect(marks.first()).toBeVisible();
  const result = await page.evaluate(() => {
    const all = [...document.querySelectorAll<HTMLElement>('.annotation-mark')];
    const sheet = document.querySelector<HTMLElement>('.source-sheet')!;
    return {
      inline: all.every((mark) => getComputedStyle(mark).display === 'inline'),
      wrapped: all.some((mark) => mark.getClientRects().length > 1),
      fitsSheet: sheet.scrollWidth <= sheet.clientWidth,
      interactive: all.every(
        (mark) => mark.getAttribute('role') === 'button' && mark.tabIndex === 0,
      ),
    };
  });
  expect(result).toEqual({ inline: true, wrapped: true, fitsSheet: true, interactive: true });
  // Space activates the mark like a button.
  const mark = marks.first();
  await mark.focus();
  await mark.press('Space');
  await expect(mark).toHaveAttribute('aria-pressed', 'true');
  // Hard PDF line breaks are joined for display only; the quote still matches across them.
  expect(await page.locator('.source-text').evaluate((el) => el.textContent!.includes('\n'))).toBe(
    false,
  );
});

test('desktop reading room fills the viewport; only the sheet and inspector scroll', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await mockWorkspace(page);
  await expect(page.locator('.source-sheet')).toBeVisible();
  const layout = await page.evaluate(() => {
    const root = document.scrollingElement!;
    const overflow = (selector: string) =>
      getComputedStyle(document.querySelector(selector)!).overflowY;
    const pager = document.querySelector('.pager')!.getBoundingClientRect();
    const regions = document.querySelector<HTMLElement>('.reading-regions')!;
    const main = document.querySelector('.reading-main')!;
    return {
      pageFits: root.scrollHeight <= window.innerHeight,
      sheet: overflow('.source-sheet'),
      inspector: overflow('.annotation-inspector'),
      pagerInView: pager.bottom <= window.innerHeight,
      regionsBounded: regions.offsetHeight <= main.getBoundingClientRect().height * 0.45 + 1,
    };
  });
  expect(layout).toEqual({
    pageFits: true,
    sheet: 'auto',
    inspector: 'auto',
    pagerInView: true,
    regionsBounded: true,
  });
  const progress = page.getByRole('progressbar', { name: 'Reading progress' });
  await expect(progress).toHaveAttribute('aria-valuenow', '1');
  await expect(progress).toHaveAttribute('aria-valuemax', '2');
  await page.getByRole('button', { name: 'Next page' }).click();
  await expect(progress).toHaveAttribute('aria-valuenow', '2');
});

function syntheticPdf(): Buffer {
  const content = `BT /F1 10 Tf 40 750 Td 14 TL ${passages.map((line) => `(${line.replace(/[\\()]/g, '\\$&')}) Tj T*`).join(' ')} ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
    .join('')}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf);
}

test('verified thinking selection resets consent, reaches analysis and questions, and preserves legacy disclosure', async ({
  page,
}, testInfo) => {
  const analysisRequests: Record<string, unknown>[] = [];
  const questionRequests: Record<string, unknown>[] = [];
  page.on('request', (request) => {
    if (request.method() !== 'POST') return;
    if (request.url().endsWith('/api/reading/analyses'))
      analysisRequests.push(request.postDataJSON());
    if (request.url().endsWith('/feedback')) questionRequests.push(request.postDataJSON());
  });
  await mockWorkspace(page, true, true, true);
  await page.locator('.reading-context > summary').click();
  await expect(page.getByText('Thinking: Not recorded for this earlier result')).toBeVisible();
  await page.getByRole('button', { name: 'Analyze another scope' }).click();
  await page
    .getByRole('combobox', { name: 'AI destination', exact: true })
    .selectOption('google:gemini-3.8-flash');
  const thinking = page.getByRole('combobox', { name: 'Thinking', exact: true });
  await expect(thinking.locator('option')).toHaveText([
    'Provider default',
    'Low',
    'Medium',
    'High',
  ]);
  await thinking.selectOption('medium');
  await expect(page.locator('#setup-thinking-help')).toContainText('Thinking: Medium');
  await page.screenshot({ path: testInfo.outputPath('thinking-controls.png'), fullPage: true });
  const analysisConsent = page.locator('.analysis-setup').getByRole('checkbox');
  await analysisConsent.check();
  await thinking.selectOption('high');
  await expect(page.locator('#setup-thinking-help')).toContainText('Thinking: High');
  await expect(analysisConsent).not.toBeChecked();
  await expect(
    page.getByRole('button', { name: 'Create reading map', exact: true }),
  ).toBeDisabled();
  await page
    .getByRole('combobox', { name: 'AI destination', exact: true })
    .selectOption('openai:test-model');
  await expect(thinking).toHaveCount(0);
  await page
    .getByRole('combobox', { name: 'AI destination', exact: true })
    .selectOption('google:gemini-3.8-flash');
  await expect(thinking).toHaveValue('default');
  await thinking.selectOption('medium');
  await analysisConsent.check();
  await page.getByRole('button', { name: 'Create reading map', exact: true }).click();
  expect(analysisRequests).toHaveLength(1);
  expect(analysisRequests[0]).toMatchObject({
    provider: 'google',
    model: 'gemini-3.8-flash',
    thinking: 'medium',
  });
  expect(analysisRequests[0]).not.toHaveProperty('thinking_levels');
  expect(analysisRequests[0]).not.toHaveProperty('destination');
  await expect(page.locator('.argument-overview')).toContainText('Thinking: Medium');
  await page.getByRole('button', { name: 'Change AI request settings' }).click();
  await thinking.selectOption('low');
  await expect(page.locator('#question-thinking-help')).toContainText('Question thinking: Low');
  await page.getByLabel('Question or challenge').fill('Why is this method appropriate?');
  const questionConsent = page.locator('.passage-question').getByRole('checkbox');
  await questionConsent.check();
  await thinking.selectOption('high');
  await expect(page.locator('#question-thinking-help')).toContainText('Question thinking: High');
  await expect(questionConsent).not.toBeChecked();
  await questionConsent.check();
  await page.getByRole('button', { name: 'Ask with source evidence' }).click();
  expect(questionRequests).toHaveLength(1);
  expect(questionRequests[0]).toMatchObject({ thinking: 'high' });
  expect(questionRequests[0]).not.toHaveProperty('thinking_levels');
  expect(questionRequests[0]).toHaveProperty('context.citation');
  await expect(page.locator('.feedback')).toContainText('Thinking: High');
  await expect(page.locator('.argument-overview')).toContainText('Thinking: Medium');
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test('Luna Max reaches analysis and questions through the native controls', async ({ page }) => {
  const requests: Record<string, unknown>[] = [];
  page.on('request', (request) => {
    if (
      request.method() === 'POST' &&
      (request.url().endsWith('/api/reading/analyses') || request.url().endsWith('/feedback'))
    )
      requests.push(request.postDataJSON());
  });
  await mockWorkspace(page, true, false, true);
  await page
    .getByRole('combobox', { name: 'AI destination', exact: true })
    .selectOption('openai:gpt-6-luna');
  const thinking = page.getByRole('combobox', { name: 'Thinking', exact: true });
  await thinking.selectOption('max');
  await expect(page.locator('#setup-thinking-help')).toContainText('Thinking: Max');
  await page.locator('.analysis-setup').getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Create reading map', exact: true }).click();
  await expect(page.locator('.argument-overview')).toContainText('Thinking: Max');
  await page.getByRole('button', { name: 'Change AI request settings' }).click();
  await expect(thinking).toHaveValue('max');
  await page.getByLabel('Question or challenge').fill('Which alternative explanation remains?');
  await page.locator('.passage-question').getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Ask with source evidence' }).click();
  await expect(page.locator('.feedback')).toContainText('Thinking: Max');
  expect(requests).toHaveLength(2);
  for (const request of requests) {
    expect(request).toMatchObject({
      provider: 'openai',
      model: 'gpt-6-luna',
      thinking: 'max',
      consent: true,
    });
    expect(request).not.toHaveProperty('thinking_levels');
    expect(request).not.toHaveProperty('destination');
  }
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test('PDF import opens a bounded local-first setup, never an automatic provider call', async ({
  page,
}) => {
  let calls = 0;
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().endsWith('/api/reading/analyses')) calls++;
  });
  await mockWorkspace(page, true, false);
  await page.getByLabel('Import PDF', { exact: true }).setInputFiles({
    name: 'synthetic-reading.pdf',
    mimeType: 'application/pdf',
    buffer: syntheticPdf(),
  });
  await expect(page.getByText('Imported 1 pages. Nothing was sent to AI.')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Create an annotated reading' })).toBeVisible();
  expect(calls).toBe(0);
  await expect(
    page.getByRole('button', { name: 'Create reading map', exact: true }),
  ).toBeDisabled();
  await page.getByLabel('AI destination').selectOption('google:test-model');
  await page.getByRole('checkbox').check();
  await page.getByRole('button', { name: 'Create reading map', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'How this argument works' })).toBeVisible();
  expect(calls).toBe(1);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test('mobile study view preserves source position and exposes explanations without an AI request', async ({
  page,
}) => {
  let modelRequests = 0;
  page.on('request', (request) => {
    if (request.method() === 'POST' && request.url().includes('/api/reading/')) modelRequests++;
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await mockWorkspace(page);
  const source = page.getByLabel('Extracted page text');
  await expect(source).toBeVisible();
  expect((await source.boundingBox())!.y).toBeLessThan(844 - 130);
  const marked = page.locator('.annotation-mark').first();
  await marked.focus();
  await marked.press('Enter');
  await expect(page.getByRole('heading', { name: 'Why this part matters' })).toBeFocused();
  await expect(source).not.toBeVisible();
  await page.getByRole('button', { name: 'Read source', exact: true }).click();
  await expect(source).toBeVisible();
  await expect(page.locator('.annotation-mark').first()).toHaveAttribute('aria-pressed', 'true');
  expect(modelRequests).toBe(0);
  expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
});

test('the mobile library can be opened, searched and dismissed by selecting a source', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockWorkspace(page);
  await expect(page.getByRole('button', { name: 'Open library', exact: true })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  await page.getByRole('button', { name: 'Open library', exact: true }).click();
  await page.getByRole('searchbox', { name: 'Find a document' }).fill('second');
  await expect(page.getByRole('button', { name: 'first pilot 2 pages' })).toHaveCount(0);
  await page.getByRole('button', { name: 'second pilot 2 pages' }).click();
  await expect(page.getByRole('button', { name: 'Open library', exact: true })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  await expect(page.locator('.document-heading')).toContainText('second pilot');
});

test('destination and thinking remain in one request-settings location when setup opens', async ({
  page,
}) => {
  await mockWorkspace(page, true, true, true);
  await page.getByRole('button', { name: 'Change AI request settings' }).click();
  await page
    .getByRole('combobox', { name: 'AI destination', exact: true })
    .selectOption('openai:gpt-6-luna');
  await page.getByRole('combobox', { name: 'Thinking', exact: true }).selectOption('max');
  await expect(page.locator('.request-settings select')).toHaveCount(2);
  await page.getByRole('button', { name: 'Analyze another scope' }).click();
  await expect(page.locator('.request-settings select')).toHaveCount(2);
  await expect(page.getByRole('combobox', { name: 'Thinking', exact: true })).toHaveValue('max');
  await expect(page.locator('.analysis-setup select')).toHaveCount(0);
  await expect(page.locator('.passage-question select')).toHaveCount(0);
});

for (const width of [1280, 390]) {
  test(`processing remains visible until a real request settles at ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 844 });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await mockWorkspace(page, true, false);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    await page.route('**/api/reading/analyses', async (route) => {
      calls++;
      await gate;
      await route.fulfill({
        status: 503,
        json: {
          detail:
            "The selected model reached this request's output-token limit before completing the answer. Select fewer pages or choose a lower Thinking level if available, then retry. Your source and saved work are unchanged.",
        },
      });
    });
    await page
      .getByRole('combobox', { name: 'AI destination', exact: true })
      .selectOption('openai:test-model');
    await page.locator('.analysis-setup').getByRole('checkbox').check();
    await page.getByRole('button', { name: 'Create reading map', exact: true }).click();
    const processing = page.locator('.request-processing');
    await expect(processing).toContainText('Creating your reading map');
    await expect(processing).toHaveAttribute('role', 'status');
    const action = page.getByRole('button', { name: 'Creating reading map', exact: false });
    await expect(action).toBeDisabled();
    await expect(action).toHaveAttribute('aria-busy', 'true');
    expect(
      await processing
        .locator('.processing-ring')
        .evaluate((element) => getComputedStyle(element).animationName),
    ).toBe('none');
    expect(calls).toBe(1);
    await page.evaluate(async () => {
      (document.activeElement as HTMLElement | null)?.blur();
      window.scrollTo(0, 0);
      await document.fonts.ready;
    });
    await page.screenshot({ path: testInfo.outputPath(`processing-${width}.png`), fullPage: true });
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
    release();
    await expect(processing).toHaveCount(0);
    await expect(page.getByRole('alert')).toContainText('output-token limit');
    await expect(
      page.getByRole('button', { name: 'Create reading map', exact: true }),
    ).toBeEnabled();
    await expect(page.locator('.analysis-setup').getByRole('checkbox')).toBeChecked();
    expect(calls).toBe(1);
    expect((await new AxeBuilder({ page }).analyze()).violations).toEqual([]);
  });
}
