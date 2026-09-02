# Multi-user household cutover

This runbook moves legacy WattWise data into isolated quarantine households. It is a short maintenance/read-only cutover: there are no dual writes and no automatic assignment to the first user.

## Safety boundary

- `household_appliances` is the only writable Home source of truth after cutover.
- `saved_home_appliances` and `monthly_energy_records` remain read-only legacy evidence during the observation period.
- The old implicit `/api/home` and `/api/bills` routes are absent. All household reads and writes use `/api/households/:householdId/*`.
- Each legacy relational household and each legacy string key gets a separate deterministic quarantine household. No membership is created by backfill.
- Inactive catalog references are valid and retained. An unknown catalog key creates `UNKNOWN_CATALOG_KEY`, blocks verification, and cannot be claimed.

## Maintenance procedure

1. Announce maintenance and prevent Home and bill writes at the edge. Confirm no old application instance can still write the legacy routes.
2. Export a D1 backup and record the current row counts for `households`, `household_appliances`, `saved_home_appliances`, and `monthly_energy_records`.
3. Apply all forward migrations through `0010`. Do not delete or rename legacy tables. The normal production deploy job is gated by the repository variable `MULTI_USER_CUTOVER_COMPLETE`; leave it unset or set to `false` during this procedure.
4. Export `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_D1_DATABASE_ID`, and a short-lived `CLOUDFLARE_API_TOKEN` with D1 read/write permission in an operator-only terminal. Do not put these values in shell history or CI output.
5. Run `npm run cutover:remote -- preview`, then `npm run cutover:remote -- backfill`. The checked-in maintenance command uses Cloudflare's authenticated D1 administrative API, prepared statements, and bounded transactional batches. It creates no membership and can be rerun safely while the source remains read-only.
6. Run `npm run cutover:remote -- verify`. The command exits with status 2 unless `readyForClaims` is `true`. Check source/copied appliance and monthly counts, immutable manifest/source checksums, live target checksums, issue counts, and `PRAGMA foreign_key_check`.
7. Resolve every blocked source. For `UNKNOWN_CATALOG_KEY`, add or explicitly map the missing catalog model; never discard the source row or immutable issue history. Rerun the backfill and verification.
8. Only after verification succeeds, set the GitHub repository variable `MULTI_USER_CUTOVER_COMPLETE=true`, dispatch the production workflow, smoke-test the global catalog plus one authenticated household, and then allow writes again.

If any copy step fails, leave writes disabled, restore the backup to a new D1 database, and investigate there. The migration is forward-only; do not attempt a destructive down migration on the production database.

## Explicit claim

After verification, an operator selects one `legacy_cutover_sources.id` from the verification output and runs `npm run cutover:remote -- issue-token --source-id <id> --expires-at <ISO-8601>`. Run token issuance only in an interactive operator terminal, never in CI; the JSON output contains the one-time secret. Deliver it once over an authenticated support channel. Only its SHA-256 hash is stored in D1, while the authenticated Cloudflare administrative request remains attributable to the API-token principal.

The signed-in user submits the token to `POST /api/household-claims` as `{ "token": "..." }`. One conditional database update and its migration trigger atomically consume the unexpired token, activate the quarantine household, create exactly one owner membership for the authenticated user, and mark the source claimed. Invalid, expired, or reused tokens all return the same not-found response and reveal no household metadata.

Do not issue a token while a source is blocked. An expired unused token may be replaced; a consumed token cannot be reissued.

## Observation and contraction

Keep the legacy tables, `legacy_cutover_sources`, `legacy_cutover_issues`, and claim audit rows for an agreed observation window. Monitor claim failures, verification drift, foreign-key failures, and support reports. A later reviewed migration may archive and remove legacy tables only after every retained source is claimed or intentionally retired and backups have been tested.
