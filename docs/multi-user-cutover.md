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
3. Apply all forward migrations through `0009`. Do not delete or rename legacy tables.
4. From a one-off trusted maintenance runner with the production `DB` binding, call `runLegacyCutover(DB)`. This function uses prepared D1 statements and bounded batches, creates no membership, and can be rerun safely while the source remains read-only.
5. Call `readLegacyCutoverVerification(DB)`. Keep maintenance enabled unless `readyForClaims` is `true`. Check source/copied appliance and monthly counts, source/target checksums, live target checksums, issue counts, and `PRAGMA foreign_key_check`.
6. Resolve every blocked source. For `UNKNOWN_CATALOG_KEY`, add or explicitly map the missing catalog model; never discard the row silently. Rerun the backfill and verification.
7. Deploy the household-scoped runtime, smoke-test the global catalog plus one authenticated household, and only then allow writes again.

If any copy step fails, leave writes disabled, restore the backup to a new D1 database, and investigate there. The migration is forward-only; do not attempt a destructive down migration on the production database.

## Explicit claim

After verification, an operator selects one `legacy_cutover_sources.id` and calls `issueHouseholdClaimToken(DB, sourceId, { expiresAt })` from the trusted maintenance runner. Deliver the returned secret once over an authenticated support channel. Only its SHA-256 hash is stored.

The signed-in user submits the token to `POST /api/household-claims` as `{ "token": "..." }`. One conditional database update and its migration trigger atomically consume the unexpired token, activate the quarantine household, create exactly one owner membership for the authenticated user, and mark the source claimed. Invalid, expired, or reused tokens all return the same not-found response and reveal no household metadata.

Do not issue a token while a source is blocked. An expired unused token may be replaced; a consumed token cannot be reissued.

## Observation and contraction

Keep the legacy tables, `legacy_cutover_sources`, `legacy_cutover_issues`, and claim audit rows for an agreed observation window. Monitor claim failures, verification drift, foreign-key failures, and support reports. A later reviewed migration may archive and remove legacy tables only after every retained source is claimed or intentionally retired and backups have been tested.
