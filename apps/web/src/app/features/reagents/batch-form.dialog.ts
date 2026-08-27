import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { CreateBatchRequest, LocationDto, UNITS, Unit } from '@labtrack/shared';
import { LocationsStore } from '../locations/locations.store';
import { REAGENTS_ES } from './i18n.es';
import { COMMON_ES } from '../../shared/i18n/es';

export interface BatchFormDialogData {
  reagentId: string;
}

@Component({
  selector: 'lt-batch-form-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatButtonModule,
  ],
  template: `
    <h2 mat-dialog-title>{{ text.batchForm.title }}</h2>
    <mat-dialog-content [formGroup]="form">
      <mat-form-field appearance="outline">
        <mat-label>{{ text.batchForm.lotNumber }}</mat-label>
        <input matInput formControlName="lotNumber" />
      </mat-form-field>

      <mat-form-field appearance="outline">
        <mat-label>{{ text.batchForm.entryDate }}</mat-label>
        <input matInput type="date" formControlName="entryDate" />
      </mat-form-field>

      <mat-form-field appearance="outline">
        <mat-label>{{ text.batchForm.expirationDate }}</mat-label>
        <input matInput type="date" formControlName="expirationDate" />
      </mat-form-field>

      <mat-form-field appearance="outline">
        <mat-label>{{ text.batchForm.initialStock }}</mat-label>
        <input matInput formControlName="initialStock" />
      </mat-form-field>

      <mat-form-field appearance="outline">
        <mat-label>{{ text.batchForm.unit }}</mat-label>
        <mat-select formControlName="unit">
          @for (unit of units; track unit) {
            <mat-option [value]="unit">{{ text.units[unit] }}</mat-option>
          }
        </mat-select>
      </mat-form-field>

      <mat-form-field appearance="outline">
        <mat-label>{{ text.batchForm.location }}</mat-label>
        <mat-select formControlName="locationId">
          @for (location of locationOptions(); track location.id) {
            <mat-option [value]="location.id">{{ location.name }}</mat-option>
          }
        </mat-select>
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
export class BatchFormDialog implements OnInit {
  readonly dialogRef = inject(MatDialogRef<BatchFormDialog, CreateBatchRequest>);
  readonly data = inject<BatchFormDialogData>(MAT_DIALOG_DATA);
  private readonly locationsStore = inject(LocationsStore);
  readonly text = REAGENTS_ES;
  readonly common = COMMON_ES;
  readonly units = UNITS;

  readonly locationOptions = signal<LocationDto[]>([]);

  private readonly decimalPattern = /^\d{1,8}(\.\d{1,4})?$/;

  readonly form = inject(FormBuilder).nonNullable.group({
    lotNumber: ['', [Validators.required, Validators.maxLength(60)]],
    entryDate: ['', Validators.required],
    expirationDate: [''],
    initialStock: ['', [Validators.required, Validators.pattern(this.decimalPattern)]],
    unit: ['ML' as Unit, Validators.required],
    locationId: ['', Validators.required],
  });

  ngOnInit(): void {
    // listActive() bypasses LocationsStore's own paginated view state (see
    // its comment): setPageSize() here previously leaked into /ubicaciones,
    // since that store is shared (providedIn: 'root').
    this.locationsStore.listActive().subscribe((locations) => this.locationOptions.set(locations));
  }

  confirm(): void {
    if (!this.form.valid) {
      return;
    }
    const { lotNumber, entryDate, expirationDate, initialStock, unit, locationId } =
      this.form.getRawValue();
    this.dialogRef.close({
      lotNumber,
      entryDate,
      expirationDate: expirationDate || undefined,
      initialStock,
      unit,
      locationId,
    });
  }
}
