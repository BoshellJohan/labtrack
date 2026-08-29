import { ChangeDetectionStrategy, Component, OnInit, effect, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpErrorResponse } from '@angular/common/http';
import { FormBuilder, FormControl, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { provideNativeDateAdapter } from '@angular/material/core';
import { MatDatepickerModule } from '@angular/material/datepicker';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatPaginatorIntl, MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTableModule } from '@angular/material/table';
import { Subject, debounceTime, distinctUntilChanged } from 'rxjs';
import {
  CreateBatchRequest,
  CreateReagentRequest,
  LocationDto,
  ReagentBatchDto,
  ReagentDto,
  UNITS,
  Unit,
  UpdateReagentRequest,
} from '@labtrack/shared';
import { ReagentsStore } from './reagents.store';
import { BatchesStore } from './batches.store';
import { ReagentFormDialog } from './reagent-form.dialog';
import { BatchFormDialog } from './batch-form.dialog';
import { REAGENTS_ES } from './i18n.es';
import { COMMON_ES } from '../../shared/i18n/es';
import { createSpanishPaginatorIntl } from '../../shared/i18n/spanish-paginator-intl';
import { AuthService } from '../../core/auth/auth.service';
import { LocationsStore } from '../locations/locations.store';

type ExpiryStatus = 'expired' | 'warning' | 'ok';

