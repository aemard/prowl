# Prowl design language

Prowl lives in Chrome's side panel (360–500 px wide), next to whatever you are doing. It should
feel like part of the browser: calm, quick to scan, and out of the way until something needs you.
The look is minimal: neutral surfaces with a trace of the logo's ink, one mint accent, small type,
and color only where it means something.

## Principles

1. **Typography does the work.** Hierarchy comes from size, weight and the muted text color, not
   from boxes and fills. Most surfaces are the plain panel background with hairline separators.
2. **Color means state.** Hues are reserved for pull request state (CI, review, merge) and for
   the one primary action on a screen. Everything else is neutral.
3. **Never color alone.** Every state color is paired with an icon, a word or a shape
   (e.g. a red ✕ plus "2 failing"), so it reads in grayscale and for color-blind users.
4. **Dense but airy.** A 4 px grid, 12 px body text, 24 px controls in lists and 28 px elsewhere.
   Enough room to scan a dozen pull requests without scrolling, never cramped.
5. **Follow the system.** The panel and the website take the system's light or dark theme by
   default; Settings can force one. Both themes are designed, checked for contrast and
   screenshotted.
6. **Quiet motion.** 120–180 ms, ease-out, only to show where something came from. Off under
   `prefers-reduced-motion` (the spinner keeps turning, slowly, because it is the only
   progress signal).
7. **Short words.** Sentence case, verbs on buttons ("Merge", "Request changes"), no jargon
   beyond what GitHub itself uses.

## Brand

- **Name:** Prowl, a cat on the prowl, quietly keeping an eye on your pull requests.
- **Mark:** a white cat peeking out of a mint circle with an ink ring (`src/assets/logo.svg`).
  The face fills most of the circle, so it still reads at 16 px. The ink ring carries the mark on
  light toolbars and the mint disc on dark ones.
