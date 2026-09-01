# Task 7 Report: Multi-household UI and dynamic identity

## Status

DONE_WITH_CONCERNS

The Task 7 UI cutover is implemented and committed. The only concern is the intentionally deferred browser preview/visual inspection: the task owner explicitly prohibited this subtask from starting browser previews and retained preview/hosting ownership. Automated responsive/accessibility contracts and a production build passed.

## Commits

- `030523d` — `feat: cut over household-scoped UI` (implementation and tests)
- The report itself is committed separately immediately after generation so it can cite the immutable implementation SHA above.

## Exact RED evidence

1. Initial Task 7 behavior RED:
   - Command: `node --experimental-strip-types --test tests/household-ui.test.mjs tests/household-routes-ui-contract.test.mjs tests/user-name-copy.test.mjs`
   - Result: exit `1`; `10` tests, `0` passed, `10` failed.
   - Failures covered missing explicit route wrappers, missing scoped dashboard/bill routes, missing Task 6 controller integration, missing viewer gating/read-only explanation, missing zero/one/many compatibility behavior, missing dynamic identity fallback, missing explicit URL construction, and missing Thai role/editability behavior.

2. Responsive/accessibility RED:
   - Command: `node --experimental-strip-types --test tests/ui-readability.test.mjs`
   - Result: exit `1`; `6` tests, `4` passed, `2` failed.
   - Expected failures: household switcher/chooser/create/autosave controls lacked the new 44 px touch-target rules; household entry/mobile identity layout rules were absent.

3. Scope-switch regression RED:
   - Command: `node --experimental-strip-types --test tests/household-routes-ui-contract.test.mjs`
   - Result: exit `1`; `6` tests, `5` passed, `1` failed.
   - Expected failure: scoped dashboard and My Home content were not yet keyed by `householdId`, allowing prior-scope local UI state to survive a route-only household change.

4. Viewer stale-draft RED:
   - Command: `node --experimental-strip-types --test tests/household-ui.test.mjs`
   - Result: exit `1`; `5` tests, `4` passed, `1` failed.
   - Expected failure: `homeAutosaveStorageForRole` did not yet exist, so a draft created before demotion could be exposed to autosave replay for a viewer.

## Final verification

- `npm test` — exit `0`; `236` tests passed, `0` failed, `0` skipped.
- `npm run typecheck` — exit `0`; TypeScript completed without diagnostics.
- Changed-file ESLint — exit `0`; no warnings or errors across all changed TS/TSX/MJS files.
- `npm run build` — exit `0`; vinext completed all five build environments and emitted explicit dynamic routes for `/households/:householdId` and `/households/:householdId/my-home`.
- `git diff --check` — exit `0`; no whitespace errors. Git printed only the repository's LF-to-CRLF normalization notices.
- Forbidden-copy/legacy-route scan over the new UI — no `/api/home`, `/api/bills`, `วิทวัส`, `บ้านวิทวัส`, or literal unscoped `/my-home` link matches.
- Browser preview/manual visual QA — not run, per the task owner's explicit instruction not to start previews or own hosting decisions.

Build notes: vinext/Vite emitted the pre-existing warning about `.openai/hosting.json` being imported without JSON import attributes and vinext's informational note that some routes cannot yet be statically classified. The hosting file was not edited.

## Files changed

### New household UI and routes

- `app/components/HouseholdAccessState.tsx`
- `app/components/HouseholdDashboard.tsx`
- `app/components/HouseholdEntry.tsx`
- `app/components/HouseholdIdentityBar.tsx`
- `app/components/HouseholdMyHome.tsx`
- `app/components/use-household-memberships.ts`
- `app/households/[householdId]/page.tsx`
- `app/households/[householdId]/my-home/page.tsx`
- `lib/household-ui.ts`

### Compatibility entries and shared UI

- `app/page.tsx`
- `app/my-home/page.tsx`
- `app/components/WattWiseSidebar.tsx`
- `app/globals.css`
- `components/ui/number-stepper.tsx`

### Tests

- `tests/household-ui.test.mjs`
- `tests/household-routes-ui-contract.test.mjs`
- `tests/catalog-ui-contract.test.mjs`
- `tests/estimate-range-ui.test.mjs`
- `tests/header-sidebar-ui.test.mjs`
- `tests/home-save-ui-contract.test.mjs`
- `tests/ui-readability.test.mjs`
- `tests/usage-schedule-ui.test.mjs`
- `tests/user-name-copy.test.mjs`

## Design decisions

- `/` and `/my-home` now resolve verified identity first, then membership. Zero households renders a create form, one household redirects to its explicit household URL, and multiple households render a chooser without a first-item fallback.
- Explicit pages verify `/api/me` and `/api/households` before mounting scoped content. The household switcher is populated only from that membership response and retains the current dashboard/My Home destination.
- Dashboard reads `/api/households/:householdId/dashboard`; bill writes/deletes use `/api/households/:householdId/bills/:month`. Status `401` produces a session-expired terminal state; `403`/`404` produce an unavailable/access-denied terminal state.
- My Home mounts `createScopedHomeAutosaveController` only after verified user and route membership are available. Its state is the UI source of truth. Conflict, retryable, session-expired, and access-denied phases have distinct behavior; conflict discard is explicit and retry is exposed only for `retryable-error`.
- Scoped content is keyed by `householdId`, ensuring a route switch remounts local UI state before the new household renders. Controller cleanup disposes the prior scope and aborts/cancels pending work.
- Owner/admin/member roles can mutate. Viewer appliance, usage, and bill controls are absent or disabled with visible Thai read-only copy. Viewer controller hydration uses a non-mutating storage view so a draft retained from a prior editable role is preserved but cannot replay while the user is a viewer.
- Dynamic copy uses `displayName` with verified-email fallback, household membership name, and Thai role labels. The previous hard-coded personal/household names were removed.
- Existing visual language was retained. New entry, switcher, read-only, conflict, and terminal states use the existing colors, cards, typography, responsive breakpoints, and 44 px touch-target contract.
- Legacy API routes remain present and untouched for Task 8; only new explicit UI routes stopped consuming them.

## Concerns

- Browser/manual responsive visual QA remains for the root task owner because this subtask was explicitly instructed not to start a preview.
- The production build warnings described above pre-date and are outside Task 7; no hosting configuration was changed.
