# Task 8 report

## Commit

- `8edaa63 feat: add verified legacy household cutover`

## Delivered

- Added Drizzle migration `0009_lying_doctor_spectrum.sql` with cutover source/issue audit tables, hashed one-time claim tokens, indexes/FKs, and an atomic claim trigger.
- Added `runLegacyCutover`, `readLegacyCutoverVerification`, `issueHouseholdClaimToken`, and `claimQuarantinedHousehold` in `lib/server/legacy-cutover.ts`.
- Backfill creates deterministic isolated quarantine households and no memberships. Relational appliance rows, duplicate saved instances, inactive catalog references, and legacy monthly estimate/actual fields are preserved.
- Unknown saved catalog keys create an auditable `UNKNOWN_CATALOG_KEY`, keep source/copied counts unequal, and block claim rather than dropping data silently.
- Verification checks recorded counts/checksums, live target checksums, issue totals, and `PRAGMA foreign_key_check`; reruns are deterministic and failed partial runs remain non-claimable.
- Added authenticated `POST /api/household-claims`. It ignores client user IDs, consumes an unexpired secret exactly once, activates the quarantine, creates the authenticated user as owner, and returns the same 404 contract for invalid/reused tokens.
- Removed implicit runtime `/api/home` and `/api/bills`; legacy tables and offline compatibility modules remain for the observation window.
- Added `docs/multi-user-cutover.md`, updated catalog/README copy, and changed the production smoke test to the global catalog endpoint.

## TDD and verification

- Focused cutover/claim/schema/API tests: pass.
- Full `npm test`: 251/251 pass.
- `npm run typecheck`: pass.
- `npm run lint`: pass with one pre-existing unused-import warning in `tests/auth-boundary.test.mjs`.
- `npm run build`: pass. Build route output contains only explicit household APIs plus `/api/household-claims`; old shared routes are absent. Existing Vinext warnings remain for the JSON import and unknown static route classification.
- Migration replay fixture applies 0000-0007, seeds populated legacy relational/saved/monthly data, then applies 0008-0009 with foreign keys enabled.

## Decisions and remaining operational concerns

- Saved-key and relational legacy sources are kept separate because the prototype contains no reliable ownership/link key to merge them safely.
- Public quarantine IDs are deterministic SHA-256-derived identifiers; access still depends on membership and claim still requires a 256-bit pre-issued secret.
- Maintenance/backfill/token issuance is intentionally not exposed as a public admin API. Production operation requires a trusted one-off runner with the D1 binding during the documented read-only window.
- The existing main deployment job is still automatic. Do not merge for production until an operator has scheduled the backup, maintenance gate, backfill verification, and authenticated smoke test described in the runbook.
- No deployment, merge, or push was performed.

## Fix round 1 — review findings

- Commit `1e3c948 fix: seal legacy household cutover` preserves relational household name, province, provider, tariff selection, appliances, and monthly data in one checksum-covered frozen manifest.
- Added migration `0010_tricky_jazinda.sql`: sealed manifest rows and issue history are append-only/immutable, incomplete unsealed captures can be replaced safely, and source/target mutation triggers invalidate verification and claim tokens until a new verification epoch is sealed.
- Unknown catalog keys are now resolved by adding/mapping the catalog model and rerunning from the frozen raw manifest; source rows and historical issue events are retained.
- Token issuance re-verifies the live source and live target, binds the token to verification epoch and target checksum, and claim atomically requires the same sealed state. Regression tests cover target drift plus relational source configuration and appliance drift after issuance.
- Added the executable `npm run cutover:remote` administrative command for preview, backfill, verification, and explicit token issuance over Cloudflare's authenticated D1 REST API. No public maintenance route was added.
- Production deploy now requires the explicit GitHub repository variable `MULTI_USER_CUTOVER_COMPLETE=true`; the runbook documents the order and exact maintenance commands.

## Fix round 1 — TDD and verification

- RED: `node --experimental-strip-types --test tests/legacy-cutover.test.mjs tests/legacy-cutover-runner.test.mjs tests/deployment-workflow.test.mjs` failed for missing runner/deploy gate and allowed relational drift claims; the interrupted/unsealed and post-seal manifest tests also failed before their migration/service fix.
- GREEN: the same focused suites passed 15/15 before the additional manifest recovery cases, then `tests/legacy-cutover.test.mjs` passed 10/10.
- Fresh full verification after all fixes: `npm test` passed 260/260; `npm run typecheck` passed; `npm run lint` exited 0 with the existing `tests/auth-boundary.test.mjs` unused-import warning; `npm run build` exited 0 with the existing Vinext warnings.
- `npm run cutover:remote -- --help` exits 0 and prints all four supported operator commands.
- No deployment, merge, or push was performed.

## Fix round 2 — checked-in migration runner

- Commit `044b156 fix: add cutover migration runner` adds the cross-platform `npm run cutover:migrate` operator command. It requires the three Cloudflare environment values, creates a temporary configuration from the built Worker config, binds the target D1 ID, points migrations at the repository `drizzle` directory, and runs baseline reconciliation, migration listing, then remote apply in that order. The temporary configuration is always removed, including after a failed Wrangler command.
- Added `tests/cutover-migrate.test.mjs` with an injected subprocess runner. The test reads the temporary configuration while it exists, asserts the ordered Wrangler arguments, verifies no API token enters the config, verifies cleanup, and confirms processing stops at the first non-zero exit.
- Updated `docs/multi-user-cutover.md` with the exact `npm ci`, `npm run build`, and `npm run cutover:migrate` sequence before preview/backfill, while retaining the deploy gate until verification succeeds.

## Fix round 2 — TDD and verification

- RED: `node --experimental-strip-types --test tests/cutover-migrate.test.mjs` failed as expected because `scripts/cutover-migrate.mjs` did not exist.
- GREEN: `node --experimental-strip-types --test tests/cutover-migrate.test.mjs tests/legacy-cutover-runner.test.mjs tests/deployment-workflow.test.mjs` passed 8/8.
- `npm run typecheck` exited 0. `npm run lint` exited 0 with the existing unused-import warning in `tests/auth-boundary.test.mjs`. `git diff --check` exited 0. `npm run cutover:migrate -- --help` exited 0 without requiring credentials.

## Fix round 2 — concerns

- The remote migration command was intentionally not executed: it needs production credentials and would mutate the target D1 database. No deployment, merge, or push was performed.
