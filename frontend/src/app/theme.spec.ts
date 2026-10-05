import { DOCUMENT } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Theme, themeStorageKey } from './theme';

describe('Theme', () => {
  let root: HTMLElement;
  let getItem: ReturnType<typeof vi.fn>;
  let setItem: ReturnType<typeof vi.fn>;
  let meta: HTMLElement;

  beforeEach(() => {
    root = document.createElement('html');
    meta = document.createElement('meta');
    getItem = vi.fn().mockReturnValue(null);
    setItem = vi.fn();
    TestBed.configureTestingModule({
      providers: [
        {
          provide: DOCUMENT,
          useValue: {
            documentElement: root,
            defaultView: { localStorage: { getItem, setItem } },
            querySelector: () => meta,
          },
        },
      ],
    });
  });

  it('defaults to dark without an explicit preference', () => {
    const theme = TestBed.inject(Theme);
    expect(theme.current()).toBe('dark');
    expect(root.dataset['theme']).toBe('dark');
    expect(meta.getAttribute('content')).toBe('#1a1a1a');
    expect(getItem).toHaveBeenCalledWith(themeStorageKey);
    expect(setItem).not.toHaveBeenCalled();
  });

  it('restores an explicit light preference', () => {
    getItem.mockReturnValue('light');
    const theme = TestBed.inject(Theme);
    expect(theme.current()).toBe('light');
    expect(root.dataset['theme']).toBe('light');
    expect(meta.getAttribute('content')).toBe('#f2f5fa');
  });

  it('ignores invalid stored values', () => {
    getItem.mockReturnValue('system');
    expect(TestBed.inject(Theme).current()).toBe('dark');
  });

  it('retains a usable default when storage cannot be read', () => {
    getItem.mockImplementation(() => {
      throw new DOMException('Blocked', 'SecurityError');
    });
    expect(TestBed.inject(Theme).current()).toBe('dark');
    expect(root.dataset['theme']).toBe('dark');
  });

  it('persists each explicit toggle and updates the document', () => {
    const theme = TestBed.inject(Theme);
    theme.toggle();
    expect(theme.current()).toBe('light');
    expect(root.dataset['theme']).toBe('light');
    expect(setItem).toHaveBeenLastCalledWith(themeStorageKey, 'light');
    theme.toggle();
    expect(theme.current()).toBe('dark');
    expect(root.dataset['theme']).toBe('dark');
    expect(setItem).toHaveBeenLastCalledWith(themeStorageKey, 'dark');
  });

  it('keeps toggling usable when storage writes are blocked', () => {
    setItem.mockImplementation(() => {
      throw new DOMException('Full', 'QuotaExceededError');
    });
    const theme = TestBed.inject(Theme);
    expect(() => theme.toggle()).not.toThrow();
    expect(theme.current()).toBe('light');
    expect(root.dataset['theme']).toBe('light');
  });
});
