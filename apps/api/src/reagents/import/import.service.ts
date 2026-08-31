import { Injectable } from '@nestjs/common';
import {
  ImportPreview,
  ImportRow,
  RowIssue,
  RowVerdict,
  isUnit,
} from '@labtrack/shared';
import { PrismaService } from '../../prisma/prisma.service';
import { normalizeForSearch } from '../../common/text/normalize';
import { validateRowShape, findDuplicateLots } from './import-row';

/**
 * Resolves parsed rows against the database — locations and reagent
 * identity — and produces the preview. Never writes: this is the half of
 * the import that is safe to call as many times as the user wants to see
 * what would happen.
 */
@Injectable()
export class ImportService {
  constructor(private readonly prisma: PrismaService) {}

  async preview(rows: ImportRow[]): Promise<ImportPreview> {
    const issuesByRow = new Map<number, RowIssue[]>();
    for (const row of rows) {
      issuesByRow.set(row.rowNumber, validateRowShape(row));
    }

    const duplicateLots = findDuplicateLots(rows);
    for (const [rowNumber, otherRows] of duplicateLots) {
      issuesByRow.get(rowNumber)?.push({
        column: 'Lote',
        code: 'DUPLICATE_LOT',
        params: { otherRows: otherRows.map(String) },
      });
    }

    // One query for every distinct location name in the file.
    const locationNames = [
      ...new Set(
        rows.map((row) => row.locationName.trim()).filter((name) => name),
      ),
    ];
    const locations = locationNames.length
      ? await this.prisma.location.findMany({
          where: { name: { in: locationNames }, active: true },
          select: { id: true, name: true },
        })
      : [];
    const locationIdByName = new Map(locations.map((l) => [l.name, l.id]));

    // One query for every distinct (normalised name, CAS) pair.
    const identityPairs = new Map<string, { name: string; cas: string }>();
    for (const row of rows) {
      const name = normalizeForSearch(row.reagentName.trim());
      const cas = row.casNumber.trim();
      if (!name || !cas) {
        continue;
      }
      identityPairs.set(`${name}|${cas}`, { name, cas });
    }
    const pairs = [...identityPairs.values()];
    const existingReagents = pairs.length
      ? await this.prisma.reagent.findMany({
          where: {
            OR: pairs.map((pair) => ({
              nameNormalized: pair.name,
              casNumber: pair.cas,
            })),
          },
          select: { name: true, nameNormalized: true, casNumber: true },
        })
      : [];
    const existingByKey = new Map(
      existingReagents.map((r) => [
        `${r.nameNormalized}|${r.casNumber}`,
        r.name,
      ]),
    );

    const verdicts: RowVerdict[] = rows.map((row) => {
      const issues = issuesByRow.get(row.rowNumber) ?? [];

      const locationName = row.locationName.trim();
      const locationId = locationName
        ? (locationIdByName.get(locationName) ?? null)
        : null;
      if (locationName && locationId === null) {
        issues.push({ column: 'Ubicación', code: 'LOCATION_NOT_FOUND' });
      }

      const normalizedName = normalizeForSearch(row.reagentName.trim());
      const cas = row.casNumber.trim();
      let reagent: RowVerdict['reagent'] = null;
      if (normalizedName && cas) {
        const existingName = existingByKey.get(`${normalizedName}|${cas}`);
        reagent = existingName
          ? { action: 'reuse', existingName }
          : { action: 'create' };
      }

      const normalizedUnit = row.unit.trim().toUpperCase();
      const unit = isUnit(normalizedUnit) ? normalizedUnit : null;

      return {
        row,
        issues,
        reagent,
        unit,
        locationId,
      };
    });

    const invalidRows = verdicts.filter((v) => v.issues.length > 0).length;
    const reagentsToCreate = verdicts.filter(
      (v) => v.reagent?.action === 'create',
    ).length;
    const reagentsToReuse = verdicts.filter(
      (v) => v.reagent?.action === 'reuse',
    ).length;

    return {
      verdicts,
      summary: {
        totalRows: rows.length,
        invalidRows,
        reagentsToCreate,
        reagentsToReuse,
      },
    };
  }
}
