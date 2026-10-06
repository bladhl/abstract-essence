# Document-first annotated reading

## The interaction

1. Import saves extracted source text locally; it never calls an AI provider.
2. Review the exact destination, thinking level and page scope, grant consent and create a reading map. There is no prerequisite learner attempt.
3. The saved result opens automatically: the source with highlighted passages and role filters, and the selected passage's explanation. **About this reading** holds the scoped overview, coverage, gaps and the four critical lenses.
4. Select a keyboard-accessible highlighted passage to see the assistant's explanation of its argumentative function, a caveat and the author's exact words.
5. Ask a contextual question in the **Ask AI** tab after agreeing to data sharing, or make a source-linked correction, application or explanation in your own words.

A contribution may be descriptive, theoretical, critical or empirical. A paper is not forced into a problem–successful-solution template. An absent role in a selected section is a coverage gap, not proof that the full paper lacks it.

## Source contract

`mode=guided` requires an empty attempt. Default `mode=reflection` retains legacy attempt validation. Both use the application-owned `ReadingAI` boundary and the same configured provider allowlist, limits and rate limiter. No automatic provider fallback or production fake response exists.

A guided output keeps the four critical insights for comparison and adds `reading_map` with `version=annotated-reading-v1`. Its five roles must each have a cited annotation or an explicit gap, never both. Eight annotations maximum keeps the output bounded within the existing token budget. Every new citation is verified against the exact selected page text before any answer is persisted. This verifies textual presence, not scientific quality or logical entailment.

### Model references, server-owned quotations

`source_catalog.py` partitions the selected stored text into deterministic, non-overlapping passages of at most 700 characters, preferring a newline or space boundary in the latter half of a span. Concatenating a page's passages reconstructs that page exactly. All source text is supplied once in the catalogue, including short or whitespace-only context; spans with fewer than eight normalized characters cannot be cited. This is not OCR, a sentence parser, fuzzy matching or a silent reduction in coverage.

The model-only citation schema is `SourceReference(passage_id=...)`. Shared generic output models retain the same four-lens, role-coverage, field-size and annotation-count constraints. The model does not supply citation wording or a page number. The server resolves each selected identifier against the current request's catalogue, constructs a literal `Citation(page, quote)` and runs the original final source verifier. Unknown identifiers, references outside the selected scope and non-citable spans are rejected. The existing single correction attempt is shared with format validation; it does not create an additional retry budget.

The model therefore cannot translate, repair PDF typography, paraphrase a quote or confuse printed article numbering with the physical page in a new citation. It can still select an available passage that does not logically support its explanation: source presence is not semantic or scientific validation. Internally selected identifiers are not exposed in saved outputs or exports. The public `ReadingAI` result and API citation format remain unchanged, and legacy literal citations remain readable.

The JSON extension needs no database migration. Older outputs render only their original cited four lenses; no new contribution or limits claim is fabricated. Exports retain old and new outputs unchanged.

Question context is a separate typed role/citation object, checked against the saved analysis scope before rate limiting or provider use. The user's question remains separate and is never silently shortened. Saved `Feedback.output.request_context` is request provenance, not assistant-generated evidence.

## Rendering and consent boundaries

The app displays extracted source text, not the original PDF. Physical page numbers and extraction limitations remain visible. Python-compatible whitespace matching computes original source offsets locally; the model does not supply positions. Range sweep events preserve overlapping annotation IDs, including overlapping occurrences of the same quote. A maximum of 30 visible occurrences per excerpt protects browser responsiveness and is disclosed when exceeded. Full source text stays intact.

Analysis consent belongs to document/destination/thinking/draft scope; question consent belongs separately to document/destination/thinking/saved reading. Changing thinking or opening a different reading revokes consent. Imported documents fitting 20 pages and 60,000 characters default to full scope; longer ones show a bounded section and explicit partial coverage. There is no automatic whole-thesis batching, model discovery, OCR or background provider charge.

Document-switch races do not open stale analyses or erase another document's note draft. Interactive highlight labels include their role/title; color is supplementary. The dark-default and retained light theme use the same source/inspector flow.

## Thinking and provider failures

`thinking=default` omits the provider setting. Explicit `low`, `medium` and `high` are offered for documented Google profile levels; Gemini 3.8 Flash accepts all three, not `minimal`. GPT-6 Luna additionally exposes its documented `xhigh` and `max` levels through the OpenAI Responses API. Unverified destinations remain default-only. Unsupported selections fail with 422 before rate limiting or sending source text. The same selection applies to guided readings, reflection analysis and contextual questions; changing it does not rewrite earlier results.

New analysis and feedback outputs keep server-owned `request_settings.thinking` in their existing JSON field, without a database migration. Older records lacking this metadata display “Not recorded,” never an invented default. Provider default is a request choice, not a recorded measurement of actual reasoning effort. Thinking may increase latency and charges and does not guarantee a correct interpretation. See Google's [model documentation](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash).

Google transport attempts are explicitly pinned to one per agent request. The existing one structured-validation retry and two-agent-request limit remain; there is no new availability retry or alternate-provider fallback. Installed SDK behavior with `retry_options=None` already makes one attempt, while an empty retry-options object has a different default. The explicit policy prevents ambiguity, not a proven upstream 503 cause.

Provider failures display their upstream HTTP status separately from the app's local status. Safe terminal generation diagnostics additionally identify output limits, refusal, incomplete answers, format failure, usage budgets and provider connections through whitelisted exception/finish metadata. Logs never include request text, exception bodies, headers or keys. A successful tiny prompt does not establish that a complete structured reading will succeed; an upstream 5xx alone does not prove a local bug or global outage.

## Verification boundaries

Deterministic tests use `FunctionModel` or API fixtures, not paid providers. Source-reference regressions exercise a six-page, 17,488-character Spanish fixture through the analysis API and export, exact reconstruction at the 60,000-character scope limit, PDF artifacts, multilingual text, unknown/out-of-scope references, non-citable context, field forgery and the shared correction budget. Actual installed Google/OpenAI SDK wire tests return model references and expect server-built public quotations. Existing final-verifier tests still reject unsupported literal outputs from a custom `ReadingAI`. Gaps, legacy output, overlap/repetition, scope/consent, contextual questions, note actions and browser accessibility remain covered. Live provider compatibility and interpretation quality require a separately authorized real-provider evaluation; a passing mock is not evidence of real scientific reasoning quality.
