import { Component, Input, computed, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { TranslatePipe } from '../../../core/services/i18n.service';
import { TrendDataPoint, ChartPoint, YAxisTick } from '../analytics.models';

@Component({
  selector: 'app-analytics-trend-chart',
  standalone: true,
  imports: [
    CommonModule,
    TranslatePipe
  ],
  template: `
    <div class="analytics-card chart-card" [attr.aria-busy]="loading">
      <div class="card-header-row">
        <div>
          <h2 class="card-title">{{ 'analytics.dinamika_potoka_zadach' | t }}</h2>
          <p class="card-subtitle">{{ 'analytics.created_vs_completed_range' | t:{range: displayedRange} }}</p>
        </div>
        <div class="chart-legend">
          <div class="legend-item">
            <span class="legend-dot" style="background-color: var(--primary);"></span>
            <span>{{ 'common.created_at' | t }}</span>
          </div>
          <div class="legend-item">
            <span class="legend-dot" style="background-color: var(--success);"></span>
            <span>{{ 'analytics.zaversheno' | t }}</span>
          </div>
        </div>
      </div>

      <p *ngIf="loading" class="card-subtitle" role="status">{{ 'common.loading' | t }}</p>

      <!-- SVG Area / Line Chart -->
      <div class="svg-chart-container" *ngIf="trends.length > 0"
        role="region" tabindex="0" [attr.aria-label]="'analytics.dinamika_potoka_zadach' | t"
        (mouseleave)="clearHover()">
        <!-- Y Axis numeric tick values -->
        <div class="chart-y-axis" aria-hidden="true">
          <span *ngFor="let tick of yAxisTicks()" class="y-axis-tick font-mono" [style.top.px]="tick.y - 7">
            {{ tick.value }}
          </span>
        </div>

        <svg class="trend-svg" viewBox="0 0 700 240" preserveAspectRatio="none">
          <defs>
            <linearGradient id="createdGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="var(--primary)" stop-opacity="0.25"/>
              <stop offset="100%" stop-color="var(--primary)" stop-opacity="0.0"/>
            </linearGradient>
            <linearGradient id="completedGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="var(--success)" stop-opacity="0.25"/>
              <stop offset="100%" stop-color="var(--success)" stop-opacity="0.0"/>
            </linearGradient>
          </defs>

          <!-- Gridlines -->
          <g class="gridlines">
            <line x1="40" y1="40" x2="680" y2="40" stroke="var(--border-subtle)" stroke-dasharray="3,3"/>
            <line x1="40" y1="90" x2="680" y2="90" stroke="var(--border-subtle)" stroke-dasharray="3,3"/>
            <line x1="40" y1="140" x2="680" y2="140" stroke="var(--border-subtle)" stroke-dasharray="3,3"/>
            <line x1="40" y1="190" x2="680" y2="190" stroke="var(--border-subtle)"/>
          </g>

          <!-- Area Fills -->
          <path [attr.d]="createdAreaPath()" fill="url(#createdGrad)"/>
          <path [attr.d]="completedAreaPath()" fill="url(#completedGrad)"/>

          <!-- Line Strokes -->
          <path [attr.d]="createdLinePath()" fill="none" stroke="var(--primary)" stroke-width="2.5" stroke-linecap="round"/>
          <path [attr.d]="completedLinePath()" fill="none" stroke="var(--success)" stroke-width="2.5" stroke-linecap="round"/>

          <!-- Hover guideline -->
          <line *ngIf="hoveredPoint() as hp"
            [attr.x1]="hp.x" y1="40"
            [attr.x2]="hp.x" y2="190"
            stroke="var(--text-muted)" stroke-width="1.5" stroke-dasharray="4,4"
          />

          <!-- Data Dots -->
          <g *ngFor="let pt of chartPoints(); let i = index"
            class="chart-point-group"
            (mouseenter)="setHoveredPoint(pt, i)"
            (focus)="setHoveredPoint(pt, i)"
          >
            <!-- Hit area for easy hovering -->
            <rect [attr.x]="pt.x - 12" y="30" width="24" height="170" fill="transparent" class="hit-area" />

            <circle [attr.cx]="pt.x" [attr.cy]="pt.yCreated" [attr.r]="hoverIndex() === i ? 5.5 : 3.5" fill="var(--bg-surface)" stroke="var(--primary)" stroke-width="2">
              <title>{{ pt.date }}: {{ 'analytics.sozdano' | t }}: {{ pt.created }}</title>
            </circle>
            <circle [attr.cx]="pt.x" [attr.cy]="pt.yCompleted" [attr.r]="hoverIndex() === i ? 5.5 : 3.5" fill="var(--bg-surface)" stroke="var(--success)" stroke-width="2">
              <title>{{ pt.date }}: {{ 'analytics.zaversheno' | t }}: {{ pt.completed }}</title>
            </circle>
            <!-- X axis date labels for some points -->
            <text
              *ngIf="shouldShowDateLabel(i, chartPoints().length)"
              [attr.x]="pt.x"
              y="215"
              font-size="10"
              text-anchor="middle"
              fill="var(--text-muted)"
              font-family="inherit"
            >
              {{ pt.label }}
            </text>
          </g>
        </svg>

        <!-- Floating Tooltip Card -->
        <div *ngIf="hoveredPoint() as hp" class="chart-tooltip-floating" [style.left.px]="getTooltipLeft(hp.x)">
          <div class="tooltip-date font-mono">{{ hp.date }}</div>
          <div class="tooltip-values">
            <div class="tooltip-val">
              <span class="tooltip-dot" style="background-color: var(--primary);"></span>
              <span>{{ 'analytics.sozdano' | t }}: <strong>{{ hp.created }}</strong></span>
            </div>
            <div class="tooltip-val">
              <span class="tooltip-dot" style="background-color: var(--success);"></span>
              <span>{{ 'analytics.zaversheno' | t }}: <strong>{{ hp.completed }}</strong></span>
            </div>
          </div>
        </div>
      </div>

      <div *ngIf="trends.length === 0 && !loading && !error" class="empty-chart">
        <span class="material-symbols-outlined" style="font-size: 32px; color: var(--text-light);">show_chart</span>
        <p>{{ 'analytics.net_dannyh_za_vybrannyy_period' | t }}</p>
      </div>
    </div>
  `,
  styles: [`
    .analytics-card {
      min-width: 0;
      background-color: var(--bg-surface);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-lg);
      padding: 18px 22px;
      box-shadow: var(--shadow-sm);
      display: flex;
      flex-direction: column;
      gap: 16px;
    }

    .card-header-row {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 12px;
    }

    .card-title {
      font-size: 15px;
      font-weight: 700;
      color: var(--text-main);
      overflow-wrap: anywhere;
    }

    .card-subtitle {
      font-size: 12px;
      color: var(--text-muted);
      margin-top: 2px;
      overflow-wrap: anywhere;
    }

    .chart-legend {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 14px;
    }

    .legend-item {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      font-weight: 500;
      color: var(--text-main);
    }

    .legend-dot {
      width: 8px;
      height: 8px;
      flex-shrink: 0;
      border-radius: 50%;
    }

    .svg-chart-container {
      width: 100%;
      min-width: 0;
      overflow-x: auto;
      position: relative;
    }

    .svg-chart-container:focus-visible {
      outline: 2px solid var(--primary);
      outline-offset: -2px;
    }

    .chart-y-axis {
      position: absolute;
      left: 4px;
      top: 0;
      bottom: 0;
      width: 32px;
      pointer-events: none;
      z-index: 2;
    }

    .y-axis-tick {
      position: absolute;
      right: 0;
      font-size: 10px;
      line-height: 1;
      color: var(--text-muted);
      text-align: right;
    }

    .trend-svg {
      display: block;
      width: 100%;
      min-width: 700px;
      height: 240px;
    }

    .empty-chart {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 50px 20px;
      gap: 8px;
      color: var(--text-muted);
      font-size: 13px;
    }

    .chart-tooltip-floating {
      position: absolute;
      top: 10px;
      background-color: var(--bg-surface);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-sm);
      box-shadow: var(--shadow-md);
      padding: 6px 10px;
      font-size: 11px;
      pointer-events: none;
      z-index: 10;
      transition: left 0.08s ease-out;
    }

    .tooltip-date {
      font-weight: 600;
      color: var(--text-muted);
      margin-bottom: 4px;
    }

    .tooltip-values {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .tooltip-val {
      display: flex;
      align-items: center;
      gap: 6px;
      color: var(--text-main);
    }

    .tooltip-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
    }

    .hit-area {
      cursor: pointer;
    }

    .chart-point-group:focus-visible circle {
      stroke-width: 3;
      stroke: var(--text-main);
    }

    .font-mono {
      font-family: monospace;
    }
  `]
})
export class AnalyticsTrendChartComponent {
  private _trends = signal<TrendDataPoint[]>([]);

  @Input() set trends(value: TrendDataPoint[]) {
    this._trends.set(value || []);
  }
  get trends(): TrendDataPoint[] {
    return this._trends();
  }

  @Input() displayedRange = '7d';
  @Input() loading = false;
  @Input() error = '';

  hoveredPoint = signal<ChartPoint | null>(null);
  hoverIndex = signal<number | null>(null);

  chartPoints = computed<ChartPoint[]>(() => {
    const list = this._trends();
    if (list.length === 0) return [];

    let maxVal = 1;
    for (const d of list) {
      if (d.createdCount > maxVal) maxVal = d.createdCount;
      if (d.completedCount > maxVal) maxVal = d.completedCount;
    }

    const width = 640;
    const startX = 40;
    const bottomY = 190;
    const topY = 40;
    const height = bottomY - topY;

    const step = list.length > 1 ? width / (list.length - 1) : width;

    return list.map((d, i) => {
      const x = startX + i * step;
      const yCreated = bottomY - (d.createdCount / maxVal) * height;
      const yCompleted = bottomY - (d.completedCount / maxVal) * height;
      const label = d.date.substring(5); // MM-DD
      return { x, yCreated, yCompleted, label, date: d.date, created: d.createdCount, completed: d.completedCount };
    });
  });

  yAxisTicks = computed<YAxisTick[]>(() => {
    const list = this._trends();
    if (list.length === 0) return [];
    let maxVal = 1;
    for (const d of list) {
      if (d.createdCount > maxVal) maxVal = d.createdCount;
      if (d.completedCount > maxVal) maxVal = d.completedCount;
    }
    return [
      { y: 40, value: maxVal },
      { y: 90, value: Math.round((maxVal * 2) / 3) },
      { y: 140, value: Math.round(maxVal / 3) },
      { y: 190, value: 0 }
    ];
  });

  createdLinePath = computed(() => {
    const pts = this.chartPoints();
    if (pts.length === 0) return '';
    return pts.map((p, i) => (i === 0 ? `M ${p.x} ${p.yCreated}` : `L ${p.x} ${p.yCreated}`)).join(' ');
  });

  completedLinePath = computed(() => {
    const pts = this.chartPoints();
    if (pts.length === 0) return '';
    return pts.map((p, i) => (i === 0 ? `M ${p.x} ${p.yCompleted}` : `L ${p.x} ${p.yCompleted}`)).join(' ');
  });

  createdAreaPath = computed(() => {
    const pts = this.chartPoints();
    if (pts.length === 0) return '';
    const line = this.createdLinePath();
    const last = pts[pts.length - 1];
    const first = pts[0];
    return `${line} L ${last.x} 190 L ${first.x} 190 Z`;
  });

  completedAreaPath = computed(() => {
    const pts = this.chartPoints();
    if (pts.length === 0) return '';
    const line = this.completedLinePath();
    const last = pts[pts.length - 1];
    const first = pts[0];
    return `${line} L ${last.x} 190 L ${first.x} 190 Z`;
  });

  setHoveredPoint(pt: ChartPoint, idx: number): void {
    this.hoveredPoint.set(pt);
    this.hoverIndex.set(idx);
  }

  clearHover(): void {
    this.hoveredPoint.set(null);
    this.hoverIndex.set(null);
  }

  getTooltipLeft(x: number): number {
    return Math.max(10, Math.min(x - 60, 560));
  }

  shouldShowDateLabel(index: number, total: number): boolean {
    if (total <= 7) return true;
    if (total <= 14) return index % 2 === 0;
    return index % Math.ceil(total / 6) === 0 || index === total - 1;
  }
}
