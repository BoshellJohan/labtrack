import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import * as ExcelJS from 'exceljs';
import { createTestApp } from './utils/test-app';
import { body } from './utils/body';
import { PrismaService } from '../src/prisma/prisma.service';
import { PasswordService } from '../src/auth/password.service';

describe('Consumptions export (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let passwords: PasswordService;
  let batchId: string;
  let reagentId: string;

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
    const reagent = await prisma.reagent.create({
      data: {
        name: 'Acetona',
        casNumber: '67-64-1',
        madeById: admin.id,
      },
    });
    const location = await prisma.location.create({
      data: { name: 'Estante A', madeById: admin.id },
    });
    const batch = await prisma.reagentBatch.create({
      data: {
        reagentId: reagent.id,
        locationId: location.id,
        lotNumber: 'L-1',
        entryDate: new Date('2026-01-10'),
        expirationDate: new Date('2027-01-10'),
        initialStock: '100.0000',
        currentStock: '100.0000',
        unit: 'ML',
        madeById: admin.id,
      },
    });
    batchId = batch.id;
    reagentId = reagent.id;
  });

  async function seedConsumptions(): Promise<void> {
    const admin = await prisma.user.findUniqueOrThrow({
      where: { username: 'admin' },
    });
    await prisma.consumption.create({
      data: {
        batchId,
        quantity: '1.0000',
        consumedAt: new Date('2026-08-02'),
        purpose: 'Segundo',
        madeById: admin.id,
      },
    });
    await prisma.consumption.create({
      data: {
        batchId,
        quantity: '1.0000',
        consumedAt: new Date('2026-08-03'),
        purpose: 'Tercero',
        madeById: admin.id,
      },
    });
    await prisma.consumption.create({
      data: {
        batchId,
        quantity: '1.0000',
        consumedAt: new Date('2026-08-01'),
        purpose: 'Primero',
        madeById: admin.id,
      },
    });
  }

  async function tokenFor(username: string): Promise<string> {
    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ username, password: 'initial-password' });
    return body<{ accessToken: string }>(response).accessToken;
  }

  function bufferResponse() {
    return (
      res: request.Response,
      cb: (err: Error | null, data: Buffer) => void,
    ) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    };
  }

  it('serves a spreadsheet with the right type and a name carrying the period', async () => {
    const token = await tokenFor('ana');
    const response = await request(app.getHttpServer())
      .get(
        '/consumptions/export.xlsx?from=2026-08-01T00:00:00.000Z&to=2026-08-31T00:00:00.000Z',
      )
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(response.headers['content-type']).toContain('spreadsheetml');
    expect(response.headers['content-disposition']).toContain(
      'consumos-2026-08-01-a-2026-08-31.xlsx',
    );
  });

  it('writes one row per consumption with the quantity as a number and the unit apart', async () => {
    await seedConsumptions();
    const token = await tokenFor('ana');
    const response = await request(app.getHttpServer())
      .get('/consumptions/export.xlsx')
      .set('Authorization', `Bearer ${token}`)
      .buffer()
      .parse(bufferResponse())
      .expect(200);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(response.body as Buffer);
    const sheet = workbook.getWorksheet('Consumos')!;

    expect(sheet.rowCount).toBe(4); // header + the three seeded rows

    // Resolve the columns by their header rather than by position, so the test
    // keeps testing what it means if a column is ever inserted before them.
    const headers = sheet.getRow(1).values as string[];
    const quantityColumn = headers.indexOf('Cantidad');
    const unitColumn = headers.indexOf('Unidad');

    // A number, not the string the rest of the system carries: this is the
    // one place that exception is correct, and the assertion is what stops
    // someone "restoring consistency" and quietly breaking every pivot
    // table.
    expect(typeof sheet.getRow(2).getCell(quantityColumn).value).toBe('number');
    expect(sheet.getRow(2).getCell(unitColumn).value).toBe('ML');
  });

  it('omits the void columns when voided rows cannot appear', async () => {
    await seedConsumptions();
    const token = await tokenFor('ana');
    const response = await request(app.getHttpServer())
      .get('/consumptions/export.xlsx')
      .set('Authorization', `Bearer ${token}`)
      .buffer()
      .parse(bufferResponse())
      .expect(200);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(response.body as Buffer);
    const headers = workbook.getWorksheet('Consumos')!.getRow(1)
      .values as string[];
    // A column that is always empty teaches the reader to ignore it.
    expect(headers).not.toContain('Motivo de anulación');
  });

  // This leak test lives on the Excel endpoint rather than the PDF one on
  // purpose: a workbook can be parsed and asserted against directly, while
  // PDFKit compresses its text streams, so the same assertion on a PDF would
  // need decompression tooling or a production-only flag that exists purely
  // for tests. Both formats read through the same `selectForExport`, so
  // pinning the authorization behaviour here pins it for both.
  it('does not leak a deactivated reagent name to a non-admin', async () => {
    await seedConsumptions();
    await prisma.reagent.update({
      where: { id: reagentId },
      data: { active: false },
    });
    const token = await tokenFor('ana');
    const response = await request(app.getHttpServer())
      .get('/consumptions/export.xlsx')
      .set('Authorization', `Bearer ${token}`)
      .buffer()
      .parse(bufferResponse())
      .expect(200);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(response.body as Buffer);
    expect(workbook.getWorksheet('Consumos')!.rowCount).toBe(1); // header only
  });

  it('refuses includeVoided for a non-admin', async () => {
    const token = await tokenFor('ana');
    await request(app.getHttpServer())
      .get('/consumptions/export.xlsx?includeVoided=true')
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
  });

  it('serves a PDF with the right type and name', async () => {
    const token = await tokenFor('ana');
    const response = await request(app.getHttpServer())
      .get('/consumptions/export.pdf')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    expect(response.headers['content-type']).toContain('application/pdf');
    expect(response.headers['content-disposition']).toContain('.pdf');
  });
});
