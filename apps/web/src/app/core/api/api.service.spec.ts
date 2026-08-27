import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ApiService } from './api.service';
import { API_URL } from './api.config';

describe('ApiService', () => {
  let api: ApiService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: API_URL, useValue: 'http://api.test' },
      ],
    });
    api = TestBed.inject(ApiService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('builds the URL from the token and the path', () => {
    api.get('/locations').subscribe();
    http.expectOne('http://api.test/locations').flush({});
  });

  it('omits empty and undefined params instead of sending blanks', () => {
    api.getPage('/reagents', { page: 1, name: '', casNumber: undefined }).subscribe();
    const request = http.expectOne((req) => req.url === 'http://api.test/reagents');
    expect(request.request.params.get('page')).toBe('1');
    expect(request.request.params.has('name')).toBe(false);
    expect(request.request.params.has('casNumber')).toBe(false);
    request.flush({ data: [], total: 0, page: 1, pageSize: 20, totalPages: 0 });
  });

  it('serialises booleans and numbers', () => {
    api.getPage('/reagents', { includeInactive: true, pageSize: 50 }).subscribe();
    const request = http.expectOne((req) => req.url === 'http://api.test/reagents');
    expect(request.request.params.get('includeInactive')).toBe('true');
    expect(request.request.params.get('pageSize')).toBe('50');
    request.flush({ data: [], total: 0, page: 1, pageSize: 50, totalPages: 0 });
  });
});
