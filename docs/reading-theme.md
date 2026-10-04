# Reading themes: dark by default, adjustable by the reader

The workspace starts with charcoal surfaces, warm off-white text and restrained sage accents. Use the **Dark theme** toggle button in the top bar to change theme (pressed means dark, unpressed means light). Your explicit choice is saved in this browser; the operating system preference does not override the requested dark default. If storage is blocked, changing theme still works for the current visit.

## Why this scheme

No color palette guarantees fatigue-free reading. The following evidence informs the design, rather than proving these exact hex values are medically optimal:

- **Accessibility requirements:** [W3C contrast minimum](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html) requires at least 4.5:1 for ordinary text and 3:1 for large text. [Non-text contrast](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html) requires 3:1 where visual control boundaries or state indicators are necessary. [Visible keyboard focus](https://www.w3.org/WAI/WCAG22/Understanding/focus-visible.html) must remain identifiable. Low-contrast structural dividers are not substituted for needed control boundaries.
- **Design guidance:** Google's [dark-theme codelab](https://codelabs.developers.google.com/codelabs/design-material-darktheme) and [Google Design examples](https://design.google/library/material-design-dark-theme) favor dark gray, less saturated accents and dimmed text over pure black, neon colors and pure white. This is first-party design guidance, not a clinical finding. We retain the existing green identity and adapt the colors rather than invert the interface.
- **Why retain light:** [Piepenbrock, Mayr and Buchner (2014)](https://pubmed.ncbi.nlm.nih.gov/25135324/) found better proofreading performance and smaller pupils with dark text on a light background under the tested conditions. That result does not establish a universally best theme for hours of reading, eye health or every reader. It does argue against forcing dark mode on everybody.

Source text targets at least 7:1, taking the [W3C enhanced contrast criterion](https://www.w3.org/WAI/WCAG22/Understanding/contrast-enhanced.html) as a stronger design target, not a claim that the entire product conforms to AAA. The reader retains its 1.9 line height, no justified text and a maximum 70ch measure, informed by [W3C visual presentation](https://www.w3.org/WAI/WCAG22/Understanding/visual-presentation.html). The measure is a CSS approximation, not a promise of exactly 70 characters per line.

## Palette and contrast

Exact values are product choices. Ratios below use the W3C sRGB relative-luminance formula; contrast alone does not measure comfort.

| Role                | Dark                          | Light                         | Measured contrast                                                                |
| ------------------- | ----------------------------- | ----------------------------- | -------------------------------------------------------------------------------- |
| Page background     | `#181d1a`                     | `#f7f8f4`                     | Not a text pair                                                                  |
| Reading surface     | `#202622`                     | `#fffefa`                     | Not a text pair                                                                  |
| Main text           | `#e6e8df`                     | `#283b35`                     | 12.46:1 / 11.78:1 on reading surface                                             |
| Source text         | `#e0e3d9`                     | `#394c40`                     | 11.87:1 / 9.12:1 on reading surface                                              |
| Secondary text      | `#b1bbb0`                     | `#55665d`                     | At least 5.36:1 / 5.04:1 on main neutral surfaces                                |
| Primary action      | `#afc8ae` with `#1b2c1f` text | `#245b49` with `#fffefa` text | 8.20:1 / 7.80:1                                                                  |
| Input/button border | `#809178`                     | `#7a8875`                     | At least 3.15:1 / 3.10:1 across adjacent input, scope, button and hover surfaces |

Highlights, text selection, error and notice text, placeholders, hover states and focus indicators have their own paired tokens. Meaning is also carried by wording, source links, state attributes and boundaries, not color alone. Native selects, checkboxes and scrollbars receive the matching CSS `color-scheme`.

## Implementation and verification

- `frontend/src/styles.css` owns semantic palette tokens; component rules consume tokens, not theme-specific color overrides.
- `frontend/src/index.html` applies a validated saved choice before Angular loads and supplies a small matching background/color-scheme fallback. Keep its background values and storage key synchronized with the theme service and tokens. A future strict Content Security Policy must explicitly permit this bootstrap script/style, or move them to allowed blocking assets.
- `frontend/src/app/theme.ts` owns the Angular signal, DOM theme attribute and safe persistence. Stored values other than `light` fall back to dark; no theme preference is sent to the API.
- Unit tests cover preference validation, toggling and unavailable storage. Browser tests cover pre-Angular colors, keyboard operation, persistence, contrast pairs, source highlights, form errors, notices, desktop/mobile accessibility and 200% text resizing. Automated checks are not a full accessibility audit and do not establish medical benefit.

Choose the mode that is more readable in your environment and adjust your display brightness to suit it. Neither mode should be described as eye protection.
