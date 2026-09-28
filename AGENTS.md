# AGENTS.md — BlockCraft

BlockCraft is an original browser voxel sandbox game specified in `SPEC.md`. It is built one task at a time: each Jules session implements exactly one task ID from `SPEC.md` Appendix E and ends in one pull request. These rules are binding for every task and override any urge to move fast.

## 1. Start of every task

1. Read this file and `SPEC.md` in full.
2. Find your task ID in the prompt (for example `M03c`). Find its row in its milestone's **Task breakdown** table and in Appendix E.
3. Read `progress/<ID>.md` for every task yours depends on, plus any `decisions/` and `blockers/` files they reference.
4. Confirm each dependency's work is actually on `main`. If a dependency is missing, do not build it yourself: write `blockers/<your-ID>.md` explaining what is missing and stop.

## 2. Scope discipline

- Build exactly your task's row: the Scope items it lists, the Acceptance Criteria it owns (as automated tests), and its Visual Review items.
- Do not start other tasks, even if you finish early. Spend spare effort hardening your own tests.
- Touch code owned by other tasks only as far as your task needs, and explain each such change in your handoff notes.
- A task that introduces a block or item also adds its texture generator, its registry entry, and (from M09b onward) its icon.
- No forward stubs: never add placeholder code for a later task.
- `SPEC.md` and `AGENTS.md` belong to the repository owner. Never edit them. If you believe either is wrong or contradictory, explain it in your handoff notes or in `blockers/<ID>.md`.

## 3. Build loop

