import { computed, inject, signal } from '@angular/core';
import { Subject, catchError, of, switchMap } from 'rxjs';
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

  // Every `reload()` pushes onto this trigger instead of subscribing
  // directly; `switchMap` below cancels whatever request is still in flight
  // before starting the next one, so a slow earlier response can never
  // overwrite a faster later one. See `reload()` for why this matters.
  private readonly reload$ = new Subject<void>();

  constructor() {
    this.reload$
      .pipe(
        switchMap(() => {
          const { page, pageSize, filters } = this.state();
          // The cast below gives up compile-time checking of F's values: the
          // compiler can no longer enforce that every field of a subclass's
          // filter type stays a primitive (string | number | boolean |
          // undefined | null). A filter typed as an array, a nested object,
          // or a Date would compile here and only fail at runtime inside
          // ApiService's param serializer.
          return this.api
            .getPage<T>(this.path, { page, pageSize, ...filters } as QueryParams)
            .pipe(
              // Model both outcomes as values (instead of letting the error
              // propagate) so switchMap's cancellation of a superseded
              // request never surfaces as an unhandled error on the outer
              // subscription.
              catchError(() => of(null)),
            );
        }),
      )
      .subscribe((response) => {
        this.loadingSignal.set(false);
        if (response) {
          this.itemsSignal.set(response.data);
          this.totalSignal.set(response.total);
          this.errorSignal.set(false);
        } else {
          this.errorSignal.set(true);
        }
      });
  }

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
  // empty page of a smaller result set. Note this REPLACES the filter object
  // wholesale rather than merging it — a screen with several independent
  // filter inputs (e.g. reagents' name/casNumber/location) must pass the full
  // merged set on every call, not just the field that changed.
  setFilters(filters: F): void {
    this.state.update((current) => ({ ...current, filters, page: 1 }));
    this.reload();
  }

  // A superseded reload must not clear `loading` or stick `error` from a
  // request that a newer one has already replaced — see the `reload$`
  // pipeline in the constructor, which cancels the in-flight request via
  // `switchMap` before this one's response can land.
  reload(): void {
    this.loadingSignal.set(true);
    this.errorSignal.set(false);
    this.reload$.next();
  }
}
