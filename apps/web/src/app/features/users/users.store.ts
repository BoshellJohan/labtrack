import { Injectable, computed } from '@angular/core';
import { Observable, tap } from 'rxjs';
import { CreateUserRequest, UserDto } from '@labtrack/shared';
import { PaginatedStore } from '../../shared/paginated-store';

interface UsersFilters {
  search?: string;
}

@Injectable({ providedIn: 'root' })
export class UsersStore extends PaginatedStore<UserDto, UsersFilters> {
  protected readonly path = '/users';

  readonly users = this.items;
  readonly search = computed(() => this.filters().search ?? '');

  // Changing the search resets to the first page: keeping the current page
  // would leave the user staring at an empty page of a smaller result set.
  setSearch(search: string): void {
    this.setFilters({ search: search || undefined });
  }

  create(request: CreateUserRequest): Observable<UserDto> {
    return this.api.post<UserDto>('/users', request).pipe(tap(() => this.reload()));
  }

  deactivate(id: string): Observable<UserDto> {
    return this.api
      .patch<UserDto>(`/users/${id}/deactivate`, {})
      .pipe(tap(() => this.reload()));
  }
}
