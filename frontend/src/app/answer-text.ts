import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { answerParagraphs, passageCitation } from './answer-parts';
import type { Citation, SourcePage } from './models';
import { UiIcon } from './ui-icon';

let nextId = 0;

/** A source reference chip: "p. 2" opens the citation in the source, the eye previews it. */
@Component({
  selector: 'app-source-ref',
  imports: [UiIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="answer-ref"
      ><button
        class="ref-link"
        [attr.aria-label]="'View citation on PDF page ' + citation().page"
        (click)="view.emit(citation())"
      >
        p. {{ citation().page }}</button
      ><button
        class="ref-peek"
        [attr.popovertarget]="id"
        [style.anchor-name]="'--' + id"
        [attr.aria-label]="'Preview citation from PDF page ' + citation().page"
      >
        <app-icon name="eye" /></button
    ></span>
    <span
      #preview
      popover
      class="popover-panel ref-popover"
      role="group"
      [id]="id"
      [style.position-anchor]="'--' + id"
      [attr.aria-label]="'Citation from PDF page ' + citation().page"
    >
      <span class="content-label"><app-icon name="quote" />PDF page {{ citation().page }}</span>
      <span class="ref-quote" [textContent]="citation().quote"></span>
      <button class="quiet link-button" (click)="view.emit(citation()); preview.hidePopover()">
        View in the source <app-icon name="arrow" />
      </button>
    </span>
  `,
})
export class SourceRef {
  readonly citation = input.required<Citation>();
  readonly view = output<Citation>();
  protected readonly id = `source-ref-${nextId++}`;
}

/**
 * Renders an AI answer as paragraphs with **bold** text and source references. Text is bound as
 * text content, never as HTML, so model output cannot inject markup.
 */
@Component({
  selector: 'app-answer-text',
  imports: [SourceRef],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @for (paragraph of paragraphs(); track $index) {
      <p class="answer-paragraph">
        @for (part of paragraph; track $index) {
          @if (part.citation; as citation) {
            <app-source-ref [citation]="citation" (view)="view.emit($event)" />
          } @else if (part.strong) {
            <strong [textContent]="part.text"></strong>
          } @else {
            <span [textContent]="part.text"></span>
          }
        }
      </p>
    }
    @if (uncited().length) {
      <p class="answer-paragraph also-cited">
        <span class="muted">Also cited</span>
        @for (citation of uncited(); track $index) {
          <app-source-ref [citation]="citation" (view)="view.emit($event)" />
        }
      </p>
    }
  `,
})
export class AnswerText {
  readonly text = input.required<string>();
  readonly pages = input.required<SourcePage[]>();
  /** The answer's saved citations; those the prose never references are listed at the end. */
  readonly citations = input<Citation[]>([]);
  readonly view = output<Citation>();
  protected readonly paragraphs = computed(() => {
    const pages = this.pages();
    return answerParagraphs(this.text()).map((paragraph) =>
      paragraph.map((part) => {
        if (!('ref' in part)) return { ...part, citation: null };
        // An unresolvable reference stays visible as written instead of becoming a dead link.
        const citation = passageCitation(pages, part.ref);
        return { text: citation ? '' : `[${part.ref}]`, strong: false, citation };
      }),
    );
  });
  protected readonly uncited = computed(() => {
    const inline = this.paragraphs()
      .flat()
      .flatMap((part) => (part.citation ? [part.citation] : []));
    return this.citations().filter(
      (citation) =>
        !inline.some((ref) => ref.page === citation.page && ref.quote === citation.quote),
    );
  });
}
