import { Injectable, computed, inject, signal } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable, finalize, tap } from 'rxjs';
import { CreateUserRequest, PaginatedResponse, UserDto } from '@labtrack/shared';
import { API_URL } from '../../core/api/api.config';

interface UsersState {
  page: number;
  pageSize: number;
  search: string;
}

@Injectable({ providedIn: 'root' })
export class UsersStore {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = inject(API_URL);

  private readonly state = signal<UsersState>({ page: 1, pageSize: 20, search: '' });
  private readonly usersSignal = signal<UserDto[]>([]);
  private readonly totalSignal = signal(0);
  private readonly loadingSignal = signal(false);

  readonly users = this.usersSignal.asReadonly();
  readonly total = this.totalSignal.asReadonly();
  readonly loading = this.loadingSignal.asReadonly();
  readonly page = computed(() => this.state().page);
  readonly pageSize = computed(() => this.state().pageSize);
  readonly search = computed(() => this.state().search);

  setPage(page: number): void {
    this.state.update((current) => ({ ...current, page }));
    this.reload();
  }

  // Changing the search resets to the first page: keeping the current page
  // would leave the user staring at an empty page of a smaller result set.
  setSearch(search: string): void {
    this.state.update((current) => ({ ...current, search, page: 1 }));
    this.reload();
  }

  reload(): void {
    const { page, pageSize, search } = this.state();
    let params = new HttpParams().set('page', page).set('pageSize', pageSize);
    if (search) {
      params = params.set('search', search);
    }

    this.loadingSignal.set(true);
    this.http
      .get<PaginatedResponse<UserDto>>(`${this.apiUrl}/users`, { params })
      .pipe(finalize(() => this.loadingSignal.set(false)))
      .subscribe((response) => {
        this.usersSignal.set(response.data);
        this.totalSignal.set(response.total);
      });
  }

  create(request: CreateUserRequest): Observable<UserDto> {
    return this.http
      .post<UserDto>(`${this.apiUrl}/users`, request)
      .pipe(tap(() => this.reload()));
  }

  deactivate(id: string): Observable<UserDto> {
    return this.http
      .patch<UserDto>(`${this.apiUrl}/users/${id}/deactivate`, {})
      .pipe(tap(() => this.reload()));
  }
}
