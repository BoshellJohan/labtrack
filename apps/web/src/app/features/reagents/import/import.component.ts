import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RowIssue, RowVerdict, Unit } from '@labtrack/shared';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTableModule } from '@angular/material/table';
import { ImportStore } from './import.store';
import { IMPORT_ES } from './i18n.es';
import { REAGENTS_ES } from '../i18n.es';

// The last screen before an import writes anything. Its whole reason to
// exist is the create/reuse column: reagent identity is name + CAS, nothing
// in the database enforces uniqueness on either, and a typo produces a
// near-duplicate reagent rather than an error. Nothing here re-parses the
// file — the rows sent on confirm are exactly the ones this preview showed.
@Component({
  selector: 'lt-import',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButtonModule, MatCardModule, MatProgressBarModule, MatTableModule],
  template: `
    <section class="page">
      <mat-card class="card">
        <h1>{{ text.title }}</h1>
        <p>{{ text.explanation }}</p>

        <div class="upload">
          <input #fileInput type="file" hidden (change)="onFileInputChange($event)" />
          <button mat-flat-button color="primary" (click)="fileInput.click()">
            {{ text.chooseFile }}
          </button>
        </div>

        @if (store.loadingPreview()) {
          <mat-progress-bar mode="indeterminate" />
        }

        @if (store.previewError()) {
          <p class="error">{{ text.previewFailed }}</p>
        }

        @if (store.confirmError()) {
          <p class="error">{{ text.confirmFailed }}</p>
        }

        @if (store.confirmed(); as confirmed) {
          <p class="confirmed">
            {{ text.confirmed(confirmed.reagentsCreated, confirmed.batchesCreated) }}
          </p>
        }

        @if (store.preview(); as preview) {
          <p class="summary">
            {{
              text.summary(
                preview.summary.reagentsToCreate,
                preview.summary.reagentsToReuse,
                preview.summary.totalRows - preview.summary.invalidRows
              )
            }}
          </p>

          @if (preview.summary.invalidRows > 0) {
            <p class="invalid">{{ text.invalidRows(preview.summary.invalidRows) }}</p>
          }

          <table mat-table [dataSource]="preview.verdicts">
            <ng-container matColumnDef="row">
              <th mat-header-cell *matHeaderCellDef>{{ text.columns.row }}</th>
              <td mat-cell *matCellDef="let verdict">{{ verdict.row.rowNumber }}</td>
            </ng-container>

            <ng-container matColumnDef="reagent">
              <th mat-header-cell *matHeaderCellDef>{{ text.columns.reagent }}</th>
              <td mat-cell *matCellDef="let verdict">{{ verdict.row.reagentName }}</td>
            </ng-container>

            <ng-container matColumnDef="lot">
              <th mat-header-cell *matHeaderCellDef>{{ text.columns.lot }}</th>
              <td mat-cell *matCellDef="let verdict">{{ verdict.row.lotNumber }}</td>
            </ng-container>

            <ng-container matColumnDef="quantity">
              <th mat-header-cell *matHeaderCellDef>{{ text.columns.quantity }}</th>
              <td mat-cell *matCellDef="let verdict">{{ verdict.row.quantity }}</td>
            </ng-container>

            <ng-container matColumnDef="unit">
              <th mat-header-cell *matHeaderCellDef>{{ text.columns.unit }}</th>
              <td mat-cell *matCellDef="let verdict">{{ unitLabel(verdict) }}</td>
            </ng-container>

            <ng-container matColumnDef="action">
              <th mat-header-cell *matHeaderCellDef>{{ text.columns.action }}</th>
              <td mat-cell *matCellDef="let verdict">{{ actionLabel(verdict) }}</td>
            </ng-container>

            <ng-container matColumnDef="issues">
              <th mat-header-cell *matHeaderCellDef>{{ text.columns.issues }}</th>
              <td mat-cell *matCellDef="let verdict">
                @for (issue of verdict.issues; track $index) {
                  <div>{{ renderIssue(issue) }}</div>
                }
              </td>
            </ng-container>

            <tr mat-header-row *matHeaderRowDef="columns"></tr>
            <tr mat-row *matRowDef="let row; columns: columns"></tr>
          </table>

          <button
            mat-flat-button
            color="primary"
            [disabled]="!canConfirm()"
            (click)="confirm()"
          >
            {{ text.confirm }}
          </button>
        }
      </mat-card>
    </section>
  `,
  styles: `
    .page { padding: 1.5rem; }
    .card { max-width: 60rem; margin: 0 auto; padding: 2rem; display: flex; flex-direction: column; gap: 1rem; }
    .upload { display: flex; }
    table { width: 100%; }
    .error, .invalid { color: #b3261e; }
    .confirmed { color: #146c2e; }
  `,
})
export class ImportComponent {
  readonly store = inject(ImportStore);
  readonly text = IMPORT_ES;
  readonly columns = ['row', 'reagent', 'lot', 'quantity', 'unit', 'action', 'issues'];

  onFileInputChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (file) {
      this.onFileSelected(file);
    }
  }

  onFileSelected(file: File): void {
    this.store.uploadFile(file);
  }

  canConfirm(): boolean {
    return this.store.canConfirm();
  }

  confirm(): void {
    this.store.confirm();
  }

  // The quantity alone is ambiguous — a bare "5" tells nobody whether it is
  // millilitres or litres (spec §4.1). Falls back to the sheet's raw unit
  // text when the server could not resolve it (an invalid-unit row), so the
  // cell still shows what the user typed rather than going blank.
  unitLabel(verdict: RowVerdict): string {
    const unit = verdict.unit as Unit | null;
    return unit ? REAGENTS_ES.unitAbbreviations[unit] : verdict.row.unit;
  }

  actionLabel(verdict: RowVerdict): string {
    if (!verdict.reagent) {
      return '';
    }
    return verdict.reagent.action === 'create'
      ? this.text.willCreate
      : `${this.text.willReuse}: ${verdict.reagent.existingName}`;
  }

  renderIssue(issue: RowIssue): string {
    const renderer = this.text.issues[issue.code] as (params?: unknown) => string;
    return renderer(issue.params);
  }
}
