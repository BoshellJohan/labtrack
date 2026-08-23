import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { ChangePasswordRequest } from '@labtrack/shared';
import { API_URL } from '../../core/api/api.config';

@Injectable({ providedIn: 'root' })
export class ProfileService {
  private readonly http = inject(HttpClient);
  private readonly apiUrl = inject(API_URL);

  changePassword(request: ChangePasswordRequest): Observable<void> {
    return this.http.patch<void>(`${this.apiUrl}/auth/password`, request);
  }
}
