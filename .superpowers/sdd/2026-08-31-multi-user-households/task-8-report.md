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
