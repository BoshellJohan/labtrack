import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideAnimationsAsync } from '@angular/platform-browser/animations/async';
import { MatPaginatorIntl } from '@angular/material/paginator';
import { routes } from './app.routes';
import { authInterceptor } from './core/auth/auth.interceptor';
import { API_URL } from './core/api/api.config';
import { createSpanishPaginatorIntl } from './shared/i18n/spanish-paginator-intl';
import { environment } from '../environments/environment';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideRouter(routes),
    provideHttpClient(withInterceptors([authInterceptor])),
    provideAnimationsAsync(),
    { provide: API_URL, useValue: environment.apiUrl },
    { provide: MatPaginatorIntl, useFactory: createSpanishPaginatorIntl },
  ],
};
