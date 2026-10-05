# Reading theme: neutral dark, WCAG 2.2 AAA

The workspace starts dark: neutral gray planes, a light-gray primary action and a pale blue focus ring. Use **Dark theme** in the top bar (icon button; pressed means dark, unpressed means light). An explicit choice is saved under `abstract-essence:reading-theme` in this browser and restored before Angular loads. Only `light` selects the light theme; missing, invalid or inaccessible storage falls back to dark. The operating system preference does not override this default. If storage is blocked, the toggle still works for the current visit. No theme preference is sent to the API.

**The light theme is unchanged legacy, pending its own redesign.** Everything below describes the dark theme. Light keeps its earlier values and AA thresholds.

## Readable by design, not a medical claim

No palette guarantees fatigue-free reading or eye protection. Dark is the product's initial preference, not a scientifically universal optimum. [Piepenbrock, Mayr and Buchner (2014)](https://pubmed.ncbi.nlm.nih.gov/25135324/) reported better proofreading performance and smaller pupils with dark text on a light background under the tested conditions; this does not establish one best theme for every reader or hours of reading. Keep light available and choose the theme and display brightness that suit your environment.

The dark theme targets [enhanced contrast](https://www.w3.org/WAI/WCAG22/Understanding/contrast-enhanced.html) (7:1) for all text, [non-text contrast](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html) (3:1) for control borders and focus, and [target size](https://www.w3.org/WAI/WCAG22/Understanding/target-size-enhanced.html) of at least 44×44 CSS px for pointer targets (inline links inside sentences and marked passages in running text are exempt). These are scoped automated checks, not a whole-product AAA claim or a full accessibility audit.

## Typography and the source sheet

- Source Sans 3, self-hosted at `frontend/public/fonts/source-sans-3.ttf`, preloaded in `index.html`, `font-display: swap`; no runtime Google Fonts request. Its license is the SIL Open Font License 1.1 (`OFL.txt`).
- UI text is 14–15px with line height 1.5. Source text is 18px (17px at 720px and below), line height 1.8, no justification, maximum 72ch.
- Source text sits on a sheet: `--surface`, 1px `rgba(255,255,255,0.06)` border, 6px radius and a subtle shadow, on the darker `--background` plane. Padding is 40px 48px on desktop and 16px on mobile.

## Dark palette

`frontend/src/styles.css` defines these semantic custom properties; components consume the active values. All values are opaque on purpose so contrast tests can read computed colors.

| CSS role                                                    | Dark                              |
| ----------------------------------------------------------- | --------------------------------- |
| `--background`, `--header`                                  | `#1a1a1a`                         |
| `--sidebar`                                                 | `#171717`                         |
| `--surface`                                                 | `#212121`                         |
| `--surface-subtle`                                          | `#2a2a2a`                         |
| `--surface-hover`                                           | `#2f2f2f`                         |
| `--text` / `--reading-text`                                 | `#ececec` / `#e3e3e3`             |
| `--muted`                                                   | `#bebebe`                         |
| `--accent` / `--on-accent`                                  | `#ececec` / `#171717`             |
| `--accent-hover`                                            | `#ffffff`                         |
| `--accent-text`                                             | `#b8d0ff`                         |
| `--focus`                                                   | `#c3d7ff`                         |
| `--border` (structural)                                     | `#2e2e2e`                         |
| `--control-border` (interactive)                            | `#7a7a7a`                         |
| `--field-background` / `--placeholder`                      | `#1a1a1a` / `#bebebe`             |
| `--highlight-background` / `--highlight-text`               | `#454d5b` / `#ffffff`             |
| `--selection-background` / `--selection-text`               | `#c3d7ff` / `#171717`             |
| `--error-background` / `--error-text` / `--error-border`    | `#363031` / `#f0b5c1` / `#f0b5c1` |
| `--notice-background` / `--notice-text` / `--notice-border` | `#36332a` / `#f2d57e` / `#f2d57e` |

`--control-border` is `#7a7a7a` rather than a darker gray so it keeps at least 3:1 on every dark plane, including `--surface-hover` (3.1:1). Disabled controls use muted text and a structural border instead of opacity, so text is never dimmed.

### Labeled annotation roles

Every role has a name, an icon and a color; color is never the only signal. Marked passages carry a small role icon before the text and have no underline. Unselected marks use a subtle tint with `--annotation-text` (`#e3e3e3`); the selected passage uses the selected tint with `#ffffff`.

| Role         | Label / icon color | Unselected mark | Selected mark | Chip      | Icon           |
| ------------ | ------------------ | --------------- | ------------- | --------- | -------------- |
| Problem      | `#f2d57e`          | `#3a372c`       | `#575039`     | `#383428` | help-circle    |
| Contribution | `#a0dcc8`          | `#303735`       | `#42524c`     | `#2d3532` | lightbulb      |
| Approach     | `#aacbff`          | `#31353c`       | `#454d5b`     | `#2e333a` | compass        |
| Evidence     | `#d4bbff`          | `#36333c`       | `#50495b`     | `#34313a` | flask          |
| Limits       | `#f0b5c1`          | `#3a3334`       | `#57474b`     | `#383031` | alert-triangle |

Legacy method and argument links reuse the approach and contribution styling while keeping their original labels. A source-matched excerpt establishes textual presence, not scientific validity.

## Interaction and verification

- Keyboard focus is a 3px `--focus` outline with a 3px offset. Citation marks also have a 1px dashed outline. Native controls and scrollbars receive the active `color-scheme`.
- `prefers-reduced-motion: reduce` disables control transitions and the selected-passage animation.
- `frontend/src/index.html` applies the saved preference and matching background before the app loads; `frontend/src/app/theme.ts` maintains the signal, root theme attribute, theme-color metadata and safe persistence. A future strict Content Security Policy must permit the bootstrap script/style or move them to allowed blocking assets.
- `frontend/e2e/workspace.spec.ts` asserts, in the dark theme, text pairs and source/role/selected/chip pairs at 7:1 or more, control borders and focus at 3:1 or more, and a set of key interactive targets at 44×44 or more. It also covers theme restoration, keyboard focus, axe, mobile layout and 200% text resizing. Light keeps its earlier thresholds.
