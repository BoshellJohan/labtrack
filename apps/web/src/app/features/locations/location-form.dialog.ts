import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { CreateLocationRequest, LocationDto, UpdateLocationRequest } from '@labtrack/shared';
import { LOCATIONS_ES } from './i18n.es';
import { COMMON_ES } from '../../shared/i18n/es';

export interface LocationFormDialogData {
  location?: LocationDto;
}

@Component({
  selector: 'lt-location-form-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, MatDialogModule, MatFormFieldModule, MatInputModule, MatButtonModule],
  template: `
    <h2 mat-dialog-title>{{ data.location ? text.editLocation : text.newLocation }}</h2>
    <mat-dialog-content [formGroup]="form">
      <mat-form-field appearance="outline">
        <mat-label>{{ text.form.name }}</mat-label>
        <input matInput formControlName="name" />
      </mat-form-field>

      <mat-form-field appearance="outline">
        <mat-label>{{ text.form.description }}</mat-label>
        <input matInput formControlName="description" />
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
export class LocationFormDialog {
  readonly dialogRef = inject(
    MatDialogRef<LocationFormDialog, CreateLocationRequest | UpdateLocationRequest>,
  );
  readonly data = inject<LocationFormDialogData>(MAT_DIALOG_DATA);
  readonly text = LOCATIONS_ES;
  readonly common = COMMON_ES;

  readonly form = inject(FormBuilder).nonNullable.group({
    name: [this.data.location?.name ?? '', [Validators.required, Validators.minLength(2)]],
    description: [this.data.location?.description ?? ''],
  });

  confirm(): void {
    if (!this.form.valid) {
      return;
    }
    const { name, description } = this.form.getRawValue();
    // A blank field means "clear it" when editing (null), but a create has
    // nothing to clear yet, so it stays omitted (undefined).
    const blank = this.data.location ? null : undefined;
    this.dialogRef.close({ name, description: description || blank });
  }
}
