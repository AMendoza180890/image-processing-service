---
name: phase-gate
description: Final verification gate for a phase of the image-processing service. Runs every test/quality gate, reviews the phase's code against the phased plan and CLAUDE.md conventions, and returns a PASS/FAIL report with detailed errors. Use at the end of implementing any phase (0–6), or when the user asks to verify, validate, close out, or check a phase.
argument-hint: "[phase number, e.g. 2]"
---

# Phase gate

Verify that a phase is really done and report the result. **Report, don't fix**: this skill
diagnoses. Only fix things if the user asks after seeing the report.

## 1. Work out the phase and its scope

- Phase = `$ARGUMENTS`. If empty, infer it from the "Current state" line in `CLAUDE.md` plus the
  working tree (`git status`); if still ambiguous, ask.
- Read that phase's section in `~/.claude/plans/federated-drifting-teacup.md`: the numbered
  **deliverables** and the **Tests/validaciones** list. These become the checklist.
- Collect the code to review: `git status --short` and `git diff master...HEAD` plus
  uncommitted changes (`git diff`, and read untracked files in full).

## 2. Run the gates

```bash
bash .claude/skills/phase-gate/run-gates.sh "<scratchpad>/phase-gate"
```

It runs build → typecheck → lint → format → unit tests, then integration tests
(`DOCKER_TESTS=1`, only if Docker answers) and e2e (only if the stack answers on
`$E2E_BASE_URL` or `localhost:3000`). Each gate runs even if an earlier one failed. Read
`summary.tsv`; for every FAIL, open its `.log` and extract the **actual** errors (file:line,
failing test name, assertion or compiler message). Don't paraphrase them into something vaguer.

A SKIP is **not** a pass. It stays in the report as "pending verification" with the command the
user needs to run.

## 3. Review the code

Check the phase's changes against the following. Every finding needs a `file:line` and a concrete
reason; skip style nitpicks that lint/prettier already cover.

**Plan coverage:** for every deliverable and every test the plan lists for this phase, mark
✅ done (point to the file/test), ⚠️ partial, or ❌ missing. Missing tests count as gaps.

**CLAUDE.md conventions:**

- Cross-service shapes live in `@app/types` as zod schemas + `z.infer`, not redefined locally.
- New I/O goes behind an interface (repo/storage/queue) with a real impl **and** a fake used in
  unit tests; routes are tested via `app.inject()`.
- ESM: relative imports end in `.js`; `import type` for type-only imports.
- Migrations: new SQL file (never edit an applied one); the `status` CHECK matches `JobStatus`.
- Docker: build context = repo root, multi-stage, non-root user, `pnpm deploy --prod`; compose
  services talk by service name, never `localhost` (except for URLs the _host_ consumes).
- Config comes from env via `loadConfig()`, fails fast on required vars, and is mirrored in
  `.env.example` and `docker-compose.yml`.
- Nothing from a later phase has leaked in.

**Correctness:** error paths (wrong status codes, swallowed errors), idempotency/retry
behaviour in the worker, resource cleanup, secrets committed, tests that can't fail (assert
nothing, or are always skipped).

## 4. Verdict

- **PASS**: every run gate passed, no ❌ plan items, no correctness findings.
- **PASS WITH PENDING**: as PASS, but some gates were SKIPPED (e.g. no Docker).
- **FAIL**: any gate failed, any ❌ plan item, or any correctness finding.

## 5. Report

Reply in the user's language, using this format:

```markdown
# Phase <N> gate: <PASS | PASS WITH PENDING | FAIL>

<one sentence: why>

## Gates

| Gate              | Result  | Time | Detail               |
| ----------------- | ------- | ---- | -------------------- |
| build             | ✅ PASS | 12s  |                      |
| unit-tests        | ❌ FAIL | 4s   | 2 failing, see below |
| integration-tests | ⏭️ SKIP | –    | Docker unavailable   |

## Errors

### <gate>: <short title>

`path/to/file.ts:42`: <exact error / assertion message>
Likely cause: <one line>. Suggested fix: <one line>.

## Plan coverage

- ✅ <deliverable>: `path`
- ⚠️ <deliverable>: <what's missing>
- ❌ <test from plan>: not implemented

## Code review findings

1. **[correctness|convention|test-gap]** `file:line`: <issue> → <fix>

## Pending verification

- `<exact command>`: <why it didn't run>
```

Leave out sections that have nothing in them, except **Gates**, which always appears. Put the
most severe item first in each list.
