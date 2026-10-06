# Ralph iteration — Prowl

You are one iteration of the Ralph loop building Prowl, an open-source Chrome side panel for
GitHub pull requests. You start with a fresh context: everything you know comes from the
repository. Work autonomously; never ask questions. When something is unclear, make a
reasonable assumption and record it as one line in `docs/decisions.md` with the reason.

## 1. Orient (read, in this order)

1. `CLAUDE.md`, `docs/architecture.md`, `docs/decisions.md`, `src/lib/model.ts`.
2. `progress.txt`: the "Codebase patterns" section, then the last three entries.
3. `prd.json`: pick the story with the lowest `priority` whose `passes` is `false` and whose
   `dependsOn` stories all have `passes: true`.
4. `.claude/agents/<story.agent>.md`: adopt that specialist's role, standards and checklist.
5. `git log --oneline -15` and the code the story touches.

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

## 3. Prove it

- Run `pnpm lint:fix` then `pnpm verify`. Iterate until it is fully green.
- Never weaken a gate: do not lower coverage thresholds or budgets, skip/`.only`/delete tests,
  or add ignores to get green. A test that fails once without a code change is a bug: fix it.
- For UI work, run the relevant E2E screenshot specs, open the PNGs in `docs/screenshots/`
  with the Read tool and fix anything that looks wrong (alignment, contrast, truncation,
  dark mode).
- Re-read your own diff (`git diff`) as a reviewer would before committing.

## 4. Record

- `prd.json`: set the story's `passes` to `true` only if every acceptance criterion is met,
  and write a one-line `notes`. If a criterion cannot be met, leave `passes: false` and
  explain in `notes`.
- `progress.txt`: append an entry:
  ```
  ## <YYYY-MM-DD> - <story id> <title>
  - What was implemented
  - Files changed (main ones)
  - Learnings for future iterations (patterns, gotchas)
  ---
  ```
  Move learnings that every future iteration needs into "Codebase patterns" at the top.
- Commit everything in one commit on `main` with a Conventional Commit subject containing the
  story id (see CLAUDE.md for the trailers). Do not push, amend, rebase or force anything.

## 5. Finish

End with a short report: story id, what changed, the `pnpm verify` result (test counts,
coverage numbers), assumptions made, and anything the next iteration must know.
If every story in `prd.json` now has `passes: true`, end your reply with
<promise>COMPLETE</promise>
