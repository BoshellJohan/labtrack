import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { ConsumptionsComponent } from './consumptions.component';
import { ConsumptionsStore } from './consumptions.store';
import { CONSUMPTIONS_ES } from './i18n.es';
import { AuthService } from '../../core/auth/auth.service';
import { API_URL } from '../../core/api/api.config';

function emptyReagentsPage() {
  return { data: [], total: 0, page: 1, pageSize: 100, totalPages: 0 };
}

function consumptionsPage(consumption: Record<string, unknown>) {
  return { data: [consumption], total: 1, page: 1, pageSize: 20, totalPages: 1 };
}

const activeConsumption = {
  id: 'c1',
  batchId: 'b1',
  lotNumber: 'L-1',
  reagentId: 'r1',
  reagentName: 'Ácido clorhídrico',
  quantity: '0.3',
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

const voidedConsumption = {
  ...activeConsumption,
  id: 'c2',
  active: false,
  voidReason: 'Registrado por error',
  voidedAt: '2026-08-02T00:00:00.000Z',
  voidedByName: 'Carlos Díaz',
};

describe('ConsumptionsComponent', () => {
  let fixture: ComponentFixture<ConsumptionsComponent>;
  let http: HttpTestingController;

  function createComponent(isAdmin: boolean) {
    TestBed.configureTestingModule({
      imports: [ConsumptionsComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: API_URL, useValue: 'http://api.test' },
        {
          provide: AuthService,
          useValue: { isAdmin: () => isAdmin, currentUser: () => null, isAuthenticated: () => true },
        },
        { provide: MatDialog, useValue: {} },
        { provide: MatSnackBar, useValue: { open: () => undefined } },
      ],
    });
    fixture = TestBed.createComponent(ConsumptionsComponent);
    http = TestBed.inject(HttpTestingController);
  }

  afterEach(() => http.verify());

  it('renders the quantity with its unit so a number is never read out of context', () => {
    // Spec §4.1: consumption never converts units, so a bare "5" on screen is
    // ambiguous between 5 mL and 5 L.
    createComponent(true);
    fixture.detectChanges();
    http.expectOne((r) => r.url === 'http://api.test/reagents').flush(emptyReagentsPage());
    http
      .expectOne((r) => r.url === 'http://api.test/consumptions')
      .flush(consumptionsPage(activeConsumption));
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('0.3 ML');
  });

  it('seeds the filter form from a filter the root-scoped store retained across navigation', () => {
    // ConsumptionsStore is providedIn: 'root', so its filters survive the
    // component being destroyed and recreated (navigating away and back).
    // Set a filter on the store *before* the component exists, the way it
    // would already be set on a second visit to the screen.
    TestBed.configureTestingModule({
      imports: [ConsumptionsComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: API_URL, useValue: 'http://api.test' },
        {
          provide: AuthService,
          useValue: { isAdmin: () => true, currentUser: () => null, isAuthenticated: () => true },
        },
        { provide: MatDialog, useValue: {} },
        { provide: MatSnackBar, useValue: { open: () => undefined } },
      ],
    });

    const store = TestBed.inject(ConsumptionsStore);
    http = TestBed.inject(HttpTestingController);
    // setReagentId (unlike setPurpose) applies immediately, with no debounce,
    // so the request it queues can be settled synchronously here.
    store.setReagentId('r1');
    // Settle the filter's own reload (the first visit to the screen) before
    // the component — the second visit — is created, so only one request is
    // in flight at a time.
    http.expectOne((req) => req.url === 'http://api.test/consumptions').flush(consumptionsPage(activeConsumption));

    fixture = TestBed.createComponent(ConsumptionsComponent);
    fixture.detectChanges();
    http.expectOne((r) => r.url === 'http://api.test/reagents').flush(emptyReagentsPage());

    const consumptionsRequest = http.expectOne((req) => req.url === 'http://api.test/consumptions');
    // The request the retained filter drives must match what the input
    // shows — this is the request setReagentId() above already queued.
    expect(consumptionsRequest.request.params.get('reagentId')).toBe('r1');
    consumptionsRequest.flush(consumptionsPage(activeConsumption));
    fixture.detectChanges();

    const component = fixture.componentInstance;
    expect(component.filtersForm.controls.reagentId.value).toBe('r1');
  });

  it('hides the void action from a non-admin', () => {
    // Server-side RolesGuard is the real enforcement; this only checks the
    // affordance is not offered.
    createComponent(false);
    fixture.detectChanges();
    http.expectOne((r) => r.url === 'http://api.test/reagents').flush(emptyReagentsPage());
    http
      .expectOne((r) => r.url === 'http://api.test/consumptions')
      .flush(consumptionsPage(activeConsumption));
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent as string;
    expect(text).not.toContain(CONSUMPTIONS_ES.voidAction);
  });

  it('shows the void action to an admin', () => {
    // The pair to "hides the void action from a non-admin": without this
    // one, removing the button outright for everybody would also pass that
    // test.
    createComponent(true);
    fixture.detectChanges();
    http.expectOne((r) => r.url === 'http://api.test/reagents').flush(emptyReagentsPage());
    http
      .expectOne((r) => r.url === 'http://api.test/consumptions')
      .flush(consumptionsPage(activeConsumption));
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain(CONSUMPTIONS_ES.voidAction);
  });

  it('hides the "incluir anulados" filter from a non-admin', () => {
    // The API's RolesGuard rejects includeVoided=true for a non-admin with
    // 403 (assertIncludeInactiveAllowed): offering the checkbox would just
    // let them trigger that failure.
    createComponent(false);
    fixture.detectChanges();
    http.expectOne((r) => r.url === 'http://api.test/reagents').flush(emptyReagentsPage());
    http
      .expectOne((r) => r.url === 'http://api.test/consumptions')
      .flush(consumptionsPage(activeConsumption));
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent as string;
    expect(text).not.toContain(CONSUMPTIONS_ES.filters.includeVoided);
  });

  it('shows the "incluir anulados" filter to an admin', () => {
    // The pair to "hides the ... filter from a non-admin": without this
    // one, removing the checkbox outright for everybody would also pass
    // that test.
    createComponent(true);
    fixture.detectChanges();
    http.expectOne((r) => r.url === 'http://api.test/reagents').flush(emptyReagentsPage());
    http
      .expectOne((r) => r.url === 'http://api.test/consumptions')
      .flush(consumptionsPage(activeConsumption));
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain(CONSUMPTIONS_ES.filters.includeVoided);
  });

  it('shows who voided a consumption and why, not just that it is voided', () => {
    createComponent(true);
    fixture.detectChanges();
    http.expectOne((r) => r.url === 'http://api.test/reagents').flush(emptyReagentsPage());
    http
      .expectOne((r) => r.url === 'http://api.test/consumptions')
      .flush(consumptionsPage(voidedConsumption));
    fixture.detectChanges();

    const text = fixture.nativeElement.textContent as string;
    expect(text).toContain('Anulado por Carlos Díaz: Registrado por error');
  });
});
