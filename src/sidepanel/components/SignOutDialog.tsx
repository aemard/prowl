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
      showToast({ message: 'Could not sign out. Try again.', tone: 'danger' });
    }
    onClose();
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Sign out?"
      description="Prowl forgets your token and the pull requests it saved in this browser. The token itself stays valid on GitHub until you revoke it there."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="danger" onClick={() => void confirm()}>
            Sign out
          </Button>
        </>
      }
    />
  );
}
