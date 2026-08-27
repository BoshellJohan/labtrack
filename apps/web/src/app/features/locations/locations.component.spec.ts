import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { LocationsComponent } from './locations.component';
import { LocationsStore } from './locations.store';
import { API_URL } from '../../core/api/api.config';

function locationsPage(location: Record<string, unknown>) {
  return {
    data: [location],
    total: 1,
    page: 1,
    pageSize: 20,
    totalPages: 1,
  };
}

const baseLocation = {
  id: 'location-1',
  name: 'Estante A1',
  description: null,
  active: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('LocationsComponent', () => {
  let fixture: ComponentFixture<LocationsComponent>;
  let http: HttpTestingController;

  function configure() {
    TestBed.configureTestingModule({
      imports: [LocationsComponent],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: API_URL, useValue: 'http://api.test' },
        { provide: MatDialog, useValue: {} },
        { provide: MatSnackBar, useValue: { open: () => undefined } },
      ],
    });
  }

  afterEach(() => http.verify());

  it('lists locations on init', () => {
    configure();
    fixture = TestBed.createComponent(LocationsComponent);
    http = TestBed.inject(HttpTestingController);
    fixture.detectChanges();

    http.expectOne((req) => req.url === 'http://api.test/locations').flush(locationsPage(baseLocation));
  });

  it('seeds the search input from a filter the root-scoped store retained across navigation', () => {
    // LocationsStore is providedIn: 'root', so its filters survive this
    // component being destroyed and recreated (navigating away and back).
    configure();
    const store = TestBed.inject(LocationsStore);
    http = TestBed.inject(HttpTestingController);
    store.setSearch('Estante A1');
    // Settle the filter's own reload (the first visit to the screen) before
    // the component — the second visit — is created, so only one request is
    // in flight at a time.
    http
      .expectOne((req) => req.url === 'http://api.test/locations')
      .flush(locationsPage(baseLocation));

    fixture = TestBed.createComponent(LocationsComponent);
    fixture.detectChanges();

    const request = http.expectOne((req) => req.url === 'http://api.test/locations');
    expect(request.request.params.get('search')).toBe('Estante A1');
    request.flush(locationsPage(baseLocation));

    // The screen must show what it is actually filtering by: an empty box
    // next to a filtered table, with no way to clear it, is the defect.
    expect(fixture.componentInstance.searchControl.value).toBe('Estante A1');
  });
});
