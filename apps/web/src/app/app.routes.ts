import { Routes } from '@angular/router';
import { adminGuard, authGuard } from './core/auth/auth.guard';

export const routes: Routes = [
  { path: 'login', loadComponent: () => import('./features/login/login.component').then((m) => m.LoginComponent) },
  {
    path: 'cambiar-contrasena',
    loadComponent: () =>
      import('./features/profile/change-password.component').then((m) => m.ChangePasswordComponent),
  },
  {
    path: 'usuarios',
    canActivate: [authGuard, adminGuard],
    loadComponent: () => import('./features/users/users.component').then((m) => m.UsersComponent),
  },
  {
    path: 'ubicaciones',
    canActivate: [authGuard, adminGuard],
    loadComponent: () =>
      import('./features/locations/locations.component').then((m) => m.LocationsComponent),
  },
  // Any authenticated user may reach the reagents screen: only the
  // management buttons inside it are admin-gated.
  {
    path: 'reactivos',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/reagents/reagents.component').then((m) => m.ReagentsComponent),
  },
  // Any authenticated user records consumption: it is the daily work of the
  // lab, and restricting it would defeat the traceability the system exists
  // for.
  {
    path: 'consumos/registrar',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/consumptions/register-consumption.component').then(
        (m) => m.RegisterConsumptionComponent,
      ),
  },
  // Any authenticated user may consult the consumption history: only the
  // void action inside it is admin-gated.
  {
    path: 'consumos',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/consumptions/consumptions.component').then(
        (m) => m.ConsumptionsComponent,
      ),
  },
  // The home page is the post-login destination for both roles: /usuarios is
  // admin-only, so a non-admin would be bounced straight back out of it.
  {
    path: '',
    pathMatch: 'full',
    canActivate: [authGuard],
    loadComponent: () => import('./features/home/home.component').then((m) => m.HomeComponent),
  },
  { path: '**', redirectTo: '' },
];
