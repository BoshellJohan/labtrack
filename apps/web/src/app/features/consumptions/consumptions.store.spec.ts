import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { vi } from 'vitest';
import { ConsumptionsStore } from './consumptions.store';
import { API_URL } from '../../core/api/api.config';

const emptyPage = {
  data: [],
  total: 0,
  page: 1,
  pageSize: 20,
  totalPages: 0,
};

describe('ConsumptionsStore', () => {
  let store: ConsumptionsStore;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: API_URL, useValue: 'http://api.test' },
      ],
    });
    store = TestBed.inject(ConsumptionsStore);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('loads the first page on demand', () => {
    store.reload();
    const request = http.expectOne((r) => r.url === 'http://api.test/consumptions');
    expect(request.request.params.get('page')).toBe('1');
    request.flush(emptyPage);

    expect(store.consumptions()).toHaveLength(0);
  });

  it('omits an empty filter instead of sending it as a blank parameter', () => {
    vi.useFakeTimers();
    try {
      store.setPurpose('');
      vi.advanceTimersByTime(300);
      const request = http.expectOne((r) => r.url === 'http://api.test/consumptions');
      expect(request.request.params.has('purpose')).toBe(false);
      request.flush(emptyPage);
    } finally {
      vi.useRealTimers();
    }
  });

  it('changing one filter preserves the others', () => {
    vi.useFakeTimers();
    try {
      store.setReagentId('r1');
      http.expectOne((r) => r.url === 'http://api.test/consumptions').flush(emptyPage);
      store.setPurpose('titulación');
      vi.advanceTimersByTime(300);

      const request = http.expectOne((r) => r.url === 'http://api.test/consumptions');
      expect(request.request.params.get('reagentId')).toBe('r1');
      expect(request.request.params.get('purpose')).toBe('titulación');
      request.flush(emptyPage);
    } finally {
      vi.useRealTimers();
    }
  });

  it('sends the date range as ISO strings, not Date objects', () => {
    store.setDateRange(new Date('2026-08-01T00:00:00.000Z'), new Date('2026-08-31T00:00:00.000Z'));
    const request = http.expectOne((r) => r.url === 'http://api.test/consumptions');
    // A Date in the filter object would compile — the store's serialisation
    // boundary is cast — and then serialize as a locale-dependent string the
    // API rejects.
    expect(request.request.params.get('from')).toBe('2026-08-01T00:00:00.000Z');
    expect(request.request.params.get('to')).toBe('2026-08-31T00:00:00.000Z');
    request.flush(emptyPage);
  });

  it('returns to page 1 when a filter changes', () => {
    vi.useFakeTimers();
    try {
      store.setPage(3);
      http.expectOne((r) => r.url === 'http://api.test/consumptions').flush(emptyPage);
      store.setPurpose('algo');
      vi.advanceTimersByTime(300);

      const request = http.expectOne((r) => r.url === 'http://api.test/consumptions');
      expect(request.request.params.get('page')).toBe('1');
      request.flush(emptyPage);
    } finally {
      vi.useRealTimers();
    }
  });

  it('debounces the purpose search by 300ms while leaving other filters intact', () => {
    vi.useFakeTimers();
    try {
      store.setReagentId('r1');
      http.expectOne((r) => r.url === 'http://api.test/consumptions').flush(emptyPage);

      store.setPurpose('ti');
      store.setPurpose('titu');

      vi.advanceTimersByTime(299);
      http.expectNone((r) => r.url === 'http://api.test/consumptions');

      vi.advanceTimersByTime(1);
      const request = http.expectOne((r) => r.url === 'http://api.test/consumptions');
      expect(request.request.params.get('purpose')).toBe('titu');
      expect(request.request.params.get('reagentId')).toBe('r1');
      request.flush(emptyPage);
    } finally {
      vi.useRealTimers();
    }
  });

  it('reloads the list after voiding a consumption', () => {
    store.voidConsumption('c1', { voidReason: 'Registrado por error' }).subscribe();
    http.expectOne('http://api.test/consumptions/c1/void').flush({});
    http.expectOne((r) => r.url === 'http://api.test/consumptions').flush(emptyPage);

    expect(store.consumptions()).toHaveLength(0);
  });
});
