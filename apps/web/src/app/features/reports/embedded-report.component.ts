import { Component, OnInit, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, RouterModule } from '@angular/router';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { NavigationService } from '../../core/services/navigation.service';
import { CustomNavigationItem } from '../../core/models/navigation.models';
import { TranslatePipe, I18nService } from '../../core/services/i18n.service';

@Component({
  selector: 'app-embedded-report',
  standalone: true,
  imports: [CommonModule, RouterModule, TranslatePipe],
  template: `
    <div class="embedded-report-container" [class.fullscreen]="isFullscreen()">
      <!-- Top Toolbar -->
      <div class="report-toolbar">
        <div class="report-meta">
          <div class="report-icon-box">
            <span class="material-symbols-outlined report-icon" aria-hidden="true">{{ report()?.icon || 'analytics' }}</span>
          </div>
          <div class="report-title-group">
            <h1 class="report-title">{{ report()?.title || ('reports.loading' | t) }}</h1>
            <div class="report-meta-sub">
              <span class="report-badge" *ngIf="urlHost()">{{ urlHost() }}</span>
              <span class="status-indicator" [class.loading]="isLoading()" [class.ready]="!isLoading()">
                <span class="status-dot"></span>
                <span class="status-text">{{ isLoading() ? ('common.loading' | t) : ('nav.settings.stat_active' | t) }}</span>
              </span>
            </div>
          </div>
        </div>

        <div class="report-actions">
          <button
            type="button"
            class="action-btn"
            (click)="reloadIframe()"
            [title]="'common.refresh' | t"
            [attr.aria-label]="'common.refresh' | t"
          >
            <span class="material-symbols-outlined" aria-hidden="true">refresh</span>
            <span class="action-label">{{ 'common.refresh' | t }}</span>
          </button>

          <button
            type="button"
            class="action-btn"
            (click)="toggleFullscreen()"
            [title]="isFullscreen() ? ('reports.exit_fullscreen' | t) : ('reports.fullscreen' | t)"
            [attr.aria-label]="isFullscreen() ? ('reports.exit_fullscreen' | t) : ('reports.fullscreen' | t)"
          >
            <span class="material-symbols-outlined" aria-hidden="true">{{ isFullscreen() ? 'fullscreen_exit' : 'fullscreen' }}</span>
            <span class="action-label">{{ isFullscreen() ? ('reports.exit_fullscreen' | t) : ('reports.fullscreen' | t) }}</span>
          </button>

          <button
            type="button"
            class="action-btn"
            (click)="openPopup()"
            [title]="'reports.open_popup' | t"
            [attr.aria-label]="'reports.open_popup' | t"
          >
            <span class="material-symbols-outlined" aria-hidden="true">open_in_browser</span>
            <span class="action-label">{{ 'reports.open_popup' | t }}</span>
          </button>

          <a
            *ngIf="report()?.url"
            [href]="report()?.url"
            target="_blank"
            rel="noopener noreferrer"
            class="action-btn primary"
            [title]="'reports.open_external' | t"
            [attr.aria-label]="'reports.open_external' | t"
          >
            <span class="material-symbols-outlined" aria-hidden="true">open_in_new</span>
            <span class="action-label">{{ 'reports.open_external' | t }}</span>
          </a>
        </div>
      </div>

      <!-- Content Area -->
      <div class="report-viewport">
        <!-- Loading Overlay -->
        <div *ngIf="isLoading()" class="report-loading">
          <div class="spinner" aria-hidden="true"></div>
          <span class="loading-label">{{ 'common.loading' | t }}</span>
        </div>

        <!-- Error Alert -->
        <div *ngIf="errorMessage()" class="report-error" role="alert">
          <span class="material-symbols-outlined icon" aria-hidden="true">error</span>
          <span>{{ errorMessage() }}</span>
          <button type="button" class="btn btn-secondary" (click)="loadReport()">{{ 'common.retry' | t }}</button>
        </div>

        <!-- Safe iFrame -->
        <iframe
          *ngIf="safeUrl() && !errorMessage()"
          #reportFrame
          [src]="safeUrl()"
          class="report-iframe"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-downloads"
          referrerpolicy="no-referrer-when-downgrade"
          (load)="onIframeLoaded()"
          [attr.title]="report()?.title || ('reports.embedded_report' | t)"
        ></iframe>

        <!-- Helpful Assistant Footer -->
        <div class="report-fallback-bar" *ngIf="!isLoading() && showTip()">
          <div class="fallback-tip">
            <span class="material-symbols-outlined tip-icon" aria-hidden="true">lightbulb</span>
            <span>{{ 'reports.iframe_blocked_hint' | t }}</span>
          </div>
          <div class="fallback-actions">
            <button type="button" class="fallback-btn" (click)="openPopup()">
              <span class="material-symbols-outlined" aria-hidden="true">open_in_browser</span>
              {{ 'reports.open_popup' | t }}
            </button>
            <button
              type="button"
              class="fallback-close"
              (click)="showTip.set(false)"
              [attr.aria-label]="'common.close' | t"
            >
              <span class="material-symbols-outlined" aria-hidden="true">close</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .embedded-report-container {
      display: flex;
      flex-direction: column;
      height: 100%;
      min-height: calc(100vh - 64px);
      background-color: var(--bg-surface);
      border-radius: var(--radius-md);
      overflow: hidden;
      border: 1px solid var(--border-color);
      box-shadow: var(--shadow-sm);
    }

    .embedded-report-container.fullscreen {
      position: fixed;
      inset: 0;
      z-index: 9999;
      border-radius: 0;
      min-height: 100vh;
      border: none;
    }

    .report-toolbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 20px;
      border-bottom: 1px solid var(--border-color);
      background-color: var(--bg-surface);
      flex-shrink: 0;
      gap: 16px;
      flex-wrap: wrap;
    }

    .report-meta {
      display: flex;
      align-items: center;
      gap: 12px;
      min-width: 0;
    }

    .report-icon-box {
      width: 36px;
      height: 36px;
      border-radius: var(--radius-sm);
      background-color: #f1f5f9;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }

    .report-icon {
      font-size: 20px;
      color: var(--primary);
    }

    .report-title-group {
      display: flex;
      flex-direction: column;
      gap: 2px;
      min-width: 0;
    }

    .report-title {
      font-size: 15px;
      font-weight: 600;
      color: var(--text-main);
      margin: 0;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .report-meta-sub {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .report-badge {
      font-size: 11px;
      padding: 1px 8px;
      border-radius: 9999px;
      background-color: var(--bg-hover);
      color: var(--text-muted);
      border: 1px solid var(--border-color);
      font-family: monospace;
    }

    .status-indicator {
      display: inline-flex;
      align-items: center;
      gap: 5px;
      font-size: 11px;
      color: var(--text-muted);
    }

    .status-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background-color: #cbd5e1;
    }

    .status-indicator.ready .status-dot {
      background-color: #10b981;
      box-shadow: 0 0 0 2px rgba(16, 185, 129, 0.2);
    }

    .status-indicator.loading .status-dot {
      background-color: #f59e0b;
      animation: pulse 1s infinite;
    }

    @keyframes pulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.4; transform: scale(0.85); }
    }

    .report-actions {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .action-btn {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 6px 12px;
      font-size: 12px;
      font-weight: 500;
      border-radius: var(--radius-sm);
      border: 1px solid var(--border-color);
      background-color: var(--bg-surface);
      color: var(--text-main);
      cursor: pointer;
      text-decoration: none;
      transition: all 0.15s ease;
    }

    .action-btn:hover {
      background-color: var(--bg-hover);
      color: var(--text-main);
      border-color: var(--primary);
    }

    .action-btn.primary {
      background-color: var(--primary);
      color: #ffffff;
      border-color: var(--primary);
    }

    .action-btn.primary:hover {
      opacity: 0.92;
      box-shadow: 0 2px 4px rgba(37, 99, 235, 0.25);
    }

    .action-btn .material-symbols-outlined {
      font-size: 16px;
    }

    .report-viewport {
      flex: 1;
      position: relative;
      background-color: #ffffff;
      display: flex;
      flex-direction: column;
    }

    .report-iframe {
      width: 100%;
      height: 100%;
      flex: 1;
      border: none;
      min-height: 650px;
    }

    .report-loading {
      position: absolute;
      inset: 0;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      gap: 12px;
      background-color: rgba(255, 255, 255, 0.9);
      backdrop-filter: blur(2px);
      z-index: 10;
      color: var(--text-muted);
      font-size: 13px;
    }

    .spinner {
      width: 28px;
      height: 28px;
      border: 2.5px solid var(--border-color);
      border-top-color: var(--primary);
      border-radius: 50%;
      animation: spin 0.75s linear infinite;
    }

    @keyframes spin {
      to { transform: rotate(360deg); }
    }

    .loading-label {
      font-size: 13px;
      font-weight: 500;
      color: var(--text-muted);
    }

    .report-error {
      margin: 24px;
      padding: 16px 20px;
      border-radius: var(--radius-md);
      background-color: #fef2f2;
      border: 1px solid #fecaca;
      color: #b91c1c;
      display: flex;
      align-items: center;
      gap: 12px;
    }

    /* Fallback Bar */
    .report-fallback-bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 8px 16px;
      background-color: #f8fafc;
      border-top: 1px solid var(--border-color);
      font-size: 12px;
      color: var(--text-muted);
      flex-wrap: wrap;
    }

    .fallback-tip {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .tip-icon {
      font-size: 16px;
      color: #eab308;
      flex-shrink: 0;
    }

    .fallback-actions {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .fallback-btn {
      display: inline-flex;
      align-items: center;
      gap: 4px;
      padding: 3px 8px;
      font-size: 11px;
      font-weight: 500;
      border-radius: var(--radius-sm);
      border: 1px solid var(--border-color);
      background-color: var(--bg-surface);
      color: var(--text-main);
      cursor: pointer;
      transition: all 0.15s ease;
    }

    .fallback-btn:hover {
      background-color: var(--bg-hover);
      border-color: var(--primary);
      color: var(--primary);
    }

    .fallback-btn .material-symbols-outlined {
      font-size: 14px;
    }

    .fallback-close {
      background: transparent;
      border: none;
      color: var(--text-muted);
      cursor: pointer;
      padding: 2px;
      display: flex;
      align-items: center;
      border-radius: var(--radius-sm);
    }

    .fallback-close:hover {
      color: var(--text-main);
    }

    .fallback-close .material-symbols-outlined {
      font-size: 16px;
    }

    @media (max-width: 768px) {
      .action-label {
        display: none;
      }
      .report-toolbar {
        padding: 10px 14px;
      }
    }
  `]
})
export class EmbeddedReportComponent implements OnInit {
  private readonly route = inject(ActivatedRoute);
  private readonly navService = inject(NavigationService);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly i18n = inject(I18nService);

