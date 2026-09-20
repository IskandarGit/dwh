import { ChangeDetectionStrategy, Component, OnInit, signal, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ApiService } from '../../core/services/api.service';
import { UiButtonComponent } from '../../shared/ui/ui-button.component';
import { TranslatePipe, I18nService } from '../../core/services/i18n.service';

export interface SystemInfo {
  appVersion: string;
  schemaVersion: string;
  organization: {
    code: string;
    name: string;
    resourceProfile: string;
  };
  storageProvider: string;
  components: Record<string, { status: string }>;
  backup: {
    status: string;
    completedAt?: string | null;
    failureCode?: string | null;
    freshness: string;
    ageSeconds?: number | null;
    maxAgeSeconds?: number | null;
  };
  checkedAt: string;
}

type OverallStatus = 'healthy' | 'attention' | 'unavailable';

@Component({
  selector: 'app-system',
  standalone: true,
  imports: [
    TranslatePipe,CommonModule, UiButtonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="system-page" aria-labelledby="system-title">
      <header class="view-header">
        <div>
          <p class="eyebrow">{{ 'system.lokalnaya_ustanovka' | t }}</p>
          <h1 id="system-title">{{ 'system.sostoyanie_sistemy' | t }}</h1>
          <p class="subtitle">{{ 'system.diagnostika_etoy_ustanovki_bez_vneshney_telemetr' | t }}</p>
        </div>
        <ui-button
          variant="secondary"
          icon="refresh"
          [loading]="isLoading()"
          [ariaLabel]="'system.obnovit_sostoyanie_sistemy' | t"
          (onClick)="loadSystemInfo()"
        >{{ 'common.refresh' | t }}</ui-button>
      </header>

      <div *ngIf="isLoading() && !systemInfo()" class="state-panel" aria-busy="true" aria-live="polite">
        <span class="spinner" aria-hidden="true"></span>
        <span>{{ 'system.proveryaem_lokalnye_komponenty' | t }}</span>
      </div>

      <div *ngIf="loadError() && !systemInfo()" class="state-panel error-state" role="alert">
        <span class="material-symbols-outlined" aria-hidden="true">cloud_off</span>
        <div>
          <h2>{{ 'system.ne_udalos_zagruzit_sostoyanie_sistemy' | t }}</h2>
          <p>{{ 'system.proverte_dostupnost_servera_i_povtorite_zapros' | t }}</p>
        </div>
        <ui-button
          variant="secondary"
          [ariaLabel]="'system.povtorit_zagruzku_sostoyaniya_sistemy' | t"
          (onClick)="loadSystemInfo()"
        >{{ 'announcements.povtorit' | t }}</ui-button>
      </div>

      <ng-container *ngIf="systemInfo() as info">
        <div *ngIf="loadError()" class="stale-state" data-testid="stale-status" role="status">
          <span class="material-symbols-outlined" aria-hidden="true">sync_problem</span>
          <div>
            <strong>{{ 'system.refresh_failed' | t }}</strong>
            <p>{{ 'system.showing_data_from' | t }} <time [attr.datetime]="info.checkedAt">{{ info.checkedAt | date:'dd.MM.yyyy, HH:mm:ss' }}</time></p>
          </div>
          <ui-button
            variant="secondary"
            [ariaLabel]="'system.povtorit_zagruzku_sostoyaniya_sistemy' | t"
            (onClick)="loadSystemInfo()"
          >{{ 'announcements.povtorit' | t }}</ui-button>
        </div>

        <section
          class="overall-status"
          data-testid="overall-status"
          [attr.data-status]="overallStatus(info)"
          aria-labelledby="overall-status-title"
        >
          <span class="overall-icon material-symbols-outlined" aria-hidden="true">{{ overallStatusIcon(info) }}</span>
          <div class="overall-copy">
            <span class="overall-kicker">{{ 'system.overall_status' | t }}</span>
            <h2 id="overall-status-title">{{ overallStatusLabel(info) }}</h2>
            <p>{{ overallStatusDescription(info) }}</p>
          </div>
          <time class="checked-at" [attr.datetime]="info.checkedAt">
            {{ 'system.checked_at' | t }} {{ info.checkedAt | date:'dd.MM.yyyy, HH:mm:ss' }}
          </time>
        </section>

        <div class="content-grid">
          <article class="panel">
            <div class="panel-heading">
              <div>
                <h2>{{ 'system.komponenty' | t }}</h2>
                <p>{{ 'system.tekuschee_sostoyanie_obyazatelnyh_i_opcionalnyh_' | t }}</p>
              </div>
            </div>
            <dl class="component-list" [attr.aria-label]="'system.sostoyanie_komponentov' | t">
              <div *ngFor="let component of componentEntries(info)" class="component-row">
                <dt>{{ componentLabel(component.name) }}</dt>
                <dd>
                  <span class="status-pill" [attr.data-status]="component.status" [class]="'status-pill status-' + statusClass(component.status)">
                    <span class="status-dot" aria-hidden="true"></span>
                    {{ statusLabel(component.status) }}
                  </span>
                </dd>
              </div>
            </dl>
          </article>

          <article class="panel" data-testid="backup-status" [attr.data-severity]="backupSeverity(info.backup)">
            <div class="panel-heading">
              <div>
                <h2>{{ 'system.rezervnoe_kopirovanie' | t }}</h2>
                <p>{{ 'system.posledniy_rezultat_lokalnogo_backup_sidecar' | t }}</p>
              </div>
              <span class="material-symbols-outlined panel-icon" aria-hidden="true">database</span>
            </div>
            <div class="backup-result" role="status">
              <span class="backup-icon material-symbols-outlined" aria-hidden="true">{{ backupIcon(info.backup) }}</span>
              <div>
                <strong>{{ backupStatusLabel(info.backup) }}</strong>
                <p *ngIf="info.backup.completedAt">{{ info.backup.completedAt | date:'dd.MM.yyyy, HH:mm:ss' }}</p>
                <p *ngIf="info.backup.status === 'SUCCESS' && info.backup.ageSeconds != null">
                  {{ 'system.backup_age' | t:{duration: formatDuration(info.backup.ageSeconds)} }}
                </p>
                <p *ngIf="info.backup.maxAgeSeconds != null">
                  {{ 'system.backup_max_age' | t:{duration: formatDuration(info.backup.maxAgeSeconds)} }}
                </p>
                <p *ngIf="info.backup.status === 'FAILED' && info.backup.failureCode" class="failure-code mono">
                  {{ 'system.error_code_value' | t:{code: info.backup.failureCode} }}
                </p>
              </div>
            </div>
            <div class="cli-note">
              <span class="material-symbols-outlined" aria-hidden="true">terminal</span>
              <p><strong>{{ 'system.operacii_dostupny_tolko_administratoram_hosta' | t }}</strong> {{ 'system.rezervnoe_kopirovanie_vosstanovlenie_i_obnovleni' | t }}</p>
            </div>
          </article>
        </div>

        <section class="summary-section" aria-labelledby="installation-summary-title">
          <h2 id="installation-summary-title" class="sr-only">{{ 'system.svodka_ustanovki' | t }}</h2>
          <div class="summary-grid">
          <article class="summary-card">
            <span class="summary-label">{{ 'system.organizaciya' | t }}</span>
            <strong>{{ info.organization.name }}</strong>
            <span class="summary-meta mono">{{ info.organization.code }}</span>
          </article>
          <article class="summary-card">
            <span class="summary-label">{{ 'system.profil_resursov' | t }}</span>
            <strong>{{ info.organization.resourceProfile }}</strong>
            <span class="summary-meta">{{ 'system.profil_tekuschey_ustanovki' | t }}</span>
          </article>
          <article class="summary-card">
            <span class="summary-label">{{ 'system.hranilische_faylov' | t }}</span>
            <strong>{{ storageProviderLabel(info.storageProvider) }}</strong>
            <span class="summary-meta mono">{{ info.storageProvider }}</span>
          </article>
          <article class="summary-card">
            <span class="summary-label">{{ 'system.versii' | t }}</span>
            <strong class="mono">{{ info.appVersion }}</strong>
            <span class="summary-meta mono">{{ 'system.database_schema_version' | t:{version: info.schemaVersion} }}</span>
          </article>
          </div>
        </section>
      </ng-container>

      <p class="sr-only" aria-live="polite">{{ refreshAnnouncement() }}</p>
    </section>
  `,
  styles: [`
    :host { display: block; }
    .system-page { display: flex; flex-direction: column; gap: 20px; max-width: 1400px; margin: 0 auto; }
    .view-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 20px; }
    .eyebrow { margin: 0 0 4px; color: var(--primary); font-size: 12px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
    h1 { margin: 0; color: var(--text-main); font-size: 26px; line-height: 1.2; }
    .subtitle { max-width: 720px; margin: 8px 0 0; color: var(--text-muted); font-size: 13px; line-height: 1.5; }
    .summary-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
    .summary-card, .panel, .state-panel, .overall-status, .stale-state { background: var(--bg-surface); border: 1px solid var(--border-color); border-radius: var(--radius-lg); }
    .overall-status { display: flex; align-items: flex-start; gap: 14px; padding: 18px; }
    .overall-status[data-status="healthy"] { border-color: color-mix(in srgb, var(--success) 38%, var(--border-color)); background: var(--success-bg); }
    .overall-status[data-status="attention"] { border-color: color-mix(in srgb, var(--warning) 45%, var(--border-color)); background: var(--warning-bg); }
    .overall-status[data-status="unavailable"] { border-color: color-mix(in srgb, var(--danger) 42%, var(--border-color)); background: var(--danger-bg); }
    .overall-icon { flex: 0 0 auto; font-size: 26px; }
    .overall-status[data-status="healthy"] .overall-icon { color: var(--success); }
    .overall-status[data-status="attention"] .overall-icon { color: var(--warning); }
    .overall-status[data-status="unavailable"] .overall-icon { color: var(--danger); }
    .overall-copy { flex: 1; min-width: 0; }
    .overall-kicker { display: block; margin-bottom: 3px; color: var(--text-muted); font-size: 11px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; }
    .overall-copy h2 { margin: 0; color: var(--text-main); font-size: 17px; }
    .overall-copy p { margin: 5px 0 0; color: var(--text-muted); font-size: 12px; line-height: 1.45; }
    .checked-at { flex: 0 0 auto; color: var(--text-muted); font-size: 11px; }
    .stale-state { display: flex; align-items: center; gap: 12px; padding: 14px 16px; border-color: color-mix(in srgb, var(--warning) 45%, var(--border-color)); background: var(--warning-bg); }
    .stale-state > .material-symbols-outlined { color: var(--warning); }
    .stale-state div { flex: 1; min-width: 0; }
    .stale-state strong { color: var(--text-main); font-size: 13px; }
    .stale-state p { margin: 3px 0 0; color: var(--text-muted); font-size: 12px; }
    .summary-card { display: flex; flex-direction: column; min-width: 0; gap: 6px; padding: 16px; }
    .summary-card strong { overflow: hidden; color: var(--text-main); font-size: 17px; text-overflow: ellipsis; white-space: nowrap; }
    .summary-label { color: var(--text-muted); font-size: 12px; }
    .summary-meta { color: var(--text-muted); font-size: 11px; }
    .mono { font-family: ui-monospace, SFMono-Regular, Consolas, monospace; }
    .content-grid { display: grid; grid-template-columns: minmax(0, 1.25fr) minmax(320px, .75fr); gap: 16px; }
    .panel { padding: 18px; }
    .panel-heading { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; margin-bottom: 14px; }
    .panel-heading h2, .state-panel h2 { margin: 0; color: var(--text-main); font-size: 16px; }
    .panel-heading p, .state-panel p { margin: 4px 0 0; color: var(--text-muted); font-size: 12px; line-height: 1.45; }
    .panel-icon { color: var(--primary); }
    .component-list { display: flex; flex-direction: column; margin: 0; }
    .component-row { display: flex; align-items: center; justify-content: space-between; gap: 16px; padding: 12px 0; border-top: 1px solid var(--border-color); }
    .component-row dt { color: var(--text-main); font-size: 13px; font-weight: 500; }
    .component-row dd { margin: 0; }
    .status-pill { display: inline-flex; align-items: center; gap: 7px; padding: 4px 9px; border-radius: 999px; font-size: 11px; font-weight: 700; }
    .status-dot { width: 7px; height: 7px; border-radius: 50%; background: currentColor; }
    .status-up { color: var(--success); background: var(--success-bg); }
    .status-degraded { color: var(--warning); background: var(--warning-bg); }
    .status-down { color: var(--danger); background: var(--danger-bg); }
    .status-disabled, .status-unknown { color: var(--text-muted); background: var(--bg-hover); }
    .backup-result { display: flex; align-items: flex-start; gap: 12px; padding: 14px; border: 1px solid var(--border-color); border-radius: var(--radius-md); }
    .backup-icon { color: var(--primary); }
    .panel[data-severity="healthy"] .backup-icon { color: var(--success); }
    .panel[data-severity="attention"] .backup-result { border-color: color-mix(in srgb, var(--warning) 45%, var(--border-color)); background: var(--warning-bg); }
    .panel[data-severity="attention"] .backup-icon { color: var(--warning); }
    .panel[data-severity="critical"] .backup-result { border-color: color-mix(in srgb, var(--danger) 42%, var(--border-color)); background: var(--danger-bg); }
    .panel[data-severity="critical"] .backup-icon { color: var(--danger); }
    .backup-result strong { color: var(--text-main); font-size: 13px; }
    .backup-result p { margin: 4px 0 0; color: var(--text-muted); font-size: 12px; }
    .failure-code { color: var(--danger) !important; }
    .cli-note { display: flex; align-items: flex-start; gap: 10px; margin-top: 12px; padding: 12px; border-radius: var(--radius-md); background: var(--bg-hover); color: var(--text-muted); }
    .cli-note .material-symbols-outlined { color: var(--primary); font-size: 19px; }
    .cli-note p { margin: 0; font-size: 12px; line-height: 1.5; }
    .state-panel { display: flex; align-items: center; justify-content: center; gap: 12px; min-height: 160px; padding: 24px; color: var(--text-muted); }
    .error-state { justify-content: flex-start; }
    .error-state > .material-symbols-outlined { color: var(--danger); font-size: 30px; }
    .error-state ui-button { margin-left: auto; }
    .spinner { width: 20px; height: 20px; border: 2px solid var(--border-color); border-top-color: var(--primary); border-radius: 50%; animation: spin .7s linear infinite; }
    @keyframes spin { to { transform: rotate(360deg); } }
    @media (max-width: 960px) { .summary-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } .content-grid { grid-template-columns: 1fr; } }
    @media (max-width: 600px) { .view-header { align-items: stretch; flex-direction: column; } .summary-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } .overall-status { flex-wrap: wrap; padding: 15px; } .checked-at { width: 100%; padding-left: 40px; } .panel { padding: 14px; } .stale-state, .error-state { align-items: flex-start; flex-wrap: wrap; } .stale-state ui-button, .error-state ui-button { margin-left: 36px; } }
    @media (max-width: 380px) { .summary-grid { grid-template-columns: 1fr; } }
    @media (prefers-reduced-motion: reduce) { .spinner { animation: none; } }
  `]
})
export class SystemComponent implements OnInit {
  private readonly uiI18n = inject(I18nService);
  readonly systemInfo = signal<SystemInfo | null>(null);
  readonly isLoading = signal(true);
  readonly loadError = signal(false);
  readonly refreshAnnouncement = signal('');

  constructor(private readonly api: ApiService) {}

  ngOnInit(): void {
    this.loadSystemInfo();
  }

  loadSystemInfo(): void {
    const hadSnapshot = this.systemInfo() !== null;
    this.isLoading.set(true);
    this.loadError.set(false);
    this.refreshAnnouncement.set('');
    this.api.get<SystemInfo>('/system/info', undefined, { notifyError: false }).subscribe({
      next: info => {
        this.systemInfo.set(info);
        this.isLoading.set(false);
        if (hadSnapshot) {
          this.refreshAnnouncement.set(this.uiI18n.translate('system.refresh_succeeded'));
        }
      },
      error: () => {
        this.loadError.set(true);
        this.isLoading.set(false);
      }
    });
  }

  componentEntries(info: SystemInfo): Array<{ name: string; status: string }> {
    const preferredOrder = ['database', 'storage', 'typesense'];
    return Object.entries(info.components)
      .map(([name, component]) => ({ name, status: component.status || 'UNKNOWN' }))
      .sort((left, right) => {
        const leftIndex = preferredOrder.indexOf(left.name);
        const rightIndex = preferredOrder.indexOf(right.name);
        return (leftIndex < 0 ? preferredOrder.length : leftIndex)
          - (rightIndex < 0 ? preferredOrder.length : rightIndex)
          || left.name.localeCompare(right.name);
      });
  }

  overallStatus(info: SystemInfo): OverallStatus {
    const statuses = Object.fromEntries(
      Object.entries(info.components).map(([name, component]) => [name, (component.status || 'UNKNOWN').toUpperCase()])
    );
    if (['database', 'storage'].some(name => statuses[name] === 'DOWN')) {
      return 'unavailable';
    }
    const missingRequiredComponent = ['database', 'storage'].some(name => !statuses[name]);
    const componentNeedsAttention = Object.values(statuses).some(status => !['UP', 'DISABLED'].includes(status));
    const backupIsCurrent = info.backup.status === 'SUCCESS' && info.backup.freshness === 'CURRENT';
    if (missingRequiredComponent || componentNeedsAttention || !backupIsCurrent) {
      return 'attention';
    }
    return 'healthy';
  }

  overallStatusLabel(info: SystemInfo): string {
    return ({
      healthy: this.uiI18n.translate('system.overall_healthy'),
      attention: this.uiI18n.translate('system.overall_attention'),
      unavailable: this.uiI18n.translate('system.overall_unavailable')
    } as Record<OverallStatus, string>)[this.overallStatus(info)];
  }

  overallStatusDescription(info: SystemInfo): string {
    return ({
      healthy: this.uiI18n.translate('system.overall_healthy_description'),
      attention: this.uiI18n.translate('system.overall_attention_description'),
      unavailable: this.uiI18n.translate('system.overall_unavailable_description')
    } as Record<OverallStatus, string>)[this.overallStatus(info)];
  }

  overallStatusIcon(info: SystemInfo): string {
    return ({ healthy: 'check_circle', attention: 'warning', unavailable: 'error' } as Record<OverallStatus, string>)[this.overallStatus(info)];
  }

  componentLabel(name: string): string {
    return ({ database: 'PostgreSQL', storage: this.uiI18n.translate('files.faylovoe_hranilische'), typesense: 'Typesense' } as Record<string, string>)[name] ?? name;
  }

  storageProviderLabel(provider: string): string {
    return ({
      local_disk: this.uiI18n.translate('system.storage_local_disk'),
      s3: this.uiI18n.translate('system.storage_s3')
    } as Record<string, string>)[provider] ?? provider;
  }

  statusLabel(status: string): string {
    return ({ UP: this.uiI18n.translate('system.rabotaet'), DEGRADED: this.uiI18n.translate('system.est_problemy'), DOWN: this.uiI18n.translate('system.nedostupen'), DISABLED: this.uiI18n.translate('system.otklyuchen'), UNKNOWN: this.uiI18n.translate('system.neizvestno') } as Record<string, string>)[status] ?? status;
  }

  statusClass(status: string): string {
    return ['UP', 'DEGRADED', 'DOWN', 'DISABLED'].includes(status) ? status.toLowerCase() : 'unknown';
  }

  backupStatusLabel(backup: SystemInfo['backup']): string {
    if (backup.status === 'SUCCESS') {
      return ({
        CURRENT: this.uiI18n.translate('system.backup_current'),
        STALE: this.uiI18n.translate('system.backup_stale'),
        NOT_CONFIGURED: this.uiI18n.translate('system.backup_policy_not_configured'),
        UNKNOWN: this.uiI18n.translate('system.backup_freshness_unknown')
      } as Record<string, string>)[backup.freshness]
        ?? this.uiI18n.translate('system.backup_freshness_unknown');
    }
    return ({
      NEVER: this.uiI18n.translate('system.rezervnaya_kopiya_esche_ne_sozdavalas'),
      FAILED: this.uiI18n.translate('system.poslednyaya_rezervnaya_kopiya_zavershilas_oshibk'),
    } as Record<string, string>)[backup.status] ?? this.uiI18n.translate('system.sostoyanie_rezervnoy_kopii_neizvestno');
  }

  backupIcon(backup: SystemInfo['backup']): string {
    if (backup.status === 'SUCCESS') {
      return ({ CURRENT: 'check_circle', STALE: 'error', NOT_CONFIGURED: 'warning' } as Record<string, string>)[backup.freshness] ?? 'help';
    }
    return ({ NEVER: 'schedule', FAILED: 'error' } as Record<string, string>)[backup.status] ?? 'help';
  }

  backupSeverity(backup: SystemInfo['backup']): 'healthy' | 'attention' | 'critical' {
    if (backup.status === 'FAILED' || (backup.status === 'SUCCESS' && backup.freshness === 'STALE')) return 'critical';
    if (backup.status === 'SUCCESS' && backup.freshness === 'CURRENT') return 'healthy';
    return 'attention';
  }

  formatDuration(seconds: number | null | undefined): string {
    if (seconds == null || !Number.isFinite(seconds) || seconds < 0) {
      return '';
    }
    if (seconds < 60) {
      return this.uiI18n.translate('system.duration_less_than_minute');
    }
    const totalMinutes = Math.floor(seconds / 60);
    const days = Math.floor(totalMinutes / (24 * 60));
    const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
    const minutes = totalMinutes % 60;
    const parts: string[] = [];
    if (days > 0) parts.push(this.uiI18n.translate('system.duration_days_short', { count: days }));
    if (hours > 0) parts.push(this.uiI18n.translate('system.duration_hours_short', { count: hours }));
    if (minutes > 0 && days === 0) parts.push(this.uiI18n.translate('system.duration_minutes_short', { count: minutes }));
    return parts.join(' ');
  }
}
