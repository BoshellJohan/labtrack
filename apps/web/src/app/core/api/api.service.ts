import { Injectable, inject } from '@angular/core';
import { HttpClient, HttpParams, HttpResponse } from '@angular/common/http';
import { Observable } from 'rxjs';
import { PaginatedResponse } from '@labtrack/shared';
import { API_URL } from './api.config';

export type QueryParams = Record<string, string | number | boolean | undefined | null>;

@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = inject(API_URL);

  get<T>(path: string): Observable<T> {
    return this.http.get<T>(`${this.baseUrl}${path}`);
  }

  getPage<T>(path: string, params: QueryParams = {}): Observable<PaginatedResponse<T>> {
    return this.http.get<PaginatedResponse<T>>(`${this.baseUrl}${path}`, {
      params: toHttpParams(params),
    });
  }

  post<T>(path: string, body: unknown): Observable<T> {
    return this.http.post<T>(`${this.baseUrl}${path}`, body);
  }

  patch<T>(path: string, body: unknown): Observable<T> {
    return this.http.patch<T>(`${this.baseUrl}${path}`, body);
  }

  // Posts a multipart body (a file upload). Deliberately does not set
  // Content-Type: the browser must compute the multipart boundary itself,
  // and an explicit header here strips it, which the server then reads as a
  // malformed request rather than the missing header it actually is.
  postFormData<T>(path: string, formData: FormData): Observable<T> {
    return this.http.post<T>(`${this.baseUrl}${path}`, formData);
  }

  // Builds the same URL a request to this path/params would hit, without
  // issuing one. This exists to let a component show "this is what would be
  // exported" (e.g. for a test to assert the filters reached the link) — it
  // must never be used as an `<a href>` for an authenticated endpoint: a
  // plain browser navigation carries no Authorization header, so a route
  // behind JwtAuthGuard would answer 401. Use downloadBlob for the actual
  // download.
  downloadUrl(path: string, params: QueryParams = {}): string {
    const query = toHttpParams(params).toString();
    return query ? `${this.baseUrl}${path}?${query}` : `${this.baseUrl}${path}`;
  }

  // Fetches a file through HttpClient (so the auth interceptor attaches the
  // token, unlike a plain <a href>) and hands back the full response so the
  // caller can read the server-chosen filename off Content-Disposition.
  downloadBlob(path: string, params: QueryParams = {}): Observable<HttpResponse<Blob>> {
    return this.http.get(`${this.baseUrl}${path}`, {
      params: toHttpParams(params),
      responseType: 'blob',
      observe: 'response',
    });
  }
}

// An empty filter must not become `?name=`: the API would read that as a filter
// for the empty string rather than as no filter at all.
function toHttpParams(params: QueryParams): HttpParams {
  let httpParams = new HttpParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    httpParams = httpParams.set(key, String(value));
  }
  return httpParams;
}
