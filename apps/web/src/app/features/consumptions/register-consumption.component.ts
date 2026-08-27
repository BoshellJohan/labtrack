import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { toSignal } from '@angular/core/rxjs-interop';
import { AbstractControl, FormBuilder, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { provideNativeDateAdapter } from '@angular/material/core';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { CreateConsumptionRequest, ReagentBatchDto, ReagentDto } from '@labtrack/shared';
import { ApiService } from '../../core/api/api.service';
import { REAGENTS_ES } from '../reagents/i18n.es';
import { REGISTER_CONSUMPTION_ES } from './i18n.es';
import { COMMON_ES } from '../../shared/i18n/es';

// Decimal(12,4) values travel as strings end to end. Comparing them as
// strings — pad both to the same fractional scale, then compare integer and
// fractional parts separately — avoids the precision loss a parseFloat round
// trip would introduce (e.g. '0.3000' becoming 0.3).
function compareDecimalStrings(a: string, b: string): number {
  const [aIntRaw, aFracRaw = ''] = a.split('.');
  const [bIntRaw, bFracRaw = ''] = b.split('.');
  const aInt = aIntRaw.replace(/^0+(?=\d)/, '');
  const bInt = bIntRaw.replace(/^0+(?=\d)/, '');
  if (aInt.length !== bInt.length) {
    return aInt.length - bInt.length;
  }
  if (aInt !== bInt) {
    return aInt < bInt ? -1 : 1;
  }
  const scale = Math.max(aFracRaw.length, bFracRaw.length);
  const aFrac = aFracRaw.padEnd(scale, '0');
  const bFrac = bFracRaw.padEnd(scale, '0');
  if (aFrac === bFrac) {
    return 0;
  }
  return aFrac < bFrac ? -1 : 1;
}

// The same pattern the API's CreateConsumptionRequest DTO enforces, applied
// client-side so a malformed quantity is caught before a round trip.
const QUANTITY_PATTERN = /^\d{1,8}(\.\d{1,4})?$/;

@Component({
  selector: 'lt-register-consumption',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    DatePipe,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatDatepickerModule,
    MatButtonModule,
  ],
  // Scoped here rather than app-wide: this is the only screen with a
  // datepicker today, and the adapter costs nothing in the eager bundle.
  providers: [provideNativeDateAdapter()],
  template: `
    <section class="page">
      <h1>{{ text.title }}</h1>

      <form [formGroup]="form" (ngSubmit)="submit()">
        <mat-form-field appearance="outline">
          <mat-label>{{ text.reagent }}</mat-label>
          <mat-select
            [value]="form.controls.reagentId.value"
            (selectionChange)="selectReagent($event.value)"
          >
            @for (reagent of reagentOptions(); track reagent.id) {
              <mat-option [value]="reagent.id">{{ reagent.name }}</mat-option>
            }
          </mat-select>
        </mat-form-field>

        <mat-form-field appearance="outline">
          <mat-label>{{ text.batch }}</mat-label>
          <mat-select formControlName="batchId">
            @for (batch of batches(); track batch.id) {
              <mat-option [value]="batch.id">
                {{ text.batchOption(batch.lotNumber, formatQuantity(batch.currentStock), unitAbbreviation(batch.unit)) }}
              </mat-option>
            }
          </mat-select>
        </mat-form-field>

        @if (form.controls.reagentId.value && batches().length === 0) {
          <p class="hint">{{ text.noBatches }}</p>
        }

        @if (selectedBatch(); as batch) {
          <p class="hint">
            {{ text.expiresOn }}
            {{ batch.expirationDate ? (batch.expirationDate | date: 'shortDate' : 'UTC') : text.noExpiry }}
          </p>
        }

        <mat-form-field appearance="outline">
          <mat-label>{{ text.quantity }}</mat-label>
          <input matInput formControlName="quantity" />
          @if (form.controls.quantity.hasError('exceedsStock')) {
            <mat-error>{{ text.exceedsStock }}</mat-error>
          }
          @if (form.controls.quantity.hasError('invalidQuantity')) {
            <mat-error>{{ text.invalidQuantity }}</mat-error>
          }
        </mat-form-field>

        <mat-form-field appearance="outline">
          <mat-label>{{ text.consumedAt }}</mat-label>
          <input matInput [matDatepicker]="picker" formControlName="consumedAt" />
          <mat-datepicker-toggle matIconSuffix [for]="picker" />
          <mat-datepicker #picker />
        </mat-form-field>

        <mat-form-field appearance="outline">
          <mat-label>{{ text.purpose }}</mat-label>
          <input matInput formControlName="purpose" />
        </mat-form-field>

        <button mat-flat-button color="primary" type="submit" [disabled]="form.invalid">
          {{ text.submit }}
        </button>
      </form>
    </section>
  `,
  styles: `
    .page { padding: 1.5rem; display: flex; flex-direction: column; gap: 1rem; max-width: 30rem; }
    form { display: flex; flex-direction: column; gap: 0.5rem; }
    .hint { color: rgba(0, 0, 0, 0.6); margin: 0; }
  `,
})
export class RegisterConsumptionComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly fb = inject(FormBuilder);

  readonly text = REGISTER_CONSUMPTION_ES;

  readonly reagentOptions = signal<ReagentDto[]>([]);
  readonly batches = signal<ReagentBatchDto[]>([]);

  // Reads the sibling `batchId` control off the quantity control's own
  // parent rather than a component field, so this closure needs no
  // particular field-declaration order relative to `form` below (Angular
  // runs validators synchronously while the FormGroup is being built).
  private readonly quantityValidator = (control: AbstractControl): ValidationErrors | null => {
    const value = control.value as string;
    if (!value) {
      return null;
    }
    const errors: ValidationErrors = {};
    if (!QUANTITY_PATTERN.test(value)) {
      errors['invalidQuantity'] = true;
    } else {
      const batchId = control.parent?.get('batchId')?.value as string | undefined;
      const batch = batchId ? this.batches().find((b) => b.id === batchId) : undefined;
      if (batch && compareDecimalStrings(value, batch.currentStock) > 0) {
        errors['exceedsStock'] = true;
      }
    }
    return Object.keys(errors).length > 0 ? errors : null;
  };

  readonly form = this.fb.nonNullable.group({
    reagentId: ['', Validators.required],
    batchId: ['', Validators.required],
    quantity: ['', [Validators.required, this.quantityValidator]],
    consumedAt: this.fb.control<Date | null>(null, Validators.required),
    purpose: ['', Validators.required],
  });

  private readonly batchIdSignal = toSignal(this.form.controls.batchId.valueChanges, {
    initialValue: this.form.controls.batchId.value,
  });

  readonly selectedBatch = computed(() =>
    this.batches().find((b) => b.id === this.batchIdSignal()),
  );

  constructor() {
    // The stock a quantity is checked against changes whenever the batch
    // does, so re-run the quantity validator whenever batchId changes.
    this.form.controls.batchId.valueChanges.subscribe(() =>
      this.form.controls.quantity.updateValueAndValidity(),
    );
  }

  ngOnInit(): void {
    this.api.getPage<ReagentDto>('/reagents', { pageSize: 100 }).subscribe({
      next: (page) => this.reagentOptions.set(page.data),
      error: () =>
        this.snackBar.open(COMMON_ES.unexpectedError, COMMON_ES.accept, { duration: 5000 }),
    });
  }

  // The unit of a consumption comes from its batch, so batches are only ever
  // loaded for a single, explicitly chosen reagent — never across reagents.
  selectReagent(id: string): void {
    this.form.controls.reagentId.setValue(id);
    this.form.controls.batchId.setValue('');
    this.batches.set([]);
    if (!id) {
      return;
    }
    this.api.getPage<ReagentBatchDto>(`/reagents/${id}/batches`, { pageSize: 100 }).subscribe({
      next: (page) => this.batches.set(page.data),
      error: () =>
        this.snackBar.open(COMMON_ES.unexpectedError, COMMON_ES.accept, { duration: 5000 }),
    });
  }

  formatQuantity(value: string): string {
    return value.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
  }

  unitAbbreviation(unit: ReagentBatchDto['unit']): string {
    return REAGENTS_ES.unitAbbreviations[unit];
  }

  submit(): void {
    if (this.form.invalid) {
      return;
    }
    const { batchId, quantity, consumedAt, purpose } = this.form.getRawValue();
    const request: CreateConsumptionRequest = {
      batchId,
      // Verbatim from the control: '0.3000' must never round-trip through
      // Number and come back as '0.3'.
      quantity,
      consumedAt: consumedAt!.toISOString(),
      purpose,
    };
    this.api.post('/consumptions', request).subscribe({
      next: () => {
        this.snackBar.open(this.text.success, COMMON_ES.accept, { duration: 5000 });
        this.form.reset();
        this.batches.set([]);
      },
      error: () => this.snackBar.open(this.text.failure, COMMON_ES.accept, { duration: 5000 }),
    });
  }
}
