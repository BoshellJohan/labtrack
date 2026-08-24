import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { provideLocationMocks } from '@angular/common/testing';
import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { routes } from './app.routes';
import { API_URL } from './core/api/api.config';

// Every post-login destination used to point at a route the table did not
// declare, so the wildcard silently sent the user back to the login form.
// These resolve the real table instead of asserting on a hardcoded path.
function setupRouter(user: { role: 'ADMIN' | 'USER' } | null): Router {
  localStorage.clear();
  if (user) {
    localStorage.setItem('labtrack.token', 'token-123');
    localStorage.setItem('labtrack.user', JSON.stringify({ ...user, mustChangePassword: false }));
  }

  TestBed.configureTestingModule({
    providers: [
      provideRouter(routes),
      provideLocationMocks(),
      provideHttpClient(),
      provideHttpClientTesting(),
      { provide: API_URL, useValue: 'http://api.test' },
    ],
  });
  return TestBed.inject(Router);
}

describe('routes', () => {
  it('resolves the home page for an authenticated non-admin', async () => {
    const router = setupRouter({ role: 'USER' });

    await router.navigateByUrl('/');

    expect(router.url).toBe('/');
  });

  it('sends an authenticated admin to the users screen', async () => {
    const router = setupRouter({ role: 'ADMIN' });

    await router.navigateByUrl('/usuarios');

    expect(router.url).toBe('/usuarios');
  });

  it('sends a non-admin asking for the users screen back to the home page', async () => {
    const router = setupRouter({ role: 'USER' });

    await router.navigateByUrl('/usuarios');

    expect(router.url).toBe('/');
  });

  it('sends an unknown url to the home page instead of the login form', async () => {
    const router = setupRouter({ role: 'USER' });

    await router.navigateByUrl('/does-not-exist');

    expect(router.url).toBe('/');
  });

  it('sends an anonymous visitor to the login form', async () => {
    const router = setupRouter(null);

    await router.navigateByUrl('/');

    expect(router.url).toBe('/login');
  });
});