- **Colors:** ink `#1e1e24` (also the light theme's text, `--gray-12`), mint `#a8dacd` (the dark
  theme's accent is a step more saturated), fur white. They live in the SVG only: the logo is one
  file, so they are not tokens.
- **Artwork:** traced from the 1024 px illustration into one circle and two paths (mint, white);
  the ink lines are the circle showing through. About 12 KB, 5 KB gzipped.
- **Icons:** `pnpm icons` rasterizes the SVG to `public/icons/icon-{16,32,48,128}.png`. 16–48 px
  use the full canvas; 128 px has 16 px of transparent padding around 96 px of artwork, as the
  Chrome Web Store asks. The panel shows the same SVG through `ProwlMark` (an `<img>`), and the
  website uses it as its favicon and header logo.
- Use the word "Prowl" next to the mark in the panel header; don't recolor, outline or stretch it.

## Color

All colors live in `src/styles/tokens.css`. Components use semantic tokens only (`--color-*`).
A unit test fails if any other stylesheet contains a hex, `rgb()` or `hsl()` color.

### Themes

The panel follows the system theme by default (the `theme` setting defaults to `system`, shown
as "Match system"): light, or dark when the system prefers dark. Settings > Theme can force one
through `<html data-theme="light">` or `<html data-theme="dark">`. The two dark blocks in
`tokens.css` must stay identical (tested). Each theme also sets `color-scheme`, so native
controls, scrollbars and `<select>` pickers match.

The palette is defined in OKLCH and written as hex: neutrals keep the logo ink's hue (285°) at a
very low chroma, and every hue uses the same lightness steps per role, so tints look related.

### Neutral scale

Steps follow one rule in both themes: 1 is the app background and 12 is high-contrast text.

| Step | Use | Light | Dark |
|---|---|---|---|
| `--gray-1` | `bg`: panel background | `#ffffff` | `#121215` |
| `--gray-2` | `bg-subtle`: insets (expanded card) | `#fafafb` | `#17171b` |
| `--gray-3` | `bg-hover`, `neutral-bg` | `#f3f3f6` | `#1e1e22` |
| `--gray-4` | `bg-active`, `border-subtle`, light skeleton | `#ececef` | `#242429` |
| `--gray-5` | dark skeleton shine | `#e6e6e9` | `#2a2a30` |
| `--gray-6` | `border`: cards, labels, menus, dialogs | `#dcdce0` | `#35353b` |
| `--gray-7` | `scrollbar`, dark `neutral-solid` | `#c3c3c9` | `#47474e` |
| `--gray-8` | `border-control` (3:1), `fg-disabled` | `#8b8b93` | `#6e6e76` |
| `--gray-9` | reserve | `#7b7b83` | `#7f7f87` |
| `--gray-10` | reserve | `#6f6f77` | `#919199` |
| `--gray-11` | `fg-muted`, `neutral-fg` | `#5f6067` | `#b0b0b7` |
| `--gray-12` | `fg` (light: the logo's ink) | `#1e1e24` | `#ececef` |

`--color-surface` is the overlay and button surface (menus, dialogs, toasts, secondary buttons):
`#ffffff` in light, `#1b1b1f` in dark (a step lighter than the background, since shadows barely
show on dark).

### State hues

Each hue has `-fg` (text and icons on any neutral surface), `-bg` (tinted background),
`-border` (outline chips) and `-solid` (strong fill under `--color-fg-on-solid` white text).
`accent` and `danger` also have `-solid-hover`. The accent is the exception for text on a fill:
in dark it is the light mint, so text on it is `--color-fg-on-accent` (white in light, the dark
background in dark). Primary buttons, a checked switch's thumb and solid accent badges use it.

| Hue | Means in Prowl | Pair with | Light fg / solid | Dark fg / solid |
|---|---|---|---|---|
| `accent` | Primary action, links, focus, selection, unseen changes | | `#007467` / `#007a6d` | `#89ddcf` / `#89ddcf` |
| `success` | Checks passed, approved | check icon | `#1d7635` / `#217937` | `#60c473` / `#217937` |
| `danger` | Checks failed, changes requested, closed, destructive actions | ✕ icon | `#be222a` / `#c2272d` | `#fb817a` / `#c2272d` |
| `warning` | Merge conflicts, rate limited, offline, stale data | alert icon | `#a84811` / `#a84811` | `#f59569` / `#a84811` |
| `attention` | Checks pending, review required | dot icon | `#825b0c` / `#825b0c` | `#e8af4f` / `#825b0c` |
| `done` | Merged | merge icon | `#7447c8` / `#774bcb` | `#b49cf7` / `#774bcb` |
| `neutral` | Draft, counts, skipped checks | draft icon or text | `#5f6067` / `#5f6067` | `#b0b0b7` / `#47474e` |

The accent hue (182°) sits a little cooler than the logo's mint (177°) so it stays apart from
`success` green (148°).

### Contrast

Every text/background pair meets WCAG 2.2 AA: 4.5:1 for text (all Prowl text is below the
"large text" size, so the stricter ratio applies everywhere), 3:1 for UI component boundaries,
focus indicators and graphics. Hairline separators (`border-subtle`, `border`) are decorative and
not listed. Disabled controls are exempt, but keep their label legible.
`src/styles/tokens.test.ts` computes this table from `tokens.css` and fails when a pair drops
below its minimum or when this table is out of date (it prints the new table to paste here).

<!-- contrast:start -->
Text, 4.5:1 minimum. Each cell is `light / dark`.

| Text token | `bg` | `bg-subtle` | `bg-hover` | `bg-active` | `surface` | `tint` |
|---|---:|---:|---:|---:|---:|---:|
| `fg` | 16.58 / 15.86 | 15.90 / 15.16 | 14.97 / 14.09 | 14.06 / 13.10 | 16.58 / 14.56 | 15.28 / 12.95 (`accent-bg`) |
| `fg-muted` | 6.26 / 8.67 | 6.00 / 8.29 | 5.65 / 7.71 | 5.31 / 7.16 | 6.26 / 7.96 | 5.77 / 7.08 (`accent-bg`) |
| `neutral-fg` | 6.26 / 8.67 | 6.00 / 8.29 | 5.65 / 7.71 | 5.31 / 7.16 | 6.26 / 7.96 | 5.65 / 7.71 (`neutral-bg`) |
| `accent-fg` | 5.68 / 11.85 | 5.45 / 11.33 | 5.13 / 10.53 | 4.82 / 9.79 | 5.68 / 10.88 | 5.24 / 9.68 (`accent-bg`) |
| `success-fg` | 5.68 / 8.58 | 5.45 / 8.21 | 5.13 / 7.63 | 4.82 / 7.09 | 5.68 / 7.88 | 5.17 / 7.15 (`success-bg`) |
| `danger-fg` | 6.08 / 7.59 | 5.83 / 7.25 | 5.49 / 6.74 | 5.16 / 6.27 | 6.08 / 6.97 | 5.45 / 6.43 (`danger-bg`) |
| `warning-fg` | 5.83 / 8.36 | 5.59 / 7.99 | 5.27 / 7.43 | 4.95 / 6.90 | 5.83 / 7.67 | 5.21 / 7.00 (`warning-bg`) |
| `attention-fg` | 6.09 / 9.51 | 5.83 / 9.09 | 5.49 / 8.45 | 5.16 / 7.85 | 6.09 / 8.73 | 5.53 / 7.80 (`attention-bg`) |
| `done-fg` | 6.04 / 8.05 | 5.79 / 7.69 | 5.45 / 7.15 | 5.12 / 6.65 | 6.04 / 7.39 | 5.43 / 6.75 (`done-bg`) |

Text on solid fills (`fg-on-accent` on the accent, `fg-on-solid` on the rest), 4.5:1 minimum.

| Background | Light | Dark |
|---|---:|---:|
| `accent-solid` | 5.24 | 11.85 |
| `accent-solid-hover` | 6.79 | 13.39 |
| `success-solid` | 5.45 | 5.45 |
| `danger-solid` | 5.80 | 5.80 |
| `danger-solid-hover` | 7.47 | 4.90 |
| `warning-solid` | 5.83 | 5.83 |
| `attention-solid` | 6.09 | 6.09 |
| `done-solid` | 5.75 | 5.75 |
| `neutral-solid` | 6.26 | 9.21 |

UI components and graphics, 3:1 minimum.

| Foreground | Background | Light | Dark |
|---|---|---:|---:|
| `border-control` | `bg` | 3.38 | 3.70 |
| `border-control` | `bg-subtle` | 3.24 | 3.54 |
| `border-control` | `surface` | 3.38 | 3.40 |
| `focus` | `bg` | 5.24 | 11.85 |
| `focus` | `bg-subtle` | 5.03 | 11.33 |
| `focus` | `surface` | 5.24 | 10.88 |
| `accent-solid` | `bg` | 5.24 | 11.85 |
| `fg-on-solid` | `border-control` | 3.38 | 5.05 |
<!-- contrast:end -->

GitHub label colors are user-defined, so they never carry text: a label is an outlined pill
with its name in `fg-muted` after a 6 px dot of the label's color (`--label-color`). The name
carries the meaning, so the dot needs no contrast; a faint `--color-fg` ring keeps near-white and
near-black dots visible in both themes. An E2E test checks every rendered dot against its label.

## Typography

System UI font (`--font-sans`), so Prowl matches the browser chrome on every OS; `--font-mono`
for branch names and SHAs. Numbers in badges use tabular figures.

| Token | Size / line height | Use |
|---|---|---|
| `--text-xs` / `--leading-xs` | 10 / 14 px | Small counts (`Badge size="sm"`). Never for sentences. |
| `--text-sm` / `--leading-sm` | 11 / 16 px | Metadata (repo#number, time), hints, labels, small buttons, badges |
| `--text-md` / `--leading-md` | 12 / 18 px | Body default, PR titles, controls |
| `--text-lg` / `--leading-lg` | 13 / 20 px | Panel and dialog titles, empty-state titles |
| `--text-xl` / `--leading-xl` | 16 / 22 px | The Settings heading |
| `--text-2xl` / `--leading-2xl` | 20 / 26 px | The device-flow code only |

The scale is one step smaller than Chrome's own UI text so a 400 px panel shows more pull
requests; Chrome's page zoom (and the OS text scale) still enlarges it, since every size is in
CSS px.

Weights: `--weight-regular` 400 (body), `--weight-medium` 500 (PR titles, buttons, labels),
`--weight-semibold` 600 (headings). Long titles wrap; branch names and labels truncate with an
ellipsis and keep the full text in `title`.

## Spacing, size and shape

- **Spacing:** 4 px grid: `--space-1` 4, `-2` 8, `-3` 12, `-4` 16, `-5` 20, `-6` 24, `-8` 32,
  `-10` 40, `-12` 48 px, plus `--space-0-5` (2) and `--space-1-5` (6) for optical alignment
  inside controls. Panel gutters are `--space-4`; list rows use `--space-3` vertical padding.
- **Controls:** `--control-sm` 24 px (dense rows), `--control-md` 28 px (default); 24 px is the
  WCAG 2.2 minimum target size, so nothing interactive is smaller. Icons `--icon-sm` 12,
  `--icon-md` 16 (also avatars), `--icon-lg` 20 px.
- **Radius:** `--radius-sm` 4 (skeleton lines), `--radius-md` 6 (buttons, inputs, menu items),
  `--radius-lg` 10 (cards, menus, dialogs, toasts), `--radius-full` (badges, labels, switches,
  avatars).
- **Borders:** `--border-width` 1 px hairlines. Focus: `--focus-width` 2 px solid `--color-focus`
  at `--focus-offset` 2 px, set once in `base.css` on `:focus-visible`. Text inputs show a ring on
  any focus.
- **Elevation:** only overlays are raised: `--shadow-sm` (switch thumb), `--shadow-md` (menus,
  toasts), `--shadow-lg` (dialogs). Dark shadows are stronger, and dark surfaces also step lighter.
- **Layers:** `--z-sticky` 10 (sticky header, section bar), `--z-menu` 40, `--z-toast` 50; dialogs
  use the browser top layer.
- **Bottom bar:** while the section bar is fixed at the bottom of the panel it sets
  `--app-inset-bottom` (48 px + hairline) on `:root`, and nothing else may sit under it: the page
  ends above it (`.app-main` padding), focus and `scrollIntoView` stop above it (`html`
  `scroll-padding-bottom`), toasts rise above it, menus open above it (they measure the element
  marked `data-bottom-bar`) and close when their trigger scrolls behind it, and a card behind it
  does not count as seen.

## Motion

| Token | Value | Reduced motion | Use |
|---|---|---|---|
| `--duration-fast` | 120 ms | 0 ms | Hover, press, switch thumb, menu in |
| `--duration-normal` | 180 ms | 0 ms | Dialog and toast in |
| `--duration-spin` | 800 ms | 1600 ms | Spinner rotation (essential, kept) |
| `--duration-shimmer` | 1400 ms | animation off | Skeleton shimmer (decorative) |
| `--ease-standard` | `cubic-bezier(0.2, 0, 0, 1)` | | State changes |
| `--ease-out` | `cubic-bezier(0.16, 1, 0.3, 1)` | | Things entering |

Use the duration tokens for every transition and animation, so `prefers-reduced-motion: reduce`
collapses them in one place. Purely decorative animations (like the shimmer) also switch off in
their own stylesheet.

## Icons

`src/sidepanel/components/icons/` holds 16 px inline-SVG Preact components using `currentColor`.
They are decorative (`aria-hidden`) unless given a `label`, which makes them `role="img"`.
Only the icons a bundle imports are shipped.

**License:** the paths come from [Octicons](https://github.com/primer/octicons) v19.38.0,
GitHub's icon set, so states look the way GitHub users expect. Octicons are under the MIT License,
Copyright (c) 2026 GitHub Inc. The full license text ships with the extension in
`public/THIRD_PARTY_NOTICES.txt` (the minifier drops license comments, so a file is used). To add
an icon, copy the `d` of its 16 px SVG into `icons/index.ts` as
`export const NameIcon = /* @__PURE__ */ createIcon('...')`. `ProwlMark` is Prowl's own artwork.

| Icon | Meaning in Prowl |
|---|---|
| `GitPullRequestIcon`, `GitPullRequestDraftIcon`, `GitPullRequestClosedIcon`, `GitMergeIcon` | PR open, draft, closed, merged |
| `CheckIcon`, `XIcon`, `DotFillIcon`, `SkipIcon` | Checks passed, failed, pending, skipped; approve; close |
| `CheckCircleFillIcon`, `XCircleFillIcon`, `AlertIcon`, `AlertFillIcon`, `InfoIcon` | Toast and banner tones, conflicts, field errors |
| `CommentIcon`, `CommentDiscussionIcon`, `EyeIcon`, `PersonIcon`, `MentionIcon`, `FileDiffIcon` | Comments, unresolved threads, review required, author, mentioned, changes requested |
| `SyncIcon`, `GearIcon`, `KebabHorizontalIcon`, `ChevronDownIcon`, `ChevronUpIcon`, `ChevronRightIcon`, `ArrowLeftIcon` | Refresh, settings, more actions, expand, navigate, back |
| `SearchIcon`, `FilterIcon`, `BellIcon`, `BellSlashIcon`, `ClockIcon`, `LinkExternalIcon`, `CopyIcon`, `GitBranchIcon` | Filter, custom section, notifications, muted, snooze (and the rate-limit and stale banners), open in GitHub, copy, branch |
| `SignOutIcon`, `MarkGithubIcon`, `KeyIcon`, `PlusIcon`, `TrashIcon`, `PencilIcon`, `InboxIcon`, `CloudOfflineIcon` | Account, sign-in, token (and the rejected-token banner), add/remove/edit, empty list, offline (and the offline banner) |

## Components

Import each from its own module (`components/ui/Button`), not from a barrel, so a view only pulls
in the CSS it uses. Every component takes `class` for layout tweaks. Variants are `data-*`
attributes (`data-variant`, `data-size`, `data-tone`) styled in the component's `.css` file.

| Component | Use it for | Key props | Accessibility |
|---|---|---|---|
| `Button` | Any text action | `variant` primary / secondary (default) / danger / ghost, `size` sm (24) / md (28), `icon`, `loading` | Native `<button type="button">`; `loading` sets `aria-busy` + `aria-disabled`, keeps focus, ignores clicks and submits |
| `IconButton` | Toolbar and row actions | required `label`, `variant` ghost / secondary, `size`, `pressed`, `loading` | `label` is the `aria-label` and tooltip; `pressed` sets `aria-pressed` |
| `Badge` | PR state, counts | `tone` (7 hues), `variant` subtle / solid / outline / plain (icon and word, no fill), `size` sm (16) / md (18), `icon`, `title` | Text inside, never color only; truncates with ellipsis |
| `Avatar` | A person or bot next to their name | `src` (a person icon without one), `title` | Decorative (`alt=""`): the login is always in text beside it; 16 px, round |
| `Spinner` | Indeterminate progress | `size` 12–24, `label` | Decorative unless `label`, then `role="status"` |
| `Skeleton` | Loading placeholders | `shape` text / circle / rect, `width`, `height` | `aria-hidden`; put `aria-busy` and a label on the loading container |
| `Dialog` | Confirmations, composers | `open`, `onClose`, `title`, `description`, `footer`, `initialFocus`, `closeOnBackdrop` | Native modal `<dialog>`: top layer, inert page, Tab trapped, Esc closes, focus returns to the opener; named by the title, described by the description |
| `Menu` | Overflow actions, single choice lists | `trigger` render prop, `items` (`MenuItem` or `'separator'`), `align` start / end, `label` | APG menu button: Enter / Space / ↓ open on the first item, ↑ on the last, arrows wrap, Home / End, type-ahead, Esc and Tab close and return focus; `checked` makes `menuitemradio`; follows its trigger on scroll |
| `Switch` | Settings that apply immediately | `checked`, `onChange`, `label`, `description`, `hideLabel`, `disabled` | `role="switch"` button with `aria-checked`, 40 × 24 hit target (28 × 16 track), labelled by its visible label; the thumb position also shows state |
| `TextField` | Text input and textarea | `label`, `value`, `onValueChange`, `type`, `multiline`, `hint`, `error`, `icon`, `hideLabel`, `inputRef` | Visible `<label>`; `aria-describedby` error + hint; `aria-invalid` and an icon on error |
| `Select` | Short single-choice lists in forms | `label`, `value`, `options`, `onValueChange`, `hint`, `error` | Native `<select>`: keyboard and screen readers for free |
| `ToastRegion`, `showToast`, `dismissToast` | Action outcomes ("Approved #42", "Copied") | `message`, `tone` info / success / danger, `action`, `durationMs` | One polite `aria-live` region, always mounted; max 3; 5 s (8 s for errors), paused on hover and focus; `durationMs: 0` stays until dismissed |
| `EmptyState` | Empty lists and filtered-out results | `title`, `description`, `icon`, `action`, `headingLevel` | Real heading at the level you choose |
| `ProwlMark` | Logo in the header | `size` (20), `label` | An `<img>` of `logo.svg`; decorative (`alt=""`) next to the word "Prowl", named by `label` alone |

`Field` (label, hint, error layout plus `.ui-control` chrome) is internal to `TextField` and
`Select`. `cx.ts` has `cx()` for class names, the shared `Tone` type and `focusableIn()`.

### Feature components

Built from the components above; they live in `components/`, not `components/ui/`.

| Component | Use it for | Notes |
|---|---|---|
| `PullRequestCard` | One PR in the list | A summary and, expanded, its details. The title is a link to GitHub (`GitHubLink`, opens a new tab) and a sibling `IconButton` chevron expands the card; a click on the rest of the summary does the same, Escape folds it back with focus on the chevron. Full width, hairline separated, hover `bg-hover`. Rows: avatar + repo#number + last activity + chevron, title (2 lines, then ellipsis, underlined on hover), status chips (plain: icon and word in the tone's color, no fill), labels (dots), counts + "Opened ... ago". Labels and counts share a line when they fit. The link is named "Title, owner/name#n"; the chevron is "Details for Title" and its description is every fact the card shows (`describePullRequest`). A dot in the left gutter marks unseen changes (same `isSeen` as the badge) and is in the description too. Row actions go beside the link, never inside it. |
| `PullRequestDetails` | What an expanded card shows | An inset panel (`bg-subtle`, hairline above): **Merge** (one line per blocker with a tone icon, or "Ready to merge"), **Checks** (failed and pending first with a state word, a "Required" badge and a link to GitHub; passed and skipped folded in a native `<details>`), **Actions** (one wrapping row of `size="sm"` buttons right after Merge, so it stays put while the detail loads; `ReviewActions` fills it with Approve, Request changes and Comment, secondary with a 12 px icon, each named with its PR, then `MergeAction`'s Merge, primary only when the PR is ready to merge (secondary beside blockers); the dialogs are a `Dialog` with a labelled multi-line `TextField` (merge: a `Select` of the allowed methods and a `TextField` for the commit title), Cancel first and one primary button), **Reviewers** (avatar, login, plain state `Badge`). Skeleton rows while loading, a warning notice with "Try again" on failure, no headings (labels name their lists) so the page outline stays flat. |
| `StatusBanner` | Why Prowl cannot update, or that the list is stale | A full-width strip under the header, above the list (which it never hides): tone icon (key, clock, cloud-off, alert), a semibold title, one or two `--text-sm` lines (GitHub's message, the "Last updated 14 min ago." age) and at most one `size="sm"` button (Re-authenticate is primary, Retry / Refresh now secondary). `danger` background for a rejected token and GitHub errors, `warning` for rate limits, offline and stale data; text stays `--color-fg` (not the tone's own fg) so it keeps its contrast on the tinted background, the icon and the words carry the meaning. Title and detail are a `role="status"` live region (`alert` for a rejected token); the age is outside it, since it ticks. |
| `SectionTabs` | The section bar at the bottom of the list | Fixed under the scrolling list (header and quick filter stay on top), hairline above, `bg` fill, shown only in the list with two or more sections. Equal slots (at most 480 px in all, centred), each 48 px tall: the section's 16 px icon with its count `Badge` beside it, over a short `--text-sm` label (Mine `GitPullRequestIcon`, Review `EyeIcon`, Mentions `MentionIcon`, Assigned `PersonIcon`, a custom section's own label with `FilterIcon`, cut with an ellipsis); the full name is the tooltip. Selected: a 2 px accent bar on the top edge, accent icon and count, semibold label, `aria-selected`. A failed section shows a warning icon + "Could not load" instead of its count. Up to five sections fit 320 px; past five, the fifth slot is "More" (`KebabHorizontalIcon`), a `Menu` of the rest (`menuitemradio`: icon, full name, count), marked selected like a tab when the section shown is in it and named "More sections, Docs selected". APG tabs: one tab stop (the first tab while the selection is under More), arrows / Home / End move and select; "More" is a separate menu button after the tab list. In the DOM the bar comes after the filter and before the panel it controls. Kinds map to icon and short name in `KINDS` (`views/List.tsx`), one entry per kind. |
| `SettingsGroup` (view) | A titled block of the settings screen | `h2` title, optional muted description, groups separated by a hairline, `--space-4` gutters. Sub-headings are `h3`; lists of switches are `ul`s named by their heading. Hints and notes are `--text-sm` muted. |
| `RepoFilter` | A list of `owner` / `owner/name` patterns | A `fieldset` named "Include" or "Exclude" with its hint as description; mono chips with a 28 px remove button each (truncated with the full text in `title`), then a field plus Add that validates, rejects duplicates and announces adds and removals. |
| `NumberField` | A whole number that saves as you type | A `TextField type="number"`; shows an error while the text is out of range and the saved value again on blur. |
| `SignOutDialog` | Confirming sign-out (header menu and Settings) | A `Dialog` with Cancel first and a `danger` Sign out; the token stays valid on GitHub, and the text says so. |

**Status chips** (`prStatus.ts`, always icon + word in the tone's `-fg`, no fill, tone from the
table above): Draft (neutral);
CI "2 failing" / "3 pending" / "8 passed" (none when there are no checks); Approved / Changes
requested / Review required (hidden on drafts, which nobody is expected to review yet);
Conflicts (warning) or Ready to merge (success, replaces Approved because it implies it).

### Patterns

- **One primary button per view.** Destructive confirmations put Cancel first and a `danger`
  button last; `initialFocus` goes to the least destructive control.
- **Lists:** rows are full-width, hairline-separated (`--color-border-subtle`), hover
  `--color-bg-hover`, selected `--color-bg-active`. Row actions use `size="sm"` controls.
  Rows that touch the panel edge draw their focus ring inside (`outline-offset` negative).
- **Status chips:** `Badge tone=… variant="plain"` with a 12 px icon: ✕ "2 failing", ● "Review
  required", ⚠ "Conflicts", merge icon "Merged". Keep fills for counts and the few badges that
  stand alone (onboarding's "Recommended"); a row of text stays fill-free.
- **Loading:** show skeletons that match the final layout for first loads. For refreshes keep the
  data and spin the refresh `IconButton` (`loading`).
- **Feedback:** use a toast for results of actions, inline `TextField` errors for validation, and
  banners (`StatusBanner`) for persistent problems.
