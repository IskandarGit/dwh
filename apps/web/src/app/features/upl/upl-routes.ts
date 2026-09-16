import { UrlMatcher } from '@angular/router';

/** `/upl/sources` и `/upl/sources/:id` — один маршрут: список и карточка (как iam/users). */
export const uplSourceMatcher: UrlMatcher = segments => {
  if (segments[0]?.path !== 'upl' || segments[1]?.path !== 'sources' || segments.length > 3) return null;
  if (segments.length === 3 && !/^[1-9]\d{0,18}$/.test(segments[2].path)) return null;
  return { consumed: segments, ...(segments[2] ? { posParams: { id: segments[2] } } : {}) };
};

/** `/upl/sources/:id/formats/:v` — анкета версии. */
export const uplFormatMatcher: UrlMatcher = segments => {
  if (segments.length !== 5 || segments[0]?.path !== 'upl' || segments[1]?.path !== 'sources'
    || segments[3]?.path !== 'formats') return null;
  if (!/^[1-9]\d{0,18}$/.test(segments[2].path) || !/^[1-9]\d{0,3}$/.test(segments[4].path)) return null;
  return { consumed: segments, posParams: { id: segments[2], v: segments[4] } };
};
