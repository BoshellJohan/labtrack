import { Injectable } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { PaginatedStore } from './paginated-store';
import { API_URL } from '../core/api/api.config';

interface Thing {
  id: string;
}

interface ThingFilters {
  name?: string;
}

@Injectable()
class ThingsStore extends PaginatedStore<Thing, ThingFilters> {
  protected readonly path = '/things';
}

const page = {
  data: [{ id: 'thing-1' }],
  total: 1,
  page: 1,
  pageSize: 20,
  totalPages: 1,
};

describe('PaginatedStore', () => {
  let store: ThingsStore;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        ThingsStore,
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: API_URL, useValue: 'http://api.test' },
      ],
    });
    store = TestBed.inject(ThingsStore);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('loads the first page on demand', () => {
    store.reload();
    const request = http.expectOne((req) => req.url === 'http://api.test/things');
    expect(request.request.params.get('page')).toBe('1');
    expect(request.request.params.get('pageSize')).toBe('20');
    request.flush(page);

    expect(store.items()).toHaveLength(1);
    expect(store.total()).toBe(1);
    expect(store.loading()).toBe(false);
  });

  it('requests the given page on setPage', () => {
    store.setPage(3);
    const request = http.expectOne((req) => req.url === 'http://api.test/things');
    expect(request.request.params.get('page')).toBe('3');
    request.flush(page);
  });

  it('resets to the first page on setPageSize', () => {
    store.setPage(3);
    http.expectOne((req) => req.params.get('page') === '3').flush(page);

    store.setPageSize(50);
    const request = http.expectOne((req) => req.url === 'http://api.test/things');
    expect(request.request.params.get('pageSize')).toBe('50');
    expect(request.request.params.get('page')).toBe('1');
    request.flush(page);

    expect(store.pageSize()).toBe(50);
    expect(store.page()).toBe(1);
  });

  it('resets to the first page and sends the filters on setFilters', () => {
    store.setPage(3);
    http.expectOne((req) => req.params.get('page') === '3').flush(page);

    store.setFilters({ name: 'x' });
    const request = http.expectOne((req) => req.url === 'http://api.test/things');
    expect(request.request.params.get('page')).toBe('1');
    expect(request.request.params.get('name')).toBe('x');
    request.flush(page);
  });

  it('surfaces a failed load instead of failing silently', () => {
    store.reload();
    http
      .expectOne((req) => req.url === 'http://api.test/things')
      .flush({ message: 'boom' }, { status: 500, statusText: 'Server Error' });

    expect(store.error()).toBe(true);
    expect(store.loading()).toBe(false);
  });

  it('clears the previous error once a reload succeeds', () => {
    store.reload();
    http
      .expectOne((req) => req.url === 'http://api.test/things')
      .flush({ message: 'boom' }, { status: 500, statusText: 'Server Error' });
    expect(store.error()).toBe(true);

    store.reload();
    http.expectOne((req) => req.url === 'http://api.test/things').flush(page);

    expect(store.error()).toBe(false);
  });

  it('discards a stale response when a newer reload has already started', () => {
    store.setFilters({ name: 'first' });
    const firstRequest = http.expectOne((req) => req.params.get('name') === 'first');

    store.setFilters({ name: 'second' });
    const secondRequest = http.expectOne((req) => req.params.get('name') === 'second');

    // Starting the second reload must cancel the first's still-open request:
    // that is what stops a slow first response from ever landing.
    expect(firstRequest.cancelled).toBe(true);

    const secondPage = {
      data: [{ id: 'thing-2' }],
      total: 1,
      page: 1,
      pageSize: 20,
      totalPages: 1,
    };

    // Answer the newer request; a cancelled request can never be flushed
    // (Angular's testing harness rejects it), which is itself proof the
    // stale one can no longer overwrite `items`.
    secondRequest.flush(secondPage);

    expect(store.items()).toEqual([{ id: 'thing-2' }]);
    expect(store.total()).toBe(1);
    expect(store.loading()).toBe(false);
    expect(store.error()).toBe(false);
  });
});
