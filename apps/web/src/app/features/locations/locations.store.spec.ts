import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { LocationsStore } from './locations.store';
import { API_URL } from '../../core/api/api.config';

const page = {
  data: [
    {
      id: 'location-1',
      name: 'Estante A1',
      description: null,
      active: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
  ],
  total: 1,
  page: 1,
  pageSize: 20,
  totalPages: 1,
};

describe('LocationsStore', () => {
  let store: LocationsStore;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: API_URL, useValue: 'http://api.test' },
      ],
    });
    store = TestBed.inject(LocationsStore);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('loads the first page on demand', () => {
    store.reload();
    const request = http.expectOne((req) => req.url === 'http://api.test/locations');
    expect(request.request.params.get('page')).toBe('1');
    expect(request.request.params.get('pageSize')).toBe('20');
    request.flush(page);

    expect(store.locations()).toHaveLength(1);
    expect(store.total()).toBe(1);
    expect(store.loading()).toBe(false);
  });

  it('sends the search term and resets to the first page', () => {
    store.setPage(3);
    http.expectOne((req) => req.params.get('page') === '3').flush(page);

    store.setSearch('estante');
    const request = http.expectOne((req) => req.params.get('search') === 'estante');
    expect(request.request.params.get('page')).toBe('1');
    request.flush(page);
  });

  it('sends the new page size and resets to the first page', () => {
    store.setPage(3);
    http.expectOne((req) => req.params.get('page') === '3').flush(page);

    store.setPageSize(50);
    const request = http.expectOne((req) => req.url === 'http://api.test/locations');
    expect(request.request.params.get('pageSize')).toBe('50');
    expect(request.request.params.get('page')).toBe('1');
    request.flush(page);

    expect(store.pageSize()).toBe(50);
    expect(store.page()).toBe(1);
  });

  it('reloads the list after creating a location', () => {
    store.create({ name: 'Estante B2' }).subscribe();
    http.expectOne('http://api.test/locations').flush(page.data[0]);
    http.expectOne((req) => req.url === 'http://api.test/locations').flush(page);

    expect(store.locations()).toHaveLength(1);
  });

  it('reloads the list after updating a location', () => {
    store.update('location-1', { name: 'Estante A2' }).subscribe();
    http.expectOne('http://api.test/locations/location-1').flush(page.data[0]);
    http.expectOne((req) => req.url === 'http://api.test/locations').flush(page);

    expect(store.locations()).toHaveLength(1);
  });

  it('reloads the list after deactivating a location', () => {
    store.deactivate('location-1').subscribe();
    http.expectOne('http://api.test/locations/location-1/deactivate').flush({});
    http.expectOne((req) => req.url === 'http://api.test/locations').flush(page);

    expect(store.locations()).toHaveLength(1);
  });

  it('surfaces a failed load instead of failing silently', () => {
    store.reload();
    http
      .expectOne((req) => req.url === 'http://api.test/locations')
      .flush({ message: 'boom' }, { status: 500, statusText: 'Server Error' });

    expect(store.error()).toBe(true);
    expect(store.loading()).toBe(false);
  });

  it('clears the previous error once a reload succeeds', () => {
    store.reload();
    http
      .expectOne((req) => req.url === 'http://api.test/locations')
      .flush({ message: 'boom' }, { status: 500, statusText: 'Server Error' });
    expect(store.error()).toBe(true);

    store.reload();
    http.expectOne((req) => req.url === 'http://api.test/locations').flush(page);

    expect(store.error()).toBe(false);
  });
});
