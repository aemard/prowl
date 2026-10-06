# Prowl design language

Prowl lives in Chrome's side panel (360–500 px wide), next to whatever you are doing. It should
feel like part of the browser: calm, quick to scan, and out of the way until something needs you.

## Principles

1. **Typography does the work.** Hierarchy comes from size, weight and the muted text color, not
   from boxes and fills. Most surfaces are the plain panel background with hairline separators.
2. **Color means state.** Hues are reserved for pull request state (CI, review, merge) and for
   the one primary action on a screen. Everything else is neutral.
3. **Never color alone.** Every state color is paired with an icon, a word or a shape
   (e.g. a red ✕ plus "2 failing"), so it reads in grayscale and for color-blind users.
4. **Dense but airy.** A 4 px grid, 13 px body text, 28 px controls in lists and 32 px elsewhere.
   Enough room to scan a dozen pull requests without scrolling, never cramped.
5. **Light and dark are equal.** Both themes are designed, checked for contrast and screenshotted.
6. **Quiet motion.** 120–180 ms, ease-out, only to show where something came from. Off under
   `prefers-reduced-motion` (the spinner keeps turning, slowly, because it is the only
   progress signal).
7. **Short words.** Sentence case, verbs on buttons ("Merge", "Request changes"), no jargon
   beyond what GitHub itself uses.

## Brand

- **Name:** Prowl, a cat on the prowl, quietly keeping an eye on your pull requests.
- **Mark:** a cat's eye, an amber almond with a vertical slit pupil, on a rounded indigo tile
  (`src/assets/logo.svg`, `ProwlMark` in the app). The tile carries the mark on light toolbars,
  and the amber eye carries it on dark ones. At 16 px the eye is 13 × 8 px with a 2 px pupil
  centred on the pixel grid.
- **Colors:** tile `--color-brand` `#3b4fd8` (also the light accent), eye `--color-brand-eye`
  `#ffc53d`, pupil `--color-brand-pupil` `#1d2266`. The eye is 4.0:1 on the tile.
- **Icons:** `pnpm icons` rasterizes the SVG to `public/icons/icon-{16,32,48,128}.png`. 16–48 px
  use the full canvas; 128 px has 16 px of transparent padding around 96 px of artwork, as the
  Chrome Web Store asks. Change the geometry in `logo.svg` and `ProwlMark.tsx` together (a unit
  test compares them).
- Use the word "Prowl" next to the mark in the panel header; don't recolor, outline or stretch it.

## Color

All colors live in `src/styles/tokens.css`. Components use semantic tokens only (`--color-*`).
A unit test fails if any other stylesheet contains a hex, `rgb()` or `hsl()` color.

### Themes

Light is the default. Dark applies when the system prefers dark, unless `<html data-theme="light">`
forces light; `<html data-theme="dark">` forces dark. The two dark blocks in `tokens.css` must
stay identical (tested). Each theme also sets `color-scheme`, so native controls, scrollbars and
`<select>` pickers match.

### Neutral scale

Steps follow one rule in both themes: 1 is the app background and 12 is high-contrast text.

| Step | Use | Light | Dark |
|---|---|---|---|
| `--gray-1` | `bg`: panel background | `#ffffff` | `#141619` |
| `--gray-2` | `bg-subtle`: secondary buttons, insets | `#f7f8fa` | `#1a1d21` |
| `--gray-3` | `bg-hover`, `neutral-bg` | `#eff1f4` | `#222529` |
| `--gray-4` | `bg-active`, `border-subtle`, light skeleton | `#e6e9ed` | `#292d32` |
| `--gray-5` | dark skeleton shine | `#dde1e6` | `#2f3339` |
| `--gray-6` | `border`: cards, menus, dialogs | `#d0d5dc` | `#3a3f46` |
| `--gray-7` | `scrollbar`, dark `neutral-solid` | `#b6bdc6` | `#4b515a` |
| `--gray-8` | `border-control` (3:1), `fg-disabled` | `#848d98` | `#6d7580` |
| `--gray-9` | reserve | `#6e7781` | `#7e8691` |
| `--gray-10` | reserve | `#626b75` | `#8f97a1` |
| `--gray-11` | `fg-muted`, `neutral-fg` | `#535c66` | `#a6aeb8` |
| `--gray-12` | `fg` | `#1c2026` | `#e7e9ec` |

