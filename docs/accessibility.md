# Accessibility

Prowl targets WCAG 2.2 AA in the side panel and on the website.

## Keyboard

Everything is reachable with Tab and operable with Enter/Space. In the list:

| Keys | Action |
|---|---|
| `j` / `↓` | Next pull request |
| `k` / `↑` | Previous pull request |
| `Enter` / `Space` | Expand or collapse the focused pull request |
| `o` | Open the focused pull request on GitHub |
| `r` | Refresh now |
| `/` | Filter pull requests |
| `?` | Show keyboard shortcuts (also in the account menu) |
| `Esc` | Close a dialog or menu, collapse a pull request |

Shortcuts never fire while typing in a field, inside a menu or a dialog, or with Ctrl, Cmd or
Alt held. Arrows and `o` only act inside the list, so they keep their normal meaning elsewhere.
Menus follow the ARIA menu pattern (arrows, Home/End, Esc); dialogs are native `<dialog>`s that
trap focus and return it to the control that opened them.

## Screen readers

- Cards: the title is a link named after the PR; the expand button describes every fact on the
  card (CI, reviews, merge state, labels, activity), so status is never only a color or an icon.
- Toasts (`role=region` "Messages", polite live region) report every action's outcome.
- A refresh the user asks for (button or `r`) is announced ("Updated. 12 pull requests." or the
  error). Background polls stay silent.
- Banners for a revoked token or errors use `role=alert`; rate-limit and offline notices use
  `role=status`.

## Visual

- All text and UI tokens meet AA contrast in light and dark (checked by `src/styles/tokens.test.ts`
  against the table in `docs/design.md`); label colors pick black or white text to reach AA.
- Visible focus ring on every control; `prefers-reduced-motion` turns off non-essential motion.
- Layout works from 320 px to full width without horizontal scrolling.

## How it is tested

- Every screen and dialog runs axe (`expectNoA11yViolations`) in E2E, in light and dark:
  onboarding, device flow, list, expanded card, review and merge dialogs, sign-out, settings,
  banners and the shortcuts dialog (`tests/e2e/*.spec.ts`, see `tests/e2e/keyboard.spec.ts`).
  The helper first lets running transitions and animations end: axe reads the colors it finds, so
  a scan during a theme switch can report contrast that is gone 120 ms later.
- Component tests query by role and accessible name, not by class.
- The website is checked with axe and Lighthouse (accessibility 100) on every page.
