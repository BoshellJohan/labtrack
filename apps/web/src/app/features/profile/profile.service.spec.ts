import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { ProfileService } from './profile.service';
import { API_URL } from '../../core/api/api.config';

describe('ProfileService', () => {
  let service: ProfileService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: API_URL, useValue: 'http://api.test' },
      ],
    });
    service = TestBed.inject(ProfileService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('sends the current and new password to the API', () => {
    service.changePassword({ currentPassword: 'old-pass', newPassword: 'new-pass1' }).subscribe();

    const request = http.expectOne('http://api.test/auth/password');
    expect(request.request.method).toBe('PATCH');
    expect(request.request.body).toEqual({ currentPassword: 'old-pass', newPassword: 'new-pass1' });
    request.flush(null);
  });
});
