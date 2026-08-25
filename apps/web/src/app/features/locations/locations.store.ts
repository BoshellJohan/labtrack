import { Injectable, computed } from '@angular/core';
import { Observable, tap } from 'rxjs';
import { CreateLocationRequest, LocationDto, UpdateLocationRequest } from '@labtrack/shared';
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
}
