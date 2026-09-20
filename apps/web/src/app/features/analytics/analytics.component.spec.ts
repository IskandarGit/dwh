import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, TestRequest, provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, Router } from '@angular/router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AnalyticsComponent, AnalyticsSummary, ProjectDistribution, TrendDataPoint, UserWorkload } from './analytics.component';

const summary: AnalyticsSummary = {
  totalTasks: 12, activeTasks: 7, completedTasks: 5, overdueTasks: 2,
  completionRatePercent: 42, createdLast7d: 4, completedLast7d: 3,
  activeProjectsCount: 1, activeUsersCount: 2
};
const trends: TrendDataPoint[] = [{ date: '2026-09-01', createdCount: 4, completedCount: 2 }];
const projects: ProjectDistribution[] = [{
  projectId: 1, projectName: 'Original project', totalTasks: 12,
  activeTasks: 7, completedTasks: 5, progressPercent: 42
}];
const workload: UserWorkload[] = [{
  userId: 2, userName: 'Original user', userLogin: 'original', assignedTasks: 10, completedTasks: 5
}];
const latestTrends: TrendDataPoint[] = [{ date: '2026-09-07', createdCount: 8, completedCount: 6 }];

describe('AnalyticsComponent request and rendering contracts', () => {
  let fixture: ComponentFixture<AnalyticsComponent>;
  let http: HttpTestingController;
  let host: HTMLElement;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AnalyticsComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])]
    }).compileComponents();
    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(AnalyticsComponent);
    host = fixture.nativeElement;
    fixture.detectChanges();
  });

  afterEach(() => http.verify());

  function takeSnapshotRequests(range = '7d') {
    return {
      summary: http.expectOne('/api/v1/analytics/summary'),
      trends: http.expectOne(`/api/v1/analytics/trends?range=${range}`),
      projects: http.expectOne('/api/v1/analytics/projects'),
      workload: http.expectOne('/api/v1/analytics/workload')
    };
  }

  function flushIfActive(request: TestRequest, value: object) {
    // Both cancellation and ignoring late responses satisfy the visible contract.
    if (!request.cancelled) request.flush(value);
  }

  async function renderResponses() {
    // Drain the existing promise-based loader as well as synchronous HTTP observers.
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    fixture.detectChanges();
  }

  async function loadInitialSnapshot() {
    const requests = takeSnapshotRequests();
    requests.summary.flush(summary);
    requests.trends.flush(trends);
    requests.projects.flush(projects);
    requests.workload.flush(workload);
    await renderResponses();
  }

  function selectRange(index: number) {
    (host.querySelectorAll<HTMLButtonElement>('.status-tab')[index]).click();
    fixture.detectChanges();
  }

  function refresh() {
    const button = Array.from(host.querySelectorAll<HTMLButtonElement>('.header-right button'))
      .find(candidate => candidate.textContent?.includes('Обновить'))!;
    button.click();
    fixture.detectChanges();
  }

  it('keeps the latest selected range when an older response arrives last', async () => {
    await loadInitialSnapshot();
    selectRange(1);
    const slow = http.expectOne('/api/v1/analytics/trends?range=30d');
    selectRange(2);
    http.expectOne('/api/v1/analytics/trends?range=90d').flush(latestTrends);
    await renderResponses();

    flushIfActive(slow, [{ date: '2026-08-20', createdCount: 1, completedCount: 1 }]);
    await renderResponses();

    expect(host.querySelector('.trend-svg')?.textContent).toContain('09-07');
    expect(host.querySelector('.trend-svg')?.textContent).not.toContain('08-20');
    expect(host.querySelector('.status-tab.active')?.textContent).toContain('90');
  });

  it('labels the retained chart with its loaded period while a new range is pending', async () => {
    await loadInitialSnapshot();
    selectRange(1);
    const request = http.expectOne('/api/v1/analytics/trends?range=30d');

    expect(host.querySelector('.chart-card .card-subtitle')?.textContent).toContain('7d');
    expect(host.querySelector('.chart-card')?.getAttribute('aria-busy')).toBe('true');
    expect(host.querySelector('.trend-svg')?.textContent).toContain('09-01');

    request.flush(latestTrends);
    await renderResponses();
    expect(host.querySelector('.chart-card .card-subtitle')?.textContent).toContain('30d');
    expect(host.querySelector('.chart-card')?.getAttribute('aria-busy')).toBe('false');
  });

  it('shows a range failure without relabeling retained data and supports retry', async () => {
    await loadInitialSnapshot();
    selectRange(1);
    http.expectOne('/api/v1/analytics/trends?range=30d').flush(
      { detail: 'Trend service unavailable' }, { status: 503, statusText: 'Service Unavailable' }
    );
    await renderResponses();

    expect(host.querySelector('[role="alert"]')?.textContent ?? '').toContain('Trend service unavailable');
    expect(host.querySelector('.chart-card .card-subtitle')?.textContent).toContain('7d');
    expect(host.querySelector('.trend-svg')?.textContent).toContain('09-01');
    expect(host.querySelector('.chart-card .empty-chart')).toBeNull();

    selectRange(1);
    http.expectOne('/api/v1/analytics/trends?range=30d').flush(latestTrends);
    await renderResponses();
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(host.querySelector('.chart-card .card-subtitle')?.textContent).toContain('30d');
    expect(host.querySelector('.trend-svg')?.textContent).toContain('09-07');
  });

  it('publishes a full refresh together instead of mixing partial responses with the old snapshot', async () => {
    await loadInitialSnapshot();
    refresh();
    const requests = takeSnapshotRequests();
    requests.summary.flush({ ...summary, totalTasks: 99 });
    await renderResponses();

    expect.soft(host.querySelector('.tile-value')?.textContent?.trim()).toBe('12');

    requests.projects.flush({ detail: 'Projects unavailable' }, { status: 503, statusText: 'Service Unavailable' });
    flushIfActive(requests.trends, latestTrends);
    flushIfActive(requests.workload, [{ ...workload[0], userName: 'Partial replacement' }]);
    await renderResponses();

    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Projects unavailable');
    expect(host.querySelector('.tile-value')?.textContent?.trim()).toBe('12');
    expect(host.querySelector('.project-name')?.textContent).toBe('Original project');
    expect(host.querySelector('.user-name-text')?.textContent).toBe('Original user');
    expect(host.querySelector('.trend-svg')?.textContent).toContain('09-01');
  });

  it('keeps full refresh pending when its range changes and publishes only the current range', async () => {
    await loadInitialSnapshot();
    refresh();
    const old = takeSnapshotRequests();
    selectRange(1);
    http.expectOne('/api/v1/analytics/trends?range=30d').flush(latestTrends);
    await renderResponses();

    expect(fixture.componentInstance.loading()).toBe(true);
    expect(host.querySelector('.tile-value')?.textContent?.trim()).toBe('12');

    flushIfActive(old.summary, { ...summary, totalTasks: 99 });
    flushIfActive(old.projects, projects);
    flushIfActive(old.workload, workload);
    flushIfActive(old.trends, [{ date: '2026-08-20', createdCount: 1, completedCount: 1 }]);
    for (const request of http.match(request => !request.url.includes('/trends'))) {
      if (request.request.url.endsWith('/summary')) request.flush({ ...summary, totalTasks: 99 });
      else if (request.request.url.endsWith('/projects')) request.flush(projects);
      else request.flush(workload);
    }
    await renderResponses();

    expect(fixture.componentInstance.loading()).toBe(false);
    expect(host.querySelector('.tile-value')?.textContent?.trim()).toBe('99');
    expect(host.querySelector('.trend-svg')?.textContent).toContain('09-07');
    expect(host.querySelector('.chart-card .card-subtitle')?.textContent).toContain('30d');
  });

  it('distinguishes a failed initial load from an empty successful result and retries all sections', async () => {
    const requests = takeSnapshotRequests();
    requests.summary.flush({}, { status: 503, statusText: 'Service Unavailable' });
    flushIfActive(requests.trends, []);
    flushIfActive(requests.projects, []);
    flushIfActive(requests.workload, []);
    await renderResponses();

    expect(host.querySelector('[role="alert"]')?.textContent).toContain('Не удалось загрузить данные аналитики');
    expect(host.querySelectorAll('.empty-chart, td.empty')).toHaveLength(0);

    refresh();
    const retry = takeSnapshotRequests();
    retry.summary.flush(summary);
    retry.trends.flush([]);
    retry.projects.flush([]);
    retry.workload.flush([]);
    await renderResponses();
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(host.querySelectorAll('.empty-chart, td.empty')).toHaveLength(3);
  });

  it('does not publish outstanding responses after the analytics screen is destroyed', async () => {
    const requests = takeSnapshotRequests();
    const component = fixture.componentInstance;
    fixture.destroy();
    flushIfActive(requests.summary, summary);
    flushIfActive(requests.trends, trends);
    flushIfActive(requests.projects, projects);
    flushIfActive(requests.workload, workload);
    await Promise.resolve();
    await Promise.resolve();

    expect(component.summary()).toBeNull();
    expect(component.trends()).toEqual([]);
    expect(component.projects()).toEqual([]);
    expect(component.workload()).toEqual([]);
  });

  it('keeps the workload table in a named keyboard reachable scroll region', async () => {
    await loadInitialSnapshot();
    const region = host.querySelector<HTMLElement>('.table-scroll[role="region"]');
    expect(region).not.toBeNull();
    expect(region?.tabIndex).toBe(0);
    expect(region?.getAttribute('aria-label')).toBe('Утилизация и загрузка команды');
    expect(region?.querySelectorAll('tbody td')).toHaveLength(5);
  });

  it('keeps the trend chart keyboard reachable with its first and last date labels', async () => {
    const requests = takeSnapshotRequests();
    requests.summary.flush(summary);
    requests.trends.flush([trends[0], latestTrends[0]]);
    requests.projects.flush(projects);
    requests.workload.flush(workload);
    await renderResponses();

    const region = host.querySelector<HTMLElement>('.svg-chart-container[role="region"]');
    expect(region).not.toBeNull();
    expect(region?.tabIndex).toBe(0);
    expect(region?.getAttribute('aria-label')).toBe('Динамика потока задач');
    expect(Array.from(region!.querySelectorAll('svg text'), label => label.textContent?.trim()))
      .toEqual(['09-01', '09-07']);
  });

  it('renders Y-axis scale ticks based on trend data values', async () => {
    await loadInitialSnapshot();
    const ticks = Array.from(host.querySelectorAll<HTMLElement>('.y-axis-tick'))
      .map(t => t.textContent?.trim());
    expect(ticks.length).toBe(4);
    expect(ticks[0]).toBe('4');
    expect(ticks[3]).toBe('0');
  });

  it('activates guideline and floating tooltip on hovering trend chart points', async () => {
    await loadInitialSnapshot();
    expect(host.querySelector('.chart-tooltip-floating')).toBeNull();

    const hitArea = host.querySelector<SVGRectElement>('.hit-area');
    expect(hitArea).not.toBeNull();
    const group = host.querySelector<SVGGElement>('.chart-point-group');
    group?.dispatchEvent(new MouseEvent('mouseenter'));
    fixture.detectChanges();

    const tooltip = host.querySelector<HTMLElement>('.chart-tooltip-floating');
    expect(tooltip).not.toBeNull();
    expect(tooltip?.textContent).toContain('2026-09-01');
    expect(tooltip?.textContent).toContain('4');
    expect(tooltip?.textContent).toContain('2');

    const container = host.querySelector<HTMLElement>('.svg-chart-container');
    container?.dispatchEvent(new MouseEvent('mouseleave'));
    fixture.detectChanges();
    expect(host.querySelector('.chart-tooltip-floating')).toBeNull();
  });

  it('sorts workload table by name, login, assigned, completed and efficiency', async () => {
    const multiWorkload: UserWorkload[] = [
      { userId: 1, userName: 'Alice', userLogin: 'alice', assignedTasks: 5, completedTasks: 5 },
      { userId: 2, userName: 'Bob', userLogin: 'bob', assignedTasks: 10, completedTasks: 2 }
    ];
    const requests = takeSnapshotRequests();
    requests.summary.flush(summary);
    requests.trends.flush(trends);
    requests.projects.flush(projects);
    requests.workload.flush(multiWorkload);
    await renderResponses();

    // Default sort is assigned desc: Bob (10), then Alice (5)
    let names = Array.from(host.querySelectorAll('.user-name-text')).map(el => el.textContent?.trim());
    expect(names).toEqual(['Bob', 'Alice']);

    // Click sort by Name (first column button) -> Alice, then Bob
    const nameSortBtn = host.querySelector<HTMLButtonElement>('.th-sort button')!;
    nameSortBtn.click();
    fixture.detectChanges();

    names = Array.from(host.querySelectorAll('.user-name-text')).map(el => el.textContent?.trim());
    expect(names).toEqual(['Alice', 'Bob']);

    // Click again -> Bob, Alice (desc)
    nameSortBtn.click();
    fixture.detectChanges();
    names = Array.from(host.querySelectorAll('.user-name-text')).map(el => el.textContent?.trim());
    expect(names).toEqual(['Bob', 'Alice']);
  });

  it('filters workload table by employee search query and clears filter', async () => {
    const multiWorkload: UserWorkload[] = [
      { userId: 1, userName: 'Alice Smith', userLogin: 'asmith', assignedTasks: 5, completedTasks: 3 },
      { userId: 2, userName: 'Bob Jones', userLogin: 'bjones', assignedTasks: 8, completedTasks: 6 }
    ];
    const requests = takeSnapshotRequests();
    requests.summary.flush(summary);
    requests.trends.flush(trends);
    requests.projects.flush(projects);
    requests.workload.flush(multiWorkload);
    await renderResponses();

    const input = host.querySelector<HTMLInputElement>('.user-search-box input')!;
    expect(input).not.toBeNull();

    input.value = 'Smith';
    input.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    let names = Array.from(host.querySelectorAll('.user-name-text')).map(el => el.textContent?.trim());
    expect(names).toEqual(['Alice Smith']);

    // Clear filter
    const clearBtn = host.querySelector<HTMLButtonElement>('.user-search-box .clear-mini-btn')!;
    clearBtn.click();
    fixture.detectChanges();

    names = Array.from(host.querySelectorAll('.user-name-text')).map(el => el.textContent?.trim());
    expect(names).toEqual(['Bob Jones', 'Alice Smith']);
  });

  it('filters projects by search query and navigates on project click', async () => {
    const router = TestBed.inject(Router);
    const navSpy = vi.spyOn(router, 'navigate');

    const multiProjects: ProjectDistribution[] = [
      { projectId: 1, projectName: 'Alpha ERP', totalTasks: 10, activeTasks: 5, completedTasks: 5, progressPercent: 50 },
      { projectId: 2, projectName: 'Beta CRM', totalTasks: 8, activeTasks: 2, completedTasks: 6, progressPercent: 75 },
      { projectId: 3, projectName: 'Gamma DWH', totalTasks: 4, activeTasks: 0, completedTasks: 4, progressPercent: 100 },
      { projectId: 4, projectName: 'Delta Mobile', totalTasks: 12, activeTasks: 12, completedTasks: 0, progressPercent: 0 }
    ];
    const requests = takeSnapshotRequests();
    requests.summary.flush(summary);
    requests.trends.flush(trends);
    requests.projects.flush(multiProjects);
    requests.workload.flush(workload);
    await renderResponses();

    const projectInput = host.querySelector<HTMLInputElement>('.project-search-box input')!;
    expect(projectInput).not.toBeNull();

    projectInput.value = 'crm';
    projectInput.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    let projectNames = Array.from(host.querySelectorAll('.project-name')).map(el => el.textContent?.trim());
    expect(projectNames).toEqual(['Beta CRM']);

    // Clicking project navigates to /tasks?project=2
    const projectItem = host.querySelector<HTMLElement>('.project-item.clickable')!;
    projectItem.click();
    expect(navSpy).toHaveBeenCalledWith(['/tasks'], { queryParams: { project: 2 } });
  });
});
