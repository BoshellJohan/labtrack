import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { UsersStore } from './users.store';
import { API_URL } from '../../core/api/api.config';

const page = {
  data: [
    {
      id: 'user-1',
      username: 'ana',
      fullName: 'Ana Ruiz',
      role: 'USER',
      mustChangePassword: false,
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

describe('UsersStore', () => {
  let store: UsersStore;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: API_URL, useValue: 'http://api.test' },
      ],
    });
    store = TestBed.inject(UsersStore);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('loads the first page on demand', () => {
    store.reload();
    const request = http.expectOne((req) => req.url === 'http://api.test/users');
    expect(request.request.params.get('page')).toBe('1');
    expect(request.request.params.get('pageSize')).toBe('20');
    request.flush(page);

    expect(store.users()).toHaveLength(1);
    expect(store.total()).toBe(1);
    expect(store.loading()).toBe(false);
  });

  it('sends the search term and resets to the first page', () => {
    store.setPage(3);
    http.expectOne((req) => req.params.get('page') === '3').flush(page);

    store.setSearch('ana');
    const request = http.expectOne((req) => req.params.get('search') === 'ana');
    expect(request.request.params.get('page')).toBe('1');
    request.flush(page);
  });

  it('reloads the list after deactivating a user', () => {
    store.deactivate('user-1').subscribe();
    http.expectOne('http://api.test/users/user-1/deactivate').flush({});
    http.expectOne((req) => req.url === 'http://api.test/users').flush(page);

    expect(store.users()).toHaveLength(1);
  });
});
