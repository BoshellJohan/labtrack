import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import * as ExcelJS from 'exceljs';
import { IMPORT_COLUMNS, ImportPreview, ImportRow } from '@labtrack/shared';
import { createTestApp } from './utils/test-app';
import { body } from './utils/body';
import { PrismaService } from '../src/prisma/prisma.service';
import { PasswordService } from '../src/auth/password.service';

let nextRowNumber = 1;

function rowFor(overrides: Partial<ImportRow>): ImportRow {
  return {
    rowNumber: nextRowNumber++,
    reagentName: 'Acetona',
    casNumber: '67-64-1',
    reference: '',
    lotNumber: 'L-1',
    entryDate: '2026-08-01',
    expirationDate: '',
    quantity: '5',
    unit: 'ML',
    locationName: 'Estante A1',
    ...overrides,
  };
}

async function workbookWith(rows: string[][]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Reactivos');
  sheet.addRow([...IMPORT_COLUMNS]);
  rows.forEach((row) => sheet.addRow(row));
  return (await workbook.xlsx.writeBuffer()) as Buffer;
}

describe('Reagents import preview (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let passwords: PasswordService;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    passwords = app.get(PasswordService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE "Consumption", "ReagentBatch", "Reagent", "Location", "User" RESTART IDENTITY CASCADE',
    );
    const passwordHash = await passwords.hash('initial-password');
    await prisma.user.createMany({
      data: [
        {
          username: 'admin',
          fullName: 'Admin',
          passwordHash,
          role: 'ADMIN',
          mustChangePassword: false,
        },
        {
          username: 'ana',
          fullName: 'Ana Ruiz',
          passwordHash,
          role: 'USER',
          mustChangePassword: false,
        },
      ],
    });
    const admin = await prisma.user.findUniqueOrThrow({
      where: { username: 'admin' },
    });
    await prisma.location.create({
      data: { name: 'Estante A1', madeById: admin.id },
    });
    await prisma.reagent.create({
      data: {
        name: 'Acetona',
        casNumber: '67-64-1',
        madeById: admin.id,
      },
    });
  });

  async function tokenFor(username: string): Promise<string> {
    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ username, password: 'initial-password' });
    return body<{ accessToken: string }>(response).accessToken;
  }

  it('says a row will reuse a reagent when name and CAS both match', async () => {
    const buffer = await workbookWith([
      [
        'Acetona',
        '67-64-1',
        '',
        'L-9',
        '2026-08-01',
        '',
        '5',
        'ML',
        'Estante A1',
      ],
    ]);
    const token = await tokenFor('admin');
    const response = await request(app.getHttpServer())
      .post('/reagents/import/preview')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', buffer, 'inventario.xlsx')
      .expect(201);

    const preview = body<ImportPreview>(response);
    expect(preview.verdicts[0].reagent).toEqual({
      action: 'reuse',
      existingName: 'Acetona',
    });
    expect(preview.summary.reagentsToReuse).toBe(1);
  });

  it('matches a reagent ignoring case and accents, reusing the search column', async () => {
    const buffer = await workbookWith([
      [
        'ACETÓNA',
        '67-64-1',
        '',
        'L-9',
        '2026-08-01',
        '',
        '5',
        'ML',
        'Estante A1',
      ],
    ]);
    const token = await tokenFor('admin');
    const response = await request(app.getHttpServer())
      .post('/reagents/import/preview')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', buffer, 'inventario.xlsx')
      .expect(201);

    expect(body<ImportPreview>(response).verdicts[0].reagent).toEqual({
      action: 'reuse',
      existingName: 'Acetona',
    });
  });

  it('says it will create when the CAS differs, even if the name matches', async () => {
    const buffer = await workbookWith([
      [
        'Acetona',
        '64-17-5',
        '',
        'L-9',
        '2026-08-01',
        '',
        '5',
        'ML',
        'Estante A1',
      ],
    ]);
    const token = await tokenFor('admin');
    const response = await request(app.getHttpServer())
      .post('/reagents/import/preview')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', buffer, 'inventario.xlsx')
      .expect(201);

    expect(body<ImportPreview>(response).verdicts[0].reagent).toEqual({
      action: 'create',
    });
  });

  it('flags a location that does not exist rather than creating one', async () => {
    const buffer = await workbookWith([
      [
        'Acetona',
        '67-64-1',
        '',
        'L-9',
        '2026-08-01',
        '',
        '5',
        'ML',
        'Estante Z',
      ],
    ]);
    const token = await tokenFor('admin');
    const response = await request(app.getHttpServer())
      .post('/reagents/import/preview')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', buffer, 'inventario.xlsx')
      .expect(201);

    const verdict = body<ImportPreview>(response).verdicts[0];
    expect(verdict.issues.map((i) => i.column)).toContain('Ubicación');
    expect(verdict.locationId).toBeNull();
  });

  it('flags a lot number that reagent already has, even though nothing in the file repeats it', async () => {
    const admin = await prisma.user.findUniqueOrThrow({
      where: { username: 'admin' },
    });
    const location = await prisma.location.findFirstOrThrow({
      where: { name: 'Estante A1' },
    });
    const reagent = await prisma.reagent.findFirstOrThrow({
      where: { name: 'Acetona' },
    });
    await prisma.reagentBatch.create({
      data: {
        reagentId: reagent.id,
        locationId: location.id,
        lotNumber: 'L-EXISTING',
        entryDate: new Date('2026-01-01'),
        initialStock: '10.0000',
        currentStock: '10.0000',
        unit: 'ML',
        madeById: admin.id,
      },
    });

    const buffer = await workbookWith([
      [
        'Acetona',
        '67-64-1',
        '',
        'L-EXISTING',
        '2026-08-01',
        '',
        '5',
        'ML',
        'Estante A1',
      ],
    ]);
    const token = await tokenFor('admin');
    const response = await request(app.getHttpServer())
      .post('/reagents/import/preview')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', buffer, 'inventario.xlsx')
      .expect(201);

    const preview = body<ImportPreview>(response);
    expect(preview.summary.invalidRows).toBe(1);
    expect(preview.verdicts[0].issues).toContainEqual({
      column: 'Lote',
      code: 'LOT_EXISTS',
    });
  });

  it('does not flag a lot number that only a deactivated batch holds', async () => {
    const admin = await prisma.user.findUniqueOrThrow({
      where: { username: 'admin' },
    });
    const location = await prisma.location.findFirstOrThrow({
      where: { name: 'Estante A1' },
    });
    const reagent = await prisma.reagent.findFirstOrThrow({
      where: { name: 'Acetona' },
    });
    const batch = await prisma.reagentBatch.create({
      data: {
        reagentId: reagent.id,
        locationId: location.id,
        lotNumber: 'L-FREED',
        entryDate: new Date('2026-01-01'),
        initialStock: '10.0000',
        currentStock: '10.0000',
        unit: 'ML',
        madeById: admin.id,
      },
    });
    await prisma.reagentBatch.update({
      where: { id: batch.id },
      data: { active: false },
    });

    const buffer = await workbookWith([
      [
        'Acetona',
        '67-64-1',
        '',
        'L-FREED',
        '2026-08-01',
        '',
        '5',
        'ML',
        'Estante A1',
      ],
    ]);
    const token = await tokenFor('admin');
    const response = await request(app.getHttpServer())
      .post('/reagents/import/preview')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', buffer, 'inventario.xlsx')
      .expect(201);

    // The unique index this check anticipates is partial (`WHERE active`):
    // a deactivated batch's lot number is free to reuse, so this must not
    // be reported as a conflict.
    expect(body<ImportPreview>(response).summary.invalidRows).toBe(0);
  });

  it('writes nothing at all', async () => {
    const before = await prisma.reagent.count();
    const buffer = await workbookWith([
      [
        'Nuevo',
        '64-17-5',
        '',
        'L-9',
        '2026-08-01',
        '',
        '5',
        'ML',
        'Estante A1',
      ],
    ]);
    const token = await tokenFor('admin');
    await request(app.getHttpServer())
      .post('/reagents/import/preview')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', buffer, 'inventario.xlsx')
      .expect(201);

    expect(await prisma.reagent.count()).toBe(before);
  });

  it('normalises a lowercase unit to the stored enum value', async () => {
    const buffer = await workbookWith([
      [
        'Acetona',
        '67-64-1',
        '',
        'L-9',
        '2026-08-01',
        '',
        '5',
        'ml',
        'Estante A1',
      ],
    ]);
    const token = await tokenFor('admin');
    const response = await request(app.getHttpServer())
      .post('/reagents/import/preview')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', buffer, 'inventario.xlsx')
      .expect(201);

    expect(body<ImportPreview>(response).verdicts[0].unit).toBe('ML');
  });

  it('leaves unit null alongside an INVALID_UNIT issue for an unrecognised unit', async () => {
    const buffer = await workbookWith([
      [
        'Acetona',
        '67-64-1',
        '',
        'L-9',
        '2026-08-01',
        '',
        '5',
        'BARRELS',
        'Estante A1',
      ],
    ]);
    const token = await tokenFor('admin');
    const response = await request(app.getHttpServer())
      .post('/reagents/import/preview')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', buffer, 'inventario.xlsx')
      .expect(201);

    const verdict = body<ImportPreview>(response).verdicts[0];
    expect(verdict.unit).toBeNull();
    expect(
      verdict.issues.some(
        (issue) => issue.column === 'Unidad' && issue.code === 'INVALID_UNIT',
      ),
    ).toBe(true);
  });

  it('refuses a non-admin', async () => {
    const buffer = await workbookWith([
      [
        'Acetona',
        '67-64-1',
        '',
        'L-9',
        '2026-08-01',
        '',
        '5',
        'ML',
        'Estante A1',
      ],
    ]);
    const token = await tokenFor('ana');
    await request(app.getHttpServer())
      .post('/reagents/import/preview')
      .set('Authorization', `Bearer ${token}`)
      .attach('file', buffer, 'inventario.xlsx')
      .expect(403);
  });
});

