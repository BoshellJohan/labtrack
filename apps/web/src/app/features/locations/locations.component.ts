import { ChangeDetectionStrategy, Component, OnInit, effect, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { HttpErrorResponse } from '@angular/common/http';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatPaginatorIntl, MatPaginatorModule, PageEvent } from '@angular/material/paginator';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTableModule } from '@angular/material/table';
import { debounceTime, distinctUntilChanged } from 'rxjs';
import { CreateLocationRequest, LocationDto, UpdateLocationRequest } from '@labtrack/shared';
import { LocationsStore } from './locations.store';
import { LocationFormDialog } from './location-form.dialog';
import { LOCATIONS_ES } from './i18n.es';
import { COMMON_ES } from '../../shared/i18n/es';
import { createSpanishPaginatorIntl } from '../../shared/i18n/spanish-paginator-intl';

@Component({
  selector: 'lt-locations',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    MatTableModule,
    MatPaginatorModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatDialogModule,
    MatProgressBarModule,
  ],
  // Scoped here rather than app-wide: <mat-paginator> only appears in this
  // component's view today, and MatPaginatorModule is already part of this
  // lazy chunk, so this costs nothing in the eager bundle. Promote it to
  // app.config.ts if a second paginator ever needs the same labels.
  providers: [{ provide: MatPaginatorIntl, useFactory: createSpanishPaginatorIntl }],
  template: `
    <section class="page">
      <header>
        <h1>{{ text.title }}</h1>
        <button mat-flat-button color="primary" (click)="openForm()">{{ text.newLocation }}</button>
      </header>

      <mat-form-field appearance="outline" class="search">
        <mat-label>{{ text.searchPlaceholder }}</mat-label>
        <input matInput [formControl]="searchControl" />
      </mat-form-field>

      @if (store.loading()) {
        <mat-progress-bar mode="indeterminate" />
      }

      <table mat-table [dataSource]="store.locations()">
        <ng-container matColumnDef="name">
          <th mat-header-cell *matHeaderCellDef>{{ text.columns.name }}</th>
          <td mat-cell *matCellDef="let location">{{ location.name }}</td>
        </ng-container>

        <ng-container matColumnDef="description">
          <th mat-header-cell *matHeaderCellDef>{{ text.columns.description }}</th>
          <td mat-cell *matCellDef="let location">{{ location.description }}</td>
        </ng-container>

        <ng-container matColumnDef="status">
          <th mat-header-cell *matHeaderCellDef>{{ text.columns.status }}</th>
          <td mat-cell *matCellDef="let location">
            {{ location.active ? text.status.active : text.status.inactive }}
          </td>
        </ng-container>

        <ng-container matColumnDef="actions">
          <th mat-header-cell *matHeaderCellDef>{{ text.columns.actions }}</th>
          <td mat-cell *matCellDef="let location">
            <button mat-button (click)="openForm(location)">{{ text.edit }}</button>
            @if (location.active) {
              <button mat-button color="warn" (click)="deactivate(location.id)">
                {{ text.deactivate }}
              </button>
            }
          </td>
        </ng-container>

        <tr mat-header-row *matHeaderRowDef="columns"></tr>
        <tr mat-row *matRowDef="let row; columns: columns"></tr>
      </table>

      @if (!store.loading() && store.locations().length === 0) {
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
    .search { max-width: 24rem; }
    table { width: 100%; }
    .empty { color: var(--mat-sys-on-surface-variant); }
  `,
})
export class LocationsComponent implements OnInit {
  readonly store = inject(LocationsStore);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);

  readonly text = LOCATIONS_ES;
  readonly columns = ['name', 'description', 'status', 'actions'];
  readonly searchControl = new FormControl('', { nonNullable: true });

  constructor() {
    // The debounce avoids one request per keystroke while typing.
    this.searchControl.valueChanges
      .pipe(debounceTime(300), distinctUntilChanged(), takeUntilDestroyed())
      .subscribe((term) => this.store.setSearch(term));

    // reload() is called internally by the store (ngOnInit, setPage,
    // setSearch) rather than returned as an Observable, so a failed load is
    // surfaced through this signal instead of a subscribe-time error
    // callback — kept consistent with create()/update()/deactivate() by
    // reusing the same snackbar treatment.
    effect(() => {
      if (this.store.error()) {
        this.snackBar.open(COMMON_ES.unexpectedError, COMMON_ES.accept, { duration: 5000 });
      }
    });
  }

  ngOnInit(): void {
    // LocationsStore is providedIn: 'root', so its filters survive this
    // component being destroyed and recreated (navigating away and back).
    // The control is constructed fresh every time, so without this it would
    // show empty next to a table the store is still filtering — seed it
    // from the store so what the user sees matches what is actually being
    // applied, with { emitEvent: false } so this doesn't loop back into
    // another setSearch/reload.
    this.searchControl.setValue(this.store.search(), { emitEvent: false });
    this.store.reload();
  }

  onPage(event: PageEvent): void {
    // A page-size change also carries a pageIndex, but setPageSize resets to
    // the first page, so only one of the two is applied per event.
    if (event.pageSize !== this.store.pageSize()) {
      this.store.setPageSize(event.pageSize);
      return;
    }
    this.store.setPage(event.pageIndex + 1);
  }

  openForm(location?: LocationDto): void {
    this.dialog
      .open(LocationFormDialog, { width: '28rem', data: { location } })
      .afterClosed()
      .subscribe((request: CreateLocationRequest | UpdateLocationRequest | undefined) => {
        if (!request) {
          return;
        }
        const result = location
          ? this.store.update(location.id, request)
          : this.store.create(request as CreateLocationRequest);
        result.subscribe({
          error: (error: HttpErrorResponse) => {
            const message =
              error.error?.code === 'UNIQUE_CONSTRAINT'
                ? this.text.form.nameTaken
                : COMMON_ES.unexpectedError;
            this.snackBar.open(message, COMMON_ES.accept, { duration: 5000 });
          },
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
