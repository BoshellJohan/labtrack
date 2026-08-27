import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { AuthService } from '../../core/auth/auth.service';
import { HOME_ES } from './i18n.es';

// Landing page for both roles. It exists because every post-login destination
// needs a route both an ADMIN and a USER can reach, and /usuarios is
// admin-only. Phase 2 mounts the reagents screen here.
@Component({
  selector: 'lt-home',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, MatCardModule, MatButtonModule],
  template: `
    <mat-card class="card">
      <h1>{{ text.title }}</h1>
      <p>{{ text.greeting }}, {{ auth.currentUser()?.fullName }}.</p>
      <p>{{ text.pendingPhase }}</p>
      <div class="links">
        <a mat-flat-button color="primary" routerLink="/reactivos">{{ text.reagentsLink }}</a>
        <a mat-flat-button color="primary" routerLink="/consumos/registrar">{{ text.registerConsumptionLink }}</a>
        @if (auth.isAdmin()) {
          <a mat-flat-button color="primary" routerLink="/usuarios">{{ text.usersLink }}</a>
          <a mat-flat-button color="primary" routerLink="/ubicaciones">{{ text.locationsLink }}</a>
        }
      </div>
    </mat-card>
  `,
  styles: `
    .card { max-width: 40rem; margin: 3rem auto; padding: 2rem; display: flex; flex-direction: column; align-items: flex-start; gap: 1rem; }
    .links { display: flex; gap: 1rem; }
  `,
})
export class HomeComponent {
  readonly auth = inject(AuthService);
  readonly text = HOME_ES;
}
