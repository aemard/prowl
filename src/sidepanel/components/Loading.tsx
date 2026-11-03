import { t } from '../../lib/i18n';
import { Skeleton } from './ui/Skeleton';
import './Loading.css';

/** Available before storage and the selected catalog finish loading. */
export function Loading() {
  return (
    <main class="app-main" aria-busy="true" aria-label={t('loading')}>
      <div class="app-loading">
        <span class="sr-only" role="status">
          {t('loading')}
        </span>
        {[0, 1, 2].map((row) => (
          <div class="app-loading__row" key={row}>
            <Skeleton shape="circle" width={16} />
            <div class="app-loading__lines">
              <Skeleton width="85%" />
              <Skeleton width="50%" />
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
