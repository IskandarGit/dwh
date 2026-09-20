import { TestBed } from '@angular/core/testing';
import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { Router } from '@angular/router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CommandPaletteComponent } from './command-palette.component';
import { CommandPaletteService } from '../../core/services/command-palette.service';
import { ToastService } from '../../core/services/toast.service';

describe('Reliable search through the real HTTP adapter and template', () => {
  afterEach(() => vi.useRealTimers());

  async function setup() {
    await TestBed.configureTestingModule({
      imports: [CommandPaletteComponent],
      providers: [provideHttpClient(), provideHttpClientTesting(),
        { provide: Router, useValue: { navigate: vi.fn().mockResolvedValue(true) } }]
    }).compileComponents();
    const fixture = TestBed.createComponent(CommandPaletteComponent);
    TestBed.inject(CommandPaletteService).open();
    fixture.detectChanges();
    return { fixture, component: fixture.componentInstance, http: TestBed.inject(HttpTestingController) };
  }

  it('opens the exact typed bigint ID instead of a dependency supplied URL', async () => {
    const { component } = await setup();
    component.navigateTo({ entityType: 'TASK', id: '9223372036854775807', title: 'x', description: '', targetUrl: 'https://invalid.test' });
    expect(TestBed.inject(Router).navigate).toHaveBeenCalledWith(['/tasks/items', '9223372036854775807']);
  });

  it.each(['../1', '0', '01', '-1', '9223372036854775808', '1?x', '1.0'])('rejects invalid record ID %s', async id => {
    const { component } = await setup();
    component.navigateTo({ entityType: 'USER', id, title: 'x', description: '', targetUrl: '/iam/users/1' });
    expect(TestBed.inject(Router).navigate).not.toHaveBeenCalled();
  });

  it('lets the server own the limit and renders honest empty and fallback feedback', async () => {
    vi.useFakeTimers();
    const { component, fixture, http } = await setup();
    component.searchQuery = 'test';
    component.onSearchChange('test');
    await vi.advanceTimersByTimeAsync(120);
    const request = http.expectOne(req => req.url === '/api/v1/search');
    expect(request.request.params.has('limit')).toBe(false);
    request.flush({ query: 'test', totalHits: 0, hits: [], foundHits: null, hasMore: false, source: 'POSTGRES', degraded: true });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.palette-empty')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.palette-degraded')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('.palette-error')).toBeNull();
    http.verify();
  });

  it('honors Retry-After without typing or automatic retries and owns one local error', async () => {
    vi.useFakeTimers();
    const { component, fixture, http } = await setup();
    component.searchQuery = 'test';
    component.onSearchChange('test');
    await vi.advanceTimersByTimeAsync(120);
    http.expectOne(req => req.url === '/api/v1/search').flush({ code: 'RATE_LIMITED', detail: 'internal diagnostic' },
      { status: 429, statusText: 'Too Many Requests', headers: { 'Retry-After': '2' } });
    fixture.detectChanges();
    expect((fixture.nativeElement.querySelector('.palette-retry') as HTMLButtonElement).disabled).toBe(true);
    expect(fixture.nativeElement.querySelectorAll('[role="alert"]').length).toBe(1);
    expect(TestBed.inject(ToastService).toasts()).toEqual([]);
    component.searchQuery = 'new';
    component.onSearchChange('new');
    await vi.advanceTimersByTimeAsync(1500);
    http.expectNone(req => req.url === '/api/v1/search');
    await vi.advanceTimersByTimeAsync(1000);
    http.expectNone(req => req.url === '/api/v1/search');
    fixture.detectChanges();
    (fixture.nativeElement.querySelector('.palette-retry') as HTMLButtonElement).click();
    await vi.advanceTimersByTimeAsync(120);
    const retry = http.expectOne(req => req.url === '/api/v1/search');
    expect(retry.request.params.get('q')).toBe('new');
    retry.flush({ query: 'new', totalHits: 0, hits: [], foundHits: 0, hasMore: false, source: 'TYPESENSE', degraded: false });
    http.verify();
  });

  it('validates trimmed Unicode code points from 2 through 200', async () => {
    vi.useFakeTimers();
    const { component, http } = await setup();
    for (const query of ['😀', 'x'.repeat(201)]) {
      component.onSearchChange(query);
      await vi.advanceTimersByTimeAsync(120);
      http.expectNone(req => req.url === '/api/v1/search');
    }
    component.onSearchChange(` ${'😀'.repeat(200)} `);
    await vi.advanceTimersByTimeAsync(120);
    const request = http.expectOne(req => req.url === '/api/v1/search');
    expect(request.request.params.get('q')).toBe('😀'.repeat(200));
    request.flush({ query: '', totalHits: 0, hits: [], foundHits: 0, hasMore: false, source: 'TYPESENSE', degraded: false });
    http.verify();
  });

  it('renders a real category control, plaintext snippets and returned/found/hasMore semantics', async () => {
    vi.useFakeTimers();
    const { component, fixture, http } = await setup();
    component.searchQuery = 'report';
    component.onSearchChange('report');
    await vi.advanceTimersByTimeAsync(120);
    const old = http.expectOne(req => req.url === '/api/v1/search');
    const category = fixture.nativeElement.querySelector('#search-category') as HTMLSelectElement;
    expect(Array.from(category.options).map(option => option.value)).toEqual(['ALL', 'TASK', 'PROJECT', 'USER', 'NOTE']);
    category.value = 'PROJECT'; category.dispatchEvent(new Event('change'));
    expect(old.cancelled).toBe(true);
    await vi.advanceTimersByTimeAsync(120);
    const request = http.expectOne(req => req.url === '/api/v1/search');
    expect(request.request.params.get('entity')).toBe('PROJECT');
    request.flush({ query: 'report', totalHits: 1, foundHits: 4, hasMore: true, source: 'TYPESENSE', degraded: false,
      hits: [{ entityType: 'PROJECT', id: '42', title: 'Report', description: '<img src=x onerror=alert(1)>plain snippet', targetUrl: 'https://invalid.test' }] });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.palette-count')?.textContent).toContain('Показано: 1 из 4');
    expect(fixture.nativeElement.querySelector('.palette-count')?.textContent).toContain('Есть ещё результаты');
    expect(fixture.nativeElement.querySelector('.result-desc')?.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(fixture.nativeElement.querySelector('.result-desc img')).toBeNull();
    expect(fixture.nativeElement.querySelector('.palette-degraded')).toBeNull();
    http.verify();
  });

  it('does not call intentional exact-ID PostgreSQL lookup a degraded search', async () => {
    vi.useFakeTimers();
    const { component, fixture, http } = await setup();
    component.searchQuery = '#42'; component.onSearchChange('#42');
    await vi.advanceTimersByTimeAsync(120);
    http.expectOne(req => req.url === '/api/v1/search').flush({ query: '#42', totalHits: 0, hits: [], foundHits: 0, hasMore: false, source: 'POSTGRES', degraded: false });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.palette-degraded')).toBeNull();
    expect(fixture.nativeElement.querySelector('.palette-empty')).not.toBeNull();
    http.verify();
  });

  it.each([['900', 300], [undefined, 1]])('bounds a %s Retry-After countdown across close and reopen', async (header, seconds) => {
    vi.useFakeTimers();
    const { component, fixture, http } = await setup();
    component.searchQuery = 'test'; component.onSearchChange('test');
    await vi.advanceTimersByTimeAsync(120);
    http.expectOne(req => req.url === '/api/v1/search').flush({},
      { status: 429, statusText: 'Too Many Requests', headers: header === undefined ? {} : { 'Retry-After': header } });
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.palette-error')?.textContent).toContain(`через ${seconds} с.`);
    component.paletteService.close(); fixture.detectChanges();
    component.paletteService.open(); fixture.detectChanges();
    component.searchQuery = 'new'; component.onSearchChange('new');
    await vi.advanceTimersByTimeAsync(120);
    http.expectNone(req => req.url === '/api/v1/search');
    await vi.advanceTimersByTimeAsync(Number(seconds) * 1000);
    http.expectNone(req => req.url === '/api/v1/search');
    fixture.detectChanges();
    expect((fixture.nativeElement.querySelector('.palette-retry') as HTMLButtonElement).disabled).toBe(false);
    http.verify();
  });
});
