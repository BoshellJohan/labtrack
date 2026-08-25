import { computed, inject, signal } from '@angular/core';
import { finalize } from 'rxjs';
import { ApiService, QueryParams } from '../core/api/api.service';

interface PaginatedState<F> {
  page: number;
  pageSize: number;
  filters: F;
}

// Shared paging, loading and error mechanics for a list screen backed by the
// API's `{data,total,page,pageSize,totalPages}` contract. Subclasses declare
// their `path` and filter shape; everything else lives here so the reagents
// and locations stores don't each re-decode the same envelope.
export abstract class PaginatedStore<T, F extends object = object> {
  protected readonly api = inject(ApiService);
  protected abstract readonly path: string;

  private readonly state = signal<PaginatedState<F>>({
    page: 1,
    pageSize: 20,
    filters: {} as F,
  });
  private readonly itemsSignal = signal<T[]>([]);
  private readonly totalSignal = signal(0);
  private readonly loadingSignal = signal(false);
  private readonly errorSignal = signal(false);

  readonly items = this.itemsSignal.asReadonly();
  readonly total = this.totalSignal.asReadonly();
  readonly loading = this.loadingSignal.asReadonly();
  // Set when the last `reload()` failed (network error, 403, 5xx — a 401 is
  // already handled globally by authInterceptor). The component renders this
  // so a failed load is never silently invisible to the user.
  readonly error = this.errorSignal.asReadonly();
  readonly page = computed(() => this.state().page);
  readonly pageSize = computed(() => this.state().pageSize);
  readonly filters = computed(() => this.state().filters);

  setPage(page: number): void {
    this.state.update((current) => ({ ...current, page }));
    this.reload();
  }

  // Changing the page size resets to the first page: the current page index
  // may not exist under the new size.
  setPageSize(pageSize: number): void {
    this.state.update((current) => ({ ...current, pageSize, page: 1 }));
    this.reload();
  }

  // Changing the filters resets to the first page for the same reason as
  // setPageSize: keeping the current page would leave the user staring at an
  // empty page of a smaller result set.
  setFilters(filters: F): void {
    this.state.update((current) => ({ ...current, filters, page: 1 }));
    this.reload();
  }

  reload(): void {
    const { page, pageSize, filters } = this.state();

    this.loadingSignal.set(true);
    this.errorSignal.set(false);
    this.api
      .getPage<T>(this.path, { page, pageSize, ...filters } as QueryParams)
      .pipe(finalize(() => this.loadingSignal.set(false)))
      .subscribe({
        next: (response) => {
          this.itemsSignal.set(response.data);
          this.totalSignal.set(response.total);
        },
        error: () => this.errorSignal.set(true),
      });
  }
}
