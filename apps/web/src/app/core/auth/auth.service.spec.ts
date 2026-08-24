import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { AuthService } from './auth.service';
import { API_URL } from '../api/api.config';

const userDto = {
  id: 'user-1',
  username: 'ana',
  fullName: 'Ana Ruiz',
  role: 'USER' as const,
  mustChangePassword: false,
  active: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('AuthService', () => {
  let service: AuthService;
  let http: HttpTestingController;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: API_URL, useValue: 'http://api.test' },
      ],
    });
    service = TestBed.inject(AuthService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('starts with no authenticated user', () => {
    expect(service.currentUser()).toBeNull();
    expect(service.isAuthenticated()).toBe(false);
  });

  it('stores the token and user after a successful login', () => {
    service.login({ username: 'ana', password: 'secret' }).subscribe();

    http
      .expectOne('http://api.test/auth/login')
      .flush({ accessToken: 'token-123', user: userDto });

    expect(service.token()).toBe('token-123');
    expect(service.currentUser()?.username).toBe('ana');
    expect(service.isAuthenticated()).toBe(true);
    expect(service.isAdmin()).toBe(false);
  });

  it('reports admin privileges only for the ADMIN role', () => {
    service.login({ username: 'admin', password: 'secret' }).subscribe();

    http
      .expectOne('http://api.test/auth/login')
      .flush({ accessToken: 'token-123', user: { ...userDto, role: 'ADMIN' } });

    expect(service.isAdmin()).toBe(true);
  });

  it('clears the session on logout', () => {
    service.login({ username: 'ana', password: 'secret' }).subscribe();
    http.expectOne('http://api.test/auth/login').flush({ accessToken: 'token-123', user: userDto });

    service.logout();

    expect(service.token()).toBeNull();
    expect(service.currentUser()).toBeNull();
    expect(localStorage.getItem('labtrack.token')).toBeNull();
  });
});
