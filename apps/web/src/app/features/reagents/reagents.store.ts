import { Injectable, computed } from '@angular/core';
import { Observable, Subject, debounceTime, tap } from 'rxjs';
import { CreateReagentRequest, ReagentDto, UpdateReagentRequest } from '@labtrack/shared';
import { PaginatedStore } from '../../shared/paginated-store';
import { fromUtcMidnightIso, toUtcMidnightIso } from '../../shared/date/utc-midnight';

// Every value primitive: the store's serialisation boundary is cast, so a
// Date here would compile and then fail at runtime.
interface ReagentsFilters {
  name?: string;
  casNumber?: string;
  locationId?: string;
  minConsumed?: string;
  minConsumedUnit?: string;
  consumedFrom?: string;
  consumedTo?: string;
}

@Injectable({ providedIn: 'root' })
export class ReagentsStore extends PaginatedStore<ReagentDto, ReagentsFilters> {
  protected readonly path = '/reagents';

  readonly reagents = this.items;
  readonly nameFilter = computed(() => this.filters().name ?? '');
  readonly casNumberFilter = computed(() => this.filters().casNumber ?? '');
  readonly locationIdFilter = computed(() => this.filters().locationId ?? '');
  readonly minConsumedFilter = computed(() => this.filters().minConsumed ?? '');
  readonly minConsumedUnitFilter = computed(() => this.filters().minConsumedUnit ?? '');
  // Stored as UTC-midnight ISO strings (see ReagentsFilters above), converted
  // back to a Date for the datepicker controls that seed from them via
  // fromUtcMidnightIso, not `new Date(iso)` — see utc-midnight.ts.
  readonly consumedFromFilter = computed(() => {
    const from = this.filters().consumedFrom;
    return from ? fromUtcMidnightIso(from) : null;
  });
  readonly consumedToFilter = computed(() => {
    const to = this.filters().consumedTo;
    return to ? fromUtcMidnightIso(to) : null;
  });

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

  // The threshold and the unit travel together or not at all: a threshold
  // without a unit is rejected by the API (§6.2 as amended, since a reagent
  // may hold millilitres and litres at once), and a unit without a threshold
  // filters nothing while suggesting to the user that it does.
  setConsumptionFilter(
    minConsumed: string,
    unit: string,
    from: Date | null,
    to: Date | null,
  ): void {
    const threshold = minConsumed || undefined;
    this.applyFilters({
      minConsumed: threshold,
      minConsumedUnit: threshold ? unit || undefined : undefined,
      consumedFrom: from ? toUtcMidnightIso(from) : undefined,
      consumedTo: to ? toUtcMidnightIso(to) : undefined,
    });
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
