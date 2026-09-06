# UI redesign — 2026-09-06

## Product decisions

WattWise is an energy simulator built from saved appliances and usage schedules. It is not a live electricity meter. The dashboard now starts with the monthly estimate and sensitivity range, followed by appliance consumption, recorded bills, and the daily load profile. Removed invented sparklines, LIVE/SYNC badges, and the generic savings claim.

The four primary destinations use a shared horizontal navigation with a skip link. My Home presents compact totals, an optional tariff breakdown, a searchable appliance index, and usage editing. At narrow widths, users switch between the index and their household without scrolling through the entire catalog. Account, sign-in, onboarding, and access states share the same typography, neutral surfaces, and teal accent.

Replaced the accumulated stylesheet instead of appending another theme. Retained Noto Sans Thai, existing primitives, dependencies, scoped requests, permissions, calculations, and autosave controllers. No API, database schema, tariff, authentication, or persistence source changes.

## Validation

- `npm test`: 306 passed, zero failures.
- `npm run lint`: passed, no warnings.
- `npm run typecheck`: passed.
- `npm run check:icons`: passed.
- `npm run build`: passed. Existing Vite configuration and vinext route-classification notices remain.
- `git diff --check`: passed.
- Independent code review: no actionable regressions identified.

Browser checks used the built-in local test identity and a fresh, migrated D1 database under ignored `.wrangler/redesign-qa`. The original local database and remote databases were not modified. Temporary persistence configuration and seed scripts were removed after QA.

Checked desktop (1440px), tablet (820px), and mobile (390px):

- Sign-in, display-name onboarding, first-household creation, empty dashboard, profile, and settings.
- Adding an air conditioner, annual-energy refrigerator, and per-cycle washing machine from the catalog.
- Updating quantity and usage hours; saved values remained after reload.
- Empty search, category controls, and mobile catalog/home switching.
- Entering a real-bill test record and seeing the recorded value on the dashboard.
- A household with 30 appliance records, with no document horizontal overflow on tablet or mobile.
- Household switching and viewer state; all six visible numeric inputs were disabled for the viewer.
- A concurrent revision change caused the expected conflict alert and recovery control while retaining the local draft.
- Thai text wrapping, visible form focus, touch targets, and chart scrolling.

Existing automated tests cover request failures, expired sessions, access denial, retryable autosave errors, and mutation lifecycles. These network-failure paths were not all injected in browser QA. Production Google/Cloudflare Access sign-in and logout were not exercised; their source was unchanged. No deployment was performed.
