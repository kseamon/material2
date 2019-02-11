/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import {AfterViewInit, Directive, ElementRef, EmbeddedViewRef, Injectable, Input, OnDestroy, NgZone, TemplateRef, ViewContainerRef} from '@angular/core';
/*import {DOCUMENT} from '@angular/common';*/
import {ControlContainer} from '@angular/forms';
import {FocusTrap, FocusTrapFactory} from '@angular/cdk/a11y';
import {Overlay, OverlayRef} from '@angular/cdk/overlay';
import {TemplatePortal} from '@angular/cdk/portal';
import {fromEvent, timer, ReplaySubject, Subject} from 'rxjs';
import {audit, debounceTime, distinctUntilChanged, filter, first, map, mapTo, share, takeUntil} from 'rxjs/operators';

const HOVER_DELAY_MS = 30;

@Injectable()
export class InlineEditEvents {
  readonly editing = new Subject<Element|null>();
  readonly hovering = new Subject<Element|null>();
  readonly mouseMove = new Subject<Element|null>();

  protected currentlyEditing: Element|null = null;
  
  protected readonly hoveringDistinct = this.hovering.pipe(distinctUntilChanged(), share());
  protected readonly editingDistinct = this.editing.pipe(distinctUntilChanged(), share());
  
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
    
    return this.hoveringDistinct.pipe(
        map(hoveredRow => hoveredRow === (row || (row = closest(element, 'cdk-row')))),
        audit((hovering) => hovering ?
            this.mouseMove.pipe(filter(hoveredRow => hoveredRow === row)) :
            timer(HOVER_DELAY_MS)),
        distinctUntilChanged(),
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
  protected portal?: TemplatePortal;

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
                  disposeOnNavigation: true,
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
        
                this.portal = new TemplatePortal(this.cdkInlineEdit, this.viewContainerRef);
        
                this.overlayRef.detachments().subscribe(() => {
                  if (closest(document.activeElement, 'cdk-overlay-pane') ===
                      this.overlayRef!.overlayElement) {
                    this.elementRef.nativeElement!.focus();
                  }
                  this.inlineEditEvents.doneEditingCell(this.elementRef.nativeElement!);
                });
              }

              this.overlayRef.attach(this.portal!);
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
    
      fromEvent<KeyboardEvent>(element, 'keyup').pipe(
          takeUntil(this.destroyed),
          filter(event => event.key === 'Enter'),
          toClosest('cdk-cell'),
          ).subscribe(this.events.editing);
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
      protected readonly ngZone: NgZone,
      protected readonly templateRef: TemplateRef<any>,
      protected readonly viewContainerRef: ViewContainerRef,
      ) {
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
// TODO: this one might need a separate version for button vs not button
// different host bindings
@Directive({
  selector: '[cdkInlineEditOpen]',
  host: {
    '(click)': 'openInlineEdit($event)',
    'type': 'button', // Prevents accidental form submits.
  }
})
export class CdkTableInlineEditOpen {
  constructor(
      protected readonly elementRef: ElementRef,
      protected readonly inlineEditEvents: InlineEditEvents,) {}
      
  openInlineEdit(evt: Event) {
    this.inlineEditEvents.editing.next(closest(this.elementRef.nativeElement!, 'cdk-cell'));
    evt.stopPropagation();
  }
}

@Injectable()
export class InlineEditRef {
  private _revertFormValue: any;

  constructor(
      private readonly _form: ControlContainer,
      private readonly _inlineEditEvents: InlineEditEvents,) {
        console.log(_form);
        _form.valueChanges!.subscribe(value => console.log('update', value));
        _form.valueChanges!.pipe(first()).subscribe(() => this.updateRevertValue());
      }
  
  updateRevertValue() {
    this._revertFormValue = this._form.value;
  }
  
  close(preserveFormValues = false) {
    this._inlineEditEvents.editing.next(null);
  }

  reset() {
    this._form.reset(this._revertFormValue);
  }
}

export type InlineEditClickOutBehavior = 'close' | 'submit' | 'nothing';

@Directive({
  selector: 'form[cdkInlineEditControl]',
  host: {
    '(ngSubmit)': 'onSubmit()',
    '(keydown.enter)': 'onEnter(true)',
    '(keyup.enter)': 'onEnter(false)',
    '(keyup.escape)': 'onEscape()',
    '(document:click)': 'onDocumentClick($event)',
  },
  providers: [InlineEditRef],
})
export class CdkTableInlineEditControl {
  @Input() clickOutBehavior = 'close';

  private _enterPressed = false;
  private _submitPending = false;

  constructor(
      protected readonly elementRef: ElementRef,
      protected readonly inlineEditRef: InlineEditRef,) {}

  onSubmit() {
    this.inlineEditRef.updateRevertValue();
    
    // If the enter key is currently pressed, delay closing the popup so that
    // the keyUp event does not cause it to immediately reopen.
    if (this._enterPressed) {
      this._submitPending = true;
    } else {
      this.inlineEditRef.close();
    }
  }

  onEnter(pressed: boolean) {
    if (this._submitPending) {
      this.inlineEditRef.close();
      return;
    }
    
    this._enterPressed = pressed;
  }

  onEscape() {
    // todo - allow this behavior to be customized as well
    this.inlineEditRef.close(true);
  }

  onDocumentClick(evt: Event) {
    if (closest(evt.target, 'cdk-overlay-pane')) return;
    
    switch(this.clickOutBehavior) {
      case 'submit':
        this.elementRef.nativeElement!.dispatchEvent(new Event('submit'));
        this.inlineEditRef.close();
        break;
      case 'close':
        this.inlineEditRef.close(true);
        break;
      default:
        break;
    }
  }
}

@Directive({
  selector: 'button[cdkInlineEditRevert]',
  host: {
    '(click)': 'revertInlineEdit()',
    'type': 'button', // Prevents accidental form submits.
  }
})
export class CdkTableInlineEditRevert {
  constructor(
      protected readonly inlineEditRef: InlineEditRef,) {}
      
  revertInlineEdit() {
    this.inlineEditRef.reset();
  }
}

@Directive({
  selector: 'button[cdkInlineEditRevertAndClose]',
  host: {
    '(click)': 'revertInlineEdit()',
    'type': 'button', // Prevents accidental form submits.
  }
})
export class CdkTableInlineEditRevertAndClose {
  constructor(
      protected readonly inlineEditRef: InlineEditRef,) {}
      
  revertInlineEdit() {
    this.inlineEditRef.reset();
    this.inlineEditRef.close();
  }
}

@Directive({
  selector: 'button[cdkInlineEditClose]',
  host: {
    '(click)': 'closeInlineEdit()',
    'type': 'button', // Prevents accidental form submits.
  }
})
export class CdkTableInlineEditClose {
  constructor(
      protected readonly inlineEditRef: InlineEditRef,) {}
      
  closeInlineEdit() {
    this.inlineEditRef.close();
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
