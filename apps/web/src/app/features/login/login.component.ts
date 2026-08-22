import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { AuthService } from '../../core/auth/auth.service';
import { LOGIN_ES } from '../../shared/i18n/es';

@Component({
  selector: 'lt-login',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
  ],
  template: `
    <mat-card class="login-card">
      <h1>{{ text.title }}</h1>
      <form [formGroup]="form" (ngSubmit)="submit()">
        <mat-form-field appearance="outline">
          <mat-label>{{ text.username }}</mat-label>
          <input matInput formControlName="username" autocomplete="username" />
        </mat-form-field>

        <mat-form-field appearance="outline">
          <mat-label>{{ text.password }}</mat-label>
          <input matInput type="password" formControlName="password" autocomplete="current-password" />
        </mat-form-field>

        @if (errorMessage()) {
          <p class="error">{{ errorMessage() }}</p>
        }

        <button mat-flat-button color="primary" type="submit" [disabled]="form.invalid || loading()">
          {{ text.submit }}
        </button>
      </form>
    </mat-card>
  `,
  styles: `
    .login-card { max-width: 24rem; margin: 4rem auto; padding: 2rem; }
    form { display: flex; flex-direction: column; gap: 1rem; }
    .error { color: var(--mat-sys-error, #b3261e); margin: 0; }
  `,
})
export class LoginComponent {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  readonly text = LOGIN_ES;
  readonly loading = signal(false);
  readonly errorMessage = signal<string | null>(null);

  readonly form = inject(FormBuilder).nonNullable.group({
    username: ['', Validators.required],
    password: ['', Validators.required],
  });

  submit(): void {
    if (this.form.invalid) {
      return;
    }
    this.loading.set(true);
    this.errorMessage.set(null);

    this.auth.login(this.form.getRawValue()).subscribe({
      next: (response) => {
        this.loading.set(false);
        const destination = response.user.mustChangePassword ? '/cambiar-contrasena' : '/reactivos';
        void this.router.navigate([destination]);
      },
      error: () => {
        this.loading.set(false);
        this.errorMessage.set(this.text.invalidCredentials);
      },
    });
  }
}
