import { TestBed } from '@angular/core/testing';
import { Subject, of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { ApiService } from '../../core/services/api.service';
import { SystemComponent, SystemInfo } from './system.component';

describe('SystemComponent', () => {
  const systemInfo: SystemInfo = {
    appVersion: '1.4.0',
    schemaVersion: '12',
    organization: {
      code: 'acme',
      name: 'Acme Distribution',
      resourceProfile: 'M'
    },
    storageProvider: 's3',
    components: {
      database: { status: 'UP' },
      storage: { status: 'DEGRADED' },
      typesense: { status: 'DISABLED' }
    },
    backup: {
      status: 'SUCCESS',
      completedAt: '2026-09-02T09:00:00Z',
      failureCode: null,
      freshness: 'CURRENT',
      ageSeconds: 3_600,
      maxAgeSeconds: 86_400
    },
    checkedAt: '2026-09-04T10:15:30Z'
  };

  async function createFixture(getResult = of(systemInfo)) {
    const api = { get: vi.fn(() => getResult) };
    await TestBed.configureTestingModule({
      imports: [SystemComponent],
      providers: [{ provide: ApiService, useValue: api }]
    }).compileComponents();
    const fixture = TestBed.createComponent(SystemComponent);
    fixture.detectChanges();
    return { fixture, api };
  }

  it('renders a semantic, non-secret operational summary', async () => {
    const responseWithPrivateFields = {
      ...systemInfo,
      archivePath: 's3://private-backups/backup.tar',
      secretKey: 'must-not-render'
    };
    const { fixture, api } = await createFixture(of(responseWithPrivateFields));

    expect(api.get).toHaveBeenCalledWith('/system/info', undefined, { notifyError: false });
    expect(fixture.nativeElement.querySelector('section[aria-labelledby="system-title"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[data-testid="overall-status"]')?.textContent).toContain('Требует внимания');
    expect(fixture.nativeElement.textContent).toContain('Проверено');
    expect(fixture.nativeElement.querySelector('dl[aria-label="Состояние компонентов"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[data-status="UP"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[data-status="DEGRADED"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('[data-status="DISABLED"]')).not.toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain('s3://private-backups');
    expect(fixture.nativeElement.textContent).not.toContain('must-not-render');
  });

  it.each([
    ['NEVER', 'NOT_APPLICABLE', 'Резервная копия ещё не создавалась', 'attention'],
    ['FAILED', 'NOT_APPLICABLE', 'Последняя резервная копия завершилась ошибкой', 'critical'],
    ['SUCCESS', 'CURRENT', 'Резервная копия актуальна', 'healthy'],
    ['SUCCESS', 'STALE', 'Резервная копия устарела', 'critical'],
    ['SUCCESS', 'NOT_CONFIGURED', 'Порог актуальности резервной копии не настроен', 'attention']
  ] as const)('explains backup status %s with freshness %s', async (status, freshness, expectedText, expectedSeverity) => {
    const { fixture } = await createFixture(of({
      ...systemInfo,
      backup: {
        ...systemInfo.backup,
        status,
        freshness,
        completedAt: status === 'NEVER' ? null : systemInfo.backup.completedAt,
        failureCode: status === 'FAILED' ? 'UPLOAD_FAILED' : null,
        ageSeconds: status === 'SUCCESS' ? systemInfo.backup.ageSeconds : null
      }
    }));

    const backupPanel = fixture.nativeElement.querySelector('[data-testid="backup-status"]');
    expect(backupPanel?.textContent).toContain(expectedText);
    expect(backupPanel?.getAttribute('data-severity')).toBe(expectedSeverity);
    if (status === 'SUCCESS' && freshness !== 'NOT_CONFIGURED') {
      expect(backupPanel?.textContent).toContain('Допустимый возраст: 1 д.');
    }
    expect(fixture.nativeElement.textContent).toContain('резервное копирование, восстановление и обновление выполняются через CLI');
    expect(fixture.nativeElement.querySelector('[data-action="backup"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-action="restore"]')).toBeNull();
    expect(fixture.nativeElement.querySelector('[data-action="update"]')).toBeNull();
  });

  it('shows loading and recoverable error states', async () => {
    const pending = new Subject<SystemInfo>();
    const loading = await createFixture(pending);
    expect(loading.fixture.nativeElement.querySelector('[aria-busy="true"]')).not.toBeNull();

    TestBed.resetTestingModule();
    const failed = await createFixture(throwError(() => ({ status: 503 })));
    expect(failed.fixture.nativeElement.querySelector('[role="alert"]')?.textContent).toContain('Не удалось загрузить состояние системы');
    expect(failed.fixture.nativeElement.querySelector('button[aria-label="Повторить загрузку состояния системы"]')).not.toBeNull();
  });

  it('keeps the last successful snapshot and marks it stale after refresh failure', async () => {
    const { fixture, api } = await createFixture();
    api.get.mockReturnValueOnce(throwError(() => ({ status: 503 })));

    fixture.componentInstance.loadSystemInfo();
    fixture.detectChanges();

    const stale = fixture.nativeElement.querySelector('[data-testid="stale-status"]');
    expect(stale?.textContent).toContain('Не удалось обновить состояние');
    expect(stale?.textContent).toContain('Показаны данные от');
    expect(fixture.nativeElement.textContent).toContain('Acme Distribution');
  });

  it('reports a healthy installation only when components and backup are healthy', async () => {
    const { fixture } = await createFixture(of({
      ...systemInfo,
      components: {
        database: { status: 'UP' },
        storage: { status: 'UP' },
        typesense: { status: 'DISABLED' }
      }
    }));

    const overall = fixture.nativeElement.querySelector('[data-testid="overall-status"]');
    expect(overall?.getAttribute('data-status')).toBe('healthy');
    expect(overall?.textContent).toContain('Система работает');
  });

  it('requires a current backup before reporting the installation as healthy', async () => {
    const { fixture } = await createFixture(of({
      ...systemInfo,
      components: {
        database: { status: 'UP' },
        storage: { status: 'UP' },
        typesense: { status: 'DISABLED' }
      },
      backup: {
        ...systemInfo.backup,
        freshness: 'STALE'
      }
    }));

    const overall = fixture.nativeElement.querySelector('[data-testid="overall-status"]');
    expect(overall?.getAttribute('data-status')).toBe('attention');
  });

  it('omits backup age and max age when not configured or absent', async () => {
    const { fixture } = await createFixture(of({
      ...systemInfo,
      backup: {
        status: 'NEVER',
        freshness: 'NOT_APPLICABLE'
      }
    }));

    const backupPanel = fixture.nativeElement.querySelector('[data-testid="backup-status"]');
    expect(backupPanel?.textContent).toContain('Резервная копия ещё не создавалась');
    expect(backupPanel?.textContent).not.toContain('Допустимый возраст');
    expect(backupPanel?.textContent).not.toContain('Возраст:');
    expect(backupPanel?.textContent).not.toContain('Меньше минуты');
  });
});