`--color-surface` is the overlay surface (menus, dialogs, toasts): `#ffffff` in light, `#1e2125`
in dark (a step lighter than the background, since shadows barely show on dark).

### State hues

Each hue has `-fg` (text and icons on any neutral surface), `-bg` (tinted chip background),
`-border` (outline chips) and `-solid` (strong fill under `--color-fg-on-solid` white text).
`accent` and `danger` also have `-solid-hover`.

| Hue | Means in Prowl | Pair with | Light fg / solid | Dark fg / solid |
|---|---|---|---|---|
| `accent` | Primary action, links, focus, selection, unseen changes | | `#3646c9` / `#3b4fd8` | `#8d9cff` / `#4356de` |
| `success` | Checks passed, approved | check icon | `#1a7434` / `#1f7a39` | `#4cc26d` / `#1f7a39` |
| `danger` | Checks failed, changes requested, closed, destructive actions | ✕ icon | `#c01f2b` / `#c9222e` | `#ff7d75` / `#c9222e` |
| `warning` | Merge conflicts, rate limited, offline, stale data | alert icon | `#a6420a` / `#b0460c` | `#f39550` / `#b0460c` |
| `attention` | Checks pending, review required | dot icon | `#835700` / `#8a5c00` | `#e3ad3b` / `#8a5c00` |
| `done` | Merged | merge icon | `#7041d1` / `#7a4bda` | `#b791f6` / `#7a4bda` |
| `neutral` | Draft, counts, skipped checks | draft icon or text | `#535c66` / `#535c66` | `#a6aeb8` / `#4b515a` |

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
| `fg` | 16.36 / 14.90 | 15.39 / 13.90 | 14.45 / 12.65 | 13.43 / 11.39 | 16.36 / 13.29 | 14.42 / 12.61 (`accent-bg`) |
| `fg-muted` | 6.79 / 8.09 | 6.39 / 7.54 | 6.01 / 6.86 | 5.58 / 6.18 | 6.79 / 7.21 | 5.99 / 6.84 (`accent-bg`) |
| `neutral-fg` | 6.79 / 8.09 | 6.39 / 7.54 | 6.01 / 6.86 | 5.58 / 6.18 | 6.79 / 7.21 | 6.01 / 6.86 (`neutral-bg`) |
| `accent-fg` | 7.30 / 7.19 | 6.87 / 6.71 | 6.45 / 6.11 | 5.99 / 5.50 | 7.30 / 6.41 | 6.44 / 6.08 (`accent-bg`) |
| `success-fg` | 5.85 / 7.98 | 5.50 / 7.45 | 5.17 / 6.77 | 4.80 / 6.10 | 5.85 / 7.11 | 5.21 / 6.89 (`success-bg`) |
| `danger-fg` | 6.05 / 7.29 | 5.69 / 6.80 | 5.34 / 6.19 | 4.97 / 5.57 | 6.05 / 6.50 | 5.30 / 6.61 (`danger-bg`) |
| `warning-fg` | 6.17 / 7.96 | 5.80 / 7.43 | 5.45 / 6.76 | 5.06 / 6.09 | 6.17 / 7.10 | 5.52 / 6.81 (`warning-bg`) |
| `attention-fg` | 6.31 / 8.90 | 5.94 / 8.30 | 5.58 / 7.55 | 5.18 / 6.80 | 6.31 / 7.93 | 5.74 / 7.52 (`attention-bg`) |
| `done-fg` | 6.24 / 7.25 | 5.87 / 6.76 | 5.51 / 6.15 | 5.12 / 5.54 | 6.24 / 6.46 | 5.48 / 6.42 (`done-bg`) |

Text on solid fills (`fg-on-solid`), 4.5:1 minimum.

| Background | Light | Dark |
|---|---:|---:|
| `accent-solid` | 6.37 | 5.79 |
| `accent-solid-hover` | 7.80 | 4.83 |
| `success-solid` | 5.38 | 5.38 |
| `danger-solid` | 5.60 | 5.60 |
| `danger-solid-hover` | 6.90 | 4.93 |
| `warning-solid` | 5.63 | 5.63 |
| `attention-solid` | 5.81 | 5.81 |
| `done-solid` | 5.46 | 5.46 |
| `neutral-solid` | 6.79 | 8.00 |

UI components and graphics, 3:1 minimum.

