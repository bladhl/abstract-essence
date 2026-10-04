import { DOCUMENT, Service, inject, signal } from '@angular/core';

export type ReadingTheme = 'dark' | 'light';
export const themeStorageKey = 'abstract-essence:reading-theme';

@Service()
export class Theme {
  private readonly document = inject(DOCUMENT);
  private readonly preference = signal<ReadingTheme>(this.savedPreference());
  readonly current = this.preference.asReadonly();

  constructor() {
    this.apply(this.current());
  }

  toggle() {
    const next = this.current() === 'dark' ? 'light' : 'dark';
    this.preference.set(next);
    this.apply(next);
    try {
      this.document.defaultView?.localStorage.setItem(themeStorageKey, next);
    } catch {
      // Storage can be blocked. The choice still works for the current visit.
    }
  }

  private savedPreference(): ReadingTheme {
    try {
      return this.document.defaultView?.localStorage.getItem(themeStorageKey) === 'light'
        ? 'light'
        : 'dark';
    } catch {
      return 'dark';
    }
  }

  private apply(theme: ReadingTheme) {
    this.document.documentElement.dataset['theme'] = theme;
    this.document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', theme === 'dark' ? '#181d1a' : '#f7f8f4');
  }
}
