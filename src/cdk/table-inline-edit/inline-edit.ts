/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import {AfterViewInit, Directive, ElementRef, EmbeddedViewRef, Injectable, Input, OnDestroy, NgZone, TemplateRef, ViewContainerRef} from '@angular/core';
/*import {DOCUMENT} from '@angular/common';*/
import {FocusTrap, FocusTrapFactory} from '@angular/cdk/a11y';
import {Overlay, OverlayRef} from '@angular/cdk/overlay';
import {TemplatePortal} from '@angular/cdk/portal';
import {fromEvent, timer, ReplaySubject, Subject} from 'rxjs';
import {audit, debounceTime, distinctUntilChanged, filter, map, mapTo, takeUntil} from 'rxjs/operators';

const HOVER_DELAY_MS = 30;

@Injectable()
export class InlineEditEvents {
  readonly editing = new Subject<Element|null>();
  readonly hovering = new Subject<Element|null>();
  readonly mouseMove = new Subject<Element|null>();

  protected currentlyEditing: Element|null = null;
  
  constructor() {
    this.editing.subscribe(cell => {
      this.currentlyEditing = cell;
    });
  }

  editingCell(element: Element|EventTarget) {
    let cell: Element|null = null;

    return this.editing.pipe(
        map(editCell => editCell === (cell || (cell = closest(element, 'cdk-cell')))),
        distinctUntilChanged(),
        );
  }

  doneEditingCell(element: Element|EventTarget) {
    const cell = closest(element, 'cdk-cell');
    
    if (this.currentlyEditing === cell) {
      this.editing.next(null);
    }
  }

  hoveringOnRow(element: Element|EventTarget) {
    let row: Element|null = null;
    
    // super important that this is outside of zone
    return this.hovering.pipe(
        map(hoveredRow => hoveredRow === (row || (row = closest(element, 'cdk-row')))),
        audit((hovering) => hovering ?
            this.mouseMove.pipe(filter(hoveredRow => hoveredRow === row)) :
            timer(HOVER_DELAY_MS)),
        distinctUntilChanged(),
        filter((hovering, index) => hovering || index > 1),
        );
  }
}

export abstract class Destroyable implements OnDestroy {
  protected readonly destroyed = new ReplaySubject<void>();
  
  ngOnDestroy() {
    this.destroyed.next();
    this.destroyed.complete();
  }
}

@Directive({
  selector: '[cdkInlineEdit]',
  host: {
    'tabIndex': '0',
    // TODO: aria something?
  }
})
export class CdkTableInlineEdit<T> extends Destroyable {
  @Input() cdkInlineEdit: TemplateRef<T>|null = null;

  protected focusTrap?: FocusTrap;
  protected overlayRef?: OverlayRef;

  constructor(
      protected readonly elementRef: ElementRef,
      protected readonly focusTrapFactory: FocusTrapFactory,
      protected readonly inlineEditEvents: InlineEditEvents,
      protected readonly ngZone: NgZone,
      protected readonly overlay: Overlay,
      protected readonly viewContainerRef: ViewContainerRef,) {
    super();
  }
  
  ngAfterViewInit() {
    this.inlineEditEvents.editingCell(this.elementRef.nativeElement!)
        .pipe(takeUntil(this.destroyed))
        .subscribe((open) => {
          this.ngZone.run(() => {
            if (open && this.cdkInlineEdit) {
              if (!this.overlayRef) {
                // TODO: work out details of positioning relative to cell.
                this.overlayRef = this.overlay.create({
                  // TODO: this should be configurable
                  positionStrategy: this.overlay.position().flexibleConnectedTo(this.elementRef)
                      .withGrowAfterOpen()
                      .withPush()
                      .withPositions([{
                        originX: 'start',
                        originY: 'top',
                        overlayX: 'start',
                        overlayY: 'top',
                      }]),
                  scrollStrategy: this.overlay.scrollStrategies.reposition({autoClose: true}),
                });
        
                this.focusTrap = this.focusTrapFactory.create(this.overlayRef.overlayElement);
        
                this.overlayRef.keydownEvents()
                    .pipe(filter(evt => evt.key === 'Enter' || evt.key === 'Escape'))
                    .subscribe(() => {
                      // todo - escape should undo any changes made
                      // to this end, ideally this whole thing would be some
                      // kind of form control...
                      
                      // alternatively make this something that we can forward
                      // to it via a provider
                      
                      
                      // todo - need to generalize this to something that the
                      // popup can notify us of.
                      this.overlayRef!.detach();
                    });
        
                this.overlayRef.detachments().subscribe(() => {
                  if (closest(document.activeElement, 'cdk-overlay-pane') ===
                      this.overlayRef!.overlayElement) {
                    this.elementRef.nativeElement!.focus();
                  }
                  this.inlineEditEvents.doneEditingCell(this.elementRef.nativeElement!);
                  
                });
              }
      
              // TODO: Is it better to create a portal once and reuse it?
              this.overlayRef.attach(new TemplatePortal(this.cdkInlineEdit, this.viewContainerRef));
              this.focusTrap!.focusInitialElementWhenReady();
              
            } else if (this.overlayRef) {
              this.overlayRef.detach();
            }
          });
      });
  }
  
