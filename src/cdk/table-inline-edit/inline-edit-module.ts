/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

/*import {CommonModule} from '@angular/common';*/
import {NgModule} from '@angular/core';
import {CdkTableInlineEdit, CdkTableCellOverlay, CdkTableInlineEditable, CdkTableInlineEditOpen} from './inline-edit';

const EXPORTED_DECLARATIONS = [
  CdkTableInlineEdit, CdkTableCellOverlay, CdkTableInlineEditable, CdkTableInlineEditOpen,
];

@NgModule({
/*  imports: [CommonModule],*/
  exports: EXPORTED_DECLARATIONS,
  declarations: EXPORTED_DECLARATIONS,
})
export class CdkTableInlineEditModule { }
