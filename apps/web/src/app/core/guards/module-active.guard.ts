import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { ModuleService } from '../services/module.service';
import { ToastService } from '../services/toast.service';
import { I18nService } from '../services/i18n.service';
import { map, of } from 'rxjs';

export function moduleActiveGuard(moduleCode: string): CanActivateFn {
  return () => {
    const moduleService = inject(ModuleService);
    const router = inject(Router);
    const toast = inject(ToastService);
    const i18n = inject(I18nService);

    const check = () => {
      if (moduleService.isModuleActive(moduleCode)) {
        return true;
      }
      toast.warning(i18n.translate('modules.module_disabled_redirect', { module: moduleCode }));
      return router.createUrlTree(['/tasks']);
    };

    if (!moduleService.isLoaded()) {
      return moduleService.loadActiveModules().pipe(
        map(() => check())
      );
    }
    return of(check());
  };
}
