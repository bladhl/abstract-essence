import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import type { AnnotationRole } from './models';

const paths = {
  book: 'M4 4h6a3 3 0 0 1 3 3v14a4 4 0 0 0-4-3H4V4Zm16 0h-4a3 3 0 0 0-3 3v14a4 4 0 0 1 4-3h3V4Z',
  note: 'M5 3h10l4 4v14H5V3Zm9 0v5h5M8 12h8M8 16h6',
  compare: 'M3 5h7v14H3V5Zm11 0h7v14h-7V5ZM6 9h1M6 13h1M17 9h1M17 13h1',
  link: 'm10 14 4-4M8 16l-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m2 2 1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0',
  search: 'M10.5 3a7.5 7.5 0 1 1 0 15 7.5 7.5 0 0 1 0-15Zm5.5 13 5 5',
  plus: 'M12 4v16M4 12h16',
  moon: 'M20 14a8 8 0 0 1-10-10 9 9 0 1 0 10 10Z',
  sun: 'M12 8a4 4 0 1 1 0 8 4 4 0 0 1 0-8ZM12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5',
  menu: 'M4 6h16M4 12h16M4 18h16',
  close: 'm5 5 14 14M19 5 5 19',
  file: 'M5 3h9l5 5v13H5V3Zm9 0v6h5M8 13h8M8 17h5',
  arrow: 'M4 12h15m-6-6 6 6-6 6',
  back: 'M20 12H5m6-6-6 6 6 6',
  upload: 'M12 16V3m-5 5 5-5 5 5M4 15v6h16v-6',
  export: 'M12 3v13m-5-5 5 5 5-5M4 16v5h16v-5',
  check: 'm5 12 4 4L19 6',
  panel: 'M4 5h16v14H4zM9 5v14',
  library: 'M5 4h4v16H5zM11 4h4v16h-4zM17 5l3-1 2 15-3 1z',
  quote: 'M7 7h4v4c0 3-2 5-4 6M15 7h4v4c0 3-2 5-4 6',
  chevron: 'm9 18 6-6-6-6',
  send: 'M5 12h14M13 6l6 6-6 6',
  pencil: 'M4 20h4L19 9l-4-4L4 16zM13 7l4 4',
  info: 'M12 3a9 9 0 1 0 0 18 9 9 0 1 0 0-18zM12 11v6M12 7.5v.01',
  lock: 'M6 11h12v9H6zM8 11V8a4 4 0 0 1 8 0v3',
  eye: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6 3 3 0 1 0 0-6z',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  download: 'M12 4v12M7 11l5 5 5-5M4 20h16',
  problem:
    'M12 3a9 9 0 1 0 0 18 9 9 0 1 0 0-18zM9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14M12 17v.01',
  contribution:
    'M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.3.3.5.7.5 1.1V16h6v-1c0-.4.2-.8.5-1.1A6 6 0 0 0 12 3z',
  approach: 'M12 3a9 9 0 1 0 0 18 9 9 0 1 0 0-18zM15.5 8.5l-2 5-5 2 2-5z',
  evidence: 'M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.7 3h10.6a2 2 0 0 0 1.7-3l-5-9V3M7.5 15h9',
  limits: 'M12 4l9 16H3zM12 10v4M12 17v.01',
  spark:
    'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z',
  thinking:
    'M9 4a3 3 0 0 0-3 3 3 3 0 0 0-2 5 3 3 0 0 0 2 5 3 3 0 0 0 6 1V5a2 2 0 0 0-3-1zM15 4a3 3 0 0 1 3 3 3 3 0 0 1 2 5 3 3 0 0 1-2 5 3 3 0 0 1-6 1',
} as const;

export type IconName = keyof typeof paths;

/** Every role gets a glyph so meaning never depends on color alone (WCAG 1.4.1). */
export const roleIcons: Record<AnnotationRole, IconName> = {
  problem: 'problem',
  contribution: 'contribution',
  approach: 'approach',
  evidence: 'evidence',
  limits: 'limits',
  method: 'approach',
  argument: 'contribution',
};

@Component({
  selector: 'app-icon',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'ui-icon', 'aria-hidden': 'true' },
  template: `<svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.75"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
    focusable="false"
  >
    <path [attr.d]="paths[name()]" />
  </svg>`,
})
export class UiIcon {
  readonly name = input.required<IconName>();
  readonly paths = paths;
}
