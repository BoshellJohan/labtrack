import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { vi } from 'vitest';
import { ReagentsStore } from './reagents.store';
import { API_URL } from '../../core/api/api.config';

const page = {
  data: [
    {
      id: 'reagent-1',
      name: 'Ácido clorhídrico',
      casNumber: '7647-01-0',
      reference: null,
      description: null,
      dataSheetUrl: null,
      active: true,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      stockByUnit: [{ unit: 'ML', total: '500.0000' }],
      batchCount: 1,
    },
  ],
  total: 1,
  page: 1,
  pageSize: 20,
  totalPages: 1,
};

describe('ReagentsStore', () => {
  let store: ReagentsStore;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: API_URL, useValue: 'http://api.test' },
      ],
    });
    store = TestBed.inject(ReagentsStore);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('loads the first page on demand', () => {
    store.reload();
    const request = http.expectOne((req) => req.url === 'http://api.test/reagents');
    expect(request.request.params.get('page')).toBe('1');
    expect(request.request.params.get('pageSize')).toBe('20');
    request.flush(page);

    expect(store.reagents()).toHaveLength(1);
    expect(store.total()).toBe(1);
    expect(store.loading()).toBe(false);
  });

  it('does not send an empty filter as a request parameter', () => {
    store.setCasNumber('');
    const request = http.expectOne((req) => req.url === 'http://api.test/reagents');
    expect(request.request.params.has('casNumber')).toBe(false);
    request.flush(page);
  });

  it('sends the CAS number filter and resets to the first page', () => {
    store.setPage(3);
    http.expectOne((req) => req.params.get('page') === '3').flush(page);

    store.setCasNumber('7647-01-0');
    const request = http.expectOne((req) => req.params.get('casNumber') === '7647-01-0');
    expect(request.request.params.get('page')).toBe('1');
    request.flush(page);
  });

  it('sends the location filter and resets to the first page', () => {
    store.setPage(3);
    http.expectOne((req) => req.params.get('page') === '3').flush(page);

    store.setLocationId('location-1');
    const request = http.expectOne((req) => req.params.get('locationId') === 'location-1');
    expect(request.request.params.get('page')).toBe('1');
    request.flush(page);
  });

  // setFilters on PaginatedStore replaces the whole filter object rather than
  // merging it: with three independent filters, changing one must not erase
  // the other two.
  it('changing one filter preserves the other two', () => {
    store.setCasNumber('7647-01-0');
    http.expectOne((req) => req.params.get('casNumber') === '7647-01-0').flush(page);

    store.setLocationId('location-1');
    const afterLocation = http.expectOne((req) => req.params.get('locationId') === 'location-1');
    expect(afterLocation.request.params.get('casNumber')).toBe('7647-01-0');
    afterLocation.flush(page);
  });

  it('debounces the name search by 300ms before writing it to the store', () => {
    vi.useFakeTimers();
    try {
      store.reload();
      http.expectOne((req) => req.url === 'http://api.test/reagents').flush(page);

      store.setCasNumber('7647-01-0');
      http.expectOne((req) => req.params.get('casNumber') === '7647-01-0').flush(page);

      store.setName('acido');

      vi.advanceTimersByTime(299);
      http.expectNone((req) => req.params.has('name'));

      vi.advanceTimersByTime(1);
      const request = http.expectOne((req) => req.params.get('name') === 'acido');
      // The other filter set earlier must still be present once the debounced
      // name filter finally lands.
      expect(request.request.params.get('casNumber')).toBe('7647-01-0');
      expect(request.request.params.get('page')).toBe('1');
      request.flush(page);
    } finally {
      vi.useRealTimers();
    }
  });

  it('resets to the first page when a filter changes', () => {
    store.setPage(3);
    http.expectOne((req) => req.params.get('page') === '3').flush(page);

    store.setCasNumber('7647-01-0');
    const request = http.expectOne((req) => req.params.get('casNumber') === '7647-01-0');
    expect(request.request.params.get('page')).toBe('1');
    request.flush(page);

    expect(store.page()).toBe(1);
  });

  it('reloads the list after creating a reagent', () => {
    store.create({ name: 'Etanol', casNumber: '64-17-5' }).subscribe();
    http.expectOne('http://api.test/reagents').flush(page.data[0]);
    http.expectOne((req) => req.url === 'http://api.test/reagents').flush(page);

    expect(store.reagents()).toHaveLength(1);
  });

  it('reloads the list after updating a reagent', () => {
    store.update('reagent-1', { reference: 'REF-1' }).subscribe();
    http.expectOne('http://api.test/reagents/reagent-1').flush(page.data[0]);
    http.expectOne((req) => req.url === 'http://api.test/reagents').flush(page);

    expect(store.reagents()).toHaveLength(1);
  });

  it('reloads the list after deactivating a reagent', () => {
    store.deactivate('reagent-1').subscribe();
    http.expectOne('http://api.test/reagents/reagent-1/deactivate').flush(page.data[0]);
    http.expectOne((req) => req.url === 'http://api.test/reagents').flush(page);

    expect(store.reagents()).toHaveLength(1);
  });

  it('surfaces a failed load instead of failing silently', () => {
    store.reload();
    http
      .expectOne((req) => req.url === 'http://api.test/reagents')
      .flush({ message: 'boom' }, { status: 500, statusText: 'Server Error' });

    expect(store.error()).toBe(true);
    expect(store.loading()).toBe(false);
  });
});
