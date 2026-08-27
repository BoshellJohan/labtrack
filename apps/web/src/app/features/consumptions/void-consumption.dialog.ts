import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { AbstractControl, FormBuilder, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { ConsumptionDto, VoidConsumptionRequest } from '@labtrack/shared';
import { VOID_CONSUMPTION_ES } from './i18n.es';
import { COMMON_ES } from '../../shared/i18n/es';

// A whitespace-only value passes Validators.required (it is non-empty) but
// the API rejects it with a 400 — the trim happens at the boundary, not
// before, so validate the trimmed value here rather than accept it and let
// the server bounce it back.
function notBlank(control: AbstractControl): ValidationErrors | null {
  const value = (control.value as string) ?? '';
  return value.trim().length > 0 ? null : { blank: true };
}

@Component({
  selector: 'lt-void-consumption-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, MatDialogModule, MatFormFieldModule, MatInputModule, MatButtonModule],
  template: `
    <h2 mat-dialog-title>{{ text.title }}</h2>
    <mat-dialog-content [formGroup]="form">
      <p>{{ text.explanation }}</p>
      <mat-form-field appearance="outline">
        <mat-label>{{ text.reason }}</mat-label>
        <textarea matInput formControlName="voidReason" rows="3"></textarea>
        @if (form.controls.voidReason.invalid && form.controls.voidReason.touched) {
          <mat-error>{{ text.reasonRequired }}</mat-error>
        }
      </mat-form-field>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button (click)="dialogRef.close()">{{ common.cancel }}</button>
      <button mat-flat-button color="warn" [disabled]="form.invalid" (click)="confirm()">
        {{ text.confirm }}
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    mat-dialog-content { display: flex; flex-direction: column; gap: 1rem; padding-top: 0.5rem; }
  `,
})
export class VoidConsumptionDialog {
  readonly dialogRef = inject(MatDialogRef<VoidConsumptionDialog, VoidConsumptionRequest>);
  readonly data = inject<ConsumptionDto>(MAT_DIALOG_DATA);
  readonly text = VOID_CONSUMPTION_ES;
  readonly common = COMMON_ES;

  readonly form = inject(FormBuilder).nonNullable.group({
    voidReason: ['', [Validators.required, notBlank]],
  });

  confirm(): void {
    if (this.form.invalid) {
      return;
    }
    const voidReason = this.form.controls.voidReason.value.trim();
    this.dialogRef.close({ voidReason });
  }
}
