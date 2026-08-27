import { ChangeDetectionStrategy, Component, OnInit, effect, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormBuilder, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
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
import { distinctUntilChanged } from 'rxjs';
import { ConsumptionDto, ReagentDto, VoidConsumptionRequest } from '@labtrack/shared';
import { ConsumptionsStore } from './consumptions.store';
import { VoidConsumptionDialog } from './void-consumption.dialog';
import { CONSUMPTIONS_ES, VOID_CONSUMPTION_ES } from './i18n.es';
import { COMMON_ES } from '../../shared/i18n/es';
import { createSpanishPaginatorIntl } from '../../shared/i18n/spanish-paginator-intl';
import { AuthService } from '../../core/auth/auth.service';
import { ApiService } from '../../core/api/api.service';

@Component({
  selector: 'lt-consumptions',
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
    MatDatepickerModule,
    MatCheckboxModule,
    MatButtonModule,
    MatDialogModule,
    MatProgressBarModule,
  ],
  // Scoped here rather than app-wide: see LocationsComponent and
  // RegisterConsumptionComponent for why this costs nothing in the eager
  // bundle.
  providers: [
    { provide: MatPaginatorIntl, useFactory: createSpanishPaginatorIntl },
    provideNativeDateAdapter(),
  ],
  template: `
    <section class="page">
      <h1>{{ text.title }}</h1>

      <form class="filters" [formGroup]="filtersForm">
        <mat-form-field appearance="outline">
          <mat-label>{{ text.filters.purpose }}</mat-label>
          <input matInput formControlName="purpose" />
        </mat-form-field>

        <mat-form-field appearance="outline">
          <mat-label>{{ text.filters.reagent }}</mat-label>
          <mat-select formControlName="reagentId">
            <mat-option value="">{{ text.filters.allReagents }}</mat-option>
            @for (reagent of reagentOptions(); track reagent.id) {
              <mat-option [value]="reagent.id">{{ reagent.name }}</mat-option>
            }
          </mat-select>
        </mat-form-field>

        <mat-form-field appearance="outline">
          <mat-label>{{ text.filters.from }}</mat-label>
          <input matInput [matDatepicker]="fromPicker" formControlName="from" />
          <mat-datepicker-toggle matIconSuffix [for]="fromPicker" />
          <mat-datepicker #fromPicker />
        </mat-form-field>

        <mat-form-field appearance="outline">
          <mat-label>{{ text.filters.to }}</mat-label>
          <input matInput [matDatepicker]="toPicker" formControlName="to" />
          <mat-datepicker-toggle matIconSuffix [for]="toPicker" />
          <mat-datepicker #toPicker />
        </mat-form-field>

        <mat-checkbox formControlName="includeVoided">{{ text.filters.includeVoided }}</mat-checkbox>
      </form>

      @if (store.loading()) {
        <mat-progress-bar mode="indeterminate" />
      }

      <table mat-table [dataSource]="store.consumptions()">
        <ng-container matColumnDef="consumedAt">
          <th mat-header-cell *matHeaderCellDef>{{ text.columns.consumedAt }}</th>
          <td mat-cell *matCellDef="let consumption">
            {{ consumption.consumedAt | date: 'shortDate' : 'UTC' }}
          </td>
        </ng-container>

        <ng-container matColumnDef="reagent">
          <th mat-header-cell *matHeaderCellDef>{{ text.columns.reagent }}</th>
          <td mat-cell *matCellDef="let consumption">{{ consumption.reagentName }}</td>
        </ng-container>

        <ng-container matColumnDef="lotNumber">
          <th mat-header-cell *matHeaderCellDef>{{ text.columns.lotNumber }}</th>
          <td mat-cell *matCellDef="let consumption">{{ consumption.lotNumber }}</td>
        </ng-container>

        <ng-container matColumnDef="quantity">
          <th mat-header-cell *matHeaderCellDef>{{ text.columns.quantity }}</th>
          <td mat-cell *matCellDef="let consumption">
            {{ consumption.quantity }} {{ consumption.unit }}
          </td>
        </ng-container>

        <ng-container matColumnDef="purpose">
          <th mat-header-cell *matHeaderCellDef>{{ text.columns.purpose }}</th>
          <td mat-cell *matCellDef="let consumption">{{ consumption.purpose }}</td>
        </ng-container>

        <ng-container matColumnDef="madeBy">
          <th mat-header-cell *matHeaderCellDef>{{ text.columns.madeBy }}</th>
          <td mat-cell *matCellDef="let consumption">{{ consumption.madeByName }}</td>
        </ng-container>

        <ng-container matColumnDef="status">
          <th mat-header-cell *matHeaderCellDef>{{ text.columns.status }}</th>
          <td mat-cell *matCellDef="let consumption">
            @if (consumption.active) {
              {{ text.status.active }}
            } @else {
              {{ text.voidedBy(consumption.voidedByName, consumption.voidReason) }}
            }
          </td>
        </ng-container>

        <ng-container matColumnDef="actions">
          <th mat-header-cell *matHeaderCellDef>{{ text.columns.actions }}</th>
          <td mat-cell *matCellDef="let consumption">
            @if (auth.isAdmin() && consumption.active) {
              <button mat-button color="warn" (click)="openVoidDialog(consumption)">
                {{ text.voidAction }}
              </button>
            }
          </td>
        </ng-container>

        <tr mat-header-row *matHeaderRowDef="columns"></tr>
        <tr mat-row *matRowDef="let row; columns: columns"></tr>
      </table>

      @if (!store.loading() && store.consumptions().length === 0) {
        <p class="empty">{{ text.empty }}</p>
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
    .filters { display: flex; flex-wrap: wrap; gap: 1rem; align-items: center; }
    table { width: 100%; }
    .empty { color: rgba(0, 0, 0, 0.6); }
  `,
})
export class ConsumptionsComponent implements OnInit {
  readonly store = inject(ConsumptionsStore);
  readonly auth = inject(AuthService);
  private readonly api = inject(ApiService);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);
  private readonly fb = inject(FormBuilder);

  readonly text = CONSUMPTIONS_ES;
  readonly columns = [
    'consumedAt',
    'reagent',
    'lotNumber',
    'quantity',
    'purpose',
    'madeBy',
    'status',
    'actions',
  ];

  readonly reagentOptions = signal<ReagentDto[]>([]);

  readonly filtersForm = this.fb.nonNullable.group({
    purpose: [''],
    reagentId: [''],
    from: this.fb.control<Date | null>(null),
    to: this.fb.control<Date | null>(null),
    includeVoided: [false],
  });

  constructor() {
    effect(() => {
      if (this.store.error()) {
        this.snackBar.open(this.text.loadFailed, COMMON_ES.accept, { duration: 5000 });
      }
    });

    // takeUntilDestroyed() requires an injection context, so these are wired
    // here rather than in ngOnInit.
    this.filtersForm.controls.purpose.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe((value) => this.store.setPurpose(value));
    this.filtersForm.controls.reagentId.valueChanges
      .pipe(distinctUntilChanged(), takeUntilDestroyed())
      .subscribe((value) => this.store.setReagentId(value));
    this.filtersForm.controls.from.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.applyDateRange());
    this.filtersForm.controls.to.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.applyDateRange());
    this.filtersForm.controls.includeVoided.valueChanges
      .pipe(takeUntilDestroyed())
      .subscribe((value) => this.store.setIncludeVoided(value));
  }

  ngOnInit(): void {
    this.api.getPage<ReagentDto>('/reagents', { pageSize: 100 }).subscribe({
      next: (page) => this.reagentOptions.set(page.data),
      error: () =>
        this.snackBar.open(COMMON_ES.unexpectedError, COMMON_ES.accept, { duration: 5000 }),
    });

    this.store.reload();
  }

  private applyDateRange(): void {
    const { from, to } = this.filtersForm.getRawValue();
    this.store.setDateRange(from, to);
  }

  onPage(event: PageEvent): void {
    if (event.pageSize !== this.store.pageSize()) {
      this.store.setPageSize(event.pageSize);
      return;
    }
    this.store.setPage(event.pageIndex + 1);
  }

  openVoidDialog(consumption: ConsumptionDto): void {
    this.dialog
      .open(VoidConsumptionDialog, { width: '28rem', data: consumption })
      .afterClosed()
      .subscribe((request: VoidConsumptionRequest | undefined) => {
        if (!request) {
          return;
        }
        this.store.voidConsumption(consumption.id, request).subscribe({
          error: () =>
            this.snackBar.open(VOID_CONSUMPTION_ES.failure, COMMON_ES.accept, { duration: 5000 }),
        });
      });
  }
}
