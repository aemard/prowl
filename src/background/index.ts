/**
 * Service worker entry point. Keep this file thin: wire Chrome events to
 * modules in `src/background/*` and `src/lib/*`, which are unit tested.
 */
import { registerBackground } from './register';

registerBackground();
