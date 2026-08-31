import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import * as ExcelJS from 'exceljs';
import { IMPORT_COLUMNS, ImportPreview } from '@labtrack/shared';
import { createTestApp } from './utils/test-app';
import { body } from './utils/body';
import { PrismaService } from '../src/prisma/prisma.service';
import { PasswordService } from '../src/auth/password.service';

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
