import { MatPaginatorIntl } from '@angular/material/paginator';
import { COMMON_ES } from './es';

// MatPaginatorIntl's defaults are English-only; this mirrors its own
// getRangeLabel implementation but in Spanish. It is provided by
// UsersComponent, the only view with a paginator today; promote it to
// app.config.ts when a second one needs the same labels.
export function createSpanishPaginatorIntl(): MatPaginatorIntl {
  const intl = new MatPaginatorIntl();
  const { paginator } = COMMON_ES;

  intl.itemsPerPageLabel = paginator.itemsPerPage;
  intl.nextPageLabel = paginator.nextPage;
  intl.previousPageLabel = paginator.previousPage;
  intl.firstPageLabel = paginator.firstPage;
  intl.lastPageLabel = paginator.lastPage;
  intl.getRangeLabel = (page: number, pageSize: number, length: number): string => {
    if (length === 0 || pageSize === 0) {
      return `0 ${paginator.rangeSeparator} ${length}`;
    }
    const startIndex = page * pageSize;
    const endIndex = Math.min(startIndex + pageSize, length);
    return `${startIndex + 1} – ${endIndex} ${paginator.rangeSeparator} ${length}`;
  };

  return intl;
}
