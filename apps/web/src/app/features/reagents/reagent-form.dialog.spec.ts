import { TestBed } from '@angular/core/testing';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { vi } from 'vitest';
import { ReagentDto } from '@labtrack/shared';
import { ReagentFormDialog } from './reagent-form.dialog';

const reagent: ReagentDto = {
  id: 'reagent-1',
  name: 'Ácido clorhídrico',
  casNumber: '7647-01-0',
  reference: 'REF-1',
  description: 'Uso general de laboratorio',
  dataSheetUrl: 'https://example.com/msds.pdf',
  active: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  stockByUnit: [],
  batchCount: 0,
};

describe('ReagentFormDialog', () => {
  function createDialog(data: { reagent?: ReagentDto }) {
    const dialogRef = { close: vi.fn() };
    TestBed.configureTestingModule({
      imports: [ReagentFormDialog],
      providers: [
        { provide: MatDialogRef, useValue: dialogRef },
        { provide: MAT_DIALOG_DATA, useValue: data },
      ],
    });
    const fixture = TestBed.createComponent(ReagentFormDialog);
    fixture.detectChanges();
    return { component: fixture.componentInstance, dialogRef };
  }

  it('prefills the form from the reagent being edited', () => {
    const { component } = createDialog({ reagent });

    expect(component.form.getRawValue()).toEqual({
      name: 'Ácido clorhídrico',
      casNumber: '7647-01-0',
      reference: 'REF-1',
      description: 'Uso general de laboratorio',
      dataSheetUrl: 'https://example.com/msds.pdf',
    });
  });

  it('leaves the form empty when creating rather than editing', () => {
    const { component } = createDialog({});

    expect(component.form.getRawValue()).toEqual({
      name: '',
      casNumber: '',
      reference: '',
      description: '',
      dataSheetUrl: '',
    });
  });

  it('closes with the edited values on confirm', () => {
    const { component, dialogRef } = createDialog({ reagent });

    component.form.patchValue({ reference: 'REF-2' });
    component.confirm();

    expect(dialogRef.close).toHaveBeenCalledWith({
      name: 'Ácido clorhídrico',
      casNumber: '7647-01-0',
      reference: 'REF-2',
      description: 'Uso general de laboratorio',
      dataSheetUrl: 'https://example.com/msds.pdf',
    });
  });

  it('strips blank optional fields to undefined instead of sending empty strings', () => {
    const { component, dialogRef } = createDialog({
      reagent: { ...reagent, reference: null, description: null, dataSheetUrl: null },
    });

    component.confirm();

    expect(dialogRef.close).toHaveBeenCalledWith({
      name: 'Ácido clorhídrico',
      casNumber: '7647-01-0',
      reference: undefined,
      description: undefined,
      dataSheetUrl: undefined,
    });
  });
});
