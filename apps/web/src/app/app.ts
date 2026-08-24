import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { Router, RouterLink, RouterOutlet } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatToolbarModule } from '@angular/material/toolbar';
import { AuthService } from './core/auth/auth.service';
import { COMMON_ES } from './shared/i18n/es';

@Component({
  selector: 'lt-root',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterOutlet, RouterLink, MatToolbarModule, MatButtonModule],
  styleUrl: './app.scss',
  templateUrl: './app.html',
})
export class App {
  readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  readonly common = COMMON_ES;

  logout(): void {
    this.auth.logout();
    void this.router.navigate(['/login']);
  }
}
