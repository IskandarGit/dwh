import { ChangeDetectionStrategy, Component, OnInit, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { ProblemDetail } from '../../../core/models/common.models';
import { I18nService, TranslatePipe } from '../../../core/services/i18n.service';
import { PermissionService } from '../../../core/services/permission.service';
import { UiButtonComponent } from '../../../shared/ui/ui-button.component';
import { RptApiService, RptReportItem } from '../shared/rpt-api';

type RptListState = 'loading' | 'ready' | 'error';

const REPORTS_FORM = 'rpt.reports';

function twoDigits(value: number): string {
  return String(value).padStart(2, '0');
}

/** Server timestamp → `dd.mm.yyyy hh:mm` in the local time of the browser; an unreadable value is shown as it came. */
export function formatRptModified(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  const day = `${twoDigits(date.getDate())}.${twoDigits(date.getMonth() + 1)}.${date.getFullYear()}`;
  return `${day} ${twoDigits(date.getHours())}:${twoDigits(date.getMinutes())}`;
}

@Component({
  selector: 'app-rpt-list',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './rpt-list.page.html',
  styleUrl: './rpt-list.page.scss',
  imports: [TranslatePipe, UiButtonComponent]
})
export class RptListPage implements OnInit {
  private readonly api = inject(RptApiService);
  private readonly i18n = inject(I18nService);
  private readonly permissions = inject(PermissionService);
  private readonly router = inject(Router);

  readonly reports = signal<RptReportItem[]>([]);
  readonly state = signal<RptListState>('loading');
  readonly loadError = signal<string | null>(null);
  readonly canEdit = computed(() => this.permissions.hasPermission(REPORTS_FORM, 'edit'));

  ngOnInit(): void {
    this.load();
  }

  modified(item: RptReportItem): string {
    return formatRptModified(item.modifiedAt);
  }

  open(item: RptReportItem): void {
    void this.router.navigate(['/rpt/reports', item.id]);
  }

  create(): void {
    void this.router.navigate(['/rpt/reports/new']);
  }

  private load(): void {
    this.state.set('loading');
    this.loadError.set(null);
    this.api.reports().subscribe({
      next: list => {
        this.reports.set(list ?? []);
        this.state.set('ready');
      },
      error: (problem: ProblemDetail) => {
        this.state.set('error');
        this.loadError.set(this.problemText(problem));
      }
    });
  }

  /** Our code in `detail` → the screen text; anything else — the text the application framework put into the problem. */
  private problemText(problem: ProblemDetail): string {
    const code = problem?.detail ?? '';
    const key = 'rpt.err.' + code;
    const text = this.i18n.translate(key);
    if (text !== key) {
      return text;
    }
    return problem?.detail || problem?.title || this.i18n.translate('common.error');
  }
}
