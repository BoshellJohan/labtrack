import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { AuthService } from './auth.service';

// Not annotated as `CanActivateFn`: that type requires two positional
// parameters (route, state) that these guards never use. Leaving the
// implementation's own (zero-parameter) signature to be inferred keeps the
// guards callable with no arguments in tests while remaining structurally
// assignable to `Route.canActivate` (TypeScript permits a function with
// fewer parameters than the target type wherever a `CanActivateFn` is
// expected).
export const authGuard = () => {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (!auth.isAuthenticated()) {
    return router.createUrlTree(['/login']);
  }
  if (auth.mustChangePassword()) {
    return router.createUrlTree(['/cambiar-contrasena']);
  }
  return true;
};

export const adminGuard = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  return auth.isAdmin() ? true : router.createUrlTree(['/reactivos']);
};
