import { t } from '../../lib/i18n';
import { signOut } from '../state/session';
import { Button } from './ui/Button';
import { Dialog } from './ui/Dialog';
import { showToast } from './ui/Toast';

/** Asks before forgetting the account (the header menu and Settings both open it). */
export function SignOutDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  async function confirm() {
    try {
      await signOut();
    } catch {
      showToast({ message: t('couldNotSignOutTryAgain'), tone: 'danger' });
    }
    onClose();
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t('signOut2')}
      description={t('prowlForgetsYourTokenAndThePullRequestsIt')}
      footer={
        <>
          <Button onClick={onClose}>{t('cancel')}</Button>
          <Button variant="danger" onClick={() => void confirm()}>
            {t('signOut')}
          </Button>
        </>
      }
    />
  );
}
