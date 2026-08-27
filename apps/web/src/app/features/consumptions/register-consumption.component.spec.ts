import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import type { ReagentBatchDto } from '@labtrack/shared';
import { RegisterConsumptionComponent } from './register-consumption.component';
import { API_URL } from '../../core/api/api.config';

const batchFixture: ReagentBatchDto = {
  id: 'b1',
  reagentId: 'r1',
  reagentName: 'Ácido clorhídrico',
  lotNumber: 'L-1',
  entryDate: '2026-08-01T00:00:00.000Z',
  expirationDate: '2026-09-10T00:00:00.000Z',
  initialStock: '100.0000',
  currentStock: '100.0000',
  unit: 'ML',
  locationId: 'location-1',
  locationName: 'Estante A1',
  active: true,
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
};

describe('RegisterConsumptionComponent', () => {
  let fixture: ComponentFixture<RegisterConsumptionComponent>;
  let component: RegisterConsumptionComponent;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      imports: [RegisterConsumptionComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: API_URL, useValue: '' },
        { provide: MatSnackBar, useValue: { open: () => undefined } },
      ],
    });

    fixture = TestBed.createComponent(RegisterConsumptionComponent);
    component = fixture.componentInstance;
    http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();

    // The reagent picker loads its own options on init.
    http.expectOne((r) => r.url === '/reagents').flush({
      data: [],
      total: 0,
      page: 1,
      pageSize: 100,
      totalPages: 1,
    });
  });

  afterEach(() => {
    http.verify();
  });

  it('does not offer batches until a reagent is chosen', () => {
    // The unit of a consumption comes from its batch, so offering batches
    // across reagents would let someone log 5 mL against the wrong substance.
    expect(component.batches()).toEqual([]);
    http.expectNone((r) => r.url.includes('/batches'));
  });

  it('loads only the active batches of the chosen reagent', () => {
    component.selectReagent('r1');
    const request = http.expectOne((r) => r.url === '/reagents/r1/batches');
    expect(request.request.params.get('includeInactive')).toBeNull();
    request.flush({ data: [batchFixture], total: 1, page: 1, pageSize: 100, totalPages: 1 });
    expect(component.batches().map((b) => b.lotNumber)).toEqual(['L-1']);
  });

  it('clears the selected batch when the reagent changes', () => {
    component.selectReagent('r1');
    http
      .expectOne((r) => r.url === '/reagents/r1/batches')
      .flush({ data: [batchFixture], total: 1, page: 1, pageSize: 100, totalPages: 1 });
    component.form.controls.batchId.setValue('b1');

    component.selectReagent('r2');
    http.expectOne((r) => r.url === '/reagents/r2/batches');

    // Without this, submitting after switching reagents would post a batch
    // belonging to the previous one — a consumption recorded against the
    // wrong substance, which is the worst outcome this screen can produce.
    expect(component.form.controls.batchId.value).toBe('');
  });

  it('rejects a quantity above the selected batch stock before sending anything', () => {
    component.selectReagent('r1');
    http
      .expectOne((r) => r.url === '/reagents/r1/batches')
      .flush({ data: [batchFixture], total: 1, page: 1, pageSize: 100, totalPages: 1 });
    component.form.controls.batchId.setValue('b1');
    component.form.controls.quantity.setValue('999');

    expect(component.form.controls.quantity.hasError('exceedsStock')).toBe(true);
    component.submit();
    http.expectNone((r) => r.method === 'POST');
  });

  it('sends the quantity as the string the user typed, never a parsed number', () => {
    component.selectReagent('r1');
    http
      .expectOne((r) => r.url === '/reagents/r1/batches')
      .flush({ data: [batchFixture], total: 1, page: 1, pageSize: 100, totalPages: 1 });
    component.form.patchValue({
      batchId: 'b1',
      quantity: '0.3000',
      consumedAt: new Date('2026-08-01T00:00:00.000Z'),
      purpose: 'Práctica',
    });

    component.submit();

    const request = http.expectOne((r) => r.method === 'POST' && r.url === '/consumptions');
    // '0.3000' and not '0.3': the trailing zeros are the scale the column
    // stores, and a round trip through Number would drop them.
    expect(request.request.body.quantity).toBe('0.3000');
    expect(typeof request.request.body.quantity).toBe('string');
  });
});
