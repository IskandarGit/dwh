import { Injectable, inject, signal } from '@angular/core';
import { Observable, tap } from 'rxjs';
import { ApiService } from './api.service';

export interface InstalledModule {
  code: string;
  name: string;
  description?: string | null;
  version: string;
  icon?: string | null;
  route?: string | null;
  isSystem: boolean;
  status: 'ACTIVE' | 'DISABLED';
  sortOrder?: number;
  attributes?: Record<string, any>;
  createdAt?: string;
  modifiedAt?: string;
  isActive?: boolean;
  moduleCode?: string;
}

const SYSTEM_MODULES = new Set(['iam', 'tasks', 'files', 'audit', 'search']);

@Injectable({ providedIn: 'root' })
export class ModuleService {
  private readonly api = inject(ApiService);

  readonly modules = signal<InstalledModule[]>([]);
  readonly activeModuleCodes = signal<Set<string>>(new Set(SYSTEM_MODULES));
  readonly isLoading = signal(false);
  readonly isLoaded = signal(false);

  loadActiveModules(): Observable<InstalledModule[]> {
    this.isLoading.set(true);
    return this.api.get<any[]>('/modules/active').pipe(
      tap({
        next: data => {
          const list = this.normalizeModules(data || []);
          const activeSet = new Set<string>(SYSTEM_MODULES);
          for (const m of list) {
            if (m.isActive) {
              activeSet.add(m.code.toLowerCase());
            }
          }
          this.activeModuleCodes.set(activeSet);
          this.modules.set(list);
          this.isLoaded.set(true);
          this.isLoading.set(false);
        },
        error: () => {
          this.isLoading.set(false);
        }
      })
    );
  }

  loadAllModules(): Observable<InstalledModule[]> {
    this.isLoading.set(true);
    return this.api.get<any[]>('/modules').pipe(
      tap({
        next: data => {
          const list = this.normalizeModules(data || []);
          const activeSet = new Set<string>(SYSTEM_MODULES);
          for (const m of list) {
            if (m.isActive) {
              activeSet.add(m.code.toLowerCase());
            }
          }
          this.activeModuleCodes.set(activeSet);
          this.modules.set(list);
          this.isLoaded.set(true);
          this.isLoading.set(false);
        },
        error: () => {
          this.isLoading.set(false);
        }
      })
    );
  }

  isModuleActive(code: string): boolean {
    const normalized = (code || '').toLowerCase().trim();
    if (SYSTEM_MODULES.has(normalized)) {
      return true;
    }
    if (!this.isLoaded()) {
      return true; // Avoid flickering before initial load completes
    }
    return this.activeModuleCodes().has(normalized);
  }

  getActiveCustomModules(): InstalledModule[] {
    return this.modules().filter(
      m => !m.isSystem && m.isActive && m.route && m.code.toLowerCase() !== 'notes'
    );
  }

  toggleModule(code: string, enabled: boolean): Observable<InstalledModule> {
    const normalizedCode = code.toLowerCase().trim();
    return this.api.post<any>(`/modules/${encodeURIComponent(normalizedCode)}/toggle`, { enabled }).pipe(
      tap(updated => {
        const normalized = this.normalizeSingle(updated, normalizedCode, enabled);
        this.modules.update(list => {
          const existing = list.some(m => m.code === normalizedCode);
          if (existing) {
            return list.map(m => (m.code === normalizedCode ? normalized : m));
          }
          return [...list, normalized];
        });

        this.activeModuleCodes.update(current => {
          const updatedSet = new Set(current);
          if (normalized.isActive) {
            updatedSet.add(normalizedCode);
          } else {
            updatedSet.delete(normalizedCode);
          }
          return updatedSet;
        });
      })
    );
  }

  private normalizeModules(data: any[]): InstalledModule[] {
    return data.map(m => {
      const code = (m.code || m.moduleCode || '').toLowerCase().trim();
      const isActive = m.status ? m.status === 'ACTIVE' : (m.isActive ?? true);
      return {
        ...m,
        code,
        moduleCode: code,
        isActive,
        status: isActive ? 'ACTIVE' : 'DISABLED'
      };
    });
  }

  private normalizeSingle(m: any, fallbackCode: string, fallbackActive: boolean): InstalledModule {
    const code = (m?.code || m?.moduleCode || fallbackCode).toLowerCase().trim();
    const isActive = m?.status ? m.status === 'ACTIVE' : (m?.isActive ?? fallbackActive);
    return {
      ...m,
      code,
      moduleCode: code,
      isActive,
      status: isActive ? 'ACTIVE' : 'DISABLED'
    };
  }
}