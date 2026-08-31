import { ImportRow } from '@labtrack/shared';
import { ImportService } from './import.service';

function row(overrides: Partial<ImportRow> = {}): ImportRow {
  return {
    rowNumber: 1,
    reagentName: 'Acetona',
    casNumber: '67-64-1',
    reference: '',
    lotNumber: 'L-1',
    entryDate: '2026-08-01',
    expirationDate: '',
    quantity: '5.0000',
    unit: 'ML',
    locationName: 'Estante A1',
    ...overrides,
  };
}

// Shape of the object $transaction hands the callback: the same model
// methods `confirm` reads and writes through as `tx`. Declared separately
// from `client` (rather than inline) so the `$transaction` mock can
// reference `client` without the object literal becoming
// self-referential, the same convention as batches.service.spec.ts.
function buildService() {
  const existingReagent = {
    id: 'existing-r1',
    name: 'Acetona',
    nameNormalized: 'acetona',
    casNumber: '67-64-1',
  };
  const location = { id: 'loc1', name: 'Estante A1' };

  const client = {
    location: {
      findMany: jest.fn().mockResolvedValue([location]),
    },
    reagent: {
      findMany: jest.fn().mockResolvedValue([existingReagent]),
      create: jest.fn().mockResolvedValue({ id: `created-${Math.random()}` }),
    },
    reagentBatch: {
      create: jest.fn().mockResolvedValue({}),
    },
  };
  const $transaction = jest.fn((fn: (tx: typeof client) => Promise<unknown>) =>
    fn(client),
  );
  const prisma = { ...client, $transaction };
  return { service: new ImportService(prisma as never), client };
}

describe('ImportService.confirm', () => {
  it('resolves every reuse row against the database with one query, not one per row', async () => {
    const { service, client } = buildService();
    const rows = Array.from({ length: 5 }, (_, i) =>
      row({ rowNumber: i + 1, lotNumber: `L-${i}` }),
    );

    const result = await service.confirm(rows, 'admin-1');

    expect(result).toEqual({ reagentsCreated: 0, batchesCreated: 5 });
    // One `findMany` from `preview` (checking which rows will reuse) and one
    // more from `confirm` itself (resolving the ids those rows will write
    // against) — never one per row. A thousand-row file of all-reuse rows
    // is the common case for this import, and a per-row lookup would run
    // that many sequential round trips inside the Serializable transaction,
    // holding it open far longer than the write itself needs. If a lookup
    // ever moves back inside the per-row loop, this count grows with the
    // row count and this assertion catches it; a looser bound would not.
    expect(client.reagent.findMany).toHaveBeenCalledTimes(2);
    expect(client.reagentBatch.create).toHaveBeenCalledTimes(5);
  });

  it('creates one reagent for two rows describing the same new reagent, reusing the id created in this run', async () => {
    const { service, client } = buildService();
    client.reagent.findMany.mockResolvedValueOnce([]); // preview: nothing exists yet
    const rows = [
      row({
        rowNumber: 1,
        reagentName: 'Nuevo',
        casNumber: '64-17-5',
        lotNumber: 'A',
      }),
      row({
        rowNumber: 2,
        reagentName: 'Nuevo',
        casNumber: '64-17-5',
        lotNumber: 'B',
      }),
    ];

    const result = await service.confirm(rows, 'admin-1');

    expect(result).toEqual({ reagentsCreated: 1, batchesCreated: 2 });
    expect(client.reagent.create).toHaveBeenCalledTimes(1);
  });

  it('writes nothing and throws when a row is invalid', async () => {
    const { service, client } = buildService();
    const rows = [row({ casNumber: 'not-a-cas' })];

    await expect(service.confirm(rows, 'admin-1')).rejects.toThrow();
    expect(client.reagentBatch.create).not.toHaveBeenCalled();
  });
});
