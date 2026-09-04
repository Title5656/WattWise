# WattWise Multi-user Households Design

## Goal

Replace the shared `default-home` prototype with authenticated users, many-to-many household membership, household-scoped data, role authorization, a canonical home model, account/household-scoped autosave, and optimistic concurrency.

## Locked decisions

- Authentication is provider-neutral at the application boundary. On Sites, the first adapter uses verified `oai-authenticated-user-id`, `oai-authenticated-user-email`, and optional encoded full-name headers.
- Roles are `owner`, `admin`, `member`, and `viewer`.
- Every household API uses an opaque household public ID and performs server-side membership/role authorization.
- `household_appliances` is the canonical home configuration table. `saved_home_appliances` is legacy-only after cutover.
- Monthly data uses a real `household_id` foreign key and `UNIQUE(household_id, billing_month)`.
- Home snapshot saves require `expectedRevision`; stale saves return `409` and never overwrite current data.
- Local drafts, locks, queues, and cached snapshots are scoped by authenticated user and household.
- Legacy `default-home` data is quarantined and can only be claimed explicitly.
- Migration uses a short maintenance/read-only cutover rather than dual writes.

## Domain and authorization

`users` contains application profiles. `user_identities` maps a verified provider subject to one user. `household_members` is the authorization source of truth between users and households. An active-household preference is UX state only and never grants access.

Viewers can read household data. Members can also edit appliances, usage, and bills. Admins can edit household configuration and manage member/viewer invitations and memberships. Owners can additionally manage admins, delete the household, and transfer ownership. Ownership changes use a dedicated atomic operation; generic role changes cannot create another owner.

Non-members receive `404` for household resources, authenticated members with insufficient roles receive `403`, and missing identity receives `401`.

## Data and API boundaries

Catalog, usage-profile definitions, and tariff reference data are global. User profile/preferences are user-owned. Household configuration, appliances, usage, bills, history, members, and invitations are household-owned.

The public API is rooted at `/api/households/:householdId`. Dashboard, home, bills, members, and invitations are explicit subresources. `/api/me` supplies the authenticated profile. `/api/catalog` remains global. The old implicit `/api/home` and `/api/bills` routes are removed at cutover.

Home reads return `{ householdId, revision, items }`. Home writes accept `{ expectedRevision, items }`. A conditional D1 batch changes rows only when `home_revision` still equals the expected revision and bumps it last. A mismatch returns `{ code: "HOME_REVISION_CONFLICT", currentRevision }` with status 409.

## Client lifecycle

The client resolves the authenticated user and membership before reading local drafts. The durable key and Web Lock name include user and household public IDs. Switching household/account aborts requests and invalidates the previous save generation. Session expiry preserves the exact scoped draft but stops retries until the same identity and membership are revalidated. Explicit logout never allows a background save after logout starts.

## Migration

Schema changes are additive first. During the read-only cutover, existing relational homes and `default-home` data are copied into quarantined households, catalog references and duplicate instances are preserved, unknown catalog keys fail verification, monthly rows are mapped to household foreign keys, and counts/checksums/foreign keys are verified before writes resume. Legacy tables and routes are removed only after an observation period.

