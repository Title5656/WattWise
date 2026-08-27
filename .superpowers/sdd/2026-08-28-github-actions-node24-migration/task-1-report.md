# Task 1 Report: Update artifact actions and regression test

## Changed files

- `.github/workflows/ci.yml`: changed `actions/upload-artifact@v4` to `@v7` and `actions/download-artifact@v4` to `@v8`; all artifact names/paths and deployment inputs were preserved.
- `tests/deployment-workflow.test.mjs`: added assertions requiring upload `@v7`, download `@v8`, and no artifact action on `@v4`.

## Red/green evidence

- RED: `node --test tests/deployment-workflow.test.mjs` — failed as expected (2 passed, 1 failed) because the workflow still referenced upload/download artifact `@v4`.
- GREEN: `node --test tests/deployment-workflow.test.mjs` — passed (3/3).

## Full verification

- `npm test` — passed (40/40).
- `npm run lint` — passed (exit 0).
- `npm run build` — passed (exit 0); emitted existing Vite config-loader and route-classification warnings.
- `git diff --check` — passed; Git emitted only line-ending normalization warnings.

## Commit

- `a61496ff24480e1f3fca5f2b548eb8f824136b83` (`chore: update artifact actions`)

## Concerns

- No functional concerns. Build retains pre-existing non-fatal Vite warnings.
