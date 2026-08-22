import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { authGuard, adminGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { API_URL } from '../api/api.config';

function setup(user: { role: 'ADMIN' | 'USER' } | null, token: string | null) {
  localStorage.clear();
  if (token) {
    localStorage.setItem('labtrack.token', token);
  }
  if (user) {
    localStorage.setItem('labtrack.user', JSON.stringify({ ...user, mustChangePassword: false }));
  }

  TestBed.configureTestingModule({
    providers: [
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: API_URL, useValue: 'http://api.test' },
      { provide: Router, useValue: { createUrlTree: (commands: string[]) => commands.join('/') } },
    ],
  });
  return TestBed.inject(AuthService);
}

describe('authGuard', () => {
  it('lets an authenticated user through', () => {
    setup({ role: 'USER' }, 'token-123');
    expect(TestBed.runInInjectionContext(() => authGuard())).toBe(true);
  });

  it('redirects an anonymous visitor to login', () => {
    setup(null, null);
    expect(TestBed.runInInjectionContext(() => authGuard())).toBe('/login');
  });
});

describe('adminGuard', () => {
  it('lets an admin through', () => {
    setup({ role: 'ADMIN' }, 'token-123');
    expect(TestBed.runInInjectionContext(() => adminGuard())).toBe(true);
  });

  it('redirects a non-admin to the home page', () => {
    setup({ role: 'USER' }, 'token-123');
    expect(TestBed.runInInjectionContext(() => adminGuard())).toBe('/reactivos');
  });
});
