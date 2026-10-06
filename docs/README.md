# Abstract Essence: learn through critical reading

A local research-learning workspace for papers and theses. Import a PDF, approve a bounded AI reading, then explore the argument through source-linked annotations. Reflect, challenge and apply what you learn afterward. Published work and AI output are both open to criticism.

## Run locally

Requirements: Python 3.14, uv, Node.js 24.15 or newer in the 24.x line, pnpm, Docker Compose.

```sh
# Repository root: isolated services, loopback ports only
docker compose up -d --wait
cd backend
[ -f .env ] || cp .env.example .env
uv sync --locked
uv run alembic upgrade head
uv run fastapi dev --host 127.0.0.1 --port 8001
```

In another terminal:

```sh
cd frontend
pnpm install --frozen-lockfile
pnpm start
```

Open <http://127.0.0.1:4201>. Import a text-based PDF. Reading and source-linked notes work without AI credentials. PostgreSQL uses port 5547 and Redis 6381 to avoid common local port conflicts.

**Local, single workspace only.** There is no authentication, tenant isolation or public deployment hardening. Keep the API bound to loopback. Origin and request-header checks are browser boundaries, not user authorization. Development database credentials are not production secrets.

## Configure AI explicitly

Edit `backend/.env` and restart the API. Set a provider key and a JSON list of exact model IDs enabled by your provider account:

```dotenv
ESSENCE_OPENAI_API_KEY=your-private-key
ESSENCE_OPENAI_MODELS=["your-enabled-model-id"]
```

For Google, an example exact model ID is:

```dotenv
ESSENCE_GOOGLE_API_KEY="your-private-key"
ESSENCE_GOOGLE_MODELS=["gemini-3.8-flash"]
```