  ngOnDestroy() {
    super.ngOnDestroy();
    
    if (this.overlayRef) {
      this.overlayRef.dispose();
    }
  }
}

@Directive({
  selector: 'table[cdk-table][inline-editable], cdk-table[inline-editable]',
  providers: [InlineEditEvents],
})
export class CdkTableInlineEditable extends Destroyable implements AfterViewInit {
  constructor(
/*      @Inject(DOCUMENT) protected document: any,*/
      protected readonly elementRef: ElementRef,
      protected readonly events: InlineEditEvents,
      protected readonly ngZone: NgZone) {
    super();
  }
  
  ngAfterViewInit() {
    const element = this.elementRef.nativeElement!;

    const toClosest = (className: string) => map((event: UIEvent) => closest(event.target, className));

    this.ngZone.runOutsideAngular(() => {
      fromEvent<MouseEvent>(element, 'mouseover').pipe(
          takeUntil(this.destroyed),
          toClosest('cdk-row'),
          distinctUntilChanged(),
          ).subscribe(this.events.hovering);
      fromEvent<MouseEvent>(element, 'mouseleave').pipe(
          takeUntil(this.destroyed),
          mapTo(null),
          ).subscribe(this.events.hovering);
      fromEvent<MouseEvent>(element, 'mousemove').pipe(
          takeUntil(this.destroyed),
          debounceTime(HOVER_DELAY_MS),
          toClosest('cdk-row'),
          ).subscribe(this.events.mouseMove);
    
      fromEvent<KeyboardEvent>(element, 'keydown').pipe(
          takeUntil(this.destroyed),
          filter(event => event.key === 'Enter'),
          toClosest('cdk-cell'),
          ).subscribe(this.events.editing);

          // close inline edit on click out
/*      if (document && document.body instanceof Element) {
        fromEvent<MouseEvent>(element, 'keydown').pipe(
            takeUntil(this.destroyed),
            filter(event => event.key === 'Enter'),
            toClosest('cdk-cell'),
            ).subscribe(this.events.editing);
      }*/
    });
  }
}

@Directive({
  selector: '[cdkCellOverlay]',
})
export class CdkTableCellOverlay extends Destroyable implements AfterViewInit {
  protected viewRef: EmbeddedViewRef<any>|null = null;
  
  constructor(
      protected readonly elementRef: ElementRef,
      protected readonly inlineEditEvents: InlineEditEvents,
      protected readonly viewContainerRef: ViewContainerRef,
      protected readonly ngZone: NgZone,
      protected readonly templateRef: TemplateRef<any>) {
    super();
  }
  
  ngAfterViewInit() {
    this.inlineEditEvents.hoveringOnRow(this.elementRef.nativeElement!)
        .pipe(takeUntil(this.destroyed))
        .subscribe(isHovering => {
          this.ngZone.run(() => {
            if (isHovering) {
              if (!this.viewRef) {
                // Not doing any positioning in CDK version. Material version
                // will absolutely position on right edge of cell.
                this.viewRef = this.viewContainerRef.createEmbeddedView(this.templateRef, {});
              } else {
                this.viewContainerRef.insert(this.viewRef);
              }
            } else if (this.viewRef) {
              this.viewContainerRef.detach(this.viewContainerRef.indexOf(this.viewRef));
            }
          });
        });
  }

  ngOnDestroy() {
    super.ngOnDestroy();
    if (this.viewRef) {
      this.viewRef.destroy();
    }
  }
}

// TODO: move to a separate file
// TODO: will this work from inside the popup? probably need to come up with something
@Directive({
  selector: 'button[cdkInlineEditOpen]',
  host: {
    '(click)': 'openInlineEdit()',
    'type': 'button', // Prevents accidental form submits.
  }
})
export class CdkTableInlineEditOpen {
  constructor(
      protected readonly elementRef: ElementRef,
      protected readonly inlineEditEvents: InlineEditEvents,) {}
      
  openInlineEdit() {
    this.inlineEditEvents.editing.next(closest(this.elementRef.nativeElement!, 'cdk-cell'));
  }
}



function closest(element: EventTarget|Element|null|undefined, className: string) {
  if (!(element instanceof Node)) return null;

  let curr: Node|null = element;
  while (curr != null && !(curr instanceof Element && curr.classList.contains(className))) {
    curr = curr.parentNode;
  }
  
  return (curr || null) as Element|null;
}
