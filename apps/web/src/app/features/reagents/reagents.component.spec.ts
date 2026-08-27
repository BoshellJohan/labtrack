import { ComponentFixture, TestBed } from '@angular/core/testing';
import { LOCALE_ID } from '@angular/core';
import { registerLocaleData } from '@angular/common';
import localeEs from '@angular/common/locales/es';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { vi } from 'vitest';
import { ReagentsComponent } from './reagents.component';
import { ReagentsStore } from './reagents.store';
import { AuthService } from '../../core/auth/auth.service';
import { API_URL } from '../../core/api/api.config';
import type { ReagentBatchDto } from '@labtrack/shared';

const emptyLocationsPage = {
  data: [],
  total: 0,
  page: 1,
  pageSize: 100,
  totalPages: 0,
};

function reagentsPage(reagent: Record<string, unknown>) {
  return {
    data: [reagent],
    total: 1,
    page: 1,
    pageSize: 20,
    totalPages: 1,
  };
}

const baseReagent = {
  id: 'reagent-1',
  name: 'Ácido clorhídrico',
  casNumber: '7647-01-0',
  reference: null,
  description: null,
  dataSheetUrl: null,
  active: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  batchCount: 2,
};

describe('ReagentsComponent', () => {
  let fixture: ComponentFixture<ReagentsComponent>;
  let http: HttpTestingController;

  function createComponent(reagent: Record<string, unknown>) {
    TestBed.configureTestingModule({
      imports: [ReagentsComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: API_URL, useValue: 'http://api.test' },
        {
          provide: AuthService,
          useValue: { isAdmin: () => false, currentUser: () => null, isAuthenticated: () => true },
        },
        { provide: MatDialog, useValue: {} },
        { provide: MatSnackBar, useValue: { open: () => undefined } },
      ],
    });

    fixture = TestBed.createComponent(ReagentsComponent);
    http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();

    http.expectOne((req) => req.url === 'http://api.test/reagents').flush(reagentsPage(reagent));
    http.expectOne((req) => req.url === 'http://api.test/locations').flush(emptyLocationsPage);
    fixture.detectChanges();
  }

  afterEach(() => {
    http.verify();
    vi.useRealTimers();
  });

  it('renders one stock line per unit instead of summing or dropping units', () => {
    createComponent({
      ...baseReagent,
      stockByUnit: [
        { unit: 'ML', total: '500.0000' },
        { unit: 'L', total: '2.0000' },
      ],
    });

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';

    // Both units must be present as their own reading...
    expect(text).toContain('500 mL');
    expect(text).toContain('2 L');
    // ...which an implementation that summed across units (500 mL + 2 L
    // treated as if both were mL, "502 mL") would fail.
    expect(text).not.toContain('502');
    // ...and which an implementation that rendered only stockByUnit[0] would
    // also fail, since "2 L" would never appear.
  });

  it('does not mark a lot as expired while today is still its expiration day', () => {
    // A naive `Date.now()` vs. `new Date(expirationDate).getTime()` instant
    // comparison flips to "expired" the moment UTC midnight of the
    // expiration day arrives — 7pm the previous calendar day at UTC-5 — even
    // though the whole expiration day should still count as valid. Pin
    // "now" to just after that UTC midnight (i.e. the very start of the
    // expiration day) and assert the lot is not yet "Vencido".
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-10T00:05:00.000Z'));

    createComponent({
      ...baseReagent,
      stockByUnit: [{ unit: 'ML', total: '500.0000' }],
    });

    const component = fixture.componentInstance;
    const batch = {
      id: 'batch-1',
      reagentId: 'reagent-1',
      reagentName: 'Ácido clorhídrico',
      lotNumber: 'L-1',
      entryDate: '2026-08-01T00:00:00.000Z',
      expirationDate: '2026-09-10T00:00:00.000Z',
      initialStock: '500.0000',
      currentStock: '500.0000',
      unit: 'ML' as const,
      locationId: 'location-1',
      locationName: 'Estante A1',
      active: true,
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
    };

    expect(component.expiryStatus(batch)).not.toBe('expired');
  });

  it('renders dates in Spanish day/month order, not the en-US default', () => {
    // The app provides LOCALE_ID at the root; the TestBed does not inherit
    // that, so it is provided here the same way. Without this test the
    // locale registration in app.config.ts is unverified: the suite would
    // keep passing if someone deleted it, and the failure would first appear
    // to a user reading 9/10/26 as 9 October on an expiry column.
    registerLocaleData(localeEs);
    TestBed.configureTestingModule({
      imports: [ReagentsComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: API_URL, useValue: 'http://api.test' },
        {
          provide: AuthService,
          useValue: { isAdmin: () => false, currentUser: () => null, isAuthenticated: () => true },
        },
        { provide: MatDialog, useValue: {} },
        { provide: MatSnackBar, useValue: { open: () => undefined } },
        { provide: LOCALE_ID, useValue: 'es' },
      ],
    });

    fixture = TestBed.createComponent(ReagentsComponent);
    http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();

    http
      .expectOne((req) => req.url === 'http://api.test/reagents')
      .flush(
        reagentsPage({
          ...baseReagent,
          stockByUnit: [{ unit: 'ML', total: '500.0000' }],
        }),
      );
    http.expectOne((req) => req.url === 'http://api.test/locations').flush(emptyLocationsPage);
    fixture.detectChanges();

    // Expand the reagent's batches, following the arrangement the existing
    // stock-column test uses, so the entryDate — the date rendered with the
    // `date` pipe — actually appears in the DOM.
    fixture.componentInstance.toggleBatches(baseReagent as never);
    fixture.detectChanges();

    http
      .expectOne((req) => req.url === 'http://api.test/reagents/reagent-1/batches')
      .flush({
        data: [
          {
            id: 'batch-1',
            reagentId: 'reagent-1',
            reagentName: 'Ácido clorhídrico',
            lotNumber: 'L-1',
            entryDate: '2026-08-01T00:00:00.000Z',
            expirationDate: '2026-09-10T00:00:00.000Z',
            initialStock: '500.0000',
            currentStock: '500.0000',
            unit: 'ML',
            locationId: 'location-1',
            locationName: 'Estante A1',
            active: true,
            createdAt: '2026-08-01T00:00:00.000Z',
            updatedAt: '2026-08-01T00:00:00.000Z',
          },
        ],
        total: 1,
        page: 1,
        pageSize: 20,
        totalPages: 1,
      });
    fixture.detectChanges();

    const text = (fixture.nativeElement as HTMLElement).textContent ?? '';
    expect(text).toContain('1/8/26');
    expect(text).not.toContain('8/1/26');
  });

  describe('expiry threshold boundaries', () => {
    const batchFixture: ReagentBatchDto = {
      id: 'batch-1',
      reagentId: 'reagent-1',
      reagentName: 'Ácido clorhídrico',
      lotNumber: 'L-1',
      entryDate: '2026-08-01T00:00:00.000Z',
      expirationDate: '2026-09-10T00:00:00.000Z',
      initialStock: '500.0000',
      currentStock: '500.0000',
      unit: 'ML',
      locationId: 'location-1',
      locationName: 'Estante A1',
      active: true,
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
    };
    let componentUnderTest: ReagentsComponent;

    beforeEach(() => {
      vi.useFakeTimers();
      createComponent({
        ...baseReagent,
        stockByUnit: [{ unit: 'ML', total: '500.0000' }],
      });
      componentUnderTest = fixture.componentInstance;
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('marks a lot as expired the day after its expiration date', () => {
      vi.setSystemTime(new Date('2026-09-11T00:05:00.000Z'));
      const status = componentUnderTest.expiryStatus({
        ...batchFixture,
        expirationDate: '2026-09-10T00:00:00.000Z',
      });
      expect(status).toBe('expired');
    });

    it('warns exactly at the 30-day threshold and not a day earlier', () => {
      vi.setSystemTime(new Date('2026-08-11T00:00:00.000Z'));
      expect(
        componentUnderTest.expiryStatus({
          ...batchFixture,
          expirationDate: '2026-09-10T00:00:00.000Z',
        }),
      ).toBe('warning');

      vi.setSystemTime(new Date('2026-08-10T00:00:00.000Z'));
      expect(
        componentUnderTest.expiryStatus({
          ...batchFixture,
          expirationDate: '2026-09-10T00:00:00.000Z',
        }),
      ).toBe('ok');
    });
  });

  it('seeds the filter inputs from a filter the root-scoped store retained across navigation', () => {
    // ReagentsStore is providedIn: 'root', so its filters survive the
    // component being destroyed and recreated (navigating away and back).
    // Set a filter on the store *before* the component exists, the way it
    // would already be set on a second visit to the screen.
    TestBed.configureTestingModule({
      imports: [ReagentsComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: API_URL, useValue: 'http://api.test' },
        {
          provide: AuthService,
          useValue: { isAdmin: () => false, currentUser: () => null, isAuthenticated: () => true },
        },
        { provide: MatDialog, useValue: {} },
        { provide: MatSnackBar, useValue: { open: () => undefined } },
      ],
    });

    const store = TestBed.inject(ReagentsStore);
    http = TestBed.inject(HttpTestingController);
    store.setCasNumber('7647-01-0');
    // Settle the filter's own reload (the first visit to the screen) before
    // the component — the second visit — is created, so only one request is
    // in flight at a time.
    http.expectOne((req) => req.url === 'http://api.test/reagents').flush(reagentsPage(baseReagent));

    fixture = TestBed.createComponent(ReagentsComponent);
    fixture.detectChanges();

    const reagentsRequest = http.expectOne((req) => req.url === 'http://api.test/reagents');
    // The request the retained filter drives must match what the input
    // shows — this is the request setCasNumber() above already queued.
    expect(reagentsRequest.request.params.get('casNumber')).toBe('7647-01-0');
    reagentsRequest.flush(reagentsPage(baseReagent));
    http.expectOne((req) => req.url === 'http://api.test/locations').flush(emptyLocationsPage);

    // The screen must show what it is actually filtering by: an empty box
    // next to a filtered table, with no way to clear it, is the defect.
    expect(fixture.componentInstance.casNumberControl.value).toBe('7647-01-0');
  });
});
