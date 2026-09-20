import { TestBed } from '@angular/core/testing';
import { ActivatedRoute, convertToParamMap } from '@angular/router';
import { of, throwError } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { EmbeddedReportComponent } from './embedded-report.component';
import { NavigationService } from '../../core/services/navigation.service';
import { I18nService } from '../../core/services/i18n.service';
import { translateTest } from '../../../testing/i18n-test.stub';
import { CustomNavigationItem } from '../../core/models/navigation.models';

describe('EmbeddedReportComponent', () => {
  const sampleReport: CustomNavigationItem = {
    id: 1,
    code: 'superset-sales',
    title: 'Отчет по продажам (Superset)',
    sectionId: 'custom-reports',
    icon: 'bar-chart',
    targetType: 'EMBEDDED_IFRAME',
    url: 'https://superset.example.com/superset/dashboard/sales/',
    openInIframe: true,
    sortOrder: 10,
    state: 'A',
    createdAt: '2026-09-09T10:00:00Z',
    modifiedAt: '2026-09-09T10:00:00Z'
  };

  function setup(codeParam: string = 'superset-sales', itemResult = of(sampleReport)) {
    const navService = {
      getItemByCode: vi.fn().mockReturnValue(itemResult)
    };

    const route = {
      paramMap: of(convertToParamMap({ code: codeParam })),
      snapshot: {
        paramMap: convertToParamMap({ code: codeParam })
      }
    };

    const i18nService = {
      translate: translateTest
    };

    TestBed.configureTestingModule({
      imports: [EmbeddedReportComponent],
      providers: [
        { provide: NavigationService, useValue: navService },
        { provide: ActivatedRoute, useValue: route },
        { provide: I18nService, useValue: i18nService }
      ]
    });

    const fixture = TestBed.createComponent(EmbeddedReportComponent);
    return { fixture, navService };
  }

  it('loads report by route parameter and creates safe url', () => {
    const { fixture, navService } = setup();
    fixture.detectChanges();

    expect(navService.getItemByCode).toHaveBeenCalledWith('superset-sales');
    expect(fixture.componentInstance.report()?.code).toBe('superset-sales');
    expect(fixture.componentInstance.safeUrl()).not.toBeNull();
    expect(fixture.componentInstance.urlHost()).toBe('superset.example.com');
  });

  it('renders iframe with sandbox security attributes', () => {
    const { fixture } = setup();
    fixture.detectChanges();

    const iframe: HTMLIFrameElement = fixture.nativeElement.querySelector('iframe.report-iframe');
    expect(iframe).not.toBeNull();
    expect(iframe.getAttribute('sandbox')).toBe('allow-scripts allow-same-origin allow-forms allow-popups allow-downloads');
    expect(iframe.getAttribute('referrerpolicy')).toBe('no-referrer-when-downgrade');
  });

  it('toggles fullscreen mode', () => {
    const { fixture } = setup();
    fixture.detectChanges();

    expect(fixture.componentInstance.isFullscreen()).toBe(false);
    fixture.componentInstance.toggleFullscreen();
    expect(fixture.componentInstance.isFullscreen()).toBe(true);

    fixture.detectChanges();
    const container = fixture.nativeElement.querySelector('.embedded-report-container');
    expect(container.classList.contains('fullscreen')).toBe(true);
  });

  it('handles error when report cannot be loaded', () => {
    const { fixture, navService } = setup('not-found', throwError(() => new Error('Not found')));
    fixture.detectChanges();

    expect(fixture.componentInstance.errorMessage()).not.toBeNull();
    expect(fixture.componentInstance.isLoading()).toBe(false);

    const errorAlert = fixture.nativeElement.querySelector('.report-error');
    expect(errorAlert).not.toBeNull();
  });
});
