import { Injectable, signal } from '@angular/core';
import { Observable, tap } from 'rxjs';
import { CreateBatchRequest, ReagentBatchDto } from '@labtrack/shared';
import { PaginatedStore } from '../../shared/paginated-store';

// Not providedIn: 'root' — a fresh instance is provided per row/dialog (see
// ReagentsComponent), one reagent's batches at a time, via setReagentId().
@Injectable()
export class BatchesStore extends PaginatedStore<ReagentBatchDto> {
  private readonly reagentIdSignal = signal<string | null>(null);

  // Implemented as a getter (not a plain field) because the sub-resource path
  // depends on which reagent is currently selected; PaginatedStore only reads
  // `this.path` at request time, so this stays correct across setReagentId()
  // calls on the same instance.
  protected get path(): string {
    const reagentId = this.reagentIdSignal();
    if (!reagentId) {
      throw new Error('BatchesStore: reagentId must be set before loading');
    }
    return `/reagents/${reagentId}/batches`;
  }

  readonly batches = this.items;

  setReagentId(reagentId: string): void {
    this.reagentIdSignal.set(reagentId);
    this.reload();
  }

  create(reagentId: string, request: CreateBatchRequest): Observable<ReagentBatchDto> {
    return this.api
      .post<ReagentBatchDto>(`/reagents/${reagentId}/batches`, request)
      .pipe(tap(() => this.reload()));
  }
}