@Component({
  selector: 'lt-reagents',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    DatePipe,
    MatTableModule,
    MatPaginatorModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatButtonModule,
    MatDatepickerModule,
    MatDialogModule,
    MatProgressBarModule,
  ],
  // Scoped here rather than app-wide: see LocationsComponent for why this
  // costs nothing in the eager bundle.
  providers: [
    { provide: MatPaginatorIntl, useFactory: createSpanishPaginatorIntl },
    BatchesStore,
    provideNativeDateAdapter(),
  ],
  template: `
    <section class="page">
      <header>
        <h1>{{ text.title }}</h1>
        @if (auth.isAdmin()) {
          <button mat-flat-button color="primary" (click)="openReagentForm()">
            {{ text.newReagent }}
          </button>
        }
      </header>

      <div class="filters">
        <mat-form-field appearance="outline">
          <mat-label>{{ text.filters.name }}</mat-label>
          <input matInput [formControl]="nameControl" />
        </mat-form-field>

        <mat-form-field appearance="outline">
          <mat-label>{{ text.filters.casNumber }}</mat-label>
          <input matInput [formControl]="casNumberControl" />
        </mat-form-field>

        <mat-form-field appearance="outline">
          <mat-label>{{ text.filters.location }}</mat-label>
          <mat-select [formControl]="locationControl">
            <mat-option value="">{{ text.filters.allLocations }}</mat-option>
            @for (location of locationOptions(); track location.id) {
              <mat-option [value]="location.id">{{ location.name }}</mat-option>
            }
          </mat-select>
        </mat-form-field>

        <div class="consumption-filters" [formGroup]="filtersForm">
          <mat-form-field appearance="outline">
            <mat-label>{{ text.filters.minConsumed }}</mat-label>
            <input matInput formControlName="minConsumed" />
          </mat-form-field>

          <mat-form-field appearance="outline">
            <mat-label>{{ text.filters.minConsumedUnit }}</mat-label>
            <mat-select formControlName="minConsumedUnit">
              @for (unit of units; track unit) {
                <mat-option [value]="unit">{{ text.units[unit] }}</mat-option>
              }
            </mat-select>
            @if (filtersForm.controls.minConsumedUnit.hasError('required')) {
              <mat-error>{{ text.filters.unitRequired }}</mat-error>
            }
          </mat-form-field>

          <mat-form-field appearance="outline">
            <mat-label>{{ text.filters.consumedFrom }}</mat-label>
            <input matInput [matDatepicker]="consumedFromPicker" formControlName="consumedFrom" />
            <mat-datepicker-toggle matIconSuffix [for]="consumedFromPicker" />
            <mat-datepicker #consumedFromPicker />
          </mat-form-field>

          <mat-form-field appearance="outline">
            <mat-label>{{ text.filters.consumedTo }}</mat-label>
            <input matInput [matDatepicker]="consumedToPicker" formControlName="consumedTo" />
            <mat-datepicker-toggle matIconSuffix [for]="consumedToPicker" />
            <mat-datepicker #consumedToPicker />
          </mat-form-field>
        </div>
      </div>

      @if (store.loading()) {
        <mat-progress-bar mode="indeterminate" />
      }

      <table mat-table [dataSource]="store.reagents()" multiTemplateDataRows>
        <ng-container matColumnDef="name">
          <th mat-header-cell *matHeaderCellDef>{{ text.columns.name }}</th>
          <td mat-cell *matCellDef="let reagent">{{ reagent.name }}</td>
        </ng-container>

        <ng-container matColumnDef="casNumber">
          <th mat-header-cell *matHeaderCellDef>{{ text.columns.casNumber }}</th>
          <td mat-cell *matCellDef="let reagent">{{ reagent.casNumber }}</td>
        </ng-container>

        <ng-container matColumnDef="reference">
          <th mat-header-cell *matHeaderCellDef>{{ text.columns.reference }}</th>
          <td mat-cell *matCellDef="let reagent">{{ reagent.reference }}</td>
        </ng-container>

        <ng-container matColumnDef="stock">
          <th mat-header-cell *matHeaderCellDef>{{ text.columns.stock }}</th>
          <td mat-cell *matCellDef="let reagent">
            <!-- One line per unit: a reagent may hold batches in millilitres
                 and litres at once, and summing those would invent a
                 quantity nobody can act on. -->
            @for (stock of reagent.stockByUnit; track stock.unit) {
              <div>{{ formatQuantity(stock.total) }} {{ unitAbbreviation(stock.unit) }}</div>
            }
          </td>
        </ng-container>

        <ng-container matColumnDef="batchCount">
          <th mat-header-cell *matHeaderCellDef>{{ text.columns.batchCount }}</th>
          <td mat-cell *matCellDef="let reagent">{{ reagent.batchCount }}</td>
        </ng-container>

        <ng-container matColumnDef="status">
          <th mat-header-cell *matHeaderCellDef>{{ text.columns.status }}</th>
          <td mat-cell *matCellDef="let reagent">
            {{ reagent.active ? text.status.active : text.status.inactive }}
          </td>
        </ng-container>

        <ng-container matColumnDef="actions">
          <th mat-header-cell *matHeaderCellDef>{{ text.columns.actions }}</th>
          <td mat-cell *matCellDef="let reagent">
            <button mat-button (click)="toggleBatches(reagent)">
              {{ expandedId() === reagent.id ? text.hideBatches : text.viewBatches }}
            </button>
            @if (auth.isAdmin()) {
              <button mat-button (click)="openReagentForm(reagent)">{{ text.edit }}</button>
              @if (reagent.active) {
                <button mat-button color="warn" (click)="deactivate(reagent.id)">
                  {{ text.deactivate }}
                </button>
              }
            }
          </td>
        </ng-container>

        <ng-container matColumnDef="detail">
          <td mat-cell *matCellDef="let reagent" [attr.colspan]="columns.length">
            @if (expandedId() === reagent.id) {
              <div class="batches">
                @if (batchesStore.loading()) {
                  <mat-progress-bar mode="indeterminate" />
                }
                @if (!batchesStore.loading() && batchesStore.batches().length === 0) {
                  <p class="empty">{{ text.noBatches }}</p>
                }
                @if (batchesStore.batches().length > 0) {
                  <table mat-table [dataSource]="batchesStore.batches()">
                    <ng-container matColumnDef="lotNumber">
                      <th mat-header-cell *matHeaderCellDef>{{ text.batchColumns.lotNumber }}</th>
                      <td mat-cell *matCellDef="let batch">{{ batch.lotNumber }}</td>
                    </ng-container>

                    <ng-container matColumnDef="entryDate">
                      <th mat-header-cell *matHeaderCellDef>{{ text.batchColumns.entryDate }}</th>
                      <td mat-cell *matCellDef="let batch">
                        {{ batch.entryDate | date: 'shortDate' : 'UTC' }}
                      </td>
                    </ng-container>

                    <ng-container matColumnDef="expirationDate">
                      <th mat-header-cell *matHeaderCellDef>
                        {{ text.batchColumns.expirationDate }}
                      </th>
                      <td
                        mat-cell
                        *matCellDef="let batch"
                        [class.expired]="expiryStatus(batch) === 'expired'"
                        [class.warning]="expiryStatus(batch) === 'warning'"
                      >
                        @if (batch.expirationDate) {
                          <!-- UTC: the API stores calendar dates at UTC
                               midnight, and rendering in the viewer's local
                               timezone can shift the displayed day by one. -->
                          {{ batch.expirationDate | date: 'shortDate' : 'UTC' }}
                          @if (expiryStatus(batch) === 'expired') {
                            ({{ text.expired }})
                          } @else if (expiryStatus(batch) === 'warning') {
                            ({{ text.expiringSoon }})
                          }
                        } @else {
                          {{ text.noExpiration }}
                        }
                      </td>
                    </ng-container>

                    <ng-container matColumnDef="stock">
                      <th mat-header-cell *matHeaderCellDef>{{ text.batchColumns.stock }}</th>
                      <td mat-cell *matCellDef="let batch">
                        {{ formatQuantity(batch.currentStock) }} {{ unitAbbreviation(batch.unit) }}
                      </td>
                    </ng-container>

                    <ng-container matColumnDef="location">
                      <th mat-header-cell *matHeaderCellDef>{{ text.batchColumns.location }}</th>
                      <td mat-cell *matCellDef="let batch">{{ batch.locationName }}</td>
                    </ng-container>

                    <tr mat-header-row *matHeaderRowDef="batchColumns"></tr>
                    <tr mat-row *matRowDef="let row; columns: batchColumns"></tr>
                  </table>
                }
                @if (auth.isAdmin()) {
                  <button mat-button (click)="openBatchForm(reagent)">{{ text.addBatch }}</button>
                }
              </div>
            }
          </td>
        </ng-container>

        <tr mat-header-row *matHeaderRowDef="columns"></tr>
        <tr mat-row *matRowDef="let row; columns: columns"></tr>
        <tr mat-row *matRowDef="let row; columns: ['detail']" class="detail-row"></tr>
      </table>

      @if (!store.loading() && store.reagents().length === 0) {
        <p class="empty">{{ text.emptyState }}</p>
      }

      <mat-paginator
        [length]="store.total()"
        [pageSize]="store.pageSize()"
        [pageIndex]="store.page() - 1"
        [pageSizeOptions]="[10, 20, 50]"
        (page)="onPage($event)"
      />
    </section>
  `,
  styles: `
    .page { padding: 1.5rem; display: flex; flex-direction: column; gap: 1rem; }
    header { display: flex; align-items: center; justify-content: space-between; }
    .filters { display: flex; gap: 1rem; flex-wrap: wrap; }
    .filters mat-form-field { min-width: 14rem; }
    .consumption-filters { display: flex; gap: 1rem; flex-wrap: wrap; align-items: flex-start; }
    table { width: 100%; }
    .empty { color: rgba(0, 0, 0, 0.6); }
    .detail-row td { border-bottom-width: 0; }
    .batches { padding: 1rem 0; }
    .expired { color: #b3261e; font-weight: 600; }
    .warning { color: #8a5a00; font-weight: 600; }
  `,
})
export class ReagentsComponent implements OnInit {
  readonly store = inject(ReagentsStore);
  readonly batchesStore = inject(BatchesStore);
  private readonly locationsStore = inject(LocationsStore);
  readonly auth = inject(AuthService);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);
  private readonly fb = inject(FormBuilder);

  readonly text = REAGENTS_ES;
  readonly columns = ['name', 'casNumber', 'reference', 'stock', 'batchCount', 'status', 'actions'];
  readonly batchColumns = ['lotNumber', 'entryDate', 'expirationDate', 'stock', 'location'];
  readonly units = UNITS;

  readonly nameControl = new FormControl('', { nonNullable: true });
  readonly casNumberControl = new FormControl('', { nonNullable: true });
  readonly locationControl = new FormControl('', { nonNullable: true });

  readonly filtersForm = this.fb.nonNullable.group({
    minConsumed: [''],
    minConsumedUnit: [''],
    consumedFrom: this.fb.control<Date | null>(null),
    consumedTo: this.fb.control<Date | null>(null),
  });

  readonly expandedId = signal<string | null>(null);
  readonly locationOptions = signal<LocationDto[]>([]);

  // The threshold is the chattiest of these four (a text field), so it is
  // debounced the same way nameControl's value reaches ReagentsStore.setName
  // — everything else here (the unit select, the two datepickers) is a
  // discrete choice and applies immediately.
  private readonly minConsumedInput$ = new Subject<void>();

  constructor() {
    // The store itself debounces the name filter (see ReagentsStore), so no
    // debounceTime is needed here — only avoid re-issuing the same value.
    this.nameControl.valueChanges
      .pipe(distinctUntilChanged(), takeUntilDestroyed())
      .subscribe((value) => this.store.setName(value));

    this.casNumberControl.valueChanges
      .pipe(distinctUntilChanged(), takeUntilDestroyed())
      .subscribe((value) => this.store.setCasNumber(value));

    this.locationControl.valueChanges
      .pipe(distinctUntilChanged(), takeUntilDestroyed())
      .subscribe((value) => this.store.setLocationId(value));

    // The unit is required only while a threshold is present — the same rule
    // the API enforces (a threshold without a unit is rejected), applied
    // client-side so the user learns before a round trip rather than from a
    // 400 they cannot see.
    this.filtersForm.controls.minConsumed.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe((minConsumed) => {
        const unitControl = this.filtersForm.controls.minConsumedUnit;
        unitControl.setValidators(minConsumed ? Validators.required : []);
        unitControl.updateValueAndValidity({ emitEvent: false });
        this.minConsumedInput$.next();
      });
    this.minConsumedInput$
      .pipe(debounceTime(300), takeUntilDestroyed())
      .subscribe(() => this.tryApplyConsumptionFilter());

    // The unit select and the two datepickers are discrete choices, not
    // typing, so they apply straight away — no debounce needed.
    this.filtersForm.controls.minConsumedUnit.valueChanges
      .pipe(distinctUntilChanged(), takeUntilDestroyed())
      .subscribe(() => this.tryApplyConsumptionFilter());
    this.filtersForm.controls.consumedFrom.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.tryApplyConsumptionFilter());
    this.filtersForm.controls.consumedTo.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.tryApplyConsumptionFilter());

    effect(() => {
      if (this.store.error()) {
        this.snackBar.open(COMMON_ES.unexpectedError, COMMON_ES.accept, { duration: 5000 });
      }
    });

    effect(() => {
      if (this.batchesStore.error()) {
        this.snackBar.open(COMMON_ES.unexpectedError, COMMON_ES.accept, { duration: 5000 });
      }
    });
  }

  ngOnInit(): void {
    // ReagentsStore is providedIn: 'root', so its filters survive this
    // component being destroyed and recreated (navigating away and back).
    // These controls are constructed fresh every time, so without this they
    // would show empty next to a table the store is still filtering —
    // seed them from the store so what the user sees matches what is
    // actually being applied, with { emitEvent: false } so this doesn't
    // loop back into another setFilters/reload.
    this.nameControl.setValue(this.store.nameFilter(), { emitEvent: false });
    this.casNumberControl.setValue(this.store.casNumberFilter(), { emitEvent: false });
    this.locationControl.setValue(this.store.locationIdFilter(), { emitEvent: false });
    this.filtersForm.controls.minConsumed.setValue(this.store.minConsumedFilter(), {
      emitEvent: false,
    });
    this.filtersForm.controls.minConsumedUnit.setValue(this.store.minConsumedUnitFilter(), {
      emitEvent: false,
    });
    this.filtersForm.controls.consumedFrom.setValue(this.store.consumedFromFilter(), {
      emitEvent: false,
    });
    this.filtersForm.controls.consumedTo.setValue(this.store.consumedToFilter(), {
      emitEvent: false,
    });
    if (this.store.minConsumedFilter()) {
      this.filtersForm.controls.minConsumedUnit.setValidators(Validators.required);
    }

    this.store.reload();
    // listActive() bypasses LocationsStore's own paginated view state: a
    // setPageSize() call here previously leaked into /ubicaciones, since
    // that store is shared (providedIn: 'root').
    this.locationsStore.listActive().subscribe((locations) => this.locationOptions.set(locations));
  }

  // Threshold present + unit missing: surface unitRequired and do not call
  // the store — the user would otherwise get a 400 from an endpoint they
  // cannot see. Threshold cleared: apply anyway, since setConsumptionFilter
  // already drops the unit once the threshold is empty, so this is exactly
  // how a cleared filter is supposed to reach the store. Not a manual
  // "Aplicar" step: reintroducing one would let the form show an empty
  // threshold next to a table still filtered on a stale one, which is the
  // exact stale-filter-panel defect this screen already fixed once.
  private tryApplyConsumptionFilter(): void {
    const unitControl = this.filtersForm.controls.minConsumedUnit;
    if (unitControl.invalid) {
      unitControl.markAsTouched();
      return;
    }
    const { minConsumed, minConsumedUnit, consumedFrom, consumedTo } =
      this.filtersForm.getRawValue();
    this.store.setConsumptionFilter(minConsumed, minConsumedUnit, consumedFrom, consumedTo);
  }

  onPage(event: PageEvent): void {
    if (event.pageSize !== this.store.pageSize()) {
      this.store.setPageSize(event.pageSize);
      return;
    }
    this.store.setPage(event.pageIndex + 1);
  }

  toggleBatches(reagent: ReagentDto): void {
    if (this.expandedId() === reagent.id) {
      this.expandedId.set(null);
      return;
    }
    this.expandedId.set(reagent.id);
    this.batchesStore.setReagentId(reagent.id);
  }

  // Pure string formatting — never a numeric parse. A Decimal(12,4) round
  // trips through JSON as a string precisely because it does not survive
  // JavaScript's number type, so trimming trailing zeros must stay textual.
  formatQuantity(value: string): string {
    return value.replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '');
  }

  unitAbbreviation(unit: Unit): string {
    return this.text.unitAbbreviations[unit];
  }

  // Both sides are normalized to a UTC calendar day (midnight), not compared
  // as raw instants: batch.expirationDate is a date-only value stored at UTC
  // midnight, and comparing it against Date.now() (an instant) flipped a lot
  // to "expired" the moment UTC midnight of its expiration day arrived —
  // 7pm the previous calendar day at UTC-5 — instead of only after that
  // whole day had elapsed. Comparing day-to-day makes the result independent
  // of what time of day "now" happens to be.
  private static readonly MS_PER_DAY = 24 * 60 * 60 * 1000;

  private todayUtcMidnight(): number {
    const now = new Date();
    return Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  }

  expiryStatus(batch: ReagentBatchDto): ExpiryStatus {
    if (!batch.expirationDate) {
      return 'ok';
    }
    const expirationDate = new Date(batch.expirationDate);
    const expiration = Date.UTC(
      expirationDate.getUTCFullYear(),
      expirationDate.getUTCMonth(),
      expirationDate.getUTCDate(),
    );
    const today = this.todayUtcMidnight();
    if (expiration < today) {
      return 'expired';
    }
    const warningThreshold = today + this.text.expiryWarningDays * ReagentsComponent.MS_PER_DAY;
    return expiration <= warningThreshold ? 'warning' : 'ok';
  }

  openReagentForm(reagent?: ReagentDto): void {
    this.dialog
      .open(ReagentFormDialog, { width: '30rem', data: { reagent } })
      .afterClosed()
      .subscribe((request: CreateReagentRequest | UpdateReagentRequest | undefined) => {
        if (!request) {
          return;
        }
        const result = reagent
          ? this.store.update(reagent.id, request)
          : this.store.create(request as CreateReagentRequest);
        result.subscribe({
          error: () =>
            this.snackBar.open(COMMON_ES.unexpectedError, COMMON_ES.accept, { duration: 5000 }),
        });
      });
  }

  openBatchForm(reagent: ReagentDto): void {
    this.dialog
      .open(BatchFormDialog, { width: '30rem', data: { reagentId: reagent.id } })
      .afterClosed()
      .subscribe((request: CreateBatchRequest | undefined) => {
        if (!request) {
          return;
        }
        this.batchesStore.create(reagent.id, request).subscribe({
          error: (error: HttpErrorResponse) => {
            const message =
              error.error?.code === 'UNIQUE_CONSTRAINT'
                ? this.text.batchForm.lotTaken
                : COMMON_ES.unexpectedError;
            this.snackBar.open(message, COMMON_ES.accept, { duration: 5000 });
          },
          complete: () => this.store.reload(),
        });
      });
  }

  deactivate(id: string): void {
    if (!confirm(this.text.confirmDeactivate)) {
      return;
    }
    this.store.deactivate(id).subscribe({
      error: () =>
        this.snackBar.open(COMMON_ES.unexpectedError, COMMON_ES.accept, { duration: 5000 }),
    });
  }
}