  readonly report = signal<CustomNavigationItem | null>(null);
  readonly safeUrl = signal<SafeResourceUrl | null>(null);
  readonly isLoading = signal<boolean>(true);
  readonly errorMessage = signal<string | null>(null);
  readonly isFullscreen = signal<boolean>(false);
  readonly urlHost = signal<string>('');
  readonly showTip = signal<boolean>(true);

  ngOnInit(): void {
    this.route.paramMap.subscribe(params => {
      const code = params.get('code');
      if (code) {
        this.loadReport(code);
      }
    });
  }

  loadReport(code?: string): void {
    const reportCode = code || this.route.snapshot.paramMap.get('code');
    if (!reportCode) return;

    this.isLoading.set(true);
    this.errorMessage.set(null);

    this.navService.getItemByCode(reportCode).subscribe({
      next: item => {
        this.report.set(item);
        try {
          const parsed = new URL(item.url, window.location.origin);
          this.urlHost.set(parsed.hostname);
        } catch {
          this.urlHost.set('');
        }
        this.safeUrl.set(this.sanitizer.bypassSecurityTrustResourceUrl(item.url));
      },
      error: () => {
        this.errorMessage.set(this.i18n.translate('reports.load_error'));
        this.isLoading.set(false);
      }
    });
  }

  onIframeLoaded(): void {
    this.isLoading.set(false);
  }

  reloadIframe(): void {
    const current = this.report();
    if (!current) return;
    this.isLoading.set(true);
    this.safeUrl.set(null);
    setTimeout(() => {
      this.safeUrl.set(this.sanitizer.bypassSecurityTrustResourceUrl(current.url));
    }, 100);
  }

  toggleFullscreen(): void {
    this.isFullscreen.update(v => !v);
  }

  openPopup(): void {
    const current = this.report();
    if (!current?.url) return;
    const w = Math.min(window.screen.width * 0.9, 1280);
    const h = Math.min(window.screen.height * 0.85, 800);
    const left = Math.max(0, (window.screen.width - w) / 2);
    const top = Math.max(0, (window.screen.height - h) / 2);
    window.open(
      current.url,
      '_blank',
      `width=${w},height=${h},top=${top},left=${left},menubar=no,toolbar=no,location=no,status=no,resizable=yes,scrollbars=yes`
    );
  }
}
