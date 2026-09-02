# SDD ledger — plan: docs/superpowers/plans/2026-08-31-multi-user-households.md

Spec: docs/superpowers/specs/2026-08-31-multi-user-households-design.md

## Pre-flight interface scan

| Task(s) | Shared interface/files | Finding / ruling |
|---|---|---|
| 1 ↔ 2 | `db/schema.ts`, D1 user/household rows | Task 1 produces schema; Task 2 consumes it. No conflict. |
| 1 ↔ 3 | memberships, invitations, owner uniqueness | Task 3 must enforce service invariants on top of Task 1 constraints. No conflict. |
| 1 ↔ 4 | `households.home_revision`, `household_appliances`, monthly FK | Task 4 consumes the canonical fields produced by Task 1. No conflict. |
| 2 ↔ 3 | authenticated user and role guards | Task 3 must not duplicate authorization. No conflict. |
| 2 ↔ 4/5 | household access contract | Home/Bills/Dashboard handlers must authorize before repository calls. No conflict. |
| 4 ↔ 6 | Home snapshot/revision wire contract | Task 6 consumes `{ householdId, revision, items }` and `expectedRevision`. No conflict. |
| 3/4/5 ↔ 7 | explicit household routes and identity | Task 7 consumes all scoped APIs; no implicit active-household fallback. No conflict. |
| 1/4/5 ↔ 8 | legacy backfill and runtime cleanup | Task 8 runs only after canonical reads/writes exist. No conflict. |

## Task self-consistency scan

| Task | Tests vs implementation | Ruling |
|---|---|---|
| 1 | Schema tests cover the constraints the migration creates. | Proceed. |
| 2 | Header/auth tests exercise real request headers and real SQLite rows. | Proceed. |
| 3 | API/service tests exercise two-user isolation and role invariants. | Proceed. |
| 4 | OCC tests require a real two-editor stale-write failure. | Proceed. |
| 5 | Monthly tests preserve estimate/actual independence. | Proceed. |
| 6 | Outbox tests exercise storage behavior rather than source grep. | Proceed. |
| 7 | UI behavior tests should avoid brittle hard-coded source assertions where possible. | Ruling: preserve existing contract tests but add behavior-focused helpers for new state. |
| 8 | Migration fixtures prove data preservation and failure on unknown references. | Proceed. |

Ruling: Sites authentication will use verified `oai-authenticated-user-*` headers behind the provider-neutral boundary because this repository is a hosted Site; external OAuth remains out of scope.

Ruling: The SDD Bash helper could not run because Windows denied WSL Bash startup. The plan-scoped workspace and ledger are created manually at the exact path the helper specifies.

## Execution

- Task 1 started — base `f1aa203`; implementer `/root/schema_migration`; brief `task-1-brief.md`.
- Task 1 complete — commit `ec7e931`; focused 9/9, full 155/155, typecheck passed; reviewer `/root/review_task1` approved with no blocking findings.
- Ruling: expand migration keeps legacy `monthly_energy_records` and adds canonical `household_monthly_energy_records`; Task 8 owns verified backfill and contraction.
- Task 2 started — base `ec7e931`; implementer `/root/auth_boundary`; brief `task-2-brief.md`.
- Task 2 complete — commit `df1d54b`; focused 8/8, full 163/163, typecheck passed; reviewer `/root/review_task2` approved with no actionable findings.
- Task 3 started — base `df1d54b`; implementer `/root/household_apis`; brief `task-3-brief.md`.
- Task 3 complete — commits `0af960e`, `31e8bd9`, `840e642`; focused 26/26, full 181/181, typecheck and changed-file lint passed; reviewer `/root/review_task3` approved after owner/role/invitation race fixes.
- Task 4 started — base `840e642`; brief `task-4-brief.md`.
- Task 4 complete — commits `2496a59`, `a86c2c2`; focused 12/12, full 193/193, typecheck and changed-file lint passed; reviewer `/root/review_task4` approved after transactional response/auth race fixes.
- Task 5 started — base `a86c2c2`; brief `task-5-brief.md`.
- Task 5 complete — commit `f7ea1ce`; focused 8/8, full 201/201, typecheck and changed-file lint passed; reviewer `/root/review_task5` approved with no findings.
- Task 6 started — base `f7ea1ce`; brief `task-6-brief.md`.
- Task 6 fix round 1 — commits `4372e1c`, `32b1278`; added scoped v3 outbox/controller plus retry revalidation, access-denied handling, and compensating saves. Reviewer found a pre-validation PUT race while activation GET was pending.
- Task 6 complete — commit `76f4321` gates the save queue on authoritative revision validation; focused 23/23, full 224/224, typecheck, changed-file lint, and diff check passed; reviewer `/root/review_task6_final` approved after scoped re-review.
- Task 7 started — base `76f4321`; brief `task-7-brief.md`.
- Task 7 fix round 1 — initial commits `030523d`, `d4f3b1f`; reviewer found stale role/account lifecycle, non-terminal creation 401, unguarded creation completion, and source-only coverage gaps.
- Task 7 complete — commit `25b2377` adds mounted identity/membership revalidation, scoped resource disposal, terminal/abort-safe creation, and executable lifecycle tests; focused 21/21, full 243/243, typecheck, changed-file lint, build, and diff check passed; reviewer `/root/review_task7` approved after scoped re-review.
- Task 7 local preview — verified zero-household create flow, explicit dashboard/My Home URLs, dynamic identity, scoped autosave after adding an appliance, multi-household chooser/switcher, owner controls, and viewer-disabled controls/read-only copy. Desktop visual check passed; mobile behavior remains covered by responsive contract tests because the in-app viewport override did not change its reported 1280 px viewport.
- Task 8 started — base `25b2377`; brief `task-8-brief.md`; scope is deterministic quarantine/backfill, one-time explicit claim, cutover verification, legacy route removal, and operational documentation.
- Task 8 fix round 1/5 — commits `72bffc0..a25d8c3`; preserved household metadata in an immutable raw manifest, retained issue history, bound claim tokens to live source/target verification epochs, added the authenticated D1 maintenance runner, and gated production deployment. Re-review addressed 3 findings; exact pre-deploy migration invocation remained open.
- Task 8 fix round 2/5 — commits `a25d8c3..0a111b4`; added the checked-in `cutover:migrate` command and exact runbook sequence. Scoped re-review addressed the remaining finding with no new Critical/Important breakage.
- Task 8 complete — commits `25b2377..0a111b4`; focused 8/8 and full 260/260 tests passed; typecheck, lint (one pre-existing warning), build, CLI help, migration replay, and diff checks passed; review clean after two fix rounds.
