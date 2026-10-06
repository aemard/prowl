import { sendToBackground } from '../state/background';
import { navigate } from '../state/router';
import { pollState, settings, snapshot } from '../state/store';
import { AlertIcon, ClockIcon, CloudOfflineIcon, KeyIcon } from './icons';
import { type BannerKind, describeStatus } from './StatusBannerModel';
import { Button } from './ui/Button';
import { useNow } from './useNow';
import './StatusBanner.css';

const ICONS: Record<BannerKind, typeof AlertIcon> = {
  unauthorized: KeyIcon,
  rate_limited: ClockIcon,
  offline: CloudOfflineIcon,
  error: AlertIcon,
  stale: ClockIcon,
};

/**
 * Says why Prowl cannot update (rejected token, rate limit, offline, a GitHub error) or that the
 * list is stale, and what to do about it. It sits above the view and never replaces it: the last
 * snapshot stays readable. A rejected token is an alert, everything else a polite status. The
 * age line stays out of that live region, so a ticking time is not announced again and again.
 */
export function StatusBanner() {
  useNow(30_000); // re-renders as the minutes pass; the time itself is read fresh below
  const banner = describeStatus(
    pollState.value,
    snapshot.value?.fetchedAt,
    settings.value.pollIntervalMinutes,
    Date.now(),
  );
  if (!banner) return null;
  const Icon = ICONS[banner.kind];
  const { action } = banner;

  return (
    <div class="status-banner" data-tone={banner.tone} data-kind={banner.kind}>
      <Icon size={16} />
      <div class="status-banner__body">
        <div role={banner.kind === 'unauthorized' ? 'alert' : 'status'}>
          <p class="status-banner__title">{banner.title}</p>
          {banner.detail && <p class="status-banner__text">{banner.detail}</p>}
        </div>
        {banner.age && <p class="status-banner__text">{banner.age}</p>}
      </div>
      {action && (
        <Button
          size="sm"
          variant={action.type === 'reauthenticate' ? 'primary' : 'secondary'}
          loading={action.type === 'retry' && pollState.value?.inFlight}
          onClick={() =>
            action.type === 'reauthenticate'
              ? navigate('onboarding')
              : void sendToBackground({ type: 'poll', force: true })
          }
        >
          {action.label}
        </Button>
      )}
    </div>
  );
}
