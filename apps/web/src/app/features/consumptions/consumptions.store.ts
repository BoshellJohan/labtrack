import { Injectable, computed } from '@angular/core';
import { Observable, Subject, debounceTime, tap } from 'rxjs';
import { ConsumptionDto, VoidConsumptionRequest } from '@labtrack/shared';
import { PaginatedStore } from '../../shared/paginated-store';
import { toUtcMidnightIso } from '../../shared/date/utc-midnight';

// Every value primitive: the store's serialisation boundary is cast, so a
// Date or a nested object here would compile and fail at runtime.
interface ConsumptionsFilters {
  reagentId?: string;
  purpose?: string;
  from?: string;
  to?: string;
  madeById?: string;
  includeVoided?: boolean;
}

@Injectable({ providedIn: 'root' })
export class ConsumptionsStore extends PaginatedStore<ConsumptionDto, ConsumptionsFilters> {
  protected readonly path = '/consumptions';

  readonly consumptions = this.items;
  readonly purposeFilter = computed(() => this.filters().purpose ?? '');
  readonly reagentIdFilter = computed(() => this.filters().reagentId ?? '');
  readonly includeVoidedFilter = computed(() => this.filters().includeVoided ?? false);
  // Stored as ISO strings (see ConsumptionsFilters above), so these convert
  // back to a Date for the datepicker controls that seed from them.
  readonly fromFilter = computed(() => {
    const from = this.filters().from;
    return from ? new Date(from) : null;
  });
  readonly toFilter = computed(() => {
    const to = this.filters().to;
    return to ? new Date(to) : null;
  });

  // Typing in the purpose field is the chattiest of these filters, so it is
  // debounced here rather than in the component: this lets the store's own
  // spec prove the delay without depending on a component test harness.
  private readonly purposeInput$ = new Subject<string>();

  constructor() {
    super();
    this.purposeInput$.pipe(debounceTime(300)).subscribe((purpose) => {
      this.applyFilters({ purpose: purpose || undefined });
    });
  }

  setPurpose(purpose: string): void {
    this.purposeInput$.next(purpose);
  }

  setReagentId(reagentId: string): void {
    this.applyFilters({ reagentId: reagentId || undefined });
  }

  setMadeById(madeById: string): void {
    this.applyFilters({ madeById: madeById || undefined });
  }

  setIncludeVoided(includeVoided: boolean): void {
    this.applyFilters({ includeVoided: includeVoided || undefined });
  }

  // Converted here rather than in the component so no Date can reach the
  // filter object by another route. Uses toUtcMidnightIso rather than the
  // picker Date's own .toISOString(), which converts *local* midnight to
  // UTC and shifts the calendar day at any timezone other than UTC itself —
  // the same normalization register-consumption.component.ts applies on
  // the write side, so the two agree on which day an instant belongs to.
  setDateRange(from: Date | null, to: Date | null): void {
    this.applyFilters({
      from: from ? toUtcMidnightIso(from) : undefined,
      to: to ? toUtcMidnightIso(to) : undefined,
    });
  }

  // setFilters on PaginatedStore replaces the whole filter object rather than
  // merging it: every call here must fold the new value into the *current*
  // filters (read fresh, not captured in a closure) so the other five survive.
  private applyFilters(patch: Partial<ConsumptionsFilters>): void {
    this.setFilters({ ...this.filters(), ...patch });
  }

  voidConsumption(id: string, request: VoidConsumptionRequest): Observable<ConsumptionDto> {
    return this.api
      .patch<ConsumptionDto>(`/consumptions/${id}/void`, request)
      .pipe(tap(() => this.reload()));
  }
}
