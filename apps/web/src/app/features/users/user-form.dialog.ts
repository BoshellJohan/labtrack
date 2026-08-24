import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { CreateUserRequest } from '@labtrack/shared';
import { USERS_ES } from './i18n.es';
import { COMMON_ES } from '../../shared/i18n/es';

@Component({
  selector: 'lt-user-form-dialog',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatButtonModule,
  ],
  template: `
    <h2 mat-dialog-title>{{ text.newUser }}</h2>
    <mat-dialog-content [formGroup]="form">
      <mat-form-field appearance="outline">
        <mat-label>{{ text.form.username }}</mat-label>
        <input matInput formControlName="username" />
      </mat-form-field>

      <mat-form-field appearance="outline">
        <mat-label>{{ text.form.fullName }}</mat-label>
        <input matInput formControlName="fullName" />
      </mat-form-field>

      <mat-form-field appearance="outline">
        <mat-label>{{ text.form.password }}</mat-label>
        <input matInput type="password" formControlName="password" />
        <mat-hint>{{ text.form.passwordHint }}</mat-hint>
      </mat-form-field>

      <mat-form-field appearance="outline">
        <mat-label>{{ text.form.role }}</mat-label>
        <mat-select formControlName="role">
          <mat-option value="USER">{{ text.roles.USER }}</mat-option>
          <mat-option value="ADMIN">{{ text.roles.ADMIN }}</mat-option>
        </mat-select>
      </mat-form-field>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button (click)="dialogRef.close()">{{ common.cancel }}</button>
      <button mat-flat-button color="primary" [disabled]="form.invalid" (click)="confirm()">
        {{ common.save }}
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    mat-dialog-content { display: flex; flex-direction: column; gap: 1rem; padding-top: 0.5rem; }
  `,
})
export class UserFormDialog {
  readonly dialogRef = inject(MatDialogRef<UserFormDialog, CreateUserRequest>);
  readonly text = USERS_ES;
  readonly common = COMMON_ES;

  readonly form = inject(FormBuilder).nonNullable.group({
    username: ['', [Validators.required, Validators.pattern(/^[a-z0-9._-]{3,32}$/)]],
    fullName: ['', [Validators.required, Validators.minLength(3)]],
    password: ['', [Validators.required, Validators.minLength(8)]],
    role: ['USER' as const, Validators.required],
  });

  confirm(): void {
    if (this.form.valid) {
      this.dialogRef.close(this.form.getRawValue());
    }
  }
}
