import { useEffect } from 'preact/hooks';
import { formatNumber, t } from '../../lib/i18n';
import { Button } from '../components/ui/Button';
import { Switch } from '../components/ui/Switch';
import { aiState, checkAi, downloadAi } from '../state/localAi';
import { saveSettings } from '../state/settings';
import { settings } from '../state/store';
import './SettingsLocalAi.css';

const STATUS = {
  available: 'localAiAvailable',
  downloadable: 'localAiDownloadable',
  downloading: 'localAiDownloading',
  unavailable: 'localAiUnavailable',
} as const;

/**
 * The switch for Chrome's on-device AI, with what Chrome says about it here: ready, to download
 * (a button, since Chrome only downloads after a click), downloading, or unavailable.
 */
export function LocalAiSettings() {
  const { localAi } = settings.value;
  const { availability, progress } = aiState.value;
  useEffect(() => {
    if (localAi && availability === undefined) void checkAi();
  }, [localAi, availability]);
  return (
    <div class="settings-local-ai">
      <Switch
        label={t('localAiLabel')}
        description={t('localAiDescription')}
        checked={localAi}
        onChange={(checked) => void saveSettings({ localAi: checked })}
      />
      {localAi && availability && (
        <p class="settings-local-ai__status" role="status">
          {progress === undefined
            ? t(STATUS[availability])
            : t('localAiProgress', formatNumber(Math.round(progress * 100)))}{' '}
          {availability === 'downloadable' && (
            <Button size="sm" onClick={() => void downloadAi()}>
              {t('localAiDownload')}
            </Button>
          )}
        </p>
      )}
    </div>
  );
}