Verify account access and current capability/pricing in [Google's model documentation](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash). The app does not discover models, choose a "best" model, or replace your allowlist. Equivalent settings exist for `ANTHROPIC`. There is no default provider or model, automatic cross-provider fallback, or production mock AI. Model capability, availability, price and retention policy remain provider-specific. Choose the destination in the UI and consent before sending anything. A sole configured destination is preselected, but this never grants consent. Changing the document, destination or analysis scope revokes analysis consent. Questions have separate consent tied to the saved reading and its actual scope, given under **Data sharing** in the question's request settings; asking stays disabled until then. A new map draft cannot authorize questions on an older reading.

Keys stay in the backend; never place them in frontend source or commit `.env`. Pydantic AI is behind the application-owned `ReadingAI` interface, so domain workflows do not depend directly on vendor SDKs. Adding a fourth provider requires extending configuration, the provider contract and its adapter; it is not an arbitrary URL passthrough.

For [GPT-6 Luna](https://developers.openai.com/api/docs/models/gpt-6-luna), set `ESSENCE_OPENAI_MODELS=["gpt-6-luna"]`, restart the backend, and select **OpenAI · gpt-6-luna** and **Thinking: Max** in the request settings. Analysis uses the **Analyze another scope** dialog; questions use the settings button beside the question. Both edit the same selection, so there is no second selector. The app uses the Responses API and sends `reasoning.effort="max"`; the documented Low, Medium, High and Extra high levels are also available. Provider default does not select Max. Higher reasoning can increase latency and token use; existing request time and token limits still apply. Changing the destination or thinking level revokes sending consent. The selected level is recorded with each new reading or answer; unverified OpenAI models expose only Provider default.

Provider failures are not all invalid AI answers. The app distinguishes upstream quota/rate limits (429), credential/access rejection (401/403), and temporary provider unavailability (500/502/503/504) using safe status metadata. It never displays provider response bodies, keys or submitted source text. Existing work is unchanged and no alternate provider is silently contacted. Model metadata access alone does not prove a generation request will succeed.

Generation failures also distinguish a model's output-token limit, refusal, incomplete answer, exhausted format correction, the app's usage budget and a provider connection failure. The server's safe diagnostic log records the operation, provider, thinking level, category, exception type and normalized finish reason; it does not log exceptions, response bodies or source quotations. An older generic failure cannot be diagnosed retrospectively when those details were not recorded.

An output limit is not necessarily an API outage. [Reasoning tokens count toward the output budget](https://developers.openai.com/api/docs/guides/reasoning), including when they are not visible in the answer. If that specific error appears, choose fewer pages or a lower available Thinking level and explicitly retry. The app retains its existing 6,000-output-token, 30,000-total-token and two-model-request limits; it does not silently increase them or downgrade a selected level. A complete, validated answer is not rejected solely because its response carries a length finish reason.

## What works

- PDF text extraction in the browser, with physical page numbers. Extracted text is stored in PostgreSQL; the original PDF file is not stored.
- Four critical-reading lenses: problem/significance, question/method, evidence/conclusions and argument structure.
- Document-first annotated reading: a scoped overview and up to eight source-linked annotations across problem, contribution, approach, evidence and limits, with explicit gaps when the selected pages do not support a role. Contributions are not assumed to be universal "solutions".
- Multiple labeled highlights, role filters, click/keyboard passage explanations and contextual questions. Author's words, assistant interpretations and your own thinking stay separate.
- Optional reflection, correction and application after the explanation, rather than a mandatory learner form before analysis. Existing four-lens readings and their original attempts remain accessible and comparable.
- Source-linked notes, corrections and application to your own research.
- Structured comparison of saved AI readings and manually justified document connections. Connections are not automatically discovered or independently verified citations.
- JSON export and document deletion with dependent records removed. Export is a readable archive, not an implemented restore format. Deletion cannot remove data retained by an AI provider.
- Dark reading theme by default, with an accessible toggle for light or dark and browser-local preference. [Palette, evidence and contrast targets](reading-theme.md).

In a saved reading, the document bar's reading picker switches between saved readings, and **About this reading** opens the overview, coverage, model, gaps and the four critical lenses. Role filters sit above the extracted text. The right panel has two tabs: **Explanation** shows the selected passage's interpretation, caveat and the author's words, shrinking long text to fit before offering **Show more**; **Ask AI** holds the question form and answers, grouped by the passage they were asked about. Answers show cited passages as chips that open the citation in the source or preview it. On mobile, **Read source** and **Understand passage** switch between the source and explanation; selecting a marked passage opens and focuses its explanation. **Extracted text** remains visible in pagination, and the library menu exposes document search and the other workspace views.

Analysis and questions show a compact processing ring and an operation-specific status while their actual request is pending. The action is disabled against duplicate submissions, the indicator stops on success or failure, and a failed question remains editable. Changing documents or readings identifies an older in-flight request instead of pretending the new source is being processed. Loading saved answers has its own status. Reduced-motion mode keeps the status text without rotating the indicator; there are no simulated percentages or stage estimates.

## Boundaries that matter

A source-matched quotation proves **textual presence**, not scientific validity or whether an interpretation follows logically. The API rejects the entire generated answer before saving when any excerpt is absent from the specified page, including annotated map excerpts. A question's separate role/quote context is verified before a provider call and retained as request metadata, not as an AI claim. Missing evidence is shown explicitly. Documents and learner text are treated as untrusted data; the tutor has no tools, browsing or file execution.

For new AI requests, the server partitions all selected stored page text into exact, non-overlapping passages of at most 700 characters. The source catalogue replaces the plain page payload; it does not omit or duplicate source text. The model selects a supplied `passage_id`, rather than writing quotation text or page numbers. The server resolves that selection into the original passage and physical page, preserving its language, spelling, punctuation and PDF extraction artifacts. References are internal: API responses, saved readings and exports still contain the existing `page` / `quote` citation format, and older records are not rewritten.

Unknown or non-citable passage references are returned to the same model for correction within the existing one-retry, two-model-request limit; this can use a second billable request. If correction fails, nothing is saved. Server-built citations still pass the final exact-source check after whitespace normalization. This prevents translated or invented quotation wording from entering new answers, but it does not prove that a selected passage supports the assistant's interpretation. **Full extracted-text coverage** means the selected extracted pages were supplied in full, not that every interpretation is correct.

Annotations are deterministic ranges in extracted text, not graphical overlays on the original PDF. Whitespace normalization matches the backend. Overlaps retain all linked roles; repeated excerpts are marked without inventing a unique occurrence. To prevent a degenerate page from creating thousands of interactive buttons, only the first 30 occurrences per repeated excerpt are marked, with an explicit notice; no source text is removed. [Annotated reading design and boundaries](annotated-reading.md).

PDF limits: 30 MB, 1,500 pages, 60,000 extracted characters per page and 3 million per document. Import fails rather than silently truncating. No OCR; scanned PDFs, formulas, tables and complex layout may require checking the original. Encrypted or damaged files may fail.

An AI request covers at most 20 selected pages and 60,000 characters. Short documents fitting both limits default to full extracted-text coverage; longer documents start with an explicitly disclosed contiguous bounded section. Partial coverage is disclosed on map and question screens; no automatic batching or background charges occur. Calls have time, output-token, request and concurrency limits; Redis enforces 8 workspace requests/minute and fails closed if unavailable. This limits accidental usage, not a hard monetary budget. API input bodies are capped at 12 MB. The library is limited to 200 documents.

## Architecture

| Location                        | Responsibility                                                                   |
| ------------------------------- | -------------------------------------------------------------------------------- |
| `frontend/src/app`              | Angular 22 standalone, OnPush, signals, Signal Forms, lazy workspace             |
| `backend/src/essence/documents` | Import, source persistence, export and deletion                                  |
| `backend/src/essence/reading`   | Typed AI contract, provider adapters, excerpt verification and reading workflows |
| `backend/src/essence/learning`  | User notes and explicit connections                                              |
| `backend/src/essence/infra`     | SQLModel persistence and Redis rate limit                                        |
| `backend/migrations`            | Alembic schema migrations, not startup `create_all`                              |

This is a modular monolith, not microservices. Synchronous database work runs outside the event loop, and transactions do not remain open during provider calls. PostgreSQL is the source of truth; Redis is not the document store. A single process currently bounds AI concurrency; multi-process/public operation needs shared concurrency, authentication and ownership design first.

The built Angular SPA can also be served by FastAPI: run `pnpm build` in `frontend`, then restart the backend and open port 8001. `/api/health` is a process-health endpoint, not a PostgreSQL/Redis readiness check.

## Verify

```sh
cd backend
uv run pytest
uv run ruff check .
uv run ruff format --check .
uv run ty check
cd ../frontend
pnpm test
pnpm build
pnpm exec playwright install chromium
pnpm test:e2e
```

Backend tests prohibit real model requests. They test provider construction, structured output through `FunctionModel`, source verification, API persistence using isolated SQLite and failure boundaries. PostgreSQL migrations and real-service smoke checks must also be exercised when changing persistence. Browser tests mock only test API responses, cover separate analysis/question consent, annotated passage navigation, overlap/repetition, contextual challenges, optional learning notes, legacy comparison, manual connections, both themes, mobile layout and axe accessibility. No test proves real provider quality or paid live-provider compatibility.

Stop local services with `docker compose stop`. Named volumes retain research data; do not use `down -v` unless deliberately deleting it.

## First-party references

- [Angular versions](https://angular.dev/reference/versions)
- [FastAPI](https://fastapi.tiangolo.com/), [SQLModel](https://sqlmodel.tiangolo.com/)
- [Pydantic AI models](https://pydantic.dev/docs/ai/models/overview/), [testing](https://pydantic.dev/docs/ai/guides/testing/)
- [uv](https://docs.astral.sh/uv/), [Ruff](https://docs.astral.sh/ruff/)
- [PostgreSQL](https://www.postgresql.org/docs/), [Redis Python](https://redis.io/docs/latest/develop/clients/redis-py/)

The original excluded SSR scaffold remains under `frontend/src/*server*` and `frontend/src/app/*.server.ts` to preserve existing files. It is not used or supported; FastAPI is the backend. To use a preinstalled Chromium for tests, set `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/path/to/chromium`.
