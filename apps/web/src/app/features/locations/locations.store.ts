import { Injectable, computed } from '@angular/core';
import { EMPTY, Observable, expand, reduce, tap } from 'rxjs';
import {
  CreateLocationRequest,
  LocationDto,
  PaginatedResponse,
  UpdateLocationRequest,
} from '@labtrack/shared';
import { PaginatedStore } from '../../shared/paginated-store';

interface LocationsFilters {
  search?: string;
}

// providedIn: 'root' (not just this feature's route) because the reagents
// screen's batch form injects this store directly for the location picker,
// without going through /ubicaciones.
@Injectable({ providedIn: 'root' })
export class LocationsStore extends PaginatedStore<LocationDto, LocationsFilters> {
  protected readonly path = '/locations';

  readonly locations = this.items;
  readonly search = computed(() => this.filters().search ?? '');

  // Changing the search resets to the first page: keeping the current page
  // would leave the user staring at an empty page of a smaller result set.
  setSearch(search: string): void {
    this.setFilters({ search: search || undefined });
  }

  create(request: CreateLocationRequest): Observable<LocationDto> {
    return this.api.post<LocationDto>('/locations', request).pipe(tap(() => this.reload()));
  }

  update(id: string, request: UpdateLocationRequest): Observable<LocationDto> {
    return this.api
      .patch<LocationDto>(`/locations/${id}`, request)
      .pipe(tap(() => this.reload()));
  }

  deactivate(id: string): Observable<LocationDto> {
    return this.api
      .patch<LocationDto>(`/locations/${id}/deactivate`, {})
      .pipe(tap(() => this.reload()));
  }

  // For a picker (a filter dropdown, or the batch form's location select)
  // that wants every active location. Deliberately bypasses this store's own
  // paginated view state (page/pageSize/filters signals): a picker calling
  // setPageSize() here previously leaked into whatever component was
  // currently showing /ubicaciones, since this store is providedIn: 'root'
  // and shared by both screens. 100 is the API's own page-size ceiling
  // (PaginationQueryDto @Max(100)).
  //
  // The picker needs every active location, and the API caps a page at 100
  // (spec §5.3). Follow the pagination rather than truncating: a laboratory
  // with more than 100 locations would otherwise get a picker that silently
  // cannot reach the rest.
  listActive(): Observable<LocationDto[]> {
    return this.api.getPage<LocationDto>(this.path, { page: 1, pageSize: 100 }).pipe(
      expand((response) =>
        response.page < response.totalPages
          ? this.api.getPage<LocationDto>(this.path, { page: response.page + 1, pageSize: 100 })
          : EMPTY,
      ),
      reduce<PaginatedResponse<LocationDto>, LocationDto[]>(
        (acc, response) => acc.concat(response.data),
        [],
      ),
    );
  }
}