| Foreground | Background | Light | Dark |
|---|---|---:|---:|
| `border-control` | `bg` | 3.36 | 3.89 |
| `border-control` | `bg-subtle` | 3.16 | 3.63 |
| `border-control` | `surface` | 3.36 | 3.47 |
| `focus` | `bg` | 6.37 | 7.19 |
| `focus` | `bg-subtle` | 6.00 | 6.71 |
| `focus` | `surface` | 6.37 | 6.41 |
| `accent-solid` | `bg` | 6.37 | 3.13 |
| `fg-on-solid` | `border-control` | 3.36 | 4.66 |
| `brand-eye` | `brand` | 4.04 | 4.04 |
| `brand-pupil` | `brand-eye` | 9.03 | 9.03 |
<!-- contrast:end -->

GitHub label colors are user-defined, so the PR card cannot take label text from tokens:
`labelColors()` (`components/labelColor.ts`) fills the chip with the label color and picks white
text when that reaches 4.5:1, black otherwise (black then has at least 4.67:1). The border is the
label color mixed with `--color-fg`, so near-white and near-black labels keep an edge in both
themes. A unit test checks the ratio over the whole color cube and an E2E test on the rendered
chips.

## Typography

System UI font (`--font-sans`), so Prowl matches the browser chrome on every OS; `--font-mono`
for branch names and SHAs. Numbers in badges use tabular figures.

