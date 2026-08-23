import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { of, throwError } from 'rxjs';
import { vi } from 'vitest';
import { LoginComponent } from './login.component';
import { AuthService } from '../../core/auth/auth.service';
import { LOGIN_ES } from '../../shared/i18n/es';

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

describe('LoginComponent', () => {
  let login: ReturnType<typeof vi.fn>;
  let navigate: ReturnType<typeof vi.fn>;

  function createComponent() {
    const fixture = TestBed.createComponent(LoginComponent);
    const component = fixture.componentInstance;
    component.form.setValue({ username: 'ana', password: 'secret' });
    return component;
  }

  beforeEach(() => {
    login = vi.fn();
    navigate = vi.fn();

    TestBed.configureTestingModule({
      imports: [LoginComponent],
      providers: [
        { provide: AuthService, useValue: { login } },
        { provide: Router, useValue: { navigate } },
      ],
    });
  });

  it('navigates to /cambiar-contrasena when the logged-in user must change their password', () => {
    login.mockReturnValue(
      of({ accessToken: 'token-123', user: { ...userDto, mustChangePassword: true } }),
    );
    const component = createComponent();

    component.submit();

    expect(navigate).toHaveBeenCalledWith(['/cambiar-contrasena']);
    expect(component.loading()).toBe(false);
  });

  it('navigates to /reactivos when the logged-in user does not need to change their password', () => {
    login.mockReturnValue(
      of({ accessToken: 'token-123', user: { ...userDto, mustChangePassword: false } }),
    );
    const component = createComponent();

    component.submit();

    expect(navigate).toHaveBeenCalledWith(['/reactivos']);
    expect(component.loading()).toBe(false);
  });

  it('shows the invalid-credentials message and stops loading when login fails', () => {
    login.mockReturnValue(throwError(() => new Error('unauthorized')));
    const component = createComponent();

    component.submit();

    expect(component.errorMessage()).toBe(LOGIN_ES.invalidCredentials);
    expect(component.loading()).toBe(false);
    expect(navigate).not.toHaveBeenCalled();
  });
});