describe('Reagents import confirm (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let passwords: PasswordService;

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    passwords = app.get(PasswordService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await prisma.$executeRawUnsafe(
      'TRUNCATE TABLE "Consumption", "ReagentBatch", "Reagent", "Location", "User" RESTART IDENTITY CASCADE',
    );
    const passwordHash = await passwords.hash('initial-password');
    await prisma.user.createMany({
      data: [
        {
          username: 'admin',
          fullName: 'Admin',
          passwordHash,
          role: 'ADMIN',
          mustChangePassword: false,
        },
        {
          username: 'ana',
          fullName: 'Ana Ruiz',
          passwordHash,
          role: 'USER',
          mustChangePassword: false,
        },
      ],
    });
    const admin = await prisma.user.findUniqueOrThrow({
      where: { username: 'admin' },
    });
    await prisma.location.create({
      data: { name: 'Estante A1', madeById: admin.id },
    });
    await prisma.reagent.create({
      data: {
        name: 'Acetona',
        casNumber: '67-64-1',
        madeById: admin.id,
      },
    });
  });

  async function tokenFor(username: string): Promise<string> {
    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ username, password: 'initial-password' });
    return body<{ accessToken: string }>(response).accessToken;
  }

  it('creates the reagent and its batch, recording the importer as the author', async () => {
    const token = await tokenFor('admin');
    const admin = await prisma.user.findUniqueOrThrow({
      where: { username: 'admin' },
    });
    const response = await request(app.getHttpServer())
      .post('/reagents/import/confirm')
      .set('Authorization', `Bearer ${token}`)
      .send({ rows: [rowFor({ reagentName: 'Nuevo', casNumber: '64-17-5' })] })
      .expect(201);

    expect(body<{ reagentsCreated: number }>(response).reagentsCreated).toBe(1);
    const created = await prisma.reagent.findFirstOrThrow({
      where: { name: 'Nuevo' },
    });
    // Never from the file: the author is whoever was authenticated.
    expect(created.madeById).toBe(admin.id);
  });

  it('adds a batch to the existing reagent when name and CAS match', async () => {
    const token = await tokenFor('admin');
    const before = await prisma.reagent.count();
    await request(app.getHttpServer())
      .post('/reagents/import/confirm')
      .set('Authorization', `Bearer ${token}`)
      .send({
        rows: [
          rowFor({
            reagentName: 'Acetona',
            casNumber: '67-64-1',
            lotNumber: 'L-77',
          }),
        ],
      })
      .expect(201);

    expect(await prisma.reagent.count()).toBe(before);
    expect(
      await prisma.reagentBatch.findFirst({ where: { lotNumber: 'L-77' } }),
    ).not.toBeNull();
  });

  it('creates one reagent and two batches when two rows describe the same new reagent', async () => {
    const token = await tokenFor('admin');
    const reagentsBefore = await prisma.reagent.count();
    const response = await request(app.getHttpServer())
      .post('/reagents/import/confirm')
      .set('Authorization', `Bearer ${token}`)
      .send({
        rows: [
          rowFor({
            reagentName: 'Nuevo',
            casNumber: '64-17-5',
            lotNumber: 'A',
          }),
          rowFor({
            reagentName: 'Nuevo',
            casNumber: '64-17-5',
            lotNumber: 'B',
          }),
        ],
      })
      .expect(201);

    expect(
      body<{ reagentsCreated: number; batchesCreated: number }>(response),
    ).toEqual({ reagentsCreated: 1, batchesCreated: 2 });
    expect(await prisma.reagent.count()).toBe(reagentsBefore + 1);
    const reagent = await prisma.reagent.findFirstOrThrow({
      where: { name: 'Nuevo' },
    });
    expect(
      await prisma.reagentBatch.count({ where: { reagentId: reagent.id } }),
    ).toBe(2);
  });

  it('writes nothing when a single row is invalid', async () => {
    const token = await tokenFor('admin');
    const reagentsBefore = await prisma.reagent.count();
    const batchesBefore = await prisma.reagentBatch.count();

    await request(app.getHttpServer())
      .post('/reagents/import/confirm')
      .set('Authorization', `Bearer ${token}`)
      .send({
        rows: [
          rowFor({
            reagentName: 'Buena 1',
            casNumber: '64-17-5',
            lotNumber: 'A',
          }),
          rowFor({
            reagentName: 'Buena 2',
            casNumber: '7440-31-5',
            lotNumber: 'B',
          }),
          rowFor({
            reagentName: 'Mala',
            casNumber: '12345-67-9',
            lotNumber: 'C',
          }),
        ],
      })
      .expect(400);

    // All or nothing is the property; this is what proves it is a behaviour and
    // not an intention.
    expect(await prisma.reagent.count()).toBe(reagentsBefore);
    expect(await prisma.reagentBatch.count()).toBe(batchesBefore);
  });

  it('does not trust the rows the client echoes back', async () => {
    const token = await tokenFor('admin');
    const before = await prisma.reagentBatch.count();

    await request(app.getHttpServer())
      .post('/reagents/import/confirm')
      .set('Authorization', `Bearer ${token}`)
      .send({ rows: [rowFor({ locationName: 'Estante Z', lotNumber: 'X' })] })
      .expect(400);

    // Without this the stateless design would be unsafe and nobody would notice:
    // the preview said nothing about this row, because the client never showed
    // it to us.
    expect(await prisma.reagentBatch.count()).toBe(before);
  });

  it('rejects a lot number the reagent already has, even though the preview never saw it', async () => {
    const admin = await prisma.user.findUniqueOrThrow({
      where: { username: 'admin' },
    });
    const location = await prisma.location.findFirstOrThrow({
      where: { name: 'Estante A1' },
    });
    const reagent = await prisma.reagent.findFirstOrThrow({
      where: { name: 'Acetona' },
    });
    await prisma.reagentBatch.create({
      data: {
        reagentId: reagent.id,
        locationId: location.id,
        lotNumber: 'L-EXISTING',
        entryDate: new Date('2026-01-01'),
        initialStock: '10.0000',
        currentStock: '10.0000',
        unit: 'ML',
        madeById: admin.id,
      },
    });
    const batchesBefore = await prisma.reagentBatch.count();

    const token = await tokenFor('admin');
    await request(app.getHttpServer())
      .post('/reagents/import/confirm')
      .set('Authorization', `Bearer ${token}`)
      .send({
        rows: [
          rowFor({
            reagentName: 'Acetona',
            casNumber: '67-64-1',
            lotNumber: 'L-EXISTING',
          }),
        ],
      })
      .expect(400);

    // The preview is a convenience, not the enforcement: confirm re-runs the
    // same check and must reject this row on its own.
    expect(await prisma.reagentBatch.count()).toBe(batchesBefore);
  });

  it('refuses a non-admin', async () => {
    const token = await tokenFor('ana');
    await request(app.getHttpServer())
      .post('/reagents/import/confirm')
      .set('Authorization', `Bearer ${token}`)
      .send({ rows: [rowFor({})] })
      .expect(403);
  });
});
