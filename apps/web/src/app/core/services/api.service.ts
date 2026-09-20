import { Injectable, untracked } from '@angular/core';
import { HttpClient, HttpErrorResponse, HttpHeaders, HttpParams } from '@angular/common/http';
import { Observable, throwError } from 'rxjs';
import { catchError } from 'rxjs/operators';
import { ProblemDetail } from '../models/common.models';
import { ToastService } from './toast.service';
import { I18nService } from './i18n.service';

export interface ApiRequestOptions {
  notifyError?: boolean;
}

@Injectable({
  providedIn: 'root'
})
export class ApiService {
  private readonly baseUrl = '/api/v1';

  constructor(
    private http: HttpClient,
    private toast: ToastService,
    private i18n: I18nService
  ) {}

  private getXsrfToken(): string | null {
    if (typeof document === 'undefined') return null;
    const match = document.cookie.match(/(?:^|;\s*)XSRF-TOKEN=([^;]*)/);
    return match ? decodeURIComponent(match[1]) : null;
  }

  private getHeaders(): HttpHeaders {
    let headers = new HttpHeaders();
    const lang = untracked(() => this.i18n?.currentLang ? this.i18n.currentLang() : null);
    if (lang) {
      headers = headers.set('Accept-Language', lang);
    }
    const xsrf = this.getXsrfToken();
    if (xsrf) {
      headers = headers.set('X-XSRF-TOKEN', xsrf);
    }
    return headers;
  }

  get<T>(path: string, params?: Record<string, any>, options: ApiRequestOptions = {}): Observable<T> {
    let httpParams = new HttpParams();
    if (params) {
      Object.keys(params).forEach(key => {
        if (params[key] !== undefined && params[key] !== null && params[key] !== '') {
          httpParams = httpParams.set(key, params[key].toString());
        }
      });
    }

    return this.http.get<T>(`${this.baseUrl}${path}`, {
      params: httpParams,
      headers: this.getHeaders(),
      withCredentials: true
    }).pipe(
      catchError(err => this.handleError(err, options))
    );
  }

  post<T>(path: string, body?: any, options: ApiRequestOptions = {}): Observable<T> {
    return this.http.post<T>(`${this.baseUrl}${path}`, body || {}, {
      headers: this.getHeaders(),
      withCredentials: true
    }).pipe(
      catchError(err => this.handleError(err, options))
    );
  }

  patch<T>(path: string, body?: any, options: ApiRequestOptions = {}): Observable<T> {
    return this.http.patch<T>(`${this.baseUrl}${path}`, body || {}, {
      headers: this.getHeaders(),
      withCredentials: true
    }).pipe(
      catchError(err => this.handleError(err, options))
    );
  }

  put<T>(path: string, body?: any, options: ApiRequestOptions = {}): Observable<T> {
    return this.http.put<T>(`${this.baseUrl}${path}`, body || {}, {
      headers: this.getHeaders(),
      withCredentials: true
    }).pipe(
      catchError(err => this.handleError(err, options))
    );
  }

  delete<T>(path: string, options: ApiRequestOptions = {}): Observable<T> {
    return this.http.delete<T>(`${this.baseUrl}${path}`, {
      headers: this.getHeaders(),
      withCredentials: true
    }).pipe(
      catchError(err => this.handleError(err, options))
    );
  }

  private handleError(error: HttpErrorResponse, options: ApiRequestOptions = {}): Observable<never> {
    let problem: ProblemDetail;

    if (error.error && typeof error.error === 'object') {
      const p = error.error as any;
      let detail = p.detail || p.message;
      const errorCode = String(p.code || 'API_ERROR').toLowerCase();
      const errorKey = `error.${errorCode}`;
      const localizedDetail = this.i18n.translate(errorKey);
      if (localizedDetail !== errorKey) {
        detail = localizedDetail;
      }
      if (Array.isArray(p.invalid_params) && p.invalid_params.length > 0) {
        const fieldMsgs = p.invalid_params.map((ip: any) => `${ip.name}: ${ip.reason || ip.code}`).join('; ');
        detail = detail ? `${detail} (${fieldMsgs})` : fieldMsgs;
      }
      problem = {
        title: p.title || 'Ошибка',
        status: error.status || 400,
        code: p.code || 'API_ERROR',
        detail: detail || p.title || 'Произошла ошибка при выполнении операции',
        errors: Array.isArray(p.errors) ? p.errors : undefined,
        invalid_params: p.invalid_params
      };
    } else {
      problem = {
        title: 'Ошибка соединения',
        status: error.status || 500,
        code: 'NETWORK_ERROR',
        detail: error.status === 0 ? 'Сервер недоступен или отсутствует соединение с сетью' : (error.message || 'Не удалось выполнить запрос')
      };
    }

    const retryAfter = error.headers?.get('Retry-After');
    if (retryAfter != null && /^\d+$/.test(retryAfter) && Number.isSafeInteger(Number(retryAfter))) {
      problem.retryAfterSeconds = Number(retryAfter);
    }

    // Don't toast 401 on initial /auth/me verification or normal 404 search
    const isAuthCheck = error.status === 401 && error.url?.includes('/auth/me');
    if (!isAuthCheck && options.notifyError !== false) {
      this.toast.error(problem.detail || problem.title);
    }

    return throwError(() => problem);
  }

}
