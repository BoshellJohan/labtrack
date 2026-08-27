import { Injectable, computed } from '@angular/core';
import { Observable, Subject, debounceTime, tap } from 'rxjs';
import { CreateReagentRequest, ReagentDto, UpdateReagentRequest } from '@labtrack/shared';
import { PaginatedStore } from '../../shared/paginated-store';

interface ReagentsFilters {
  name?: string;
  casNumber?: string;
  locationId?: string;
}

@Injectable({ providedIn: 'root' })
export class ReagentsStore extends PaginatedStore<ReagentDto, ReagentsFilters> {
  protected readonly path = '/reagents';

  readonly reagents = this.items;
  readonly nameFilter = computed(() => this.filters().name ?? '');
  readonly casNumberFilter = computed(() => this.filters().casNumber ?? '');
  readonly locationIdFilter = computed(() => this.filters().locationId ?? '');

  // Typing in the name field is the chattiest of the three filters, so it is
  // debounced here rather than in the component: this lets the store's own
  // spec prove the delay without depending on a component test harness.
  private readonly nameInput$ = new Subject<string>();

  constructor() {
    super();
    this.nameInput$.pipe(debounceTime(300)).subscribe((name) => {
      this.applyFilters({ name: name || undefined });
    });
  }

  setName(name: string): void {
    this.nameInput$.next(name);
  }

  // CAS number and location are lower-frequency inputs (paste or a select),
  // so they apply immediately.
  setCasNumber(casNumber: string): void {
    this.applyFilters({ casNumber: casNumber || undefined });
  }

  setLocationId(locationId: string): void {
    this.applyFilters({ locationId: locationId || undefined });
  }

  // setFilters on PaginatedStore replaces the whole filter object rather than
  // merging it: every call here must fold the new value into the *current*
  // filters (read fresh, not captured in a closure) so the other two survive.
  private applyFilters(patch: Partial<ReagentsFilters>): void {
    this.setFilters({ ...this.filters(), ...patch });
  }

  create(request: CreateReagentRequest): Observable<ReagentDto> {
    return this.api.post<ReagentDto>('/reagents', request).pipe(tap(() => this.reload()));
  }

  update(id: string, request: UpdateReagentRequest): Observable<ReagentDto> {
    return this.api.patch<ReagentDto>(`/reagents/${id}`, request).pipe(tap(() => this.reload()));
  }

  deactivate(id: string): Observable<ReagentDto> {
    return this.api
      .patch<ReagentDto>(`/reagents/${id}/deactivate`, {})
      .pipe(tap(() => this.reload()));
  }
}
