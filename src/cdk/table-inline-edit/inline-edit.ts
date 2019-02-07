/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import {AfterViewInit, Directive, ElementRef, EmbeddedViewRef, Inject, Injectable, InjectionToken, Input, OnDestroy, NgZone, TemplateRef, ViewContainerRef} from '@angular/core';
import {Overlay, OverlayRef} from '@angular/cdk/overlay';
import {TemplatePortal} from '@angular/cdk/portal';
import {BehaviorSubject, fromEvent, timer, ReplaySubject, Subject} from 'rxjs';
import {audit, debounceTime, distinctUntilChanged, filter, map, mapTo, takeUntil} from 'rxjs/operators';

const HOVER_DELAY_MS = 30;

export const CDK_INLINE_EDIT_OPENED = new InjectionToken<Subject<boolean>>('cdk_ieo');

export function booleanSubjectFactory() {
  return new BehaviorSubject(false);
}

@Injectable()
export class HoverState {
  readonly hovered = new BehaviorSubject(false);
  
  readonly activities = new Subject<unknown>();
  readonly hoverEvents = new Subject<boolean>();
}

@Directive({
  selector: '[cdkInlineEdit]',
  host: {
    'tabIndex': '0',
    '(keyup.enter)': 'opened.next(true)', // todo: event delegation
    // TODO: aria something?
  },
  providers: [
    {
      provide: CDK_INLINE_EDIT_OPENED,
      useFactory: booleanSubjectFactory,
    }
  ]
})
export class CdkTableInlineEdit<T> implements OnDestroy {
  @Input() cdkInlineEdit: TemplateRef<T>|null = null;

  protected overlayRef?: OverlayRef;

  constructor(
      readonly elementRef: ElementRef,
      overlay: Overlay,
      @Inject(CDK_INLINE_EDIT_OPENED) readonly opened: Subject<boolean>,
      viewContainerRef: ViewContainerRef,) {
    this.opened.pipe(distinctUntilChanged()).subscribe((open) => {
      if (open && this.cdkInlineEdit) {
        if (!this.overlayRef) {
          // TODO: work out details of positioning relative to cell.
          this.overlayRef = overlay.create({
            // TODO: this should be configurable
            positionStrategy: overlay.position().flexibleConnectedTo(elementRef)
                .withGrowAfterOpen()
                .withPush()
                .withPositions([{
                  originX: 'start',
                  originY: 'top',
                  overlayX: 'start',
                  overlayY: 'top',
                }]),
            scrollStrategy: overlay.scrollStrategies.reposition({autoClose: true}),
          });
          
          this.overlayRef.detachments().pipe(mapTo(false)).subscribe(this.opened);
        }

        // For now, using a template portal but we should support a component
        // version also.
        
        // TODO: Is it better to create a portal once and reuse it?
        this.overlayRef.attach(new TemplatePortal(this.cdkInlineEdit, viewContainerRef));
      } else if (this.overlayRef) {
        this.overlayRef.detach();
        
        // TODO: Return focus to this cell?
        // Depends on how the popup was closed (return vs click on different
        // cell).
      }
    });
  }
  
  ngOnDestroy() {
    this.opened.complete();
    
    if (this.overlayRef) {
      this.overlayRef.dispose();
    }
  }
}

export abstract class Destroyable implements OnDestroy {
  protected readonly destroyed = new ReplaySubject<void>();
  
  ngOnDestroy() {
    this.destroyed.next();
    this.destroyed.complete();
  }
}

export interface EventState {
  readonly cell: Element|null;
  readonly value: boolean;
}

@Injectable()
export class InlineEditEvents {
  readonly editing = new Subject<EventState>();
  readonly hovering = new Subject<Element|null>();
  readonly mouseMove = new Subject<Element|null>();

  editingCell(cell: Element) {
    return this.editing.pipe(
    // todo - might need to play with this a bit
        map(state => state.cell === cell && state.value),
        distinctUntilChanged(),
        // rejoin zone? / detect changes?
        );
  }

  hoveringOnRow(element: Element) {
    const row = element.closest('.cdk-row');
    
    // super important that this is outside of zone
    return this.hovering.pipe(
        map(hoveredRow => hoveredRow === row),
        audit((hovering) => hovering ?
            this.mouseMove.pipe(filter(hoveredRow => hoveredRow === row)) :
            timer(HOVER_DELAY_MS)),
        distinctUntilChanged(),
        filter((hovering, index) => hovering || index > 1),
        );
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

    const toClosestRow = () => map((event: UIEvent) => event.target && (event.target as Element).closest('.cdk-row'));

    this.ngZone.runOutsideAngular(() => {
      fromEvent<MouseEvent>(element, 'mouseover').pipe(
          takeUntil(this.destroyed),
          toClosestRow(),
          distinctUntilChanged(),
          ).subscribe(this.events.hovering);
      fromEvent<MouseEvent>(element, 'mouseleave').pipe(
          takeUntil(this.destroyed),
          mapTo(null),
          ).subscribe(this.events.hovering);
      fromEvent<MouseEvent>(element, 'mousemove').pipe(
          takeUntil(this.destroyed),
          debounceTime(HOVER_DELAY_MS),
          toClosestRow(),
          ).subscribe(this.events.mouseMove);
    
  /*    fromEvent<KeyboardEvent>(element, 'keyup').pipe(
          takeUntil(this.destroyed),
          filter(event => event.key === 'Enter'),
          toClosestCell(),
          ).subscribe(this.events.editing);*/
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
    this.inlineEditEvents.hoveringOnRow(this.elementRef.nativeElement!.parentNode)
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
// akin to getClosestDialog to find the opened subject
@Directive({
  selector: 'button[cdkInlineEditOpen]',
  host: {
    '(click)': 'inlineEditOpened.next(true)',
    'type': 'button', // Prevents accidental form submits.
  }
})
export class CdkTableInlineEditOpen {
  constructor(@Inject(CDK_INLINE_EDIT_OPENED) readonly inlineEditOpened: Subject<boolean>) {}
}
