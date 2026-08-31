import { BadRequestException, Injectable } from '@nestjs/common';
import {
  ImportPreview,
  ImportRow,
  RowIssue,
  RowVerdict,
  isUnit,
} from '@labtrack/shared';
import { PrismaService } from '../../prisma/prisma.service';
import {
  runInTransaction,
  TransactionClient,
} from '../../common/prisma/transaction';
import { normalizeForSearch } from '../../common/text/normalize';
import { normalizeCasNumber } from '../../common/validation/cas-number';
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
      const cas = normalizeCasNumber(row.casNumber);
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
          select: {
            id: true,
            name: true,
            nameNormalized: true,
            casNumber: true,
          },
        })
      : [];
    const existingByKey = new Map(
      existingReagents.map((r) => [
        `${r.nameNormalized}|${r.casNumber}`,
        { id: r.id, name: r.name },
      ]),
    );

    // One query for every (reagentId, lotNumber) pair belonging to a row
    // whose reagent already exists in the database, checked against
    // *active* batches only. The unique index this must anticipate
    // (`(reagentId, lotNumber) WHERE active`) is partial: a deactivated
    // batch's lot number is free to reuse, so filtering on active here is
    // not an optimisation, it is what keeps this check from reporting a
    // conflict that the database itself would not.
    const lotPairs = new Map<
      string,
      { reagentId: string; lotNumber: string }
    >();
    for (const row of rows) {
      const key = `${normalizeForSearch(row.reagentName.trim())}|${normalizeCasNumber(row.casNumber)}`;
      const existing = existingByKey.get(key);
      const lotNumber = row.lotNumber.trim();
      if (existing && lotNumber) {
        lotPairs.set(`${existing.id}|${lotNumber}`, {
          reagentId: existing.id,
          lotNumber,
        });
      }
    }
    const lotPairList = [...lotPairs.values()];
    const existingBatches = lotPairList.length
      ? await this.prisma.reagentBatch.findMany({
          where: {
            active: true,
            OR: lotPairList.map((pair) => ({
              reagentId: pair.reagentId,
              lotNumber: pair.lotNumber,
            })),
          },
          select: { reagentId: true, lotNumber: true },
        })
      : [];
    const existingLotKeys = new Set(
      existingBatches.map((b) => `${b.reagentId}|${b.lotNumber}`),
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
      const cas = normalizeCasNumber(row.casNumber);
      let reagent: RowVerdict['reagent'] = null;
      if (normalizedName && cas) {
        const existing = existingByKey.get(`${normalizedName}|${cas}`);
        reagent = existing
          ? { action: 'reuse', existingName: existing.name }
          : { action: 'create' };

        const lotNumber = row.lotNumber.trim();
        if (
          existing &&
          lotNumber &&
          existingLotKeys.has(`${existing.id}|${lotNumber}`)
        ) {
          issues.push({ column: 'Lote', code: 'LOT_EXISTS' });
        }
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

  /**
   * Re-runs the same validation the preview ran, then writes.
   *
   * The re-validation is what makes the stateless design safe: the client
   * echoes back rows we handed it, and we treat them as untrusted input
   * because they are. It is the same function the preview called, so the two
   * cannot drift apart and disagree about what is acceptable.
   */
  async confirm(
    rows: ImportRow[],
    actorId: string,
  ): Promise<{ reagentsCreated: number; batchesCreated: number }> {
    const preview = await this.preview(rows);
    if (preview.summary.invalidRows > 0) {
      throw new BadRequestException({
        code: 'IMPORT_INVALID_ROWS',
        message: 'The import contains invalid rows and was not applied',
        verdicts: preview.verdicts.filter((v) => v.issues.length > 0),
      });
    }

    // Resolve every `reuse` row's reagent id in one query, before the
    // transaction opens — the same "one query for every distinct pair"
    // rule `preview` follows above, now for ids rather than names. The
    // common case for an import is a lab adding batches to reagents it
    // already has, which under the 1.000-row limit would otherwise mean up
    // to a thousand sequential lookups run *inside* a Serializable
    // transaction: each one a round trip that holds the transaction open
    // longer and widens the window in which a concurrent write aborts it.
    const reuseKeys = new Map<string, { name: string; cas: string }>();
    for (const verdict of preview.verdicts) {
      if (verdict.reagent?.action === 'reuse') {
        const name = normalizeForSearch(verdict.row.reagentName.trim());
        const cas = normalizeCasNumber(verdict.row.casNumber);
        reuseKeys.set(`${name}|${cas}`, { name, cas });
      }
    }
    const reusePairs = [...reuseKeys.values()];
    const existingReagents = reusePairs.length
      ? await this.prisma.reagent.findMany({
          where: {
            OR: reusePairs.map((pair) => ({
              nameNormalized: pair.name,
              casNumber: pair.cas,
            })),
          },
          select: { id: true, nameNormalized: true, casNumber: true },
        })
      : [];
    const existingIdByKey = new Map(
      existingReagents.map((r) => [`${r.nameNormalized}|${r.casNumber}`, r.id]),
    );

    // One transaction for the whole file. All or nothing is the contract
    // (spec §5), so a failure halfway leaves no half-loaded inventory.
    return runInTransaction(this.prisma, async (tx) => {
      let reagentsCreated = 0;
      let batchesCreated = 0;

      // Two rows in the same file may describe the same new reagent (same
      // normalised name and CAS). Without this map, each such row would
      // create its own reagent — a duplicate the preview explicitly said
      // would not happen, because it resolved both rows against the
      // database, where neither existed yet. `existingIdByKey` above
      // answers a different question — which reagent to reuse — and both
      // maps are needed.
      const createdReagentIdByKey = new Map<string, string>();

      for (const verdict of preview.verdicts) {
        const reagentId = await this.resolveReagentId(
          tx,
          verdict,
          actorId,
          existingIdByKey,
          createdReagentIdByKey,
        );
        await tx.reagentBatch.create({
          data: {
            reagentId,
            locationId: verdict.locationId as string,
            lotNumber: verdict.row.lotNumber.trim(),
            entryDate: new Date(verdict.row.entryDate),
            expirationDate: verdict.row.expirationDate.trim()
              ? new Date(verdict.row.expirationDate)
              : null,
            initialStock: verdict.row.quantity.trim(),
            currentStock: verdict.row.quantity.trim(),
            unit: verdict.unit as NonNullable<typeof verdict.unit>,
            madeById: actorId,
          },
        });
        batchesCreated += 1;
      }

      reagentsCreated = createdReagentIdByKey.size;

      return { reagentsCreated, batchesCreated };
    });
  }

  /**
   * Returns the id the batch should attach to: the existing reagent's id
   * for a `reuse` verdict (looked up once, before the transaction — see
   * `existingIdByKey` above), or the id of a reagent created earlier in
   * this same transaction (via `createdReagentIdByKey`), or a newly
   * created one. No query happens in this method for the `reuse` path —
   * that is the point.
   */
  private async resolveReagentId(
    tx: TransactionClient,
    verdict: RowVerdict,
    actorId: string,
    existingIdByKey: Map<string, string>,
    createdReagentIdByKey: Map<string, string>,
  ): Promise<string> {
    const key = reagentIdentityKey(verdict.row);

    if (verdict.reagent?.action === 'reuse') {
      const id = existingIdByKey.get(key);
      if (!id) {
        // preview resolved this row as `reuse` moments ago against the same
        // database; if the id is missing here something has drifted between
        // that resolution and this one, and writing a batch with no reagent
        // id would be worse than failing loudly.
        throw new BadRequestException({
          code: 'IMPORT_INVALID_ROWS',
          message: 'The import contains invalid rows and was not applied',
        });
      }
      return id;
    }

    const alreadyCreated = createdReagentIdByKey.get(key);
    if (alreadyCreated) {
      return alreadyCreated;
    }

    const created = await tx.reagent.create({
      data: {
        name: verdict.row.reagentName.trim(),
        casNumber: normalizeCasNumber(verdict.row.casNumber),
        madeById: actorId,
      },
      select: { id: true },
    });
    createdReagentIdByKey.set(key, created.id);
    return created.id;
  }
}

function reagentIdentityKey(row: ImportRow): string {
  return `${normalizeForSearch(row.reagentName.trim())}|${normalizeCasNumber(row.casNumber)}`;
}
