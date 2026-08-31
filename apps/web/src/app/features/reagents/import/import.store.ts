import { Injectable, computed, inject, signal } from '@angular/core';
import { ImportPreview } from '@labtrack/shared';
import { ApiService } from '../../../core/api/api.service';

interface ConfirmResult {
  reagentsCreated: number;
  batchesCreated: number;
}

// Holds the last preview and posts both requests. The preview's rows are
// kept verbatim and re-sent unchanged on confirm — re-reading the file at
// confirm time would let a swapped file be imported without anyone seeing
// it, which is the whole reason this screen exists.
@Injectable({ providedIn: 'root' })
export class ImportStore {
  private readonly api = inject(ApiService);

  private readonly _preview = signal<ImportPreview | null>(null);
  private readonly _loadingPreview = signal(false);
  private readonly _confirming = signal(false);
  private readonly _previewError = signal(false);
  private readonly _confirmError = signal(false);
  private readonly _confirmed = signal<ConfirmResult | null>(null);

  readonly preview = this._preview.asReadonly();
  readonly loadingPreview = this._loadingPreview.asReadonly();
  readonly confirming = this._confirming.asReadonly();
  readonly previewError = this._previewError.asReadonly();
  readonly confirmError = this._confirmError.asReadonly();
  readonly confirmed = this._confirmed.asReadonly();

  // Blocked while any row is invalid: the API enforces the all-or-nothing
  // rule too, but a user should not be able to send a request that cannot
  // possibly succeed.
  readonly canConfirm = computed(() => {
    const preview = this._preview();
    return !!preview && preview.summary.invalidRows === 0 && !this._confirming();
  });

  uploadFile(file: File): void {
    this._loadingPreview.set(true);
    this._previewError.set(false);
    this._confirmError.set(false);
    this._confirmed.set(null);
    this._preview.set(null);

    const formData = new FormData();
    formData.append('file', file);

    this.api.postFormData<ImportPreview>('/reagents/import/preview', formData).subscribe({
      next: (preview) => {
        this._preview.set(preview);
        this._loadingPreview.set(false);
      },
      error: () => {
        this._previewError.set(true);
        this._loadingPreview.set(false);
      },
    });
  }

  confirm(): void {
    const preview = this._preview();
    if (!preview || preview.summary.invalidRows > 0) {
      return;
    }

    this._confirming.set(true);
    this._confirmError.set(false);

    // Exactly the rows the preview returned — never re-parsed from the file.
    const rows = preview.verdicts.map((verdict) => verdict.row);

    this.api
      .post<ConfirmResult>('/reagents/import/confirm', { rows })
      .subscribe({
        next: (result) => {
          this._confirmed.set(result);
          this._confirming.set(false);
          this._preview.set(null);
        },
        error: () => {
          this._confirmError.set(true);
          this._confirming.set(false);
        },
      });
  }
}
