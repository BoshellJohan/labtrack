import { ComponentFixture, TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { vi } from 'vitest';
import { VoidConsumptionDialog } from './void-consumption.dialog';

const consumption = {
  id: 'c1',
  batchId: 'b1',
  lotNumber: 'L-1',
  reagentId: 'r1',
  reagentName: 'Ácido clorhídrico',
  quantity: '0.3000',
  unit: 'ML',
  consumedAt: '2026-08-01T00:00:00.000Z',
  purpose: 'Titulación',
  active: true,
  voidReason: null,
  voidedAt: null,
  voidedByName: null,
  madeByName: 'Carlos Díaz',
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
};

describe('VoidConsumptionDialog', () => {
  let fixture: ComponentFixture<VoidConsumptionDialog>;
  let component: VoidConsumptionDialog;
  let dialogRef: { close: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    dialogRef = { close: vi.fn() };
    TestBed.configureTestingModule({
      imports: [VoidConsumptionDialog],
      providers: [
        { provide: MatDialogRef, useValue: dialogRef },
        { provide: MAT_DIALOG_DATA, useValue: consumption },
      ],
    });
    fixture = TestBed.createComponent(VoidConsumptionDialog);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('does not close when the reason is only whitespace', () => {
    component.form.controls.voidReason.setValue('   ');
    component.confirm();
    expect(dialogRef.close).not.toHaveBeenCalled();
  });

  it('does not close when the reason is empty', () => {
    component.form.controls.voidReason.setValue('');
    component.confirm();
    expect(dialogRef.close).not.toHaveBeenCalled();
  });

  it('closes with the trimmed reason', () => {
    component.form.controls.voidReason.setValue('  Registrado por error  ');
    component.confirm();
    expect(dialogRef.close).toHaveBeenCalledWith({ voidReason: 'Registrado por error' });
  });
});
