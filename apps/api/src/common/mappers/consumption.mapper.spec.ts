import { Prisma } from '../../prisma/client';
import { toConsumptionDto } from './consumption.mapper';

function row() {
  return {
    id: 'c1',
    batchId: 'b1',
    // Prisma 7 generates TypeScript source with no `runtime/` directory, so
    // Decimal comes off the Prisma namespace, not a runtime subpath.
    quantity: new Prisma.Decimal('0.3000'),
    consumedAt: new Date('2026-08-01T10:00:00.000Z'),
    purpose: 'Práctica de titulación',
    active: true,
    voidReason: null,
    voidedAt: null,
    voidedById: null,
    createdAt: new Date('2026-08-01T10:00:00.000Z'),
    updatedAt: new Date('2026-08-01T10:00:00.000Z'),
    madeById: 'u1',
    batch: {
      lotNumber: 'L-1',
      unit: 'ML' as const,
      reagentId: 'r1',
      reagent: { name: 'Acetona' },
    },
    madeBy: { fullName: 'Ana Ruiz' },
    voidedBy: null,
  };
}

describe('toConsumptionDto', () => {
  it('keeps the quantity a string, never a number', () => {
    const dto = toConsumptionDto(row());
    expect(dto.quantity).toBe('0.3');
    expect(typeof dto.quantity).toBe('string');
  });

  it('carries the unit down from the batch, because consumption never converts', () => {
    expect(toConsumptionDto(row()).unit).toBe('ML');
  });

  it('reports a void with its reason, actor and timestamp', () => {
    const voided = {
      ...row(),
      active: false,
      voidReason: 'Registrado por error',
      voidedAt: new Date('2026-08-02T09:00:00.000Z'),
      voidedById: 'u2',
      voidedBy: { fullName: 'Carlos Díaz' },
    };
    const dto = toConsumptionDto(voided);
    expect(dto.active).toBe(false);
    expect(dto.voidReason).toBe('Registrado por error');
    expect(dto.voidedByName).toBe('Carlos Díaz');
    expect(dto.voidedAt).toBe('2026-08-02T09:00:00.000Z');
  });

  it('leaves the void fields null on a live consumption', () => {
    const dto = toConsumptionDto(row());
    expect(dto.voidReason).toBeNull();
    expect(dto.voidedByName).toBeNull();
    expect(dto.voidedAt).toBeNull();
  });
});
