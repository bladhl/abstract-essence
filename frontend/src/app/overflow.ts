import { afterNextRender, DestroyRef, Directive, ElementRef, inject, signal } from '@angular/core';

/** Tracks whether the host's content is cut off by its own box, e.g. a block shrunk to fit. */
@Directive({
  selector: '[appOverflow]',
  exportAs: 'overflow',
  host: { '[class.overflowing]': 'overflowing()' },
})
export class Overflow {
  readonly overflowing = signal(false);

  constructor() {
    const host = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    // jsdom has no ResizeObserver; there nothing is ever reported as cut off.
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() =>
      this.overflowing.set(host.scrollHeight > host.clientHeight + 1),
    );
    afterNextRender(() => observer.observe(host));
    inject(DestroyRef).onDestroy(() => observer.disconnect());
  }
}