1. Write or extend tests before or alongside the implementation, never after.
2. Implement.
3. Iterate with `MILESTONE=<Mxx> npm run verify:quick` (typecheck, lint, placeholders, unit, and only your milestone's e2e specs).
4. Before finishing, run the full `npm run verify` and read the entire output. Every milestone's tests must pass, not only yours.
5. Open every screenshot your task's Visual Review names (saved under `artifacts/`) and compare it against the checklist. Copy those PNGs to `docs/screenshots/<ID>/` so the owner can see them in the PR.
6. If anything fails or looks wrong, fix the game code and go back to step 3.
7. Write `progress/<ID>.md` (format in §12) and finish with a PR (§7).

## 4. Definition of done

A task is done only when all of these hold:

- The full `npm run verify` exits 0 in this session (typecheck, lint, placeholders, unit, and e2e for every milestone).
- Zero console errors, uncaught exceptions, failed network requests and WebGL errors in every e2e test.
- Every Acceptance Criterion your task owns exists as a test that runs inside `verify` and passes.
- Every Visual Review screenshot has been opened and described (§5).
- No `TODO`, `FIXME`, `XXX`, `stub`, `not implemented` or placeholder return values in `src/` or `server/`.
- Handoff notes are written, and CI on the PR is green once it has run.

"It compiles", "the dev server started" or "the page loads" is never evidence that a feature works.

## 5. Evidence must be real

- Every number in handoff notes and PR descriptions (test counts, timings, p95 values) is copied from command output produced in this session.
- Describe only what you actually saw in a screenshot. If you cannot open image files in this environment, write `NOT VIEWED` for that screenshot and say why; the owner will review it in the PR. Never describe a screenshot you did not look at.
- If the full `verify` could not run to completion, the task is not done (§11).

## 6. Test integrity

- Never weaken, delete, skip (`.skip`, `.only`, `test.fixme`) or loosen the thresholds of an existing test to make it pass. Fix the game instead.
- The paths and `package.json` scripts listed in SPEC §5.7 are the verification harness. After M00b is merged they are read-only, and the harness guard (SPEC §5.7) fails any PR that changes them without the owner's `harness-change` label. If you believe the harness has a bug, write it up in `blockers/<ID>.md` with evidence and work around it in game code. If your task row says it needs a harness change, make the minimal change and state in the PR description that it needs the label.
- Never special-case test conditions in game code (for example `if (navigator.webdriver)`). The debug API (SPEC §4) is the only sanctioned test hook.
- Never hardcode values that tests read (for example a fixed FPS number).
- Add assertions to another milestone's e2e spec only where a task row explicitly says so.

## 7. Git, branches and pull requests

- This repository's default branch is named `master`. Wherever SPEC.md or this file says `main`, it means `master`.
- Let Jules's own publish flow create the branch and PR. Do not push to `main`, merge PRs, force-push, rewrite history, or change git configuration or remotes.
- One task, one PR. Title it `<ID>: <task title> — verified` only if every item in §4 holds; otherwise `[INCOMPLETE] <ID>: <task title>`.
- The PR description contains your handoff notes (§12).
- Commit source, tests, `progress/`, `decisions/`, `blockers/` and `docs/screenshots/<ID>/`. Never commit `node_modules/`, `dist/`, `artifacts/`, `test-results/` or `playwright-report/`.

## 8. Parallel-safe conventions

Other tasks run at the same time on other branches. To keep merges clean:

- Process records are per task: `progress/<ID>.md`, `decisions/<ID>-<slug>.md`, `blockers/<ID>.md`. Never edit another task's record. There is no shared progress log.
- Data is split by category: `data/blocks/*.json`, `data/items/*.json`, `data/recipes/*.json`, `data/loot/*.json`. Prefer adding a new category file over editing one that another in-flight task is likely to touch.
- The debug API is one module per domain in `src/debug/api/`, each registered in `src/debug/api/index.ts` with one line.
- Run Prettier only on files you changed. No repo-wide reformatting, renames or file moves unless your task row calls for them.
- Add dependencies only when your task needs them. Runtime dependencies are restricted by SPEC §2.1.

## 9. Environment

- Jules runs each task in a fresh Ubuntu VM with Node preinstalled. The owner's setup script runs `npm ci` and `npx playwright install chromium`; if they have not run, run them yourself.
- Browsers: only Playwright's bundled Chromium, launched by the test suite, headless, with the SwiftShader flags in SPEC §5.2. No `channel`, `executablePath`, `connectOverCDP` or persistent `userDataDir`. Jules's built-in web-app screenshots are fine for your own debugging but are not evidence; only screenshots saved by the Playwright suite count.
- Do not leave long-running processes (dev servers, watchers) running. Playwright's `webServer` starts and stops `vite preview`.
- SwiftShader is slow and the e2e suite grows with every milestone. Use `verify:quick` while iterating and the full `verify` once at the end.
- The game makes zero network requests at runtime (SPEC §2.2), and the fixture fails any test with a failed request.

## 10. Originality and outside code

- All textures and sounds are generated by code in this repository. No downloaded images, audio, fonts, texture packs or assets from any existing game or website.
- Creature, item and block names come from SPEC Appendices A–C. No names, designs or trade dress from existing games.
- You may read documentation (WebGL2, Web Audio, IndexedDB, Vite, Playwright, Vitest, `ws`). Do not copy third-party source code for core systems: rendering, meshing, noise, physics, pathfinding, lighting, persistence, audio synthesis.

## 11. When stuck or out of time

- Try at least three genuinely different approaches before recording a blocker in `blockers/<ID>.md`: what failed, what you tried, the relevant error output, and your best hypothesis.
- If the task cannot be finished in this session: stop adding features, make sure the full `verify` passes for what exists (no failing, skipped or stubbed tests), write handoff notes listing exactly what remains, and title the PR `[INCOMPLETE]`. The owner will start a follow-up task.
- Never title a PR `— verified` while a blocker for it is open.

## 12. Handoff notes (`progress/<ID>.md`)

Use this structure. The next task depends on it, because it starts with no memory of your session.

```markdown
# M03c — Biomes & surface rules

Status: verified | incomplete
Depends on: M03b
Full verify (this session): typecheck ✓ · lint ✓ · placeholders ✓ · unit 212 passed · e2e 31 passed · console errors 0

## Acceptance criteria owned

- [x] ≥ 10 biomes in 2048×2048, ocean 20–50 % → tests/unit/biomes.test.ts › "biome coverage"

## Screenshots (docs/screenshots/M03c/)

- m03-biome-border.png: one sentence describing what is actually visible, or NOT VIEWED and why

## What was built

## Decisions (links to decisions/ files)

## Known limitations

## Notes for dependent tasks

Interfaces, file locations, invariants and gotchas the next task needs.
```
