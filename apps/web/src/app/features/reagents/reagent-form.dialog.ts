import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { CreateReagentRequest, ReagentDto, UpdateReagentRequest } from '@labtrack/shared';
import { REAGENTS_ES } from './i18n.es';
import { COMMON_ES } from '../../shared/i18n/es';

export interface ReagentFormDialogData {
  reagent?: ReagentDto;
}

@Component({
  selector: 'lt-reagent-form-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, MatDialogModule, MatFormFieldModule, MatInputModule, MatButtonModule],
  template: `
    <h2 mat-dialog-title>{{ data.reagent ? text.editReagent : text.newReagent }}</h2>
    <mat-dialog-content [formGroup]="form">
      <mat-form-field appearance="outline">
        <mat-label>{{ text.reagentForm.name }}</mat-label>
        <input matInput formControlName="name" />
      </mat-form-field>

      <mat-form-field appearance="outline">
        <mat-label>{{ text.reagentForm.casNumber }}</mat-label>
        <input matInput formControlName="casNumber" [placeholder]="text.reagentForm.casNumberHint" />
      </mat-form-field>

      <mat-form-field appearance="outline">
        <mat-label>{{ text.reagentForm.reference }}</mat-label>
        <input matInput formControlName="reference" />
      </mat-form-field>

      <mat-form-field appearance="outline">
        <mat-label>{{ text.reagentForm.description }}</mat-label>
        <input matInput formControlName="description" />
      </mat-form-field>

      <mat-form-field appearance="outline">
        <mat-label>{{ text.reagentForm.dataSheetUrl }}</mat-label>
        <input matInput formControlName="dataSheetUrl" />
      </mat-form-field>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button (click)="dialogRef.close()">{{ common.cancel }}</button>
      <button mat-flat-button color="primary" [disabled]="form.invalid" (click)="confirm()">
        {{ common.save }}
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    mat-dialog-content { display: flex; flex-direction: column; gap: 1rem; padding-top: 0.5rem; }
  `,
})
export class ReagentFormDialog {
  readonly dialogRef = inject(
    MatDialogRef<ReagentFormDialog, CreateReagentRequest | UpdateReagentRequest>,
  );
  readonly data = inject<ReagentFormDialogData>(MAT_DIALOG_DATA);
  readonly text = REAGENTS_ES;
  readonly common = COMMON_ES;

  private readonly casNumberPattern = /^\d{2,7}-\d{2}-\d$/;

  readonly form = inject(FormBuilder).nonNullable.group({
    name: [this.data.reagent?.name ?? '', [Validators.required, Validators.minLength(2)]],
    casNumber: [
      this.data.reagent?.casNumber ?? '',
      [Validators.required, Validators.pattern(this.casNumberPattern)],
    ],
    reference: [this.data.reagent?.reference ?? ''],
    description: [this.data.reagent?.description ?? ''],
    dataSheetUrl: [this.data.reagent?.dataSheetUrl ?? ''],
  });

  confirm(): void {
    if (!this.form.valid) {
      return;
    }
    const { name, casNumber, reference, description, dataSheetUrl } = this.form.getRawValue();
    // A blank field means "clear it" when editing (null), but a create has
    // nothing to clear yet, so it stays omitted (undefined).
    const blank = this.data.reagent ? null : undefined;
    this.dialogRef.close({
      name,
      casNumber,
      reference: reference || blank,
      description: description || blank,
      dataSheetUrl: dataSheetUrl || blank,
    });
  }
}