| Token | Size / line height | Use |
|---|---|---|
| `--text-xs` / `--leading-xs` | 11 / 16 px | Small counts (`Badge size="sm"`). Never for sentences. |
| `--text-sm` / `--leading-sm` | 12 / 16 px | Metadata (repo#number, time), hints, small buttons, badges |
| `--text-md` / `--leading-md` | 13 / 20 px | Body default, PR titles, controls |
| `--text-lg` / `--leading-lg` | 15 / 22 px | Panel and dialog titles, empty-state titles |
| `--text-xl` / `--leading-xl` | 18 / 24 px | Onboarding headings |
| `--text-2xl` / `--leading-2xl` | 22 / 28 px | Onboarding hero only |

Weights: `--weight-regular` 400 (body), `--weight-medium` 500 (PR titles, buttons, labels),
`--weight-semibold` 600 (headings). Long titles wrap; branch names and labels truncate with an
ellipsis and keep the full text in `title`.

## Spacing, size and shape

- **Spacing:** 4 px grid: `--space-1` 4, `-2` 8, `-3` 12, `-4` 16, `-5` 20, `-6` 24, `-8` 32,
  `-10` 40, `-12` 48 px, plus `--space-0-5` (2) and `--space-1-5` (6) for optical alignment
  inside controls. Panel gutters are `--space-4`; list rows use `--space-3` vertical padding.
- **Controls:** `--control-sm` 28 px (dense rows), `--control-md` 32 px (default). Icons
  `--icon-sm` 12, `--icon-md` 16, `--icon-lg` 20 px.
- **Radius:** `--radius-sm` 4 (skeleton lines), `--radius-md` 6 (buttons, inputs, menu items),
  `--radius-lg` 8 (cards, menus, dialogs, toasts), `--radius-full` (badges, switches, avatars).
- **Borders:** `--border-width` 1 px hairlines. Focus: `--focus-width` 2 px solid `--color-focus`
  at `--focus-offset` 2 px, set once in `base.css` on `:focus-visible`. Text inputs show a ring on
  any focus.
- **Elevation:** only overlays are raised: `--shadow-sm` (switch thumb), `--shadow-md` (menus,
  toasts), `--shadow-lg` (dialogs). Dark shadows are stronger, and dark surfaces also step lighter.
- **Layers:** `--z-sticky` 10 (sticky header), `--z-menu` 40, `--z-toast` 50; dialogs use the
  browser top layer.

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
| `SearchIcon`, `BellIcon`, `BellSlashIcon`, `ClockIcon`, `LinkExternalIcon`, `CopyIcon`, `GitBranchIcon` | Filter, notifications, muted, snooze (and the rate-limit and stale banners), open in GitHub, copy, branch |
| `SignOutIcon`, `MarkGithubIcon`, `KeyIcon`, `PlusIcon`, `TrashIcon`, `PencilIcon`, `InboxIcon`, `CloudOfflineIcon` | Account, sign-in, token (and the rejected-token banner), add/remove/edit, empty list, offline (and the offline banner) |

## Components

Import each from its own module (`components/ui/Button`), not from a barrel, so a view only pulls
in the CSS it uses. Every component takes `class` for layout tweaks. Variants are `data-*`
attributes (`data-variant`, `data-size`, `data-tone`) styled in the component's `.css` file.

| Component | Use it for | Key props | Accessibility |
|---|---|---|---|
| `Button` | Any text action | `variant` primary / secondary (default) / danger / ghost, `size` sm (28) / md (32), `icon`, `loading` | Native `<button type="button">`; `loading` sets `aria-busy` + `aria-disabled`, keeps focus, ignores clicks and submits |
| `IconButton` | Toolbar and row actions | required `label`, `variant` ghost / secondary, `size`, `pressed`, `loading` | `label` is the `aria-label` and tooltip; `pressed` sets `aria-pressed` |
| `Badge` | PR state, counts, labels | `tone` (7 hues), `variant` subtle / solid / outline, `size`, `icon`, `title` | Text inside, never color only; truncates with ellipsis |
| `Avatar` | A person or bot next to their name | `src` (a person icon without one), `title` | Decorative (`alt=""`): the login is always in text beside it; 20 px, round |
| `Spinner` | Indeterminate progress | `size` 12–24, `label` | Decorative unless `label`, then `role="status"` |
| `Skeleton` | Loading placeholders | `shape` text / circle / rect, `width`, `height` | `aria-hidden`; put `aria-busy` and a label on the loading container |
| `Dialog` | Confirmations, composers | `open`, `onClose`, `title`, `description`, `footer`, `initialFocus`, `closeOnBackdrop` | Native modal `<dialog>`: top layer, inert page, Tab trapped, Esc closes, focus returns to the opener; named by the title, described by the description |
| `Menu` | Overflow actions, single choice lists | `trigger` render prop, `items` (`MenuItem` or `'separator'`), `align` start / end, `label` | APG menu button: Enter / Space / ↓ open on the first item, ↑ on the last, arrows wrap, Home / End, type-ahead, Esc and Tab close and return focus; `checked` makes `menuitemradio`; follows its trigger on scroll |
| `Switch` | Settings that apply immediately | `checked`, `onChange`, `label`, `description`, `hideLabel`, `disabled` | `role="switch"` button with `aria-checked`, 40 × 28 hit target, labelled by its visible label; the thumb position also shows state |
| `TextField` | Text input and textarea | `label`, `value`, `onValueChange`, `type`, `multiline`, `hint`, `error`, `icon`, `hideLabel`, `inputRef` | Visible `<label>`; `aria-describedby` error + hint; `aria-invalid` and an icon on error |
| `Select` | Short single-choice lists in forms | `label`, `value`, `options`, `onValueChange`, `hint`, `error` | Native `<select>`: keyboard and screen readers for free |
| `ToastRegion`, `showToast`, `dismissToast` | Action outcomes ("Approved #42", "Copied") | `message`, `tone` info / success / danger, `action`, `durationMs` | One polite `aria-live` region, always mounted; max 3; 5 s (8 s for errors), paused on hover and focus; `durationMs: 0` stays until dismissed |
| `EmptyState` | Empty lists and filtered-out results | `title`, `description`, `icon`, `action`, `headingLevel` | Real heading at the level you choose |
| `ProwlMark` | Logo in the header and onboarding | `size`, `label` | Decorative next to the word "Prowl" |

`Field` (label, hint, error layout plus `.ui-control` chrome) is internal to `TextField` and
`Select`. `cx.ts` has `cx()` for class names, the shared `Tone` type and `focusableIn()`.

### Feature components

Built from the components above; they live in `components/`, not `components/ui/`.

| Component | Use it for | Notes |
|---|---|---|
| `PullRequestCard` | One PR in the list | A summary and, expanded, its details. The title is a link to GitHub (`GitHubLink`, opens a new tab) and a sibling `IconButton` chevron expands the card; a click on the rest of the summary does the same, Escape folds it back with focus on the chevron. Full width, hairline separated, hover `bg-hover`. Rows: avatar + repo#number + last activity + chevron, title (2 lines, then ellipsis, underlined on hover), status chips, labels, counts + "Opened ... ago". Labels and counts share a line when they fit. The link is named "Title, owner/name#n"; the chevron is "Details for Title" and its description is every fact the card shows (`describePullRequest`). A dot in the left gutter marks unseen changes (same `isSeen` as the badge) and is in the description too. Row actions go beside the link, never inside it. |
| `PullRequestDetails` | What an expanded card shows | An inset panel (`bg-subtle`, hairline above): **Merge** (one line per blocker with a tone icon, or "Ready to merge"), **Checks** (failed and pending first with a state word, a "Required" badge and a link to GitHub; passed and skipped folded in a native `<details>`), **Actions** (one wrapping row of `size="sm"` buttons right after Merge, so it stays put while the detail loads; `ReviewActions` fills it with Approve, Request changes and Comment, secondary with a 12 px icon, each named with its PR, then `MergeAction`'s Merge, primary only when the PR is ready to merge (secondary beside blockers); the dialogs are a `Dialog` with a labelled multi-line `TextField` (merge: a `Select` of the allowed methods and a `TextField` for the commit title), Cancel first and one primary button), **Reviewers** (avatar, login, state `Badge`). Skeleton rows while loading, a warning notice with "Try again" on failure, no headings (labels name their lists) so the page outline stays flat. |
| `StatusBanner` | Why Prowl cannot update, or that the list is stale | A full-width strip under the header, above the list (which it never hides): tone icon (key, clock, cloud-off, alert), a semibold title, one or two `--text-sm` lines (GitHub's message, the "Last updated 14 min ago." age) and at most one `size="sm"` button (Re-authenticate is primary, Retry / Refresh now secondary). `danger` background for a rejected token and GitHub errors, `warning` for rate limits, offline and stale data; text stays `--color-fg` (not the tone's own fg) so it keeps its contrast on the tinted background, the icon and the words carry the meaning. Title and detail are a `role="status"` live region (`alert` for a rejected token); the age is outside it, since it ticks. |
| `SectionTabs` | Sections of the list | APG tabs: one tab stop, arrows / Home / End select, count `Badge` (accent when selected), warning icon + "Could not load" instead of a count for a failed section. Scrolls sideways when too wide: a fade with a chevron at an edge with more tabs behind it, the wheel scrolls it, and a tab brought into view stays clear of the fades. Three tabs fit a 400 px panel. |
| `SettingsGroup` (view) | A titled block of the settings screen | `h2` title, optional muted description, groups separated by a hairline, `--space-4` gutters. Sub-headings are `h3`; lists of switches are `ul`s named by their heading. Hints and notes are `--text-sm` muted. |
| `RepoFilter` | A list of `owner` / `owner/name` patterns | A `fieldset` named "Include" or "Exclude" with its hint as description; mono chips with a 28 px remove button each (truncated with the full text in `title`), then a field plus Add that validates, rejects duplicates and announces adds and removals. |
| `NumberField` | A whole number that saves as you type | A `TextField type="number"`; shows an error while the text is out of range and the saved value again on blur. |
| `SignOutDialog` | Confirming sign-out (header menu and Settings) | A `Dialog` with Cancel first and a `danger` Sign out; the token stays valid on GitHub, and the text says so. |

**Status chips** (`prStatus.ts`, always icon + word, tone from the table above): Draft (neutral);
CI "2 failing" / "3 pending" / "8 passed" (none when there are no checks); Approved / Changes
requested / Review required (hidden on drafts, which nobody is expected to review yet);
Conflicts (warning) or Ready to merge (success, replaces Approved because it implies it).

### Patterns

- **One primary button per view.** Destructive confirmations put Cancel first and a `danger`
  button last; `initialFocus` goes to the least destructive control.
- **Lists:** rows are full-width, hairline-separated (`--color-border-subtle`), hover
  `--color-bg-hover`, selected `--color-bg-active`. Row actions use `size="sm"` controls.
  Rows that touch the panel edge draw their focus ring inside (`outline-offset` negative).
- **Status chips:** `Badge tone=… size="sm"` with a 12 px icon: ✕ "2 failing", ● "Review
  required", ⚠ "Conflicts", merge icon "Merged".
- **Loading:** show skeletons that match the final layout for first loads. For refreshes keep the
  data and spin the refresh `IconButton` (`loading`).
- **Feedback:** use a toast for results of actions, inline `TextField` errors for validation, and
  banners (`StatusBanner`) for persistent problems.
