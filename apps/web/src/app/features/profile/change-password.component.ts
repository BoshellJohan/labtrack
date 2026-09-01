import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { AuthService } from '../../core/auth/auth.service';
import { ProfileService } from './profile.service';
import { CHANGE_PASSWORD_ES } from './i18n.es';
import { COMMON_ES } from '../../shared/i18n/es';

@Component({
  selector: 'lt-change-password',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ReactiveFormsModule, MatCardModule, MatFormFieldModule, MatInputModule, MatButtonModule],
  template: `
    <mat-card class="card">
      <h1>{{ text.title }}</h1>
      @if (forced()) {
        <p class="notice">{{ text.forcedNotice }}</p>
      }
      <form [formGroup]="form" (ngSubmit)="submit()">
        <mat-form-field appearance="outline">
          <mat-label>{{ text.currentPassword }}</mat-label>
          <input matInput type="password" formControlName="currentPassword" />
        </mat-form-field>

        <mat-form-field appearance="outline">
          <mat-label>{{ text.newPassword }}</mat-label>
          <input matInput type="password" formControlName="newPassword" />
          @if (form.controls.newPassword.hasError('minlength')) {
            <mat-error>{{ text.tooShort }}</mat-error>
          }
        </mat-form-field>

        <mat-form-field appearance="outline">
          <mat-label>{{ text.confirmPassword }}</mat-label>
          <input matInput type="password" formControlName="confirmPassword" />
        </mat-form-field>

        @if (errorMessage()) {
          <p class="error">{{ errorMessage() }}</p>
        }

        <button mat-flat-button color="primary" type="submit" [disabled]="form.invalid">
          {{ text.submit }}
        </button>
      </form>
    </mat-card>
  `,
  styles: `
    .card { max-width: 28rem; margin: 3rem auto; padding: 2rem; }
    form { display: flex; flex-direction: column; gap: 1rem; }
    .notice { color: var(--mat-sys-primary); }
    .error { color: var(--mat-sys-error); margin: 0; }
  `,
})
export class ChangePasswordComponent {
  private readonly profile = inject(ProfileService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  readonly text = CHANGE_PASSWORD_ES;
  readonly errorMessage = signal<string | null>(null);
  readonly forced = computed(() => this.auth.mustChangePassword());

  readonly form = inject(FormBuilder).nonNullable.group({
    currentPassword: ['', Validators.required],
    newPassword: ['', [Validators.required, Validators.minLength(8)]],
    confirmPassword: ['', Validators.required],
  });

  submit(): void {
    const { currentPassword, newPassword, confirmPassword } = this.form.getRawValue();
    if (newPassword !== confirmPassword) {
      this.errorMessage.set(this.text.mismatch);
      return;
    }

    this.profile.changePassword({ currentPassword, newPassword }).subscribe({
      next: () => {
        const user = this.auth.currentUser();
        if (user) {
          this.auth.setUser({ ...user, mustChangePassword: false });
        }
        void this.router.navigate(['/']);
      },
      error: (error: HttpErrorResponse) =>
        this.errorMessage.set(
          error.error?.code === 'INVALID_CURRENT_PASSWORD'
            ? this.text.wrongCurrent
            : COMMON_ES.unexpectedError,
        ),
    });
  }
}
