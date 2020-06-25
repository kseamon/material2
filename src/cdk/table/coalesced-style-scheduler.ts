/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import {Injectable, NgZone} from '@angular/core';
import {from, Observable} from 'rxjs';

@Injectable()
export class CoalescedStyleScheduler {
  private _currentSchedule: Observable<void>|null = null;

  constructor(private readonly _ngZone: NgZone) {}

  schedule(task: () => unknown): void {
    this._createScheduleIfNeeded();

    this._currentSchedule!.subscribe(task);
  }

  private _createScheduleIfNeeded() {
    if (this._currentSchedule) { return; }

    this._ngZone.runOutsideAngular(() => {
      this._currentSchedule = from(new Promise<void>((resolve) => {
        this._currentSchedule = null;
        resolve(undefined);
      }));
    });
  }
}
