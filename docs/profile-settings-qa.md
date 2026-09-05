# Profile, Settings and multiple households

## Implemented

- `/profile`: read-only account identity, all memberships, household links, owner/admin metadata editing.
- `/households/new`: shared first/subsequent household form; opens the new household dashboard.
- `/settings`: full-document Cloudflare Access logout in production; development displays an explicit limitation instead of claiming logout succeeded.
- Provider choices preserve unknown legacy values until explicitly changed. Provider metadata does not change tariff calculations.
- Logout hides account UI across tabs, disposes scoped requests/autosave, and retains existing user/household-scoped appliance drafts.
- Dirty household forms warn before supported navigation and suppress automatic focus revalidation while editing.

## Verification (2026-09-05)

- `npm test`: 297 passed, zero failures.
- `npm run typecheck`: passed.
- `npm run lint`: zero errors; one existing unused-import warning in `tests/auth-boundary.test.mjs`.
- `npm run check:icons`: passed.
- `npm run build`: passed; existing Vite JSON-import/config-loader warning remains.
- Local browser: created two households; both survived reload. Edited the first household's name, province and PEA to MEA; verified values after reload. Inspected Profile at narrow and desktop viewport sizes.
- Used an isolated migrated local D1 database under ignored `.wrangler/profile-settings-qa`; did not modify the original local database or any remote database. Temporary Vite persistence override was removed after testing.

## Remaining manual acceptance checks

No production deployment was performed. On an Access-protected deployment, verify actual cookie/session revocation, Back/BFcache, concurrent tabs, and subsequent login with the same and a different account. Unit tests cover logout signals and scoped-draft isolation, but do not prove the external Access session was revoked.

Also exercise a third household, legacy/unspecified provider options, unsaved-navigation dialogs (including supported browser Back behavior), and mobile Settings navigation end-to-end. Mutation lifecycle tests cover network failures, expired sessions, duplicate submissions and late responses after unmount; real-browser fault injection was not performed.

Cloudflare logout behavior: https://developers.cloudflare.com/cloudflare-one/access-controls/access-settings/session-management/
