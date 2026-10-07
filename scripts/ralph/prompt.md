# Ralph iteration — Prowl

You are one iteration of the Ralph loop building Prowl, an open-source Chrome side panel for
GitHub pull requests. You start with a fresh context: everything you know comes from the
repository. Work autonomously; never ask questions. When something is unclear, make a
reasonable assumption and record it as one line in `docs/decisions.md` with the reason.

## 1. Orient (read only what the story needs: every turn pays for what you have read)

1. `CLAUDE.md` and `src/lib/model.ts`.
2. `node scripts/ralph/story.mjs` prints your story: the lowest `priority` whose `passes` is
   `false` and whose `dependsOn` all pass. Never read `prd.json` whole.
3. `progress.txt` (the "Codebase patterns" section and the latest entries). Older entries live in
   `progress-archive.txt`: grep it, never read it whole.
4. `.claude/agents/<story.agent>.md`: adopt that specialist's role, standards and checklist.
5. `docs/architecture.md` and `docs/decisions.md` are long: grep them for the modules, settings
   and terms the story touches and read those sections only.
6. `git log --oneline -10` and the code the story touches.

## 2. Build exactly one story

- Implement the whole story and nothing else: code, unit tests, E2E for anything a user can
  see or trigger, and the docs the story names.
- Respect the contracts in `src/lib/model.ts`; if you must change one, update every consumer
  and `docs/architecture.md` in the same commit.
- Match the surrounding code style. No new runtime dependency without a `docs/decisions.md`
  entry and a perf-budget check.
- Follow "Write the least code that works" in CLAUDE.md: reuse before writing, platform
  before code, shortest correct diff. Keep tool output small (filter with grep/tail, use
  `--reporter=dot` or quiet flags) to save tokens.
- Check any Chrome or library API you add or change against current docs with Context7
  (ToolSearch `select:mcp__Context7__resolve-library-id,mcp__Context7__query-docs`) rather than
  from memory.

## 3. Prove it

- Iterate with `pnpm verify:fast` and targeted E2E (`pnpm build:e2e`, then
  `pnpm exec playwright test <spec> --reporter=dot`). Then run `pnpm lint:fix` and
  `pnpm verify:changed` (fast checks, build, size and the E2E specs you changed) until it is
  green. CI runs the full `pnpm verify` on every push; fix what it reports there.
- Never weaken a gate: do not lower coverage thresholds or budgets, skip/`.only`/delete tests,
  or add ignores to get green. A test that fails once without a code change is a bug: fix it.
- For UI work, run `pnpm screenshots` (writes docs/screenshots/), open the PNGs in `docs/screenshots/`
  with the Read tool and fix anything that looks wrong (alignment, contrast, truncation,
  dark mode).
- Re-read your own diff (`git diff`) as a reviewer would before committing.

## 4. Record

- `node scripts/ralph/story.mjs pass <id> "<one-line notes>"` only if every acceptance
  criterion is met; otherwise `node scripts/ralph/story.mjs fail <id> "<what is missing>"`.
  Do not edit `prd.json` by hand.
- `progress.txt`: append an entry:
  ```
  ## <YYYY-MM-DD> - <story id> <title>
  - What was implemented
  - Files changed (main ones)
  - Learnings for future iterations (patterns, gotchas)
  ---
  ```
  Move learnings that every future iteration needs into "Codebase patterns" at the top.
  Keep three entries in `progress.txt`: move older ones to the end of `progress-archive.txt`.
- Commit everything in one commit on the current branch with a Conventional Commit subject containing the
  story id (see CLAUDE.md for the trailers). Do not push, amend, rebase or force anything.

## 5. Finish

End with a short report: story id, what changed, the `pnpm verify` result (test counts,
coverage numbers), assumptions made, and anything the next iteration must know.
If every story in `prd.json` now has `passes: true`, end your reply with
<promise>COMPLETE</promise>
