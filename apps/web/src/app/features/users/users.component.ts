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
import { CreateUserRequest, Role } from '@labtrack/shared';
import { UsersStore } from './users.store';
import { UserFormDialog } from './user-form.dialog';
import { USERS_ES } from './i18n.es';
import { COMMON_ES } from '../../shared/i18n/es';
import { createSpanishPaginatorIntl } from '../../shared/i18n/spanish-paginator-intl';

@Component({
  selector: 'lt-users',
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
        <button mat-flat-button color="primary" (click)="openForm()">{{ text.newUser }}</button>
      </header>

      <mat-form-field appearance="outline" class="search">
        <mat-label>{{ text.searchPlaceholder }}</mat-label>
        <input matInput [formControl]="searchControl" />
      </mat-form-field>

      @if (store.loading()) {
        <mat-progress-bar mode="indeterminate" />
      }

      <table mat-table [dataSource]="store.users()">
        <ng-container matColumnDef="username">
          <th mat-header-cell *matHeaderCellDef>{{ text.columns.username }}</th>
          <td mat-cell *matCellDef="let user">{{ user.username }}</td>
        </ng-container>

        <ng-container matColumnDef="fullName">
          <th mat-header-cell *matHeaderCellDef>{{ text.columns.fullName }}</th>
          <td mat-cell *matCellDef="let user">{{ user.fullName }}</td>
        </ng-container>

        <ng-container matColumnDef="role">
          <th mat-header-cell *matHeaderCellDef>{{ text.columns.role }}</th>
          <td mat-cell *matCellDef="let user">{{ roleLabel(user.role) }}</td>
        </ng-container>

        <ng-container matColumnDef="status">
          <th mat-header-cell *matHeaderCellDef>{{ text.columns.status }}</th>
          <td mat-cell *matCellDef="let user">
            {{ user.active ? text.status.active : text.status.inactive }}
          </td>
        </ng-container>

        <ng-container matColumnDef="actions">
          <th mat-header-cell *matHeaderCellDef>{{ text.columns.actions }}</th>
          <td mat-cell *matCellDef="let user">
            @if (user.active) {
              <button mat-button color="warn" (click)="deactivate(user.id)">
                {{ text.deactivate }}
              </button>
            }
          </td>
        </ng-container>

        <tr mat-header-row *matHeaderRowDef="columns"></tr>
        <tr mat-row *matRowDef="let row; columns: columns"></tr>
      </table>

      @if (!store.loading() && store.users().length === 0) {
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
    .empty { color: rgba(0, 0, 0, 0.6); }
  `,
})
export class UsersComponent implements OnInit {
  readonly store = inject(UsersStore);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);

  readonly text = USERS_ES;
  readonly columns = ['username', 'fullName', 'role', 'status', 'actions'];
  readonly searchControl = new FormControl('', { nonNullable: true });

  constructor() {
    // The debounce avoids one request per keystroke while typing.
    this.searchControl.valueChanges
      .pipe(debounceTime(300), distinctUntilChanged(), takeUntilDestroyed())
      .subscribe((term) => this.store.setSearch(term));

    // reload() is called internally by the store (ngOnInit, setPage,
    // setSearch) rather than returned as an Observable, so a failed load is
    // surfaced through this signal instead of a subscribe-time error
    // callback — kept consistent with create()/deactivate() by reusing the
    // same snackbar treatment.
    effect(() => {
      if (this.store.error()) {
        this.snackBar.open(COMMON_ES.unexpectedError, COMMON_ES.accept, { duration: 5000 });
      }
    });
  }

  ngOnInit(): void {
    this.store.reload();
  }

  onPage(event: PageEvent): void {
    this.store.setPage(event.pageIndex + 1);
  }

  roleLabel(role: Role): string {
    return this.text.roles[role];
  }

  openForm(): void {
    this.dialog
      .open(UserFormDialog, { width: '28rem' })
      .afterClosed()
      .subscribe((request: CreateUserRequest | undefined) => {
        if (!request) {
          return;
        }
        this.store.create(request).subscribe({
          error: (error: HttpErrorResponse) => {
            const message =
              error.error?.code === 'UNIQUE_CONSTRAINT'
                ? this.text.form.usernameTaken
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
